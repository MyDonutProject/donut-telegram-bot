// src/services/transaction-monitor.service.js
const { Connection, PublicKey } = require('@solana/web3.js');
const Logger = require('../utils/logger');
const config = require('../config/solana-programs.config');

class TransactionMonitorService {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.db;
        this.logger = new Logger('TransactionMonitor');
        this.connection = new Connection(config.RPC_URL, {
            commitment: 'confirmed',
            wsEndpoint: config.RPC_URL.replace('https', 'wss')
        });
        
        this.subscriptions = new Map();
        this.isMonitoring = false;
    }

    /**
     * Iniciar monitoramento de uma wallet
     */
    async startMonitoring(telegramId, walletAddress) {
        try {
            // Se já está monitorando, não duplicar
            if (this.subscriptions.has(walletAddress)) {
                this.logger.debug(`Já monitorando wallet ${walletAddress}`);
                return;
            }

            const pubkey = new PublicKey(walletAddress);
            
            // Subscrever para mudanças na conta
            const subscriptionId = this.connection.onAccountChange(
                pubkey,
                async (accountInfo, context) => {
                    await this.handleAccountChange(telegramId, walletAddress, accountInfo, context);
                },
                'confirmed'
            );

            this.subscriptions.set(walletAddress, {
                id: subscriptionId,
                telegramId: telegramId,
                startTime: Date.now()
            });

            this.logger.info(`Monitoramento iniciado para ${walletAddress}`);
            
            // Também monitorar logs do programa da matriz
            await this.monitorMatrixProgram(telegramId, walletAddress);
            
        } catch (error) {
            this.logger.error('Erro ao iniciar monitoramento:', error);
        }
    }

    /**
     * Monitorar programa da matriz para eventos
     */
    async monitorMatrixProgram(telegramId, walletAddress) {
        try {
            const matrixProgramId = new PublicKey(config.MATRIX_CONFIG.PROGRAM_ID);
            
            // Subscrever para logs do programa
            const logsSubscriptionId = this.connection.onLogs(
                matrixProgramId,
                async (logs, context) => {
                    await this.handleMatrixLogs(telegramId, walletAddress, logs, context);
                },
                'confirmed'
            );

            // Adicionar à lista de subscriptions
            const key = `${walletAddress}_logs`;
            this.subscriptions.set(key, {
                id: logsSubscriptionId,
                telegramId: telegramId,
                type: 'logs'
            });

        } catch (error) {
            this.logger.error('Erro ao monitorar programa:', error);
        }
    }

    /**
     * Processar mudanças na conta
     */
    async handleAccountChange(telegramId, walletAddress, accountInfo, context) {
        try {
            this.logger.debug(`Mudança detectada na conta ${walletAddress}`);
            
            // Verificar se é uma mudança relevante para matriz
            const matrixStatus = await this.checkMatrixStatus(walletAddress);
            
            if (matrixStatus.hasChanges) {
                await this.notifyMatrixChanges(telegramId, walletAddress, matrixStatus);
            }

        } catch (error) {
            this.logger.error('Erro ao processar mudança na conta:', error);
        }
    }

    /**
     * Processar logs do programa da matriz
     */
    async handleMatrixLogs(telegramId, walletAddress, logs, context) {
        try {
            // Procurar por eventos relevantes nos logs
            const signature = logs.signature;
            
            // Verificar se é uma transação relevante
            if (logs.logs && logs.logs.length > 0) {
                for (const log of logs.logs) {
                    // Procurar por eventos de slot preenchido
                    if (log.includes('SlotFilled') || log.includes('slot_filled')) {
                        await this.handleSlotFilled(telegramId, walletAddress, signature);
                    }
                    
                    // Procurar por eventos de matriz completa
                    if (log.includes('MatrixCompleted') || log.includes('matrix_completed')) {
                        await this.handleMatrixCompleted(telegramId, walletAddress, signature);
                    }
                    
                    // Procurar por eventos de pagamento
                    if (log.includes('PaymentDistributed') || log.includes('payment_distributed')) {
                        await this.handlePaymentDistributed(telegramId, walletAddress, signature);
                    }
                }
            }

        } catch (error) {
            this.logger.error('Erro ao processar logs:', error);
        }
    }

    /**
     * Verificar status da matriz
     */
    async checkMatrixStatus(walletAddress) {
        try {
            // Buscar dados atuais da matriz no banco
            const currentMatrix = await this.db.get(`
                SELECT * FROM user_matrices 
                WHERE wallet_address = ?
            `, [walletAddress]);

            if (!currentMatrix) {
                return { hasChanges: false };
            }

            // Usar AnchorClient para buscar estado na blockchain
            if (this.bot.matrixService && this.bot.matrixService.anchorClient) {
                await this.bot.matrixService.anchorClient.initialize();
                const onchainAccount = await this.bot.matrixService.anchorClient.getUserAccount(walletAddress);
                
                if (onchainAccount.exists) {
                    const filledSlots = onchainAccount.data.filledSlots || 0;
                    
                    // Comparar com dados locais
                    if (filledSlots > currentMatrix.slots_filled) {
                        return {
                            hasChanges: true,
                            newSlotsFilled: filledSlots - currentMatrix.slots_filled,
                            totalSlots: filledSlots,
                            previousSlots: currentMatrix.slots_filled
                        };
                    }
                }
            }

            return { hasChanges: false };

        } catch (error) {
            this.logger.error('Erro ao verificar status da matriz:', error);
            return { hasChanges: false };
        }
    }

    /**
     * Processar slot preenchido
     */
    async handleSlotFilled(telegramId, walletAddress, signature) {
        try {
            this.logger.info(`Slot preenchido detectado para ${walletAddress}`);
            
            // Atualizar banco local
            await this.db.run(`
                UPDATE user_matrices 
                SET slots_filled = slots_filled + 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE wallet_address = ?
            `, [walletAddress]);

            // Buscar informações da matriz
            const matrix = await this.db.get(`
                SELECT * FROM user_matrices 
                WHERE wallet_address = ?
            `, [walletAddress]);

            if (matrix) {
                // Notificar usuário
                let message = '🎉 **NOVO REFERIDO NA SUA MATRIZ!**\n\n';
                message += `✅ Slot ${matrix.slots_filled}/3 preenchido!\n`;
                message += `🔗 [Ver transação](https://solscan.io/tx/${signature})\n\n`;
                
                if (matrix.slots_filled >= 3) {
                    message += '🔄 **Matriz completa!** Será reiniciada automaticamente.\n';
                    message += '💰 Você recebeu seus ganhos!';
                } else {
                    message += `⏳ Faltam ${3 - matrix.slots_filled} pessoas para completar!`;
                }

                await this.bot.bot.sendMessage(telegramId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📊 Ver Matriz', callback_data: 'view_my_matrix' }],
                            [{ text: '📤 Compartilhar Link', callback_data: 'share_voucher' }]
                        ]
                    }
                });

                // Completar tarefa de referência se aplicável
                await this.checkAndCompleteReferralTask(telegramId, matrix.slots_filled);
            }

        } catch (error) {
            this.logger.error('Erro ao processar slot preenchido:', error);
        }
    }

    /**
     * Processar matriz completa
     */
    async handleMatrixCompleted(telegramId, walletAddress, signature) {
        try {
            this.logger.info(`Matriz completa detectada para ${walletAddress}`);
            
            // Resetar slots no banco
            await this.db.run(`
                UPDATE user_matrices 
                SET slots_filled = 0,
                    slot_1_wallet = NULL,
                    slot_1_filled_at = NULL,
                    slot_2_wallet = NULL,
                    slot_2_filled_at = NULL,
                    slot_3_wallet = NULL,
                    slot_3_filled_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE wallet_address = ?
            `, [walletAddress]);

            // Notificar usuário
            let message = '🎊 **PARABÉNS! MATRIZ COMPLETA!**\n\n';
            message += '✅ Todos os 3 slots foram preenchidos!\n';
            message += '💰 Seus ganhos foram distribuídos!\n';
            message += '🔄 Matriz reiniciada automaticamente!\n\n';
            message += '📈 Continue convidando para ganhos ilimitados!';

            await this.bot.bot.sendMessage(telegramId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📊 Ver Nova Matriz', callback_data: 'view_my_matrix' }],
                        [{ text: '💰 Ver Ganhos', callback_data: 'matrix_history' }],
                        [{ text: '📤 Continuar Convidando', callback_data: 'share_voucher' }]
                    ]
                }
            });

        } catch (error) {
            this.logger.error('Erro ao processar matriz completa:', error);
        }
    }

    /**
     * Processar pagamento distribuído
     */
    async handlePaymentDistributed(telegramId, walletAddress, signature) {
        try {
            this.logger.info(`Pagamento distribuído para ${walletAddress}`);
            
            // Buscar detalhes da transação
            const txDetails = await this.connection.getTransaction(signature, {
                maxSupportedTransactionVersion: 0
            });

            if (txDetails) {
                // Calcular valor recebido (simplificado)
                const preBalance = txDetails.meta.preBalances[0];
                const postBalance = txDetails.meta.postBalances[0];
                const received = (postBalance - preBalance) / 1e9; // Converter para SOL

                if (received > 0) {
                    // Atualizar ganhos totais
                    await this.db.run(`
                        UPDATE user_matrices 
                        SET total_earned = total_earned + ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE wallet_address = ?
                    `, [received, walletAddress]);

                    // Notificar usuário
                    let message = '💰 **PAGAMENTO RECEBIDO!**\n\n';
                    message += `✅ Você recebeu: ${received.toFixed(4)} SOL\n`;
                    message += `🔗 [Ver transação](https://solscan.io/tx/${signature})\n\n`;
                    message += 'Continue convidando para mais ganhos!';

                    await this.bot.bot.sendMessage(telegramId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '💳 Ver Wallet', callback_data: 'wallet_menu' }],
                                [{ text: '📊 Ver Matriz', callback_data: 'view_my_matrix' }]
                            ]
                        }
                    });
                }
            }

        } catch (error) {
            this.logger.error('Erro ao processar pagamento:', error);
        }
    }

    /**
     * Notificar mudanças na matriz
     */
    async notifyMatrixChanges(telegramId, walletAddress, status) {
        try {
            if (status.newSlotsFilled > 0) {
                let message = `📊 **Atualização da Matriz**\n\n`;
                message += `✅ ${status.newSlotsFilled} novo(s) slot(s) preenchido(s)!\n`;
                message += `📈 Total: ${status.totalSlots}/3 slots ocupados\n\n`;
                
                if (status.totalSlots >= 3) {
                    message += '🎉 Matriz completa! Ganhos distribuídos!';
                } else {
                    message += `⏳ Faltam ${3 - status.totalSlots} pessoas!`;
                }

                await this.bot.bot.sendMessage(telegramId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📊 Ver Detalhes', callback_data: 'view_my_matrix' }]
                        ]
                    }
                });
            }

        } catch (error) {
            this.logger.error('Erro ao notificar mudanças:', error);
        }
    }

    /**
     * Verificar e completar tarefas de referência
     */
    async checkAndCompleteReferralTask(telegramId, slotsFilled) {
        try {
            const taskMap = {
                1: 'first_referral',
                2: 'second_referral',
                3: 'third_referral'
            };

            const taskType = taskMap[slotsFilled];
            if (taskType && this.bot.gamificationService) {
                // Verificar se tarefa já está completa
                const task = await this.db.get(`
                    SELECT * FROM tasks 
                    WHERE telegram_id = ? AND task_type = ?
                `, [telegramId, taskType]);

                if (task && task.status !== 'completed') {
                    await this.bot.gamificationService.completeTask(telegramId, taskType, {
                        autoCompleted: true,
                        slotsFilled: slotsFilled,
                        timestamp: Date.now()
                    });

                    this.logger.info(`Tarefa ${taskType} completada automaticamente para ${telegramId}`);
                }
            }

        } catch (error) {
            this.logger.error('Erro ao completar tarefa de referência:', error);
        }
    }

    /**
     * Parar monitoramento de uma wallet
     */
    async stopMonitoring(walletAddress) {
        try {
            // Remover subscription principal
            const sub = this.subscriptions.get(walletAddress);
            if (sub) {
                await this.connection.removeAccountChangeListener(sub.id);
                this.subscriptions.delete(walletAddress);
            }

            // Remover subscription de logs
            const logsSub = this.subscriptions.get(`${walletAddress}_logs`);
            if (logsSub) {
                await this.connection.removeOnLogsListener(logsSub.id);
                this.subscriptions.delete(`${walletAddress}_logs`);
            }

            this.logger.info(`Monitoramento parado para ${walletAddress}`);

        } catch (error) {
            this.logger.error('Erro ao parar monitoramento:', error);
        }
    }

    /**
     * Limpar todos os monitoramentos
     */
    async cleanup() {
        try {
            for (const [key, sub] of this.subscriptions.entries()) {
                if (sub.type === 'logs') {
                    await this.connection.removeOnLogsListener(sub.id);
                } else {
                    await this.connection.removeAccountChangeListener(sub.id);
                }
            }
            
            this.subscriptions.clear();
            this.logger.info('Todos os monitoramentos limpos');

        } catch (error) {
            this.logger.error('Erro ao limpar monitoramentos:', error);
        }
    }

    /**
     * Verificar se está monitorando uma wallet
     */
    isMonitoringWallet(walletAddress) {
        return this.subscriptions.has(walletAddress);
    }

    /**
     * Obter estatísticas de monitoramento
     */
    getMonitoringStats() {
        const stats = {
            totalWallets: 0,
            totalLogs: 0,
            wallets: []
        };

        for (const [key, sub] of this.subscriptions.entries()) {
            if (sub.type === 'logs') {
                stats.totalLogs++;
            } else {
                stats.totalWallets++;
                stats.wallets.push({
                    address: key,
                    telegramId: sub.telegramId,
                    duration: Date.now() - sub.startTime
                });
            }
        }

        return stats;
    }
}

module.exports = TransactionMonitorService;