// src/keyboards/wallet.keyboard.js
class WalletKeyboard {
    /**
     * Menu de criação de wallet
     */
    static getCreationMenu() {
        return {
            inline_keyboard: [
                [
                    { text: '🆕 Criar Nova Wallet', callback_data: 'create_new_wallet' }
                ],
                [
                    { text: '📥 Importar Wallet', callback_data: 'import_wallet' }
                ],
                [
                    { text: 'ℹ️ O que é uma Wallet?', callback_data: 'wallet_info' }
                ],
                [
                    { text: '⬅️ Voltar', callback_data: 'main_menu' }
                ]
            ]
        };
    }

    /**
     * Menu principal da wallet
     */
    static getWalletMenu() {
        return {
            inline_keyboard: [
                [
                    { text: '💰 Ver Saldo', callback_data: 'view_balance' },
                    { text: '📤 Enviar', callback_data: 'send_tokens' }
                ],
                [
                    { text: '📥 Receber', callback_data: 'receive_tokens' },
                    { text: '🔄 Atualizar', callback_data: 'refresh_wallet' }
                ],
                [
                    { text: '🔑 Ver Seed Phrase', callback_data: 'show_seed' }
                ],
                [
                    { text: '🛡️ Alterar PIN', callback_data: 'change_pin' },
                    { text: '⚙️ Configurações', callback_data: 'wallet_settings' }
                ],
                [
                    { text: '⬅️ Menu Principal', callback_data: 'main_menu' }
                ]
            ]
        };
    }

    /**
     * Menu de confirmação para ações sensíveis
     */
    static getConfirmationMenu(action) {
        return {
            inline_keyboard: [
                [
                    { text: '✅ Sim, Confirmar', callback_data: `confirm_${action}` },
                    { text: '❌ Cancelar', callback_data: 'cancel_action' }
                ]
            ]
        };
    }

    /**
     * Menu para tipo de importação
     */
    static getImportTypeMenu() {
        return {
            inline_keyboard: [
                [
                    { text: '📝 Seed Phrase (12/24 palavras)', callback_data: 'import_seed' }
                ],
                [
                    { text: '🔑 Private Key', callback_data: 'import_private_key' }
                ],
                [
                    { text: '⬅️ Voltar', callback_data: 'manage_wallet' }
                ]
            ]
        };
    }

    /**
     * Menu de configurações da wallet
     */
    static getSettingsMenu() {
        return {
            inline_keyboard: [
                [
                    { text: '✏️ Alterar Nome', callback_data: 'change_wallet_name' }
                ],
                [
                    { text: '🔒 Alterar PIN', callback_data: 'change_pin' }
                ],
                [
                    { text: '📋 Exportar Dados', callback_data: 'export_wallet' }
                ],
                [
                    { text: '❌ Desativar Wallet', callback_data: 'deactivate_wallet' }
                ],
                [
                    { text: '⬅️ Voltar', callback_data: 'manage_wallet' }
                ]
            ]
        };
    }

    /**
     * Menu de saldo/balanço
     */
    static getBalanceMenu(publicKey) {
        return {
            inline_keyboard: [
                [
                    { text: '🔄 Atualizar Saldo', callback_data: 'refresh_balance' }
                ],
                [
                    { text: '📋 Copiar Endereço', callback_data: `copy_address_${publicKey}` }
                ],
                [
                    { text: '📤 Enviar Tokens', callback_data: 'send_tokens' },
                    { text: '📥 Receber Tokens', callback_data: 'receive_tokens' }
                ],
                [
                    { text: '📊 Histórico', callback_data: 'transaction_history' }
                ],
                [
                    { text: '⬅️ Voltar', callback_data: 'manage_wallet' }
                ]
            ]
        };
    }

    /**
     * Menu para mostrar seed phrase
     */
    static getSeedPhraseMenu() {
        return {
            inline_keyboard: [
                [
                    { text: '📋 Copiar Seed Phrase', callback_data: 'copy_seed_phrase' }
                ],
                [
                    { text: '⚠️ Ocultar Seed', callback_data: 'hide_seed_phrase' }
                ],
                [
                    { text: '🛡️ Dicas de Segurança', callback_data: 'seed_security_tips' }
                ],
                [
                    { text: '⬅️ Voltar', callback_data: 'manage_wallet' }
                ]
            ]
        };
    }

    /**
     * Menu de confirmação para exportar wallet
     */
    static getExportConfirmationMenu() {
        return {
            inline_keyboard: [
                [
                    { text: '📝 Exportar como Seed', callback_data: 'export_as_seed' }
                ],
                [
                    { text: '🔑 Exportar Private Key', callback_data: 'export_private_key' }
                ],
                [
                    { text: '📄 Exportar Dados JSON', callback_data: 'export_json_data' }
                ],
                [
                    { text: '❌ Cancelar', callback_data: 'wallet_settings' }
                ]
            ]
        };
    }

    /**
     * Menu para alterar PIN
     */
    static getChangePinMenu() {
        return {
            inline_keyboard: [
                [
                    { text: '🔄 Prosseguir com Alteração', callback_data: 'proceed_change_pin' }
                ],
                [
                    { text: '❌ Cancelar', callback_data: 'wallet_settings' }
                ]
            ]
        };
    }

    /**
     * Menu para receber tokens
     */
    static getReceiveMenu(publicKey) {
        return {
            inline_keyboard: [
                [
                    { text: '📋 Copiar Endereço', callback_data: `copy_address_${publicKey}` }
                ],
                [
                    { text: '📱 Mostrar QR Code', callback_data: 'show_qr_code' }
                ],
                [
                    { text: '📤 Compartilhar', callback_data: 'share_address' }
                ],
                [
                    { text: '⬅️ Voltar', callback_data: 'manage_wallet' }
                ]
            ]
        };
    }

    /**
     * Menu para envio de tokens
     */
    static getSendMenu() {
        return {
            inline_keyboard: [
                [
                    { text: '🔄 Enviar SOL', callback_data: 'send_sol' }
                ],
                [
                    { text: '🍩 Enviar DONUT', callback_data: 'send_donut' }
                ],
                [
                    { text: '📋 Colar do Clipboard', callback_data: 'paste_recipient' }
                ],
                [
                    { text: '❌ Cancelar', callback_data: 'manage_wallet' }
                ]
            ]
        };
    }

    /**
     * Menu de confirmação para envio
     */
    static getSendConfirmationMenu(amount, token, recipient) {
        return {
            inline_keyboard: [
                [
                    { text: '✅ Confirmar Envio', callback_data: `confirm_send_${token}_${amount}` }
                ],
                [
                    { text: '✏️ Alterar Valor', callback_data: 'change_send_amount' }
                ],
                [
                    { text: '📝 Alterar Destinatário', callback_data: 'change_recipient' }
                ],
                [
                    { text: '❌ Cancelar Envio', callback_data: 'cancel_send' }
                ]
            ]
        };
    }

    /**
     * Menu de histórico de transações
     */
    static getHistoryMenu() {
        return {
            inline_keyboard: [
                [
                    { text: '📄 Últimas 10', callback_data: 'history_last_10' },
                    { text: '📊 Últimas 50', callback_data: 'history_last_50' }
                ],
                [
                    { text: '🔍 Buscar por Hash', callback_data: 'search_tx_hash' }
                ],
                [
                    { text: '📈 Relatório Completo', callback_data: 'full_report' }
                ],
                [
                    { text: '⬅️ Voltar', callback_data: 'view_balance' }
                ]
            ]
        };
    }

    /**
     * Menu de informações sobre wallet
     */
    static getWalletInfoMenu() {
        return {
            inline_keyboard: [
                [
                    { text: '🔐 O que é Seed Phrase?', callback_data: 'seed_info' }
                ],
                [
                    { text: '🔑 O que é Private Key?', callback_data: 'private_key_info' }
                ],
                [
                    { text: '🛡️ Dicas de Segurança', callback_data: 'security_tips' }
                ],
                [
                    { text: '💰 Como Depositar SOL?', callback_data: 'deposit_guide' }
                ],
                [
                    { text: '⬅️ Voltar', callback_data: 'create_wallet_menu' }
                ]
            ]
        };
    }

    /**
     * Menu de dicas de segurança
     */
    static getSecurityTipsMenu() {
        return {
            inline_keyboard: [
                [
                    { text: '🔐 Guardar Seed Phrase', callback_data: 'seed_storage_tips' }
                ],
                [
                    { text: '🚫 O que NÃO fazer', callback_data: 'security_dont' }
                ],
                [
                    { text: '✅ Boas Práticas', callback_data: 'security_best_practices' }
                ],
                [
                    { text: '⬅️ Voltar', callback_data: 'wallet_info' }
                ]
            ]
        };
    }

    /**
     * Menu de volta simples
     */
    static getBackMenu(callbackData = 'manage_wallet') {
        return {
            inline_keyboard: [
                [
                    { text: '⬅️ Voltar', callback_data: callbackData }
                ]
            ]
        };
    }

    /**
     * Menu para envio de tokens
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
                    { text: '❌ Cancelar', callback_data: 'manage_wallet' }
                ]
            ]
        };
    }

    /**
     * Menu de ações rápidas
     */
    static getQuickActionsMenu() {
        return {
            inline_keyboard: [
                [
                    { text: '💰 Saldo Rápido', callback_data: 'quick_balance' }
                ],
                [
                    { text: '📤 Envio Rápido', callback_data: 'quick_send' }
                ],
                [
                    { text: '📥 Receber', callback_data: 'receive_tokens' }
                ],
                [
                    { text: '⬅️ Menu Completo', callback_data: 'manage_wallet' }
                ]
            ]
        };
    }
}

module.exports = WalletKeyboard;