// src/services/user-state.service.js
const Logger = require('../utils/logger');

class UserStateService {
    constructor(database) {
        this.db = database;
        this.logger = new Logger('UserStateService');
        
        // Estados possíveis do fluxo
        this.FLOW_STATES = {
            NEW_USER: 'new_user',
            ONBOARDING_START: 'onboarding_start',
            WALLET_PENDING: 'wallet_pending',
            WALLET_CREATED: 'wallet_created',
            FUNDING_PENDING: 'funding_pending',
            FUNDED: 'funded',
            MATRIX_PENDING: 'matrix_pending',
            MATRIX_CREATED: 'matrix_created',
            VOUCHER_PENDING: 'voucher_pending',
            VOUCHER_CREATED: 'voucher_created',
            REFERRAL_1_PENDING: 'referral_1_pending',
            REFERRAL_1_DONE: 'referral_1_done',
            REFERRAL_2_PENDING: 'referral_2_pending',
            REFERRAL_2_DONE: 'referral_2_done',
            REFERRAL_3_PENDING: 'referral_3_pending',
            COMPLETED: 'completed'
        };
        
        // Mapeamento de tarefas para estados
        this.TASK_TO_STATE = {
            'create_wallet': 'WALLET_CREATED',
            'fund_wallet': 'FUNDED',
            'create_matrix': 'MATRIX_CREATED',
            'create_voucher': 'VOUCHER_CREATED',
            'first_referral': 'REFERRAL_1_DONE',
            'second_referral': 'REFERRAL_2_DONE',
            'third_referral': 'COMPLETED'
        };
    }
    
    /**
     * Obter estado atual do usuário baseado em seu progresso
     */
    async getUserFlowState(telegramId) {
        try {
            // Verificar se usuário existe
            const user = await this.db.get(
                'SELECT * FROM users WHERE telegram_id = ?',
                [telegramId]
            );
            
            if (!user) {
                return this.FLOW_STATES.NEW_USER;
            }
            
            // Se não completou onboarding
            if (!user.onboarding_completed) {
                return this.FLOW_STATES.ONBOARDING_START;
            }
            
            // Verificar tarefas completadas para determinar estado
            const tasks = await this.db.all(`
                SELECT task_type, status 
                FROM tasks 
                WHERE telegram_id = ? 
                ORDER BY 
                    CASE task_type
                        WHEN 'create_wallet' THEN 1
                        WHEN 'fund_wallet' THEN 2
                        WHEN 'create_matrix' THEN 3
                        WHEN 'create_voucher' THEN 4
                        WHEN 'first_referral' THEN 5
                        WHEN 'second_referral' THEN 6
                        WHEN 'third_referral' THEN 7
                    END
            `, [telegramId]);
            
            // Mapear progresso
            const progress = {};
            tasks.forEach(task => {
                progress[task.task_type] = task.status;
            });
            
            // Determinar estado baseado no progresso
            if (progress.third_referral === 'completed') {
                return this.FLOW_STATES.COMPLETED;
            }
            
            if (progress.third_referral === 'in_progress') {
                return this.FLOW_STATES.REFERRAL_3_PENDING;
            }
            
            if (progress.second_referral === 'completed') {
                return this.FLOW_STATES.REFERRAL_2_DONE;
            }
            
            if (progress.second_referral === 'in_progress') {
                return this.FLOW_STATES.REFERRAL_2_PENDING;
            }
            
            if (progress.first_referral === 'completed') {
                return this.FLOW_STATES.REFERRAL_1_DONE;
            }
            
            if (progress.first_referral === 'in_progress') {
                return this.FLOW_STATES.REFERRAL_1_PENDING;
            }
            
            if (progress.create_voucher === 'completed') {
                return this.FLOW_STATES.VOUCHER_CREATED;
            }
            
            if (progress.create_voucher === 'in_progress') {
                return this.FLOW_STATES.VOUCHER_PENDING;
            }
            
            if (progress.create_matrix === 'completed') {
                return this.FLOW_STATES.MATRIX_CREATED;
            }
            
            if (progress.create_matrix === 'in_progress') {
                return this.FLOW_STATES.MATRIX_PENDING;
            }
            
            if (progress.fund_wallet === 'completed') {
                return this.FLOW_STATES.FUNDED;
            }
            
            if (progress.fund_wallet === 'in_progress') {
                return this.FLOW_STATES.FUNDING_PENDING;
            }
            
            if (progress.create_wallet === 'completed') {
                return this.FLOW_STATES.WALLET_CREATED;
            }
            
            if (progress.create_wallet === 'in_progress') {
                return this.FLOW_STATES.WALLET_PENDING;
            }
            
            // Se não tem nenhuma tarefa iniciada
            return this.FLOW_STATES.ONBOARDING_START;
            
        } catch (error) {
            this.logger.error('Erro ao obter estado do fluxo:', error);
            return this.FLOW_STATES.NEW_USER;
        }
    }
    
    /**
     * Obter próxima ação baseada no estado
     */
    getNextAction(flowState) {
        const actions = {
            [this.FLOW_STATES.NEW_USER]: {
                action: 'register',
                callback: 'start_onboarding',
                message: 'Bem-vindo! Vamos começar?'
            },
            [this.FLOW_STATES.ONBOARDING_START]: {
                action: 'show_intro',
                callback: 'task_create_wallet',
                message: 'Criar sua wallet'
            },
            [this.FLOW_STATES.WALLET_PENDING]: {
                action: 'create_wallet',
                callback: 'task_create_wallet',
                message: 'Criar sua wallet'
            },
            [this.FLOW_STATES.WALLET_CREATED]: {
                action: 'fund_wallet',
                callback: 'task_fund_wallet',
                message: 'Adicionar fundos'
            },
            [this.FLOW_STATES.FUNDING_PENDING]: {
                action: 'check_funding',
                callback: 'check_funding',
                message: 'Verificar depósito'
            },
            [this.FLOW_STATES.FUNDED]: {
                action: 'create_matrix',
                callback: 'task_create_matrix',
                message: 'Criar matriz'
            },
            [this.FLOW_STATES.MATRIX_PENDING]: {
                action: 'check_matrix',
                callback: 'task_create_matrix',
                message: 'Continuar matriz'
            },
            [this.FLOW_STATES.MATRIX_CREATED]: {
                action: 'create_voucher',
                callback: 'task_create_voucher',
                message: 'Criar voucher'
            },
            [this.FLOW_STATES.VOUCHER_PENDING]: {
                action: 'check_voucher',
                callback: 'task_create_voucher',
                message: 'Continuar voucher'
            },
            [this.FLOW_STATES.VOUCHER_CREATED]: {
                action: 'first_referral',
                callback: 'task_first_referral',
                message: 'Primeiro convite'
            },
            [this.FLOW_STATES.REFERRAL_1_PENDING]: {
                action: 'check_referrals',
                callback: 'task_first_referral',
                message: 'Continuar convites'
            },
            [this.FLOW_STATES.REFERRAL_1_DONE]: {
                action: 'second_referral',
                callback: 'task_second_referral',
                message: 'Segundo convite'
            },
            [this.FLOW_STATES.REFERRAL_2_PENDING]: {
                action: 'check_referrals',
                callback: 'task_second_referral',
                message: 'Continuar convites'
            },
            [this.FLOW_STATES.REFERRAL_2_DONE]: {
                action: 'third_referral',
                callback: 'task_third_referral',
                message: 'Terceiro convite'
            },
            [this.FLOW_STATES.REFERRAL_3_PENDING]: {
                action: 'check_referrals',
                callback: 'task_third_referral',
                message: 'Finalizar convites'
            },
            [this.FLOW_STATES.COMPLETED]: {
                action: 'continue',
                callback: 'view_matrix',
                message: 'Ver conquistas'
            }
        };
        
        return actions[flowState] || {
            action: 'main_menu',
            callback: 'main_menu',
            message: 'Menu principal'
        };
    }
    
    /**
     * Salvar estado atual do usuário
     */
    async saveUserState(telegramId, state) {
        try {
            await this.db.run(
                'UPDATE users SET current_step = ? WHERE telegram_id = ?',
                [state, telegramId]
            );
            
            this.logger.info(`Estado salvo para ${telegramId}: ${state}`);
            return true;
            
        } catch (error) {
            this.logger.error('Erro ao salvar estado:', error);
            return false;
        }
    }
    
    /**
     * Marcar onboarding como completo
     */
    async completeOnboarding(telegramId) {
        try {
            await this.db.run(
                'UPDATE users SET onboarding_completed = 1 WHERE telegram_id = ?',
                [telegramId]
            );
            
            this.logger.info(`Onboarding completo para ${telegramId}`);
            return true;
            
        } catch (error) {
            this.logger.error('Erro ao completar onboarding:', error);
            return false;
        }
    }
    
    /**
     * ✅ CORREÇÃO 2: Verificar se usuário pode acessar funcionalidade
     */
    async canAccessFeature(telegramId, feature) {
        const flowState = await this.getUserFlowState(telegramId);
        
        // ✅ RECURSOS DE WALLET SEMPRE ACESSÍVEIS
        const alwaysAccessible = [
            'send_tokens',
            'receive_tokens', 
            'view_balance',
            'manage_wallet',
            'wallet_menu',
            'wallet_settings',
            'show_seed',
            'change_pin',
            'copy_address',
            'show_qr_code',
            'share_address'
        ];
        
        // Se é recurso de wallet, sempre permitir (desde que tenha wallet)
        if (alwaysAccessible.includes(feature)) {
            const wallet = await this.db.get(
                'SELECT * FROM wallets WHERE telegram_id = ? AND is_active = 1',
                [telegramId]
            );
            return wallet !== null; // Só precisa ter wallet criada
        }
        
        // Mapeamento de funcionalidades que REQUEREM tarefas completas
        const featureRequirements = {
            'create_matrix': this.FLOW_STATES.FUNDED,        // Precisa completar funding
            'view_matrix': this.FLOW_STATES.MATRIX_CREATED,  // Precisa ter matriz
            'create_voucher': this.FLOW_STATES.MATRIX_CREATED,// Precisa ter matriz
            'view_vouchers': this.FLOW_STATES.VOUCHER_CREATED,// Precisa ter voucher
            'view_airdrop': this.FLOW_STATES.MATRIX_CREATED, // Precisa ter matriz
            'dashboard': this.FLOW_STATES.MATRIX_CREATED      // Precisa ter matriz
        };
        
        const requiredState = featureRequirements[feature];
        if (!requiredState) return true; // Sem restrição
        
        // Converter estados para números para comparação
        const stateOrder = Object.values(this.FLOW_STATES);
        const currentIndex = stateOrder.indexOf(flowState);
        const requiredIndex = stateOrder.indexOf(requiredState);
        
        return currentIndex >= requiredIndex;
    }
    
    /**
     * Obter mensagem de bloqueio para funcionalidade
     */
    getBlockedFeatureMessage(feature) {
        const messages = {
            'send_tokens': '❌ Você precisa adicionar fundos primeiro!',
            'create_matrix': '❌ Adicione $15 em SOL antes de criar a matriz!',
            'view_matrix': '❌ Você ainda não criou sua matriz!',
            'create_voucher': '❌ Crie sua matriz antes de criar voucher!',
            'view_vouchers': '❌ Você ainda não tem vouchers!',
            'view_airdrop': '❌ Complete sua matriz para acessar o airdrop!',
            'dashboard': '❌ Complete a criação da matriz primeiro!'
        };
        
        return messages[feature] || '❌ Complete as tarefas anteriores primeiro!';
    }
    
    /**
     * Obter estatísticas do usuário
     */
    async getUserStats(telegramId) {
        try {
            const tasks = await this.db.all(
                'SELECT * FROM tasks WHERE telegram_id = ?',
                [telegramId]
            );
            
            const completed = tasks.filter(t => t.status === 'completed').length;
            const pending = tasks.filter(t => t.status === 'pending').length;
            const inProgress = tasks.filter(t => t.status === 'in_progress').length;
            
            return {
                totalTasks: tasks.length,
                completed,
                pending,
                inProgress,
                progressPercent: Math.round((completed / tasks.length) * 100)
            };
            
        } catch (error) {
            this.logger.error('Erro ao obter estatísticas:', error);
            return {
                totalTasks: 7,
                completed: 0,
                pending: 7,
                inProgress: 0,
                progressPercent: 0
            };
        }
    }
}

module.exports = UserStateService;