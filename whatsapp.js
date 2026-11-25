const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const db = require('./database');

class WhatsAppManager extends EventEmitter {
    constructor(io) {
        super();
        this.io = io;
        this.client = null;
        this.isReady = false;
        this.qrCode = null;
        this.connectionStatus = 'disconnected';
        this.info = null;
    }

    async initialize() {
        const sessionPath = path.join(__dirname, 'data', '.wwebjs_auth');
        if (!fs.existsSync(sessionPath)) {
            fs.mkdirSync(sessionPath, { recursive: true });
        }

        // Detect Chrome path automatically
        const possibleChromePaths = [
            'C:\\Users\\rotar\\.cache\\puppeteer\\chrome\\win64-145.0.7632.77\\chrome-win64\\chrome.exe',
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
        ];
        let chromePath = null;
        for (const p of possibleChromePaths) {
            if (fs.existsSync(p)) { chromePath = p; break; }
        }

        this.client = new Client({
            authStrategy: new LocalAuth({
                dataPath: path.join(__dirname, 'data', '.wwebjs_auth')
            }),
            // Fix para whatsapp-web.js 1.27+: forzar versión estable de WA Web
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1023767716.html'
            },
            puppeteer: {
                headless: true,
                ...(chromePath ? { executablePath: chromePath } : {}),
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ]
            }
        });

        this._setupEventHandlers();

        console.log('🔌 Initializing WhatsApp connection...');
        this.connectionStatus = 'connecting';
        this.io.emit('wa:status', { status: 'connecting' });

        try {
            await this.client.initialize();
        } catch (err) {
            console.error('❌ WhatsApp initialization error:', err.message);
            this.connectionStatus = 'error';
            this.io.emit('wa:status', { status: 'error', message: err.message });
        }
    }

    _setupEventHandlers() {
        // QR Code event
        this.client.on('qr', async (qr) => {
            console.log('📱 QR Code received, scan with WhatsApp');
            this.connectionStatus = 'qr';
            try {
                this.qrCode = await QRCode.toDataURL(qr, {
                    width: 300,
                    margin: 2,
                    color: { dark: '#1a1a2e', light: '#ffffff' }
                });
                this.io.emit('wa:qr', { qr: this.qrCode });
                this.io.emit('wa:status', { status: 'qr' });
            } catch (err) {
                console.error('QR generation error:', err);
            }
        });

        // Ready event
        this.client.on('ready', () => {
            console.log('✅ WhatsApp client is ready!');
            this.isReady = true;
            this.connectionStatus = 'connected';
            this.qrCode = null;
            this.info = this.client.info;
            this.io.emit('wa:status', {
                status: 'connected',
                info: {
                    pushname: this.client.info?.pushname || '',
                    phone: this.client.info?.wid?.user || '',
                    platform: this.client.info?.platform || ''
                }
            });
        });

        // Authentication success
        this.client.on('authenticated', () => {
            console.log('🔐 WhatsApp authenticated');
            this.connectionStatus = 'authenticated';
            this.io.emit('wa:status', { status: 'authenticated' });
        });

        // Authentication failure
        this.client.on('auth_failure', (msg) => {
            console.error('❌ Authentication failure:', msg);
            this.connectionStatus = 'auth_failure';
            this.io.emit('wa:status', { status: 'auth_failure', message: msg });
        });

        // Disconnected
        this.client.on('disconnected', (reason) => {
            console.log('📴 WhatsApp disconnected:', reason);
            this.isReady = false;
            this.connectionStatus = 'disconnected';
            this.io.emit('wa:status', { status: 'disconnected', reason });
        });

        // Incoming message - use message_create for reliability (catches all messages)
        this.client.on('message_create', async (msg) => {
            try {
                // Skip our own outgoing messages
                if (msg.fromMe) return;
                console.log(`📩 Message received from ${msg.from}: ${(msg.body || '[media]').substring(0, 50)}`);
                await this._handleIncomingMessage(msg);
            } catch (err) {
                console.error('❌ Error in message_create handler:', err);
            }
        });

        // Message acknowledgment (delivered, read, etc.)
        this.client.on('message_ack', (msg, ack) => {
            const statusMap = { 0: 'pending', 1: 'sent', 2: 'delivered', 3: 'read', 4: 'read' };
            const status = statusMap[ack] || 'sent';

            try {
                db.prepare(`UPDATE messages SET status = ? WHERE message_id = ?`)
                    .run(status, msg.id._serialized);

                this.io.emit('message:ack', {
                    messageId: msg.id._serialized,
                    status
                });
            } catch (err) {
                // Ignore ack errors for messages not in DB
            }
        });
    }

    async _handleIncomingMessage(msg) {
        try {
            // Skip status messages and non-standard chats (channels, newsletters)
            if (msg.isStatus) return;
            if (!msg.from || (!msg.from.endsWith('@c.us') && !msg.from.endsWith('@g.us'))) return;

            const contact = await msg.getContact();
            let chat;
            try {
                chat = await msg.getChat();
            } catch (chatErr) {
                console.log('⚠ Skipping unsupported chat type:', msg.from);
                return;
            }
            const phone = msg.from.replace('@c.us', '').replace('@g.us', '');
            const isGroup = msg.from.endsWith('@g.us');
            const pushName = contact.pushname || contact.name || phone;

            // 1. Upsert client
            let client = db.prepare(`SELECT * FROM clients WHERE phone = ?`).get(phone);
            if (!client) {
                db.prepare(`
                    INSERT INTO clients (phone, name, push_name, last_message_at) 
                    VALUES (?, ?, ?, datetime('now','localtime'))
                `).run(phone, pushName, pushName);
                client = db.prepare(`SELECT * FROM clients WHERE phone = ?`).get(phone);
            } else {
                db.prepare(`
                    UPDATE clients SET push_name = ?, last_message_at = datetime('now','localtime'), updated_at = datetime('now','localtime')
                    WHERE id = ?
                `).run(pushName, client.id);
            }

            // 2. Upsert conversation
            let conversation = db.prepare(`SELECT * FROM conversations WHERE chat_id = ?`).get(msg.from);
            if (!conversation) {
                db.prepare(`
                    INSERT INTO conversations (client_id, chat_id, is_group, group_name, last_message, last_message_at, unread_count)
                    VALUES (?, ?, ?, ?, ?, datetime('now','localtime'), 1)
                `).run(client.id, msg.from, isGroup ? 1 : 0, isGroup ? chat.name : '', msg.body?.substring(0, 200) || '[Media]');
                conversation = db.prepare(`SELECT * FROM conversations WHERE chat_id = ?`).get(msg.from);
            } else {
                db.prepare(`
                    UPDATE conversations SET 
                        last_message = ?,
                        last_message_at = datetime('now','localtime'),
                        unread_count = unread_count + 1,
                        status = CASE WHEN status = 'archived' THEN 'active' ELSE status END,
                        updated_at = datetime('now','localtime')
                    WHERE id = ?
                `).run(msg.body?.substring(0, 200) || '[Media]', conversation.id);
            }

            // 3. Save message
            let mediaUrl = '';
            let realMimeType = '';
            if (msg.hasMedia) {
                try {
                    const media = await msg.downloadMedia();
                    if (media) {
                        const mediaDir = path.join(__dirname, 'public', 'uploads', 'media');
                        if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

                        realMimeType = media.mimetype || '';
                        // Extract clean extension from mimetype
                        let ext = 'bin';
                        if (realMimeType) {
                            const mimePart = realMimeType.split('/')[1]?.split(';')[0] || 'bin';
                            // Map common mime subtypes to proper extensions
                            const extMap = { 'ogg': 'ogg', 'opus': 'ogg', 'mpeg': 'mp3', 'mp4': 'mp4', 'webm': 'webm', 'webp': 'webp', 'jpeg': 'jpg', 'png': 'png', 'gif': 'gif', 'pdf': 'pdf' };
                            ext = extMap[mimePart] || mimePart;
                        }
                        const filename = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${ext}`;
                        const filepath = path.join(mediaDir, filename);
                        fs.writeFileSync(filepath, media.data, 'base64');
                        mediaUrl = `/uploads/media/${filename}`;
                        console.log(`📎 Media saved: ${filename} (${realMimeType}, type: ${msg.type})`);
                    }
                } catch (err) {
                    console.error('Media download error:', err.message);
                }
            }

            const msgType = msg.hasMedia ? (msg.type || 'media') : 'text';

            db.prepare(`
                INSERT OR IGNORE INTO messages (conversation_id, message_id, from_me, type, body, media_url, media_mime, timestamp, status)
                VALUES (?, ?, 0, ?, ?, ?, ?, datetime('now','localtime'), 'delivered')
            `).run(conversation.id, msg.id._serialized, msgType, msg.body || '', mediaUrl, realMimeType);

            // 4. Emit to frontend
            const savedMsg = db.prepare(`SELECT * FROM messages WHERE message_id = ?`).get(msg.id._serialized);

            this.io.emit('message:new', {
                message: savedMsg,
                conversation: db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(conversation.id),
                client: db.prepare(`SELECT * FROM clients WHERE id = ?`).get(client.id)
            });

            // 5. Process bot auto-reply
            await this._processBotReply(msg, conversation, client);

        } catch (err) {
            console.error('❌ Error handling incoming message:', err);
        }
    }

    async _processBotReply(msg, conversation, client) {
        // Check if bot is enabled
        const botEnabled = db.prepare(`SELECT value FROM settings WHERE key = 'bot_enabled'`).get();
        if (!botEnabled || botEnabled.value !== 'true') return;

        // Check if client is blocked
        if (client.status === 'blocked') return;

        // Check business hours
        const isWithinHours = this._isWithinBusinessHours();

        // Get matching bot rules
        const rules = db.prepare(`SELECT * FROM bot_rules WHERE is_active = 1 ORDER BY priority DESC`).all();

        let replied = false;
        for (const rule of rules) {
            // Skip if schedule doesn't match
            if (rule.schedule_start && rule.schedule_end) {
                if (isWithinHours) continue; // Only auto-reply outside business hours
            }

            // Check only_first_message
            if (rule.only_first_message) {
                const msgCount = db.prepare(`SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ? AND from_me = 0`).get(conversation.id);
                if (msgCount.cnt > 1) continue;
            }

            let matches = false;
            const body = (msg.body || '').toLowerCase().trim();
            const trigger = (rule.trigger_value || '').toLowerCase().trim();

            switch (rule.trigger_type) {
                case 'keyword':
                    matches = body === trigger;
                    break;
                case 'contains':
                    matches = body.includes(trigger);
                    break;
                case 'regex':
                    try {
                        matches = new RegExp(trigger, 'i').test(body);
                    } catch (e) { }
                    break;
                case 'all':
                    matches = true;
                    break;
            }

            if (matches) {
                // Delay before sending
                await new Promise(r => setTimeout(r, (rule.delay_seconds || 1) * 1000));

                try {
                    if (rule.response_type === 'catalog') {
                        await this._sendCatalog(msg.from);
                    } else if (rule.response_type === 'image' && rule.media_url) {
                        const mediaPath = path.join(__dirname, 'public', rule.media_url);
                        if (fs.existsSync(mediaPath)) {
                            const media = MessageMedia.fromFilePath(mediaPath);
                            await this.client.sendMessage(msg.from, media, { caption: rule.response_text });
                        }
                    } else {
                        await this.client.sendMessage(msg.from, rule.response_text);
                    }

                    // Record bot reply in messages
                    db.prepare(`
                        INSERT INTO messages (conversation_id, message_id, from_me, type, body, timestamp, status, is_bot_reply)
                        VALUES (?, ?, 1, 'text', ?, datetime('now','localtime'), 'sent', 1)
                    `).run(conversation.id, `bot_${Date.now()}`, rule.response_text);

                    replied = true;
                    break;
                } catch (err) {
                    console.error('Bot reply error:', err.message);
                }
            }
        }

        // If no rule matched but outside business hours, send default away message
        if (!replied && !isWithinHours) {
            const awayMsg = db.prepare(`SELECT value FROM settings WHERE key = 'bot_away_message'`).get();
            if (awayMsg) {
                await new Promise(r => setTimeout(r, 2000));
                try {
                    await this.client.sendMessage(msg.from, awayMsg.value);
                    db.prepare(`
                        INSERT INTO messages (conversation_id, message_id, from_me, type, body, timestamp, status, is_bot_reply)
                        VALUES (?, ?, 1, 'text', ?, datetime('now','localtime'), 'sent', 1)
                    `).run(conversation.id, `bot_away_${Date.now()}`, awayMsg.value);
                } catch (err) {
                    console.error('Away message error:', err.message);
                }
            }
        }
    }

    _isWithinBusinessHours() {
        const now = new Date();
        const day = now.getDay(); // 0=Sunday
        const time = now.getHours() * 100 + now.getMinutes();

        const daysRow = db.prepare(`SELECT value FROM settings WHERE key = 'business_days'`).get();
        const startRow = db.prepare(`SELECT value FROM settings WHERE key = 'business_hours_start'`).get();
        const endRow = db.prepare(`SELECT value FROM settings WHERE key = 'business_hours_end'`).get();

        const days = daysRow ? JSON.parse(daysRow.value) : [1, 2, 3, 4, 5];
        const start = startRow ? parseInt(startRow.value.replace(':', '')) : 900;
        const end = endRow ? parseInt(endRow.value.replace(':', '')) : 1800;

        return days.includes(day) && time >= start && time <= end;
    }

    async sendMessage(chatId, message, options = {}) {
        if (!this.isReady) throw new Error('WhatsApp not connected');

        let sentMsg;
        if (options.media) {
            const media = MessageMedia.fromFilePath(options.media);
            sentMsg = await this.client.sendMessage(chatId, media, { caption: message });
        } else {
            sentMsg = await this.client.sendMessage(chatId, message);
        }

        // Save to DB (skip if caller handles it, e.g. send-media endpoint)
        if (!options.skipDB) {
            const conversation = db.prepare(`SELECT * FROM conversations WHERE chat_id = ?`).get(chatId);
            if (conversation) {
                db.prepare(`
                    INSERT INTO messages (conversation_id, message_id, from_me, type, body, media_url, timestamp, status)
                    VALUES (?, ?, 1, ?, ?, ?, datetime('now','localtime'), 'sent')
                `).run(
                    conversation.id,
                    sentMsg.id._serialized,
                    options.media ? 'image' : 'text',
                    message,
                    options.media ? options.media : ''
                );

                db.prepare(`
                    UPDATE conversations SET last_message = ?, last_message_at = datetime('now','localtime'), updated_at = datetime('now','localtime')
                    WHERE id = ?
                `).run((message || '').substring(0, 200), conversation.id);
            }
        }

        return sentMsg;
    }

    async _sendCatalog(chatId) {
        const products = db.prepare(`SELECT * FROM products WHERE is_active = 1 ORDER BY category, name`).all();
        if (products.length === 0) return;

        const header = db.prepare(`SELECT value FROM settings WHERE key = 'catalog_header'`).get();
        const footer = db.prepare(`SELECT value FROM settings WHERE key = 'catalog_footer'`).get();

        let catalogText = (header?.value || '📋 *CATÁLOGO*') + '\n\n';

        let currentCat = '';
        products.forEach((p, i) => {
            if (p.category !== currentCat) {
                currentCat = p.category;
                catalogText += `\n📂 *${currentCat || 'General'}*\n`;
            }
            const price = p.price ? `$${Number(p.price).toLocaleString('es-CL')}` : 'Consultar';
            catalogText += `${i + 1}. ${p.name} - ${price}\n`;
        });

        catalogText += '\n' + (footer?.value || '');

        await this.client.sendMessage(chatId, catalogText);
    }

    async sendCatalogProduct(chatId, productId) {
        if (!this.isReady) throw new Error('WhatsApp not connected');

        const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(productId);
        if (!product) throw new Error('Product not found');

        let message = `🏷️ *${product.name}*\n\n`;
        if (product.description) message += `📝 ${product.description}\n\n`;
        if (product.price) message += `💰 Precio: $${Number(product.price).toLocaleString('es-CL')} ${product.currency}\n`;
        if (product.sku) message += `📦 SKU: ${product.sku}\n`;
        if (product.stock > 0) message += `✅ Stock disponible: ${product.stock} unidades\n`;
        else message += `⚠️ Consultar disponibilidad\n`;

        if (product.image_url) {
            const imgPath = path.join(__dirname, 'public', product.image_url);
            if (fs.existsSync(imgPath)) {
                const media = MessageMedia.fromFilePath(imgPath);
                await this.client.sendMessage(chatId, media, { caption: message });
                return;
            }
        }

        await this.client.sendMessage(chatId, message);
    }

    async broadcastMessage(clientIds, message, options = {}) {
        if (!this.isReady) throw new Error('WhatsApp not connected');

        const results = { sent: 0, failed: 0, errors: [] };

        for (const clientId of clientIds) {
            const client = db.prepare(`SELECT * FROM clients WHERE id = ? AND status = 'active'`).get(clientId);
            if (!client) {
                results.failed++;
                results.errors.push({ clientId, error: 'Client not found or inactive' });
                continue;
            }

            try {
                const chatId = client.phone + '@c.us';

                if (options.media) {
                    const media = MessageMedia.fromFilePath(options.media);
                    await this.client.sendMessage(chatId, media, { caption: message });
                } else {
                    await this.client.sendMessage(chatId, message);
                }

                results.sent++;

                // Random delay between 2-5 seconds to avoid rate limiting
                await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
            } catch (err) {
                results.failed++;
                results.errors.push({ clientId, error: err.message });
            }
        }

        return results;
    }

    async logout() {
        try {
            if (this.client) {
                await this.client.logout();
                this.isReady = false;
                this.connectionStatus = 'disconnected';
                this.io.emit('wa:status', { status: 'disconnected' });
            }
        } catch (err) {
            console.error('Logout error:', err);
        }
    }

    async restart() {
        console.log('🔄 Restarting WhatsApp connection...');
        this.io.emit('wa:status', { status: 'restarting' });
        try {
            if (this.client) {
                this.isReady = false;
                this.connectionStatus = 'restarting';
                try {
                    await this.client.destroy();
                } catch (e) {
                    console.log('⚠ Client destroy warning:', e.message);
                }
                this.client = null;
            }
            // Wait a moment before reinitializing
            await new Promise(resolve => setTimeout(resolve, 2000));
            await this.initialize();
            console.log('✅ WhatsApp restart complete');
        } catch (err) {
            console.error('❌ Restart error:', err);
            this.connectionStatus = 'error';
            this.io.emit('wa:status', { status: 'error', message: err.message });
        }
    }

    getStatus() {
        return {
            status: this.connectionStatus,
            isReady: this.isReady,
            qr: this.qrCode,
            info: this.info ? {
                pushname: this.info.pushname || '',
                phone: this.info.wid?.user || '',
                platform: this.info.platform || ''
            } : null
        };
    }
}

module.exports = WhatsAppManager;
