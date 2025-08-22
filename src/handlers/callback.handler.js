// src/handlers/callback.handler.js
const Logger = require('../utils/logger');
const MainKeyboard = require('../keyboards/main.keyboard');
const { formatters } = require('../utils/formatting');

class CallbackHandler {
    constructor(bot) {
        this.bot = bot.bot;
        this.botInstance = bot;
        
        this.walletService = bot.walletService;
        this.solanaService = bot.solanaService;
        this.apiService = bot.apiService;
        this.gamificationService = bot.gamificationService;
        this.messageHandler = null;
        this.walletOperationsHandler = null;
        this.matrixHandler = null;
        this.voucherHandler = null;
        this.logger = new Logger('CallbackHandler');
    }

    /**
     * Injetar MessageHandler para evitar dependência circular
     */
    setMessageHandler(messageHandler) {
        this.messageHandler = messageHandler;
        this.logger.info('MessageHandler configurado');
    }

    /**
     * Processar todos os callbacks do bot
     */
    async handleCallback(callbackQuery) {
        const { data, message, from } = callbackQuery;
        const chatId = message.chat.id;
        const telegramId = from.id.toString();

        this.logger.info(`Callback recebido: ${data} do usuário ${telegramId}`);

        try {
            // Responder callback imediatamente
            await this.bot.answerCallbackQuery(callbackQuery.id);

            // Processar baseado no callback data
            await this.processCallback(data, chatId, telegramId, from, message.message_id);

        } catch (error) {
            this.logger.error('Erro ao processar callback:', error);
            await this.sendErrorMessage(chatId, 'Erro interno. Tente novamente.');
        }
    }

    /**
     * Processar callback baseado no tipo
     */
    async processCallback(data, chatId, telegramId, user, messageId) {
        // Callback de confirmação de seed phrase salva
        if (data === 'confirm_seed_saved') {
            await this.gamificationService.updateTaskData(telegramId, 'create_wallet', {
                seedConfirmed: true,
                confirmedAt: Date.now()
            });
            
            if (!this.botInstance.simplifiedFlowHandler) {
                const SimplifiedFlowHandler = require('./simplified-flow.handler');
                this.botInstance.simplifiedFlowHandler = new SimplifiedFlowHandler(this.botInstance);
            }
            
            return await this.botInstance.simplifiedFlowHandler.showNextTask(chatId, telegramId, messageId);
        }

        // Callback para deletar wallet
        if (data === 'delete_wallet') {
            return await this.initDeleteWallet(chatId, telegramId, messageId);
        }

        // Callbacks do fluxo simplificado
        if (data === 'start_journey') {
            if (!this.botInstance.simplifiedFlowHandler) {
                const SimplifiedFlowHandler = require('./simplified-flow.handler');
                this.botInstance.simplifiedFlowHandler = new SimplifiedFlowHandler(this.botInstance);
            }
            return await this.botInstance.simplifiedFlowHandler.handleStartJourney(chatId, telegramId, messageId);
        }

        // Menu principal progressivo
        if (data === 'main_menu') {
            if (!this.botInstance.simplifiedFlowHandler) {
                const SimplifiedFlowHandler = require('./simplified-flow.handler');
                this.botInstance.simplifiedFlowHandler = new SimplifiedFlowHandler(this.botInstance);
            }
            
            const flowState = await this.botInstance.userStateService.getUserFlowState(telegramId);
            return await this.botInstance.simplifiedFlowHandler.showProgressiveMenu(chatId, telegramId, flowState);
        }

        // Callbacks de tarefas
        if (data === 'task_create_wallet') {
            if (!this.botInstance.simplifiedFlowHandler) {
                const SimplifiedFlowHandler = require('./simplified-flow.handler');
                this.botInstance.simplifiedFlowHandler = new SimplifiedFlowHandler(this.botInstance);
            }
            return await this.botInstance.simplifiedFlowHandler.handleWalletTask(chatId, telegramId, messageId);
        }

        if (data === 'task_fund_wallet') {
            return await this.handleFundingTask(chatId, telegramId, messageId);
        }

        // Tarefas agora implementadas
        if (['task_create_matrix', 'task_create_voucher', 'task_first_referral', 
             'task_second_referral', 'task_third_referral'].includes(data)) {
            if (!this.botInstance.simplifiedFlowHandler) {
                const SimplifiedFlowHandler = require('./simplified-flow.handler');
                this.botInstance.simplifiedFlowHandler = new SimplifiedFlowHandler(this.botInstance);
            }
            const taskType = data.replace('task_', '');
            return await this.botInstance.simplifiedFlowHandler.handleDevelopmentTask(chatId, telegramId, taskType, messageId);
        }

        // ========== CALLBACKS DA MATRIZ ==========
        if (data === 'view_my_matrix') {
            if (this.matrixHandler) {
                return await this.matrixHandler.showMatrixStats(chatId, telegramId, messageId);
            }
        }

        if (data === 'refresh_matrix') {
            if (this.matrixHandler) {
                return await this.matrixHandler.refreshMatrix(chatId, telegramId, messageId);
            }
        }

        if (data === 'matrix_history') {
            if (this.matrixHandler) {
                return await this.matrixHandler.showMatrixHistory(chatId, telegramId, messageId);
            }
        }

        if (data === 'cancel_matrix') {
            this.messageHandler?.clearUserState(telegramId);
            return await this.editMessage(chatId, messageId, '❌ Criação de matriz cancelada.', {
                inline_keyboard: [[
                    { text: '⬅️ Menu Principal', callback_data: 'main_menu' }
                ]]
            });
        }

        // ========== CALLBACKS DO VOUCHER ==========
        if (data === 'view_my_voucher' || data === 'view_voucher_stats') {
            if (this.voucherHandler) {
                return await this.voucherHandler.showVoucherStats(chatId, telegramId, messageId);
            }
        }

        if (data === 'copy_voucher_link') {
            if (this.voucherHandler) {
                return await this.voucherHandler.copyVoucherLink(chatId, telegramId, messageId);
            }
        }

        if (data === 'share_voucher') {
            if (this.voucherHandler) {
                return await this.voucherHandler.shareVoucher(chatId, telegramId, messageId);
            }
        }

        if (data === 'refresh_voucher_stats') {
            if (this.voucherHandler) {
                return await this.voucherHandler.refreshVoucherStats(chatId, telegramId, messageId);
            }
        }

        if (data === 'cancel_voucher') {
            this.messageHandler?.clearUserState(telegramId);
            return await this.editMessage(chatId, messageId, '❌ Criação de voucher cancelada.', {
                inline_keyboard: [[
                    { text: '⬅️ Menu Principal', callback_data: 'main_menu' }
                ]]
            });
        }

        // ========== CALLBACKS DE IMPORTAÇÃO ==========
        if (data === 'import_wallet_menu') {
            if (!this.botInstance.simplifiedFlowHandler) {
                const SimplifiedFlowHandler = require('./simplified-flow.handler');
                this.botInstance.simplifiedFlowHandler = new SimplifiedFlowHandler(this.botInstance);
            }
            return await this.botInstance.simplifiedFlowHandler.showImportMenu(chatId, messageId);
        }

        if (data === 'phantom_help') {
            if (!this.botInstance.simplifiedFlowHandler) {
                const SimplifiedFlowHandler = require('./simplified-flow.handler');
                this.botInstance.simplifiedFlowHandler = new SimplifiedFlowHandler(this.botInstance);
            }
            return await this.botInstance.simplifiedFlowHandler.showPhantomHelp(chatId, messageId);
        }

        if (data === 'wallet_info') {
            if (!this.botInstance.simplifiedFlowHandler) {
                const SimplifiedFlowHandler = require('./simplified-flow.handler');
                this.botInstance.simplifiedFlowHandler = new SimplifiedFlowHandler(this.botInstance);
            }
            return await this.botInstance.simplifiedFlowHandler.showWalletInfo(chatId, messageId);
        }

        // Callbacks de wallet
        if (data === 'wallet_menu' || data === 'manage_wallet') {
            return await this.showWalletMenu(chatId, telegramId, messageId);
        }

        if (data === 'wallet_settings') {
            return await this.showWalletSettings(chatId, telegramId, messageId);
        }

        if (data === 'create_new_wallet') {
            return await this.initWalletCreation(chatId, telegramId, messageId);
        }

        if (data === 'import_seed' || data === 'import_seed_phrase') {
            return await this.initSeedImport(chatId, telegramId, messageId);
        }

        if (data === 'import_private_key') {
            return await this.initPrivateKeyImport(chatId, telegramId, messageId);
        }

        // Callbacks de operações de wallet
        if (data === 'check_balance' || data === 'view_balance' || data === 'refresh_balance') {
            if (!this.walletOperationsHandler) {
                this.logger.error('WalletOperationsHandler não está definido!');
                return await this.sendErrorMessage(chatId, 'Erro de configuração.');
            }
            return await this.walletOperationsHandler.showBalance(chatId, telegramId, messageId);
        }

        if (data === 'send_tokens') {
            if (!this.walletOperationsHandler) {
                return await this.sendErrorMessage(chatId, 'Erro de configuração.');
            }
            
            // Verificar apenas se tem wallet criada
            const wallet = await this.walletService.getActiveWallet(telegramId);
            if (!wallet) {
                return await this.editMessage(
                    chatId,
                    messageId,
                    '❌ Você precisa criar uma wallet primeiro!',
                    {
                        inline_keyboard: [
                            [{ text: '💳 Criar Wallet', callback_data: 'task_create_wallet' }],
                            [{ text: '⬅️ Voltar', callback_data: 'main_menu' }]
                        ]
                    }
                );
            }
            
            return await this.walletOperationsHandler.showSendMenu(chatId, telegramId, messageId);
        }

        if (data === 'send_sol') {
            if (!this.walletOperationsHandler) {
                return await this.sendErrorMessage(chatId, 'Erro de configuração.');
            }
            return await this.walletOperationsHandler.initSendSOL(chatId, telegramId, messageId);
        }

        if (data === 'send_donut') {
            if (!this.walletOperationsHandler) {
                return await this.sendErrorMessage(chatId, 'Erro de configuração.');
            }
            return await this.walletOperationsHandler.initSendDONUT(chatId, telegramId, messageId);
        }

        if (data === 'receive_tokens') {
            if (!this.walletOperationsHandler) {
                return await this.sendErrorMessage(chatId, 'Erro de configuração.');
            }
            return await this.walletOperationsHandler.showReceiveInfo(chatId, telegramId, messageId);
        }

        // Callbacks de confirmação de envio
        if (data.startsWith('confirm_send_')) {
            if (!this.walletOperationsHandler) {
                return await this.sendErrorMessage(chatId, 'Erro de configuração.');
            }
            return await this.walletOperationsHandler.confirmSend(chatId, telegramId, messageId);
        }

        if (data === 'cancel_send') {
            if (!this.walletOperationsHandler) {
                return await this.sendErrorMessage(chatId, 'Erro de configuração.');
            }
            return await this.walletOperationsHandler.cancelSend(chatId, telegramId, messageId);
        }

        // Callbacks de compartilhamento
        if (data.startsWith('copy_address')) {
            let publicKey = null;
            if (data.includes('_') && data.length > 'copy_address_'.length) {
                publicKey = data.replace('copy_address_', '');
            }
            
            if (!this.walletOperationsHandler) {
                return await this.sendErrorMessage(chatId, 'Erro de configuração.');
            }
            return await this.walletOperationsHandler.copyAddress(chatId, telegramId, messageId, publicKey);
        }

        if (data === 'show_qr_code') {
            if (!this.walletOperationsHandler) {
                return await this.sendErrorMessage(chatId, 'Erro de configuração.');
            }
            return await this.walletOperationsHandler.showQRCode(chatId, telegramId, messageId);
        }

        if (data === 'share_address') {
            if (!this.walletOperationsHandler) {
                return await this.sendErrorMessage(chatId, 'Erro de configuração.');
            }
            return await this.walletOperationsHandler.shareAddress(chatId, telegramId, messageId);
        }

        // Callbacks de compartilhamento adicionais
        if (data === 'share_in_chat') {
            if (!this.walletOperationsHandler) {
                return await this.sendErrorMessage(chatId, 'Erro de configuração.');
            }
            return await this.walletOperationsHandler.shareInChat(chatId, telegramId, messageId);
        }

        if (data === 'copy_share_text') {
            if (!this.walletOperationsHandler) {
                return await this.sendErrorMessage(chatId, 'Erro de configuração.');
            }
            return await this.walletOperationsHandler.copyShareText(chatId, telegramId, messageId);
        }

        // Callbacks de configuração de wallet
        if (data === 'show_seed') {
            return await this.showSeedPhrase(chatId, telegramId, messageId);
        }

        if (data === 'change_pin') {
            return await this.initPinChange(chatId, telegramId, messageId);
        }

        // Callbacks de funding
        if (data === 'check_funding') {
            return await this.checkFunding(chatId, telegramId, messageId);
        }

        // Callbacks de progresso
        if (data === 'show_progress') {
            return await this.showProgress(chatId, telegramId, messageId);
        }

        // Funcionalidades em desenvolvimento
        if (['view_matrix', 'view_airdrop', 'view_vouchers', 'dashboard'].includes(data)) {
            return await this.showDevelopmentMessage(chatId, messageId, data);
        }

        // Callback não reconhecido
        this.logger.warn(`Callback não reconhecido: ${data}`);
        return await this.sendMessage(chatId, '❓ Ação não reconhecida.');
    }

    /**
     * Iniciar processo de deletar wallet
     */
    async initDeleteWallet(chatId, telegramId, messageId) {
        try {
            const wallet = await this.walletService.getActiveWallet(telegramId);
            
            if (!wallet) {
                return await this.editMessage(
                    chatId,
                    messageId,
                    '❌ Você não tem uma wallet ativa para deletar.',
                    {
                        inline_keyboard: [
                            [{ text: '⬅️ Voltar', callback_data: 'main_menu' }]
                        ]
                    }
                );
            }

            let message = '⚠️ *ATENÇÃO - AÇÃO IRREVERSÍVEL!*\n\n';
            message += '🗑️ Você está prestes a DELETAR sua wallet.\n\n';
            message += '*Isso irá:*\n';
            message += '• Remover sua wallet do sistema\n';
            message += '• RESETAR todas as suas tarefas\n';
            message += '• Apagar histórico de transações\n';
            message += '• Limpar todas as notificações\n\n';
            message += '💾 *Backup:* Salvaremos seu progresso vinculado ao endereço da wallet.\n';
            message += 'Se reimportar a mesma wallet, poderá recuperar o progresso.\n\n';
            message += '⚠️ *Para confirmar, digite exatamente:* `DELETAR`\n\n';
            message += 'Ou use /cancel para cancelar.';

            this.messageHandler?.setUserState(telegramId, 'waiting_delete_confirmation');

            await this.editMessage(chatId, messageId, message);

        } catch (error) {
            this.logger.error('Erro ao iniciar deleção de wallet:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao processar solicitação.');
        }
    }

    /**
     * Mostrar configurações da wallet
     */
    async showWalletSettings(chatId, telegramId, messageId) {
        try {
            const wallet = await this.walletService.getActiveWallet(telegramId);
            
            if (!wallet) {
                return await this.editMessage(
                    chatId,
                    messageId,
                    '❌ Você não tem uma wallet ativa.',
                    {
                        inline_keyboard: [
                            [{ text: '💳 Criar Wallet', callback_data: 'task_create_wallet' }],
                            [{ text: '⬅️ Voltar', callback_data: 'main_menu' }]
                        ]
                    }
                );
            }

            let message = '⚙️ *Configurações da Wallet*\n\n';
            message += `🏷️ *Nome:* ${wallet.wallet_name}\n`;
            message += `📍 *Endereço:* \`${formatters.formatAddress(wallet.public_key)}\`\n\n`;
            message += 'Escolha uma opção:';

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '🔒 Alterar PIN', callback_data: 'change_pin' }
                    ],
                    [
                        { text: '🔑 Ver Seed Phrase', callback_data: 'show_seed' }
                    ],
                    [
                        { text: '🗑️ Deletar Wallet', callback_data: 'delete_wallet' }
                    ],
                    [
                        { text: '⬅️ Voltar', callback_data: 'manage_wallet' }
                    ]
                ]
            };

            return await this.editMessage(chatId, messageId, message, keyboard);

        } catch (error) {
            this.logger.error('Erro ao mostrar configurações:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao carregar configurações.');
        }
    }

    /**
     * Mostrar menu da wallet
     */
    async showWalletMenu(chatId, telegramId, messageId) {
        try {
            const wallet = await this.walletService.getActiveWallet(telegramId);
            
            if (!wallet) {
                return await this.showWalletCreation(chatId, messageId);
            }

            const balance = await this.walletService.getBalance(telegramId);
            
            let message = '💳 **Sua Wallet**\n\n';
            message += `📍 **Endereço:** \`${formatters.formatAddress(wallet.public_key)}\`\n`;
            message += `💰 **Saldo:** ${balance.success ? formatters.formatSOL(balance.solBalance.sol) : 'Erro'}\n`;
            message += `🏷️ **Nome:** ${wallet.wallet_name}\n\n`;
            message += 'Escolha uma ação:';

            const keyboard = MainKeyboard.getWalletMenu(!!wallet);
            
            return await this.editMessage(chatId, messageId, message, keyboard);

        } catch (error) {
            this.logger.error('Erro ao mostrar menu da wallet:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao carregar wallet.');
        }
    }

    /**
     * Mostrar opções de criação de wallet
     */
    async showWalletCreation(chatId, messageId) {
        const message = '🔧 **Configurar Wallet**\n\n' +
            'Você ainda não possui uma wallet.\n\n' +
            '🆕 **Criar Nova:** Gerar uma wallet nova\n' +
            '📥 **Importar:** Usar wallet existente';

        const keyboard = {
            inline_keyboard: [
                [{ text: '🆕 Criar Nova Wallet', callback_data: 'create_new_wallet' }],
                [{ text: '📥 Importar Wallet', callback_data: 'import_wallet_menu' }],
                [{ text: '⬅️ Voltar', callback_data: 'main_menu' }]
            ]
        };
        
        return await this.editMessage(chatId, messageId, message, keyboard);
    }

    /**
     * Iniciar criação de wallet
     */
    async initWalletCreation(chatId, telegramId, messageId) {
        try {
            const wallet = await this.walletService.getActiveWallet(telegramId);
            
            if (wallet) {
                let message = '⚠️ **Você já possui uma wallet ativa!**\n\n';
                message += `📍 **Endereço:** \`${formatters.formatAddress(wallet.public_key)}\`\n\n`;
                message += 'O que deseja fazer?';
                
                const keyboard = {
                    inline_keyboard: [
                        [{ text: '💰 Ver Saldo', callback_data: 'view_balance' }],
                        [{ text: '🔑 Ver Seed Phrase', callback_data: 'show_seed' }],
                        [{ text: '⬅️ Voltar', callback_data: 'wallet_menu' }]
                    ]
                };
                
                return await this.editMessage(chatId, messageId, message, keyboard);
            }

            let message = '🔐 **Criar Nova Wallet**\n\n';
            message += '📝 **Passo 1: Definir PIN de Segurança**\n\n';
            message += 'Digite um PIN de 4 ou 6 dígitos numéricos.\n';
            message += 'Este PIN protegerá sua wallet.\n\n';
            message += '⚠️ **Importante:**\n';
            message += '• Memorize seu PIN\n';
            message += '• Não use sequências óbvias (1234, 0000)\n';
            message += '• Não compartilhe com ninguém\n\n';
            message += '💡 Exemplo: 4829 ou 582947\n\n';
            message += '👇 **Digite seu PIN agora:**';

            this.messageHandler?.setUserState(telegramId, 'waiting_pin_for_creation');

            await this.editMessage(chatId, messageId, message);

        } catch (error) {
            this.logger.error('Erro ao iniciar criação de wallet:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao criar wallet. Tente novamente.');
        }
    }

    /**
     * Iniciar importação via seed phrase
     */
    async initSeedImport(chatId, telegramId, messageId) {
        try {
            let message = '📝 **Importar via Seed Phrase**\n\n';
            message += 'Digite sua seed phrase de 12 ou 24 palavras.\n\n';
            message += '⚠️ **Importante:**\n';
            message += '• Digite todas as palavras separadas por espaço\n';
            message += '• Verifique se está correta antes de enviar\n';
            message += '• Nunca compartilhe sua seed phrase\n\n';
            message += '💡 Exemplo:\n';
            message += '`word1 word2 word3 ... word12`';

            this.messageHandler?.setUserState(telegramId, 'waiting_seed_for_import');

            await this.editMessage(chatId, messageId, message);

        } catch (error) {
            this.logger.error('Erro ao iniciar importação via seed:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao importar wallet.');
        }
    }

    /**
     * Iniciar importação via private key
     */
    async initPrivateKeyImport(chatId, telegramId, messageId) {
        try {
            let message = '🔑 **Importar via Private Key**\n\n';
            message += 'Digite sua private key em formato base58.\n\n';
            message += '⚠️ **Importante:**\n';
            message += '• A private key deve ter ~88 caracteres\n';
            message += '• Verifique se está correta antes de enviar\n';
            message += '• Nunca compartilhe sua private key\n\n';
            message += '💡 Sua private key começa com números e letras.';

            this.messageHandler?.setUserState(telegramId, 'waiting_private_key_for_import');

            await this.editMessage(chatId, messageId, message);

        } catch (error) {
            this.logger.error('Erro ao iniciar importação via private key:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao importar wallet.');
        }
    }

    /**
     * Processar tarefa de funding
     */
    async handleFundingTask(chatId, telegramId, messageId) {
        try {
            const wallet = await this.walletService.getActiveWallet(telegramId);
            
            if (!wallet) {
                return await this.editMessage(
                    chatId,
                    messageId,
                    '❌ Você precisa criar uma wallet primeiro!',
                    {
                        inline_keyboard: [
                            [{ text: '💳 Criar Wallet', callback_data: 'task_create_wallet' }],
                            [{ text: '⬅️ Voltar', callback_data: 'main_menu' }]
                        ]
                    }
                );
            }

            await this.editMessage(chatId, messageId, '🔄 Verificando saldo...');

            // Verificar saldo atual
            const balance = await this.solanaService.getBalance(wallet.public_key);
            const solBalance = this.solanaService.lamportsToSol(balance);
            const usdValue = await this.solanaService.getUSDValue(balance);
            
            let message = '💰 **Tarefa: Adicionar Fundos**\n\n';
            message += `📍 **Seu endereço:**\n\`${wallet.public_key}\`\n\n`;
            message += `💎 **Saldo atual:** ${solBalance.toFixed(4)} SOL\n`;
            message += `💵 **Valor USD:** ~$${usdValue.toFixed(2)}\n\n`;

            if (usdValue >= 15) {
                // Já tem fundos suficientes
                await this.gamificationService.completeTask(telegramId, 'fund_wallet', {
                    balance: balance,
                    usdValue: usdValue,
                    timestamp: Date.now()
                });

                message = '✅ **Tarefa Completa!**\n\n';
                message += 'Você já tem fundos suficientes!\n\n';
                message += '🎯 Próxima tarefa desbloqueada!';

                const keyboard = {
                    inline_keyboard: [
                        [{ text: '🎯 Próxima Tarefa', callback_data: 'task_create_matrix' }],
                        [{ text: '📊 Ver Progresso', callback_data: 'show_progress' }],
                        [{ text: '⬅️ Menu Principal', callback_data: 'main_menu' }]
                    ]
                };
                
                return await this.editMessage(chatId, messageId, message, keyboard);
            } else {
                const needed = 15 - usdValue;
                message += `⚠️ **Você precisa de mais ~$${needed.toFixed(2)} em SOL**\n\n`;
                message += '💡 **Como adicionar fundos:**\n';
                message += '1. Copie o endereço acima\n';
                message += '2. Envie SOL de uma exchange ou wallet\n';
                message += '3. Aguarde confirmação (segundos)\n\n';
                message += '🔄 O bot verifica automaticamente!';

                const keyboard = {
                    inline_keyboard: [
                        [{ text: '📋 Copiar Endereço', callback_data: `copy_address_${wallet.public_key}` }],
                        [{ text: '🔄 Verificar Agora', callback_data: 'check_funding' }],
                        [{ text: '👥 Grupo de Ajuda', url: 'https://t.me/donutmatrix' }],
                        [{ text: '⬅️ Voltar', callback_data: 'main_menu' }]
                    ]
                };
                
                // Iniciar monitoramento automático
                if (this.botInstance.depositMonitorService) {
                    await this.botInstance.depositMonitorService.startMonitoring(telegramId, wallet.public_key);
                }
                
                return await this.editMessage(chatId, messageId, message, keyboard);
            }
        } catch (error) {
            this.logger.error('Erro ao processar funding:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao verificar fundos.');
        }
    }

    /**
     * Verificar funding
     */
    async checkFunding(chatId, telegramId, messageId) {
        return await this.handleFundingTask(chatId, telegramId, messageId);
    }

    /**
     * Mostrar seed phrase
     */
    async showSeedPhrase(chatId, telegramId, messageId) {
        try {
            let message = '🔑 **Ver Seed Phrase**\n\n';
            message += '⚠️ **ATENÇÃO:**\n';
            message += 'Para ver sua seed phrase, digite seu PIN de segurança.\n\n';
            message += 'Nunca compartilhe sua seed phrase com ninguém!';

            this.messageHandler?.setUserState(telegramId, 'waiting_pin_for_seed');

            await this.editMessage(chatId, messageId, message);

        } catch (error) {
            this.logger.error('Erro ao mostrar seed phrase:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao acessar seed phrase.');
        }
    }

    /**
     * Iniciar alteração de PIN
     */
    async initPinChange(chatId, telegramId, messageId) {
        try {
            let message = '🔒 **Alterar PIN**\n\n';
            message += '📝 **Passo 1: PIN Atual**\n';
            message += 'Digite seu PIN atual para confirmar:';

            this.messageHandler?.setUserState(telegramId, 'waiting_old_pin');

            await this.editMessage(chatId, messageId, message);

        } catch (error) {
            this.logger.error('Erro ao iniciar alteração de PIN:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao alterar PIN.');
        }
    }

    /**
     * Mostrar progresso
     */
    async showProgress(chatId, telegramId, messageId) {
        try {
            const progress = await this.gamificationService.getUserProgress(telegramId);
            
            let message = '📊 **Seu Progresso**\n\n';
            message += `🎯 Progresso geral: ${progress.progressPercent || 0}%\n`;
            message += `✅ Tarefas completadas: ${progress.completedCount || 0}/${progress.totalTasks || 7}\n\n`;
            
            message += '📋 **Status das Tarefas:**\n';
            
            const taskNames = {
                create_wallet: 'Criar Wallet',
                fund_wallet: 'Adicionar Fundos',
                create_matrix: 'Criar Matriz',
                create_voucher: 'Criar Voucher',
                first_referral: 'Primeiro Convite',
                second_referral: 'Segundo Convite',
                third_referral: 'Terceiro Convite'
            };

            if (progress.tasks && progress.tasks.length > 0) {
                progress.tasks.forEach(task => {
                    const emoji = task.status === 'completed' ? '✅' : 
                                task.status === 'in_progress' ? '🔄' : '⏳';
                    const name = taskNames[task.task_type] || task.task_type;
                    message += `${emoji} ${name}\n`;
                });
            } else {
                message += '⏳ Nenhuma tarefa iniciada ainda\n';
            }

            const keyboard = {
                inline_keyboard: [
                    [{ text: '⬅️ Menu Principal', callback_data: 'main_menu' }]
                ]
            };

            return await this.editMessage(chatId, messageId, message, keyboard);
        } catch (error) {
            this.logger.error('Erro ao mostrar progresso:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao carregar progresso.');
        }
    }

    /**
     * Mostrar mensagem de desenvolvimento
     */
    async showDevelopmentMessage(chatId, messageId, feature) {
        const features = {
            'view_matrix': {
                title: 'Matriz',
                description: 'Sistema de matriz 3x1 com distribuição automática de recompensas'
            },
            'view_airdrop': {
                title: 'Airdrop',
                description: 'Distribuição semanal de tokens DONUT para holders'
            },
            'view_vouchers': {
                title: 'Vouchers',
                description: 'Sistema de códigos de convite personalizados'
            },
            'dashboard': {
                title: 'Dashboard',
                description: 'Painel completo com estatísticas e relatórios'
            }
        };

        const featureInfo = features[feature] || { title: 'Funcionalidade', description: 'Nova funcionalidade' };

        const message = `🚧 **${featureInfo.title} - Em Desenvolvimento**\n\n${featureInfo.description}\n\nEm breve disponível!`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '👥 Grupo de Ajuda', url: 'https://t.me/donutmatrix' }],
                [{ text: '⬅️ Menu Principal', callback_data: 'main_menu' }]
            ]
        };

        return await this.editMessage(chatId, messageId, message, keyboard);
    }

    /**
     * Helpers para envio de mensagens
     */
    async sendMessage(chatId, text, keyboard = null) {
        const options = { parse_mode: 'Markdown' };
        if (keyboard) options.reply_markup = keyboard;

        return await this.bot.sendMessage(chatId, text, options);
    }

    async editMessage(chatId, messageId, text, keyboard = null) {
        const options = { 
            parse_mode: 'Markdown',
            chat_id: chatId,
            message_id: messageId
        };
        if (keyboard) options.reply_markup = keyboard;

        try {
            return await this.bot.editMessageText(text, options);
        } catch (error) {
            if (error.message && error.message.includes('message is not modified')) {
                return;
            }
            if (error.message && error.message.includes('message to edit not found')) {
                return await this.sendMessage(chatId, text, keyboard);
            }
            this.logger.warn('Erro ao editar mensagem, enviando nova:', error.message);
            return await this.sendMessage(chatId, text, keyboard);
        }
    }

    async sendErrorMessage(chatId, errorText) {
        const message = `❌ **Erro**\n\n${errorText}`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '⬅️ Menu Principal', callback_data: 'main_menu' }]
            ]
        };

        return await this.sendMessage(chatId, message, keyboard);
    }
}

module.exports = CallbackHandler;