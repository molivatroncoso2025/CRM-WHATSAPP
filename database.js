const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'whatsapp_crm.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
    -- Clients / Contacts
    CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT UNIQUE NOT NULL,
        name TEXT DEFAULT '',
        push_name TEXT DEFAULT '',
        email TEXT DEFAULT '',
        company TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        tags TEXT DEFAULT '[]',
        status TEXT DEFAULT 'active' CHECK(status IN ('active','archived','blocked')),
        last_message_at TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- Conversations
    CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        chat_id TEXT UNIQUE NOT NULL,
        is_group INTEGER DEFAULT 0,
        group_name TEXT DEFAULT '',
        unread_count INTEGER DEFAULT 0,
        last_message TEXT DEFAULT '',
        last_message_at TEXT,
        status TEXT DEFAULT 'active' CHECK(status IN ('active','archived','pending')),
        assigned_to TEXT DEFAULT '',
        priority TEXT DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    -- Messages
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        message_id TEXT UNIQUE,
        from_me INTEGER DEFAULT 0,
        type TEXT DEFAULT 'text',
        body TEXT DEFAULT '',
        media_url TEXT DEFAULT '',
        media_mime TEXT DEFAULT '',
        timestamp TEXT NOT NULL,
        status TEXT DEFAULT 'sent' CHECK(status IN ('pending','sent','delivered','read','failed')),
        is_bot_reply INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    -- Bot Auto-Reply Rules
    CREATE TABLE IF NOT EXISTS bot_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        trigger_type TEXT DEFAULT 'keyword' CHECK(trigger_type IN ('keyword','contains','regex','all')),
        trigger_value TEXT DEFAULT '',
        response_text TEXT NOT NULL,
        response_type TEXT DEFAULT 'text' CHECK(response_type IN ('text','image','catalog','menu')),
        media_url TEXT DEFAULT '',
        is_active INTEGER DEFAULT 1,
        priority INTEGER DEFAULT 0,
        delay_seconds INTEGER DEFAULT 1,
        only_first_message INTEGER DEFAULT 0,
        schedule_start TEXT DEFAULT '',
        schedule_end TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- Scheduled Tasks
    CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        client_id INTEGER,
        conversation_id INTEGER,
        due_date TEXT,
        reminder_at TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','cancelled')),
        priority TEXT DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (client_id) REFERENCES clients(id),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    -- Product Catalog
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        price REAL DEFAULT 0,
        currency TEXT DEFAULT 'CLP',
        sku TEXT DEFAULT '',
        category TEXT DEFAULT '',
        image_url TEXT DEFAULT '',
        stock INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- Product Categories
    CREATE TABLE IF NOT EXISTS product_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT DEFAULT '',
        icon TEXT DEFAULT '📦',
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- Broadcast Campaigns (Publicidad)
    CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        message TEXT NOT NULL,
        media_url TEXT DEFAULT '',
        target_filter TEXT DEFAULT '{}',
        status TEXT DEFAULT 'draft' CHECK(status IN ('draft','scheduled','sending','completed','cancelled')),
        scheduled_at TEXT,
        sent_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        total_targets INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- Campaign Recipients
    CREATE TABLE IF NOT EXISTS campaign_recipients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER NOT NULL,
        client_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','sent','delivered','failed')),
        sent_at TEXT,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
        FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    -- Quick Replies
    CREATE TABLE IF NOT EXISTS quick_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shortcut TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        use_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- System Settings
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        type TEXT DEFAULT 'string',
        updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
    CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
    CREATE INDEX IF NOT EXISTS idx_conversations_chat_id ON conversations(chat_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
`);

// ─── Insert Default Settings ───────────────────────────────────────────────────

const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value, type) VALUES (?, ?, ?)
`);

const defaults = [
    ['bot_enabled', 'true', 'boolean'],
    ['bot_greeting', '¡Hola! 👋 Gracias por contactarnos. En este momento no estamos disponibles, pero te responderemos a la brevedad.', 'string'],
    ['bot_away_message', 'Estamos fuera de horario. Nuestro horario de atención es de Lunes a Viernes de 9:00 a 18:00. Te responderemos lo antes posible.', 'string'],
    ['business_hours_start', '09:00', 'string'],
    ['business_hours_end', '18:00', 'string'],
    ['business_days', '[1,2,3,4,5]', 'json'],
    ['company_name', 'ROTAR', 'string'],
    ['catalog_header', '📋 *CATÁLOGO DE PRODUCTOS*', 'string'],
    ['catalog_footer', '📞 Para más información, responde con el número del producto.', 'string'],
];

const insertMany = db.transaction((items) => {
    for (const item of items) {
        insertSetting.run(item[0], item[1], item[2]);
    }
});

insertMany(defaults);

// Insert default quick replies
const insertQuickReply = db.prepare(`
    INSERT OR IGNORE INTO quick_replies (shortcut, title, content, category) VALUES (?, ?, ?, ?)
`);

const defaultReplies = [
    ['/saludo', 'Saludo Inicial', '¡Hola! 👋 ¿En qué puedo ayudarte hoy?', 'general'],
    ['/gracias', 'Agradecimiento', '¡Gracias por tu preferencia! 🙏 Estamos para servirte.', 'general'],
    ['/horario', 'Horario', '🕐 Nuestro horario de atención es:\nLunes a Viernes: 9:00 - 18:00\nSábado: 9:00 - 13:00', 'info'],
    ['/precio', 'Consulta Precio', 'Te envío la información de precios en un momento. ¿Podrías indicarme qué producto te interesa?', 'ventas'],
    ['/catalogo', 'Enviar Catálogo', '📋 Te envío nuestro catálogo de productos:', 'ventas'],
    ['/despedida', 'Despedida', '¡Hasta pronto! 👋 No dudes en escribirnos si necesitas algo más.', 'general'],
];

const insertRepliesMany = db.transaction((items) => {
    for (const item of items) {
        insertQuickReply.run(item[0], item[1], item[2], item[3]);
    }
});

insertRepliesMany(defaultReplies);

console.log('✅ Database initialized successfully');

module.exports = db;
