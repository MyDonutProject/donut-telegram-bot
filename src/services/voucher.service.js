// src/services/voucher.service.js
const Logger = require('../utils/logger');

class VoucherService {
    constructor(db, walletService) {
        this.db = db;
        this.walletService = walletService;
        this.logger = new Logger('VoucherService');
        this.botUsername = process.env.BOT_USERNAME || 'DonutMatrixBot';
    }

    /**
     * Criar voucher para o usuário
     */
    async createVoucher(telegramId, voucherSlug) {
        try {
            // Validar slug
            if (!this.isValidSlug(voucherSlug)) {
                return {
                    success: false,
                    error: 'Nome inválido! Use apenas letras, números e underline (3-20 caracteres)'
                };
            }

            // Verificar se slug já existe
            const existing = await this.db.get(
                'SELECT id FROM user_vouchers WHERE voucher_slug = ?',
                [voucherSlug]
            );

            if (existing) {
                return {
                    success: false,
                    error: 'Este nome já está em uso! Escolha outro.'
                };
            }

            // Obter wallet do usuário
            const wallet = await this.walletService.getActiveWallet(telegramId);
            if (!wallet) {
                return {
                    success: false,
                    error: 'Você precisa ter uma wallet ativa para criar voucher'
                };
            }

            // Verificar se usuário já tem voucher
            const userVoucher = await this.getUserVoucher(telegramId);
            if (userVoucher) {
                return {
                    success: false,
                    error: 'Você já possui um voucher ativo!',
                    existingVoucher: userVoucher
                };
            }

            // Gerar link de referência
            const referralLink = this.generateReferralLink(voucherSlug);

            // Salvar voucher no banco
            const result = await this.db.run(`
                INSERT INTO user_vouchers (
                    telegram_id,
                    wallet_address,
                    voucher_slug,
                    email,
                    email_verified,
                    challenge_id,
                    verification_code,
                    referral_link,
                    is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                telegramId,
                wallet.public_key,
                voucherSlug,
                'test@donut.bot',
                1,  // Email verificado automaticamente para testes
                'test-challenge',
                '0000',
                referralLink,
                1
            ]);

            this.logger.info(`Voucher criado: ${voucherSlug} para usuário ${telegramId}`);

            return {
                success: true,
                voucherId: result.id,
                voucherSlug: voucherSlug,
                referralLink: referralLink,
                walletAddress: wallet.public_key
            };

        } catch (error) {
            this.logger.error('Erro ao criar voucher:', error);
            return {
                success: false,
                error: 'Erro ao criar voucher. Tente novamente.'
            };
        }
    }

    /**
     * Validar slug do voucher
     */
    isValidSlug(slug) {
        // Regex: apenas letras, números e underline, 3-20 caracteres
        const regex = /^[a-zA-Z0-9_]{3,20}$/;
        return regex.test(slug);
    }

    /**
     * Gerar link de referência
     */
    generateReferralLink(voucherSlug) {
        return `https://t.me/${this.botUsername}?start=voucher_${voucherSlug}`;
    }

    /**
     * Obter voucher do usuário
     */
    async getUserVoucher(telegramId) {
        try {
            const voucher = await this.db.get(`
                SELECT * FROM user_vouchers 
                WHERE telegram_id = ? AND is_active = 1
                ORDER BY created_at DESC
                LIMIT 1
            `, [telegramId]);

            return voucher;

        } catch (error) {
            this.logger.error('Erro ao obter voucher:', error);
            return null;
        }
    }

    /**
     * Obter voucher por slug
     */
    async getVoucherBySlug(slug) {
        try {
            const voucher = await this.db.get(`
                SELECT * FROM user_vouchers 
                WHERE voucher_slug = ? AND is_active = 1
            `, [slug]);

            return voucher;

        } catch (error) {
            this.logger.error('Erro ao buscar voucher por slug:', error);
            return null;
        }
    }

    /**
     * Processar uso de voucher (quando alguém usa o link)
     */
    async processVoucherUse(referredTelegramId, voucherSlug) {
        try {
            // Buscar voucher
            const voucher = await this.getVoucherBySlug(voucherSlug);
            
            if (!voucher) {
                this.logger.warn(`Voucher não encontrado: ${voucherSlug}`);
                return {
                    success: false,
                    error: 'Voucher inválido ou inativo'
                };
            }

            // Verificar se é o próprio dono tentando usar
            if (voucher.telegram_id === referredTelegramId) {
                return {
                    success: false,
                    error: 'Você não pode usar seu próprio voucher!'
                };
            }

            // Verificar se já foi referenciado antes
            const existingReferral = await this.db.get(`
                SELECT id FROM referral_tracking 
                WHERE referred_telegram_id = ?
            `, [referredTelegramId]);

            if (existingReferral) {
                return {
                    success: false,
                    error: 'Você já foi referenciado anteriormente'
                };
            }

            // Salvar tracking de referência
            await this.db.run(`
                INSERT INTO referral_tracking (
                    referrer_telegram_id,
                    referrer_wallet,
                    referrer_voucher,
                    referred_telegram_id,
                    matrix_created
                ) VALUES (?, ?, ?, ?, 0)
            `, [
                voucher.telegram_id,
                voucher.wallet_address,
                voucherSlug,
                referredTelegramId
            ]);

            // Incrementar contador de uso
            await this.db.run(`
                UPDATE user_vouchers 
                SET uses_count = uses_count + 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [voucher.id]);

            this.logger.info(`Voucher ${voucherSlug} usado por ${referredTelegramId}`);

            return {
                success: true,
                referrerTelegramId: voucher.telegram_id,
                referrerWallet: voucher.wallet_address,
                voucherSlug: voucherSlug
            };

        } catch (error) {
            this.logger.error('Erro ao processar uso de voucher:', error);
            return {
                success: false,
                error: 'Erro ao processar voucher'
            };
        }
    }

    /**
     * Obter estatísticas do voucher
     */
    async getVoucherStats(telegramId) {
        try {
            const voucher = await this.getUserVoucher(telegramId);
            
            if (!voucher) {
                return {
                    hasVoucher: false
                };
            }

            // Buscar referidos através deste voucher
            const referrals = await this.db.all(`
                SELECT 
                    rt.*,
                    u.first_name,
                    u.telegram_username
                FROM referral_tracking rt
                LEFT JOIN users u ON rt.referred_telegram_id = u.telegram_id
                WHERE rt.referrer_voucher = ?
                ORDER BY rt.created_at DESC
            `, [voucher.voucher_slug]);

            // Contar quantos criaram matriz
            const matricesCreated = referrals.filter(r => r.matrix_created).length;

            return {
                hasVoucher: true,
                voucher: voucher,
                totalUses: voucher.uses_count || 0,
                referrals: referrals,
                matricesCreated: matricesCreated,
                pendingMatrices: referrals.length - matricesCreated
            };

        } catch (error) {
            this.logger.error('Erro ao obter estatísticas:', error);
            return {
                hasVoucher: false
            };
        }
    }

    /**
     * Atualizar voucher quando referido cria matriz
     */
    async updateVoucherOnMatrixCreation(referredTelegramId) {
        try {
            // Buscar tracking
            const tracking = await this.db.get(`
                SELECT * FROM referral_tracking 
                WHERE referred_telegram_id = ?
            `, [referredTelegramId]);

            if (tracking && !tracking.matrix_created) {
                // Marcar como matriz criada
                await this.db.run(`
                    UPDATE referral_tracking 
                    SET matrix_created = 1
                    WHERE id = ?
                `, [tracking.id]);

                this.logger.info(`Tracking atualizado: referido ${referredTelegramId} criou matriz`);
            }

        } catch (error) {
            this.logger.error('Erro ao atualizar voucher:', error);
        }
    }

    /**
     * Desativar voucher
     */
    async deactivateVoucher(telegramId) {
        try {
            await this.db.run(`
                UPDATE user_vouchers 
                SET is_active = 0,
                    updated_at = CURRENT_TIMESTAMP
                WHERE telegram_id = ?
            `, [telegramId]);

            return { success: true };

        } catch (error) {
            this.logger.error('Erro ao desativar voucher:', error);
            return { success: false };
        }
    }

    /**
     * Listar vouchers mais usados (para estatísticas)
     */
    async getTopVouchers(limit = 10) {
        try {
            const vouchers = await this.db.all(`
                SELECT 
                    v.*,
                    u.first_name,
                    u.telegram_username,
                    COUNT(rt.id) as total_referrals,
                    SUM(CASE WHEN rt.matrix_created = 1 THEN 1 ELSE 0 END) as matrices_created
                FROM user_vouchers v
                LEFT JOIN users u ON v.telegram_id = u.telegram_id
                LEFT JOIN referral_tracking rt ON rt.referrer_voucher = v.voucher_slug
                WHERE v.is_active = 1
                GROUP BY v.id
                ORDER BY total_referrals DESC
                LIMIT ?
            `, [limit]);

            return vouchers;

        } catch (error) {
            this.logger.error('Erro ao listar top vouchers:', error);
            return [];
        }
    }
}

module.exports = VoucherService;