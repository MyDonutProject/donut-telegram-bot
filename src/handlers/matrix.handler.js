// src/handlers/matrix.handler.js
const Logger = require('../utils/logger');
const { formatters } = require('../utils/formatting');

class MatrixHandler {
    constructor(bot) {
        this.bot = bot.bot;
        this.botInstance = bot;
        this.logger = new Logger('MatrixHandler');
        
        // Services serão injetados
        this.matrixService = null;
        this.walletService = bot.walletService;
        this.solanaService = bot.solanaService;
        this.priceService = bot.priceService;
    }

    /**
     * Injetar MatrixService
     */
    setMatrixService(matrixService) {
        this.matrixService = matrixService;
    }

    /**
     * Processar tarefa de criar matriz
     */
    async handleMatrixTask(chatId, telegramId, messageId) {
        try {
            // Verificar se tem wallet
            const wallet = await this.walletService.getActiveWallet(telegramId);
            if (!wallet) {
                return await this.showNoWalletMessage(chatId, messageId);
            }

            // Verificar se já tem matriz
            const existingMatrix = await this.matrixService.getUserMatrix(telegramId);
            if (existingMatrix && existingMatrix.status === 'active') {
                return await this.showMatrixStats(chatId, telegramId, messageId);
            }

            // Obter saldo em SOL
            const balance = await this.solanaService.getBalance(wallet.public_key);
            const solBalance = this.solanaService.lamportsToSol(balance);
            
            // CORREÇÃO: Usar priceService.getSOLPrice()
            const solPrice = await this.priceService.getSOLPrice();
            const usdValue = solBalance * solPrice;
            
            // Valor necessário com buffer de 3%
            const requiredUSD = 10.3; // $10 + 3% buffer
            
            this.logger.info(`Verificação de saldo para matriz:`, {
                solBalance: solBalance.toFixed(4),
                solPrice: solPrice.toFixed(2),
                usdValue: usdValue.toFixed(2),
                requiredUSD: requiredUSD.toFixed(2),
                sufficient: usdValue >= requiredUSD
            });

            if (usdValue < requiredUSD) {
                return await this.showInsufficientBalance(chatId, messageId, solBalance, usdValue, requiredUSD);
            }

            // Mostrar confirmação
            await this.showMatrixConfirmation(chatId, telegramId, messageId, solBalance, usdValue, solPrice);

        } catch (error) {
            this.logger.error('Erro ao processar tarefa de matriz:', error);
            await this.showErrorMessage(chatId, messageId);
        }
    }

    /**
     * Mostrar tela de confirmação para criar matriz
     */
    async showMatrixConfirmation(chatId, telegramId, messageId, solBalance, usdValue, solPrice) {
        // Calcular quantidade exata de SOL necessária
        const requiredUSD = 10.3;
        const requiredSOL = requiredUSD / solPrice;
        
        let message = '🎯 **Criar Sua Matriz 3x1**\n\n';
        message += '📊 **Como funciona:**\n';
        message += '• Você entra na matriz de quem te convidou\n';
        message += '• Recebe 3 pessoas na sua matriz\n';
        message += '• Ganhos automáticos a cada novo membro\n\n';
        
        message += '💰 **Investimento:**\n';
        message += `• Valor: $10 USD (+ 3% taxa de rede)\n`;
        message += `• Total: $${requiredUSD.toFixed(2)} USD\n`;
        message += `• Em SOL: ~${requiredSOL.toFixed(4)} SOL\n`;
        message += `• Preço SOL atual: $${solPrice.toFixed(2)}\n\n`;
        
        message += '💎 **Seu saldo:**\n';
        message += `• ${solBalance.toFixed(4)} SOL (~$${usdValue.toFixed(2)})\n\n`;
        
        message += '🔄 **Distribuição por Slot:**\n';
        message += '• **Slot 1:** Swap para DONUT e burn (valorização)\n';
        message += '• **Slot 2:** Reserva SOL para você\n';
        message += '• **Slot 3:** Paga SOL reservado + bônus\n\n';
        
        message += '⚠️ **Confirmar criação da matriz?**\n';
        message += 'Digite seu PIN para confirmar:';

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '❌ Cancelar', callback_data: 'cancel_matrix' }
                ]
            ]
        };

        // Definir estado para aguardar PIN
        this.botInstance.setUserState(telegramId, {
            action: 'waiting_pin_for_matrix',
            messageId: messageId
        });

        await this.editMessage(chatId, messageId, message, keyboard);
    }

    /**
     * Processar PIN para criar matriz
     */
    async processMatrixCreation(chatId, telegramId, pin, messageId) {
        try {
            // Mostrar loading
            await this.editMessage(chatId, messageId, '⏳ Criando sua matriz na blockchain...\n\nIsso pode levar alguns segundos...');

            // Criar matriz (PIN validado apenas uma vez aqui)
            const result = await this.matrixService.createMatrix(telegramId, pin);

            if (result.success) {
                await this.showMatrixSuccess(chatId, telegramId, messageId, result);
            } else {
                await this.showMatrixError(chatId, messageId, result.error);
            }

        } catch (error) {
            this.logger.error('Erro ao criar matriz:', error);
            await this.showErrorMessage(chatId, messageId);
        }
    }

    /**
     * Mostrar sucesso na criação da matriz
     */
    async showMatrixSuccess(chatId, telegramId, messageId, result) {
        let message = '✅ **MATRIZ CRIADA COM SUCESSO!**\n\n';
        message += '🎯 Você está oficialmente na rede Donut!\n\n';
        
        message += '🔗 **Transação confirmada na blockchain:**\n';
        message += `[Ver no Solscan](${result.explorerUrl})\n\n`;
        
        message += '🎉 **Próxima Tarefa:**\n';
        message += 'Criar seu voucher de convite\n';
 

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🎫 Criar Voucher Agora', callback_data: 'task_create_voucher' }
                ],
                [
                    { text: '📊 Ver Minha Matriz', callback_data: 'view_my_matrix' }
                ],
                [
                    { text: '🏠 Menu Principal', callback_data: 'main_menu' }
                ]
            ]
        };

        await this.editMessage(chatId, messageId, message, keyboard);

        // Notificação adicional
        setTimeout(async () => {
            await this.bot.sendMessage(chatId, 
                '💡 **Dica:** Crie seu voucher agora para começar a convidar pessoas e preencher sua matriz!',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🎫 Criar Voucher', callback_data: 'task_create_voucher' }
                        ]]
                    }
                }
            );
        }, 3000);
    }

    /**
     * Mostrar estatísticas da matriz
     */
    async showMatrixStats(chatId, telegramId, messageId) {
        try {
            const stats = await this.matrixService.getMatrixStats(telegramId);

            if (!stats.hasMatrix) {
                return await this.showNoMatrixMessage(chatId, messageId);
            }

            let message = '📊 **Sua Matriz 3x1**\n\n';
            
            message += '🎯 **Status:** Ativa ✅\n';
            message += `📍 **Endereço:** \`${formatters.formatAddress(stats.matrix.wallet_address)}\`\n`;
            message += `👥 **Referenciador:** \`${formatters.formatAddress(stats.matrix.referrer_address)}\`\n\n`;
            
            message += '**📈 Slots Preenchidos:**\n';
            message += `• Slot 1: ${stats.slots.slot1 ? '✅ ' + formatters.formatAddress(stats.slots.slot1) : '⏳ Aguardando'}\n`;
            message += `• Slot 2: ${stats.slots.slot2 ? '✅ ' + formatters.formatAddress(stats.slots.slot2) : '⏳ Aguardando'}\n`;
            message += `• Slot 3: ${stats.slots.slot3 ? '✅ ' + formatters.formatAddress(stats.slots.slot3) : '⏳ Aguardando'}\n\n`;
            
            message += '**💰 Ganhos:**\n';
            message += `• Total Ganho: ${stats.totalEarned.toFixed(4)} SOL\n`;
            message += `• SOL Reservado: ${stats.solReserved.toFixed(4)} SOL\n`;
            message += `• Referências Totais: ${stats.referrals}\n\n`;
            
            if (stats.totalSlotsFilled >= 3) {
                message += '🔄 **Matriz completa!** Agora o processo continua, você acaba de ganhar uma matriz nova.\n';
            } else {
                message += `📢 **Faltam ${3 - stats.totalSlotsFilled} pessoas para completar sua matriz e liberar suas recompensas!**\n`;
            }

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '🔄 Atualizar', callback_data: 'refresh_matrix' }
                    ],
                    [
                        { text: '🎫 Meu Voucher', callback_data: 'view_my_voucher' }
                    ],
                    [
                        { text: '📜 Histórico', callback_data: 'matrix_history' }
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
     * Atualizar matriz
     */
    async refreshMatrix(chatId, telegramId, messageId) {
        await this.editMessage(chatId, messageId, '🔄 Sincronizando com blockchain...');
        
        // Sincronizar
        await this.matrixService.syncWithBlockchain(telegramId);
        
        // Mostrar estatísticas atualizadas
        await this.showMatrixStats(chatId, telegramId, messageId);
    }

    /**
     * Mostrar histórico de transações
     */
    async showMatrixHistory(chatId, telegramId, messageId) {
        try {
            const transactions = await this.botInstance.db.all(`
                SELECT * FROM matrix_transactions 
                WHERE telegram_id = ?
                ORDER BY created_at DESC
                LIMIT 10
            `, [telegramId]);

            if (!transactions || transactions.length === 0) {
                return await this.editMessage(
                    chatId,
                    messageId,
                    '📜 **Histórico Vazio**\n\nVocê ainda não tem transações na matriz.',
                    {
                        inline_keyboard: [[
                            { text: '⬅️ Voltar', callback_data: 'view_my_matrix' }
                        ]]
                    }
                );
            }

            let message = '📜 **Histórico de Transações**\n\n';

            for (const tx of transactions) {
                const date = new Date(tx.created_at).toLocaleDateString('pt-BR');
                const type = this.getTransactionTypeName(tx.transaction_type);
                
                message += `📅 ${date}\n`;
                message += `• Tipo: ${type}\n`;
                message += `• Valor: ${tx.amount_sol?.toFixed(4) || 0} SOL\n`;
                if (tx.transaction_signature) {
                    message += `• [Ver transação](https://solscan.io/tx/${tx.transaction_signature})\n`;
                }
                message += '\n';
            }

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '⬅️ Voltar', callback_data: 'view_my_matrix' }
                    ]
                ]
            };

            await this.editMessage(chatId, messageId, message, keyboard);

        } catch (error) {
            this.logger.error('Erro ao mostrar histórico:', error);
            await this.showErrorMessage(chatId, messageId);
        }
    }

    /**
     * Helpers
     */
    getTransactionTypeName(type) {
        const types = {
            'registration': '🎯 Registro na Matriz',
            'slot_payment': '💰 Pagamento de Slot',
            'distribution': '📤 Distribuição'
        };
        return types[type] || type;
    }

    async showNoWalletMessage(chatId, messageId) {
        const message = '❌ **Wallet Necessária**\n\nVocê precisa criar uma wallet primeiro!';
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '💳 Criar Wallet', callback_data: 'task_create_wallet' }
                ],
                [
                    { text: '⬅️ Voltar', callback_data: 'main_menu' }
                ]
            ]
        };
        await this.editMessage(chatId, messageId, message, keyboard);
    }

    async showNoMatrixMessage(chatId, messageId) {
        const message = '❌ **Sem Matriz**\n\nVocê ainda não tem uma matriz ativa.';
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

    async showInsufficientBalance(chatId, messageId, solBalance, usdValue, requiredUSD) {
        const needed = requiredUSD - usdValue;
        
        // Obter preço atual para calcular SOL necessário
        const solPrice = await this.priceService.getSOLPrice();
        const neededSOL = needed / solPrice;
        
        let message = '💰 **Saldo Insuficiente**\n\n';
        message += `📊 **Necessário:** $${requiredUSD.toFixed(2)} USD\n`;
        message += `💎 **Seu saldo:** ${solBalance.toFixed(4)} SOL (~$${usdValue.toFixed(2)})\n`;
        message += `⚠️ **Faltam:** ~$${needed.toFixed(2)} USD (${neededSOL.toFixed(4)} SOL)\n\n`;
        message += `💵 **Preço SOL atual:** $${solPrice.toFixed(2)}\n\n`;
        message += 'Adicione mais SOL à sua wallet para continuar.';

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '💰 Ver Wallet', callback_data: 'wallet_menu' }
                ],
                [
                    { text: '⬅️ Voltar', callback_data: 'main_menu' }
                ]
            ]
        };

        await this.editMessage(chatId, messageId, message, keyboard);
    }

    async showMatrixError(chatId, messageId, error) {
        try {
            // Extrair mensagem de erro
            let errorMessage = '';
            
            if (typeof error === 'string') {
                errorMessage = error;
            } else if (error && error.message) {
                errorMessage = error.message;
            } else if (error && error.error) {
                errorMessage = error.error;
            } else {
                errorMessage = 'Erro desconhecido ao processar a solicitação';
            }
    
            // Remover COMPLETAMENTE caracteres problemáticos
            errorMessage = errorMessage
                .replace(/[_*\[\]()~`>#+=|{}.!-]/g, ' ')  // Substituir por espaço
                .replace(/'/g, '')  // Remover apóstrofos
                .replace(/"/g, '')  // Remover aspas
                .replace(/\\/g, '')  // Remover barras invertidas
                .replace(/\n+/g, ' ')  // Substituir quebras de linha por espaço
                .replace(/\s+/g, ' ')  // Remover espaços múltiplos
                .trim();
    
            // Limitar tamanho
            if (errorMessage.length > 150) {
                errorMessage = errorMessage.substring(0, 150) + '...';
            }
    
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '🔄 Tentar Novamente', callback_data: 'task_create_matrix' }
                    ],
                    [
                        { text: '👥 Grupo de Ajuda', url: 'https://t.me/donutmatrix' }
                    ],
                    [
                        { text: '⬅️ Menu Principal', callback_data: 'main_menu' }
                    ]
                ]
            };
    
            // Mensagem sem formatação Markdown
            const plainMessage = `❌ Erro ao Criar Matriz\n\n${errorMessage}\n\nTente novamente ou entre em contato com o suporte.`;
    
            try {
                // IMPORTANTE: NÃO usar parse_mode!
                await this.bot.editMessageText(plainMessage, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: keyboard
                    // NÃO adicionar parse_mode aqui!
                });
            } catch (editError) {
                // Se falhar ao editar, enviar nova mensagem SEM parse_mode
                await this.bot.sendMessage(chatId, plainMessage, {
                    reply_markup: keyboard
                    // NÃO adicionar parse_mode aqui!
                });
            }
            
        } catch (finalError) {
            this.logger.error('Erro crítico ao mostrar mensagem de erro:', finalError);
            
            // Fallback final - mensagem super simples
            try {
                await this.bot.sendMessage(
                    chatId, 
                    'Erro ao criar matriz. Tente novamente.',
                    {
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '🔄 Tentar', callback_data: 'task_create_matrix' },
                                { text: '⬅️ Menu', callback_data: 'main_menu' }
                            ]]
                        }
                    }
                );
            } catch (e) {
                // Ignorar se até isso falhar
            }
        }
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

module.exports = MatrixHandler;