// src/handlers/message.handler.js
const Logger = require('../utils/logger');
const WalletService = require('../services/wallet.service');
const SolanaService = require('../services/solana.service');
const ApiService = require('../services/api.service');
const GamificationService = require('../services/gamification.service');
const MainKeyboard = require('../keyboards/main.keyboard');
const WalletKeyboard = require('../keyboards/wallet.keyboard');
const { validators } = require('../utils/validation');
const { formatters } = require('../utils/formatting');

class MessageHandler {
    constructor(bot) {
        this.bot = bot.bot;
        this.botInstance = bot;
        this.db = bot.db;
        
        this.walletService = bot.walletService;
        this.solanaService = bot.solanaService;
        this.apiService = bot.apiService;
        this.gamificationService = bot.gamificationService;
        
        // Handlers injetados
        this.walletOperationsHandler = null;
        this.matrixHandler = null;
        this.voucherHandler = null;
        
        this.logger = new Logger('MessageHandler');
        
        // Mapas internos para gerenciamento de estado
        this.userStates = new Map();
        this.messageIds = new Map();
    }

    /**
     * Injetar WalletOperationsHandler para evitar dependência circular
     */
    setWalletOperationsHandler(handler) {
        this.walletOperationsHandler = handler;
        this.logger.info('WalletOperationsHandler conectado ao MessageHandler');
    }

    /**
     * Injetar MatrixHandler
     */
    setMatrixHandler(handler) {
        this.matrixHandler = handler;
        this.logger.info('MatrixHandler conectado ao MessageHandler');
    }

    /**
     * Injetar VoucherHandler
     */
    setVoucherHandler(handler) {
        this.voucherHandler = handler;
        this.logger.info('VoucherHandler conectado ao MessageHandler');
    }

    /**
     * Processar mensagens de texto baseado no estado do usuário
     */
    async handleMessage(msg) {
        const telegramId = msg.from.id.toString();
        const text = msg.text?.trim();
        const chatId = msg.chat.id;

        if (!text) return;

        try {
            // CORREÇÃO: Buscar estado tanto do handler local quanto do botInstance
            let userState = this.getUserState(telegramId);
            
            // Se não tem estado local, verificar no botInstance
            if (!userState) {
                const botState = this.botInstance.getUserState(telegramId);
                if (botState && botState.action) {
                    userState = {
                        state: botState.action,
                        data: botState
                    };
                    this.logger.debug(`Estado recuperado do botInstance para ${telegramId}: ${botState.action}`);
                }
            }
            
            this.logger.info(`Mensagem recebida de ${telegramId}: ${text.substring(0, 50)} (estado: ${userState?.state || 'nenhum'})`);

            // Auto-deletar mensagens de PIN após 3 segundos
            if (userState?.state && userState.state.includes('pin')) {
                setTimeout(() => {
                    this.bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                }, 3000);
            }

            if (!userState) {
                return await this.handleUnknownMessage(chatId, telegramId, text);
            }

            switch (userState.state) {
                // ========== ESTADOS DE CRIAÇÃO DE WALLET ==========
                case 'waiting_pin_for_creation':
                    return await this.processPinForCreation(text, chatId, telegramId, msg.message_id);
                
                case 'waiting_pin_confirmation':
                    return await this.processPinConfirmation(text, chatId, telegramId, userState.data, msg.message_id);
                
                case 'waiting_wallet_name':
                    return await this.processWalletName(text, chatId, telegramId, userState.data);
                
                // ========== ESTADOS DE IMPORTAÇÃO VIA SEED ==========
                case 'waiting_seed_for_import':
                    return await this.processSeedForImport(text, chatId, telegramId);
                
                case 'waiting_pin_after_seed':
                    return await this.processPinAfterSeed(text, chatId, telegramId, userState.data, msg.message_id);
                
                case 'waiting_pin_confirmation_after_seed':
                    return await this.processPinConfirmationAfterSeed(text, chatId, telegramId, userState.data, msg.message_id);
                
                // ========== ESTADOS DE IMPORTAÇÃO VIA PRIVATE KEY ==========
                case 'waiting_private_key_for_import':
                    return await this.processPrivateKeyForImport(text, chatId, telegramId);
                
                case 'waiting_pin_after_private_key':
                    return await this.processPinAfterPrivateKey(text, chatId, telegramId, userState.data, msg.message_id);
                
                case 'waiting_pin_confirmation_after_key':
                    return await this.processPinConfirmationAfterKey(text, chatId, telegramId, userState.data, msg.message_id);
                
                // ========== ESTADOS DE IMPORTAÇÃO (COMPATIBILIDADE) ==========
                case 'waiting_pin_for_import':
                    return await this.processPinForImport(text, chatId, telegramId, userState.data, msg.message_id);
                
                // ========== ESTADOS DE VISUALIZAÇÃO ==========
                case 'waiting_pin_for_seed':
                    return await this.processPinToShowSeed(text, chatId, telegramId, msg.message_id);
                
                // ========== ESTADOS DE ALTERAÇÃO DE PIN ==========
                case 'waiting_old_pin':
                    return await this.processOldPin(text, chatId, telegramId, msg.message_id);
                
                case 'waiting_new_pin':
                    return await this.processNewPin(text, chatId, telegramId, userState.data, msg.message_id);
                
                case 'waiting_new_pin_confirmation':
                    return await this.processNewPinConfirmation(text, chatId, telegramId, userState.data, msg.message_id);
                
                // ========== ESTADOS DE DELEÇÃO ==========
                case 'waiting_delete_confirmation':
                    return await this.processDeleteConfirmation(text, chatId, telegramId);
                
                case 'waiting_pin_for_delete':
                    return await this.processPinForDelete(text, chatId, telegramId, msg.message_id);
                
                // ========== ESTADOS DE ENVIO ==========
                case 'waiting_recipient_address':
                    if (this.walletOperationsHandler) {
                        return await this.walletOperationsHandler.processRecipientAddress(text, chatId, telegramId);
                    }
                    break;
                
                case 'waiting_send_amount':
                    if (this.walletOperationsHandler) {
                        return await this.walletOperationsHandler.processAmountToSend(text, chatId, telegramId);
                    }
                    break;
                
                case 'waiting_pin_for_send':
                    if (this.walletOperationsHandler) {
                        const result = await this.walletOperationsHandler.processPinForSend(text, chatId, telegramId);
                        setTimeout(async () => {
                            try {
                                await this.bot.deleteMessage(chatId, msg.message_id);
                            } catch (e) {}
                        }, 3000);
                        return result;
                    }
                    break;
                
                // ========== NOVOS ESTADOS PARA MATRIZ ==========
                case 'waiting_pin_for_matrix':
                    return await this.processPinForMatrix(text, chatId, telegramId, msg.message_id, userState.data);
                
                // ========== NOVOS ESTADOS PARA VOUCHER ==========
                case 'waiting_voucher_slug':
                    return await this.processVoucherSlug(text, chatId, telegramId);
                
                default:
                    return await this.handleUnknownMessage(chatId, telegramId, text);
            }

        } catch (error) {
            this.logger.error('Erro ao processar mensagem:', error);
            await this.sendErrorMessage(chatId, 'Erro ao processar mensagem. Tente novamente.');
        }
    }

    // ========== PROCESSADORES DE CRIAÇÃO DE WALLET ==========

    async processPinForCreation(pin, chatId, telegramId, messageId) {
        pin = pin.trim();

        setTimeout(async () => {
            try {
                await this.bot.deleteMessage(chatId, messageId);
            } catch (e) {}
        }, 3000);

        if (pin.toLowerCase() === 'cancelar' || pin === '/cancel') {
            this.clearUserState(telegramId);
            return await this.sendMessage(chatId, '❌ Criação de wallet cancelada.', MainKeyboard.getBackMenu());
        }

        if (!validators.isValidPin(pin)) {
            return await this.sendMessage(chatId, 
                '❌ *PIN inválido!*\n\n' +
                '🔢 O PIN deve ter 4 ou 6 dígitos numéricos.\n\n' +
                '💡 Exemplo: 1234 ou 123456\n\n' +
                'Digite novamente:'
            );
        }

        const pinValidation = validators.isStrongPin(pin);
        if (!pinValidation.isStrong) {
            return await this.sendMessage(chatId,
                `❌ *PIN fraco!*\n\n${pinValidation.reason}\n\n` +
                'Digite um PIN mais seguro:'
            );
        }

        this.setUserState(telegramId, 'waiting_pin_confirmation', { firstPin: pin });

        return await this.sendMessage(chatId, 
            '✅ *PIN aceito!*\n\n' +
            '🔐 *Digite o PIN novamente para confirmar:*\n\n' +
            '⚠️ Certifique-se de que é o mesmo PIN.'
        );
    }

    async processPinConfirmation(pin, chatId, telegramId, data, messageId) {
        pin = pin.trim();

        setTimeout(async () => {
            try {
                await this.bot.deleteMessage(chatId, messageId);
            } catch (e) {}
        }, 3000);

        if (pin.toLowerCase() === 'cancelar' || pin === '/cancel') {
            this.clearUserState(telegramId);
            return await this.sendMessage(chatId, '❌ Criação de wallet cancelada.', MainKeyboard.getBackMenu());
        }

        if (pin !== data.firstPin) {
            this.setUserState(telegramId, 'waiting_pin_for_creation');
            return await this.sendMessage(chatId,
                '❌ *Os PINs não conferem!*\n\n' +
                'Por segurança, vamos começar novamente.\n' +
                'Digite seu novo PIN (4 ou 6 dígitos):'
            );
        }

        // PINs coincidem, pedir nome da wallet
        this.setUserState(telegramId, 'waiting_wallet_name', { pin: data.firstPin });
        
        return await this.sendMessage(chatId, 
            '✅ *PIN confirmado!*\n\n' +
            '📝 *Nome da Wallet*\n\n' +
            'Dê um nome para sua wallet (ex: Principal, Trading, etc):',
            { parse_mode: 'Markdown' }
        );
    }

    async processWalletName(text, chatId, telegramId, data) {
        if (!data || !data.pin) {
            this.clearUserState(telegramId);
            return await this.sendMessage(chatId, '❌ Erro no processo. Tente novamente com /start');
        }

        const walletName = text.substring(0, 30); // Limitar tamanho

        try {
            await this.sendMessage(chatId, '🔄 Criando sua wallet...');

            const result = await this.walletService.createWallet(telegramId, data.pin, walletName);
            
            if (!result.success) {
                this.clearUserState(telegramId);
                return await this.sendErrorMessage(chatId, result.error);
            }

            this.clearUserState(telegramId);

            // Formatar seed phrase numerada
            const seedWords = result.seedPhrase.split(' ');
            const seedFormatted = seedWords.map((word, i) => 
                `${i + 1}. ${word}`
            ).join('\n');

            let message = '✅ *Wallet Criada com Sucesso!*\n\n';
            message += `🔑 *Seu endereço:*\n\`${result.publicKey}\`\n\n`;
            message += '🌱 *SEED PHRASE - ANOTE AGORA:*\n';
            message += '```\n' + seedFormatted + '\n```\n';
            message += '⚠️ *IMPORTANTE:*\n';
            message += '• Anote estas palavras em ordem\n';
            message += '• Guarde em local seguro\n';
            message += '• Nunca compartilhe com ninguém\n';
            message += '• Você só verá isso UMA VEZ!\n\n';
            message += '✅ PIN configurado com sucesso!';

            await this.gamificationService.completeTask(telegramId, 'create_wallet', {
                walletCreated: true,
                publicKey: result.publicKey,
                timestamp: Date.now()
            });

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '✅ Anotei a Seed Phrase', callback_data: 'confirm_seed_saved' }
                    ],
                    [
                        { text: '💰 Ver Saldo', callback_data: 'view_balance' }
                    ],
                    [
                        { text: '📋 Próxima Tarefa', callback_data: 'show_progress' }
                    ]
                ]
            };

            const sentMsg = await this.sendMessage(chatId, message, keyboard);
            
            // Auto-deletar após 2 minutos
            setTimeout(() => {
                this.bot.deleteMessage(chatId, sentMsg.message_id).catch(() => {});
            }, 120000);

            return sentMsg;

        } catch (error) {
            this.logger.error('Erro ao criar wallet:', error);
            this.clearUserState(telegramId);
            return await this.sendErrorMessage(chatId, 'Erro ao criar wallet. Tente novamente.');
        }
    }

    // ========== PROCESSADORES DE IMPORTAÇÃO VIA SEED ==========

    async processSeedForImport(seedPhrase, chatId, telegramId) {
        seedPhrase = seedPhrase.trim().toLowerCase();

        if (seedPhrase === '/cancel' || seedPhrase === 'cancelar') {
            this.clearUserState(telegramId);
            return await this.sendMessage(chatId, 
                '❌ Importação cancelada.',
                {
                    inline_keyboard: [
                        [{ text: '⬅️ Voltar ao Menu', callback_data: 'task_create_wallet' }]
                    ]
                }
            );
        }

        if (!validators.isValidSeedPhrase(seedPhrase)) {
            return await this.sendMessage(chatId,
                '❌ *Seed phrase inválida!*\n\n' +
                '🔑 A seed phrase deve ter 12 ou 24 palavras válidas.\n\n' +
                '💡 Exemplo:\n' +
                '`word1 word2 word3 ... word12`\n\n' +
                'Digite novamente ou /cancel para cancelar:',
                {
                    inline_keyboard: [
                        [{ text: '❌ Cancelar', callback_data: 'cancel_import' }]
                    ]
                }
            );
        }

        // Auto-deletar mensagem com seed
        const msg = await this.sendMessage(chatId, '🔒 Mensagem com seed será deletada por segurança...');
        setTimeout(() => {
            this.bot.deleteMessage(chatId, msg.message_id - 1).catch(() => {});
            this.bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 3000);

        this.setUserState(telegramId, 'waiting_pin_after_seed', { seedPhrase });

        let message = '✅ *Seed phrase válida!*\n\n';
        message += '🔐 Agora defina um PIN de segurança.\n';
        message += 'Digite um PIN de 4 ou 6 dígitos:\n\n';
        message += '⚠️ Este PIN protegerá sua wallet no bot.';

        return await this.sendMessage(chatId, message);
    }

    async processPinAfterSeed(pin, chatId, telegramId, data, messageId) {
        pin = pin.trim();

        setTimeout(async () => {
            try {
                await this.bot.deleteMessage(chatId, messageId);
            } catch (e) {}
        }, 3000);

        const { seedPhrase } = data;

        if (!validators.isValidPin(pin)) {
            return await this.sendMessage(chatId, 
                '❌ *PIN inválido!*\n\n' +
                '🔢 O PIN deve ter 4 ou 6 dígitos numéricos.\n\n' +
                'Digite novamente:'
            );
        }

        const pinValidation = validators.isStrongPin(pin);
        if (!pinValidation.isStrong) {
            return await this.sendMessage(chatId,
                `❌ *PIN fraco!*\n\n${pinValidation.reason}\n\n` +
                'Digite um PIN mais seguro:'
            );
        }

        this.setUserState(telegramId, 'waiting_pin_confirmation_after_seed', { seedPhrase, firstPin: pin });

        return await this.sendMessage(chatId, 
            '✅ *PIN aceito!*\n\n' +
            '🔐 *Digite o PIN novamente para confirmar:*\n\n' +
            '⚠️ Certifique-se de que é o mesmo PIN.'
        );
    }

    async processPinConfirmationAfterSeed(pin, chatId, telegramId, data, messageId) {
        pin = pin.trim();

        setTimeout(async () => {
            try {
                await this.bot.deleteMessage(chatId, messageId);
            } catch (e) {}
        }, 3000);

        const { seedPhrase, firstPin } = data;

        if (pin !== firstPin) {
            this.setUserState(telegramId, 'waiting_pin_after_seed', { seedPhrase });
            return await this.sendMessage(chatId,
                '❌ *Os PINs não conferem!*\n\n' +
                'Por segurança, vamos começar novamente.\n' +
                'Digite seu novo PIN (4 ou 6 dígitos):'
            );
        }

        try {
            await this.sendMessage(chatId, '🔄 Importando sua wallet...');

            const result = await this.walletService.importWallet(telegramId, seedPhrase, pin);
            
            if (!result.success) {
                this.clearUserState(telegramId);
                return await this.sendErrorMessage(chatId, result.error);
            }

            this.clearUserState(telegramId);

            // Verificar saldo após importação
            const simplifiedFlow = this.botInstance.simplifiedFlowHandler;
            if (simplifiedFlow) {
                await simplifiedFlow.handleWalletImported(chatId, telegramId, result);
            }

            let message = '✅ *Wallet Importada com Sucesso!*\n\n';
            message += `🔑 *Seu endereço:*\n\`${result.publicKey}\`\n\n`;
            message += `🏷️ *Nome:* ${result.walletName}\n`;
            message += '🔐 *PIN:* Configurado com sucesso\n\n';
            
            if (result.restoredProgress) {
                message += '♻️ *Progresso anterior restaurado!*\n\n';
            }
            
            message += '✨ Sua wallet está pronta para uso!';

            await this.gamificationService.completeTask(telegramId, 'create_wallet', {
                walletCreated: true,
                imported: true,
                publicKey: result.publicKey,
                timestamp: Date.now()
            });

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '💰 Ver Saldo', callback_data: 'view_balance' }
                    ],
                    [
                        { text: '📋 Próxima Tarefa', callback_data: 'show_progress' }
                    ],
                    [
                        { text: '⬅️ Menu Principal', callback_data: 'main_menu' }
                    ]
                ]
            };

            return await this.sendMessage(chatId, message, keyboard);

        } catch (error) {
            this.logger.error('Erro ao importar wallet:', error);
            this.clearUserState(telegramId);
            return await this.sendErrorMessage(chatId, 'Erro ao importar wallet.');
        }
    }

    // ========== PROCESSADORES DE IMPORTAÇÃO VIA PRIVATE KEY ==========

    async processPrivateKeyForImport(privateKey, chatId, telegramId) {
        privateKey = privateKey.trim();

        if (privateKey.toLowerCase() === '/cancel' || privateKey.toLowerCase() === 'cancelar') {
            this.clearUserState(telegramId);
            return await this.sendMessage(chatId, 
                '❌ Importação cancelada.',
                {
                    inline_keyboard: [
                        [{ text: '⬅️ Voltar ao Menu', callback_data: 'import_wallet' }]
                    ]
                }
            );
        }

        if (!validators.isValidPrivateKey(privateKey)) {
            return await this.sendMessage(chatId,
                '❌ *Private key inválida!*\n\n' +
                '🔐 Formatos aceitos:\n' +
                '• Base58 (Phantom/Solflare): ~88 caracteres\n' +
                '• Array: [1,2,3,...] com 64 números\n' +
                '• Base64 ou Hex\n\n' +
                '💡 Copie diretamente do seu wallet.\n\n' +
                'Digite novamente ou /cancel para cancelar:',
                {
                    inline_keyboard: [
                        [{ text: '❌ Cancelar', callback_data: 'import_wallet' }]
                    ]
                }
            );
        }

        // Auto-deletar mensagem com private key
        const msg = await this.sendMessage(chatId, '🔒 Mensagem com private key será deletada por segurança...');
        setTimeout(() => {
            this.bot.deleteMessage(chatId, msg.message_id - 1).catch(() => {});
            this.bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        }, 3000);

        this.setUserState(telegramId, 'waiting_pin_after_private_key', { privateKey });

        let message = '✅ *Private key válida!*\n\n';
        message += '🔐 Agora defina um PIN de segurança.\n';
        message += 'Digite um PIN de 4 ou 6 dígitos:\n\n';
        message += '⚠️ Este PIN protegerá sua wallet no bot.';

        return await this.sendMessage(chatId, message);
    }

    async processPinAfterPrivateKey(pin, chatId, telegramId, data, messageId) {
        pin = pin.trim();

        setTimeout(async () => {
            try {
                await this.bot.deleteMessage(chatId, messageId);
            } catch (e) {}
        }, 3000);

        const { privateKey } = data;

        if (!validators.isValidPin(pin)) {
            return await this.sendMessage(chatId, 
                '❌ *PIN inválido!*\n\n' +
                '🔢 O PIN deve ter 4 ou 6 dígitos numéricos.\n\n' +
                'Digite novamente:'
            );
        }

        const pinValidation = validators.isStrongPin(pin);
        if (!pinValidation.isStrong) {
            return await this.sendMessage(chatId,
                `❌ *PIN fraco!*\n\n${pinValidation.reason}\n\n` +
                'Digite um PIN mais seguro:'
            );
        }

        this.setUserState(telegramId, 'waiting_pin_confirmation_after_key', { privateKey, firstPin: pin });

        return await this.sendMessage(chatId, 
            '✅ *PIN aceito!*\n\n' +
            '🔐 *Digite o PIN novamente para confirmar:*\n\n' +
            '⚠️ Certifique-se de que é o mesmo PIN.'
        );
    }

    async processPinConfirmationAfterKey(pin, chatId, telegramId, data, messageId) {
        pin = pin.trim();

        setTimeout(async () => {
            try {
                await this.bot.deleteMessage(chatId, messageId);
            } catch (e) {}
        }, 3000);

        const { privateKey, firstPin } = data;

        if (pin !== firstPin) {
            this.setUserState(telegramId, 'waiting_pin_after_private_key', { privateKey });
            return await this.sendMessage(chatId,
                '❌ *Os PINs não conferem!*\n\n' +
                'Por segurança, vamos começar novamente.\n' +
                'Digite seu novo PIN (4 ou 6 dígitos):'
            );
        }

        try {
            await this.sendMessage(chatId, '🔄 Importando sua wallet...');

            const result = await this.walletService.importWalletFromPrivateKey(
                telegramId, 
                privateKey, 
                pin
            );
            
            if (!result.success) {
                this.clearUserState(telegramId);
                return await this.sendErrorMessage(chatId, result.error);
            }

            this.clearUserState(telegramId);

            const simplifiedFlow = this.botInstance.simplifiedFlowHandler;
            if (simplifiedFlow) {
                await simplifiedFlow.handleWalletImported(chatId, telegramId, result);
            }

            let message = '✅ *Wallet Importada com Sucesso!*\n\n';
            message += `🔑 *Seu endereço:*\n\`${result.publicKey}\`\n\n`;
            message += `🏷️ *Nome:* ${result.walletName}\n`;
            message += '🔐 *PIN:* Configurado com sucesso\n\n';
            message += '⚠️ *Nota:* Esta wallet não tem seed phrase\n';
            message += 'Foi importada apenas com private key.\n\n';
            message += '✨ Sua wallet está pronta para uso!';

            await this.gamificationService.completeTask(telegramId, 'create_wallet', {
                walletCreated: true,
                imported: true,
                fromPrivateKey: true,
                publicKey: result.publicKey,
                timestamp: Date.now()
            });

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '💰 Ver Saldo', callback_data: 'view_balance' }
                    ],
                    [
                        { text: '📋 Próxima Tarefa', callback_data: 'show_progress' }
                    ],
                    [
                        { text: '⬅️ Menu Principal', callback_data: 'main_menu' }
                    ]
                ]
            };

            return await this.sendMessage(chatId, message, keyboard);

        } catch (error) {
            this.logger.error('Erro ao importar wallet via private key:', error);
            this.clearUserState(telegramId);
            return await this.sendErrorMessage(chatId, 'Erro ao importar wallet.');
        }
    }

    // ========== PROCESSADOR DE IMPORTAÇÃO PARA COMPATIBILIDADE ==========

    async processPinForImport(text, chatId, telegramId, state, messageId) {
        // Este método existe para compatibilidade com o código antigo
        // Redireciona para os métodos corretos baseado no que está sendo importado
        
        if (!state || (!state.seedPhrase && !state.privateKey)) {
            this.clearUserState(telegramId);
            await this.sendMessage(chatId, '❌ Erro no processo. Tente novamente.');
            return;
        }

        // Se tem seedPhrase, redireciona para o fluxo de seed
        if (state.seedPhrase) {
            return await this.processPinAfterSeed(text, chatId, telegramId, state, messageId);
        }
        
        // Se tem privateKey, redireciona para o fluxo de private key
        if (state.privateKey) {
            return await this.processPinAfterPrivateKey(text, chatId, telegramId, state, messageId);
        }
    }

    // ========== PROCESSADORES DE VISUALIZAÇÃO ==========

    async processPinToShowSeed(pin, chatId, telegramId, messageId) {
        pin = pin.trim();

        setTimeout(async () => {
            try {
                await this.bot.deleteMessage(chatId, messageId);
            } catch (e) {}
        }, 3000);

        try {
            const result = await this.walletService.getSeedPhrase(telegramId, pin);
            
            if (!result.success) {
                if (result.error === 'PIN incorreto') {
                    return await this.sendMessage(chatId,
                        '❌ *PIN incorreto!*\n\n' +
                        'Digite novamente ou use /cancel para cancelar:'
                    );
                }
                
                this.clearUserState(telegramId);
                return await this.sendErrorMessage(chatId, result.error);
            }

            this.clearUserState(telegramId);

            const seedWords = result.seedPhrase.split(' ');
            const seedFormatted = seedWords.map((word, i) => 
                `${i + 1}. ${word}`
            ).join('\n');

            let message = '🔑 *Sua Seed Phrase*\n\n';
            message += '```\n' + seedFormatted + '\n```\n';
            message += '⚠️ *SEGURANÇA:*\n';
            message += '• Nunca compartilhe estas palavras\n';
            message += '• Anote em papel e guarde offline\n';
            message += '• Com elas, qualquer pessoa controla sua wallet\n\n';
            message += '🔒 Esta mensagem será apagada em 30 segundos.';

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '⬅️ Voltar', callback_data: 'manage_wallet' }
                    ]
                ]
            };

            const sentMessage = await this.sendMessage(chatId, message, keyboard);

            setTimeout(async () => {
                try {
                    await this.bot.deleteMessage(chatId, sentMessage.message_id);
                    await this.sendMessage(chatId, 
                        '✅ Seed phrase apagada por segurança.',
                        WalletKeyboard.getBackMenu()
                    );
                } catch (e) {}
            }, 30000);

            return sentMessage;

        } catch (error) {
            this.logger.error('Erro ao mostrar seed phrase:', error);
            this.clearUserState(telegramId);
            return await this.sendErrorMessage(chatId, 'Erro ao acessar seed phrase.');
        }
    }

    // ========== PROCESSADORES DE ALTERAÇÃO DE PIN ==========

    async processOldPin(oldPin, chatId, telegramId, messageId) {
        oldPin = oldPin.trim();

        setTimeout(async () => {
            try {
                await this.bot.deleteMessage(chatId, messageId);
            } catch (e) {}
        }, 3000);

        try {
            const isValid = await this.walletService.verifyPIN(telegramId, oldPin);
            
            if (!isValid) {
                return await this.sendMessage(chatId,
                    '❌ *PIN incorreto!*\n\n' +
                    'Digite seu PIN atual novamente:'
                );
            }

            this.setUserState(telegramId, 'waiting_new_pin', { oldPin });

            let message = '✅ *PIN atual confirmado!*\n\n';
            message += '🔐 *Passo 2: Novo PIN*\n';
            message += 'Digite seu novo PIN (4 ou 6 dígitos):\n\n';
            message += '💡 Use um PIN diferente do atual.';

            return await this.sendMessage(chatId, message);

        } catch (error) {
            this.logger.error('Erro ao verificar PIN antigo:', error);
            return await this.sendMessage(chatId, 
                '❌ Erro ao verificar PIN. Tente novamente.'
            );
        }
    }

    async processNewPin(newPin, chatId, telegramId, data, messageId) {
        newPin = newPin.trim();

        setTimeout(async () => {
            try {
                await this.bot.deleteMessage(chatId, messageId);
            } catch (e) {}
        }, 3000);

        const { oldPin } = data;

        if (!validators.isValidPin(newPin)) {
            return await this.sendMessage(chatId, 
                '❌ *PIN inválido!*\n\n' +
                '🔢 O PIN deve ter 4 ou 6 dígitos numéricos.\n\n' +
                'Digite novamente:'
            );
        }

        if (newPin === oldPin) {
            return await this.sendMessage(chatId,
                '❌ *O novo PIN deve ser diferente do atual!*\n\n' +
                'Digite um PIN diferente:'
            );
        }

        const pinValidation = validators.isStrongPin(newPin);
        if (!pinValidation.isStrong) {
            return await this.sendMessage(chatId,
                `❌ *PIN fraco!*\n\n${pinValidation.reason}\n\n` +
                'Digite um PIN mais seguro:'
            );
        }

        this.setUserState(telegramId, 'waiting_new_pin_confirmation', { oldPin, newPin });

        return await this.sendMessage(chatId, 
            '✅ *Novo PIN aceito!*\n\n' +
            '🔐 *Digite o novo PIN novamente para confirmar:*\n\n' +
            '⚠️ Certifique-se de que é o mesmo PIN.'
        );
    }

    async processNewPinConfirmation(pin, chatId, telegramId, data, messageId) {
        pin = pin.trim();

        setTimeout(async () => {
            try {
                await this.bot.deleteMessage(chatId, messageId);
            } catch (e) {}
        }, 3000);

        const { oldPin, newPin } = data;

        if (pin !== newPin) {
            this.setUserState(telegramId, 'waiting_new_pin', { oldPin });
            return await this.sendMessage(chatId,
                '❌ *Os PINs não conferem!*\n\n' +
                'Por segurança, vamos começar novamente.\n' +
                'Digite seu novo PIN (4 ou 6 dígitos):'
            );
        }

        try {
            await this.sendMessage(chatId, '🔄 Alterando PIN...');

            const result = await this.walletService.changePIN(telegramId, oldPin, newPin);
            
            if (!result.success) {
                this.clearUserState(telegramId);
                return await this.sendErrorMessage(chatId, result.error);
            }

            this.clearUserState(telegramId);

            let message = '✅ *PIN Alterado com Sucesso!*\n\n';
            message += '🔐 Seu novo PIN está ativo.\n';
            message += '📝 Lembre-se de usar o novo PIN para:\n';
            message += '• Ver seed phrase\n';
            message += '• Confirmar transações\n';
            message += '• Alterar configurações\n\n';
            message += '⚠️ Guarde seu novo PIN com segurança!';

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '⬅️ Voltar às Configurações', callback_data: 'wallet_settings' }
                    ],
                    [
                        { text: '🏠 Menu Principal', callback_data: 'main_menu' }
                    ]
                ]
            };

            return await this.sendMessage(chatId, message, keyboard);

        } catch (error) {
            this.logger.error('Erro ao alterar PIN:', error);
            this.clearUserState(telegramId);
            return await this.sendErrorMessage(chatId, 'Erro ao alterar PIN.');
        }
    }

    // ========== PROCESSADORES DE DELEÇÃO ==========

    async processDeleteConfirmation(text, chatId, telegramId) {
        text = text.trim();

        if (text !== 'DELETAR') {
            return await this.sendMessage(chatId,
                '❌ *Confirmação incorreta!*\n\n' +
                'Digite exatamente DELETAR (em maiúsculas) para confirmar\n' +
                'ou /cancel para cancelar:'
            );
        }

        this.setUserState(telegramId, 'waiting_pin_for_delete');

        return await this.sendMessage(chatId,
            '⚠️ *Última confirmação!*\n\n' +
            '🔐 Digite seu PIN para confirmar a exclusão:\n\n' +
            '⚠️ Esta ação é IRREVERSÍVEL!'
        );
    }

    async processPinForDelete(pin, chatId, telegramId, messageId) {
        pin = pin.trim();

        setTimeout(async () => {
            try {
                await this.bot.deleteMessage(chatId, messageId);
            } catch (e) {}
        }, 3000);

        try {
            const result = await this.walletService.deleteWallet(telegramId, pin);
            
            if (!result.success) {
                if (result.error === 'PIN incorreto') {
                    return await this.sendMessage(chatId,
                        '❌ *PIN incorreto!*\n\n' +
                        'Digite novamente ou use /cancel para cancelar:'
                    );
                }
                
                this.clearUserState(telegramId);
                return await this.sendErrorMessage(chatId, result.error);
            }

            this.clearUserState(telegramId);

            let message = '✅ *Wallet Deletada com Sucesso!*\n\n';
            message += '🗑️ Todos os dados foram removidos.\n';
            message += '🔄 Suas tarefas foram resetadas.\n\n';
            
            if (result.backupSaved) {
                message += '💾 *Backup salvo!*\n';
                message += 'Se reimportar a mesma wallet, poderá recuperar o progresso.\n\n';
            }
            
            message += 'Você pode criar ou importar uma nova wallet quando quiser.';

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '🆕 Criar Nova Wallet', callback_data: 'create_new_wallet' }
                    ],
                    [
                        { text: '📥 Importar Wallet', callback_data: 'import_wallet_menu' }
                    ],
                    [
                        { text: '🏠 Menu Principal', callback_data: 'main_menu' }
                    ]
                ]
            };

            return await this.sendMessage(chatId, message, keyboard);

        } catch (error) {
            this.logger.error('Erro ao deletar wallet:', error);
            this.clearUserState(telegramId);
            return await this.sendErrorMessage(chatId, 'Erro ao deletar wallet.');
        }
    }

    // ========== PROCESSADORES PARA MATRIZ ==========

    async processPinForMatrix(text, chatId, telegramId, messageId, stateData) {
        // Auto-deletar PIN após 3 segundos
        setTimeout(async () => {
            try {
                await this.bot.deleteMessage(chatId, messageId);
            } catch (e) {}
        }, 3000);
        
        // Verificar se é cancelamento
        if (text.toLowerCase() === 'cancelar' || text === '/cancel') {
            this.clearUserState(telegramId);
            await this.sendMessage(chatId, '❌ Criação de matriz cancelada.', {
                inline_keyboard: [
                    [{ text: '🔄 Tentar Novamente', callback_data: 'task_create_matrix' }],
                    [{ text: '⬅️ Menu Principal', callback_data: 'main_menu' }]
                ]
            });
            return;
        }
        
        // Verificar PIN
        const isValid = await this.walletService.verifyPIN(telegramId, text);
        
        if (!isValid) {
            await this.sendMessage(chatId, '❌ PIN incorreto! Tente novamente:');
            return;
        }

        // PIN válido, limpar estado
        this.clearUserState(telegramId);
        
        this.logger.info(`PIN validado para criação de matriz do usuário ${telegramId}`);
        
        // IMPORTANTE: Chamar o matrixHandler para processar a criação
        if (this.matrixHandler) {
            // Usar o messageId do stateData se disponível
            const targetMessageId = stateData?.messageId || messageId;
            
            this.logger.info(`Iniciando processamento da matriz - messageId: ${targetMessageId}`);
            
            // Chamar o processMatrixCreation com o PIN validado
            await this.matrixHandler.processMatrixCreation(chatId, telegramId, text, targetMessageId);
        } else {
            this.logger.error('MatrixHandler não está definido!');
            await this.sendMessage(chatId, '❌ Erro interno. Por favor, tente novamente.');
        }
    }

    // ========== NOVOS PROCESSADORES PARA VOUCHER ==========

    async processVoucherSlug(text, chatId, telegramId) {
        const state = this.getUserStateData(telegramId);
        
        // Limpar slug
        const slug = text.toLowerCase().replace(/[^a-z0-9_]/g, '');
        
        // Validar comprimento
        if (slug.length < 3 || slug.length > 20) {
            return await this.sendMessage(chatId, 
                '❌ *Nome inválido!*\n\n' +
                'Deve ter entre 3 e 20 caracteres.\n' +
                'Use apenas letras, números e _\n\n' +
                'Tente novamente:'
            );
        }

        // Criar voucher
        this.clearUserState(telegramId);
        
        if (this.voucherHandler && state && state.messageId) {
            await this.voucherHandler.processVoucherCreation(chatId, telegramId, slug, state.messageId);
        } else {
            await this.sendMessage(chatId, '❌ Erro ao processar. Tente novamente.');
        }
    }

    // ========== PROCESSADOR DE MENSAGENS DESCONHECIDAS ==========

    async handleUnknownMessage(chatId, telegramId, text) {
        if (text.startsWith('/')) {
            return await this.sendMessage(chatId, 
                '❓ Comando não reconhecido.\n\n' +
                'Use /start para ver o menu principal.',
                MainKeyboard.getBackMenu('main_menu')
            );
        }

        return await this.sendMessage(chatId,
            '👋 Olá! Use os botões do menu para navegar.\n\n' +
            'Se precisar recomeçar, use /start',
            MainKeyboard.getBackMenu('main_menu')
        );
    }

    // ========== HELPERS DE ESTADO ==========

    getUserState(telegramId) {
        // Primeiro verificar estado local
        const localState = this.userStates.get(telegramId);
        if (localState) {
            this.logger.debug(`Estado local encontrado para ${telegramId}:`, localState);
            return localState;
        }
        
        // Se não tem local, verificar no botInstance
        const botState = this.botInstance.getUserState(telegramId);
        if (botState && botState.action) {
            this.logger.debug(`Estado do bot encontrado para ${telegramId}:`, botState);
            return {
                state: botState.action,
                data: botState
            };
        }
        
        return null;
    }

    getUserStateData(telegramId) {
        // Retorna os dados do estado do botInstance também
        const localState = this.userStates.get(telegramId);
        const botState = this.botInstance.getUserState(telegramId);
        
        // Combina os dois estados
        if (localState && botState) {
            return { ...botState, ...localState.data };
        }
        return localState?.data || botState || null;
    }

    setUserState(telegramId, state, data = {}) {
        this.userStates.set(telegramId, { 
            state, 
            data, 
            timestamp: Date.now() 
        });
        this.logger.info(`Estado configurado para ${telegramId}: ${state}`);
        
        // Também salva no botInstance para compatibilidade
        this.botInstance.setUserState(telegramId, { action: state, ...data });
    }

    clearUserState(telegramId) {
        this.userStates.delete(telegramId);
        this.botInstance.clearUserState(telegramId);
        this.logger.info(`Estado limpo para ${telegramId}`);
    }

    // ========== HELPERS DE MENSAGEM ==========

    async sendMessage(chatId, text, keyboard = null) {
        const options = { parse_mode: 'Markdown' };
        if (keyboard) options.reply_markup = keyboard;
        
        try {
            return await this.bot.sendMessage(chatId, text, options);
        } catch (error) {
            // Fallback se markdown falhar
            return await this.bot.sendMessage(chatId, text.replace(/[*_`]/g, ''), { reply_markup: keyboard });
        }
    }

    async sendErrorMessage(chatId, errorText) {
        const message = `❌ **Erro**\n\n${errorText}`;
        return await this.sendMessage(chatId, message, MainKeyboard.getBackMenu());
    }
}

module.exports = MessageHandler;