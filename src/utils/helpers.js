// src/utils/helpers.js

/**
 * Função de sleep
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Gerar ID único
 */
function generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Gerar código aleatório
 */
function generateRandomCode(length = 6) {
    const chars = '0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Converter timestamp para segundos
 */
function toSeconds(timestamp) {
    return Math.floor(timestamp / 1000);
}

/**
 * Converter segundos para timestamp
 */
function fromSeconds(seconds) {
    return seconds * 1000;
}

/**
 * Debounce função
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle função
 */
function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Retry função com backoff exponencial
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === maxRetries - 1) {
                throw error; // Último retry, relançar erro
            }
            
            const delay = baseDelay * Math.pow(2, i); // Backoff exponencial
            await sleep(delay);
        }
    }
}

/**
 * Chunk array em pedaços menores
 */
function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

/**
 * Remover itens duplicados de array
 */
function removeDuplicates(array, key = null) {
    if (!key) {
        return [...new Set(array)];
    }
    
    const seen = new Set();
    return array.filter(item => {
        const keyValue = item[key];
        if (seen.has(keyValue)) {
            return false;
        }
        seen.add(keyValue);
        return true;
    });
}

/**
 * Verificar se objeto está vazio
 */
function isEmpty(obj) {
    if (obj === null || obj === undefined) {
        return true;
    }
    
    if (Array.isArray(obj)) {
        return obj.length === 0;
    }
    
    if (typeof obj === 'object') {
        return Object.keys(obj).length === 0;
    }
    
    return !obj;
}

/**
 * Deep clone de objeto
 */
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    
    if (obj instanceof Date) {
        return new Date(obj.getTime());
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => deepClone(item));
    }
    
    const cloned = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            cloned[key] = deepClone(obj[key]);
        }
    }
    
    return cloned;
}

/**
 * Formatar erro para log
 */
function formatError(error) {
    return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...(error.code && { code: error.code }),
        ...(error.statusCode && { statusCode: error.statusCode })
    };
}

/**
 * Verificar se string é JSON válido
 */
function isValidJSON(str) {
    try {
        JSON.parse(str);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Calcular hash simples de string
 */
function simpleHash(str) {
    let hash = 0;
    if (str.length === 0) return hash;
    
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Converter para 32bit integer
    }
    
    return Math.abs(hash);
}

/**
 * Gerar slug de texto
 */
function generateSlug(text) {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '') // Remove caracteres especiais
        .replace(/[\s_-]+/g, '-') // Substitui espaços por hífens
        .replace(/^-+|-+$/g, ''); // Remove hífens do início/fim
}

/**
 * Converter bytes para formato legível
 */
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Truncar string no meio
 */
function truncateMiddle(str, startLen = 6, endLen = 6, separator = '...') {
    if (!str || str.length <= startLen + endLen + separator.length) {
        return str;
    }
    
    return str.substring(0, startLen) + separator + str.substring(str.length - endLen);
}

/**
 * Gerar código alfanumérico
 */
function generateAlphanumericCode(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Verificar se é desenvolvimento
 */
function isDevelopment() {
    return process.env.NODE_ENV === 'development';
}

/**
 * Verificar se é produção
 */
function isProduction() {
    return process.env.NODE_ENV === 'production';
}

/**
 * Obter timestamp atual
 */
function now() {
    return Date.now();
}

/**
 * Formatar duração em milissegundos para texto legível
 */
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

/**
 * Aguardar condição ser verdadeira
 */
async function waitFor(condition, timeout = 30000, interval = 1000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
        if (await condition()) {
            return true;
        }
        await sleep(interval);
    }
    
    throw new Error('Timeout waiting for condition');
}

/**
 * Executar função com timeout
 */
async function withTimeout(promise, timeoutMs) {
    const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Operation timed out')), timeoutMs);
    });
    
    return Promise.race([promise, timeout]);
}

module.exports = {
    sleep,
    generateUniqueId,
    generateRandomCode,
    toSeconds,
    fromSeconds,
    debounce,
    throttle,
    retryWithBackoff,
    chunkArray,
    removeDuplicates,
    isEmpty,
    deepClone,
    formatError,
    isValidJSON,
    simpleHash,
    generateSlug,
    formatBytes,
    truncateMiddle,
    generateAlphanumericCode,
    isDevelopment,
    isProduction,
    now,
    formatDuration,
    waitFor,
    withTimeout
};