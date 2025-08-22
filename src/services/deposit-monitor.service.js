// src/services/deposit-monitor.service.js
const Logger = require('../utils/logger');
const PriceService = require('./price.service');

class DepositMonitorService {
    constructor(bot) {
        this.bot = bot.bot; // Instância do TelegramBot
        this.botInstance = bot; // Instância principal DonutTelegramBot
        this.solanaService = bot.solanaService;
        this.gamificationService = bot.gamificationService;
        this.priceService = new PriceService();
        this.logger = new Logger('DepositMonitorService');
        
        // Monitoramentos ativos
        this.activeMonitors = new Map();
        
        // Configurações
        this.config = {
            checkInterval: 2000, // 2 segundos conforme solicitado
            minimumUSD: 15, // $15 USD mínimo
            maxMonitorDuration: 15 * 60 * 1000, // 15 minutos máximo
            reminderInterval: 15 * 60 * 1000, // Lembrete a cada 15 minutos
            maxReminders: 4 // Máximo 4 lembretes (1 hora total)
        };
    }

    /**
     * Iniciar monitoramento de depósito para usuário
     * @param {string} telegramId - ID do usuário
     * @param {string} publicKey - Chave pública da wallet
     * @param {object} options - Opções de configuração
     */
    async startMonitoring(telegramId, publicKey, options = {}) {
        try {
            this.logger.info(`Iniciando monitoramento de depósito para ${telegramId}`, { publicKey });

            // Verificar se já está monitorando
            if (this.activeMonitors.has(telegramId)) {
                this.logger.warn(`Monitoramento já ativo para usuário ${telegramId}`);
                return { success: false, error: 'Monitoramento já ativo' };
            }

            // Verificar saldo inicial
            const initialCheck = await this.checkDeposit(telegramId, publicKey);
            
            if (initialCheck.success && initialCheck.completed) {
                // Já tem saldo suficiente
                this.logger.info(`Usuário ${telegramId} já possui saldo suficiente`, initialCheck);
                return {
                    success: true,
                    alreadyCompleted: true,
                    data: initialCheck
                };
            }

            // Configurar monitoramento
            const monitorConfig = {
                telegramId,
                publicKey,
                startTime: Date.now(),
                checkCount: 0,
                reminderCount: 0,
                lastBalance: initialCheck.data?.lamports || 0,
                isPaused: false,
                options: {
                    minimumUSD: options.minimumUSD || this.config.minimumUSD,
                    ...options
                }
            };

            // Iniciar intervalos
            const checkInterval = setInterval(async () => {
                await this.performCheck(telegramId);
            }, this.config.checkInterval);

            const reminderInterval = setInterval(async () => {
                await this.sendReminder(telegramId);
            }, this.config.reminderInterval);

            // Timeout para parar automaticamente
            const timeoutId = setTimeout(() => {
                this.stopMonitoring(telegramId, 'timeout');
            }, this.config.maxMonitorDuration);

            // Salvar no mapa
            this.activeMonitors.set(telegramId, {
                ...monitorConfig,
                checkInterval,
                reminderInterval,
                timeoutId
            });

            this.logger.info(`Monitoramento iniciado para ${telegramId}`, {
                minimumUSD: monitorConfig.options.minimumUSD,
                duration: `${this.config.maxMonitorDuration / 60000} minutos`
            });

            return { success: true, monitoring: true };

        } catch (error) {
            this.logger.error('Erro ao iniciar monitoramento', { telegramId, error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * ✅ NOVO: Verificar saldo imediato ao importar wallet
     * @param {string} telegramId - ID do usuário
     * @param {string} publicKey - Chave pública da wallet
     * @returns {Promise<object>} - Resultado da verificação
     */
    async checkImportedWalletBalance(telegramId, publicKey) {
        try {
            this.logger.info(`Verificando saldo de wallet importada para ${telegramId}`, { publicKey });

            // Verificar saldo atual
            const result = await this.checkDeposit(telegramId, publicKey);
            
            if (result.success && result.completed) {
                // Wallet já tem saldo suficiente - completar tarefa imediatamente
                this.logger.info(`Wallet importada já possui saldo suficiente para ${telegramId}`, {
                    usdValue: `$${result.data.usdValue.toFixed(2)}`,
                    required: `$${result.data.minimumUSD}`
                });

                // Completar tarefa de funding automaticamente
                await this.gamificationService.completeTask(telegramId, 'fund_wallet', {
                    lamports: result.data.lamports,
                    solAmount: result.data.solAmount,
                    usdValue: result.data.usdValue,
                    solPrice: result.data.solPrice,
                    autoDetected: true,
                    importedWithBalance: true,
                    timestamp: Date.now()
                });

                // Enviar notificação de sucesso e direcionar para próxima tarefa
                await this.sendImportedWalletSuccessMessage(telegramId, result.data);

                return {
                    success: true,
                    hasBalance: true,
                    completed: true,
                    data: result.data
                };
            } 
            else if (result.success && result.data && result.data.usdValue > 0) {
                // Wallet tem saldo parcial - iniciar monitoramento e notificar
                this.logger.info(`Wallet importada tem saldo parcial para ${telegramId}`, {
                    current: `$${result.data.usdValue.toFixed(2)}`,
                    required: `$${result.data.minimumUSD}`,
                    missing: `$${(result.data.minimumUSD - result.data.usdValue).toFixed(2)}`
                });

                // Enviar notificação de saldo parcial
                await this.sendPartialBalanceNotification(telegramId, result.data);

                // Iniciar monitoramento para o valor restante
                await this.startMonitoring(telegramId, publicKey, {
                    minimumUSD: this.config.minimumUSD,
                    importedWithPartialBalance: true,
                    initialBalance: result.data.lamports
                });

                return {
                    success: true,
                    hasBalance: true,
                    completed: false,
                    partial: true,
                    data: result.data
                };
            }
            else {
                // Wallet sem saldo - iniciar monitoramento normal
                this.logger.info(`Wallet importada sem saldo para ${telegramId}`);
                
                // Iniciar monitoramento
                await this.startMonitoring(telegramId, publicKey);

                return {
                    success: true,
                    hasBalance: false,
                    completed: false,
                    data: result.data
                };
            }

        } catch (error) {
            this.logger.error('Erro ao verificar saldo de wallet importada', { 
                telegramId, 
                publicKey,
                error: error.message 
            });
            
            return { 
                success: false, 
                error: error.message 
            };
        }
    }

    /**
     * Enviar mensagem de sucesso para wallet importada com saldo
     */
    async sendImportedWalletSuccessMessage(telegramId, depositData) {
        try {
            let message = '🎉 *ÓTIMA NOTÍCIA!*\n\n';
            message += '✅ *Sua wallet importada já possui saldo suficiente!*\n\n';
            message += `💰 **Saldo detectado:** ${depositData.solAmount.toFixed(4)} SOL\n`;
            message += `💵 **Valor:** ~$${depositData.usdValue.toFixed(2)} USD\n\n`;
            message += `✨ **Tarefa de Funding Completa Automaticamente!**\n\n`;
            message += `🎯 **Próxima etapa desbloqueada:**\n`;
            message += `Agora você pode criar sua matriz e começar a ganhar!`;

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '🎯 Criar Matriz Agora', callback_data: 'task_create_matrix' }
                    ],
                    [
                        { text: '📊 Ver Meu Progresso', callback_data: 'show_progress' }
                    ],
                    [
                        { text: '💰 Ver Saldo Completo', callback_data: 'view_balance' }
                    ]
                ]
            };

            await this.bot.sendMessage(telegramId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

        } catch (error) {
            this.logger.error('Erro ao enviar mensagem de sucesso para wallet importada', { 
                telegramId, 
                error: error.message 
            });
        }
    }

    /**
     * Enviar notificação de saldo parcial em wallet importada
     */
    async sendPartialBalanceNotification(telegramId, balanceData) {
        try {
            const needed = balanceData.minimumUSD - balanceData.usdValue;
            const neededSOL = await this.priceService.usdToSOL(needed);

            let message = '⚠️ *WALLET IMPORTADA COM SALDO PARCIAL*\n\n';
            message += `📈 **Saldo encontrado:** ${balanceData.solAmount.toFixed(4)} SOL (~$${balanceData.usdValue.toFixed(2)})\n\n`;
            message += `❗ **Ainda faltam:** ~$${needed.toFixed(2)} USD\n`;
            message += `📊 **Progresso:** ${balanceData.percentage.toFixed(1)}% de $${balanceData.minimumUSD}\n\n`;
            message += `💡 **Para completar, envie:** ~${neededSOL.toFixed(4)} SOL\n\n`;
            message += `🔄 *Iniciando monitoramento automático...*\n`;
            message += `Vou avisar assim que o depósito for completado!`;

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '📋 Copiar Endereço', callback_data: `copy_address_${balanceData.publicKey || ''}` }
                    ],
                    [
                        { text: '💰 Como Comprar SOL?', callback_data: 'how_to_buy_sol' }
                    ],
                    [
                        { text: '🔄 Verificar Agora', callback_data: 'check_funding' }
                    ]
                ]
            };

            await this.bot.sendMessage(telegramId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

        } catch (error) {
            this.logger.error('Erro ao enviar notificação de saldo parcial', { 
                telegramId, 
                error: error.message 
            });
        }
    }

    /**
     * Realizar verificação de depósito
     * @param {string} telegramId - ID do usuário
     */
    async performCheck(telegramId) {
        const monitor = this.activeMonitors.get(telegramId);
        if (!monitor || monitor.isPaused) return;

        try {
            monitor.checkCount++;
            
            const result = await this.checkDeposit(telegramId, monitor.publicKey);
            
            if (result.success && result.completed) {
                // Depósito completo detectado!
                await this.handleDepositCompleted(telegramId, result.data);
                this.stopMonitoring(telegramId, 'completed');
            } else if (result.success && result.data) {
                // Atualizar dados do monitor
                const newBalance = result.data.lamports;
                
                // Verificar se é wallet importada com depósito adicional
                const balanceIncrease = newBalance - monitor.lastBalance;
                const isSignificantDeposit = balanceIncrease > 1000000; // > 0.001 SOL
                
                if (balanceIncrease > 0 && (isSignificantDeposit || monitor.options.importedWithPartialBalance)) {
                    // Novo depósito detectado
                    await this.handlePartialDeposit(telegramId, result.data);
                    monitor.lastBalance = newBalance;
                    
                    // Se wallet foi importada com saldo parcial, notificar progresso
                    if (monitor.options.importedWithPartialBalance) {
                        const progressMessage = `📈 *Progresso do Depósito*\n\n` +
                            `Saldo anterior: ${this.solanaService.lamportsToSol(monitor.options.initialBalance).toFixed(4)} SOL\n` +
                            `Saldo atual: ${result.data.solAmount.toFixed(4)} SOL\n` +
                            `Ainda faltam: ~$${(result.data.minimumUSD - result.data.usdValue).toFixed(2)} USD`;
                        
                        await this.bot.sendMessage(telegramId, progressMessage, { parse_mode: 'Markdown' });
                    }
                }
            }

        } catch (error) {
            this.logger.error('Erro na verificação de depósito', { 
                telegramId, 
                error: error.message 
            });
        }
    }

    /**
     * Verificar depósito individual
     * @param {string} telegramId - ID do usuário
     * @param {string} publicKey - Chave pública da wallet
     * @returns {Promise<object>} - Resultado da verificação
     */
    async checkDeposit(telegramId, publicKey) {
        try {
            // Obter saldo atual
            const lamports = await this.solanaService.getBalance(publicKey);
            
            // Verificar se atinge o mínimo USD
            const usdCheck = await this.priceService.checkMinimumUSD(
                lamports, 
                this.config.minimumUSD
            );

            const result = {
                telegramId,
                publicKey,
                timestamp: Date.now(),
                data: {
                    lamports,
                    solAmount: usdCheck.solAmount,
                    usdValue: usdCheck.usdValue,
                    solPrice: usdCheck.solPrice,
                    minimumUSD: usdCheck.minimumUSD,
                    difference: usdCheck.difference,
                    percentage: usdCheck.percentageOfMinimum
                },
                completed: usdCheck.isAboveMinimum
            };

            this.logger.debug('Verificação de depósito', {
                telegramId,
                usdValue: `$${usdCheck.usdValue.toFixed(2)}`,
                required: `$${usdCheck.minimumUSD}`,
                completed: result.completed
            });

            return { success: true, ...result };

        } catch (error) {
            this.logger.error('Erro ao verificar depósito', { 
                telegramId, 
                publicKey, 
                error: error.message 
            });
            
            return { 
                success: false, 
                error: error.message,
                telegramId,
                publicKey
            };
        }
    }

    /**
     * Tratar depósito completo
     * @param {string} telegramId - ID do usuário
     * @param {object} depositData - Dados do depósito
     */
    async handleDepositCompleted(telegramId, depositData) {
        try {
            this.logger.info(`Depósito completo detectado para ${telegramId}`, {
                usdValue: `$${depositData.usdValue.toFixed(2)}`,
                solAmount: depositData.solAmount.toFixed(4)
            });

            // Completar tarefa de funding
            await this.gamificationService.completeTask(telegramId, 'fund_wallet', {
                lamports: depositData.lamports,
                solAmount: depositData.solAmount,
                usdValue: depositData.usdValue,
                solPrice: depositData.solPrice,
                autoDetected: true,
                checkCount: this.activeMonitors.get(telegramId)?.checkCount || 0,
                timestamp: Date.now()
            });

            // Enviar notificação de sucesso
            let message = '🎉 *DEPÓSITO CONFIRMADO!*\n\n';
            message += `💰 **Recebido:** ${depositData.solAmount.toFixed(4)} SOL\n`;
            message += `💵 **Valor:** ~$${depositData.usdValue.toFixed(2)} USD\n\n`;
            message += `✅ **Tarefa de Funding Completa!**\n\n`;
            message += `🎯 **Próxima etapa desbloqueada:**\n`;
            message += `Agora você pode criar sua matriz e começar a ganhar!`;

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '🎯 Criar Matriz', callback_data: 'task_create_matrix' }
                    ],
                    [
                        { text: '📊 Ver Progresso', callback_data: 'show_progress' }
                    ],
                    [
                        { text: '💰 Ver Saldo Completo', callback_data: 'view_balance' }
                    ]
                ]
            };

            await this.bot.sendMessage(telegramId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

        } catch (error) {
            this.logger.error('Erro ao tratar depósito completo', { 
                telegramId, 
                error: error.message 
            });
        }
    }

    /**
     * Tratar depósito parcial
     * @param {string} telegramId - ID do usuário
     * @param {object} depositData - Dados do depósito parcial
     */
    async handlePartialDeposit(telegramId, depositData) {
        try {
            const needed = depositData.minimumUSD - depositData.usdValue;
            const neededSOL = await this.priceService.usdToSOL(needed);

            this.logger.info(`Depósito parcial detectado para ${telegramId}`, {
                current: `$${depositData.usdValue.toFixed(2)}`,
                needed: `$${needed.toFixed(2)}`
            });

            let message = '💰 *Depósito Detectado!*\n\n';
            message += `📈 **Saldo atual:** ${depositData.solAmount.toFixed(4)} SOL (~$${depositData.usdValue.toFixed(2)})\n\n`;
            message += `⚠️ **Ainda faltam:** ~$${needed.toFixed(2)} USD\n`;
            message += `📊 **Progresso:** ${depositData.percentage.toFixed(1)}% de $${depositData.minimumUSD}\n\n`;
            message += `💡 **Envie mais:** ~${neededSOL.toFixed(4)} SOL\n\n`;
            message += `🔄 Continuando monitoramento...`;

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '📋 Copiar Endereço', callback_data: `copy_address_${depositData.publicKey || ''}` }
                    ],
                    [
                        { text: '🔄 Verificar Agora', callback_data: 'check_funding' }
                    ],
                    [
                        { text: '⏸️ Pausar Notificações', callback_data: 'pause_monitoring' }
                    ]
                ]
            };

            await this.bot.sendMessage(telegramId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

        } catch (error) {
            this.logger.error('Erro ao tratar depósito parcial', { 
                telegramId, 
                error: error.message 
            });
        }
    }

    /**
     * Enviar lembrete periódico
     * @param {string} telegramId - ID do usuário
     */
    async sendReminder(telegramId) {
        const monitor = this.activeMonitors.get(telegramId);
        if (!monitor || monitor.isPaused) return;

        try {
            monitor.reminderCount++;

            // Verificar se atingiu o máximo de lembretes
            if (monitor.reminderCount > this.config.maxReminders) {
                this.stopMonitoring(telegramId, 'max_reminders');
                return;
            }

            // Verificar saldo atual
            const currentCheck = await this.checkDeposit(telegramId, monitor.publicKey);
            
            if (currentCheck.success && !currentCheck.completed) {
                const timeElapsed = Date.now() - monitor.startTime;
                const minutesElapsed = Math.floor(timeElapsed / 60000);
                
                let message = `⏰ **Lembrete ${monitor.reminderCount}/4**\n\n`;
                message += `💰 **Tarefa:** Depositar $${monitor.options.minimumUSD} USD em SOL\n`;
                message += `📊 **Saldo atual:** $${currentCheck.data.usdValue.toFixed(2)} USD\n`;
                message += `⏱️ **Tempo:** ${minutesElapsed} minutos monitorando\n\n`;
                
                if (currentCheck.data.usdValue > 0) {
                    const needed = monitor.options.minimumUSD - currentCheck.data.usdValue;
                    const neededSOL = await this.priceService.usdToSOL(needed);
                    message += `💡 **Faltam:** ~$${needed.toFixed(2)} (~${neededSOL.toFixed(4)} SOL)\n\n`;
                }
                
                message += `📍 **Seu endereço:**\n\`${monitor.publicKey}\``;

                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: '✅ Já Depositei', callback_data: 'check_funding' }
                        ],
                        [
                            { text: '📋 Copiar Endereço', callback_data: `copy_address_${monitor.publicKey}` }
                        ],
                        [
                            { text: '⏸️ Parar Notificações', callback_data: 'stop_monitoring' }
                        ],
                        [
                            { text: '💡 Preciso de Ajuda', callback_data: 'funding_help' }
                        ]
                    ]
                };

                await this.bot.sendMessage(telegramId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });

                this.logger.info(`Lembrete ${monitor.reminderCount} enviado para ${telegramId}`);
            }

        } catch (error) {
            this.logger.error('Erro ao enviar lembrete', { 
                telegramId, 
                error: error.message 
            });
        }
    }

    /**
     * Parar monitoramento
     * @param {string} telegramId - ID do usuário
     * @param {string} reason - Motivo da parada
     */
    stopMonitoring(telegramId, reason = 'manual') {
        const monitor = this.activeMonitors.get(telegramId);
        if (!monitor) return;

        try {
            // Limpar intervalos
            if (monitor.checkInterval) clearInterval(monitor.checkInterval);
            if (monitor.reminderInterval) clearInterval(monitor.reminderInterval);
            if (monitor.timeoutId) clearTimeout(monitor.timeoutId);

            // Remover do mapa
            this.activeMonitors.delete(telegramId);

            this.logger.info(`Monitoramento parado para ${telegramId}`, { 
                reason,
                duration: Date.now() - monitor.startTime,
                checkCount: monitor.checkCount,
                reminderCount: monitor.reminderCount
            });

            // Enviar mensagem de finalização se necessário
            if (reason === 'timeout') {
                this.sendTimeoutMessage(telegramId);
            } else if (reason === 'max_reminders') {
                this.sendMaxRemindersMessage(telegramId);
            }

        } catch (error) {
            this.logger.error('Erro ao parar monitoramento', { 
                telegramId, 
                reason, 
                error: error.message 
            });
        }
    }

    /**
     * Pausar monitoramento temporariamente
     * @param {string} telegramId - ID do usuário
     */
    pauseMonitoring(telegramId) {
        const monitor = this.activeMonitors.get(telegramId);
        if (!monitor) return false;

        monitor.isPaused = true;
        this.logger.info(`Monitoramento pausado para ${telegramId}`);
        return true;
    }

    /**
     * Retomar monitoramento
     * @param {string} telegramId - ID do usuário
     */
    resumeMonitoring(telegramId) {
        const monitor = this.activeMonitors.get(telegramId);
        if (!monitor) return false;

        monitor.isPaused = false;
        this.logger.info(`Monitoramento retomado para ${telegramId}`);
        return true;
    }

    /**
     * Verificar se usuário está sendo monitorado
     * @param {string} telegramId - ID do usuário
     * @returns {boolean} - True se está sendo monitorado
     */
    isMonitoring(telegramId) {
        return this.activeMonitors.has(telegramId);
    }

    /**
     * Obter status do monitoramento
     * @param {string} telegramId - ID do usuário
     * @returns {object|null} - Status do monitoramento
     */
    getMonitoringStatus(telegramId) {
        const monitor = this.activeMonitors.get(telegramId);
        if (!monitor) return null;

        return {
            telegramId,
            publicKey: monitor.publicKey,
            startTime: monitor.startTime,
            elapsed: Date.now() - monitor.startTime,
            checkCount: monitor.checkCount,
            reminderCount: monitor.reminderCount,
            isPaused: monitor.isPaused,
            lastBalance: monitor.lastBalance,
            minimumUSD: monitor.options.minimumUSD
        };
    }

    /**
     * Obter estatísticas gerais
     * @returns {object} - Estatísticas do serviço
     */
    getStats() {
        return {
            activeMonitors: this.activeMonitors.size,
            totalChecks: Array.from(this.activeMonitors.values())
                .reduce((sum, monitor) => sum + monitor.checkCount, 0),
            totalReminders: Array.from(this.activeMonitors.values())
                .reduce((sum, monitor) => sum + monitor.reminderCount, 0),
            config: this.config
        };
    }

    /**
     * Enviar mensagem de timeout
     * @param {string} telegramId - ID do usuário
     */
    async sendTimeoutMessage(telegramId) {
        try {
            let message = '⏰ **Monitoramento Finalizado**\n\n';
            message += `🕐 Monitoramos por 15 minutos e não detectamos o depósito mínimo.\n\n`;
            message += `💡 **Não se preocupe!** Você pode:\n`;
            message += `• Verificar manualmente quando fizer o depósito\n`;
            message += `• Usar o botão "Tarefa Concluída" após depositar\n\n`;
            message += `📍 **Seu endereço continua ativo:**\nReceberá automaticamente qualquer SOL enviado.`;

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '✅ Verificar Depósito', callback_data: 'check_funding' }
                    ],
                    [
                        { text: '🔄 Reiniciar Monitoramento', callback_data: 'restart_monitoring' }
                    ],
                    [
                        { text: '💡 Como Depositar?', callback_data: 'funding_help' }
                    ]
                ]
            };

            await this.bot.sendMessage(telegramId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

        } catch (error) {
            this.logger.error('Erro ao enviar mensagem de timeout', { 
                telegramId, 
                error: error.message 
            });
        }
    }

    /**
     * Enviar mensagem de máximo de lembretes
     * @param {string} telegramId - ID do usuário
     */
    async sendMaxRemindersMessage(telegramId) {
        try {
            let message = '🔕 **Notificações Pausadas**\n\n';
            message += `Enviamos 4 lembretes sobre o depósito.\n\n`;
            message += `💡 **Quando estiver pronto:**\n`;
            message += `Use o botão "Tarefa Concluída" após fazer o depósito.\n\n`;
            message += `📞 **Precisa de ajuda?**\nClique em "Como Depositar" para instruções.`;

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '✅ Tarefa Concluída', callback_data: 'check_funding' }
                    ],
                    [
                        { text: '📋 Copiar Endereço', callback_data: 'copy_address' }
                    ],
                    [
                        { text: '💡 Como Depositar?', callback_data: 'funding_help' }
                    ]
                ]
            };

            await this.bot.sendMessage(telegramId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });

        } catch (error) {
            this.logger.error('Erro ao enviar mensagem de max reminders', { 
                telegramId, 
                error: error.message 
            });
        }
    }

    /**
     * Limpar todos os monitoramentos
     */
    cleanup() {
        for (const telegramId of this.activeMonitors.keys()) {
            this.stopMonitoring(telegramId, 'cleanup');
        }
        this.logger.info('Todos os monitoramentos limpos');
    }
}

module.exports = DepositMonitorService;