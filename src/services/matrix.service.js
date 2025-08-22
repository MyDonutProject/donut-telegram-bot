// src/services/matrix.service.js
const { Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const Logger = require('../utils/logger');
const BotAnchorClientService = require('./bot-anchor-client.service');
const config = require('../config/solana-programs.config');

class MatrixService {
    constructor(db, walletService, solanaService, gamificationService, priceService) {
        this.db = db;
        this.walletService = walletService;
        this.solanaService = solanaService;
        this.gamificationService = gamificationService;
        this.priceService = priceService;
        this.botAnchorClient = new BotAnchorClientService();
        this.logger = new Logger('MatrixService');
        
        // Cache de verificações
        this.matrixCache = new Map();
        this.cacheTimeout = 30000; // 30 segundos
    }

    /**
     * Criar matriz para o usuário
     */
    async createMatrix(telegramId, pin) {
        try {
            this.logger.info(`Iniciando criação de matriz para usuário ${telegramId}`);

            // 1. Verificar se já tem matriz
            const existingMatrix = await this.getUserMatrix(telegramId);
            if (existingMatrix && existingMatrix.status === 'active') {
                return {
                    success: false,
                    error: 'Você já possui uma matriz ativa!'
                };
            }

            // 2. Obter wallet e verificar PIN (ÚNICA VEZ)
            const keypairResult = await this.walletService.getKeypair(telegramId, pin);
            if (!keypairResult.success) {
                return {
                    success: false,
                    error: keypairResult.error || 'PIN incorreto'
                };
            }

            const userKeypair = keypairResult.keypair;
            const userWallet = userKeypair.publicKey.toString();

            // 3. Verificar saldo USANDO PRICESERVICE
            const balance = await this.solanaService.getBalance(userWallet);
            const solBalance = this.solanaService.lamportsToSol(balance);
            
            // Usar priceService para obter preço atual
            const solPrice = await this.priceService.getSOLPrice();
            const usdValue = solBalance * solPrice;
            
            // Valor necessário com buffer
            const requiredUSD = config.MATRIX_VALUES.getRegistrationAmountWithBuffer();
            
            this.logger.info(`Verificação de saldo para matriz:`, {
                userWallet,
                solBalance: solBalance.toFixed(4),
                solPrice: solPrice.toFixed(2),
                usdValue: usdValue.toFixed(2),
                requiredUSD: requiredUSD.toFixed(2),
                sufficient: usdValue >= requiredUSD
            });
            
            if (usdValue < requiredUSD) {
                const neededUSD = requiredUSD - usdValue;
                const neededSOL = neededUSD / solPrice;
                
                return {
                    success: false,
                    error: `Saldo insuficiente! Necessário: $${requiredUSD.toFixed(2)} USD em SOL. Você tem apenas ${solBalance.toFixed(4)} SOL (~$${usdValue.toFixed(2)}). Faltam ${neededSOL.toFixed(4)} SOL (~$${neededUSD.toFixed(2)})`,
                    currentBalance: solBalance,
                    currentUSD: usdValue,
                    required: requiredUSD,
                    neededSOL: neededSOL,
                    solPrice: solPrice
                };
            }

            // 4. Obter referenciador
            const referrer = await this.getReferrerAddress(telegramId);
            this.logger.info(`Referenciador para ${telegramId}: ${referrer}`);

            // 5. Verificar slots do referenciador
            await this.botAnchorClient.initialize();
            const slotInfo = await this.botAnchorClient.checkReferrerSlots(referrer);
            
            if (!slotInfo.isRegistered && referrer !== config.MATRIX_CONFIG.DEFAULT_REFERRER.toString()) {
                // Se referenciador não está registrado, usar padrão
                this.logger.warn(`Referenciador ${referrer} não registrado, usando padrão`);
                referrer = config.MATRIX_CONFIG.DEFAULT_REFERRER.toString();
            }

            const slotIndex = slotInfo.availableSlot || 0;
            this.logger.info(`Usuário ocupará slot ${slotIndex} do referenciador`);

            // 6. Salvar estado inicial no banco
            await this.db.run(`
                INSERT INTO user_matrices (
                    telegram_id, 
                    wallet_address, 
                    referrer_address,
                    slot_in_referrer,
                    status
                ) VALUES (?, ?, ?, ?, 'processing')
            `, [telegramId, userWallet, referrer, slotIndex]);

            // 7. Calcular quantidade de SOL necessária baseado no preço atual
            const solAmount = requiredUSD / solPrice;
            
            this.logger.info(`Executando registro na blockchain:`, {
                requiredUSD: requiredUSD.toFixed(2),
                solPrice: solPrice.toFixed(2),
                solAmount: solAmount.toFixed(4)
            });

            // 8. Executar registro na blockchain usando BotAnchorClientService
            const registrationResult = await this.botAnchorClient.executeRegistrationForBot(
                userKeypair,
                referrer,
                requiredUSD
            );

            if (!registrationResult.success) {
                // Atualizar status para erro
                await this.db.run(`
                    UPDATE user_matrices 
                    SET status = 'failed', 
                        updated_at = CURRENT_TIMESTAMP 
                    WHERE telegram_id = ? AND wallet_address = ?
                `, [telegramId, userWallet]);

                return {
                    success: false,
                    error: registrationResult.error || 'Erro ao registrar na blockchain'
                };
            }

            // 9. Atualizar banco com sucesso
            await this.db.run(`
                UPDATE user_matrices 
                SET status = 'active',
                    transaction_signature = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE telegram_id = ? AND wallet_address = ?
            `, [registrationResult.signature, telegramId, userWallet]);

            // 10. Salvar transação
            await this.saveMatrixTransaction(
                telegramId,
                userWallet,
                'registration',
                registrationResult.signature,
                registrationResult.amountSol || solAmount,
                requiredUSD,
                slotIndex,
                referrer
            );

            // 11. Atualizar tracking de referência
            await this.updateReferralTracking(telegramId, userWallet, referrer, slotIndex);

            // 12. Completar tarefa
            await this.gamificationService.completeTask(telegramId, 'create_matrix', {
                matrixCreated: true,
                referrer: referrer,
                slotOccupied: slotIndex,
                transactionSignature: registrationResult.signature,
                amountUSD: requiredUSD,
                amountSOL: solAmount,
                solPrice: solPrice,
                preparatoryTransactions: registrationResult.preparatoryTransactions || [],
                lookupTableAddress: registrationResult.lookupTableAddress,
                timestamp: Date.now()
            });

            // 13. Processar comportamento do slot
            await this.processSlotBehavior(slotIndex, requiredUSD, referrer);

            this.logger.info(`Matriz criada com sucesso para ${telegramId}`);

            return {
                success: true,
                signature: registrationResult.signature,
                explorerUrl: registrationResult.explorerUrl,
                slotOccupied: slotIndex,
                referrer: referrer,
                amountSOL: solAmount,
                amountUSD: requiredUSD,
                solPrice: solPrice,
                preparatoryTransactions: registrationResult.preparatoryTransactions || [],
                lookupTableAddress: registrationResult.lookupTableAddress,
                message: this.getSlotMessage(slotIndex)
            };

        } catch (error) {
            this.logger.error('Erro ao criar matriz:', error);
            
            // Atualizar status para erro
            await this.db.run(`
                UPDATE user_matrices 
                SET status = 'failed',
                    updated_at = CURRENT_TIMESTAMP
                WHERE telegram_id = ? AND status = 'processing'
            `, [telegramId]);

            return {
                success: false,
                error: error.message || 'Erro ao criar matriz'
            };
        }
    }

    /**
     * Obter endereço do referenciador
     */
    async getReferrerAddress(telegramId) {
        try {
            // 1. Verificar se usuário usou voucher
            const referralTracking = await this.db.get(`
                SELECT referrer_wallet, referrer_voucher 
                FROM referral_tracking 
                WHERE referred_telegram_id = ?
                ORDER BY created_at DESC
                LIMIT 1
            `, [telegramId]);

            if (referralTracking && referralTracking.referrer_wallet) {
                return referralTracking.referrer_wallet;
            }

            // 2. Verificar se tem voucher salvo no contexto
            const voucher = await this.db.get(`
                SELECT wallet_address 
                FROM user_vouchers 
                WHERE voucher_slug = (
                    SELECT referrer_voucher 
                    FROM referral_tracking 
                    WHERE referred_telegram_id = ?
                    LIMIT 1
                )
            `, [telegramId]);

            if (voucher && voucher.wallet_address) {
                return voucher.wallet_address;
            }

            // 3. Usar referenciador padrão
            return config.MATRIX_CONFIG.DEFAULT_REFERRER.toString();

        } catch (error) {
            this.logger.error('Erro ao obter referenciador:', error);
            return config.MATRIX_CONFIG.DEFAULT_REFERRER.toString();
        }
    }

    /**
     * Processar comportamento específico do slot
     */
    async processSlotBehavior(slotIndex, amount, referrerAddress) {
        try {
            let behavior = '';
            
            switch(slotIndex) {
                case 0:
                    // Slot 1: Swap SOL para DONUT e burn 100%
                    behavior = 'swap_and_burn';
                    this.logger.info(`Slot 0: Swap de $${amount} para DONUT e burn`);
                    break;
                    
                case 1:
                    // Slot 2: Reservar SOL para o referenciador
                    behavior = 'reserve_sol';
                    
                    // Converter USD para SOL usando preço atual
                    const solPrice = await this.priceService.getSOLPrice();
                    const solAmount = amount / solPrice;
                    
                    await this.db.run(`
                        UPDATE user_matrices 
                        SET sol_reserved = sol_reserved + ?
                        WHERE wallet_address = ?
                    `, [solAmount, referrerAddress]);
                    
                    this.logger.info(`Slot 1: Reservado ${solAmount.toFixed(4)} SOL (~$${amount}) para ${referrerAddress}`);
                    break;
                    
                case 2:
                    // Slot 3: Pagar SOL reservado + distribuir para uplines
                    behavior = 'pay_and_distribute';
                    
                    // Pagar SOL reservado
                    const matrix = await this.db.get(`
                        SELECT sol_reserved 
                        FROM user_matrices 
                        WHERE wallet_address = ?
                    `, [referrerAddress]);
                    
                    if (matrix && matrix.sol_reserved > 0) {
                        await this.db.run(`
                            UPDATE user_matrices 
                            SET total_earned = total_earned + ?,
                                sol_reserved = 0
                            WHERE wallet_address = ?
                        `, [matrix.sol_reserved, referrerAddress]);
                        
                        this.logger.info(`Slot 2: Pagou ${matrix.sol_reserved} SOL reservado + distribuição`);
                    }
                    break;
            }
            
            return behavior;
            
        } catch (error) {
            this.logger.error('Erro ao processar comportamento do slot:', error);
        }
    }

    /**
     * Obter mensagem específica do slot
     */
    getSlotMessage(slotIndex) {
        const messages = {
            0: '🔥 Slot 1 ocupado! Seu investimento foi convertido em DONUT e queimado, aumentando o valor do token!',
            1: '💰 Slot 2 ocupado! SOL reservado para pagamento futuro ao seu referenciador.',
            2: '🎯 Slot 3 ocupado! Pagamento distribuído e matriz do referenciador reiniciada!'
        };
        
        return messages[slotIndex] || 'Matriz criada com sucesso!';
    }

    /**
     * Salvar transação da matriz
     */
    async saveMatrixTransaction(telegramId, wallet, type, signature, amountSol, amountUsd, slotIndex, referrer) {
        try {
            await this.db.run(`
                INSERT INTO matrix_transactions (
                    telegram_id,
                    wallet_address,
                    transaction_type,
                    transaction_signature,
                    amount_sol,
                    amount_usd,
                    slot_index,
                    referrer_address,
                    status,
                    confirmed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', CURRENT_TIMESTAMP)
            `, [telegramId, wallet, type, signature, amountSol, amountUsd, slotIndex, referrer]);
            
        } catch (error) {
            this.logger.error('Erro ao salvar transação:', error);
        }
    }

    /**
     * Atualizar tracking de referência
     */
    async updateReferralTracking(telegramId, userWallet, referrerAddress, slotIndex) {
        try {
            // Verificar se já existe tracking
            const existing = await this.db.get(`
                SELECT id FROM referral_tracking 
                WHERE referred_telegram_id = ?
            `, [telegramId]);

            if (existing) {
                await this.db.run(`
                    UPDATE referral_tracking 
                    SET referred_wallet = ?,
                        slot_occupied = ?,
                        matrix_created = 1
                    WHERE referred_telegram_id = ?
                `, [userWallet, slotIndex, telegramId]);
            } else {
                // Buscar telegram_id do referenciador
                const referrerUser = await this.db.get(`
                    SELECT telegram_id FROM wallets 
                    WHERE public_key = ?
                `, [referrerAddress]);

                if (referrerUser) {
                    await this.db.run(`
                        INSERT INTO referral_tracking (
                            referrer_telegram_id,
                            referrer_wallet,
                            referred_telegram_id,
                            referred_wallet,
                            slot_occupied,
                            matrix_created
                        ) VALUES (?, ?, ?, ?, ?, 1)
                    `, [referrerUser.telegram_id, referrerAddress, telegramId, userWallet, slotIndex]);
                }
            }

            // Atualizar slots na matriz do referenciador
            await this.updateReferrerSlots(referrerAddress, slotIndex, userWallet);
            
        } catch (error) {
            this.logger.error('Erro ao atualizar tracking:', error);
        }
    }

    /**
     * Atualizar slots do referenciador
     */
    async updateReferrerSlots(referrerAddress, slotIndex, referredWallet) {
        try {
            const slotColumn = `slot_${slotIndex + 1}_wallet`;
            const slotDateColumn = `slot_${slotIndex + 1}_filled_at`;
            
            await this.db.run(`
                UPDATE user_matrices 
                SET ${slotColumn} = ?,
                    ${slotDateColumn} = CURRENT_TIMESTAMP,
                    slots_filled = slots_filled + 1
                WHERE wallet_address = ?
            `, [referredWallet, referrerAddress]);

            // Verificar se completou todos os slots
            const matrix = await this.db.get(`
                SELECT * FROM user_matrices 
                WHERE wallet_address = ?
            `, [referrerAddress]);

            if (matrix && matrix.slots_filled >= 3) {
                // Matriz completa - será reiniciada automaticamente pelo contrato
                this.logger.info(`Matriz de ${referrerAddress} completa! Será reiniciada.`);
                
                // Resetar slots localmente
                await this.db.run(`
                    UPDATE user_matrices 
                    SET slots_filled = 0,
                        slot_1_wallet = NULL,
                        slot_1_filled_at = NULL,
                        slot_2_wallet = NULL,
                        slot_2_filled_at = NULL,
                        slot_3_wallet = NULL,
                        slot_3_filled_at = NULL
                    WHERE wallet_address = ?
                `, [referrerAddress]);
            }

            // Verificar e completar tarefas de referência
            await this.checkAndCompleteReferralTasks(referrerAddress, slotIndex);
            
        } catch (error) {
            this.logger.error('Erro ao atualizar slots:', error);
        }
    }

    /**
     * Verificar e completar tarefas de referência
     */
    async checkAndCompleteReferralTasks(referrerAddress, slotIndex) {
        try {
            // Buscar telegram_id do referenciador
            const referrer = await this.db.get(`
                SELECT telegram_id FROM wallets 
                WHERE public_key = ?
            `, [referrerAddress]);

            if (!referrer) return;

            const taskMap = {
                0: 'first_referral',
                1: 'second_referral',
                2: 'third_referral'
            };

            const taskType = taskMap[slotIndex];
            if (taskType) {
                await this.gamificationService.completeTask(referrer.telegram_id, taskType, {
                    slotFilled: slotIndex + 1,
                    timestamp: Date.now()
                });
                
                this.logger.info(`Tarefa ${taskType} completada para ${referrer.telegram_id}`);
            }
            
        } catch (error) {
            this.logger.error('Erro ao completar tarefas de referência:', error);
        }
    }

    /**
     * Obter matriz do usuário
     */
    async getUserMatrix(telegramId) {
        try {
            const matrix = await this.db.get(`
                SELECT * FROM user_matrices 
                WHERE telegram_id = ? 
                ORDER BY created_at DESC 
                LIMIT 1
            `, [telegramId]);

            return matrix;
            
        } catch (error) {
            this.logger.error('Erro ao obter matriz:', error);
            return null;
        }
    }

    /**
     * Obter estatísticas da matriz com valores em USD
     */
    async getMatrixStats(telegramId) {
        try {
            const matrix = await this.getUserMatrix(telegramId);
            if (!matrix) {
                return {
                    hasMatrix: false
                };
            }

            // Obter preço atual do SOL para conversões
            const solPrice = await this.priceService.getSOLPrice();

            // Buscar referidos
            const referrals = await this.db.all(`
                SELECT * FROM referral_tracking 
                WHERE referrer_telegram_id = ?
                ORDER BY created_at DESC
            `, [telegramId]);

            // Buscar transações
            const transactions = await this.db.all(`
                SELECT * FROM matrix_transactions 
                WHERE telegram_id = ?
                ORDER BY created_at DESC
            `, [telegramId]);

            // Calcular valores em USD
            const totalEarnedUSD = (matrix.total_earned || 0) * solPrice;
            const solReservedUSD = (matrix.sol_reserved || 0) * solPrice;

            return {
                hasMatrix: true,
                matrix: matrix,
                totalSlotsFilled: matrix.slots_filled || 0,
                totalEarned: matrix.total_earned || 0,
                totalEarnedUSD: totalEarnedUSD,
                solReserved: matrix.sol_reserved || 0,
                solReservedUSD: solReservedUSD,
                referrals: referrals.length,
                transactions: transactions.length,
                solPrice: solPrice,
                slots: {
                    slot1: matrix.slot_1_wallet,
                    slot2: matrix.slot_2_wallet,
                    slot3: matrix.slot_3_wallet
                }
            };
            
        } catch (error) {
            this.logger.error('Erro ao obter estatísticas:', error);
            return {
                hasMatrix: false,
                error: error.message
            };
        }
    }

    /**
     * Sincronizar com blockchain
     */
    async syncWithBlockchain(telegramId) {
        try {
            const wallet = await this.walletService.getActiveWallet(telegramId);
            if (!wallet) return;

            await this.botAnchorClient.initialize();
            const account = await this.botAnchorClient.getUserAccount(wallet.public_key);

            if (account.exists) {
                // Atualizar banco local com dados da blockchain
                await this.db.run(`
                    UPDATE user_matrices 
                    SET slots_filled = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE telegram_id = ?
                `, [account.data.filledSlots, telegramId]);

                this.logger.info(`Sincronizado com blockchain para ${telegramId}`);
                return true;
            }

            return false;
            
        } catch (error) {
            this.logger.error('Erro ao sincronizar:', error);
            return false;
        }
    }

    /**
     * Verificar slots do referenciador
     */
    async checkReferrerSlots(referrerAddress) {
        try {
            await this.botAnchorClient.initialize();
            return await this.botAnchorClient.checkReferrerSlots(referrerAddress);
        } catch (error) {
            this.logger.error('Erro ao verificar slots:', error);
            throw error;
        }
    }

    /**
     * Monitorar slots da matriz
     */
    async monitorMatrixSlots(telegramId) {
        try {
            const matrix = await this.getUserMatrix(telegramId);
            if (!matrix) return null;

            // Sincronizar com blockchain
            await this.syncWithBlockchain(telegramId);

            // Retornar status atualizado
            return await this.getMatrixStats(telegramId);
            
        } catch (error) {
            this.logger.error('Erro ao monitorar slots:', error);
            return null;
        }
    }
}

module.exports = MatrixService;