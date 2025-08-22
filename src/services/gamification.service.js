// src/services/gamification.service.js
const Logger = require('../utils/logger');
const logger = new Logger('GamificationService');
const { sleep } = require('../utils/helpers');

class GamificationService {
    constructor(database) {
        this.db = database;
        
        this.TASK_TYPES = [
            'create_wallet',
            'fund_wallet', 
            'create_matrix',
            'create_voucher',
            'first_referral',
            'second_referral',
            'third_referral'
        ];

        this.BLOCKING_TASKS = ['fund_wallet'];
        
        this.followUpTimers = new Map();
    }

    async initializeUserTasks(telegramId) {
        try {
            const queries = this.TASK_TYPES.map(taskType => ({
                sql: `INSERT INTO tasks (telegram_id, task_type, status) VALUES (?, ?, ?)`,
                params: [telegramId, taskType, 'pending']
            }));

            await this.db.transaction(queries);
            
            logger.info('User tasks initialized', { telegramId, taskCount: this.TASK_TYPES.length });

        } catch (error) {
            logger.error('Error initializing user tasks', { telegramId, error: error.message });
            throw error;
        }
    }

    async getCurrentTask(telegramId) {
        try {
            for (const taskType of this.TASK_TYPES) {
                const task = await this.db.get(`
                    SELECT * FROM tasks 
                    WHERE telegram_id = ? AND task_type = ? AND status = 'pending'
                    ORDER BY created_at ASC LIMIT 1
                `, [telegramId, taskType]);

                if (task) {
                    return {
                        ...task,
                        data: task.data ? JSON.parse(task.data) : {}
                    };
                }
            }

            return null;

        } catch (error) {
            logger.error('Error getting current task', { telegramId, error: error.message });
            throw error;
        }
    }

    async isUserBlocked(telegramId) {
        try {
            for (const blockingTask of this.BLOCKING_TASKS) {
                const task = await this.db.get(`
                    SELECT * FROM tasks 
                    WHERE telegram_id = ? AND task_type = ? AND status = 'pending'
                `, [telegramId, blockingTask]);

                if (task) {
                    return {
                        blocked: true,
                        blockingTask: blockingTask,
                        reason: this.getBlockingReason(blockingTask)
                    };
                }
            }

            return { blocked: false };

        } catch (error) {
            logger.error('Error checking user blocking', { telegramId, error: error.message });
            return { blocked: false };
        }
    }

    getBlockingReason(taskType) {
        const reasons = {
            fund_wallet: '⚠️ Complete o funding da sua wallet primeiro!\n\n💰 Envie pelo menos $15 em SOL para sua wallet.\n\n⏱️ Verificando automaticamente...'
        };

        return reasons[taskType] || 'Complete a tarefa anterior primeiro.';
    }

    async completeTask(telegramId, taskType, taskData = {}) {
        try {
            const result = await this.db.run(`
                UPDATE tasks 
                SET status = 'completed', completed_at = CURRENT_TIMESTAMP, task_data = ?
                WHERE telegram_id = ? AND task_type = ? AND status = 'pending'
            `, [JSON.stringify(taskData), telegramId, taskType]);

            if (result.changes > 0) {
                logger.info('Task completed', { telegramId, taskType, taskData });

                this.cancelFollowUpTimer(telegramId, taskType);

                return true;
            }

            return false;

        } catch (error) {
            logger.error('Error completing task', { telegramId, taskType, error: error.message });
            throw error;
        }
    }

    async updateTaskData(telegramId, taskType, newData) {
        try {
            const task = await this.db.get(`
                SELECT * FROM tasks 
                WHERE telegram_id = ? AND task_type = ?
            `, [telegramId, taskType]);

            if (!task) {
                return false;
            }

            const currentData = task.task_data ? JSON.parse(task.task_data) : {};
            const updatedData = { ...currentData, ...newData };

            await this.db.run(`
                UPDATE tasks 
                SET task_data = ?
                WHERE telegram_id = ? AND task_type = ?
            `, [JSON.stringify(updatedData), telegramId, taskType]);

            logger.info('Task data updated', { telegramId, taskType, newData });
            return true;

        } catch (error) {
            logger.error('Error updating task data', { telegramId, taskType, error: error.message });
            return false;
        }
    }

    async startTask(telegramId, taskType, taskData = {}) {
        try {
            const result = await this.db.run(`
                UPDATE tasks 
                SET status = 'in_progress', task_data = ?
                WHERE telegram_id = ? AND task_type = ? AND status = 'pending'
            `, [JSON.stringify(taskData), telegramId, taskType]);

            if (result.changes > 0) {
                logger.info('Task started', { telegramId, taskType });
                return true;
            }

            return false;

        } catch (error) {
            logger.error('Error starting task', { telegramId, taskType, error: error.message });
            throw error;
        }
    }

    async getUserProgress(telegramId) {
        try {
            const tasks = await this.db.all(`
                SELECT task_type, status, completed_at, task_data 
                FROM tasks 
                WHERE telegram_id = ? 
                ORDER BY created_at ASC
            `, [telegramId]);

            const completedTasks = tasks.filter(t => t.status === 'completed');
            const totalTasks = this.TASK_TYPES.length;
            const completedCount = completedTasks.length;
            const progressPercent = Math.round((completedCount / totalTasks) * 100);

            const currentTask = await this.getCurrentTask(telegramId);

            return {
                totalTasks,
                completedCount,
                progressPercent,
                currentTask,
                isCompleted: completedCount === totalTasks,
                tasks: tasks.map(task => ({
                    ...task,
                    data: task.task_data ? JSON.parse(task.task_data) : {}
                }))
            };

        } catch (error) {
            logger.error('Error getting user progress', { telegramId, error: error.message });
            throw error;
        }
    }

    async isTaskCompleted(telegramId, taskType) {
        try {
            const task = await this.db.get(`
                SELECT * FROM tasks 
                WHERE telegram_id = ? AND task_type = ? AND status = 'completed'
            `, [telegramId, taskType]);

            return !!task;

        } catch (error) {
            logger.error('Error checking task completion', { telegramId, taskType, error: error.message });
            return false;
        }
    }

    async getTaskData(telegramId, taskType) {
        try {
            const task = await this.db.get(`
                SELECT * FROM tasks 
                WHERE telegram_id = ? AND task_type = ?
            `, [telegramId, taskType]);

            if (task && task.task_data) {
                return JSON.parse(task.task_data);
            }

            return {};

        } catch (error) {
            logger.error('Error getting task data', { telegramId, taskType, error: error.message });
            return {};
        }
    }

    setFollowUpTimer(telegramId, taskType, delayMs, callback) {
        try {
            const timerId = `${telegramId}_${taskType}`;
            
            this.cancelFollowUpTimer(telegramId, taskType);

            const timer = setTimeout(async () => {
                try {
                    const currentTask = await this.getCurrentTask(telegramId);
                    if (currentTask && currentTask.task_type === taskType) {
                        await callback();
                    }
                } catch (error) {
                    logger.error('Follow-up timer callback error', { 
                        telegramId, 
                        taskType, 
                        error: error.message 
                    });
                }

                this.followUpTimers.delete(timerId);
            }, delayMs);

            this.followUpTimers.set(timerId, timer);

            logger.info('Follow-up timer set', { telegramId, taskType, delayMs });

        } catch (error) {
            logger.error('Error setting follow-up timer', { 
                telegramId, 
                taskType, 
                error: error.message 
            });
        }
    }

    cancelFollowUpTimer(telegramId, taskType) {
        const timerId = `${telegramId}_${taskType}`;
        const timer = this.followUpTimers.get(timerId);
        
        if (timer) {
            clearTimeout(timer);
            this.followUpTimers.delete(timerId);
            logger.info('Follow-up timer cancelled', { telegramId, taskType });
        }
    }

    async getTaskStats() {
        try {
            const stats = {};

            for (const taskType of this.TASK_TYPES) {
                const completed = await this.db.count('tasks', 
                    'task_type = ? AND status = ?', 
                    [taskType, 'completed']
                );
                
                const pending = await this.db.count('tasks', 
                    'task_type = ? AND status = ?', 
                    [taskType, 'pending']
                );

                const inProgress = await this.db.count('tasks', 
                    'task_type = ? AND status = ?', 
                    [taskType, 'in_progress']
                );

                stats[taskType] = {
                    completed,
                    pending,
                    inProgress,
                    total: completed + pending + inProgress
                };
            }

            return stats;

        } catch (error) {
            logger.error('Error getting task stats', { error: error.message });
            throw error;
        }
    }

    async resetUserTasks(telegramId) {
        try {
            for (const taskType of this.TASK_TYPES) {
                this.cancelFollowUpTimer(telegramId, taskType);
            }

            await this.db.run(`
                DELETE FROM tasks WHERE telegram_id = ?
            `, [telegramId]);

            await this.initializeUserTasks(telegramId);

            logger.info('User tasks reset', { telegramId });
            return true;

        } catch (error) {
            logger.error('Error resetting user tasks', { telegramId, error: error.message });
            throw error;
        }
    }

    getMotivationalMessage(progress) {
        const messages = {
            0: '🚀 Bem-vindo! Vamos começar sua jornada no Donut!',
            20: '👏 Excelente começo! Continue assim!',
            40: '🔥 Você está indo muito bem! Quase na metade!',
            60: '⚡ Mais da metade completa! Não pare agora!',
            80: '🏆 Quase lá! Você está quase completando tudo!',
            100: '🎉 PARABÉNS! Você completou todas as tarefas!'
        };

        const thresholds = Object.keys(messages).map(Number).sort((a, b) => a - b);
        
        for (let i = thresholds.length - 1; i >= 0; i--) {
            if (progress.progressPercent >= thresholds[i]) {
                return messages[thresholds[i]];
            }
        }

        return messages[0];
    }

    getNextStepSuggestion(currentTask) {
        const suggestions = {
            create_wallet: '💳 Crie sua wallet para começar!',
            fund_wallet: '💰 Deposite $15 em SOL na sua wallet',
            create_matrix: '🎯 Crie sua matriz para participar do sistema',
            create_voucher: '🎫 Crie seu código de convite personalizado',
            first_referral: '👥 Convide seu primeiro amigo',
            second_referral: '🔥 Convide mais um amigo para desbloquear recompensas',
            third_referral: '🏆 Complete sua matriz convidando o terceiro amigo'
        };

        return suggestions[currentTask?.task_type] || '✅ Todas as tarefas completas!';
    }

    cleanup() {
        for (const timer of this.followUpTimers.values()) {
            clearTimeout(timer);
        }
        this.followUpTimers.clear();
        logger.info('Gamification service cleanup completed');
    }
}

module.exports = GamificationService;