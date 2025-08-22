// src/database/connection.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
    constructor() {
        this.db = null;
        this.dbPath = path.join(__dirname, 'donut_bot.db');
    }

    // Conectar ao banco
    connect() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('❌ Erro ao conectar com SQLite:', err.message);
                    reject(err);
                } else {
                    console.log('✅ Conectado ao SQLite database');
                    resolve();
                }
            });
        });
    }

    // Executar query com parâmetros
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    console.error('❌ Erro SQL RUN:', err.message);
                    reject(err);
                } else {
                    resolve({ id: this.lastID, changes: this.changes });
                }
            });
        });
    }

    // Buscar uma linha
    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    console.error('❌ Erro SQL GET:', err.message);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // Buscar todas as linhas
    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    console.error('❌ Erro SQL ALL:', err.message);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    // Executar múltiplas queries em transação
    async transaction(queries) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION');

                const results = [];
                let hasError = false;

                const executeNext = (index) => {
                    if (index >= queries.length) {
                        if (hasError) {
                            this.db.run('ROLLBACK', () => {
                                reject(new Error('Transaction rolled back'));
                            });
                        } else {
                            this.db.run('COMMIT', () => {
                                resolve(results);
                            });
                        }
                        return;
                    }

                    const { sql, params = [] } = queries[index];
                    
                    this.db.run(sql, params, function(err) {
                        if (err) {
                            console.error('❌ Transaction error:', err.message);
                            hasError = true;
                        } else {
                            results.push({ id: this.lastID, changes: this.changes });
                        }
                        executeNext(index + 1);
                    });
                };

                executeNext(0);
            });
        });
    }

    // Fechar conexão
    close() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        console.error('❌ Erro ao fechar SQLite:', err.message);
                    } else {
                        console.log('✅ Conexão SQLite fechada');
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    // Verificar se tabela existe
    async tableExists(tableName) {
        const result = await this.get(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            [tableName]
        );
        return !!result;
    }

    // Contar registros de uma tabela
    async count(tableName, whereClause = '', params = []) {
        const sql = whereClause 
            ? `SELECT COUNT(*) as count FROM ${tableName} WHERE ${whereClause}`
            : `SELECT COUNT(*) as count FROM ${tableName}`;
        
        const result = await this.get(sql, params);
        return result ? result.count : 0;
    }

    // Método utilitário para backup do banco
    async backup(backupPath) {
        return new Promise((resolve, reject) => {
            const backup = this.db.backup(backupPath);
            
            backup.step(-1, (err) => {
                if (err) {
                    console.error('❌ Erro no backup:', err.message);
                    reject(err);
                } else {
                    backup.finish((err) => {
                        if (err) {
                            console.error('❌ Erro ao finalizar backup:', err.message);
                            reject(err);
                        } else {
                            console.log(`✅ Backup salvo em: ${backupPath}`);
                            resolve();
                        }
                    });
                }
            });
        });
    }

    // Executar consulta personalizada com callback
    executeWithCallback(sql, params, callback) {
        this.db.all(sql, params, callback);
    }

    // Método para verificar integridade do banco
    async checkIntegrity() {
        try {
            const result = await this.get('PRAGMA integrity_check');
            return result.integrity_check === 'ok';
        } catch (error) {
            console.error('❌ Erro ao verificar integridade:', error.message);
            return false;
        }
    }

    // Otimizar banco (VACUUM)
    async optimize() {
        try {
            await this.run('VACUUM');
            console.log('✅ Banco otimizado');
            return true;
        } catch (error) {
            console.error('❌ Erro ao otimizar banco:', error.message);
            return false;
        }
    }

    // Estatísticas do banco
    async getStats() {
        try {
            const tables = await this.all(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            );

            const stats = {};
            
            for (const table of tables) {
                const count = await this.count(table.name);
                stats[table.name] = count;
            }

            return stats;
        } catch (error) {
            console.error('❌ Erro ao obter estatísticas:', error.message);
            return {};
        }
    }
}

module.exports = Database;