// src/database/setup.js
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'donut_bot.db');

async function setupDatabase() {
    console.log('🔧 Configurando banco de dados SQLite...');
    
    try {
        const dbDir = path.dirname(DB_PATH);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        const db = new sqlite3.Database(DB_PATH);

        await runSetup(db);
        
        console.log('✅ Banco de dados configurado com sucesso!');
        console.log(`📍 Localização: ${DB_PATH}`);
        
        db.close();
        
    } catch (error) {
        console.error('❌ Erro ao configurar banco de dados:', error);
        process.exit(1);
    }
}

function runSetup(db) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // ================== TABELAS EXISTENTES ==================
            
            // Tabela de usuários
            db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_id TEXT UNIQUE NOT NULL,
                    telegram_username TEXT,
                    first_name TEXT,
                    last_name TEXT,
                    language_code TEXT DEFAULT 'pt',
                    is_active BOOLEAN DEFAULT 1,
                    current_step TEXT DEFAULT 'start',
                    onboarding_completed BOOLEAN DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, handleError);

            // Tabela de wallets (criptografadas)
            db.run(`
                CREATE TABLE IF NOT EXISTS wallets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_id TEXT NOT NULL,
                    public_key TEXT UNIQUE NOT NULL,
                    encrypted_seed TEXT NOT NULL,
                    encrypted_private_key TEXT NOT NULL,
                    pin_hash TEXT NOT NULL,
                    derivation_path TEXT DEFAULT "m/44'/501'/0'/0'",
                    wallet_name TEXT DEFAULT 'Principal',
                    is_active BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
                )
            `, handleError);

            // Tabela de tarefas
            db.run(`
                CREATE TABLE IF NOT EXISTS tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_id TEXT NOT NULL,
                    task_type TEXT NOT NULL,
                    task_data TEXT,
                    status TEXT DEFAULT 'pending',
                    completed_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
                )
            `, handleError);

            // Tabela de notificações
            db.run(`
                CREATE TABLE IF NOT EXISTS notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    message TEXT NOT NULL,
                    data TEXT,
                    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    read_at DATETIME,
                    FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
                )
            `, handleError);

            // Tabela de monitoramento
            db.run(`
                CREATE TABLE IF NOT EXISTS monitors (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_id TEXT NOT NULL,
                    public_key TEXT NOT NULL,
                    monitor_type TEXT NOT NULL,
                    is_active BOOLEAN DEFAULT 1,
                    last_balance REAL DEFAULT 0,
                    last_slots INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
                )
            `, handleError);

            // Tabela de convites (existente)
            db.run(`
                CREATE TABLE IF NOT EXISTS invites (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    referrer_telegram_id TEXT NOT NULL,
                    referred_telegram_id TEXT,
                    voucher_used TEXT,
                    matrix_completed BOOLEAN DEFAULT 0,
                    reward_claimed BOOLEAN DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (referrer_telegram_id) REFERENCES users (telegram_id)
                )
            `, handleError);

            // Tabela de backups de wallet
            db.run(`
                CREATE TABLE IF NOT EXISTS wallet_backups (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_id TEXT NOT NULL,
                    public_key TEXT NOT NULL,
                    progress_data TEXT NOT NULL,
                    deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    restored BOOLEAN DEFAULT 0,
                    FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
                )
            `, handleError);

            // ================== NOVAS TABELAS PARA MATRIZ E VOUCHER ==================
            
            // Tabela de Vouchers
            db.run(`
                CREATE TABLE IF NOT EXISTS user_vouchers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_id TEXT NOT NULL,
                    wallet_address TEXT NOT NULL,
                    voucher_slug TEXT UNIQUE NOT NULL,
                    email TEXT DEFAULT 'test@donut.bot',
                    email_verified BOOLEAN DEFAULT 1,
                    challenge_id TEXT DEFAULT 'test-challenge',
                    verification_code TEXT DEFAULT '0000',
                    referral_link TEXT,
                    uses_count INTEGER DEFAULT 0,
                    is_active BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
                )
            `, handleError);

            // Tabela de Tracking de Referências
            db.run(`
                CREATE TABLE IF NOT EXISTS referral_tracking (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    referrer_telegram_id TEXT NOT NULL,
                    referrer_wallet TEXT NOT NULL,
                    referrer_voucher TEXT,
                    referred_telegram_id TEXT NOT NULL,
                    referred_wallet TEXT,
                    slot_occupied INTEGER,
                    matrix_created BOOLEAN DEFAULT 0,
                    transaction_signature TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (referrer_telegram_id) REFERENCES users (telegram_id),
                    FOREIGN KEY (referred_telegram_id) REFERENCES users (telegram_id)
                )
            `, handleError);

            // Tabela de Matrizes
            db.run(`
                CREATE TABLE IF NOT EXISTS user_matrices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_id TEXT NOT NULL,
                    wallet_address TEXT NOT NULL,
                    matrix_external_id TEXT,
                    referrer_address TEXT NOT NULL,
                    slot_in_referrer INTEGER,
                    status TEXT DEFAULT 'pending',
                    transaction_signature TEXT,
                    slots_filled INTEGER DEFAULT 0,
                    slot_1_wallet TEXT,
                    slot_1_filled_at DATETIME,
                    slot_2_wallet TEXT,
                    slot_2_filled_at DATETIME,
                    slot_3_wallet TEXT,
                    slot_3_filled_at DATETIME,
                    sol_reserved REAL DEFAULT 0,
                    total_earned REAL DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
                )
            `, handleError);

            // Tabela de Transações da Matriz
            db.run(`
                CREATE TABLE IF NOT EXISTS matrix_transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_id TEXT NOT NULL,
                    wallet_address TEXT NOT NULL,
                    transaction_type TEXT NOT NULL,
                    transaction_signature TEXT UNIQUE,
                    amount_sol REAL,
                    amount_usd REAL,
                    slot_index INTEGER,
                    referrer_address TEXT,
                    status TEXT DEFAULT 'pending',
                    error_message TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    confirmed_at DATETIME,
                    FOREIGN KEY (telegram_id) REFERENCES users (telegram_id)
                )
            `, handleError);

            // ================== ÍNDICES PARA PERFORMANCE ==================
            
            // Índices existentes
            db.run(`CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users (telegram_id)`, handleError);
            db.run(`CREATE INDEX IF NOT EXISTS idx_wallets_telegram_id ON wallets (telegram_id)`, handleError);
            db.run(`CREATE INDEX IF NOT EXISTS idx_wallets_public_key ON wallets (public_key)`, handleError);
            db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_telegram_id_status ON tasks (telegram_id, status)`, handleError);
            db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_telegram_id ON notifications (telegram_id)`, handleError);
            db.run(`CREATE INDEX IF NOT EXISTS idx_monitors_telegram_id_type ON monitors (telegram_id, monitor_type)`, handleError);
            db.run(`CREATE INDEX IF NOT EXISTS idx_wallet_backups_public_key ON wallet_backups (public_key)`, handleError);
            
            // Novos índices
            db.run(`CREATE INDEX IF NOT EXISTS idx_vouchers_slug ON user_vouchers (voucher_slug)`, handleError);
            db.run(`CREATE INDEX IF NOT EXISTS idx_vouchers_telegram_id ON user_vouchers (telegram_id)`, handleError);
            db.run(`CREATE INDEX IF NOT EXISTS idx_vouchers_wallet ON user_vouchers (wallet_address)`, handleError);
            db.run(`CREATE INDEX IF NOT EXISTS idx_referral_referrer ON referral_tracking (referrer_telegram_id)`, handleError);
            db.run(`CREATE INDEX IF NOT EXISTS idx_referral_referred ON referral_tracking (referred_telegram_id)`, handleError);
            db.run(`CREATE INDEX IF NOT EXISTS idx_referral_voucher ON referral_tracking (referrer_voucher)`, handleError);
            db.run(`CREATE INDEX IF NOT EXISTS idx_matrices_telegram_id ON user_matrices (telegram_id)`, handleError);
            db.run(`CREATE INDEX IF NOT EXISTS idx_matrices_wallet ON user_matrices (wallet_address)`, handleError);
            db.run(`CREATE INDEX IF NOT EXISTS idx_matrices_referrer ON user_matrices (referrer_address)`, handleError);
            db.run(`CREATE INDEX IF NOT EXISTS idx_matrices_status ON user_matrices (status)`, handleError);
            db.run(`CREATE INDEX IF NOT EXISTS idx_matrix_tx_telegram_id ON matrix_transactions (telegram_id)`, handleError);
            db.run(`CREATE INDEX IF NOT EXISTS idx_matrix_tx_signature ON matrix_transactions (transaction_signature)`, handleError);
            db.run(`CREATE INDEX IF NOT EXISTS idx_matrix_tx_type ON matrix_transactions (transaction_type)`, handleError);

            // ================== TRIGGERS ==================
            
            // Trigger para atualizar timestamp
            db.run(`
                CREATE TRIGGER IF NOT EXISTS update_users_timestamp 
                AFTER UPDATE ON users
                BEGIN
                    UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
                END
            `, handleError);

            // Trigger para vouchers
            db.run(`
                CREATE TRIGGER IF NOT EXISTS update_vouchers_timestamp 
                AFTER UPDATE ON user_vouchers
                BEGIN
                    UPDATE user_vouchers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
                END
            `, handleError);

            // Trigger para matrizes
            db.run(`
                CREATE TRIGGER IF NOT EXISTS update_matrices_timestamp 
                AFTER UPDATE ON user_matrices
                BEGIN
                    UPDATE user_matrices SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
                END
            `, handleError);

            console.log('✅ Todas as tabelas criadas com sucesso!');
            console.log('📋 Tabelas criadas:');
            console.log('   - users (usuários do bot)');
            console.log('   - wallets (wallets criptografadas)');
            console.log('   - tasks (tarefas de gamificação)');
            console.log('   - notifications (sistema de notificações)');
            console.log('   - monitors (monitoramento de depósitos)');
            console.log('   - invites (sistema de convites)');
            console.log('   - wallet_backups (backup de progresso)');
            console.log('   - user_vouchers (vouchers personalizados)');
            console.log('   - referral_tracking (tracking de referências)');
            console.log('   - user_matrices (matrizes dos usuários)');
            console.log('   - matrix_transactions (histórico de transações)');
            
            resolve();
        });
    });
}

function handleError(err) {
    if (err) {
        console.error('❌ Erro SQL:', err.message);
        return;
    }
}

if (require.main === module) {
    setupDatabase();
}

module.exports = { setupDatabase };