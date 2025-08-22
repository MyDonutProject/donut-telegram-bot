// src/utils/validation.js
const { PublicKey } = require('@solana/web3.js');
const { validateMnemonic } = require('bip39');

/**
 * ✅ IMPLEMENTAÇÃO MANUAL BASE58 (igual ao seu script)
 */
function decodeBase58(s) {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let decoded = BigInt(0);
    let multi = BigInt(1);
    
    // Processar da direita para esquerda
    for (let i = s.length - 1; i >= 0; i--) {
        const char = s[i];
        const index = alphabet.indexOf(char);
        if (index === -1) throw new Error(`Caractere inválido: ${char}`);
        
        decoded += BigInt(index) * multi;
        multi *= BigInt(58);
    }
    
    // Converter para array de bytes
    const bytes = [];
    while (decoded > 0n) {
        bytes.unshift(Number(decoded % 256n));
        decoded = decoded / 256n;
    }
    
    // Adicionar zeros à esquerda para caracteres '1' no início
    for (let i = 0; i < s.length && s[i] === '1'; i++) {
        bytes.unshift(0);
    }
    
    return new Uint8Array(bytes);
}

/**
 * Validadores para o sistema de wallet
 */
const validators = {
    /**
     * Validar ID do Telegram
     */
    isValidTelegramId(telegramId) {
        if (!telegramId) return false;
        const id = telegramId.toString();
        return /^\d+$/.test(id) && id.length >= 5 && id.length <= 15;
    },

    /**
     * Validar endereço Solana
     */
    isValidSolanaAddress(address) {
        if (!address || typeof address !== 'string') {
            return false;
        }

        try {
            new PublicKey(address);
            return true;
        } catch (error) {
            return false;
        }
    },

    /**
     * Validar PIN (4-6 dígitos)
     */
    isValidPin(pin) {
        if (!pin || typeof pin !== 'string') {
            return false;
        }

        const pinRegex = /^[0-9]{4,6}$/;
        return pinRegex.test(pin);
    },

    /**
     * Validar força do PIN
     */
    isStrongPin(pin) {
        if (!this.isValidPin(pin)) {
            return { isStrong: false, reason: 'PIN deve ter 4-6 dígitos numéricos' };
        }

        // Verificar padrões óbvios
        const obviousPatterns = [
            '0000', '00000', '000000',
            '1111', '11111', '111111',
            '2222', '22222', '222222',
            '3333', '33333', '333333',
            '4444', '44444', '444444',
            '5555', '55555', '555555',
            '6666', '66666', '666666',
            '7777', '77777', '777777',
            '8888', '88888', '888888',
            '9999', '99999', '999999',
            '1234', '12345', '123456',
            '4321', '54321', '654321',
            '0123', '01234', '012345',
            '3210', '43210', '543210',
            '1122', '112233',
            '2211', '332211',
            '6969', '696969',
            '1337', '133700'
        ];

        if (obviousPatterns.includes(pin)) {
            return { isStrong: false, reason: 'PIN muito óbvio. Use uma combinação mais segura.' };
        }

        // Verificar se todos dígitos são iguais
        if (new Set(pin).size === 1) {
            return { isStrong: false, reason: 'PIN não pode ter todos os dígitos iguais' };
        }

        // Verificar sequências simples
        if (this.isSequentialPin(pin)) {
            return { isStrong: false, reason: 'Evite sequências simples como 1234 ou 4321' };
        }

        return { isStrong: true, reason: 'PIN forte' };
    },

    /**
     * Verificar se PIN é sequencial
     */
    isSequentialPin(pin) {
        let isAscending = true;
        let isDescending = true;

        for (let i = 1; i < pin.length; i++) {
            const current = parseInt(pin[i]);
            const previous = parseInt(pin[i-1]);

            if (current !== previous + 1) {
                isAscending = false;
            }
            if (current !== previous - 1) {
                isDescending = false;
            }
        }

        return isAscending || isDescending;
    },

    /**
     * Validar seed phrase (12 ou 24 palavras)
     */
    isValidSeedPhrase(seedPhrase) {
        if (!seedPhrase || typeof seedPhrase !== 'string') {
            return false;
        }

        const cleaned = seedPhrase.trim().toLowerCase();
        const words = cleaned.split(/\s+/);
        
        // Verificar quantidade de palavras
        if (words.length !== 12 && words.length !== 24) {
            return false;
        }

        // Verificar se é uma seed phrase válida usando bip39
        try {
            return validateMnemonic(cleaned);
        } catch (error) {
            return false;
        }
    },

    /**
     * ✅ CORRIGIDO: Validar private key usando decodificação manual
     */
    isValidPrivateKey(privateKey) {
        if (!privateKey || typeof privateKey !== 'string') {
            return false;
        }

        try {
            const trimmed = privateKey.trim();
            
            // Log para debug
            console.log(`Validando private key com ${trimmed.length} caracteres`);

            // Tentar decodificar e criar keypair
            const { Keypair } = require('@solana/web3.js');
            
            // 1. ✅ CORRIGIDO: Tentar base58 com decodificação MANUAL
            if (trimmed.length >= 86 && trimmed.length <= 90) {
                try {
                    console.log('🔄 Tentando decodificar Base58 manualmente...');
                    const decoded = decodeBase58(trimmed);
                    console.log(`✅ Base58 decodificado: ${decoded.length} bytes`);
                    
                    if (decoded.length === 64) {
                        const kp = Keypair.fromSecretKey(decoded);
                        console.log(`✅ Private key válida! PublicKey: ${kp.publicKey.toString()}`);
                        return true;
                    }
                } catch (e) {
                    console.log('❌ Erro decodificando Base58:', e.message);
                }
            }

            // 2. Tentar array de bytes [1,2,3,...]
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                try {
                    console.log('🔄 Tentando array JSON...');
                    const array = JSON.parse(trimmed);
                    if (Array.isArray(array) && array.length === 64) {
                        const uint8Array = new Uint8Array(array);
                        Keypair.fromSecretKey(uint8Array);
                        console.log('✅ Array de bytes válido');
                        return true;
                    }
                } catch (e) {
                    console.log('❌ Não é array válido');
                }
            }

            // 3. Tentar base64
            try {
                console.log('🔄 Tentando Base64...');
                const decoded = Buffer.from(trimmed, 'base64');
                if (decoded.length === 64) {
                    Keypair.fromSecretKey(decoded);
                    console.log('✅ Base64 válido');
                    return true;
                }
            } catch (e) {
                console.log('❌ Não é base64');
            }

            // 4. Tentar hex (128 caracteres)
            if (trimmed.length === 128) {
                try {
                    console.log('🔄 Tentando Hex...');
                    const decoded = Buffer.from(trimmed, 'hex');
                    if (decoded.length === 64) {
                        Keypair.fromSecretKey(decoded);
                        console.log('✅ Hex válido');
                        return true;
                    }
                } catch (e) {
                    console.log('❌ Não é hex');
                }
            }

            console.log(`❌ Private key inválida: ${trimmed.length} caracteres`);
            return false;
        } catch (error) {
            console.error('❌ Erro ao validar private key:', error);
            return false;
        }
    },

    /**
     * Validar email
     */
    isValidEmail(email) {
        if (!email || typeof email !== 'string') {
            return false;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email.toLowerCase());
    },

    /**
     * Validar código de voucher
     */
    isValidVoucherCode(code) {
        if (!code || typeof code !== 'string') {
            return false;
        }

        // Apenas letras minúsculas, 3-20 caracteres
        const voucherRegex = /^[a-z]{3,20}$/;
        return voucherRegex.test(code.toLowerCase());
    },

    /**
     * Validar código de verificação (6 dígitos)
     */
    isValidVerificationCode(code) {
        if (!code || typeof code !== 'string') {
            return false;
        }

        const codeRegex = /^[0-9]{6}$/;
        return codeRegex.test(code);
    },

    /**
     * Validar valor SOL
     */
    isValidSolAmount(amount) {
        if (amount === null || amount === undefined) {
            return false;
        }

        const num = parseFloat(amount);
        return !isNaN(num) && num > 0 && num <= 1000000; // Max 1M SOL
    },

    /**
     * Validar nome de wallet
     */
    isValidWalletName(name) {
        if (!name || typeof name !== 'string') {
            return false;
        }

        // 1-30 caracteres, alfanuméricos e espaços
        const nameRegex = /^[a-zA-Z0-9\s]{1,30}$/;
        return nameRegex.test(name.trim());
    },

    /**
     * Sanitizar entrada de texto
     */
    sanitizeText(text) {
        if (!text || typeof text !== 'string') {
            return '';
        }

        return text
            .trim()
            .replace(/[<>]/g, '') // Remove < >
            .substring(0, 500); // Max 500 chars
    },

    /**
     * Validar URL
     */
    isValidURL(url) {
        if (!url || typeof url !== 'string') {
            return false;
        }

        try {
            new URL(url);
            return true;
        } catch (error) {
            return false;
        }
    },

    /**
     * Validar quantidade de token
     */
    isValidTokenAmount(amount, decimals = 9) {
        if (amount === null || amount === undefined) {
            return false;
        }

        const num = parseFloat(amount);
        if (isNaN(num) || num < 0) {
            return false;
        }

        // Verificar se não excede precisão decimal
        const factor = Math.pow(10, decimals);
        return Number.isInteger(num * factor);
    },

    /**
     * Escapar caracteres especiais do Markdown
     */
    escapeMarkdown(text) {
        if (!text || typeof text !== 'string') {
            return '';
        }

        return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
    },

    /**
     * Validar parâmetros obrigatórios
     */
    validateRequired(params, requiredFields) {
        const missing = [];
        
        for (const field of requiredFields) {
            if (params[field] === null || params[field] === undefined || params[field] === '') {
                missing.push(field);
            }
        }
        
        return {
            isValid: missing.length === 0,
            missing: missing
        };
    }
};

// Exportar também funções individuais para compatibilidade
module.exports = {
    validators,
    decodeBase58, // ✅ EXPORTAR função para usar no wallet.service
    // Manter compatibilidade com código existente
    validateTelegramId: validators.isValidTelegramId,
    validateSolanaAddress: validators.isValidSolanaAddress,
    validateEmail: validators.isValidEmail,
    validateVoucherCode: validators.isValidVoucherCode,
    validateSolAmount: validators.isValidSolAmount,
    validatePIN: validators.isValidPin,
    validateWalletName: validators.isValidWalletName,
    sanitizeText: validators.sanitizeText,
    validateSeedPhrase: validators.isValidSeedPhrase,
    validateVerificationCode: validators.isValidVerificationCode,
    validateURL: validators.isValidURL,
    validateTokenAmount: validators.isValidTokenAmount,
    escapeMarkdown: validators.escapeMarkdown,
    validateRequired: validators.validateRequired
};