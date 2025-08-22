// src/handlers/simplified-flow.handler.js
const Logger = require('../utils/logger');
const UserStateService = require('../services/user-state.service');
const MainKeyboard = require('../keyboards/main.keyboard');
const { formatters } = require('../utils/formatting');

class SimplifiedFlowHandler {
    constructor(bot) {
        this.bot = bot.bot;
        this.botInstance = bot;
        this.db = bot.db;
        this.walletService = bot.walletService;
        this.gamificationService = bot.gamificationService;
        this.userStateService = new UserStateService(bot.db);
        this.logger = new Logger('SimplifiedFlowHandler');
    }
    
    /**
     * Processar comando /start
     */
    async handleStart(msg, match) {
        const telegramId = msg.from.id.toString();
        const firstName = msg.from.first_name || 'amigo';
        
        try {
            // Obter estado atual do usuário
            const flowState = await this.userStateService.getUserFlowState(telegramId);
            
            this.logger.info(`/start - Estado do usuário ${telegramId}: ${flowState}`);
            
            // Verificar se tem parâmetro (voucher de convite) - processado no bot.js
            const referralCode = match && match[1] ? match[1].trim() : null;
            if (referralCode && !referralCode.startsWith('voucher_')) {
                // Se não é voucher, pode ser outro tipo de referência
                await this.handleReferralCode(telegramId, referralCode);
            }
            
            // Se é novo usuário, registrar
            if (flowState === 'new_user') {
                await this.registerNewUser(msg);
                await this.showInitialMessage(msg.chat.id, firstName);
            } 
            // Se está no onboarding, continuar de onde parou
            else if (flowState === 'onboarding_start') {
                await this.showInitialMessage(msg.chat.id, firstName);
            }
            // Usuário com progresso
            else {
                await this.showProgressiveMenu(msg.chat.id, telegramId, flowState);
            }
            
        } catch (error) {
            this.logger.error('Erro no /start:', error);
            await this.bot.sendMessage(msg.chat.id, '❌ Erro ao iniciar. Tente novamente.');
        }
    }
    
    /**
     * Registrar novo usuário
     */
    async registerNewUser(msg) {
        const telegramId = msg.from.id.toString();
        
        await this.db.run(`
            INSERT INTO users (
                telegram_id, telegram_username, first_name, last_name, language_code
            ) VALUES (?, ?, ?, ?, ?)
        `, [
            telegramId,
            msg.from.username || null,
            msg.from.first_name || null,
            msg.from.last_name || null,
            msg.from.language_code || 'pt'
        ]);
        
        // Inicializar tarefas
        await this.gamificationService.initializeUserTasks(telegramId);
        
        this.logger.info('Novo usuário registrado:', telegramId);
    }
    
    /**
     * Tratar código de referência
     */
    async handleReferralCode(telegramId, referralCode) {
        try {
            // Salvar código para usar depois
            this.botInstance.setUserState(telegramId, {
                referralVoucher: referralCode
            });
            
            await this.bot.sendMessage(telegramId,
                `🎯 *Código de convite detectado!*\n\n` +
                `Você foi convidado com o código: \`${referralCode}\`\n` +
                `Ao criar sua matriz, você entrará na rede dessa pessoa!`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            this.logger.error('Erro ao processar código de referência:', error);
        }
    }
    
    /**
     * Mostrar mensagem inicial
     */
    async showInitialMessage(chatId, firstName) {
        const message = `🍩 **Olá ${firstName}, está pronto para começar a realizar algumas tarefas e participar do airdrop DONUT?**

📝 **Passos:**
• Algumas tarefas simples
• Investimento de $10 + $5 de taxas

🎁 **Bônus:**
Assim que realizar as 7 primeiras tarefas, recupere $10 investidos + tokens DONUT!

Vamos começar?`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Sim, vamos começar!', callback_data: 'start_journey' }
                ]
            ]
        };
        
        await this.bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }
    
    /**
     * Processar callback "start_journey"
     */
    async handleStartJourney(chatId, telegramId, messageId) {
        const message = `🎉 **Bem-vindo ao Donut Matrix!**

Você está quase pronto para começar sua jornada!

🎯 **Tarefa Inicial:**
Criar sua wallet Solana para entrar nessa doce comunidade

Vamos começar?`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🔧 Realizar tarefa', callback_data: 'task_create_wallet' }
                ]
            ]
        };
        
        await this.editMessage(chatId, messageId, message, keyboard);
        
        // Marcar onboarding como iniciado
        await this.userStateService.saveUserState(telegramId, 'wallet_pending');
        await this.userStateService.completeOnboarding(telegramId);
    }
    
    /**
     * Processar tarefa de criar wallet
     */
    async handleWalletTask(chatId, telegramId, messageId) {
        // Verificar se já tem wallet
        const wallet = await this.walletService.getActiveWallet(telegramId);
        
        if (wallet) {
            // Já tem wallet, avançar para próxima tarefa
            await this.gamificationService.completeTask(telegramId, 'create_wallet');
            return await this.showNextTask(chatId, telegramId, messageId);
        }
        
        const message = `💳 **Sua primeira tarefa está a um passo de ser concluída**

Escolha uma das opções abaixo para finalizar ela agora mesmo:`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🆕 Criar Nova Wallet', callback_data: 'create_new_wallet' }
                ],
                [
                    { text: '📥 Importar Wallet', callback_data: 'import_wallet_menu' }
                ],
                [
                    { text: '❓ O que é uma wallet?', callback_data: 'wallet_info' }
                ],
                [
                    { text: '👥 Grupo de Ajuda', url: 'https://t.me/donutmatrix' }
                ]
            ]
        };
        
        await this.editMessage(chatId, messageId, message, keyboard);
    }
    
    /**
     * Mostrar menu de importação simplificado
     */
    async showImportMenu(chatId, messageId) {
        const message = `📥 **Importar Wallet Existente**

Como você deseja importar sua wallet?

💡 **Importante:** Se sua wallet já tem SOL, a tarefa de funding será completada automaticamente!`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🔑 Seed Phrase (12 palavras)', callback_data: 'import_seed' }
                ],
                [
                    { text: '🔐 Private Key', callback_data: 'import_private_key' }
                ],
                [
                    { text: '📱 Como exportar da Phantom', callback_data: 'phantom_help' }
                ],
                [
                    { text: '⬅️ Voltar', callback_data: 'task_create_wallet' }
                ]
            ]
        };
        
        await this.editMessage(chatId, messageId, message, keyboard);
    }
    
    /**
     * Mostrar ajuda da Phantom
     */
    async showPhantomHelp(chatId, messageId) {
        const message = `📱 **Como Exportar da Phantom**

1️⃣ Abra o app Phantom
2️⃣ Vá em Configurações ⚙️
3️⃣ Toque em "Segurança e Privacidade"
4️⃣ Selecione "Mostrar Frase Secreta"
5️⃣ Digite sua senha/biometria
6️⃣ Anote as 12 palavras em ordem

⚠️ **IMPORTANTE:**
• Nunca compartilhe sua seed phrase
• Anote em papel, não tire print
• Guarde em local seguro

Após anotar, use a opção "Seed Phrase" para importar.`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🔑 Importar com Seed Phrase', callback_data: 'import_seed' }
                ],
                [
                    { text: '⬅️ Voltar', callback_data: 'import_wallet_menu' }
                ]
            ]
        };
        
        await this.editMessage(chatId, messageId, message, keyboard);
    }
    
    /**
     * Mostrar informação sobre wallet
     */
    async showWalletInfo(chatId, messageId) {
        const message = `📚 **O que é uma Wallet?**

Uma wallet (carteira) é onde você armazena suas criptomoedas.

🔑 **Componentes:**
• **Seed Phrase:** 12/24 palavras para recuperar
• **Private Key:** Chave secreta que controla
• **Public Key:** Seu endereço para receber

⚠️ **Segurança:**
• Nunca compartilhe seed phrase ou private key
• Anote em papel e guarde offline
• Use PIN forte no bot

Pronto para criar sua wallet?`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🆕 Criar Nova Wallet', callback_data: 'create_new_wallet' }
                ],
                [
                    { text: '📥 Importar Wallet', callback_data: 'import_wallet_menu' }
                ],
                [
                    { text: '⬅️ Voltar', callback_data: 'task_create_wallet' }
                ]
            ]
        };
        
        await this.editMessage(chatId, messageId, message, keyboard);
    }

    /**
     * ✅ Processar wallet após importação
     */
    async handleWalletImported(chatId, telegramId, walletData) {
        try {
            // Verificar saldo da wallet importada
            const depositMonitor = this.botInstance.depositMonitorService;
            const checkResult = await depositMonitor.checkImportedWalletBalance(
                telegramId, 
                walletData.publicKey
            );

            if (checkResult.success && checkResult.completed) {
                // Wallet já tem saldo suficiente - pular para próxima tarefa
                this.logger.info(`Wallet importada com saldo completo: ${telegramId}`);
                
                // Atualizar estado do usuário
                await this.userStateService.saveUserState(telegramId, 'funded');
                
                // Não precisa fazer mais nada, o depositMonitor já enviou a mensagem
                return { skipToNextTask: true };
            } 
            else if (checkResult.success && checkResult.partial) {
                // Wallet tem saldo parcial - monitoramento já iniciado
                this.logger.info(`Wallet importada com saldo parcial: ${telegramId}`);
                
                // Atualizar estado do usuário
                await this.userStateService.saveUserState(telegramId, 'funding_pending');
                
                return { partialBalance: true };
            }
            else {
                // Wallet sem saldo - seguir fluxo normal
                this.logger.info(`Wallet importada sem saldo: ${telegramId}`);
                
                // Mostrar próxima tarefa (funding)
                await this.showNextTask(chatId, telegramId);
                
                return { needsFunding: true };
            }

        } catch (error) {
            this.logger.error('Erro ao processar wallet importada:', error);
            await this.bot.sendMessage(chatId, 
                '⚠️ Erro ao verificar saldo da wallet. Tente verificar manualmente.',
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 Verificar Saldo', callback_data: 'check_funding' }],
                            [{ text: '📊 Ver Progresso', callback_data: 'show_progress' }]
                        ]
                    }
                }
            );
        }
    }
    
    /**
     * Mostrar próxima tarefa
     */
    async showNextTask(chatId, telegramId, messageId) {
        const flowState = await this.userStateService.getUserFlowState(telegramId);
        const nextAction = this.userStateService.getNextAction(flowState);
        const progress = await this.gamificationService.getUserProgress(telegramId);
        
        let message = `📊 **Progresso: ${progress.progressPercent}%**\n\n`;
        message += `✅ Tarefa concluída!\n\n`;
        message += `🎯 **Próxima tarefa:** ${nextAction.message}`;
        
        const keyboard = MainKeyboard.getNextTaskMenu(nextAction);
        
        if (messageId) {
            await this.editMessage(chatId, messageId, message, keyboard);
        } else {
            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }
    }
    
    /**
     * Mostrar menu progressivo baseado no estado
     */
    async showProgressiveMenu(chatId, telegramId, flowState) {
        const progress = await this.gamificationService.getUserProgress(telegramId);
        const nextAction = this.userStateService.getNextAction(flowState);
        const wallet = await this.walletService.getActiveWallet(telegramId);
        
        let message = `🍩 **DONUT MATRIX BOT**\n\n`;
        message += `📊 **Progresso: ${progress.progressPercent}%**\n`;
        
        // Adicionar informações da wallet se existir
        if (wallet) {
            const balance = await this.walletService.getBalance(telegramId);
            if (balance.success) {
                message += `💰 **Saldo:** ${formatters.formatSOL(balance.solBalance.sol)}\n`;
            }
        }
        
        // Se completou todas as tarefas
        if (progress.progressPercent >= 100) {
            message += `\n🎉 **Parabéns! Todas as tarefas completas!**\n`;
            message += `Continue construindo sua rede para ganhos ilimitados!`;
        } else {
            message += `\n🎯 **Próxima ação:** ${nextAction.message}`;
        }
        
        const keyboard = MainKeyboard.getProgressiveMenu(
            flowState,
            nextAction,
            wallet,
            progress.progressPercent
        );
        
        await this.bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }
    
    /**
     * ✅ Acesso a funcionalidade
     */
    async checkFeatureAccess(chatId, telegramId, feature, messageId = null) {
        const walletFeatures = [
            'send_tokens', 'receive_tokens', 'view_balance',
            'manage_wallet', 'wallet_menu', 'wallet_settings'
        ];
        
        if (walletFeatures.includes(feature)) {
            const wallet = await this.walletService.getActiveWallet(telegramId);
            if (!wallet) {
                const message = '❌ Você precisa criar uma wallet primeiro!';
                const keyboard = {
                    inline_keyboard: [
                        [{ text: '💳 Criar Wallet', callback_data: 'task_create_wallet' }],
                        [{ text: '⬅️ Voltar', callback_data: 'main_menu' }]
                    ]
                };
                
                if (messageId) {
                    await this.editMessage(chatId, messageId, message, keyboard);
                } else {
                    await this.bot.sendMessage(chatId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: keyboard
                    });
                }
                return false;
            }
            return true; // Tem wallet, pode acessar
        }
        
        // Verificação para outras features
        const canAccess = await this.userStateService.canAccessFeature(telegramId, feature);
        
        if (!canAccess) {
            const message = this.userStateService.getBlockedFeatureMessage(feature);
            const flowState = await this.userStateService.getUserFlowState(telegramId);
            const nextAction = this.userStateService.getNextAction(flowState);
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: `🎯 ${nextAction.message}`, callback_data: nextAction.callback }],
                    [{ text: '⬅️ Voltar', callback_data: 'main_menu' }]
                ]
            };
            
            if (messageId) {
                await this.editMessage(chatId, messageId, message, keyboard);
            } else {
                await this.bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
            }
            
            return false;
        }
        
        return true;
    }
    
    /**
     * Processar tarefas
     */
    async handleDevelopmentTask(chatId, telegramId, taskType, messageId) {

        switch(taskType) {
            case 'create_matrix':
                if (this.botInstance.matrixHandler) {
                    return await this.botInstance.matrixHandler.handleMatrixTask(chatId, telegramId, messageId);
                }
                break;
                
            case 'create_voucher':
                if (this.botInstance.voucherHandler) {
                    return await this.botInstance.voucherHandler.handleVoucherTask(chatId, telegramId, messageId);
                }
                break;
                
            case 'first_referral':
            case 'second_referral':
            case 'third_referral':
                return await this.showReferralTask(chatId, telegramId, taskType, messageId);
                
            default:
                break;
        }
        
        // Fallback para tarefas não implementadas
        const message = `🚧 **Funcionalidade em desenvolvimento**\n\nEm breve disponível!`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '👥 Grupo de Ajuda', url: 'https://t.me/donutmatrix' }
                ],
                [
                    { text: '⬅️ Menu Principal', callback_data: 'main_menu' }
                ]
            ]
        };
        
        await this.editMessage(chatId, messageId, message, keyboard);
    }
    
    /**
     * Mostrar tarefa de referência
     */
    async showReferralTask(chatId, telegramId, taskType, messageId) {
        // Verificar se tem voucher
        const voucher = await this.botInstance.voucherService.getUserVoucher(telegramId);
        
        if (!voucher) {
            const message = '❌ **Voucher Necessário**\n\nVocê precisa criar um voucher primeiro para convidar pessoas!';
            const keyboard = {
                inline_keyboard: [
                    [{ text: '🎫 Criar Voucher', callback_data: 'task_create_voucher' }],
                    [{ text: '⬅️ Voltar', callback_data: 'main_menu' }]
                ]
            };
            return await this.editMessage(chatId, messageId, message, keyboard);
        }
        
        // Verificar quantos referidos já tem
        const stats = await this.botInstance.voucherService.getVoucherStats(telegramId);
        const taskNumber = {
            'first_referral': 1,
            'second_referral': 2,
            'third_referral': 3
        }[taskType];
        
        let message = `👥 **Tarefa: ${taskNumber}º Referência**\n\n`;
        
        if (stats.matricesCreated >= taskNumber) {
            message += '✅ **Tarefa já completada!**\n\n';
            message += `Você já tem ${stats.matricesCreated} pessoas na sua matriz.`;
        } else {
            message += `📊 **Progresso:** ${stats.matricesCreated}/${taskNumber}\n\n`;
            message += '📤 **Compartilhe seu link:**\n';
            message += `\`${voucher.referral_link}\`\n\n`;
            message += `⏳ Aguardando ${taskNumber - stats.matricesCreated} pessoa(s) criar matriz...`;
        }
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '📋 Copiar Link', callback_data: 'copy_voucher_link' }],
                [{ text: '📤 Compartilhar', callback_data: 'share_voucher' }],
                [{ text: '📊 Ver Estatísticas', callback_data: 'view_voucher_stats' }],
                [{ text: '⬅️ Menu Principal', callback_data: 'main_menu' }]
            ]
        };
        
        await this.editMessage(chatId, messageId, message, keyboard);
    }
    
    /**
     * Helper para editar mensagem
     */
    async editMessage(chatId, messageId, text, keyboard = null) {
        const options = {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        };
        
        if (keyboard) {
            options.reply_markup = keyboard;
        }
        
        try {
            return await this.bot.editMessageText(text, options);
        } catch (error) {
            if (!error.message.includes('message is not modified')) {
                this.logger.error('Erro ao editar mensagem:', error);
            }
            // Se falhar, enviar nova mensagem
            return await this.bot.sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }
    }
}

module.exports = SimplifiedFlowHandler;