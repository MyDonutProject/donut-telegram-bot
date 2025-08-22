// src/utils/encryption.js
const CryptoJS = require('crypto-js');
const bcrypt = require('bcrypt');

class EncryptionManager {
    constructor() {
        this.saltRounds = 12; // Para bcrypt hash do PIN
    }

    /**
     * Criptografar dados sensíveis usando o PIN do usuário
     * @param {string} data - Dados para criptografar (seed, private key)
     * @param {string} pin - PIN do usuário (4-6 dígitos)
     * @returns {string} - Dados criptografados
     */
    encryptWithPIN(data, pin) {
        try {
            // Garantir que data é string
            if (!data || typeof data !== 'string') {
                throw new Error('Dados inválidos para criptografia');
            }

            // Garantir que PIN é string
            if (!pin || typeof pin !== 'string') {
                throw new Error('PIN inválido para criptografia');
            }

            // Gerar salt aleatório
            const salt = CryptoJS.lib.WordArray.random(256/8);
            
            // Derivar chave do PIN com PBKDF2
            const key = CryptoJS.PBKDF2(pin.toString(), salt, {
                keySize: 256/32,
                iterations: 10000
            });

            // Gerar IV aleatório
            const iv = CryptoJS.lib.WordArray.random(128/8);

            // Converter dados para WordArray corretamente
            const dataWordArray = CryptoJS.enc.Utf8.parse(data);

            // Criptografar os dados
            const encrypted = CryptoJS.AES.encrypt(dataWordArray, key, {
                iv: iv,
                mode: CryptoJS.mode.CBC,
                padding: CryptoJS.pad.Pkcs7
            });

            // Combinar salt + iv + dados criptografados em um único objeto
            const result = {
                salt: salt.toString(CryptoJS.enc.Hex),
                iv: iv.toString(CryptoJS.enc.Hex),
                encrypted: encrypted.ciphertext.toString(CryptoJS.enc.Hex)
            };

            return JSON.stringify(result);

        } catch (error) {
            console.error('❌ Erro na criptografia:', error);
            throw new Error('Falha na criptografia dos dados: ' + error.message);
        }
    }

    /**
     * Descriptografar dados usando o PIN do usuário
     * @param {string} encryptedData - Dados criptografados
     * @param {string} pin - PIN do usuário
     * @returns {string} - Dados descriptografados
     */
    decryptWithPIN(encryptedData, pin) {
        try {
            // Parse do JSON
            const data = JSON.parse(encryptedData);
            
            // Recriar salt, key e IV
            const salt = CryptoJS.enc.Hex.parse(data.salt);
            const key = CryptoJS.PBKDF2(pin.toString(), salt, {
                keySize: 256/32,
                iterations: 10000
            });
            const iv = CryptoJS.enc.Hex.parse(data.iv);

            // Recriar ciphertext
            const ciphertext = CryptoJS.enc.Hex.parse(data.encrypted);

            // Criar CipherParams
            const cipherParams = CryptoJS.lib.CipherParams.create({
                ciphertext: ciphertext,
                key: key,
                iv: iv,
                algorithm: CryptoJS.algo.AES,
                mode: CryptoJS.mode.CBC,
                padding: CryptoJS.pad.Pkcs7
            });

            // Descriptografar
            const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
                iv: iv,
                mode: CryptoJS.mode.CBC,
                padding: CryptoJS.pad.Pkcs7
            });

            // Converter resultado para string
            const decryptedStr = decrypted.toString(CryptoJS.enc.Utf8);
            
            if (!decryptedStr) {
                throw new Error('Falha na descriptografia - resultado vazio');
            }

            return decryptedStr;

        } catch (error) {
            console.error('❌ Erro na descriptografia:', error);
            throw new Error('PIN incorreto ou dados corrompidos');
        }
    }

    /**
     * Criar hash do PIN para armazenar no banco
     * @param {string} pin - PIN em texto plano
     * @returns {Promise<string>} - Hash do PIN
     */
    async hashPIN(pin) {
        try {
            return await bcrypt.hash(pin.toString(), this.saltRounds);
        } catch (error) {
            console.error('❌ Erro ao criar hash do PIN:', error);
            throw new Error('Falha na criação do hash do PIN');
        }
    }

    /**
     * Verificar se o PIN está correto
     * @param {string} pin - PIN em texto plano
     * @param {string} hash - Hash armazenado
     * @returns {Promise<boolean>} - True se o PIN está correto
     */
    async verifyPIN(pin, hash) {
        try {
            if (!pin || !hash) return false;
            return await bcrypt.compare(pin.toString(), hash);
        } catch (error) {
            console.error('❌ Erro ao verificar PIN:', error);
            return false;
        }
    }

    /**
     * Validar formato do PIN
     * @param {string} pin - PIN para validar
     * @returns {boolean} - True se é válido
     */
    validatePIN(pin) {
        // PIN deve ter entre 4 e 6 dígitos numéricos
        const pinRegex = /^[0-9]{4,6}$/;
        return pinRegex.test(pin);
    }

    /**
     * Gerar PIN aleatório para demonstração (nunca usar em produção)
     * @returns {string} - PIN de 6 dígitos
     */
    generateRandomPIN() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    /**
     * Validar strength do PIN (evitar PINs óbvios)
     * @param {string} pin - PIN para validar
     * @returns {object} - { isStrong: boolean, reason: string }
     */
    validatePINStrength(pin) {
        if (!this.validatePIN(pin)) {
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
            '1337', '133700',
            '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
            '1234', '4321', '0123', '3210', '1122', '2211', '6969', '1337'
        ];

        if (obviousPatterns.some(pattern => pin.includes(pattern))) {
            return { isStrong: false, reason: 'PIN muito óbvio. Use uma combinação mais segura.' };
        }

        // Verificar se todos dígitos são iguais
        if (new Set(pin).size === 1) {
            return { isStrong: false, reason: 'PIN não pode ter todos os dígitos iguais' };
        }

        // Verificar sequências simples
        if (this.isSequentialPIN(pin)) {
            return { isStrong: false, reason: 'Evite sequências simples como 1234 ou 4321' };
        }

        return { isStrong: true, reason: 'PIN forte' };
    }

    /**
     * Verificar se PIN é uma sequência simples
     * @param {string} pin - PIN para verificar
     * @returns {boolean} - True se é sequencial
     */
    isSequentialPIN(pin) {
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
    }

    /**
     * Criptografar múltiplos dados de uma vez
     * @param {object} dataObject - Objeto com dados para criptografar
     * @param {string} pin - PIN do usuário
     * @returns {object} - Objeto com dados criptografados
     */
    encryptMultiple(dataObject, pin) {
        const encrypted = {};
        
        for (const [key, value] of Object.entries(dataObject)) {
            if (value && typeof value === 'string') {
                encrypted[key] = this.encryptWithPIN(value, pin);
            }
        }
        
        return encrypted;
    }

    /**
     * Descriptografar múltiplos dados de uma vez
     * @param {object} encryptedObject - Objeto com dados criptografados
     * @param {string} pin - PIN do usuário
     * @returns {object} - Objeto com dados descriptografados
     */
    decryptMultiple(encryptedObject, pin) {
        const decrypted = {};
        
        for (const [key, value] of Object.entries(encryptedObject)) {
            if (value && typeof value === 'string') {
                try {
                    decrypted[key] = this.decryptWithPIN(value, pin);
                } catch (error) {
                    console.error(`❌ Erro ao descriptografar ${key}:`, error.message);
                    throw error;
                }
            }
        }
        
        return decrypted;
    }

    /**
     * Testar se a criptografia está funcionando
     */
    testEncryption() {
        try {
            const testData = "test_data_123";
            const testPin = "1234";
            
            const encrypted = this.encryptWithPIN(testData, testPin);
            const decrypted = this.decryptWithPIN(encrypted, testPin);
            
            if (decrypted === testData) {
                console.log('✅ Sistema de criptografia funcionando corretamente');
                return true;
            } else {
                console.error('❌ Falha no teste de criptografia');
                return false;
            }
        } catch (error) {
            console.error('❌ Erro no teste de criptografia:', error);
            return false;
        }
    }
}

// Instância singleton
const encryptionManager = new EncryptionManager();

module.exports = encryptionManager;