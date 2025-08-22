// src/handlers/voucher.handler.js
const Logger = require('../utils/logger');
const { formatters } = require('../utils/formatting');

class VoucherHandler {
    constructor(bot) {
        this.bot = bot.bot;
        this.botInstance = bot;
        this.logger = new Logger('VoucherHandler');
        
        // Services serão injetados
        this.voucherService = null;
        this.matrixService = null;
    }

    /**
     * Injetar services
     */
    setServices(voucherService, matrixService) {
        this.voucherService = voucherService;
        this.matrixService = matrixService;
    }

    /**
     * Processar tarefa de criar voucher
     */
    async handleVoucherTask(chatId, telegramId, messageId) {
        try {
            // Verificar se tem matriz
            const matrix = await this.matrixService.getUserMatrix(telegramId);
            if (!matrix || matrix.status !== 'active') {
                return await this.showNoMatrixMessage(chatId, messageId);
            }

            // Verificar se já tem voucher
            const existingVoucher = await this.voucherService.getUserVoucher(telegramId);
            if (existingVoucher) {
                return await this.showVoucherStats(chatId, telegramId, messageId);
            }

            // Mostrar tela de criação
            await this.showVoucherCreation(chatId, telegramId, messageId);

        } catch (error) {
            this.logger.error('Erro ao processar tarefa de voucher:', error);
            await this.showErrorMessage(chatId, messageId);
        }
    }

    /**
     * Mostrar tela de criação de voucher
     */
    async showVoucherCreation(chatId, telegramId, messageId) {
        let message = '🎫 **Criar Seu Voucher de Convite**\n\n';
        message += '📝 **O que é um voucher?**\n';
        message += 'É seu link personalizado para convidar pessoas.\n';
        message += 'Quem usar seu voucher entra na sua matriz!\n\n';
        
        message += '✨ **Como funciona:**\n';
        message += '1. Escolha um nome único (seu apelido)\n';
        message += '2. Receba seu link personalizado\n';
        message += '3. Compartilhe com 3 pessoas\n';
        message += '4. Ganhe quando elas se registrarem na sua matriz e também quando completarem matrizes\n\n';
        
        message += '⚡ **Digite o nome do seu voucher:**\n';
        message += '• Use apenas letras, números e _\n';
        message += '• Entre 3 e 20 caracteres\n';
        message += '• Exemplo: joao_silva, crypto_king, donut123\n\n';
        
        message += '👇 **Digite agora:**';

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '❌ Cancelar', callback_data: 'cancel_voucher' }
                ]
            ]
        };

        // Definir estado para aguardar nome do voucher
        this.botInstance.setUserState(telegramId, {
            action: 'waiting_voucher_slug',
            messageId: messageId
        });

        await this.editMessage(chatId, messageId, message, keyboard);
    }

    /**
     * Processar criação do voucher
     */
    async processVoucherCreation(chatId, telegramId, voucherSlug, messageId) {
        try {
            // Limpar e validar slug
            const cleanSlug = voucherSlug.toLowerCase().trim();

            // Criar voucher
            const result = await this.voucherService.createVoucher(telegramId, cleanSlug);

            if (result.success) {
                // Completar tarefa
                await this.botInstance.gamificationService.completeTask(telegramId, 'create_voucher', {
                    voucherCreated: true,
                    voucherSlug: cleanSlug,
                    timestamp: Date.now()
                });

                await this.showVoucherSuccess(chatId, telegramId, messageId, result);
            } else {
                await this.showVoucherError(chatId, messageId, result.error);
            }

        } catch (error) {
            this.logger.error('Erro ao criar voucher:', error);
            await this.showErrorMessage(chatId, messageId);
        }
    }

    /**
     * Mostrar sucesso na criação do voucher
     */
    async showVoucherSuccess(chatId, telegramId, messageId, result) {
        let message = '✅ **VOUCHER CRIADO COM SUCESSO!**\n\n';
        message += `🎫 **Seu voucher:** \`${result.voucherSlug}\`\n\n`;
        
        message += '🔗 **Seu link de convite:**\n';
        message += `\`${result.referralLink}\`\n\n`;
        
        message += '📤 **Como usar:**\n';
        message += '1. Copie o link acima\n';
        message += '2. Envie para seus amigos\n';
        message += '3. Elas entram na sua matriz\n';
        message += '4. Você ganha automaticamente!\n\n';
        
        message += '💡 **Dica:** Cada pessoa que usar seu voucher e criar uma matriz completa uma de suas tarefas de referência!';

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📋 Copiar Link', callback_data: 'copy_voucher_link' }
                ],
                [
                    { text: '📤 Compartilhar', callback_data: 'share_voucher' }
                ],
                [
                    { text: '📊 Ver Estatísticas', callback_data: 'view_voucher_stats' }
                ],
                [
                    { text: '🏠 Menu Principal', callback_data: 'main_menu' }
                ]
            ]
        };

        await this.editMessage(chatId, messageId, message, keyboard);

        // Enviar link em mensagem separada para facilitar cópia
        setTimeout(async () => {
            await this.bot.sendMessage(chatId, 
                `📋 **Seu link para copiar:**\n\n${result.referralLink}`,
                { parse_mode: 'Markdown' }
            );
        }, 1000);
    }

    /**
     * Mostrar estatísticas do voucher
     */
    async showVoucherStats(chatId, telegramId, messageId) {
        try {
            const stats = await this.voucherService.getVoucherStats(telegramId);

            if (!stats.hasVoucher) {
                return await this.showNoVoucherMessage(chatId, messageId);
            }

            let message = '📊 **Estatísticas do Seu Voucher**\n\n';
            
            message += `🎫 **Voucher:** \`${stats.voucher.voucher_slug}\`\n`;
            message += `🔗 **Link:** \`${stats.voucher.referral_link}\`\n\n`;
            
            message += '📈 **Desempenho:**\n';
            message += `• Total de usos: ${stats.totalUses}\n`;
            message += `• Matrizes criadas: ${stats.matricesCreated}\n`;
            message += `• Aguardando matriz: ${stats.pendingMatrices}\n\n`;

            if (stats.referrals && stats.referrals.length > 0) {
                message += '👥 **Últimos referidos:**\n';
                for (const ref of stats.referrals.slice(0, 5)) {
                    const name = ref.first_name || ref.telegram_username || 'Usuário';
                    const status = ref.matrix_created ? '✅' : '⏳';
                    message += `${status} ${name}\n`;
                }
            } else {
                message += '👥 **Nenhum referido ainda**\n';
                message += 'Compartilhe seu link para começar!\n';
            }

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '📋 Copiar Link', callback_data: 'copy_voucher_link' }
                    ],
                    [
                        { text: '📤 Compartilhar', callback_data: 'share_voucher' }
                    ],
                    [
                        { text: '🔄 Atualizar', callback_data: 'refresh_voucher_stats' }
                    ],
                    [
                        { text: '🏠 Menu Principal', callback_data: 'main_menu' }
                    ]
                ]
            };

            await this.editMessage(chatId, messageId, message, keyboard);

        } catch (error) {
            this.logger.error('Erro ao mostrar estatísticas:', error);
            await this.showErrorMessage(chatId, messageId);
        }
    }

    /**
     * Copiar link do voucher
     */
    async copyVoucherLink(chatId, telegramId, messageId) {
        try {
            const voucher = await this.voucherService.getUserVoucher(telegramId);
            
            if (!voucher) {
                return await this.showNoVoucherMessage(chatId, messageId);
            }

            // Enviar link em mensagem separada
            await this.bot.sendMessage(chatId, 
                `📋 **Copie seu link:**\n\n${voucher.referral_link}`,
                { parse_mode: 'Markdown' }
            );

            // Atualizar mensagem original
            await this.showVoucherStats(chatId, telegramId, messageId);

        } catch (error) {
            this.logger.error('Erro ao copiar link:', error);
        }
    }

    /**
     * Compartilhar voucher
     */
    async shareVoucher(chatId, telegramId, messageId) {
        try {
            const voucher = await this.voucherService.getUserVoucher(telegramId);
            
            if (!voucher) {
                return await this.showNoVoucherMessage(chatId, messageId);
            }

            let shareText = '🍩 **Junte-se à Matriz Donut!**\n\n';
            shareText += '💰 Invista apenas $10 em SOL e ganhe de volta + lucros!\n';
            shareText += '🎯 Sistema de matriz 3x1 com ganhos automáticos\n';
            shareText += '🚀 Entre agora usando meu link:\n\n';
            shareText += voucher.referral_link;

            // Enviar texto para compartilhar
            await this.bot.sendMessage(chatId, shareText, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '📤 Compartilhar no Telegram',
                            url: `https://t.me/share/url?url=${encodeURIComponent(voucher.referral_link)}&text=${encodeURIComponent('🍩 Junte-se à Matriz Donut e ganhe com crypto!')}`
                        }
                    ]]
                }
            });

            // Voltar para estatísticas
            await this.showVoucherStats(chatId, telegramId, messageId);

        } catch (error) {
            this.logger.error('Erro ao compartilhar voucher:', error);
        }
    }

    /**
     * Atualizar estatísticas
     */
    async refreshVoucherStats(chatId, telegramId, messageId) {
        await this.editMessage(chatId, messageId, '🔄 Atualizando estatísticas...');
        await this.showVoucherStats(chatId, telegramId, messageId);
    }

    /**
     * Helpers
     */
    async showNoMatrixMessage(chatId, messageId) {
        const message = '❌ **Matriz Necessária**\n\nVocê precisa criar uma matriz antes de criar um voucher!';
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🎯 Criar Matriz', callback_data: 'task_create_matrix' }
                ],
                [
                    { text: '⬅️ Voltar', callback_data: 'main_menu' }
                ]
            ]
        };
        await this.editMessage(chatId, messageId, message, keyboard);
    }

    async showNoVoucherMessage(chatId, messageId) {
        const message = '❌ **Sem Voucher**\n\nVocê ainda não criou seu voucher de convite.';
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🎫 Criar Voucher', callback_data: 'task_create_voucher' }
                ],
                [
                    { text: '⬅️ Voltar', callback_data: 'main_menu' }
                ]
            ]
        };
        await this.editMessage(chatId, messageId, message, keyboard);
    }

    async showVoucherError(chatId, messageId, error) {
        let message = '❌ **Erro ao Criar Voucher**\n\n';
        message += `${error}\n\n`;
        message += 'Tente novamente com outro nome.';

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🔄 Tentar Novamente', callback_data: 'task_create_voucher' }
                ],
                [
                    { text: '⬅️ Menu Principal', callback_data: 'main_menu' }
                ]
            ]
        };

        await this.editMessage(chatId, messageId, message, keyboard);
    }

    async showErrorMessage(chatId, messageId) {
        const message = '❌ **Erro**\n\nOcorreu um erro ao processar sua solicitação.';
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '⬅️ Menu Principal', callback_data: 'main_menu' }
                ]
            ]
        };
        await this.editMessage(chatId, messageId, message, keyboard);
    }

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
            return await this.bot.sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }
    }
}

module.exports = VoucherHandler;