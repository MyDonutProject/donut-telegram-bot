// src/handlers/wallet-operations.handler.js
const Logger = require('../utils/logger');
const WalletService = require('../services/wallet.service');
const SolanaService = require('../services/solana.service');
const WalletKeyboard = require('../keyboards/wallet.keyboard');
const { formatters } = require('../utils/formatting');
const { validators } = require('../utils/validation');

class WalletOperationsHandler {
    constructor(bot) {
        this.bot = bot.bot;
        this.botInstance = bot;
        this.walletService = bot.walletService;
        this.solanaService = bot.solanaService;
        this.messageHandler = null;
        this.logger = new Logger('WalletOperationsHandler');
        
        this.sendStates = new Map();
    }

    setMessageHandler(messageHandler) {
        this.messageHandler = messageHandler;
    }

    async showBalance(chatId, telegramId, messageId) {
        try {
            const wallet = await this.walletService.getActiveWallet(telegramId);
            
            if (!wallet) {
                return await this.editMessage(
                    chatId,
                    messageId,
                    '❌ Você não tem uma wallet ativa.\n\nCrie ou importe uma wallet primeiro.',
                    WalletKeyboard.getCreationMenu()
                );
            }

            await this.editMessage(chatId, messageId, '🔄 Consultando saldos...');

            const balances = await this.solanaService.getCompleteBalance(wallet.public_key);
            
            const usdValue = this.solanaService.getUSDValue(balances.sol.lamports, 100);

            let message = '💰 *Seus Saldos*\n\n';
            message += `🏦 *Wallet:* \`${formatters.formatAddress(wallet.public_key)}\`\n`;
            message += `🏷️ *Nome:* ${wallet.wallet_name}\n\n`;
            
            message += `💎 *SOL:* ${balances.sol.formatted}\n`;
            message += `🍩 *DONUT:* ${balances.donut.formatted}\n\n`;
            
            message += `💵 *Valor estimado:* ~$${usdValue.toFixed(2)} USD\n`;
            message += `📊 *Atualizado:* ${formatters.formatRelativeTime(balances.lastUpdate)}`;

            const keyboard = WalletKeyboard.getBalanceMenu(wallet.public_key);
            
            return await this.editMessage(chatId, messageId, message, keyboard);

        } catch (error) {
            this.logger.error('Erro ao mostrar saldo:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao consultar saldos. Tente novamente.');
        }
    }

    async showSendMenu(chatId, telegramId, messageId) {
        try {
            const wallet = await this.walletService.getActiveWallet(telegramId);
            
            if (!wallet) {
                return await this.editMessage(
                    chatId,
                    messageId,
                    '❌ Você não tem uma wallet ativa.',
                    WalletKeyboard.getCreationMenu()
                );
            }

            let message = '📤 *Enviar Tokens*\n\n';
            message += 'Selecione o tipo de token que deseja enviar:\n\n';
            message += '💎 *SOL:* Solana nativo para taxas e transferências\n';
            message += '🍩 *DONUT:* Token personalizado do projeto';

            const keyboard = WalletKeyboard.getSendMenu();
            
            return await this.editMessage(chatId, messageId, message, keyboard);

        } catch (error) {
            this.logger.error('Erro ao mostrar menu de envio:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao carregar menu.');
        }
    }

    async initSendSOL(chatId, telegramId, messageId) {
        try {
            const wallet = await this.walletService.getActiveWallet(telegramId);
            
            if (!wallet) {
                return await this.editMessage(
                    chatId,
                    messageId,
                    '❌ Wallet não encontrada.',
                    WalletKeyboard.getCreationMenu()
                );
            }

            const balance = await this.solanaService.getBalance(wallet.public_key);
            const solBalance = this.solanaService.lamportsToSol(balance);

            if (solBalance <= 0.0001) {
                return await this.editMessage(
                    chatId,
                    messageId,
                    `❌ *Saldo SOL insuficiente*\n\nSaldo atual: ${solBalance.toFixed(4)} SOL\n\nVocê precisa de pelo menos 0.0001 SOL para enviar.`,
                    WalletKeyboard.getBackMenu('send_tokens')
                );
            }

            let message = '💎 *Enviar SOL*\n\n';
            message += `💰 *Saldo disponível:* ${solBalance.toFixed(4)} SOL\n\n`;
            message += '📝 *Passo 1: Digite o endereço de destino*\n\n';
            message += '💡 Cole o endereço da wallet que deve receber os tokens.\n';
            message += 'Exemplo: `7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`';

            this.setSendState(telegramId, {
                step: 'waiting_recipient_address',
                tokenType: 'SOL',
                maxAmount: solBalance - 0.0001
            });
            
            this.messageHandler?.setUserState(telegramId, 'waiting_recipient_address');

            await this.editMessage(chatId, messageId, message);

        } catch (error) {
            this.logger.error('Erro ao iniciar envio de SOL:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao iniciar envio.');
        }
    }

    async initSendDONUT(chatId, telegramId, messageId) {
        try {
            const wallet = await this.walletService.getActiveWallet(telegramId);
            
            if (!wallet) {
                return await this.editMessage(
                    chatId,
                    messageId,
                    '❌ Wallet não encontrada.',
                    WalletKeyboard.getCreationMenu()
                );
            }

            const [donutBalance, solBalance] = await Promise.all([
                this.solanaService.getDonutBalance(wallet.public_key),
                this.solanaService.getBalance(wallet.public_key)
            ]);

            const donutAmount = donutBalance / 1e9;
            const solAmount = this.solanaService.lamportsToSol(solBalance);

            if (donutAmount <= 0) {
                return await this.editMessage(
                    chatId,
                    messageId,
                    `❌ *Sem tokens DONUT*\n\nSaldo DONUT: ${donutAmount.toFixed(2)}\n\nVocê não possui tokens DONUT para enviar.`,
                    WalletKeyboard.getBackMenu('send_tokens')
                );
            }

            if (solAmount < 0.002) {
                return await this.editMessage(
                    chatId,
                    messageId,
                    `❌ *SOL insuficiente para taxa*\n\nSaldo SOL: ${solAmount.toFixed(4)}\n\nVocê precisa de pelo menos 0.002 SOL para taxa de envio de tokens.`,
                    WalletKeyboard.getBackMenu('send_tokens')
                );
            }

            let message = '🍩 *Enviar DONUT*\n\n';
            message += `💰 *Saldo disponível:* ${donutAmount.toFixed(2)} DONUT\n`;
            message += `💎 *SOL para taxa:* ${solAmount.toFixed(4)} SOL\n\n`;
            message += '📝 *Passo 1: Digite o endereço de destino*\n\n';
            message += '💡 Cole o endereço da wallet que deve receber os tokens DONUT.';

            this.setSendState(telegramId, {
                step: 'waiting_recipient_address',
                tokenType: 'DONUT',
                maxAmount: donutAmount
            });
            
            this.messageHandler?.setUserState(telegramId, 'waiting_recipient_address');

            await this.editMessage(chatId, messageId, message);

        } catch (error) {
            this.logger.error('Erro ao iniciar envio de DONUT:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao iniciar envio.');
        }
    }

    async processRecipientAddress(text, chatId, telegramId) {
        const sendState = this.getSendState(telegramId);
        
        if (!sendState || sendState.step !== 'waiting_recipient_address') {
            this.logger.error(`Estado inválido: esperado waiting_recipient_address, atual: ${sendState?.step}`);
            return await this.sendMessage(chatId, '❌ Estado de envio inválido. Tente novamente.');
        }

        const address = text.trim();

        if (address.toLowerCase() === '/cancel' || address.toLowerCase() === 'cancelar') {
            this.clearSendState(telegramId);
            this.messageHandler?.clearUserState(telegramId);
            return await this.sendMessage(chatId, 
                '❌ Envio cancelado.',
                WalletKeyboard.getSendMenu()
            );
        }

        if (!validators.isValidSolanaAddress(address)) {
            return await this.sendMessage(chatId,
                '❌ *Endereço inválido!*\n\n' +
                'Digite um endereço Solana válido.\n\n' +
                '💡 Exemplo: `7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`\n\n' +
                'Digite novamente ou use /cancel para cancelar:'
            );
        }

        const wallet = await this.walletService.getActiveWallet(telegramId);
        if (address === wallet.public_key) {
            return await this.sendMessage(chatId,
                '❌ *Não é possível enviar para sua própria wallet!*\n\n' +
                'Digite um endereço diferente:'
            );
        }

        this.updateSendState(telegramId, {
            recipient: address,
            step: 'waiting_send_amount'
        });
        
        this.messageHandler?.setUserState(telegramId, 'waiting_send_amount');

        const { tokenType, maxAmount } = sendState;
        const symbol = tokenType === 'SOL' ? 'SOL' : 'DONUT';

        let message = `✅ *Endereço confirmado!*\n\n`;
        message += `📍 *Destinatário:* \`${formatters.formatAddress(address)}\`\n\n`;
        message += `📝 *Passo 2: Digite a quantidade*\n\n`;
        message += `💰 *Máximo disponível:* ${maxAmount.toFixed(tokenType === 'SOL' ? 4 : 2)} ${symbol}\n\n`;
        message += `💡 Digite a quantidade de ${symbol} que deseja enviar.`;

        return await this.sendMessage(chatId, message);
    }

    async processAmountToSend(text, chatId, telegramId) {
        const sendState = this.getSendState(telegramId);
        
        if (!sendState || sendState.step !== 'waiting_send_amount') {
            this.logger.error(`Estado inválido: esperado waiting_send_amount, atual: ${sendState?.step}`);
            return await this.sendMessage(chatId, '❌ Estado de envio inválido. Tente novamente.');
        }

        const amountText = text.trim().replace(',', '.');
        const amount = parseFloat(amountText);

        if (text.toLowerCase() === '/cancel' || text.toLowerCase() === 'cancelar') {
            this.clearSendState(telegramId);
            this.messageHandler?.clearUserState(telegramId);
            return await this.sendMessage(chatId, 
                '❌ Envio cancelado.',
                WalletKeyboard.getSendMenu()
            );
        }

        if (isNaN(amount) || amount <= 0) {
            return await this.sendMessage(chatId,
                '❌ *Quantidade inválida!*\n\n' +
                'Digite um número válido maior que zero.\n\n' +
                '💡 Exemplo: 0.5 ou 10.25'
            );
        }

        const { tokenType, maxAmount, recipient } = sendState;

        if (amount > maxAmount) {
            return await this.sendMessage(chatId,
                `❌ *Quantidade excede o saldo disponível!*\n\n` +
                `Máximo: ${maxAmount.toFixed(tokenType === 'SOL' ? 4 : 2)} ${tokenType}\n` +
                `Digitado: ${amount.toFixed(tokenType === 'SOL' ? 4 : 2)} ${tokenType}\n\n` +
                'Digite uma quantidade menor:'
            );
        }

        if (tokenType === 'SOL' && amount < 0.000001) {
            return await this.sendMessage(chatId,
                '❌ *Quantidade muito pequena!*\n\n' +
                'Mínimo para envio: 0.000001 SOL'
            );
        }

        if (tokenType === 'DONUT' && amount < 0.01) {
            return await this.sendMessage(chatId,
                '❌ *Quantidade muito pequena!*\n\n' +
                'Mínimo para envio: 0.01 DONUT'
            );
        }

        const wallet = await this.walletService.getActiveWallet(telegramId);
        const feeInfo = await this.solanaService.estimateTransactionFee(
            tokenType.toLowerCase(), 
            recipient
        );

        const validation = await this.solanaService.validateSufficientBalance(
            wallet.public_key,
            tokenType,
            amount
        );

        if (!validation.sufficient) {
            let message = `❌ *Saldo insuficiente!*\n\n`;
            
            if (tokenType === 'SOL') {
                message += `Necessário: ${validation.needed.toFixed(4)} SOL (incluindo taxa)\n`;
                message += `Disponível: ${validation.available.toFixed(4)} SOL`;
            } else {
                message += `DONUT necessário: ${validation.neededToken.toFixed(2)} DONUT\n`;
                message += `DONUT disponível: ${validation.availableToken.toFixed(2)} DONUT\n\n`;
                message += `SOL necessário para taxa: ${validation.neededSol.toFixed(6)} SOL\n`;
                message += `SOL disponível: ${validation.availableSol.toFixed(6)} SOL`;
            }
            
            return await this.sendMessage(chatId, message);
        }

        this.updateSendState(telegramId, {
            amount: amount,
            feeInfo: feeInfo,
            step: 'waiting_confirmation'
        });
        
        this.messageHandler?.clearUserState(telegramId);

        let message = '📋 *Resumo da Transação*\n\n';
        message += `💎 *Token:* ${tokenType}\n`;
        message += `📤 *Quantidade:* ${amount.toFixed(tokenType === 'SOL' ? 6 : 2)} ${tokenType}\n`;
        message += `📍 *Destinatário:* \`${formatters.formatAddress(recipient)}\`\n\n`;
        message += `💰 *Taxa estimada:* ${feeInfo.formatted}\n`;
        
        if (feeInfo.createAccount) {
            message += `ℹ️ *Nova conta:* Será criada conta de token para destinatário\n`;
        }
        
        message += `\n⚠️ *Esta operação não pode ser desfeita!*\n\n`;
        message += '✅ Confirme para prosseguir:';

        const keyboard = WalletKeyboard.getSendConfirmationMenu(amount, tokenType.toLowerCase(), recipient);
        
        return await this.sendMessage(chatId, message, keyboard);
    }

    async confirmSend(chatId, telegramId, messageId) {
        const sendState = this.getSendState(telegramId);
        
        if (!sendState || sendState.step !== 'waiting_confirmation') {
            return await this.editMessage(
                chatId,
                messageId,
                '❌ Estado de envio inválido. Inicie novamente.',
                WalletKeyboard.getSendMenu()
            );
        }

        try {
            let message = '🔐 *Confirmar com PIN*\n\n';
            message += `📤 Enviando ${sendState.amount} ${sendState.tokenType}\n`;
            message += `📍 Para: \`${formatters.formatAddress(sendState.recipient)}\`\n\n`;
            message += 'Digite seu PIN para confirmar a transação:';

            this.updateSendState(telegramId, {
                step: 'waiting_pin_for_send'
            });
            
            this.messageHandler?.setUserState(telegramId, 'waiting_pin_for_send');

            await this.editMessage(chatId, messageId, message);

        } catch (error) {
            this.logger.error('Erro ao confirmar envio:', error);
            this.clearSendState(telegramId);
            return await this.sendErrorMessage(chatId, 'Erro ao processar confirmação.');
        }
    }

    async processPinForSend(pin, chatId, telegramId) {
        const sendState = this.getSendState(telegramId);
        
        if (!sendState || sendState.step !== 'waiting_pin_for_send') {
            this.logger.error(`Estado inválido: esperado waiting_pin_for_send, atual: ${sendState?.step}`);
            return await this.sendMessage(chatId, '❌ Estado de envio inválido.');
        }

        try {
            pin = pin.trim();

            if (pin.toLowerCase() === '/cancel' || pin.toLowerCase() === 'cancelar') {
                this.clearSendState(telegramId);
                this.messageHandler?.clearUserState(telegramId);
                return await this.sendMessage(chatId, 
                    '❌ Envio cancelado.',
                    WalletKeyboard.getSendMenu()
                );
            }

            const keypairResult = await this.walletService.getKeypair(telegramId, pin);
            
            if (!keypairResult.success) {
                return await this.sendMessage(chatId,
                    '❌ *PIN incorreto!*\n\n' +
                    'Digite novamente ou use /cancel para cancelar:'
                );
            }

            await this.sendMessage(chatId, '🔄 *Processando transação...*\n\nAguarde alguns segundos.');

            const { keypair } = keypairResult;
            const { tokenType, amount, recipient } = sendState;

            let result;

            if (tokenType === 'SOL') {
                result = await this.solanaService.sendSOL(keypair, recipient, amount);
            } else if (tokenType === 'DONUT') {
                result = await this.solanaService.sendDONUT(keypair, recipient, amount);
            } else {
                throw new Error('Tipo de token não suportado');
            }

            this.clearSendState(telegramId);
            this.messageHandler?.clearUserState(telegramId);

            if (result.success) {
                let message = '✅ *Transação Concluída com Sucesso!*\n\n';
                message += `📤 *Enviado:* ${result.amount} ${result.token}\n`;
                message += `📍 *Para:* \`${formatters.formatAddress(result.recipient)}\`\n`;
                message += `💰 *Taxa paga:* ${result.fee.toFixed(6)} SOL\n\n`;
                message += `🔗 *Assinatura:*\n\`${result.signature}\`\n\n`;
                
                if (result.createdAccount) {
                    message += '📝 *Conta de token criada para o destinatário*\n\n';
                }
                
                message += `✨ ${result.message}`;

                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: '🔍 Ver na Blockchain', url: `https://solscan.io/tx/${result.signature}` }
                        ],
                        [
                            { text: '💰 Ver Saldo', callback_data: 'view_balance' },
                            { text: '📤 Enviar Mais', callback_data: 'send_tokens' }
                        ],
                        [
                            { text: '⬅️ Menu Principal', callback_data: 'main_menu' }
                        ]
                    ]
                };

                return await this.sendMessage(chatId, message, keyboard);

            } else {
                let message = '❌ *Transação Falhou*\n\n';
                message += `🚫 *Erro:* ${result.error}\n\n`;
                
                if (result.details) {
                    message += `📋 *Detalhes:* ${result.details}\n\n`;
                }
                
                message += 'Verifique seus saldos e tente novamente.';

                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: '💰 Verificar Saldo', callback_data: 'view_balance' }
                        ],
                        [
                            { text: '🔄 Tentar Novamente', callback_data: 'send_tokens' }
                        ],
                        [
                            { text: '⬅️ Menu Principal', callback_data: 'main_menu' }
                        ]
                    ]
                };

                return await this.sendMessage(chatId, message, keyboard);
            }

        } catch (error) {
            this.logger.error('Erro ao executar transação:', error);
            this.clearSendState(telegramId);
            this.messageHandler?.clearUserState(telegramId);
            
            return await this.sendMessage(chatId,
                '❌ *Erro na Transação*\n\n' +
                'Ocorreu um erro inesperado. Tente novamente em alguns minutos.\n\n' +
                `Detalhes: ${error.message}`,
                WalletKeyboard.getBackMenu('main_menu')
            );
        }
    }

    async showReceiveInfo(chatId, telegramId, messageId) {
        try {
            const wallet = await this.walletService.getActiveWallet(telegramId);
            
            if (!wallet) {
                return await this.editMessage(
                    chatId,
                    messageId,
                    '❌ Você não tem uma wallet ativa.',
                    WalletKeyboard.getCreationMenu()
                );
            }

            let message = '📥 *Receber Tokens*\n\n';
            message += `💳 *Sua Wallet:* ${wallet.wallet_name}\n\n`;
            message += `📍 *Endereço para recebimento:*\n`;
            message += `\`${wallet.public_key}\`\n\n`;
            message += '💡 *Como usar:*\n';
            message += '• Compartilhe este endereço com quem vai enviar\n';
            message += '• Funciona para SOL e tokens DONUT\n';
            message += '• Transações aparecem automaticamente\n\n';
            message += '⚠️ *Importante:*\n';
            message += '• Só aceite tokens na rede Solana\n';
            message += '• Verifique sempre o endereço antes de compartilhar';

            const keyboard = WalletKeyboard.getReceiveMenu(wallet.public_key);
            
            return await this.editMessage(chatId, messageId, message, keyboard);

        } catch (error) {
            this.logger.error('Erro ao mostrar info de recebimento:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao carregar informações.');
        }
    }

    async copyAddress(chatId, telegramId, messageId, publicKey = null) {
        try {
            this.logger.info(`CopyAddress chamado: publicKey=${publicKey}`);
            
            let address = publicKey;
            
            if (!address) {
                const wallet = await this.walletService.getActiveWallet(telegramId);
                if (!wallet) {
                    this.logger.error('Wallet não encontrada para copiar endereço');
                    return await this.sendErrorMessage(chatId, 'Wallet não encontrada.');
                }
                address = wallet.public_key;
            }

            await this.bot.sendMessage(chatId, `\`${address}\``, { parse_mode: 'Markdown' });

            await this.editMessage(chatId, messageId,
                '📋 *Endereço enviado acima*\n\n' +
                '👆 Toque e segure no endereço para copiar\n' +
                '✅ Cole onde precisar!',
                {
                    inline_keyboard: [
                        [
                            { text: '📤 Compartilhar', callback_data: 'share_address' }
                        ],
                        [
                            { text: '📱 Ver QR Code', callback_data: 'show_qr_code' }
                        ],
                        [
                            { text: '⬅️ Voltar', callback_data: 'receive_tokens' }
                        ]
                    ]
                }
            );

        } catch (error) {
            this.logger.error('Erro ao copiar endereço:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao processar solicitação.');
        }
    }

    async showQRCode(chatId, telegramId, messageId) {
        try {
            const wallet = await this.walletService.getActiveWallet(telegramId);
            
            if (!wallet) {
                return await this.sendErrorMessage(chatId, 'Wallet não encontrada.');
            }

            const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(wallet.public_key)}`;

            let message = '📱 *QR Code do seu Endereço*\n\n';
            message += `💳 *Wallet:* ${wallet.wallet_name}\n`;
            message += `📍 *Endereço:* \`${formatters.formatAddress(wallet.public_key)}\`\n\n`;
            message += '📱 *Como usar:*\n';
            message += '• Mostre o QR para escanear\n';
            message += '• Funciona com carteiras móveis\n';
            message += '• Phantom, Solflare, etc.\n\n';
            message += '⚠️ *Cuidado:* Só compartilhe com pessoas confiáveis!';

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '📋 Copiar Endereço', callback_data: `copy_address_${wallet.public_key}` }
                    ],
                    [
                        { text: '📤 Compartilhar', callback_data: 'share_address' }
                    ],
                    [
                        { text: '⬅️ Voltar', callback_data: 'receive_tokens' }
                    ]
                ]
            };

            await this.editMessage(chatId, messageId, message, keyboard);

            try {
                await this.bot.sendPhoto(chatId, qrCodeUrl, {
                    caption: `\`${wallet.public_key}\``,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📋 Copiar Endereço Completo', callback_data: `copy_address_${wallet.public_key}` }
                            ]
                        ]
                    }
                });
            } catch (photoError) {
                this.logger.error('Erro ao enviar QR Code:', photoError);
                
                let fallbackMessage = `📱 *QR Code (clique no link):*\n`;
                fallbackMessage += `🔗 [Visualizar QR Code](${qrCodeUrl})\n\n`;
                fallbackMessage += `📍 *Endereço completo:*\n\`${wallet.public_key}\``;

                await this.sendMessage(chatId, fallbackMessage, keyboard);
            }

        } catch (error) {
            this.logger.error('Erro ao mostrar QR Code:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao gerar QR Code.');
        }
    }

    async shareAddress(chatId, telegramId, messageId) {
        try {
            const wallet = await this.walletService.getActiveWallet(telegramId);
            
            if (!wallet) {
                return await this.sendErrorMessage(chatId, 'Wallet não encontrada.');
            }

            const shareText = `💳 Meu endereço Solana:\n${wallet.public_key}`;
            const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(shareText)}`;

            await this.editMessage(chatId, messageId,
                '📤 *Compartilhar Endereço*\n\n' +
                'Clique no botão abaixo para compartilhar seu endereço:',
                {
                    inline_keyboard: [
                        [
                            { text: '📤 Compartilhar Agora', url: shareUrl }
                        ],
                        [
                            { text: '📋 Copiar Endereço', callback_data: `copy_address_${wallet.public_key}` }
                        ],
                        [
                            { text: '⬅️ Voltar', callback_data: 'receive_tokens' }
                        ]
                    ]
                }
            );

        } catch (error) {
            this.logger.error('Erro ao compartilhar endereço:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao compartilhar endereço.');
        }
    }

    async shareInChat(chatId, telegramId, messageId) {
        try {
            const wallet = await this.walletService.getActiveWallet(telegramId);
            
            if (!wallet) {
                return await this.sendErrorMessage(chatId, 'Wallet não encontrada.');
            }

            const shareMessage = `💳 *Meu Endereço Solana*\n\n` +
                `📍 \`${wallet.public_key}\`\n\n` +
                `✅ *Aceito:*\n` +
                `• 💎 SOL (Solana nativo)\n` +
                `• 🍩 Tokens DONUT\n\n` +
                `🔗 *Rede:* Solana Mainnet\n` +
                `🛡️ *Verificado:* ${formatters.formatAddress(wallet.public_key)}`;

            await this.sendMessage(chatId, shareMessage, {
                inline_keyboard: [
                    [
                        { text: '📋 Copiar Endereço', callback_data: `copy_address_${wallet.public_key}` }
                    ],
                    [
                        { text: '📱 Ver QR Code', callback_data: 'show_qr_code' }
                    ]
                ]
            });

            await this.editMessage(
                chatId, 
                messageId,
                '✅ *Endereço compartilhado no chat!*\n\nSua mensagem foi enviada acima.',
                {
                    inline_keyboard: [
                        [
                            { text: '⬅️ Voltar', callback_data: 'receive_tokens' }
                        ]
                    ]
                }
            );

        } catch (error) {
            this.logger.error('Erro ao compartilhar no chat:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao compartilhar.');
        }
    }

    async copyShareText(chatId, telegramId, messageId) {
        try {
            const wallet = await this.walletService.getActiveWallet(telegramId);
            
            if (!wallet) {
                return await this.sendErrorMessage(chatId, 'Wallet não encontrada.');
            }

            const shareText = `💳 Meu endereço Solana para receber tokens:

📍 ${wallet.public_key}

✅ Aceito SOL e tokens DONUT
🔗 Rede: Solana Mainnet

Pode enviar à vontade! 🚀`;

            let message = '📋 *Texto Copiado!*\n\n';
            message += '```\n' + shareText + '\n```\n\n';
            message += '✅ *Texto pronto para colar!*\n\n';
            message += '💡 *Use em:*\n';
            message += '• WhatsApp, Telegram, Discord\n';
            message += '• E-mails e mensagens\n';
            message += '• Redes sociais';

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '📤 Outras Opções', callback_data: 'share_address' }
                    ],
                    [
                        { text: '⬅️ Voltar', callback_data: 'receive_tokens' }
                    ]
                ]
            };

            return await this.editMessage(chatId, messageId, message, keyboard);

        } catch (error) {
            this.logger.error('Erro ao copiar texto:', error);
            return await this.sendErrorMessage(chatId, 'Erro ao copiar texto.');
        }
    }

    async cancelSend(chatId, telegramId, messageId) {
        this.clearSendState(telegramId);
        this.messageHandler?.clearUserState(telegramId);
        
        return await this.editMessage(
            chatId,
            messageId,
            '❌ *Envio cancelado.*\n\nO que deseja fazer agora?',
            WalletKeyboard.getSendMenu()
        );
    }

    setSendState(telegramId, state) {
        this.sendStates.set(telegramId, {
            ...state,
            timestamp: Date.now()
        });
        this.logger.info(`Estado de envio configurado para ${telegramId}: ${state.step}`);
    }

    updateSendState(telegramId, updates) {
        const current = this.sendStates.get(telegramId);
        if (current) {
            this.sendStates.set(telegramId, {
                ...current,
                ...updates,
                timestamp: Date.now()
            });
            this.logger.info(`Estado de envio atualizado para ${telegramId}: ${updates.step || 'mantido'}`);
        }
    }

    getSendState(telegramId) {
        const state = this.sendStates.get(telegramId);
        if (state) {
            if (Date.now() - state.timestamp > 600000) {
                this.clearSendState(telegramId);
                return null;
            }
        }
        return state;
    }

    clearSendState(telegramId) {
        this.sendStates.delete(telegramId);
        this.logger.info(`Estado de envio limpo para ${telegramId}`);
    }

    async sendMessage(chatId, text, keyboard = null) {
        const options = { parse_mode: 'Markdown' };
        if (keyboard) options.reply_markup = keyboard;
        
        try {
            return await this.bot.sendMessage(chatId, text, options);
        } catch (error) {
            this.logger.error('Erro ao enviar mensagem:', error);
            return await this.bot.sendMessage(chatId, text.replace(/[*_`]/g, ''), { reply_markup: keyboard });
        }
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
            if (error.message.includes('message is not modified')) {
                return;
            }
            return await this.sendMessage(chatId, text, keyboard);
        }
    }

    async sendErrorMessage(chatId, errorText) {
        const message = `❌ *Erro*\n\n${errorText}`;
        return await this.sendMessage(chatId, message, WalletKeyboard.getBackMenu('main_menu'));
    }
}

module.exports = WalletOperationsHandler;