// src/services/price.service.js
const axios = require('axios');
const Logger = require('../utils/logger');

class PriceService {
    constructor() {
        this.logger = new Logger('PriceService');
        this.cache = new Map();
        this.cacheTimeout = 30000; // 30 segundos cache
        
        // APIs de backup
        this.apis = [
            {
                name: 'CoinGecko',
                url: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
                parser: (data) => data.solana?.usd
            },
            {
                name: 'Binance',
                url: 'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT',
                parser: (data) => parseFloat(data.price)
            },
            {
                name: 'CoinMarketCap',
                url: 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?id=5426',
                headers: process.env.CMC_API_KEY ? { 'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY } : {},
                parser: (data) => data.data?.[5426]?.quote?.USD?.price
            }
        ];
        
        this.defaultPrice = 100; // Fallback se todas as APIs falharem
    }

    /**
     * Obter preço atual do SOL em USD
     * @returns {Promise<number>} - Preço em USD
     */
    async getSOLPrice() {
        try {
            // Verificar cache primeiro
            const cached = this.cache.get('sol_price');
            if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
                this.logger.debug('Usando preço em cache', { price: cached.price });
                return cached.price;
            }

            //  APIs em ordem
            for (const api of this.apis) {
                try {
                    const price = await this.fetchFromAPI(api);
                    if (price && price > 0) {
                        // Cachear resultado
                        this.cache.set('sol_price', {
                            price,
                            timestamp: Date.now(),
                            source: api.name
                        });
                        
                        this.logger.info('Preço SOL atualizado', { 
                            price: `$${price.toFixed(2)}`, 
                            source: api.name 
                        });
                        
                        return price;
                    }
                } catch (error) {
                    this.logger.warn(`API ${api.name} falhou`, { error: error.message });
                    continue;
                }
            }

            // Se todas falharam, usar preço padrão
            this.logger.warn('Todas as APIs falharam, usando preço padrão', { 
                defaultPrice: this.defaultPrice 
            });
            
            return this.defaultPrice;

        } catch (error) {
            this.logger.error('Erro geral ao obter preço SOL', { error: error.message });
            return this.defaultPrice;
        }
    }

    /**
     * Fazer requisição para uma API específica
     * @param {object} api - Configuração da API
     * @returns {Promise<number>} - Preço obtido
     */
    async fetchFromAPI(api) {
        const config = {
            timeout: 5000,
            headers: {
                'User-Agent': 'DonutBot/1.0',
                ...api.headers
            }
        };

        const response = await axios.get(api.url, config);
        const price = api.parser(response.data);
        
        if (!price || isNaN(price) || price <= 0) {
            throw new Error(`Preço inválido da API ${api.name}: ${price}`);
        }
        
        return price;
    }

    /**
     * Converter lamports para valor USD
     * @param {number} lamports - Valor em lamports
     * @returns {Promise<number>} - Valor em USD
     */
    async lamportsToUSD(lamports) {
        try {
            const solAmount = lamports / 1e9; // Converter para SOL
            const solPrice = await this.getSOLPrice();
            return solAmount * solPrice;
        } catch (error) {
            this.logger.error('Erro ao converter lamports para USD', { 
                lamports, 
                error: error.message 
            });
            return 0;
        }
    }

    /**
     * Converter SOL para valor USD
     * @param {number} solAmount - Quantidade de SOL
     * @returns {Promise<number>} - Valor em USD
     */
    async solToUSD(solAmount) {
        try {
            const solPrice = await this.getSOLPrice();
            return solAmount * solPrice;
        } catch (error) {
            this.logger.error('Erro ao converter SOL para USD', { 
                solAmount, 
                error: error.message 
            });
            return 0;
        }
    }

    /**
     * Converter USD para SOL
     * @param {number} usdAmount - Valor em USD
     * @returns {Promise<number>} - Quantidade de SOL necessária
     */
    async usdToSOL(usdAmount) {
        try {
            const solPrice = await this.getSOLPrice();
            return usdAmount / solPrice;
        } catch (error) {
            this.logger.error('Erro ao converter USD para SOL', { 
                usdAmount, 
                error: error.message 
            });
            return 0;
        }
    }

    /**
     * Verificar se valor em lamports atinge USD mínimo
     * @param {number} lamports - Valor em lamports
     * @param {number} minimumUSD - Valor mínimo em USD (padrão: 15)
     * @returns {Promise<object>} - Resultado da verificação
     */
    async checkMinimumUSD(lamports, minimumUSD = 15) {
        try {
            const solAmount = lamports / 1e9;
            const usdValue = await this.lamportsToUSD(lamports);
            const solPrice = await this.getSOLPrice();
            
            return {
                lamports,
                solAmount,
                usdValue,
                solPrice,
                minimumUSD,
                isAboveMinimum: usdValue >= minimumUSD,
                difference: usdValue - minimumUSD,
                percentageOfMinimum: (usdValue / minimumUSD) * 100
            };
        } catch (error) {
            this.logger.error('Erro ao verificar USD mínimo', { 
                lamports, 
                minimumUSD, 
                error: error.message 
            });
            
            return {
                lamports,
                solAmount: lamports / 1e9,
                usdValue: 0,
                solPrice: this.defaultPrice,
                minimumUSD,
                isAboveMinimum: false,
                difference: -minimumUSD,
                percentageOfMinimum: 0,
                error: error.message
            };
        }
    }

    /**
     * Obter estatísticas do cache
     * @returns {object} - Informações do cache
     */
    getCacheStats() {
        const cached = this.cache.get('sol_price');
        
        return {
            hasCachedPrice: !!cached,
            cachedPrice: cached?.price,
            cacheAge: cached ? Date.now() - cached.timestamp : null,
            cacheSource: cached?.source,
            isExpired: cached ? Date.now() - cached.timestamp > this.cacheTimeout : true
        };
    }

    /**
     * Limpar cache manualmente
     */
    clearCache() {
        this.cache.clear();
        this.logger.info('Cache de preços limpo');
    }

    /**
     * Definir preço personalizado (para testes)
     * @param {number} price - Preço personalizado
     * @param {number} duration - Duração do cache em ms (padrão: 5 minutos)
     */
    setCustomPrice(price, duration = 300000) {
        this.cache.set('sol_price', {
            price,
            timestamp: Date.now(),
            source: 'custom'
        });
        
        this.logger.info('Preço customizado definido', { price, duration });
        
        // Auto-limpar após duração especificada
        setTimeout(() => {
            this.cache.delete('sol_price');
            this.logger.info('Preço customizado expirou');
        }, duration);
    }

    /**
     * Verificar saúde das APIs
     * @returns {Promise<object>} - Status de cada API
     */
    async checkAPIHealth() {
        const results = {};
        
        for (const api of this.apis) {
            try {
                const startTime = Date.now();
                await this.fetchFromAPI(api);
                const responseTime = Date.now() - startTime;
                
                results[api.name] = {
                    status: 'healthy',
                    responseTime: `${responseTime}ms`
                };
            } catch (error) {
                results[api.name] = {
                    status: 'error',
                    error: error.message
                };
            }
        }
        
        return results;
    }
}

module.exports = PriceService;