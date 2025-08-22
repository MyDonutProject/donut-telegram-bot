// src/services/wallet.service.js
const { Keypair, PublicKey, Connection } = require('@solana/web3.js');
const { generateMnemonic, mnemonicToSeedSync, validateMnemonic } = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const Database = require('../database/connection');
const encryptionManager = require('../utils/encryption');
const { decodeBase58 } = require('../utils/validation'); 

class WalletService {
    constructor() {
        this.db = new Database();
        this.connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
    }

    async init() {
        await this.db.connect();
        
        const encryptionTest = encryptionManager.testEncryption();
        if (!encryptionTest) {
            console.error('⚠️ Sistema de criptografia com problemas!');
        }
    }

    encodeSecretKey(secretKey) {
        return Buffer.from(secretKey).toString('base64');
    }

    decodeSecretKey(encoded) {
        return Buffer.from(encoded, 'base64');
    }

    async createWallet(telegramId, pin, walletName = 'Principal') {
        try {
            console.log(`🔐 Criando wallet para usuário: ${telegramId}`);

            const existingWallet = await this.getActiveWallet(telegramId);
            if (existingWallet) {
                return {
                    success: false,
                    error: 'Você já possui uma wallet ativa. Para criar outra, desative a atual primeiro.'
                };
            }

            const pinValidation = encryptionManager.validatePINStrength(pin);
            if (!pinValidation.isStrong) {
                return {
                    success: false,
                    error: pinValidation.reason
                };
            }

            const mnemonic = generateMnemonic(128);
            console.log('✅ Seed phrase gerada');

            const seed = mnemonicToSeedSync(mnemonic, '');
            const derivationPath = "m/44'/501'/0'/0'";
            const derivedSeed = derivePath(derivationPath, seed.toString('hex')).key;
            const keypair = Keypair.fromSeed(derivedSeed);

            console.log(`📍 PublicKey: ${keypair.publicKey.toString()}`);

            const sensitiveData = {
                seed: mnemonic,
                privateKey: this.encodeSecretKey(keypair.secretKey)
            };

            const encryptedSeed = encryptionManager.encryptWithPIN(sensitiveData.seed, pin);
            const encryptedPrivateKey = encryptionManager.encryptWithPIN(sensitiveData.privateKey, pin);
            const pinHash = await encryptionManager.hashPIN(pin);

            const result = await this.db.run(`
                INSERT INTO wallets (
                    telegram_id, 
                    public_key, 
                    encrypted_seed, 
                    encrypted_private_key,
                    pin_hash, 
                    derivation_path, 
                    wallet_name,
                    is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            `, [
                telegramId,
                keypair.publicKey.toString(),
                encryptedSeed,
                encryptedPrivateKey,
                pinHash,
                derivationPath,
                walletName
            ]);

            console.log('✅ Wallet salva no banco com segurança');

            return {
                success: true,
                walletId: result.id,
                publicKey: keypair.publicKey.toString(),
                seedPhrase: mnemonic,
                walletName: walletName,
                message: 'Wallet criada com sucesso! Anote sua seed phrase em local seguro.'
            };

        } catch (error) {
            console.error('❌ Erro ao criar wallet:', error);
            return {
                success: false,
                error: error.message || 'Erro ao criar wallet'
            };
        }
    }

    async importWallet(telegramId, seedPhrase, pin, walletName = 'Importada') {
        try {
            console.log(`📥 Importando wallet para usuário: ${telegramId}`);

            const existingWallet = await this.getActiveWallet(telegramId);
            if (existingWallet) {
                return {
                    success: false,
                    error: 'Você já possui uma wallet ativa. Para importar outra, desative a atual primeiro.'
                };
            }

            const cleanSeed = seedPhrase.trim().toLowerCase();
            if (!validateMnemonic(cleanSeed)) {
                return {
                    success: false,
                    error: 'Seed phrase inválida. Verifique se digitou corretamente.'
                };
            }

            const pinValidation = encryptionManager.validatePINStrength(pin);
            if (!pinValidation.isStrong) {
                return {
                    success: false,
                    error: pinValidation.reason
                };
            }

            const seed = mnemonicToSeedSync(cleanSeed, '');
            const derivationPath = "m/44'/501'/0'/0'";
            const derivedSeed = derivePath(derivationPath, seed.toString('hex')).key;
            const keypair = Keypair.fromSeed(derivedSeed);

            console.log(`📍 PublicKey importada: ${keypair.publicKey.toString()}`);

            const existingPublicKey = await this.db.get(
                'SELECT * FROM wallets WHERE public_key = ? AND telegram_id != ?',
                [keypair.publicKey.toString(), telegramId]
            );

            if (existingPublicKey) {
                return {
                    success: false,
                    error: 'Esta wallet já está registrada por outro usuário no sistema.'
                };
            }

            const privateKeyEncoded = this.encodeSecretKey(keypair.secretKey);
            const encryptedSeed = encryptionManager.encryptWithPIN(cleanSeed, pin);
            const encryptedPrivateKey = encryptionManager.encryptWithPIN(privateKeyEncoded, pin);
            const pinHash = await encryptionManager.hashPIN(pin);

            const result = await this.db.run(`
                INSERT INTO wallets (
                    telegram_id, 
                    public_key, 
                    encrypted_seed, 
                    encrypted_private_key,
                    pin_hash, 
                    derivation_path, 
                    wallet_name,
                    is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            `, [
                telegramId,
                keypair.publicKey.toString(),
                encryptedSeed,
                encryptedPrivateKey,
                pinHash,
                derivationPath,
                walletName
            ]);

            console.log('✅ Wallet importada e salva com segurança');

            const backup = await this.checkExistingBackup(telegramId, keypair.publicKey.toString());
            if (backup) {
                await this.restoreProgress(telegramId, keypair.publicKey.toString());
            }

            return {
                success: true,
                walletId: result.id,
                publicKey: keypair.publicKey.toString(),
                walletName: walletName,
                message: 'Wallet importada com sucesso!',
                restoredProgress: backup !== null
            };

        } catch (error) {
            console.error('❌ Erro ao importar wallet:', error);
            return {
                success: false,
                error: error.message || 'Erro ao importar wallet'
            };
        }
    }

    async importWalletFromPrivateKey(telegramId, privateKey, pin, walletName = 'Importada') {
        try {
            console.log(`🔑 Importando wallet via private key para usuário: ${telegramId}`);

            const existingWallet = await this.getActiveWallet(telegramId);
            if (existingWallet) {
                return {
                    success: false,
                    error: 'Você já possui uma wallet ativa. Para importar outra, desative a atual primeiro.'
                };
            }

            const pinValidation = encryptionManager.validatePINStrength(pin);
            if (!pinValidation.isStrong) {
                return {
                    success: false,
                    error: pinValidation.reason
                };
            }

            let keypair;
            try {
                let secretKey;
                const trimmed = privateKey.trim();
                
                if (trimmed.length >= 86 && trimmed.length <= 90) {
                    try {
                        console.log('🔄 Decodificando Base58 manualmente...');
                        secretKey = decodeBase58(trimmed);
                        console.log(`✅ Base58 decodificado: ${secretKey.length} bytes`);
                        
                        if (secretKey.length === 64) {
                            keypair = Keypair.fromSecretKey(secretKey);
                            console.log('✅ Importado via Base58 manual');
                        }
                    } catch (e) {
                        console.log('❌ Erro Base58:', e.message);
                    }
                }

                if (!keypair) {
                    try {
                        console.log('🔄 Tentando Base64...');
                        secretKey = Buffer.from(trimmed, 'base64');
                        if (secretKey.length === 64) {
                            keypair = Keypair.fromSecretKey(secretKey);
                            console.log('✅ Importado via Base64');
                        }
                    } catch (e) {
                        console.log('❌ Não é base64');
                    }
                }

                if (!keypair && trimmed.startsWith('[') && trimmed.endsWith(']')) {
                    try {
                        console.log('🔄 Tentando Array JSON...');
                        const array = JSON.parse(trimmed);
                        if (Array.isArray(array) && array.length === 64) {
                            secretKey = new Uint8Array(array);
                            keypair = Keypair.fromSecretKey(secretKey);
                            console.log('✅ Importado via Array');
                        }
                    } catch (e) {
                        console.log('❌ Não é array válido');
                    }
                }

                if (!keypair && trimmed.length === 128) {
                    try {
                        console.log('🔄 Tentando Hex...');
                        secretKey = Buffer.from(trimmed, 'hex');
                        if (secretKey.length === 64) {
                            keypair = Keypair.fromSecretKey(secretKey);
                            console.log('✅ Importado via Hex');
                        }
                    } catch (e) {
                        console.log('❌ Não é hex');
                    }
                }

                if (!keypair) {
                    throw new Error('Formato de private key não reconhecido');
                }
                
            } catch (e) {
                return {
                    success: false,
                    error: 'Private key inválida. Formatos aceitos: base58, base64, array de bytes ou hex.'
                };
            }

            console.log(`📍 PublicKey importada: ${keypair.publicKey.toString()}`);

            const existingPublicKey = await this.db.get(
                'SELECT * FROM wallets WHERE public_key = ? AND telegram_id != ?',
                [keypair.publicKey.toString(), telegramId]
            );

            if (existingPublicKey) {
                return {
                    success: false,
                    error: 'Esta wallet já está registrada por outro usuário no sistema.'
                };
            }

            const privateKeyEncoded = this.encodeSecretKey(keypair.secretKey);
            const encryptedPrivateKey = encryptionManager.encryptWithPIN(privateKeyEncoded, pin);
            const pinHash = await encryptionManager.hashPIN(pin);

            const result = await this.db.run(`
                INSERT INTO wallets (
                    telegram_id, 
                    public_key, 
                    encrypted_seed, 
                    encrypted_private_key,
                    pin_hash, 
                    derivation_path, 
                    wallet_name,
                    is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            `, [
                telegramId,
                keypair.publicKey.toString(),
                'NO_SEED_PHRASE',
                encryptedPrivateKey,
                pinHash,
                'IMPORTED_FROM_KEY',
                walletName
            ]);

            console.log('✅ Wallet importada via private key com sucesso');

            const backup = await this.checkExistingBackup(telegramId, keypair.publicKey.toString());
            if (backup) {
                await this.restoreProgress(telegramId, keypair.publicKey.toString());
            }

            return {
                success: true,
                walletId: result.id,
                publicKey: keypair.publicKey.toString(),
                walletName: walletName,
                message: 'Wallet importada com sucesso!',
                restoredProgress: backup !== null
            };

        } catch (error) {
            console.error('❌ Erro ao importar wallet via private key:', error);
            return {
                success: false,
                error: error.message || 'Erro ao importar wallet'
            };
        }
    }

    async deleteWallet(telegramId, pin) {
        try {
            const wallet = await this.getActiveWallet(telegramId);
            if (!wallet) {
                return {
                    success: false,
                    error: 'Nenhuma wallet ativa encontrada'
                };
            }

            const isPinValid = await encryptionManager.verifyPIN(pin, wallet.pin_hash);
            if (!isPinValid) {
                return {
                    success: false,
                    error: 'PIN incorreto'
                };
            }

            const backupSaved = await this.backupProgress(telegramId, wallet.public_key);

            await this.db.run('BEGIN TRANSACTION');

            try {
                await this.db.run('DELETE FROM wallets WHERE telegram_id = ?', [telegramId]);
                
                await this.db.run('DELETE FROM tasks WHERE telegram_id = ?', [telegramId]);
                
                await this.db.run('DELETE FROM notifications WHERE telegram_id = ?', [telegramId]);
                
                await this.db.run('DELETE FROM monitors WHERE telegram_id = ?', [telegramId]);
                
                const GamificationService = require('../services/gamification.service');
                const gamificationService = new GamificationService(this.db);
                await gamificationService.initializeUserTasks(telegramId);

                await this.db.run('COMMIT');

                console.log('✅ Wallet deletada e tarefas resetadas');

                return {
                    success: true,
                    message: 'Wallet deletada com sucesso!',
                    backupSaved: backupSaved
                };

            } catch (error) {
                await this.db.run('ROLLBACK');
                throw error;
            }

        } catch (error) {
            console.error('❌ Erro ao deletar wallet:', error);
            return {
                success: false,
                error: error.message || 'Erro ao deletar wallet'
            };
        }
    }

    async backupProgress(telegramId, publicKey) {
        try {
            const tasks = await this.db.all(
                'SELECT * FROM tasks WHERE telegram_id = ?',
                [telegramId]
            );

            const progressData = {
                tasks: tasks,
                timestamp: Date.now()
            };

            await this.db.run(`
                INSERT INTO wallet_backups (telegram_id, public_key, progress_data)
                VALUES (?, ?, ?)
            `, [telegramId, publicKey, JSON.stringify(progressData)]);

            console.log('✅ Backup do progresso salvo');
            return true;

        } catch (error) {
            console.error('❌ Erro ao fazer backup:', error);
            return false;
        }
    }

    async checkExistingBackup(telegramId, publicKey) {
        try {
            const backup = await this.db.get(
                'SELECT * FROM wallet_backups WHERE public_key = ? AND restored = 0 ORDER BY deleted_at DESC LIMIT 1',
                [publicKey]
            );
            
            return backup;

        } catch (error) {
            console.error('❌ Erro ao verificar backup:', error);
            return null;
        }
    }

    async restoreProgress(telegramId, publicKey) {
        try {
            const backup = await this.checkExistingBackup(telegramId, publicKey);
            
            if (!backup) {
                return false;
            }

            const progressData = JSON.parse(backup.progress_data);
            
            for (const task of progressData.tasks) {
                await this.db.run(`
                    UPDATE tasks 
                    SET status = ?, completed_at = ?, task_data = ?
                    WHERE telegram_id = ? AND task_type = ?
                `, [task.status, task.completed_at, task.task_data, telegramId, task.task_type]);
            }

            await this.db.run(
                'UPDATE wallet_backups SET restored = 1 WHERE id = ?',
                [backup.id]
            );

            console.log('✅ Progresso restaurado do backup');
            return true;

        } catch (error) {
            console.error('❌ Erro ao restaurar progresso:', error);
            return false;
        }
    }

    async getKeypair(telegramId, pin) {
        try {
            const wallet = await this.getActiveWallet(telegramId);
            if (!wallet) {
                return {
                    success: false,
                    error: 'Nenhuma wallet ativa encontrada'
                };
            }

            const isPinValid = await encryptionManager.verifyPIN(pin, wallet.pin_hash);
            if (!isPinValid) {
                return {
                    success: false,
                    error: 'PIN incorreto'
                };
            }

            const privateKeyEncoded = encryptionManager.decryptWithPIN(wallet.encrypted_private_key, pin);
            const secretKey = this.decodeSecretKey(privateKeyEncoded);
            const keypair = Keypair.fromSecretKey(secretKey);

            return {
                success: true,
                keypair: keypair,
                publicKey: keypair.publicKey.toString()
            };

        } catch (error) {
            console.error('❌ Erro ao obter keypair:', error);
            return {
                success: false,
                error: error.message || 'Erro ao obter keypair'
            };
        }
    }

    async getSeedPhrase(telegramId, pin) {
        try {
            const wallet = await this.getActiveWallet(telegramId);
            if (!wallet) {
                return {
                    success: false,
                    error: 'Nenhuma wallet ativa encontrada'
                };
            }

            if (wallet.encrypted_seed === 'NO_SEED_PHRASE') {
                return {
                    success: false,
                    error: 'Esta wallet foi importada via private key e não possui seed phrase.'
                };
            }

            const isPinValid = await encryptionManager.verifyPIN(pin, wallet.pin_hash);
            if (!isPinValid) {
                return {
                    success: false,
                    error: 'PIN incorreto'
                };
            }

            const seedPhrase = encryptionManager.decryptWithPIN(wallet.encrypted_seed, pin);

            return {
                success: true,
                seedPhrase: seedPhrase
            };

        } catch (error) {
            console.error('❌ Erro ao obter seed phrase:', error);
            return {
                success: false,
                error: error.message || 'Erro ao obter seed phrase'
            };
        }
    }

    async getActiveWallet(telegramId) {
        try {
            const wallet = await this.db.get(`
                SELECT * FROM wallets 
                WHERE telegram_id = ? AND is_active = 1 
                ORDER BY created_at DESC LIMIT 1
            `, [telegramId]);

            return wallet;

        } catch (error) {
            console.error('❌ Erro ao buscar wallet ativa:', error);
            return null;
        }
    }

    async getBalance(telegramId) {
        try {
            const wallet = await this.getActiveWallet(telegramId);
            if (!wallet) {
                return {
                    success: false,
                    error: 'Nenhuma wallet encontrada'
                };
            }

            const publicKey = new PublicKey(wallet.public_key);

            const solBalance = await this.connection.getBalance(publicKey);
            const solAmount = solBalance / 1e9;

            return {
                success: true,
                publicKey: wallet.public_key,
                solBalance: {
                    lamports: solBalance,
                    sol: solAmount
                },
                walletName: wallet.wallet_name
            };

        } catch (error) {
            console.error('❌ Erro ao obter saldo:', error);
            return {
                success: false,
                error: error.message || 'Erro ao obter saldo'
            };
        }
    }

    async verifyPIN(telegramId, pin) {
        try {
            const wallet = await this.getActiveWallet(telegramId);
            if (!wallet) {
                return false;
            }

            return await encryptionManager.verifyPIN(pin, wallet.pin_hash);

        } catch (error) {
            console.error('❌ Erro ao verificar PIN:', error);
            return false;
        }
    }

    async changePIN(telegramId, oldPin, newPin) {
        try {
            const wallet = await this.getActiveWallet(telegramId);
            if (!wallet) {
                return {
                    success: false,
                    error: 'Nenhuma wallet encontrada'
                };
            }

            const isOldPinValid = await encryptionManager.verifyPIN(oldPin, wallet.pin_hash);
            if (!isOldPinValid) {
                return {
                    success: false,
                    error: 'PIN atual incorreto'
                };
            }

            const pinValidation = encryptionManager.validatePINStrength(newPin);
            if (!pinValidation.isStrong) {
                return {
                    success: false,
                    error: pinValidation.reason
                };
            }

            const seedPhrase = wallet.encrypted_seed !== 'NO_SEED_PHRASE' 
                ? encryptionManager.decryptWithPIN(wallet.encrypted_seed, oldPin)
                : 'NO_SEED_PHRASE';
            const privateKey = encryptionManager.decryptWithPIN(wallet.encrypted_private_key, oldPin);

            const newEncryptedSeed = seedPhrase !== 'NO_SEED_PHRASE'
                ? encryptionManager.encryptWithPIN(seedPhrase, newPin)
                : 'NO_SEED_PHRASE';
            const newEncryptedPrivateKey = encryptionManager.encryptWithPIN(privateKey, newPin);
            const newPinHash = await encryptionManager.hashPIN(newPin);

            await this.db.run(`
                UPDATE wallets 
                SET encrypted_seed = ?, encrypted_private_key = ?, pin_hash = ?
                WHERE id = ?
            `, [newEncryptedSeed, newEncryptedPrivateKey, newPinHash, wallet.id]);

            console.log('✅ PIN alterado com sucesso');

            return {
                success: true,
                message: 'PIN alterado com sucesso!'
            };

        } catch (error) {
            console.error('❌ Erro ao alterar PIN:', error);
            return {
                success: false,
                error: error.message || 'Erro ao alterar PIN'
            };
        }
    }

    async deactivateWallet(telegramId, pin) {
        try {
            const wallet = await this.getActiveWallet(telegramId);
            if (!wallet) {
                return {
                    success: false,
                    error: 'Nenhuma wallet ativa encontrada'
                };
            }

            const isPinValid = await encryptionManager.verifyPIN(pin, wallet.pin_hash);
            if (!isPinValid) {
                return {
                    success: false,
                    error: 'PIN incorreto'
                };
            }

            await this.db.run(`
                UPDATE wallets SET is_active = 0 WHERE id = ?
            `, [wallet.id]);

            console.log('✅ Wallet desativada');

            return {
                success: true,
                message: 'Wallet desativada com sucesso!'
            };

        } catch (error) {
            console.error('❌ Erro ao desativar wallet:', error);
            return {
                success: false,
                error: error.message || 'Erro ao desativar wallet'
            };
        }
    }

    async listWallets(telegramId) {
        try {
            const wallets = await this.db.all(`
                SELECT id, public_key, wallet_name, is_active, created_at
                FROM wallets 
                WHERE telegram_id = ? 
                ORDER BY created_at DESC
            `, [telegramId]);

            return {
                success: true,
                wallets: wallets || []
            };

        } catch (error) {
            console.error('❌ Erro ao listar wallets:', error);
            return {
                success: false,
                error: error.message || 'Erro ao listar wallets'
            };
        }
    }

    async hasWallet(telegramId) {
        try {
            const wallet = await this.getActiveWallet(telegramId);
            return wallet !== null && wallet !== undefined;
        } catch (error) {
            console.error('❌ Erro ao verificar se tem wallet:', error);
            return false;
        }
    }

    async getWallet(telegramId) {
        return await this.getActiveWallet(telegramId);
    }
}

module.exports = WalletService;