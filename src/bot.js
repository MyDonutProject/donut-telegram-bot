// src/bot.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Database = require('./database/connection');

// Services
const WalletService = require('./services/wallet.service');
const SolanaService = require('./services/solana.service');
const ApiService = require('./services/api.service');
const GamificationService = require('./services/gamification.service');
const PriceService = require('./services/price.service');
const DepositMonitorService = require('./services/deposit-monitor.service');
const UserStateService = require('./services/user-state.service');
const MatrixService = require('./services/matrix.service');
const VoucherService = require('./services/voucher.service');
const BotAnchorClientService = require('./services/bot-anchor-client.service');

// Handlers
const CallbackHandler = require('./handlers/callback.handler');
const MessageHandler = require('./handlers/message.handler');
const WalletOperationsHandler = require('./handlers/wallet-operations.handler');
const SimplifiedFlowHandler = require('./handlers/simplified-flow.handler');
const MatrixHandler = require('./handlers/matrix.handler');
const VoucherHandler = require('./handlers/voucher.handler');

// Utils
const Logger = require('./utils/logger');
const logger = new Logger('DonutTelegramBot');

class DonutTelegramBot {
    constructor() {
        // Validar configuração
        this.validateConfig();

        // Inicializar bot
        this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { 
            polling: true,
            request: {
                agentOptions: {
                    keepAlive: true,
                    family: 4
                }
            }
        });

        // Estado do bot
        this.isRunning = false;
        this.userStates = new Map(); // Estados temporários dos usuários

        console.log('🍩 Donut Telegram Bot inicializado!');
    }

    validateConfig() {
        const required = [
            'TELEGRAM_BOT_TOKEN',
            'SOLANA_RPC_URL',
            'MATRIX_PROGRAM_ID',
            'AIRDROP_PROGRAM_ID'
        ];

        const missing = required.filter(key => !process.env[key]);
        if (missing.length > 0) {
            throw new Error(`Variáveis de ambiente ausentes: ${missing.join(', ')}`);
        }
    }

    async initServices() {
        try {
            console.log('📡 Inicializando serviços...');

            // Inicializar database
            this.db = new Database();
            await this.db.connect();

            // Inicializar serviços básicos
            this.walletService = new WalletService();
            await this.walletService.init();

            this.solanaService = new SolanaService();
            await this.solanaService.init();

            this.apiService = new ApiService();

            this.gamificationService = new GamificationService(this.db);
            this.userStateService = new UserStateService(this.db);
            this.priceService = new PriceService();
            this.depositMonitorService = new DepositMonitorService(this);
            
            // Inicializar BotAnchorClientService
            this.botAnchorClient = new BotAnchorClientService();
            await this.botAnchorClient.initialize();
            console.log('✅ BotAnchorClientService inicializado!');
            
            // Inicializar MatrixService com BotAnchorClientService
            this.matrixService = new MatrixService(
                this.db,
                this.walletService,
                this.solanaService,
                this.gamificationService,
                this.priceService
            );
            
            this.voucherService = new VoucherService(
                this.db,
                this.walletService
            );
            
            console.log('✅ Todos os serviços inicializados!');

        } catch (error) {
            console.error('❌ Erro ao inicializar serviços:', error);
            process.exit(1);
        }
    }

    setupHandlers() {
        console.log('🔧 Configurando handlers...');

        // Verificar se serviços estão inicializados
        if (!this.walletService || !this.solanaService) {
            throw new Error('Serviços devem ser inicializados antes dos handlers');
        }

        // Inicializar handlers principais
        this.simplifiedFlowHandler = new SimplifiedFlowHandler(this);
        this.callbackHandler = new CallbackHandler(this);
        this.messageHandler = new MessageHandler(this);
        this.walletOperationsHandler = new WalletOperationsHandler(this);
        
        // Inicializar handlers de matriz e voucher
        this.matrixHandler = new MatrixHandler(this);
        this.matrixHandler.setMatrixService(this.matrixService);
        
        this.voucherHandler = new VoucherHandler(this);
        this.voucherHandler.setServices(this.voucherService, this.matrixService);
        
        // Conectar handlers entre si
        this.callbackHandler.setMessageHandler(this.messageHandler);
        this.callbackHandler.walletOperationsHandler = this.walletOperationsHandler;
        this.callbackHandler.matrixHandler = this.matrixHandler;
        this.callbackHandler.voucherHandler = this.voucherHandler;
        this.walletOperationsHandler.setMessageHandler(this.messageHandler);
        this.messageHandler.setWalletOperationsHandler(this.walletOperationsHandler);
        this.messageHandler.setMatrixHandler(this.matrixHandler);
        this.messageHandler.setVoucherHandler(this.voucherHandler);
        
        console.log('✅ Handlers configurados e conectados!');

        // Comando principal - detecta vouchers
        this.bot.onText(/\/start(.*)/, async (msg, match) => {
            const telegramId = msg.from.id.toString();
            
            // Detectar voucher no parâmetro start
            if (match[1] && match[1].trim()) {
                const param = match[1].trim();
                
                if (param.startsWith('voucher_')) {
                    const voucherSlug = param.replace('voucher_', '');
                    console.log(`🎫 Voucher detectado: ${voucherSlug} para usuário ${telegramId}`);
                    
                    // Processar uso do voucher
                    const voucherResult = await this.voucherService.processVoucherUse(telegramId, voucherSlug);
                    
                    if (voucherResult.success) {
                        await this.bot.sendMessage(msg.chat.id,
                            `🎯 **Código de convite aceito!**\n\n` +
                            `Você foi convidado com o voucher: \`${voucherSlug}\`\n` +
                            `Ao criar sua matriz, você entrará na rede dessa pessoa!`,
                            { parse_mode: 'Markdown' }
                        );
                    } else if (voucherResult.error !== 'Você já foi referenciado anteriormente') {
                        await this.bot.sendMessage(msg.chat.id,
                            `⚠️ ${voucherResult.error}`,
                            { parse_mode: 'Markdown' }
                        );
                    }
                }
            }
            
            // Continuar com o fluxo normal
            await this.simplifiedFlowHandler.handleStart(msg, match);
        });

        // Comando de cancelamento
        this.bot.onText(/\/cancel/, (msg) => {
            const telegramId = msg.from.id.toString();
            this.messageHandler.clearUserState(telegramId);
            
            if (this.walletOperationsHandler) {
                this.walletOperationsHandler.clearSendState(telegramId);
            }
            
            this.bot.sendMessage(msg.chat.id, '❌ Ação cancelada.', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⬅️ Menu Principal', callback_data: 'main_menu' }]
                    ]
                }
            });
        });

        // Comando admin
        this.bot.onText(/\/admin/, async (msg) => {
            const telegramId = msg.from.id.toString();
            
            if (!this.isAdmin(telegramId)) {
                await this.bot.sendMessage(msg.chat.id, '❌ Acesso negado.');
                return;
            }

            const message = `🔧 *Painel Administrativo*\n\nEscolha uma opção:`;
            const keyboard = {
                inline_keyboard: [
                    [{ text: '📊 Estatísticas', callback_data: 'admin_stats' }],
                    [{ text: '👥 Usuários Ativos', callback_data: 'admin_users' }],
                    [{ text: '🎯 Matrizes Ativas', callback_data: 'admin_matrices' }],
                    [{ text: '🎫 Top Vouchers', callback_data: 'admin_vouchers' }],
                    [{ text: '📢 Broadcast', callback_data: 'admin_broadcast' }]
                ]
            };

            await this.bot.sendMessage(msg.chat.id, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        });

        // Callback queries (botões)
        this.bot.on('callback_query', (query) => this.callbackHandler.handleCallback(query));

        // Mensagens de texto
        this.bot.on('message', (msg) => {
            // Filtrar comandos para evitar processamento duplo
            if (!msg.text || msg.text.startsWith('/')) {
                return;
            }
            this.messageHandler.handleMessage(msg);
        });

        // Handlers de erro
        this.bot.on('polling_error', (error) => {
            console.error('❌ Polling error:', error);
            logger.error('Polling error', { error: error.message });
            
            if (error.code === 'EFATAL' || error.code === 'ETELEGRAM') {
                console.log('🔄 Tentando reconectar em 5 segundos...');
                setTimeout(() => {
                    this.bot.startPolling();
                }, 5000);
            }
        });

        this.bot.on('error', (error) => {
            console.error('❌ Bot error:', error);
            logger.error('Bot error', { error: error.message });
        });

        console.log('✅ Handlers configurados!');
    }

    setupMiddlewares() {
        console.log('🛡️ Configurando middlewares...');

        // Rate limiting simples
        this.rateLimiter = new Map();
        
        // Middleware para todas as mensagens
        this.bot.on('message', (msg) => {
            const userId = msg.from?.id?.toString();
            if (!userId) return;

            const now = Date.now();

            // Rate limiting: máximo 10 mensagens por minuto
            if (!this.rateLimiter.has(userId)) {
                this.rateLimiter.set(userId, []);
            }

            const userRequests = this.rateLimiter.get(userId);
            const oneMinuteAgo = now - 60000;

            // Limpar requests antigos
            const recentRequests = userRequests.filter(time => time > oneMinuteAgo);
            this.rateLimiter.set(userId, recentRequests);

            // Verificar limite
            if (recentRequests.length >= 10) {
                // Não responder se já enviou aviso recentemente
                const lastWarning = this.rateLimiter.get(`${userId}_warned`);
                if (!lastWarning || now - lastWarning > 30000) {
                    this.bot.sendMessage(msg.chat.id, '⚠️ Muitas mensagens. Aguarde um momento.');
                    this.rateLimiter.set(`${userId}_warned`, now);
                }
                return;
            }

            // Adicionar request atual
            recentRequests.push(now);

            // Log de atividade
            logger.debug('User activity', { 
                userId, 
                username: msg.from?.username,
                action: msg.text?.substring(0, 50) 
            });
        });

        console.log('✅ Middlewares configurados!');
    }

    async start() {
        try {
            // Inicializar serviços PRIMEIRO
            await this.initServices();
            
            // DEPOIS configurar handlers
            this.setupHandlers();
            
            // DEPOIS configurar middlewares
            this.setupMiddlewares();

            this.isRunning = true;
            
            console.log('🚀 Bot iniciado com sucesso!');
            console.log('📱 Aguardando mensagens...');
            console.log(`🤖 Bot username: @${(await this.bot.getMe()).username}`);

            // Iniciar monitoramento em background
            await this.startBackgroundTasks();

            // Log inicial
            logger.info('Bot started successfully', {
                botUsername: (await this.bot.getMe()).username,
                environment: process.env.NODE_ENV || 'development'
            });

        } catch (error) {
            console.error('❌ Erro ao iniciar bot:', error);
            logger.error('Failed to start bot', { error: error.message });
            process.exit(1);
        }
    }

    async startBackgroundTasks() {
        console.log('🔄 Iniciando tarefas em background...');

        // Monitoramento de funding
        this.fundingMonitor = setInterval(async () => {
            try {
                await this.monitorFunding();
            } catch (error) {
                logger.error('Funding monitor error', { error: error.message });
            }
        }, parseInt(process.env.FUNDING_CHECK_INTERVAL) || 30000);

        // Monitoramento de matrizes
        this.matrixMonitor = setInterval(async () => {
            try {
                await this.monitorMatrices();
            } catch (error) {
                logger.error('Matrix monitor error', { error: error.message });
            }
        }, parseInt(process.env.MATRIX_CHECK_INTERVAL) || 60000);

        // Limpeza de rate limiter
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            const fiveMinutesAgo = now - 300000;
            
            for (const [userId, requests] of this.rateLimiter.entries()) {
                if (userId.endsWith('_warned')) continue;
                
                const recentRequests = requests.filter(time => time > fiveMinutesAgo);
                if (recentRequests.length === 0) {
                    this.rateLimiter.delete(userId);
                    this.rateLimiter.delete(`${userId}_warned`);
                } else {
                    this.rateLimiter.set(userId, recentRequests);
                }
            }
            
            logger.debug('Rate limiter cleanup completed', { 
                usersTracked: this.rateLimiter.size 
            });
        }, 300000);

        console.log('✅ Tarefas em background iniciadas!');
    }

    async monitorFunding() {
        try {
            // Buscar usuários aguardando funding
            const pendingFunding = await this.db.all(`
                SELECT u.telegram_id, w.public_key 
                FROM users u 
                JOIN wallets w ON u.telegram_id = w.telegram_id 
                JOIN tasks t ON u.telegram_id = t.telegram_id 
                WHERE t.task_type = 'fund_wallet' 
                AND t.status = 'pending'
                AND w.is_active = 1
                LIMIT 10
            `);

            for (const user of pendingFunding) {
                try {
                    // Verificar se já está sendo monitorado
                    if (this.depositMonitorService && this.depositMonitorService.isMonitoring(user.telegram_id)) {
                        logger.debug(`Usuário ${user.telegram_id} já está sendo monitorado`);
                        continue;
                    }

                    // Verificar depósito
                    const result = await this.depositMonitorService.checkDeposit(
                        user.telegram_id, 
                        user.public_key
                    );

                    if (result.success && result.completed) {
                        // Funding detectado!
                        await this.gamificationService.completeTask(user.telegram_id, 'fund_wallet', {
                            lamports: result.data.lamports,
                            solAmount: result.data.solAmount,
                            usdValue: result.data.usdValue,
                            solPrice: result.data.solPrice,
                            autoDetected: true,
                            backgroundMonitor: true,
                            timestamp: Date.now()
                        });

                        // Notificar usuário
                        let message = '✅ *FUNDING CONFIRMADO!*\n\n';
                        message += `💰 **Recebido:** ${result.data.solAmount.toFixed(4)} SOL\n`;
                        message += `💵 **Valor:** ~$${result.data.usdValue.toFixed(2)} USD\n\n`;
                        message += '🎯 **Tarefa de funding completada!**\n';
                        message += 'Próxima tarefa desbloqueada!';

                        const keyboard = {
                            inline_keyboard: [
                                [{ text: '🎯 Próxima Tarefa', callback_data: 'task_create_matrix' }],
                                [{ text: '📊 Ver Progresso', callback_data: 'show_progress' }]
                            ]
                        };

                        await this.bot.sendMessage(user.telegram_id, message, { 
                            parse_mode: 'Markdown',
                            reply_markup: keyboard 
                        });

                        logger.info('Funding detectado via monitor background', { 
                            telegramId: user.telegram_id,
                            usdValue: result.data.usdValue,
                            solAmount: result.data.solAmount
                        });
                    }
                } catch (error) {
                    logger.error('Erro no monitoramento background de funding', { 
                        telegramId: user.telegram_id, 
                        error: error.message 
                    });
                }
            }
        } catch (error) {
            logger.error('Erro geral no monitoramento de funding:', error);
        }
    }

    async monitorMatrices() {
        try {
            // Buscar matrizes ativas para sincronizar
            const activeMatrices = await this.db.all(`
                SELECT DISTINCT telegram_id 
                FROM user_matrices 
                WHERE status = 'active'
                LIMIT 5
            `);

            for (const matrix of activeMatrices) {
                try {
                    // Sincronizar com blockchain
                    await this.matrixService.syncWithBlockchain(matrix.telegram_id);
                    
                    // Verificar se teve mudanças nos slots
                    const stats = await this.matrixService.getMatrixStats(matrix.telegram_id);
                    
                    // Se algum slot foi preenchido recentemente, notificar
                    if (stats.hasMatrix && stats.totalSlotsFilled > 0) {
                        logger.debug(`Matriz sincronizada para ${matrix.telegram_id}: ${stats.totalSlotsFilled} slots preenchidos`);
                    }
                    
                } catch (error) {
                    logger.error('Erro ao sincronizar matriz:', { 
                        telegramId: matrix.telegram_id,
                        error: error.message 
                    });
                }
            }
        } catch (error) {
            logger.error('Erro no monitoramento de matrizes:', error);
        }
    }

    async stop() {
        try {
            this.isRunning = false;
            
            console.log('⏹️ Parando bot...');
            
            // Limpar monitoramentos
            if (this.depositMonitorService) {
                console.log('🧹 Limpando monitoramentos de depósito...');
                this.depositMonitorService.cleanup();
            }
            
            // Parar intervalos
            if (this.fundingMonitor) clearInterval(this.fundingMonitor);
            if (this.matrixMonitor) clearInterval(this.matrixMonitor);
            if (this.cleanupInterval) clearInterval(this.cleanupInterval);
            
            // Parar polling do bot
            await this.bot.stopPolling();
            
            // Fechar conexão com banco
            if (this.db) {
                this.db.close();
            }

            console.log('✅ Bot parado com sucesso!');
            logger.info('Bot stopped');

        } catch (error) {
            console.error('❌ Erro ao parar bot:', error);
            logger.error('Error stopping bot', { error: error.message });
        }
    }

    // Métodos utilitários
    isAdmin(telegramId) {
        const adminId = process.env.TELEGRAM_ADMIN_ID;
        return adminId && telegramId.toString() === adminId;
    }

    async sendMessage(telegramId, text, options = {}) {
        try {
            return await this.bot.sendMessage(telegramId, text, options);
        } catch (error) {
            logger.error('Failed to send message', { 
                telegramId, 
                error: error.message 
            });
            throw error;
        }
    }

    getUserState(telegramId) {
        return this.userStates.get(telegramId.toString()) || {};
    }

    setUserState(telegramId, state) {
        this.userStates.set(telegramId.toString(), state);
    }

    clearUserState(telegramId) {
        this.userStates.delete(telegramId.toString());
    }
}

// Inicializar e executar bot
async function main() {
    try {
        const bot = new DonutTelegramBot();
        
        // Registrar timestamp de início
        bot.startTime = Date.now();
        
        await bot.start();

        // Graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n🛑 Recebido SIGINT. Parando bot...');
            await bot.stop();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            console.log('\n🛑 Recebido SIGTERM. Parando bot...');
            await bot.stop();
            process.exit(0);
        });

        // Tratamento de erros não capturados
        process.on('uncaughtException', (error) => {
            console.error('❌ Erro não capturado:', error);
            logger.error('Uncaught exception', { error: error.message, stack: error.stack });
            
            // Tentar parar o bot graciosamente
            bot.stop().finally(() => {
                process.exit(1);
            });
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('❌ Promise rejeitada:', reason);
            logger.error('Unhandled rejection', { reason });
        });

    } catch (error) {
        console.error('❌ Erro fatal:', error);
        process.exit(1);
    }
}

// Executar se for arquivo principal
if (require.main === module) {
    main();
}

module.exports = DonutTelegramBot;