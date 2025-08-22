// src/keyboards/main.keyboard.js
class MainKeyboard {
    /**
     * Menu baseado no estado do usuário
     */
    static getProgressiveMenu(flowState, nextAction, wallet, progressPercent) {
        const keyboard = {
            inline_keyboard: []
        };
        
        // Se completou todas as tarefas
        if (progressPercent >= 100) {
            // Menu completo para usuários que finalizaram
            keyboard.inline_keyboard.push([
                { text: '🚀 Continuar Indicando', callback_data: 'task_first_referral' }
            ]);
            
            if (wallet) {
                keyboard.inline_keyboard.push([
                    { text: '💳 Wallet', callback_data: 'wallet_menu' }
                ]);
                keyboard.inline_keyboard.push([
                    { text: '📤 Enviar', callback_data: 'send_tokens' },
                    { text: '📥 Receber', callback_data: 'receive_tokens' }
                ]);
            }
            
            keyboard.inline_keyboard.push([
                { text: '🎯 Minha Matriz', callback_data: 'view_matrix' }
            ]);
            keyboard.inline_keyboard.push([
                { text: '🎫 Meus Vouchers', callback_data: 'view_vouchers' }
            ]);
            keyboard.inline_keyboard.push([
                { text: '🎁 Airdrop', callback_data: 'view_airdrop' }
            ]);
            keyboard.inline_keyboard.push([
                { text: '📊 Dashboard', callback_data: 'dashboard' }
            ]);
        } else {
            // Menu adaptativo baseado no progresso
            
            // Botão principal - próxima tarefa
            if (nextAction && nextAction.callback) {
                keyboard.inline_keyboard.push([
                    { text: `🎯 ${nextAction.message}`, callback_data: nextAction.callback }
                ]);
            }
            
            // Botão Wallet - sempre disponível se criada
            if (wallet) {
                keyboard.inline_keyboard.push([
                    { text: '💳 Wallet', callback_data: 'wallet_menu' }
                ]);
                
                // Enviar/Receber apenas após funding
                if (flowState && ['funded', 'matrix_created', 'matrix_pending', 'voucher_created', 
                    'voucher_pending', 'referral_1_done', 'referral_1_pending', 
                    'referral_2_done', 'referral_2_pending', 'referral_3_pending', 
                    'completed'].includes(flowState)) {
                    keyboard.inline_keyboard.push([
                        { text: '📤 Enviar', callback_data: 'send_tokens' },
                        { text: '📥 Receber', callback_data: 'receive_tokens' }
                    ]);
                }
            }
            
            // Funcionalidades avançadas baseadas no progresso
            if (flowState && ['matrix_created', 'voucher_created', 'voucher_pending', 
                'referral_1_done', 'referral_1_pending', 'referral_2_done', 
                'referral_2_pending', 'referral_3_pending', 'completed'].includes(flowState)) {
                keyboard.inline_keyboard.push([
                    { text: '🎯 Minha Matriz', callback_data: 'view_matrix' }
                ]);
            }
            
            if (flowState && ['voucher_created', 'referral_1_done', 'referral_1_pending', 
                'referral_2_done', 'referral_2_pending', 'referral_3_pending', 
                'completed'].includes(flowState)) {
                keyboard.inline_keyboard.push([
                    { text: '🎫 Meus Vouchers', callback_data: 'view_vouchers' }
                ]);
            }
            
            // Progresso
            keyboard.inline_keyboard.push([
                { text: '📊 Ver Progresso', callback_data: 'show_progress' }
            ]);
        }
        
        // Grupo de ajuda - sempre disponível
        keyboard.inline_keyboard.push([
            { text: '👥 Grupo de Ajuda', url: 'https://t.me/donutmatrix' }
        ]);
        
        return keyboard;
    }
    
    /**
     * Menu de próxima tarefa
     */
    static getNextTaskMenu(nextAction) {
        return {
            inline_keyboard: [
                [
                    { text: `➡️ ${nextAction.message}`, callback_data: nextAction.callback }
                ],
                [
                    { text: '💳 Wallet', callback_data: 'wallet_menu' }
                ],
                [
                    { text: '👥 Ajuda', url: 'https://t.me/donutmatrix' }
                ]
            ]
        };
    }
    
    /**
     * Menu da wallet
     */
    static getWalletMenu(hasWallet) {
        const keyboard = {
            inline_keyboard: []
        };
        
        if (hasWallet) {
            keyboard.inline_keyboard.push([
                { text: '💰 Ver Saldo', callback_data: 'check_balance' }
            ]);
            keyboard.inline_keyboard.push([
                { text: '📤 Enviar', callback_data: 'send_tokens' },
                { text: '📥 Receber', callback_data: 'receive_tokens' }
            ]);
            keyboard.inline_keyboard.push([
                { text: '🔑 Ver Seed Phrase', callback_data: 'show_seed' }
            ]);
            keyboard.inline_keyboard.push([
                { text: '🔒 Trocar PIN', callback_data: 'change_pin' }
            ]);
        } else {
            keyboard.inline_keyboard.push([
                { text: '🆕 Criar Nova Wallet', callback_data: 'create_new_wallet' }
            ]);
            keyboard.inline_keyboard.push([
                { text: '📥 Importar Wallet', callback_data: 'import_wallet_menu' }
            ]);
        }
        
        keyboard.inline_keyboard.push([
            { text: '⬅️ Menu Principal', callback_data: 'main_menu' }
        ]);
        
        return keyboard;
    }
    
    /**
     * Menu de envio
     */
    static getSendMenu() {
        return {
            inline_keyboard: [
                [
                    { text: '💎 Enviar SOL', callback_data: 'send_sol' }
                ],
                [
                    { text: '🍩 Enviar DONUT', callback_data: 'send_donut' }
                ],
                [
                    { text: '⬅️ Voltar', callback_data: 'wallet_menu' }
                ]
            ]
        };
    }
    
    /**
     * Menu de confirmação de envio
     */
    static getSendConfirmationMenu(amount, token, recipient) {
        return {
            inline_keyboard: [
                [
                    { text: `✅ Confirmar Envio`, callback_data: `confirm_send_${token}_${amount}` }
                ],
                [
                    { text: '❌ Cancelar', callback_data: 'cancel_send' }
                ]
            ]
        };
    }
    
    /**
     * Menu de recebimento
     */
    static getReceiveMenu(publicKey) {
        return {
            inline_keyboard: [
                [
                    { text: '📋 Copiar Endereço', callback_data: `copy_address_${publicKey}` }
                ],
                [
                    { text: '📱 Ver QR Code', callback_data: 'show_qr_code' }
                ],
                [
                    { text: '📤 Compartilhar', callback_data: 'share_address' }
                ],
                [
                    { text: '⬅️ Voltar', callback_data: 'wallet_menu' }
                ]
            ]
        };
    }
    
    /**
     * Menu de volta
     */
    static getBackMenu(destination = 'main_menu') {
        return {
            inline_keyboard: [
                [
                    { text: '⬅️ Voltar', callback_data: destination }
                ]
            ]
        };
    }
    
    /**
     * Menu de erro
     */
    static getErrorMenu() {
        return {
            inline_keyboard: [
                [
                    { text: '🔄 Tentar Novamente', callback_data: 'main_menu' }
                ],
                [
                    { text: '👥 Ajuda', url: 'https://t.me/donutmatrix' }
                ]
            ]
        };
    }
}

module.exports = MainKeyboard;