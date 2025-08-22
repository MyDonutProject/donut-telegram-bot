// src/utils/logger.js
const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.logDir = path.join(__dirname, '../../logs');
        this.ensureLogDir();
    }

    ensureLogDir() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    log(level, message, data = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            ...data
        };

        const logString = JSON.stringify(logEntry);
        
        // Log no console
        console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`, data);
        
        // Log em arquivo
        const filename = level === 'error' ? 'error.log' : 'bot.log';
        const filepath = path.join(this.logDir, filename);
        
        fs.appendFileSync(filepath, logString + '\n');
    }

    info(message, data = {}) {
        this.log('info', message, data);
    }

    warn(message, data = {}) {
        this.log('warn', message, data);
    }

    error(message, data = {}) {
        this.log('error', message, data);
    }

    debug(message, data = {}) {
        if (process.env.NODE_ENV === 'development') {
            this.log('debug', message, data);
        }
    }
}

module.exports = Logger;

