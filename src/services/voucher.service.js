// src/services/voucher.service.js
const axios = require("axios")
const Logger = require("../utils/logger")

class VoucherService {
  db
  walletService
  logger
  botUsername
  axios

  constructor(db, walletService) {
    this.db = db
    this.walletService = walletService
    this.logger = new Logger()
    this.botUsername = process.env.BOT_USERNAME || "DonutMatrixBot"
    this.axios = axios.create({
      baseURL: `https://api.mydonut.io/v1`,
    })
  }

  /**
   * Create wallet email (if not exists) and create an MFA challenge for email confirmation
   *
   * @param {string} email
   * @param {string} pubkey
   * @returns {Promise<{success: boolean, data?: {email: {id: string, email: string, verified: boolean}, challenge: {id: number, methodId: number, reasonId: number, status: string}} | null, error?: string}>}
   *
   * @request JSON:
   * {
   *   "email": string,
   *   "pubkey": string
   * }
   *
   * @response JSON:
   * {
   *   "success": true,
   *   "data": {
   *     "email": { "id": string, "email": string, "verified": boolean },
   *     "challenge": { "id": number, "methodId": number, "reasonId": number, "status": string }
   *   }
   * }
   *
   * @response JSON:
   * {
   *   "success": false,
   *   "error": string
   * }
   */
  async createEmailAndChallenge(email, pubkey) {
    try {
      const response = await this.axios.post("/emails", {
        email,
        pubkey,
      })

      if (!response.data) {
        return {
          success: false,
          error: "Erro ao criar email e desafio",
        }
      }

      const challenge = await this.createChallenge(pubkey)

      if (!challenge.success) {
        return {
          success: false,
          error: "Erro ao criar desafio",
        }
      }

      return {
        success: true,
        data: {
          email: response.data,
          challenge: challenge.data,
        },
      }
    } catch (error) {
      this.logger.error(
        "Erro ao criar email e desafio:",
        error?.response?.data || error
      )
      return {
        success: false,
        error:
          error?.response?.data?.message ||
          "Erro ao criar email e desafio",
      }
    }
  }

  async createChallenge(pubkey) {
    const response = await this.axios.post("/mfa/challenge", {
      pubkey,
      methodId: 1,
      reasonId: 1,
    })

    if (!response.data) {
      return {
        success: false,
        error: "Erro ao criar desafio",
      }
    }

    return {
      success: true,
      data: response.data,
    }
  }

  async getCurrentChallengeForPooling(challengeId) {
    try {
      const response = await this.axios.get(
        `/mfa/challenge/${challengeId}`
      )
      if (!response.data) {
        return {
          success: false,
          error: "Erro ao buscar desafio",
        }
      }

      return {
        success: true,
        data: response.data,
      }
    } catch (error) {
      this.logger.error("Erro ao buscar desafio:", error)
      return {
        success: false,
        error: error.response?.data?.message,
      }
    }
  }

  /**
   * Verify MFA challenge and, if successful, verify the email binding to that challenge
   *
   * Request JSON:
   * {
   *   "emailId": string,
   *   "challengeId": string | number,
   *   "code": string
   * }
   *
   * Success Response JSON:
   * {
   *   "success": true,
   *   "data": {
   *     "challenge": { "id": number, "status": string },
   *     "email": { "id": string, "email": string, "verified": true }
   *   }
   * }
   *
   * Error Response JSON:
   * {
   *   "success": false,
   *   "error": string
   * }
   */
  async verifyChallengeAndEmail(emailId, challengeId, code) {
    try {
      const challengeVerification = await this.verifyChallenge(
        challengeId,
        code
      )

      if (!challengeVerification.success) {
        return challengeVerification
      }

      const emailVerification = await this.verifyEmail(
        emailId,
        code,
        challengeId
      )

      if (!emailVerification.success) {
        return emailVerification
      }

      return {
        success: true,
        data: {
          challenge: challengeVerification.data,
          email: emailVerification.data,
        },
      }
    } catch (error) {
      this.logger.error("Erro ao verificar desafio e email:", error)
      return {
        success: false,
        error:
          error?.response?.data?.message ||
          "Erro ao verificar desafio e email",
      }
    }
  }

  async verifyChallenge(challengeId, code) {
    try {
      const response = await this.axios.post(
        `/mfa/challenge/${challengeId}/verify`,
        {
          code,
        }
      )

      if (!response.data) {
        return {
          success: false,
          error: "Erro ao verificar desafio",
        }
      }

      return {
        success: true,
        data: response.data,
      }
    } catch (error) {
      this.logger.error("Erro ao verificar desafio:", error)
      return {
        success: false,
        error: error.response?.data?.message,
      }
    }
  }

  async verifyEmail(emailId, code, challengeId) {
    try {
      const response = await this.axios.post(
        `/emails/${emailId}/verify`,
        {
          code,
        },
        {
          headers: {
            "x-challenge-id": challengeId,
          },
        }
      )

      if (!response.data) {
        return {
          success: false,
          error: "Erro ao verificar email",
        }
      }

      return {
        success: true,
        data: response.data,
      }
    } catch (error) {
      this.logger.error("Erro ao verificar email:", error)
      return {
        success: false,
        error: error.response?.data?.message,
      }
    }
  }

  async getEmailById(emailId) {
    try {
      const response = await this.axios.get(`/emails/${emailId}`)
      if (!response.data) {
        return {
          success: false,
          error: "Erro ao buscar email",
        }
      }

      return {
        success: true,
        data: response.data,
      }
    } catch (error) {
      this.logger.error("Erro ao buscar email:", error)
      return {
        success: false,
        error: error.response?.data?.message,
      }
    }
  }

  async createWalletVoucher(name, pubkey) {
    try {
      const response = await this.axios.post("/wallet-vouchers", {
        name,
        pubkey,
      })

      if (!response.data) {
        return {
          success: false,
          error: "Erro ao criar wallet",
        }
      }

      return {
        success: true,
        data: response.data,
      }
    } catch (error) {
      this.logger.error("Erro ao criar wallet:", error)
      return {
        success: false,
        error: error.response?.data?.message,
      }
    }
  }

  /**
   * Create a voucher record for the user after email verification is completed
   *
   * Request JSON:
   * {
   *   "telegramId": number,
   *   "voucherSlug": string,
   *   "email": string
   * }
   *
   * Success Response JSON:
   * {
   *   "success": true,
   *   "voucherId": number,
   *   "voucherSlug": string,
   *   "referralLink": string,
   *   "walletAddress": string
   * }
   *
   * Error Response JSON:
   * {
   *   "success": false,
   *   "error": string,
   *   "existingVoucher"?: object
   * }
   */
  async createVoucher(telegramId, voucherSlug, email) {
    try {
      // Validate slug
      if (!this.isValidSlug(voucherSlug)) {
        return {
          success: false,
          error:
            "Nome inválido! Use apenas letras, números e underline (3-20 caracteres)",
        }
      }

      // Check slug uniqueness
      const existing = await this.db.get(
        "SELECT id FROM user_vouchers WHERE voucher_slug = ?",
        [voucherSlug]
      )

      if (existing) {
        return {
          success: false,
          error: "Este nome já está em uso! Escolha outro.",
        }
      }

      // Get user wallet
      const wallet = await this.walletService.getActiveWallet(
        telegramId
      )
      if (!wallet) {
        return {
          success: false,
          error:
            "Você precisa ter uma wallet ativa para criar voucher",
        }
      }

      // Check if user already has an active voucher
      const userVoucher = await this.getUserVoucher(telegramId)
      if (userVoucher) {
        return {
          success: false,
          error: "Você já possui um voucher ativo!",
          existingVoucher: userVoucher,
        }
      }

      // Generate referral link
      const referralLink = this.generateReferralLink(voucherSlug)

      // Persist voucher
      const result = await this.db.run(
        `
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
            `,
        [
          telegramId,
          wallet.public_key,
          voucherSlug,
          email || null,
          email ? 1 : 0,
          null,
          null,
          referralLink,
          1,
        ]
      )

      this.logger.info(
        `Voucher criado: ${voucherSlug} para usuário ${telegramId}`
      )

      return {
        success: true,
        voucherId: result.id,
        voucherSlug: voucherSlug,
        referralLink: referralLink,
        walletAddress: wallet.public_key,
      }
    } catch (error) {
      this.logger.error("Erro ao criar voucher:", error)
      return {
        success: false,
        error: "Erro ao criar voucher. Tente novamente.",
      }
    }
  }

  /**
   * Validate voucher slug format
   */
  isValidSlug(slug) {
    // Regex: only letters, numbers and underscore, 3-20 chars
    const regex = /^[a-zA-Z0-9_]{3,20}$/
    return regex.test(slug)
  }

  /**
   * Build referral link for a voucher
   */
  generateReferralLink(voucherSlug) {
    return `https://t.me/${this.botUsername}?start=voucher_${voucherSlug}`
  }

  /**
   * Get the latest active voucher for a user
   */
  async getUserVoucher(telegramId) {
    try {
      const voucher = await this.db.get(
        `
                SELECT * FROM user_vouchers 
                WHERE telegram_id = ? AND is_active = 1
                ORDER BY created_at DESC
                LIMIT 1
            `,
        [telegramId]
      )

      return voucher
    } catch (error) {
      this.logger.error("Erro ao obter voucher:", error)
      return null
    }
  }

  /**
   * Get an active voucher by its slug
   */
  async getVoucherBySlug(slug) {
    try {
      const voucher = await this.db.get(
        `
                SELECT * FROM user_vouchers 
                WHERE voucher_slug = ? AND is_active = 1
            `,
        [slug]
      )

      return voucher
    } catch (error) {
      this.logger.error("Erro ao buscar voucher por slug:", error)
      return null
    }
  }

  /**
   * Process voucher use by a referred user
   */
  async processVoucherUse(referredTelegramId, voucherSlug) {
    try {
      // Fetch voucher
      const voucher = await this.getVoucherBySlug(voucherSlug)

      if (!voucher) {
        this.logger.warn(`Voucher não encontrado: ${voucherSlug}`)
        return {
          success: false,
          error: "Voucher inválido ou inativo",
        }
      }

      // Prevent self-referral
      if (voucher.telegram_id === referredTelegramId) {
        return {
          success: false,
          error: "Você não pode usar seu próprio voucher!",
        }
      }

      // Verify if already referred
      const existingReferral = await this.db.get(
        `
                SELECT id FROM referral_tracking 
                WHERE referred_telegram_id = ?
            `,
        [referredTelegramId]
      )

      if (existingReferral) {
        return {
          success: false,
          error: "Você já foi referenciado anteriormente",
        }
      }

      // Save referral tracking
      await this.db.run(
        `
                INSERT INTO referral_tracking (
                    referrer_telegram_id,
                    referrer_wallet,
                    referrer_voucher,
                    referred_telegram_id,
                    matrix_created
                ) VALUES (?, ?, ?, ?, 0)
            `,
        [
          voucher.telegram_id,
          voucher.wallet_address,
          voucherSlug,
          referredTelegramId,
        ]
      )

      // Increment voucher use counter
      await this.db.run(
        `
                UPDATE user_vouchers 
                SET uses_count = uses_count + 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `,
        [voucher.id]
      )

      this.logger.info(
        `Voucher ${voucherSlug} usado por ${referredTelegramId}`
      )

      return {
        success: true,
        referrerTelegramId: voucher.telegram_id,
        referrerWallet: voucher.wallet_address,
        voucherSlug: voucherSlug,
      }
    } catch (error) {
      this.logger.error("Erro ao processar uso de voucher:", error)
      return {
        success: false,
        error: "Erro ao processar voucher",
      }
    }
  }

  /**
   * Get stats for a user's voucher
   */
  async getVoucherStats(telegramId) {
    try {
      const voucher = await this.getUserVoucher(telegramId)

      if (!voucher) {
        return {
          hasVoucher: false,
        }
      }

      // Query referrals for this voucher
      const referrals = await this.db.all(
        `
                SELECT 
                    rt.*,
                    u.first_name,
                    u.telegram_username
                FROM referral_tracking rt
                LEFT JOIN users u ON rt.referred_telegram_id = u.telegram_id
                WHERE rt.referrer_voucher = ?
                ORDER BY rt.created_at DESC
            `,
        [voucher.voucher_slug]
      )

      // Count matrices created
      const matricesCreated = referrals.filter(
        (r) => r.matrix_created
      ).length

      return {
        hasVoucher: true,
        voucher: voucher,
        totalUses: voucher.uses_count || 0,
        referrals: referrals,
        matricesCreated: matricesCreated,
        pendingMatrices: referrals.length - matricesCreated,
      }
    } catch (error) {
      this.logger.error("Erro ao obter estatísticas:", error)
      return {
        hasVoucher: false,
      }
    }
  }

  /**
   * Mark referral as having created a matrix
   */
  async updateVoucherOnMatrixCreation(referredTelegramId) {
    try {
      // Fetch tracking
      const tracking = await this.db.get(
        `
                SELECT * FROM referral_tracking 
                WHERE referred_telegram_id = ?
            `,
        [referredTelegramId]
      )

      if (tracking && !tracking.matrix_created) {
        // Mark as matrix created
        await this.db.run(
          `
                    UPDATE referral_tracking 
                    SET matrix_created = 1
                    WHERE id = ?
                `,
          [tracking.id]
        )

        this.logger.info(
          `Tracking atualizado: referido ${referredTelegramId} criou matriz`
        )
      }
    } catch (error) {
      this.logger.error("Erro ao atualizar voucher:", error)
    }
  }

  /**
   * Deactivate user's voucher
   */
  async deactivateVoucher(telegramId) {
    try {
      await this.db.run(
        `
                UPDATE user_vouchers 
                SET is_active = 0,
                    updated_at = CURRENT_TIMESTAMP
                WHERE telegram_id = ?
            `,
        [telegramId]
      )

      return { success: true }
    } catch (error) {
      this.logger.error("Erro ao desativar voucher:", error)
      return { success: false }
    }
  }

  /**
   * Top used vouchers
   */
  async getTopVouchers(limit = 10) {
    try {
      const vouchers = await this.db.all(
        `
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
            `,
        [limit]
      )

      return vouchers
    } catch (error) {
      this.logger.error("Erro ao listar top vouchers:", error)
      return []
    }
  }
}

module.exports = VoucherService
