const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cron = require('node-cron');
const db = require('./database');
const WhatsAppManager = require('./whatsapp');

// ─── Express Setup ─────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

const PORT = process.env.PORT || 3008;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure directories
['public/uploads/media', 'public/uploads/products', 'public/uploads/campaigns', 'data', 'logs'].forEach(dir => {
    const fullPath = path.join(__dirname, dir);
    if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
});

// Multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const type = req.params.type || 'media';
        const dir = path.join(__dirname, 'public', 'uploads', type);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 16 * 1024 * 1024 } // 16MB
});

// ─── WhatsApp Manager ──────────────────────────────────────────────────────────
const wa = new WhatsAppManager(io);

// ─── Socket.IO ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log('🔗 Client connected:', socket.id);

    // Send current WhatsApp status
    socket.emit('wa:status', wa.getStatus());
    if (wa.qrCode) {
        socket.emit('wa:qr', { qr: wa.qrCode });
    }

    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected:', socket.id);
    });
});

// ─── API Routes ────────────────────────────────────────────────────────────────

// ── WhatsApp Status ────────────────────────────────────────────────────────────
app.get('/api/whatsapp/status', (req, res) => {
    res.json(wa.getStatus());
});

app.post('/api/whatsapp/logout', async (req, res) => {
    try {
        await wa.logout();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Send Message ───────────────────────────────────────────────────────────────
app.post('/api/messages/send', async (req, res) => {
    try {
        const { chatId, message, mediaPath } = req.body;
        const result = await wa.sendMessage(chatId, message, { media: mediaPath });
        res.json({ success: true, messageId: result.id._serialized });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Send Media Message ─────────────────────────────────────────────────────────
app.post('/api/messages/send-media', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const { chatId, caption } = req.body;
        if (!chatId) return res.status(400).json({ error: 'chatId required' });

        const filePath = req.file.path;
        const result = await wa.sendMessage(chatId, caption || '', { media: filePath, skipDB: true });

        // Determine the message type from mime
        const mime = req.file.mimetype || '';
        let msgType = 'document';
        if (mime.startsWith('image/')) msgType = 'image';
        else if (mime.startsWith('video/')) msgType = 'video';
        else if (mime.startsWith('audio/')) msgType = 'audio';

        // Save to DB with media info
        const conversation = db.prepare(`SELECT * FROM conversations WHERE chat_id = ?`).get(chatId);
        if (conversation) {
            const mediaUrl = `/uploads/media/${req.file.filename}`;
            db.prepare(`
                INSERT INTO messages (conversation_id, message_id, from_me, type, body, media_url, media_mime, timestamp, status)
                VALUES (?, ?, 1, ?, ?, ?, ?, datetime('now','localtime'), 'sent')
            `).run(conversation.id, result.id._serialized, msgType, caption || '', mediaUrl, mime);

            const preview = caption ? caption.substring(0, 200) : `📎 ${req.file.originalname}`;
            db.prepare(`
                UPDATE conversations SET last_message = ?, last_message_at = datetime('now','localtime'), updated_at = datetime('now','localtime')
                WHERE id = ?
            `).run(preview, conversation.id);
        }

        res.json({ success: true, messageId: result.id._serialized });
    } catch (err) {
        console.error('Send media error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── Conversations ──────────────────────────────────────────────────────────────
app.get('/api/conversations', (req, res) => {
    const { status, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let where = '1=1';
    const params = [];

    if (status && status !== 'all') {
        where += ' AND c.status = ?';
        params.push(status);
    }

    if (search) {
        where += ' AND (cl.name LIKE ? OR cl.phone LIKE ? OR cl.push_name LIKE ? OR c.last_message LIKE ?)';
        const s = `%${search}%`;
        params.push(s, s, s, s);
    }

    const total = db.prepare(`
        SELECT COUNT(*) as cnt FROM conversations c 
        JOIN clients cl ON c.client_id = cl.id 
        WHERE ${where}
    `).get(...params).cnt;

    const items = db.prepare(`
        SELECT c.*, cl.name as client_name, cl.phone as client_phone, cl.push_name, cl.status as client_status, cl.tags as client_tags
        FROM conversations c 
        JOIN clients cl ON c.client_id = cl.id 
        WHERE ${where}
        ORDER BY c.last_message_at DESC
        LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), parseInt(offset));

    res.json({ items, total, page: parseInt(page), limit: parseInt(limit) });
});

app.get('/api/conversations/:id', (req, res) => {
    const conv = db.prepare(`
        SELECT c.*, cl.name as client_name, cl.phone as client_phone, cl.push_name, cl.email, cl.company, cl.notes, cl.tags as client_tags, cl.status as client_status
        FROM conversations c JOIN clients cl ON c.client_id = cl.id WHERE c.id = ?
    `).get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conv);
});

app.put('/api/conversations/:id', (req, res) => {
    const { status, priority, assigned_to } = req.body;
    const updates = [];
    const params = [];

    if (status) { updates.push('status = ?'); params.push(status); }
    if (priority) { updates.push('priority = ?'); params.push(priority); }
    if (assigned_to !== undefined) { updates.push('assigned_to = ?'); params.push(assigned_to); }

    updates.push("updated_at = datetime('now','localtime')");
    params.push(req.params.id);

    db.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ success: true });
});

app.put('/api/conversations/:id/read', (req, res) => {
    db.prepare(`UPDATE conversations SET unread_count = 0, updated_at = datetime('now','localtime') WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
});

app.delete('/api/conversations/:id', (req, res) => {
    try {
        const convId = req.params.id;
        // Delete media files from disk
        const mediaMessages = db.prepare(`SELECT media_url FROM messages WHERE conversation_id = ? AND media_url != ''`).all(convId);
        mediaMessages.forEach(m => {
            try {
                const filePath = path.join(__dirname, 'public', m.media_url);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            } catch (e) { /* ignore file errors */ }
        });
        // Delete messages and conversation in transaction
        const deleteAll = db.transaction(() => {
            db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(convId);
            db.prepare(`DELETE FROM tasks WHERE conversation_id = ?`).run(convId);
            db.prepare(`DELETE FROM conversations WHERE id = ?`).run(convId);
        });
        deleteAll();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Messages ───────────────────────────────────────────────────────────────────
app.get('/api/messages/:conversationId', (req, res) => {
    const { page = 1, limit = 100 } = req.query;
    const offset = (page - 1) * limit;

    const items = db.prepare(`
        SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?
    `).all(req.params.conversationId, parseInt(limit), parseInt(offset));

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?`).get(req.params.conversationId).cnt;

    res.json({ items, total });
});

// ── Clients ────────────────────────────────────────────────────────────────────
app.get('/api/clients', (req, res) => {
    const { status, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let where = '1=1';
    const params = [];

    if (status && status !== 'all') {
        where += ' AND status = ?';
        params.push(status);
    }

    if (search) {
        where += ' AND (name LIKE ? OR phone LIKE ? OR push_name LIKE ? OR company LIKE ?)';
        const s = `%${search}%`;
        params.push(s, s, s, s);
    }

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM clients WHERE ${where}`).get(...params).cnt;
    const items = db.prepare(`SELECT * FROM clients WHERE ${where} ORDER BY last_message_at DESC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), parseInt(offset));

    res.json({ items, total, page: parseInt(page), limit: parseInt(limit) });
});

app.get('/api/clients/:id', (req, res) => {
    const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json(client);
});

app.put('/api/clients/:id', (req, res) => {
    const { name, email, company, notes, tags, status } = req.body;
    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    if (company !== undefined) { updates.push('company = ?'); params.push(company); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
    if (tags !== undefined) { updates.push('tags = ?'); params.push(JSON.stringify(tags)); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }

    updates.push("updated_at = datetime('now','localtime')");
    params.push(req.params.id);

    db.prepare(`UPDATE clients SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ success: true });
});

// ── Bot Rules ──────────────────────────────────────────────────────────────────
app.get('/api/bot/rules', (req, res) => {
    const rules = db.prepare(`SELECT * FROM bot_rules ORDER BY priority DESC, created_at DESC`).all();
    res.json(rules);
});

app.post('/api/bot/rules', (req, res) => {
    const { name, trigger_type, trigger_value, response_text, response_type, media_url, is_active, priority, delay_seconds, only_first_message, schedule_start, schedule_end } = req.body;

    const result = db.prepare(`
        INSERT INTO bot_rules (name, trigger_type, trigger_value, response_text, response_type, media_url, is_active, priority, delay_seconds, only_first_message, schedule_start, schedule_end)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, trigger_type || 'keyword', trigger_value || '', response_text, response_type || 'text', media_url || '', is_active !== undefined ? is_active : 1, priority || 0, delay_seconds || 1, only_first_message || 0, schedule_start || '', schedule_end || '');

    res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/bot/rules/:id', (req, res) => {
    const { name, trigger_type, trigger_value, response_text, response_type, media_url, is_active, priority, delay_seconds, only_first_message, schedule_start, schedule_end } = req.body;

    db.prepare(`
        UPDATE bot_rules SET name=?, trigger_type=?, trigger_value=?, response_text=?, response_type=?, media_url=?, is_active=?, priority=?, delay_seconds=?, only_first_message=?, schedule_start=?, schedule_end=?, updated_at=datetime('now','localtime')
        WHERE id = ?
    `).run(name, trigger_type, trigger_value, response_text, response_type, media_url || '', is_active, priority, delay_seconds, only_first_message, schedule_start || '', schedule_end || '', req.params.id);

    res.json({ success: true });
});

app.delete('/api/bot/rules/:id', (req, res) => {
    db.prepare(`DELETE FROM bot_rules WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
});

// ── Tasks ──────────────────────────────────────────────────────────────────────
app.get('/api/tasks', (req, res) => {
    const { status, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let where = '1=1';
    const params = [];

    if (status && status !== 'all') {
        where += ' AND t.status = ?';
        params.push(status);
    }

    const items = db.prepare(`
        SELECT t.*, cl.name as client_name, cl.phone as client_phone
        FROM tasks t LEFT JOIN clients cl ON t.client_id = cl.id
        WHERE ${where}
        ORDER BY 
            CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
            t.due_date ASC
        LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), parseInt(offset));

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM tasks t WHERE ${where}`).get(...params).cnt;

    res.json({ items, total });
});

app.post('/api/tasks', (req, res) => {
    const { title, description, client_id, conversation_id, due_date, reminder_at, priority } = req.body;

    const result = db.prepare(`
        INSERT INTO tasks (title, description, client_id, conversation_id, due_date, reminder_at, priority)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(title, description || '', client_id || null, conversation_id || null, due_date || null, reminder_at || null, priority || 'normal');

    res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/tasks/:id', (req, res) => {
    const { title, description, due_date, reminder_at, status, priority } = req.body;
    const updates = [];
    const params = [];

    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (due_date !== undefined) { updates.push('due_date = ?'); params.push(due_date); }
    if (reminder_at !== undefined) { updates.push('reminder_at = ?'); params.push(reminder_at); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (priority !== undefined) { updates.push('priority = ?'); params.push(priority); }

    updates.push("updated_at = datetime('now','localtime')");
    params.push(req.params.id);

    db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ success: true });
});

app.delete('/api/tasks/:id', (req, res) => {
    db.prepare(`DELETE FROM tasks WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
});

// ── Products ───────────────────────────────────────────────────────────────────
app.get('/api/products', (req, res) => {
    const { category, search, active_only } = req.query;
    let where = '1=1';
    const params = [];

    if (active_only) { where += ' AND is_active = 1'; }
    if (category) { where += ' AND category = ?'; params.push(category); }
    if (search) { where += ' AND (name LIKE ? OR sku LIKE ? OR description LIKE ?)'; const s = `%${search}%`; params.push(s, s, s); }

    const items = db.prepare(`SELECT * FROM products WHERE ${where} ORDER BY category, name`).all(...params);
    res.json(items);
});

app.post('/api/products', (req, res) => {
    const { name, description, price, currency, sku, category, image_url, stock, is_active } = req.body;

    const result = db.prepare(`
        INSERT INTO products (name, description, price, currency, sku, category, image_url, stock, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, description || '', price || 0, currency || 'CLP', sku || '', category || '', image_url || '', stock || 0, is_active !== undefined ? is_active : 1);

    res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/products/:id', (req, res) => {
    const { name, description, price, currency, sku, category, image_url, stock, is_active } = req.body;

    db.prepare(`
        UPDATE products SET name=?, description=?, price=?, currency=?, sku=?, category=?, image_url=?, stock=?, is_active=?, updated_at=datetime('now','localtime')
        WHERE id = ?
    `).run(name, description || '', price || 0, currency || 'CLP', sku || '', category || '', image_url || '', stock || 0, is_active !== undefined ? is_active : 1, req.params.id);

    res.json({ success: true });
});

app.delete('/api/products/:id', (req, res) => {
    db.prepare(`DELETE FROM products WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
});

// Product categories
app.get('/api/products/categories/list', (req, res) => {
    const cats = db.prepare(`SELECT * FROM product_categories ORDER BY sort_order, name`).all();
    res.json(cats);
});

app.post('/api/products/categories', (req, res) => {
    const { name, description, icon } = req.body;
    const result = db.prepare(`INSERT OR IGNORE INTO product_categories (name, description, icon) VALUES (?, ?, ?)`).run(name, description || '', icon || '📦');
    res.json({ success: true, id: result.lastInsertRowid });
});

// Send product via WhatsApp
app.post('/api/products/:id/send', async (req, res) => {
    try {
        const { chatId } = req.body;
        await wa.sendCatalogProduct(chatId, req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Campaigns ──────────────────────────────────────────────────────────────────
app.get('/api/campaigns', (req, res) => {
    const items = db.prepare(`SELECT * FROM campaigns ORDER BY created_at DESC`).all();
    res.json(items);
});

app.post('/api/campaigns', (req, res) => {
    const { name, message, media_url, target_filter, scheduled_at } = req.body;

    // Determine target clients
    let filter = {};
    try { filter = JSON.parse(target_filter || '{}'); } catch (e) { }

    let where = "status = 'active'";
    const params = [];
    if (filter.tags && filter.tags.length) {
        // Filter by tags (stored as JSON array)
        const tagClauses = filter.tags.map(t => `tags LIKE ?`);
        where += ` AND (${tagClauses.join(' OR ')})`;
        filter.tags.forEach(t => params.push(`%${t}%`));
    }

    const targets = db.prepare(`SELECT id FROM clients WHERE ${where}`).all(...params);

    const result = db.prepare(`
        INSERT INTO campaigns (name, message, media_url, target_filter, status, scheduled_at, total_targets)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, message, media_url || '', target_filter || '{}', scheduled_at ? 'scheduled' : 'draft', scheduled_at || null, targets.length);

    // Insert recipients
    const insertRecipient = db.prepare(`INSERT INTO campaign_recipients (campaign_id, client_id) VALUES (?, ?)`);
    const insertAll = db.transaction((items) => {
        for (const item of items) insertRecipient.run(result.lastInsertRowid, item.id);
    });
    insertAll(targets);

    res.json({ success: true, id: result.lastInsertRowid, targetCount: targets.length });
});

app.post('/api/campaigns/:id/send', async (req, res) => {
    try {
        const campaign = db.prepare(`SELECT * FROM campaigns WHERE id = ?`).get(req.params.id);
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

        const recipients = db.prepare(`
            SELECT cr.*, cl.phone FROM campaign_recipients cr
            JOIN clients cl ON cr.client_id = cl.id
            WHERE cr.campaign_id = ? AND cr.status = 'pending'
        `).all(req.params.id);

        db.prepare(`UPDATE campaigns SET status = 'sending' WHERE id = ?`).run(req.params.id);

        // Send in background
        let sentCount = 0;
        let failedCount = 0;

        (async () => {
            for (const r of recipients) {
                try {
                    const chatId = r.phone + '@c.us';
                    if (campaign.media_url) {
                        const mediaPath = path.join(__dirname, 'public', campaign.media_url);
                        await wa.sendMessage(chatId, campaign.message, { media: fs.existsSync(mediaPath) ? mediaPath : undefined });
                    } else {
                        await wa.sendMessage(chatId, campaign.message);
                    }
                    db.prepare(`UPDATE campaign_recipients SET status = 'sent', sent_at = datetime('now','localtime') WHERE id = ?`).run(r.id);
                    sentCount++;
                    // Delay 3-6 seconds between messages
                    await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 3000));
                } catch (err) {
                    db.prepare(`UPDATE campaign_recipients SET status = 'failed' WHERE id = ?`).run(r.id);
                    failedCount++;
                }

                db.prepare(`UPDATE campaigns SET sent_count = ?, failed_count = ? WHERE id = ?`).run(sentCount, failedCount, req.params.id);
                io.emit('campaign:progress', { campaignId: parseInt(req.params.id), sent: sentCount, failed: failedCount, total: recipients.length });
            }

            db.prepare(`UPDATE campaigns SET status = 'completed', sent_count = ?, failed_count = ? WHERE id = ?`).run(sentCount, failedCount, req.params.id);
            io.emit('campaign:complete', { campaignId: parseInt(req.params.id), sent: sentCount, failed: failedCount });
        })();

        res.json({ success: true, totalRecipients: recipients.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/campaigns/:id', (req, res) => {
    db.prepare(`DELETE FROM campaign_recipients WHERE campaign_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM campaigns WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
});

// ── Quick Replies ──────────────────────────────────────────────────────────────
app.get('/api/quick-replies', (req, res) => {
    const items = db.prepare(`SELECT * FROM quick_replies ORDER BY use_count DESC`).all();
    res.json(items);
});

app.post('/api/quick-replies', (req, res) => {
    const { shortcut, title, content, category } = req.body;
    const result = db.prepare(`INSERT INTO quick_replies (shortcut, title, content, category) VALUES (?, ?, ?, ?)`).run(shortcut, title, content, category || 'general');
    res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/quick-replies/:id', (req, res) => {
    const { shortcut, title, content, category } = req.body;
    db.prepare(`UPDATE quick_replies SET shortcut=?, title=?, content=?, category=? WHERE id=?`).run(shortcut, title, content, category, req.params.id);
    res.json({ success: true });
});

app.delete('/api/quick-replies/:id', (req, res) => {
    db.prepare(`DELETE FROM quick_replies WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
});

// ── Settings ───────────────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
    const items = db.prepare(`SELECT * FROM settings`).all();
    const settings = {};
    items.forEach(s => {
        if (s.type === 'boolean') settings[s.key] = s.value === 'true';
        else if (s.type === 'number') settings[s.key] = Number(s.value);
        else if (s.type === 'json') { try { settings[s.key] = JSON.parse(s.value); } catch (e) { settings[s.key] = s.value; } }
        else settings[s.key] = s.value;
    });
    res.json(settings);
});

app.put('/api/settings', (req, res) => {
    const upsert = db.prepare(`INSERT INTO settings (key, value, type, updated_at) VALUES (?, ?, ?, datetime('now','localtime')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now','localtime')`);

    const updateAll = db.transaction((settings) => {
        for (const [key, value] of Object.entries(settings)) {
            const type = typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : typeof value === 'object' ? 'json' : 'string';
            const strVal = typeof value === 'object' ? JSON.stringify(value) : String(value);
            upsert.run(key, strVal, type, strVal);
        }
    });

    updateAll(req.body);
    res.json({ success: true });
});

// ── WhatsApp API ───────────────────────────────────────────────────────────────
app.get('/api/whatsapp/status', (req, res) => {
    res.json(wa.getStatus());
});

app.post('/api/whatsapp/restart', async (req, res) => {
    try {
        res.json({ success: true, message: 'Reiniciando conexión...' });
        await wa.restart();
    } catch (err) {
        console.error('Restart error:', err);
    }
});

app.post('/api/whatsapp/logout', async (req, res) => {
    try {
        await wa.logout();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Reset Session (borrar sesión y pedir QR nuevo) ─────────────────────────
app.post('/api/whatsapp/reset-session', async (req, res) => {
    try {
        console.log('🔄 Resetting WhatsApp session...');
        // Destroy client first
        if (wa.client) {
            try { await wa.client.destroy(); } catch (e) { /* ignore */ }
            wa.client = null;
        }
        wa.isReady = false;
        wa.connectionStatus = 'disconnected';
        wa.qrCode = null;

        // Delete session data
        const sessionPath = path.join(__dirname, 'data', '.wwebjs_auth');
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            fs.mkdirSync(sessionPath, { recursive: true });
            console.log('✅ Session data cleared');
        }

        res.json({ success: true, message: 'Sesión reiniciada. Espera el nuevo QR...' });

        // Reinitialize after short delay
        setTimeout(() => wa.initialize(), 2000);

    } catch (err) {
        console.error('Reset session error:', err);
        res.status(500).json({ error: err.message });
    }
});


// ── File Upload ────────────────────────────────────────────────────────────────
app.post('/api/upload/:type', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({
        success: true,
        url: `/uploads/${req.params.type}/${req.file.filename}`,
        filename: req.file.filename
    });
});

// ── Dashboard Stats ────────────────────────────────────────────────────────────
app.get('/api/dashboard/stats', (req, res) => {
    const stats = {
        totalClients: db.prepare(`SELECT COUNT(*) as cnt FROM clients`).get().cnt,
        activeClients: db.prepare(`SELECT COUNT(*) as cnt FROM clients WHERE status = 'active'`).get().cnt,
        archivedClients: db.prepare(`SELECT COUNT(*) as cnt FROM clients WHERE status = 'archived'`).get().cnt,
        totalConversations: db.prepare(`SELECT COUNT(*) as cnt FROM conversations`).get().cnt,
        activeConversations: db.prepare(`SELECT COUNT(*) as cnt FROM conversations WHERE status = 'active'`).get().cnt,
        unreadMessages: db.prepare(`SELECT COALESCE(SUM(unread_count), 0) as cnt FROM conversations`).get().cnt,
        totalMessages: db.prepare(`SELECT COUNT(*) as cnt FROM messages`).get().cnt,
        todayMessages: db.prepare(`SELECT COUNT(*) as cnt FROM messages WHERE date(timestamp) = date('now','localtime')`).get().cnt,
        pendingTasks: db.prepare(`SELECT COUNT(*) as cnt FROM tasks WHERE status = 'pending'`).get().cnt,
        totalProducts: db.prepare(`SELECT COUNT(*) as cnt FROM products WHERE is_active = 1`).get().cnt,
        activeCampaigns: db.prepare(`SELECT COUNT(*) as cnt FROM campaigns WHERE status IN ('sending','scheduled')`).get().cnt,
        botRules: db.prepare(`SELECT COUNT(*) as cnt FROM bot_rules WHERE is_active = 1`).get().cnt,
    };
    res.json(stats);
});

// ── Cron Jobs ──────────────────────────────────────────────────────────────────

// Check task reminders every minute
cron.schedule('* * * * *', () => {
    const now = new Date().toISOString().slice(0, 16);
    const tasks = db.prepare(`
        SELECT t.*, cl.phone FROM tasks t 
        LEFT JOIN clients cl ON t.client_id = cl.id 
        WHERE t.reminder_at IS NOT NULL AND t.reminder_at <= ? AND t.status = 'pending'
    `).all(now);

    tasks.forEach(task => {
        io.emit('task:reminder', task);
        // Mark reminder as sent
        db.prepare(`UPDATE tasks SET reminder_at = NULL WHERE id = ?`).run(task.id);
    });
});

// Check scheduled campaigns every minute
cron.schedule('* * * * *', async () => {
    const now = new Date().toISOString().slice(0, 16);
    const campaigns = db.prepare(`SELECT * FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= ?`).all(now);

    for (const campaign of campaigns) {
        console.log(`📢 Launching scheduled campaign: ${campaign.name}`);
        // Trigger campaign send
        try {
            const recipients = db.prepare(`
                SELECT cr.*, cl.phone FROM campaign_recipients cr
                JOIN clients cl ON cr.client_id = cl.id
                WHERE cr.campaign_id = ? AND cr.status = 'pending'
            `).all(campaign.id);

            db.prepare(`UPDATE campaigns SET status = 'sending' WHERE id = ?`).run(campaign.id);

            let sent = 0, failed = 0;
            for (const r of recipients) {
                try {
                    await wa.sendMessage(r.phone + '@c.us', campaign.message);
                    db.prepare(`UPDATE campaign_recipients SET status = 'sent', sent_at = datetime('now','localtime') WHERE id = ?`).run(r.id);
                    sent++;
                    await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 3000));
                } catch (err) {
                    db.prepare(`UPDATE campaign_recipients SET status = 'failed' WHERE id = ?`).run(r.id);
                    failed++;
                }
            }

            db.prepare(`UPDATE campaigns SET status = 'completed', sent_count = ?, failed_count = ? WHERE id = ?`).run(sent, failed, campaign.id);
        } catch (err) {
            console.error('Campaign error:', err);
        }
    }
});

// ─── SPA Fallback ──────────────────────────────────────────────────────────────
app.get('{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start Server ──────────────────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║                                                  ║
║   🟢 WhatsApp CRM - ROTAR                       ║
║   📡 Server running on http://localhost:${PORT}    ║
║                                                  ║
╚══════════════════════════════════════════════════╝
    `);

    // Initialize WhatsApp
    wa.initialize();
});
