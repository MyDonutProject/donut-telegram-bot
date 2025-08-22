// src/utils/formatting.js

/**
 * Formatadores para exibição de dados
 */
const formatters = {
    /**
     * Formatar SOL (lamports para SOL)
     */
    formatSOL(lamports) {
        if (typeof lamports === 'number') {
            const sol = lamports / 1e9;
            return `${sol.toFixed(4)} SOL`;
        }
        // Se já for SOL
        const sol = parseFloat(lamports) || 0;
        return `${sol.toFixed(4)} SOL`;
    },

    /**
     * Formatar token genérico
     */
    formatToken(amount, symbol = 'DONUT', decimals = 9) {
        if (!amount) return `0 ${symbol}`;
        
        const value = parseFloat(amount) || 0;
        if (decimals > 0) {
            return `${value.toFixed(2)} ${symbol}`;
        }
        return `${value} ${symbol}`;
    },

    /**
     * Formatar endereço (mostrar início e fim)
     */
    formatAddress(address, start = 4, end = 4) {
        if (!address || address.length < start + end) {
            return address;
        }
        return `${address.substring(0, start)}...${address.substring(address.length - end)}`;
    },

    /**
     * Formatar valor em USD
     */
    formatUSD(value) {
        const num = parseFloat(value) || 0;
        return `$${num.toFixed(2)}`;
    },

    /**
     * Formatar data/hora
     */
    formatDateTime(date) {
        if (!date) return '';
        
        const d = new Date(date);
        return d.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    /**
     * Formatar data
     */
    formatDate(date) {
        if (!date) return '';
        
        const d = new Date(date);
        return d.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    },

    /**
     * Formatar tempo relativo
     */
    formatRelativeTime(date) {
        if (!date) return '';
        
        const now = new Date();
        const past = new Date(date);
        const diffMs = now - past;
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffDays > 0) {
            return `${diffDays} dia${diffDays > 1 ? 's' : ''} atrás`;
        } else if (diffHours > 0) {
            return `${diffHours} hora${diffHours > 1 ? 's' : ''} atrás`;
        } else if (diffMins > 0) {
            return `${diffMins} minuto${diffMins > 1 ? 's' : ''} atrás`;
        } else {
            return 'agora mesmo';
        }
    },

    /**
     * Formatar porcentagem
     */
    formatPercentage(value, decimals = 0) {
        const num = parseFloat(value) || 0;
        return `${num.toFixed(decimals)}%`;
    },

    /**
     * Formatar número grande
     */
    formatLargeNumber(num) {
        if (!num) return '0';
        
        const value = parseFloat(num);
        if (value >= 1e9) {
            return `${(value / 1e9).toFixed(2)}B`;
        } else if (value >= 1e6) {
            return `${(value / 1e6).toFixed(2)}M`;
        } else if (value >= 1e3) {
            return `${(value / 1e3).toFixed(2)}K`;
        }
        return value.toFixed(2);
    },

    /**
     * Formatar hash de transação
     */
    formatTxHash(hash) {
        return this.formatAddress(hash, 8, 8);
    },

    /**
     * Formatar status
     */
    formatStatus(status) {
        const statusMap = {
            'pending': '⏳ Pendente',
            'in_progress': '🔄 Em Progresso',
            'completed': '✅ Completo',
            'failed': '❌ Falhou',
            'cancelled': '🚫 Cancelado'
        };
        return statusMap[status] || status;
    },

    /**
     * Formatar seed phrase para exibição
     */
    formatSeedPhrase(seedPhrase, showNumbers = true) {
        if (!seedPhrase) return '';
        
        const words = seedPhrase.split(' ');
        if (showNumbers) {
            return words.map((word, i) => `${i + 1}. ${word}`).join('\n');
        }
        return words.join(' ');
    },

    /**
     * Formatar mensagem de erro
     */
    formatError(error) {
        if (typeof error === 'string') {
            return error;
        }
        if (error.message) {
            return error.message;
        }
        return 'Erro desconhecido';
    },

    /**
     * Formatar nome do usuário
     */
    formatUserName(firstName, lastName, username) {
        if (firstName && lastName) {
            return `${firstName} ${lastName}`;
        }
        if (firstName) {
            return firstName;
        }
        if (username) {
            return `@${username}`;
        }
        return 'Usuário';
    },

    /**
     * Truncar texto
     */
    truncateText(text, maxLength = 100) {
        if (!text || text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength) + '...';
    },

    /**
     * Formatar lista numerada
     */
    formatNumberedList(items) {
        if (!Array.isArray(items)) return '';
        return items.map((item, i) => `${i + 1}. ${item}`).join('\n');
    },

    /**
     * Formatar lista com bullets
     */
    formatBulletList(items) {
        if (!Array.isArray(items)) return '';
        return items.map(item => `• ${item}`).join('\n');
    }
};

/**
 * Helpers de formatação
 */
const formatBalance = (amount, currency = 'SOL') => {
    if (currency === 'SOL') {
        return formatters.formatSOL(amount);
    }
    return formatters.formatToken(amount, currency);
};

const formatAddress = (address) => {
    return formatters.formatAddress(address);
};

module.exports = {
    formatters,
    formatBalance,
    formatAddress
};