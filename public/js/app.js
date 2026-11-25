/* ═══════════════════════════════════════════════════════════════════════════
   WhatsApp CRM - ROTAR | Main Application
   ═══════════════════════════════════════════════════════════════════════════ */

const API = {
    get: (url) => fetch(url).then(r => r.json()),
    post: (url, data) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
    put: (url, data) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
    del: (url) => fetch(url, { method: 'DELETE' }).then(r => r.json()),
};

// ─── State ──────────────────────────────────────────────────────────────────
const state = {
    currentView: 'dashboard',
    activeConversation: null,
    conversations: [],
    clients: [],
    messages: [],
    products: [],
    tasks: [],
    campaigns: [],
    botRules: [],
    quickReplies: [],
    settings: {},
    waStatus: 'disconnected',
    convFilter: 'all',
    clientFilter: 'all',
    taskFilter: 'all',
};

// ─── Socket.IO ──────────────────────────────────────────────────────────────
const socket = io();

socket.on('wa:status', (data) => {
    state.waStatus = data.status;
    updateConnectionUI(data);
});

socket.on('wa:qr', (data) => {
    const img = document.getElementById('qr-image');
    const placeholder = document.getElementById('qr-placeholder');
    const connected = document.getElementById('qr-connected');
    if (img && data.qr) {
        img.src = data.qr;
        img.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
        if (connected) connected.style.display = 'none';
    }
});

socket.on('message:new', (data) => {
    if (state.currentView === 'chats') loadConversations();
    if (state.activeConversation && data.conversation.id === state.activeConversation.id) {
        loadMessages(state.activeConversation.id);
    }
    if (!data.message.from_me) {
        showToast('info', 'Nuevo mensaje', `${data.client.push_name || data.client.phone}: ${data.message.body?.substring(0, 50) || '[Media]'}`);
    }
    loadDashboard();
});

socket.on('message:ack', (data) => {
    const el = document.querySelector(`[data-msg-id="${data.messageId}"] .message-status`);
    if (el) {
        const icons = { sent: '✓', delivered: '✓✓', read: '✓✓' };
        el.textContent = icons[data.status] || '✓';
        if (data.status === 'read') el.style.color = '#53bdeb';
    }
});

socket.on('task:reminder', (task) => {
    showToast('warning', '⏰ Recordatorio', task.title);
});

socket.on('campaign:progress', (data) => {
    const bar = document.querySelector(`[data-campaign="${data.campaignId}"] .campaign-progress-bar`);
    if (bar) bar.style.width = `${(data.sent / data.total) * 100}%`;
});

socket.on('campaign:complete', (data) => {
    showToast('success', 'Campaña completada', `Enviados: ${data.sent} | Fallidos: ${data.failed}`);
    if (state.currentView === 'campaigns') loadCampaigns();
});

// ─── Connection UI ──────────────────────────────────────────────────────────
function updateConnectionUI(data) {
    const el = document.getElementById('connection-status');
    const statusText = document.querySelector('.status-text');
    const waInfo = document.getElementById('wa-info');
    const qrPlaceholder = document.getElementById('qr-placeholder');
    const qrConnected = document.getElementById('qr-connected');
    const qrImage = document.getElementById('qr-image');

    el.className = 'connection-status ' + data.status;
    const labels = { connected: 'Conectado', disconnected: 'Desconectado', connecting: 'Conectando...', qr: 'Escanea QR', authenticated: 'Autenticado', error: 'Error', auth_failure: 'Fallo Auth' };
    statusText.textContent = labels[data.status] || data.status;

    if (data.status === 'connected' && data.info) {
        waInfo.style.display = 'flex';
        document.getElementById('wa-name').textContent = data.info.pushname || '-';
        document.getElementById('wa-phone').textContent = data.info.phone || '-';
        if (qrPlaceholder) qrPlaceholder.style.display = 'none';
        if (qrImage) qrImage.style.display = 'none';
        if (qrConnected) {
            qrConnected.style.display = 'block';
            document.getElementById('connected-info').textContent = `${data.info.pushname} (${data.info.phone})`;
        }
    } else if (data.status === 'disconnected') {
        waInfo.style.display = 'none';
        if (qrPlaceholder) qrPlaceholder.style.display = 'flex';
        if (qrConnected) qrConnected.style.display = 'none';
        if (qrImage) qrImage.style.display = 'none';
    }
}

// ─── Toast ──────────────────────────────────────────────────────────────────
function showToast(type, title, message) {
    const container = document.getElementById('toast-container');
    const icons = { success: 'check_circle', error: 'error', info: 'info', warning: 'warning' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="material-icons-round">${icons[type]}</span><div class="toast-content"><div class="toast-title">${title}</div><div class="toast-message">${message}</div></div>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('removing'); setTimeout(() => toast.remove(), 300); }, 4000);
}

// ─── Modal ──────────────────────────────────────────────────────────────────
function showModal(title, bodyHTML, footerHTML) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHTML;
    document.getElementById('modal-footer').innerHTML = footerHTML || '';
    document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() { document.getElementById('modal-overlay').style.display = 'none'; }

// ─── Navigation ─────────────────────────────────────────────────────────────
function navigateTo(view) {
    state.currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`view-${view}`)?.classList.add('active');
    document.querySelector(`[data-view="${view}"]`)?.classList.add('active');

    const loaders = { dashboard: loadDashboard, chats: loadConversations, clients: loadClients, bot: loadBotRules, tasks: loadTasks, catalog: loadProducts, campaigns: loadCampaigns, settings: loadSettings };
    if (loaders[view]) loaders[view]();
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
async function loadDashboard() {
    try {
        const stats = await API.get('/api/dashboard/stats');
        const grid = document.getElementById('dashboard-grid');
        grid.innerHTML = [
            cardHTML('forum', 'green', stats.activeConversations, 'Chats Activos'),
            cardHTML('mark_email_unread', 'red', stats.unreadMessages, 'Sin Leer'),
            cardHTML('chat', 'blue', stats.todayMessages, 'Mensajes Hoy'),
            cardHTML('people', 'purple', stats.totalClients, 'Clientes Total'),
            cardHTML('person_off', 'orange', stats.archivedClients, 'Archivados'),
            cardHTML('task_alt', 'teal', stats.pendingTasks, 'Tareas Pendientes'),
            cardHTML('inventory_2', 'blue', stats.totalProducts, 'Productos'),
            cardHTML('smart_toy', 'green', stats.botRules, 'Reglas Bot'),
            cardHTML('campaign', 'purple', stats.activeCampaigns, 'Campañas Activas'),
            cardHTML('message', 'teal', stats.totalMessages, 'Mensajes Total'),
        ].join('');
        // Update badges
        if (stats.unreadMessages > 0) { const b = document.getElementById('unread-badge'); b.style.display = 'block'; b.textContent = stats.unreadMessages; }
        else document.getElementById('unread-badge').style.display = 'none';
        if (stats.pendingTasks > 0) { const b = document.getElementById('tasks-badge'); b.style.display = 'block'; b.textContent = stats.pendingTasks; }
        else document.getElementById('tasks-badge').style.display = 'none';
    } catch (e) { console.error('Dashboard error:', e); }
}

function cardHTML(icon, color, value, label) {
    return `<div class="stat-card"><div class="stat-icon ${color}"><span class="material-icons-round">${icon}</span></div><div class="stat-info"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div></div>`;
}

// ─── Conversations ──────────────────────────────────────────────────────────
async function loadConversations() {
    try {
        const search = document.getElementById('search-conversations')?.value || '';
        const status = state.convFilter === 'all' ? '' : state.convFilter;
        const data = await API.get(`/api/conversations?status=${status}&search=${encodeURIComponent(search)}&limit=100`);
        state.conversations = data.items;
        renderConversations();
    } catch (e) { console.error('Conv error:', e); }
}

function renderConversations() {
    const list = document.getElementById('conversations-list');
    if (!state.conversations.length) {
        list.innerHTML = '<div class="empty-state"><span class="material-icons-round">forum</span><h3>Sin conversaciones</h3><p>Los chats aparecerán aquí cuando recibas mensajes</p></div>';
        return;
    }
    list.innerHTML = state.conversations.map(c => {
        const name = c.client_name || c.push_name || c.client_phone;
        const initials = getInitials(name);
        const time = c.last_message_at ? formatTime(c.last_message_at) : '';
        const isActive = state.activeConversation?.id === c.id;
        const priorityDot = (c.priority === 'urgent' || c.priority === 'high') ? `<div class="conv-priority-dot ${c.priority}"></div>` : '';
        const unread = c.unread_count > 0 ? `<div class="conv-unread">${c.unread_count}</div>` : '';
        const deleteBtn = `<button class="conv-delete-btn" onclick="event.stopPropagation(); deleteConversation(${c.id}, '${escHTML(name)}')" title="Eliminar chat"><span class="material-icons-round">delete</span></button>`;
        return `<div class="conversation-item ${isActive ? 'active' : ''}" data-id="${c.id}" onclick="openConversation(${c.id})">${priorityDot}<div class="conv-avatar">${initials}</div><div class="conv-content"><div class="conv-header"><span class="conv-name">${escHTML(name)}</span><span class="conv-time">${time}</span></div><div class="conv-preview">${escHTML(c.last_message || '')}</div></div>${deleteBtn}${unread}</div>`;
    }).join('');
}

async function openConversation(id) {
    try {
        const conv = await API.get(`/api/conversations/${id}`);
        state.activeConversation = conv;
        document.getElementById('chat-empty').style.display = 'none';
        document.getElementById('chat-active').style.display = 'flex';
        const name = conv.client_name || conv.push_name || conv.client_phone;
        document.getElementById('chat-contact-name').textContent = name;
        document.getElementById('chat-contact-phone').textContent = conv.client_phone;
        document.getElementById('chat-avatar').textContent = getInitials(name);
        // Mark as read
        API.put(`/api/conversations/${id}/read`);
        await loadMessages(id);
        renderConversations();
        loadQuickRepliesBar();
    } catch (e) { console.error(e); }
}

async function loadMessages(convId) {
    try {
        const data = await API.get(`/api/messages/${convId}?limit=200`);
        state.messages = data.items;
        renderMessages();
    } catch (e) { console.error(e); }
}

function renderMessages() {
    const container = document.getElementById('chat-messages');
    if (!state.messages.length) { container.innerHTML = '<div class="empty-state"><span class="material-icons-round">chat</span><h3>Sin mensajes</h3></div>'; return; }
    let html = '';
    let lastDate = '';
    state.messages.forEach(m => {
        const date = m.timestamp?.split(' ')[0] || '';
        if (date !== lastDate) { lastDate = date; html += `<div class="date-divider"><span>${formatDate(date)}</span></div>`; }
        const cls = m.from_me ? 'outbound' : 'inbound';
        const botCls = m.is_bot_reply ? ' bot' : '';
        const time = m.timestamp?.split(' ')[1]?.substring(0, 5) || '';
        const statusIcon = m.from_me ? `<span class="message-status">${m.status === 'read' ? '✓✓' : m.status === 'delivered' ? '✓✓' : '✓'}</span>` : '';
        let mediaHTML = '';
        if (m.media_url) {
            mediaHTML = buildMediaHTML(m);
        }
        const bodyText = m.body || '';
        // Don't show body text if it's a media-only message (voice, sticker, or if body is empty)
        const isMediaOnly = (m.type === 'ptt' || m.type === 'sticker') && !bodyText;
        const botLabel = m.is_bot_reply ? '<span style="font-size:0.68rem;color:var(--accent);font-weight:600;">🤖 Bot</span> ' : '';
        const bodyHTML = (!isMediaOnly && bodyText) ? `<div class="message-text">${botLabel}${escHTML(bodyText)}</div>` : (botLabel && !isMediaOnly ? `<div class="message-text">${botLabel}</div>` : '');
        html += `<div class="message-bubble ${cls}${botCls}" data-msg-id="${m.message_id}">${mediaHTML}${bodyHTML}<div class="message-meta"><span>${time}</span>${statusIcon}</div></div>`;
    });
    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
}

function buildMediaHTML(m) {
    const type = (m.type || '').toLowerCase();
    const mime = (m.media_mime || '').toLowerCase();
    const url = m.media_url;

    // ── Voice messages (PTT) & Audio ──
    if (type === 'ptt' || type === 'audio' || mime.startsWith('audio/')) {
        const isVoice = type === 'ptt';
        return `<div class="message-media media-audio ${isVoice ? 'voice-note' : ''}">
            <div class="audio-player">
                <button class="audio-play-btn" onclick="toggleAudio(this)" title="Reproducir">
                    <span class="material-icons-round">play_arrow</span>
                </button>
                <div class="audio-waveform">
                    <div class="audio-progress-bar"><div class="audio-progress-fill"></div></div>
                    <span class="audio-time">0:00</span>
                </div>
                ${isVoice ? '<span class="material-icons-round voice-icon">mic</span>' : '<span class="material-icons-round voice-icon">headphones</span>'}
            </div>
            <audio preload="metadata" src="${url}" onloadedmetadata="updateAudioDuration(this)"></audio>
        </div>`;
    }

    // ── Video ──
    if (type === 'video' || mime.startsWith('video/')) {
        return `<div class="message-media media-video">
            <video src="${url}" controls preload="metadata" playsinline></video>
        </div>`;
    }

    // ── Sticker ──
    if (type === 'sticker') {
        const isAnimated = mime.includes('webp');
        return `<div class="message-media media-sticker">
            <img src="${url}" alt="sticker" loading="lazy" class="sticker-img ${isAnimated ? 'animated' : ''}" />
        </div>`;
    }

    // ── Document / File ──
    if (type === 'document' || mime.includes('pdf') || mime.includes('msword') || mime.includes('spreadsheet') || mime.includes('zip') || mime.includes('octet-stream')) {
        const ext = url.split('.').pop()?.toUpperCase() || 'FILE';
        const fileName = url.split('/').pop() || 'Archivo';
        return `<div class="message-media media-document">
            <a href="${url}" target="_blank" download class="document-link">
                <div class="document-icon"><span class="material-icons-round">description</span><span class="document-ext">${ext}</span></div>
                <div class="document-info">
                    <span class="document-name">${escHTML(m.body || fileName)}</span>
                    <span class="document-action">Descargar archivo</span>
                </div>
                <span class="material-icons-round download-icon">download</span>
            </a>
        </div>`;
    }

    // ── Image (default for image type or unknown media with URL) ──
    return `<div class="message-media media-image">
        <img src="${url}" alt="media" loading="lazy" onclick="openImageViewer('${url}')" />
    </div>`;
}

// ── Audio Player Controls ──
function toggleAudio(btn) {
    const container = btn.closest('.message-media');
    const audio = container.querySelector('audio');
    const icon = btn.querySelector('.material-icons-round');
    const progressFill = container.querySelector('.audio-progress-fill');
    const timeEl = container.querySelector('.audio-time');

    if (audio.paused) {
        // Pause all other audios first
        document.querySelectorAll('.message-media audio').forEach(a => { if (a !== audio) { a.pause(); a.currentTime = 0; } });
        document.querySelectorAll('.audio-play-btn .material-icons-round').forEach(i => i.textContent = 'play_arrow');

        audio.play();
        icon.textContent = 'pause';

        audio.ontimeupdate = () => {
            const pct = (audio.currentTime / audio.duration) * 100;
            progressFill.style.width = pct + '%';
            timeEl.textContent = formatAudioTime(audio.currentTime);
        };
        audio.onended = () => {
            icon.textContent = 'play_arrow';
            progressFill.style.width = '0%';
            timeEl.textContent = formatAudioTime(audio.duration);
        };
    } else {
        audio.pause();
        icon.textContent = 'play_arrow';
    }
}

function updateAudioDuration(audio) {
    const container = audio.closest('.message-media');
    const timeEl = container.querySelector('.audio-time');
    if (audio.duration && isFinite(audio.duration)) {
        timeEl.textContent = formatAudioTime(audio.duration);
    }
}

function formatAudioTime(seconds) {
    if (!seconds || !isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Image Viewer ──
function openImageViewer(url) {
    showModal('Imagen', `<div style="text-align:center;"><img src="${url}" style="max-width:100%;max-height:70vh;border-radius:8px;" /></div>`,
        `<a href="${url}" download class="btn btn-primary"><span class="material-icons-round">download</span> Descargar</a><button class="btn btn-secondary" onclick="closeModal()">Cerrar</button>`);
}

async function sendMessage() {
    const input = document.getElementById('message-input');
    const msg = input.value.trim();
    const fileInput = document.getElementById('file-input');
    const file = fileInput.files[0];

    if (!msg && !file) return;
    if (!state.activeConversation) return;

    input.value = '';
    input.style.height = 'auto';

    try {
        if (file) {
            // Send with media using FormData
            const formData = new FormData();
            formData.append('file', file);
            formData.append('chatId', state.activeConversation.chat_id);
            if (msg) formData.append('caption', msg);

            const res = await fetch('/api/messages/send-media', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al enviar archivo');

            // Clear attachment
            clearAttachment();
            showToast('success', 'Archivo enviado', file.name);
        } else {
            // Send text only
            await API.post('/api/messages/send', { chatId: state.activeConversation.chat_id, message: msg });
        }
        await loadMessages(state.activeConversation.id);
        loadConversations();
    } catch (e) {
        showToast('error', 'Error', e.message || 'No se pudo enviar');
    }
}

// ─── Attachment Handling ─────────────────────────────────────────────────────
function handleFileSelect(file) {
    if (!file) return;
    // 16MB limit
    if (file.size > 16 * 1024 * 1024) {
        showToast('error', 'Archivo muy grande', 'Máximo 16MB');
        return;
    }

    const preview = document.getElementById('attachment-preview');
    const content = document.getElementById('attachment-preview-content');
    const mime = file.type || '';
    const name = file.name;
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);

    if (mime.startsWith('image/')) {
        // Image thumbnail preview
        const reader = new FileReader();
        reader.onload = (e) => {
            content.innerHTML = `
                <img src="${e.target.result}" class="attach-thumb" alt="preview" />
                <div class="attach-info">
                    <span class="attach-name">${escHTML(name)}</span>
                    <span class="attach-size">${sizeMB} MB</span>
                </div>`;
        };
        reader.readAsDataURL(file);
    } else if (mime.startsWith('video/')) {
        content.innerHTML = `
            <div class="attach-icon video"><span class="material-icons-round">videocam</span></div>
            <div class="attach-info">
                <span class="attach-name">${escHTML(name)}</span>
                <span class="attach-size">${sizeMB} MB · Video</span>
            </div>`;
    } else if (mime.startsWith('audio/')) {
        content.innerHTML = `
            <div class="attach-icon audio"><span class="material-icons-round">headphones</span></div>
            <div class="attach-info">
                <span class="attach-name">${escHTML(name)}</span>
                <span class="attach-size">${sizeMB} MB · Audio</span>
            </div>`;
    } else {
        // Document
        const extMatch = name.match(/\.(\w+)$/);
        const ext = extMatch ? extMatch[1].toUpperCase() : 'FILE';
        content.innerHTML = `
            <div class="attach-icon doc"><span class="attach-ext">${ext}</span></div>
            <div class="attach-info">
                <span class="attach-name">${escHTML(name)}</span>
                <span class="attach-size">${sizeMB} MB · Documento</span>
            </div>`;
    }

    preview.style.display = 'flex';
}

function clearAttachment() {
    document.getElementById('file-input').value = '';
    document.getElementById('attachment-preview').style.display = 'none';
    document.getElementById('attachment-preview-content').innerHTML = '';
}

// ─── Quick Replies Bar ──────────────────────────────────────────────────────
async function loadQuickRepliesBar() {
    try {
        const replies = await API.get('/api/quick-replies');
        const bar = document.getElementById('quick-replies-bar');
        if (replies.length) {
            bar.style.display = 'flex';
            bar.innerHTML = replies.map(r => `<div class="quick-reply-chip" onclick="insertQuickReply('${escHTML(r.content.replace(/'/g, "\\'"))}')">${r.shortcut}</div>`).join('');
        } else bar.style.display = 'none';
    } catch (e) { }
}

function insertQuickReply(text) {
    document.getElementById('message-input').value = text.replace(/\\n/g, '\n');
    document.getElementById('message-input').focus();
}

// ─── Clients ────────────────────────────────────────────────────────────────
async function loadClients() {
    try {
        const search = document.getElementById('search-clients')?.value || '';
        const status = state.clientFilter === 'all' ? '' : state.clientFilter;
        const data = await API.get(`/api/clients?status=${status}&search=${encodeURIComponent(search)}&limit=100`);
        state.clients = data.items;
        renderClients();
    } catch (e) { console.error(e); }
}

function renderClients() {
    const grid = document.getElementById('clients-grid');
    if (!state.clients.length) { grid.innerHTML = '<div class="empty-state"><span class="material-icons-round">people</span><h3>Sin clientes</h3><p>Los clientes aparecerán aquí cuando te escriban</p></div>'; return; }
    grid.innerHTML = state.clients.map(c => {
        const name = c.name || c.push_name || c.phone;
        return `<div class="client-card ${c.status}" onclick="showClientModal(${c.id})"><div class="client-avatar">${getInitials(name)}</div><div class="client-details"><div class="client-name">${escHTML(name)}</div><div class="client-phone">${c.phone}</div>${c.company ? `<div class="client-company">${escHTML(c.company)}</div>` : ''}<span class="client-status-badge ${c.status}">${c.status === 'active' ? 'Activo' : c.status === 'archived' ? 'Archivado' : 'Bloqueado'}</span></div></div>`;
    }).join('');
}

async function showClientModal(id) {
    const c = await API.get(`/api/clients/${id}`);
    const name = c.name || c.push_name || c.phone;
    showModal('Editar Cliente', `
        <div class="form-group"><label>Nombre</label><input id="edit-client-name" value="${escHTML(name)}" /></div>
        <div class="form-group"><label>Email</label><input id="edit-client-email" value="${escHTML(c.email || '')}" /></div>
        <div class="form-group"><label>Empresa</label><input id="edit-client-company" value="${escHTML(c.company || '')}" /></div>
        <div class="form-group"><label>Notas</label><textarea id="edit-client-notes" rows="3">${escHTML(c.notes || '')}</textarea></div>
        <div class="form-group"><label>Estado</label><select id="edit-client-status"><option value="active" ${c.status === 'active' ? 'selected' : ''}>Activo</option><option value="archived" ${c.status === 'archived' ? 'selected' : ''}>Archivado</option><option value="blocked" ${c.status === 'blocked' ? 'selected' : ''}>Bloqueado</option></select></div>`,
        `<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveClient(${id})">Guardar</button>`
    );
}

async function saveClient(id) {
    await API.put(`/api/clients/${id}`, { name: document.getElementById('edit-client-name').value, email: document.getElementById('edit-client-email').value, company: document.getElementById('edit-client-company').value, notes: document.getElementById('edit-client-notes').value, status: document.getElementById('edit-client-status').value });
    closeModal(); showToast('success', 'Cliente actualizado', ''); loadClients();
}

// ─── Bot Rules ──────────────────────────────────────────────────────────────
async function loadBotRules() {
    try {
        state.botRules = await API.get('/api/bot/rules');
        const settings = await API.get('/api/settings');
        document.getElementById('bot-enabled-toggle').checked = settings.bot_enabled;
        renderBotRules();
    } catch (e) { console.error(e); }
}

function renderBotRules() {
    const list = document.getElementById('bot-rules-list');
    if (!state.botRules.length) { list.innerHTML = '<div class="empty-state"><span class="material-icons-round">smart_toy</span><h3>Sin reglas</h3><p>Agrega reglas para que el bot responda automáticamente</p></div>'; return; }
    list.innerHTML = state.botRules.map(r => `
        <div class="bot-rule-card ${r.is_active ? '' : 'inactive'}">
            <div class="rule-header"><div class="rule-name"><span class="material-icons-round">${r.trigger_type === 'all' ? 'all_inclusive' : 'label'}</span> ${escHTML(r.name)}</div>
            <div class="rule-actions"><button class="btn btn-icon" onclick="showRuleModal(${r.id})" title="Editar"><span class="material-icons-round">edit</span></button><button class="btn btn-icon" onclick="deleteRule(${r.id})" title="Eliminar"><span class="material-icons-round">delete</span></button></div></div>
            <div class="rule-details"><div class="rule-detail"><span class="rule-detail-label">Trigger</span><span class="rule-detail-value">${r.trigger_type}: ${escHTML(r.trigger_value || '*')}</span></div><div class="rule-detail"><span class="rule-detail-label">Tipo</span><span class="rule-detail-value">${r.response_type}</span></div><div class="rule-detail"><span class="rule-detail-label">Delay</span><span class="rule-detail-value">${r.delay_seconds}s</span></div><div class="rule-detail"><span class="rule-detail-label">Estado</span><span class="rule-detail-value">${r.is_active ? '✅ Activa' : '❌ Inactiva'}</span></div></div>
            <div class="rule-response">${escHTML(r.response_text)}</div>
        </div>`).join('');
}

function showRuleModal(id = null) {
    const r = id ? state.botRules.find(x => x.id === id) : {};
    showModal(id ? 'Editar Regla' : 'Nueva Regla', `
        <div class="form-group"><label>Nombre</label><input id="rule-name" value="${escHTML(r.name || '')}" placeholder="Ej: Saludo inicial" /></div>
        <div class="form-row"><div class="form-group"><label>Tipo Trigger</label><select id="rule-trigger-type"><option value="keyword" ${r.trigger_type === 'keyword' ? 'selected' : ''}>Palabra exacta</option><option value="contains" ${r.trigger_type === 'contains' ? 'selected' : ''}>Contiene</option><option value="regex" ${r.trigger_type === 'regex' ? 'selected' : ''}>Regex</option><option value="all" ${r.trigger_type === 'all' ? 'selected' : ''}>Todos</option></select></div>
        <div class="form-group"><label>Valor Trigger</label><input id="rule-trigger-value" value="${escHTML(r.trigger_value || '')}" placeholder="hola" /></div></div>
        <div class="form-group"><label>Respuesta</label><textarea id="rule-response" rows="4" placeholder="Texto de respuesta...">${escHTML(r.response_text || '')}</textarea></div>
        <div class="form-row"><div class="form-group"><label>Delay (seg)</label><input type="number" id="rule-delay" value="${r.delay_seconds || 1}" min="0" /></div><div class="form-group"><label>Prioridad</label><input type="number" id="rule-priority" value="${r.priority || 0}" /></div></div>
        <div class="form-row"><div class="form-group"><label><input type="checkbox" id="rule-active" ${r.is_active !== 0 ? 'checked' : ''} /> Activa</label></div><div class="form-group"><label><input type="checkbox" id="rule-first-only" ${r.only_first_message ? 'checked' : ''} /> Solo primer mensaje</label></div></div>`,
        `<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveRule(${id || 'null'})">Guardar</button>`
    );
}

async function saveRule(id) {
    const data = { name: document.getElementById('rule-name').value, trigger_type: document.getElementById('rule-trigger-type').value, trigger_value: document.getElementById('rule-trigger-value').value, response_text: document.getElementById('rule-response').value, response_type: 'text', is_active: document.getElementById('rule-active').checked ? 1 : 0, delay_seconds: parseInt(document.getElementById('rule-delay').value) || 1, priority: parseInt(document.getElementById('rule-priority').value) || 0, only_first_message: document.getElementById('rule-first-only').checked ? 1 : 0 };
    if (id) await API.put(`/api/bot/rules/${id}`, data);
    else await API.post('/api/bot/rules', data);
    closeModal(); showToast('success', 'Regla guardada', ''); loadBotRules();
}

async function deleteRule(id) { if (confirm('¿Eliminar esta regla?')) { await API.del(`/api/bot/rules/${id}`); loadBotRules(); } }

// ─── Tasks ──────────────────────────────────────────────────────────────────
async function loadTasks() {
    try {
        const status = state.taskFilter === 'all' ? '' : state.taskFilter;
        const data = await API.get(`/api/tasks?status=${status}`);
        state.tasks = data.items;
        renderTasks();
    } catch (e) { console.error(e); }
}

function renderTasks() {
    const list = document.getElementById('tasks-list');
    if (!state.tasks.length) { list.innerHTML = '<div class="empty-state"><span class="material-icons-round">task_alt</span><h3>Sin tareas</h3><p>Programa tareas de seguimiento para tus clientes</p></div>'; return; }
    list.innerHTML = state.tasks.map(t => `
        <div class="task-card ${t.status === 'completed' ? 'completed' : ''}">
            <div class="task-checkbox" onclick="toggleTask(${t.id}, '${t.status}')"></div>
            <div class="task-content"><div class="task-title">${escHTML(t.title)}</div><div class="task-meta">${t.client_name ? `<span><span class="material-icons-round">person</span>${escHTML(t.client_name)}</span>` : ''}${t.due_date ? `<span><span class="material-icons-round">event</span>${formatDate(t.due_date)}</span>` : ''}</div></div>
            <span class="priority-badge ${t.priority}">${t.priority}</span>
            <button class="btn btn-icon" onclick="showTaskModal(${t.id})"><span class="material-icons-round">edit</span></button>
            <button class="btn btn-icon" onclick="deleteTask(${t.id})"><span class="material-icons-round">delete</span></button>
        </div>`).join('');
}

async function toggleTask(id, currentStatus) {
    const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
    await API.put(`/api/tasks/${id}`, { status: newStatus });
    loadTasks(); loadDashboard();
}

function showTaskModal(id = null) {
    const t = id ? state.tasks.find(x => x.id === id) : {};
    showModal(id ? 'Editar Tarea' : 'Nueva Tarea', `
        <div class="form-group"><label>Título</label><input id="task-title" value="${escHTML(t.title || '')}" placeholder="Título de la tarea" /></div>
        <div class="form-group"><label>Descripción</label><textarea id="task-desc" rows="3">${escHTML(t.description || '')}</textarea></div>
        <div class="form-row"><div class="form-group"><label>Fecha Límite</label><input type="datetime-local" id="task-due" value="${t.due_date || ''}" /></div><div class="form-group"><label>Prioridad</label><select id="task-priority"><option value="low" ${t.priority === 'low' ? 'selected' : ''}>Baja</option><option value="normal" ${t.priority === 'normal' || !t.priority ? 'selected' : ''}>Normal</option><option value="high" ${t.priority === 'high' ? 'selected' : ''}>Alta</option><option value="urgent" ${t.priority === 'urgent' ? 'selected' : ''}>Urgente</option></select></div></div>
        <div class="form-group"><label>Recordatorio</label><input type="datetime-local" id="task-reminder" value="${t.reminder_at || ''}" /></div>`,
        `<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveTask(${id || 'null'})">Guardar</button>`
    );
}

async function saveTask(id) {
    const data = { title: document.getElementById('task-title').value, description: document.getElementById('task-desc').value, due_date: document.getElementById('task-due').value || null, priority: document.getElementById('task-priority').value, reminder_at: document.getElementById('task-reminder').value || null };
    if (id) await API.put(`/api/tasks/${id}`, data);
    else await API.post('/api/tasks', data);
    closeModal(); showToast('success', 'Tarea guardada', ''); loadTasks(); loadDashboard();
}

async function deleteTask(id) { if (confirm('¿Eliminar tarea?')) { await API.del(`/api/tasks/${id}`); loadTasks(); } }

// ─── Products ───────────────────────────────────────────────────────────────
async function loadProducts() {
    try {
        const search = document.getElementById('search-products')?.value || '';
        state.products = await API.get(`/api/products?search=${encodeURIComponent(search)}`);
        renderProducts();
    } catch (e) { console.error(e); }
}

function renderProducts() {
    const grid = document.getElementById('products-grid');
    if (!state.products.length) { grid.innerHTML = '<div class="empty-state"><span class="material-icons-round">inventory_2</span><h3>Sin productos</h3><p>Agrega productos a tu catálogo para enviarlos vía WhatsApp</p></div>'; return; }
    grid.innerHTML = state.products.map(p => {
        const price = p.price ? `$${Number(p.price).toLocaleString('es-CL')}` : 'Consultar';
        const img = p.image_url ? `<img src="${p.image_url}" alt="${escHTML(p.name)}" />` : `<span class="material-icons-round">inventory_2</span>`;
        return `<div class="product-card"><div class="product-image">${img}</div><div class="product-info"><div class="product-name">${escHTML(p.name)}</div><div class="product-desc">${escHTML(p.description || '')}</div><div class="product-price">${price}</div><div class="product-meta"><span>${p.category || 'General'}</span><span>Stock: ${p.stock}</span></div></div><div class="product-actions"><button class="btn btn-secondary" onclick="showProductModal(${p.id})"><span class="material-icons-round">edit</span> Editar</button><button class="btn btn-success" onclick="sendProductToChat(${p.id})"><span class="material-icons-round">send</span> Enviar</button></div></div>`;
    }).join('');
}

function showProductModal(id = null) {
    const p = id ? state.products.find(x => x.id === id) : {};
    showModal(id ? 'Editar Producto' : 'Nuevo Producto', `
        <div class="form-group"><label>Nombre</label><input id="prod-name" value="${escHTML(p.name || '')}" /></div>
        <div class="form-group"><label>Descripción</label><textarea id="prod-desc" rows="3">${escHTML(p.description || '')}</textarea></div>
        <div class="form-row"><div class="form-group"><label>Precio</label><input type="number" id="prod-price" value="${p.price || 0}" /></div><div class="form-group"><label>SKU</label><input id="prod-sku" value="${escHTML(p.sku || '')}" /></div></div>
        <div class="form-row"><div class="form-group"><label>Categoría</label><input id="prod-cat" value="${escHTML(p.category || '')}" /></div><div class="form-group"><label>Stock</label><input type="number" id="prod-stock" value="${p.stock || 0}" /></div></div>
        <div class="form-group"><label>URL Imagen</label><input id="prod-img" value="${escHTML(p.image_url || '')}" placeholder="/uploads/products/imagen.jpg" /></div>`,
        `<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveProduct(${id || 'null'})">Guardar</button>`
    );
}

async function saveProduct(id) {
    const data = { name: document.getElementById('prod-name').value, description: document.getElementById('prod-desc').value, price: parseFloat(document.getElementById('prod-price').value) || 0, sku: document.getElementById('prod-sku').value, category: document.getElementById('prod-cat').value, stock: parseInt(document.getElementById('prod-stock').value) || 0, image_url: document.getElementById('prod-img').value };
    if (id) await API.put(`/api/products/${id}`, data);
    else await API.post('/api/products', data);
    closeModal(); showToast('success', 'Producto guardado', ''); loadProducts();
}

async function sendProductToChat(productId) {
    if (!state.activeConversation) { showToast('warning', 'Selecciona un chat', 'Abre un chat primero'); return; }
    try {
        await API.post(`/api/products/${productId}/send`, { chatId: state.activeConversation.chat_id });
        showToast('success', 'Producto enviado', '');
        loadMessages(state.activeConversation.id);
    } catch (e) { showToast('error', 'Error', e.message); }
}

// ─── Campaigns ──────────────────────────────────────────────────────────────
async function loadCampaigns() {
    try {
        state.campaigns = await API.get('/api/campaigns');
        renderCampaigns();
    } catch (e) { console.error(e); }
}

function renderCampaigns() {
    const list = document.getElementById('campaigns-list');
    if (!state.campaigns.length) { list.innerHTML = '<div class="empty-state"><span class="material-icons-round">campaign</span><h3>Sin campañas</h3><p>Crea campañas de publicidad masiva para tus clientes</p></div>'; return; }
    list.innerHTML = state.campaigns.map(c => {
        const progress = c.total_targets > 0 ? ((c.sent_count / c.total_targets) * 100) : 0;
        return `<div class="campaign-card" data-campaign="${c.id}"><div class="campaign-header"><div class="campaign-name">${escHTML(c.name)}</div><span class="campaign-status ${c.status}">${c.status}</span></div><div class="campaign-stats"><div class="campaign-stat"><span class="campaign-stat-value">${c.total_targets}</span><span class="campaign-stat-label">Destinatarios</span></div><div class="campaign-stat"><span class="campaign-stat-value" style="color:var(--primary)">${c.sent_count}</span><span class="campaign-stat-label">Enviados</span></div><div class="campaign-stat"><span class="campaign-stat-value" style="color:var(--status-urgent)">${c.failed_count}</span><span class="campaign-stat-label">Fallidos</span></div></div><div class="campaign-progress"><div class="campaign-progress-bar" style="width:${progress}%"></div></div><div class="campaign-actions">${c.status === 'draft' || c.status === 'scheduled' ? `<button class="btn btn-success" onclick="sendCampaign(${c.id})"><span class="material-icons-round">send</span> Enviar</button>` : ''}<button class="btn btn-icon" onclick="deleteCampaign(${c.id})"><span class="material-icons-round">delete</span></button></div></div>`;
    }).join('');
}

function showCampaignModal() {
    showModal('Nueva Campaña', `
        <div class="form-group"><label>Nombre</label><input id="camp-name" placeholder="Nombre de la campaña" /></div>
        <div class="form-group"><label>Mensaje</label><textarea id="camp-message" rows="4" placeholder="Mensaje a enviar..."></textarea></div>
        <div class="form-group"><label>Programar (opcional)</label><input type="datetime-local" id="camp-schedule" /></div>
        <div class="form-group"><label>Filtrar por Tags (separados por coma)</label><input id="camp-tags" placeholder="cliente, vip" /></div>`,
        `<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveCampaign()">Crear</button>`
    );
}

async function saveCampaign() {
    const tags = document.getElementById('camp-tags').value.split(',').map(t => t.trim()).filter(Boolean);
    const data = { name: document.getElementById('camp-name').value, message: document.getElementById('camp-message').value, scheduled_at: document.getElementById('camp-schedule').value || null, target_filter: JSON.stringify({ tags }) };
    const result = await API.post('/api/campaigns', data);
    closeModal(); showToast('success', 'Campaña creada', `${result.targetCount} destinatarios`); loadCampaigns();
}

async function sendCampaign(id) {
    if (!confirm('¿Enviar campaña ahora?')) return;
    try {
        const result = await API.post(`/api/campaigns/${id}/send`);
        showToast('info', 'Campaña iniciada', `Enviando a ${result.totalRecipients} contactos...`);
        loadCampaigns();
    } catch (e) { showToast('error', 'Error', e.message); }
}

async function deleteCampaign(id) { if (confirm('¿Eliminar campaña?')) { await API.del(`/api/campaigns/${id}`); loadCampaigns(); } }

// ─── Settings ───────────────────────────────────────────────────────────────
async function loadSettings() {
    try {
        state.settings = await API.get('/api/settings');
        document.getElementById('setting-hours-start').value = state.settings.business_hours_start || '09:00';
        document.getElementById('setting-hours-end').value = state.settings.business_hours_end || '18:00';
        document.getElementById('setting-greeting').value = state.settings.bot_greeting || '';
        document.getElementById('setting-away').value = state.settings.bot_away_message || '';
        const days = state.settings.business_days || [1, 2, 3, 4, 5];
        document.querySelectorAll('#days-selector input').forEach(cb => { cb.checked = days.includes(parseInt(cb.value)); });
        // Quick replies
        const replies = await API.get('/api/quick-replies');
        const container = document.getElementById('quick-replies-settings');
        container.innerHTML = replies.map(r => `<div class="quick-reply-item"><span class="shortcut">${escHTML(r.shortcut)}</span><span class="content">${escHTML(r.content)}</span><button class="btn btn-icon" onclick="deleteQuickReply(${r.id})"><span class="material-icons-round">delete</span></button></div>`).join('');
    } catch (e) { console.error(e); }
}

async function saveSettings() {
    const days = [];
    document.querySelectorAll('#days-selector input:checked').forEach(cb => days.push(parseInt(cb.value)));
    await API.put('/api/settings', { business_hours_start: document.getElementById('setting-hours-start').value, business_hours_end: document.getElementById('setting-hours-end').value, business_days: days, bot_greeting: document.getElementById('setting-greeting').value, bot_away_message: document.getElementById('setting-away').value });
    showToast('success', 'Configuración guardada', '');
}

async function deleteQuickReply(id) { await API.del(`/api/quick-replies/${id}`); loadSettings(); }

// ─── Utilities ──────────────────────────────────────────────────────────────
function escHTML(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function getInitials(name) { return (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase(); }
function formatTime(dt) { if (!dt) return ''; try { const d = new Date(dt.replace(' ', 'T')); const now = new Date(); if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }); return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }); } catch (e) { return dt; } }
function formatDate(dt) { if (!dt) return ''; try { const d = new Date(dt.replace(' ', 'T')); const now = new Date(); if (d.toDateString() === now.toDateString()) return 'Hoy'; const yest = new Date(now); yest.setDate(yest.getDate() - 1); if (d.toDateString() === yest.toDateString()) return 'Ayer'; return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'long' }); } catch (e) { return dt; } }

// ─── Event Listeners ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Hide loading, show app
    setTimeout(() => {
        document.getElementById('loading-screen').classList.add('hidden');
        document.getElementById('app').style.display = 'flex';
        loadDashboard();
    }, 1500);

    // Navigation
    document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => navigateTo(btn.dataset.view)));

    // Sidebar toggle
    document.getElementById('sidebar-toggle').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('collapsed'));

    // Send message
    document.getElementById('btn-send-message').addEventListener('click', sendMessage);
    document.getElementById('message-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });

    // Auto-resize textarea
    document.getElementById('message-input').addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 120) + 'px'; });

    // Attach file button
    document.getElementById('btn-attach')?.addEventListener('click', () => {
        document.getElementById('file-input').click();
    });

    // File input change
    document.getElementById('file-input')?.addEventListener('change', (e) => {
        if (e.target.files[0]) handleFileSelect(e.target.files[0]);
    });

    // Remove attachment
    document.getElementById('attachment-remove')?.addEventListener('click', clearAttachment);

    // Drag & drop support on chat area
    const chatMessages = document.getElementById('chat-messages');
    if (chatMessages) {
        chatMessages.addEventListener('dragover', (e) => { e.preventDefault(); chatMessages.classList.add('drag-over'); });
        chatMessages.addEventListener('dragleave', () => chatMessages.classList.remove('drag-over'));
        chatMessages.addEventListener('drop', (e) => {
            e.preventDefault();
            chatMessages.classList.remove('drag-over');
            if (e.dataTransfer.files[0] && state.activeConversation) {
                const fileInput = document.getElementById('file-input');
                fileInput.files = e.dataTransfer.files;
                handleFileSelect(e.dataTransfer.files[0]);
            }
        });
    }

    // Conversation filters
    document.querySelectorAll('.filter-tab[data-filter]').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); state.convFilter = btn.dataset.filter; loadConversations();
    }));

    // Client filters
    document.querySelectorAll('.filter-tab[data-client-filter]').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab[data-client-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); state.clientFilter = btn.dataset.clientFilter; loadClients();
    }));

    // Task filters
    document.querySelectorAll('.filter-tab[data-task-filter]').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab[data-task-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); state.taskFilter = btn.dataset.taskFilter; loadTasks();
    }));

    // Search debounce
    let searchTimeout;
    ['search-conversations', 'search-clients', 'search-products'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => { if (id.includes('conv')) loadConversations(); else if (id.includes('client')) loadClients(); else loadProducts(); }, 300); });
    });

    // Button actions
    document.getElementById('btn-add-rule')?.addEventListener('click', () => showRuleModal());
    document.getElementById('btn-add-task')?.addEventListener('click', () => showTaskModal());
    document.getElementById('btn-add-product')?.addEventListener('click', () => showProductModal());
    document.getElementById('btn-add-campaign')?.addEventListener('click', () => showCampaignModal());
    document.getElementById('btn-refresh-stats')?.addEventListener('click', loadDashboard);
    document.getElementById('btn-save-settings')?.addEventListener('click', saveSettings);
    document.getElementById('modal-close')?.addEventListener('click', closeModal);
    document.getElementById('modal-overlay')?.addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') closeModal(); });

    // Delete chat from header
    document.getElementById('btn-delete-chat')?.addEventListener('click', () => {
        if (!state.activeConversation) return;
        const name = state.activeConversation.client_name || state.activeConversation.push_name || state.activeConversation.client_phone;
        deleteConversation(state.activeConversation.id, name);
    });

    // Archive chat
    document.getElementById('btn-archive-chat')?.addEventListener('click', async () => {
        if (!state.activeConversation) return;
        await API.put(`/api/conversations/${state.activeConversation.id}`, { status: 'archived' });
        showToast('success', 'Chat archivado', ''); loadConversations();
    });

    // Create task from chat
    document.getElementById('btn-create-task')?.addEventListener('click', () => {
        if (!state.activeConversation) return;
        showTaskModal();
    });

    // Client info panel
    document.getElementById('btn-client-info')?.addEventListener('click', async () => {
        if (!state.activeConversation) return;
        const panel = document.getElementById('client-info-panel');
        panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
        if (panel.style.display !== 'none') {
            const c = await API.get(`/api/clients/${state.activeConversation.client_id || state.activeConversation.id}`);
            document.getElementById('client-info-content').innerHTML = `
                <div class="info-field"><span class="info-label">Nombre</span><div class="info-value"><input value="${escHTML(c.name || c.push_name || c.phone)}" onchange="quickUpdateClient(${c.id},'name',this.value)" /></div></div>
                <div class="info-field"><span class="info-label">Teléfono</span><div class="info-value">${c.phone}</div></div>
                <div class="info-field"><span class="info-label">Email</span><div class="info-value"><input value="${escHTML(c.email || '')}" onchange="quickUpdateClient(${c.id},'email',this.value)" /></div></div>
                <div class="info-field"><span class="info-label">Empresa</span><div class="info-value"><input value="${escHTML(c.company || '')}" onchange="quickUpdateClient(${c.id},'company',this.value)" /></div></div>
                <div class="info-field"><span class="info-label">Notas</span><div class="info-value"><textarea rows="3" onchange="quickUpdateClient(${c.id},'notes',this.value)">${escHTML(c.notes || '')}</textarea></div></div>
                <div class="info-field"><span class="info-label">Estado</span><div class="info-value"><select onchange="quickUpdateClient(${c.id},'status',this.value)"><option value="active" ${c.status === 'active' ? 'selected' : ''}>Activo</option><option value="archived" ${c.status === 'archived' ? 'selected' : ''}>Archivado</option><option value="blocked" ${c.status === 'blocked' ? 'selected' : ''}>Bloqueado</option></select></div></div>
                <div class="info-field"><span class="info-label">Registrado</span><div class="info-value">${c.created_at || '-'}</div></div>`;
        }
    });
    document.getElementById('btn-close-client-info')?.addEventListener('click', () => { document.getElementById('client-info-panel').style.display = 'none'; });

    // Bot toggle
    document.getElementById('bot-enabled-toggle')?.addEventListener('change', async (e) => {
        await API.put('/api/settings', { bot_enabled: e.target.checked });
        showToast('info', 'Bot', e.target.checked ? 'Bot activado' : 'Bot desactivado');
    });

    // Logout
    document.getElementById('btn-logout')?.addEventListener('click', async () => {
        if (confirm('¿Cerrar sesión de WhatsApp?')) {
            await API.post('/api/whatsapp/logout');
            showToast('info', 'Sesión cerrada', '');
        }
    });

    // Restart WhatsApp connection
    document.getElementById('btn-restart-wa')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-restart-wa');
        btn.classList.add('spinning');
        btn.disabled = true;
        showToast('info', 'Reiniciando WhatsApp', 'Reconectando, espere unos segundos...');
        try {
            await API.post('/api/whatsapp/restart');
        } catch (e) { /* response comes before restart completes */ }
        // Re-enable after 15 seconds regardless
        setTimeout(() => { btn.classList.remove('spinning'); btn.disabled = false; }, 15000);
    });

    // Reset Session (borrar sesión y pedir QR nuevo)
    document.getElementById('btn-reset-session')?.addEventListener('click', async () => {
        if (!confirm('⚠️ ¿Resetear sesión?\n\nEsto borrará la sesión guardada y pedirá un QR nuevo.\nUsalo cuando el QR no funciona.')) return;
        const btn = document.getElementById('btn-reset-session');
        btn.disabled = true;
        btn.textContent = 'Reseteando...';
        showToast('info', 'Reseteando sesión', 'Borrando sesión y generando nuevo QR...');
        try {
            await API.post('/api/whatsapp/reset-session');
            showToast('success', 'Sesión reseteada', 'Esperando nuevo QR en 5-10 segundos...');
            // Show QR placeholder
            const qrPlaceholder = document.getElementById('qr-placeholder');
            const qrImage = document.getElementById('qr-image');
            if (qrPlaceholder) qrPlaceholder.style.display = 'flex';
            if (qrImage) qrImage.style.display = 'none';
        } catch (e) {
            showToast('error', 'Error', e.message);
        }
        setTimeout(() => { btn.disabled = false; btn.textContent = '🗑️ Resetear Sesión'; }, 10000);
    });


    // Send catalog
    document.getElementById('btn-send-catalog')?.addEventListener('click', async () => {
        if (!state.activeConversation) return;
        try {
            await API.post('/api/messages/send', { chatId: state.activeConversation.chat_id, message: '📋 Enviando catálogo...' });
            showToast('success', 'Catálogo enviado', '');
        } catch (e) { showToast('error', 'Error', e.message); }
    });

    // Quick reply add
    document.getElementById('btn-add-quick-reply')?.addEventListener('click', () => {
        showModal('Nueva Respuesta Rápida', `
            <div class="form-group"><label>Atajo (ej: /saludo)</label><input id="qr-shortcut" placeholder="/atajo" /></div>
            <div class="form-group"><label>Título</label><input id="qr-title" placeholder="Nombre descriptivo" /></div>
            <div class="form-group"><label>Contenido</label><textarea id="qr-content" rows="3" placeholder="Texto del mensaje..."></textarea></div>`,
            `<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveQuickReply()">Guardar</button>`
        );
    });
});

async function quickUpdateClient(id, field, value) {
    const data = {}; data[field] = value;
    await API.put(`/api/clients/${id}`, data);
    showToast('success', 'Cliente actualizado', '');
}

async function saveQuickReply() {
    await API.post('/api/quick-replies', { shortcut: document.getElementById('qr-shortcut').value, title: document.getElementById('qr-title').value, content: document.getElementById('qr-content').value });
    closeModal(); showToast('success', 'Respuesta rápida creada', ''); loadSettings();
}

// ─── Delete Conversation ────────────────────────────────────────────────────
async function deleteConversation(id, name) {
    showModal('Eliminar Chat', `
        <div style="text-align:center;padding:10px 0;">
            <span class="material-icons-round" style="font-size:48px;color:var(--status-urgent);margin-bottom:12px;">delete_forever</span>
            <p style="font-size:0.95rem;margin-bottom:8px;">¿Eliminar la conversación con <strong>${escHTML(name)}</strong>?</p>
            <p style="font-size:0.82rem;color:var(--text-muted);">Se borrarán todos los mensajes y archivos. Esta acción no se puede deshacer.</p>
        </div>`,
        `<button class="btn btn-secondary" onclick="closeModal()">Cancelar</button><button class="btn btn-danger" onclick="confirmDeleteConversation(${id})"><span class="material-icons-round">delete</span> Eliminar</button>`
    );
}

async function confirmDeleteConversation(id) {
    try {
        await API.del(`/api/conversations/${id}`);
        closeModal();
        // If we deleted the active conversation, clear the chat
        if (state.activeConversation?.id === id) {
            state.activeConversation = null;
            state.messages = [];
            document.getElementById('chat-active').style.display = 'none';
            document.getElementById('chat-empty').style.display = 'flex';
        }
        showToast('success', 'Chat eliminado', 'La conversación fue borrada correctamente');
        loadConversations();
        loadDashboard();
    } catch (e) {
        showToast('error', 'Error', 'No se pudo eliminar el chat');
        console.error(e);
    }
}

// Auto-refresh conversations every 10 seconds
setInterval(() => { if (state.currentView === 'chats') loadConversations(); }, 10000);
