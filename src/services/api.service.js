// src/services/api.service.js
const axios = require('axios');
const logger = require('../utils/logger');

class ApiService {
    constructor() {
        this.baseURL = process.env.BACKEND_API_URL;
        this.apiKey = process.env.BACKEND_API_KEY;
        
        // Configurar cliente axios
        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
            }
        });

        // Interceptor para logging
        this.client.interceptors.request.use(
            (config) => {
                logger.info('API Request', { 
                    method: config.method, 
                    url: config.url,
                    data: config.data ? 'present' : 'none'
                });
                return config;
            },
            (error) => {
                logger.error('API Request Error', { error: error.message });
                return Promise.reject(error);
            }
        );

        this.client.interceptors.response.use(
            (response) => {
                logger.info('API Response', { 
                    status: response.status,
                    url: response.config.url 
                });
                return response;
            },
            (error) => {
                logger.error('API Response Error', { 
                    status: error.response?.status,
                    url: error.config?.url,
                    error: error.message 
                });
                return Promise.reject(error);
            }
        );
    }

    /**
     * Buscar histórico de matrizes por endereço
     * @param {string} address - PublicKey da wallet
     * @param {number} page - Página (opcional)
     * @param {number} limit - Limite por página (opcional)
     * @returns {Promise<Array>} - Lista de matrizes
     */
    async getMatrixByAddress(address, page = 1, limit = 20) {
        try {
            const response = await this.client.get('/matrices', {
                params: { address, page, limit }
            });

            return response.data;

        } catch (error) {
            logger.error('Error fetching matrices', { address, error: error.message });
            
            if (error.response?.status === 404) {
                return []; // Nenhuma matriz encontrada
            }
            
            throw new Error(`Erro ao buscar matrizes: ${error.message}`);
        }
    }

    /**
     * Buscar voucher por código
     * @param {string} code - Código do voucher
     * @returns {Promise<object|null>} - Dados do voucher ou null
     */
    async getVoucherByCode(code) {
        try {
            const response = await this.client.get('/wallet-vouchers', {
                params: { code }
            });

            return response.data;

        } catch (error) {
            logger.error('Error fetching voucher', { code, error: error.message });
            
            if (error.response?.status === 404) {
                return null; // Voucher não encontrado
            }
            
            throw new Error(`Erro ao buscar voucher: ${error.message}`);
        }
    }

    /**
     * Criar novo voucher
     * @param {object} voucherData - Dados do voucher
     * @returns {Promise<object>} - Voucher criado
     */
    async createVoucher(voucherData) {
        try {
            const response = await this.client.post('/wallet-vouchers', voucherData);
            return response.data;

        } catch (error) {
            logger.error('Error creating voucher', { voucherData, error: error.message });
            
            if (error.response?.status === 409) {
                throw new Error('Código de voucher já existe');
            }
            
            throw new Error(`Erro ao criar voucher: ${error.message}`);
        }
    }

    /**
     * Enviar email de verificação
     * @param {string} email - Email para verificar
     * @returns {Promise<object>} - Resultado do envio
     */
    async sendVerificationEmail(email) {
        try {
            const response = await this.client.post('/emails', { email });
            return response.data;

        } catch (error) {
            logger.error('Error sending verification email', { email, error: error.message });
            throw new Error(`Erro ao enviar email: ${error.message}`);
        }
    }

    /**
     * Verificar código de email
     * @param {string} email - Email
     * @param {string} code - Código de verificação
     * @returns {Promise<object>} - Resultado da verificação
     */
    async verifyEmailCode(email, code) {
        try {
            const response = await this.client.post('/emails/verify', { email, code });
            return response.data;

        } catch (error) {
            logger.error('Error verifying email code', { email, error: error.message });
            
            if (error.response?.status === 400) {
                throw new Error('Código de verificação inválido');
            }
            
            throw new Error(`Erro ao verificar email: ${error.message}`);
        }
    }

    /**
     * Buscar vouchers de um usuário
     * @param {string} telegramId - ID do usuário no Telegram
     * @returns {Promise<Array>} - Lista de vouchers do usuário
     */
    async getUserVouchers(telegramId) {
        try {
            // Esta implementação depende de como o backend identifica vouchers por usuário
            // Pode ser necessário ajustar baseado na API real
            const response = await this.client.get('/wallet-vouchers/user', {
                params: { telegramId }
            });

            return response.data;

        } catch (error) {
            logger.error('Error fetching user vouchers', { telegramId, error: error.message });
            
            if (error.response?.status === 404) {
                return []; // Nenhum voucher encontrado
            }
            
            throw new Error(`Erro ao buscar vouchers: ${error.message}`);
        }
    }

    /**
     * Buscar wallet pelo voucher (para obter referrer)
     * @param {string} voucherCode - Código do voucher
     * @returns {Promise<string|null>} - Address da wallet do dono do voucher
     */
    async getReferrerWalletByVoucher(voucherCode) {
        try {
            const voucher = await this.getVoucherByCode(voucherCode);
            
            if (!voucher) {
                return null;
            }

            // Retornar wallet address do dono do voucher
            return voucher.wallet_address || null;

        } catch (error) {
            logger.error('Error getting referrer wallet', { voucherCode, error: error.message });
            return null;
        }
    }

    /**
     * Obter voucher padrão
     * @returns {Promise<string|null>} - Wallet do voucher padrão
     */
    async getDefaultReferrer() {
        const defaultVoucher = process.env.DEFAULT_VOUCHER || 'newbitcoin';
        return await this.getReferrerWalletByVoucher(defaultVoucher);
    }

    /**
     * Buscar dados gerais de lookup
     * @param {string} type - Tipo de lookup
     * @returns {Promise<object>} - Dados do lookup
     */
    async getLookupData(type) {
        try {
            const response = await this.client.get('/look-up', {
                params: { type }
            });

            return response.data;

        } catch (error) {
            logger.error('Error fetching lookup data', { type, error: error.message });
            throw new Error(`Erro ao buscar dados: ${error.message}`);
        }
    }

    /**
     * Testar conectividade com a API
     * @returns {Promise<boolean>} - True se API está funcionando
     */
    async isHealthy() {
        try {
            await this.client.get('/health');
            return true;

        } catch (error) {
            logger.error('API health check failed', { error: error.message });
            return false;
        }
    }

    /**
     * Obter estatísticas do sistema via API
     * @returns {Promise<object>} - Estatísticas
     */
    async getSystemStats() {
        try {
            const response = await this.client.get('/stats');
            return response.data;

        } catch (error) {
            logger.error('Error fetching system stats', { error: error.message });
            throw new Error(`Erro ao obter estatísticas: ${error.message}`);
        }
    }

    /**
     * Buscar transações de uma wallet
     * @param {string} address - Address da wallet
     * @param {number} limit - Limite de transações
     * @returns {Promise<Array>} - Lista de transações
     */
    async getWalletTransactions(address, limit = 50) {
        try {
            const response = await this.client.get('/transactions', {
                params: { address, limit }
            });

            return response.data;

        } catch (error) {
            logger.error('Error fetching wallet transactions', { address, error: error.message });
            
            if (error.response?.status === 404) {
                return [];
            }
            
            throw new Error(`Erro ao buscar transações: ${error.message}`);
        }
    }

    /**
     * Método genérico para requisições GET
     * @param {string} endpoint - Endpoint da API
     * @param {object} params - Parâmetros da query
     * @returns {Promise<object>} - Resposta da API
     */
    async get(endpoint, params = {}) {
        try {
            const response = await this.client.get(endpoint, { params });
            return response.data;

        } catch (error) {
            logger.error('Generic GET error', { endpoint, params, error: error.message });
            throw new Error(`Erro na requisição: ${error.message}`);
        }
    }

    /**
     * Método genérico para requisições POST
     * @param {string} endpoint - Endpoint da API
     * @param {object} data - Dados para enviar
     * @returns {Promise<object>} - Resposta da API
     */
    async post(endpoint, data = {}) {
        try {
            const response = await this.client.post(endpoint, data);
            return response.data;

        } catch (error) {
            logger.error('Generic POST error', { endpoint, data, error: error.message });
            throw new Error(`Erro na requisição: ${error.message}`);
        }
    }

    /**
     * Método genérico para requisições PUT
     * @param {string} endpoint - Endpoint da API
     * @param {object} data - Dados para atualizar
     * @returns {Promise<object>} - Resposta da API
     */
    async put(endpoint, data = {}) {
        try {
            const response = await this.client.put(endpoint, data);
            return response.data;

        } catch (error) {
            logger.error('Generic PUT error', { endpoint, data, error: error.message });
            throw new Error(`Erro na requisição: ${error.message}`);
        }
    }

    /**
     * Requisições DELETE
     * @param {string} endpoint - Endpoint da API
     * @returns {Promise<object>} - Resposta da API
     */
    async delete(endpoint) {
        try {
            const response = await this.client.delete(endpoint);
            return response.data;

        } catch (error) {
            logger.error('Generic DELETE error', { endpoint, error: error.message });
            throw new Error(`Erro na requisição: ${error.message}`);
        }
    }
}

module.exports = ApiService;