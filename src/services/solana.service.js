// src/services/solana.service.js
const { 
    Connection, 
    PublicKey, 
    LAMPORTS_PER_SOL, 
    Transaction, 
    SystemProgram,
    sendAndConfirmTransaction,
    ComputeBudgetProgram
} = require('@solana/web3.js');
const { 
    getAssociatedTokenAddress, 
    getAccount, 
    createTransferInstruction,
    createAssociatedTokenAccountInstruction,
    getOrCreateAssociatedTokenAccount,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
} = require('@solana/spl-token');
const Logger = require('../utils/logger'); // ✅ CORRIGIDO: Importar corretamente

class SolanaService {
    constructor() {
        this.connection = null;
        this.donutMint = process.env.DONUT_TOKEN_MINT;
        this.rpcUrl = process.env.SOLANA_RPC_URL;
        this.logger = new Logger('SolanaService'); // ✅ CORRIGIDO: Instanciar logger
    }

    async init() {
        try {
            this.connection = new Connection(this.rpcUrl, {
                commitment: 'confirmed',
                confirmTransactionInitialTimeout: 60000,
            });

            // Testar conexão
            await this.connection.getVersion();
            console.log('✅ Conectado à Solana RPC');

        } catch (error) {
            console.error('❌ Erro ao conectar com Solana:', error);
            throw error;
        }
    }

    /**
     * Obter saldo SOL de uma wallet
     * @param {string} publicKeyStr - Public key da wallet
     * @returns {Promise<number>} - Saldo em lamports
     */
    async getBalance(publicKeyStr) {
        try {
            const publicKey = new PublicKey(publicKeyStr);
            const balance = await this.connection.getBalance(publicKey);
            return balance;

        } catch (error) {
            this.logger.error('Error getting SOL balance', { publicKey: publicKeyStr, error: error.message });
            throw new Error(`Erro ao obter saldo: ${error.message}`);
        }
    }

    /**
     * Obter saldo de token SPL
     * @param {string} publicKeyStr - Public key da wallet
     * @param {string} mintStr - Mint do token
     * @returns {Promise<number>} - Saldo do token
     */
    async getTokenBalance(publicKeyStr, mintStr) {
        try {
            const publicKey = new PublicKey(publicKeyStr);
            const mint = new PublicKey(mintStr);

            // Encontrar conta de token associada
            const tokenAccount = await getAssociatedTokenAddress(mint, publicKey);

            // Verificar se a conta existe
            const accountInfo = await this.connection.getAccountInfo(tokenAccount);
            
            if (!accountInfo) {
                return 0; // Conta não existe, saldo é 0
            }

            // Obter saldo da conta
            const account = await getAccount(this.connection, tokenAccount);
            return Number(account.amount);

        } catch (error) {
            this.logger.error('Error getting token balance', { 
                publicKey: publicKeyStr, 
                mint: mintStr, 
                error: error.message 
            });
            
            // Se der erro, assumir que não tem tokens
            return 0;
        }
    }

    /**
     * Obter saldo DONUT de uma wallet
     * @param {string} publicKeyStr - Public key da wallet
     * @returns {Promise<number>} - Saldo DONUT
     */
    async getDonutBalance(publicKeyStr) {
        if (!this.donutMint) {
            this.logger.warn('DONUT mint not configured');
            return 0;
        }

        return await this.getTokenBalance(publicKeyStr, this.donutMint);
    }

    /**
     * ✅ NOVO: Obter saldos completos (SOL + DONUT)
     * @param {string} publicKeyStr - Public key da wallet
     * @returns {Promise<object>} - Objeto com saldos
     */
    async getCompleteBalance(publicKeyStr) {
        try {
            const [solBalance, donutBalance] = await Promise.all([
                this.getBalance(publicKeyStr),
                this.getDonutBalance(publicKeyStr)
            ]);

            return {
                publicKey: publicKeyStr,
                sol: {
                    lamports: solBalance,
                    amount: this.lamportsToSol(solBalance),
                    formatted: this.formatSOL(solBalance)
                },
                donut: {
                    raw: donutBalance,
                    amount: donutBalance / 1e9, // DONUT tem 9 decimais
                    formatted: this.formatToken(donutBalance / 1e9, 'DONUT')
                },
                lastUpdate: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error('Error getting complete balance', { publicKey: publicKeyStr, error: error.message });
            throw new Error(`Erro ao obter saldos: ${error.message}`);
        }
    }

    /**
     * ✅ NOVO: Enviar SOL
     * @param {object} keypair - Keypair do remetente
     * @param {string} recipientAddress - Endereço do destinatário
     * @param {number} amount - Quantidade em SOL
     * @returns {Promise<object>} - Resultado da transação
     */
    async sendSOL(keypair, recipientAddress, amount) {
        try {
            console.log(`🔄 Enviando ${amount} SOL para ${recipientAddress}`);

            // Validar endereço destinatário
            const recipient = new PublicKey(recipientAddress);

            // Converter SOL para lamports
            const lamports = this.solToLamports(amount);

            // Verificar saldo suficiente (incluindo taxa)
            const senderBalance = await this.getBalance(keypair.publicKey.toString());
            const estimatedFee = 10000; // 0.00001 SOL estimado para taxa
            
            if (senderBalance < lamports + estimatedFee) {
                return {
                    success: false,
                    error: `Saldo insuficiente. Necessário: ${this.lamportsToSol(lamports + estimatedFee)} SOL, Disponível: ${this.lamportsToSol(senderBalance)} SOL`
                };
            }

            // Criar transação
            const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
            
            const transaction = new Transaction({
                recentBlockhash: blockhash,
                feePayer: keypair.publicKey
            });

            // Adicionar instruções de taxa baixa
            transaction.add(
                ComputeBudgetProgram.setComputeUnitLimit({
                    units: 200_000
                })
            );

            transaction.add(
                ComputeBudgetProgram.setComputeUnitPrice({
                    microLamports: 1 // Taxa mínima
                })
            );

            // Adicionar transferência
            transaction.add(
                SystemProgram.transfer({
                    fromPubkey: keypair.publicKey,
                    toPubkey: recipient,
                    lamports: lamports
                })
            );

            // Enviar e confirmar transação
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [keypair],
                {
                    commitment: 'confirmed',
                    preflightCommitment: 'confirmed',
                    maxRetries: 3
                }
            );

            console.log(`✅ SOL enviado! Signature: ${signature}`);

            // Obter detalhes da transação confirmada
            const txDetails = await this.connection.getTransaction(signature, {
                maxSupportedTransactionVersion: 0
            });

            return {
                success: true,
                signature: signature,
                amount: amount,
                token: 'SOL',
                recipient: recipientAddress,
                sender: keypair.publicKey.toString(),
                fee: txDetails?.meta?.fee ? txDetails.meta.fee / LAMPORTS_PER_SOL : 0.00001,
                blockTime: txDetails?.blockTime,
                slot: txDetails?.slot,
                message: `${amount} SOL enviado com sucesso!`
            };

        } catch (error) {
            console.error('❌ Erro ao enviar SOL:', error);
            
            return {
                success: false,
                error: this.parseTransactionError(error),
                details: error.message
            };
        }
    }

    /**
     * ✅ NOVO: Enviar tokens DONUT
     * @param {object} keypair - Keypair do remetente
     * @param {string} recipientAddress - Endereço do destinatário
     * @param {number} amount - Quantidade de DONUT
     * @returns {Promise<object>} - Resultado da transação
     */
    async sendDONUT(keypair, recipientAddress, amount) {
        try {
            if (!this.donutMint) {
                return {
                    success: false,
                    error: 'Token DONUT não configurado no sistema'
                };
            }

            console.log(`🔄 Enviando ${amount} DONUT para ${recipientAddress}`);

            // Validar endereço destinatário
            const recipient = new PublicKey(recipientAddress);
            const mint = new PublicKey(this.donutMint);

            // Converter amount para formato com decimais
            const tokenAmount = Math.floor(amount * 1e9); // DONUT tem 9 decimais

            // Verificar saldo de DONUT suficiente
            const senderTokenBalance = await this.getTokenBalance(keypair.publicKey.toString(), this.donutMint);
            if (senderTokenBalance < tokenAmount) {
                return {
                    success: false,
                    error: `Saldo DONUT insuficiente. Necessário: ${amount} DONUT, Disponível: ${senderTokenBalance / 1e9} DONUT`
                };
            }

            // Verificar saldo SOL para taxa
            const senderSolBalance = await this.getBalance(keypair.publicKey.toString());
            const estimatedFee = 15000; // Taxa estimada para transação de token
            
            if (senderSolBalance < estimatedFee) {
                return {
                    success: false,
                    error: `Saldo SOL insuficiente para taxa. Necessário: ${this.lamportsToSol(estimatedFee)} SOL para taxa`
                };
            }

            // Obter contas de token
            const senderTokenAccount = await getAssociatedTokenAddress(mint, keypair.publicKey);
            const recipientTokenAccount = await getAssociatedTokenAddress(mint, recipient);

            // Verificar se a conta do destinatário existe
            const recipientAccountInfo = await this.connection.getAccountInfo(recipientTokenAccount);

            // Criar transação
            const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
            
            const transaction = new Transaction({
                recentBlockhash: blockhash,
                feePayer: keypair.publicKey
            });

            // Adicionar instruções de taxa
            transaction.add(
                ComputeBudgetProgram.setComputeUnitLimit({
                    units: 300_000 // Mais unidades para tokens
                })
            );

            transaction.add(
                ComputeBudgetProgram.setComputeUnitPrice({
                    microLamports: 1
                })
            );

            // Se a conta do destinatário não existe, criar ela
            if (!recipientAccountInfo) {
                console.log('🔄 Criando conta de token para destinatário...');
                transaction.add(
                    createAssociatedTokenAccountInstruction(
                        keypair.publicKey, // payer
                        recipientTokenAccount, // associated token account
                        recipient, // owner
                        mint // mint
                    )
                );
            }

            // Adicionar transferência de token
            transaction.add(
                createTransferInstruction(
                    senderTokenAccount,
                    recipientTokenAccount,
                    keypair.publicKey,
                    tokenAmount
                )
            );

            // Enviar e confirmar transação
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [keypair],
                {
                    commitment: 'confirmed',
                    preflightCommitment: 'confirmed',
                    maxRetries: 3
                }
            );

            console.log(`✅ DONUT enviado! Signature: ${signature}`);

            // Obter detalhes da transação confirmada
            const txDetails = await this.connection.getTransaction(signature, {
                maxSupportedTransactionVersion: 0
            });

            return {
                success: true,
                signature: signature,
                amount: amount,
                token: 'DONUT',
                recipient: recipientAddress,
                sender: keypair.publicKey.toString(),
                fee: txDetails?.meta?.fee ? txDetails.meta.fee / LAMPORTS_PER_SOL : 0.000015,
                blockTime: txDetails?.blockTime,
                slot: txDetails?.slot,
                createdAccount: !recipientAccountInfo,
                message: `${amount} DONUT enviado com sucesso!`
            };

        } catch (error) {
            console.error('❌ Erro ao enviar DONUT:', error);
            
            return {
                success: false,
                error: this.parseTransactionError(error),
                details: error.message
            };
        }
    }

    /**
     * Calcular taxa estimada para transação
     * @param {string} type - Tipo de transação ('sol' ou 'token')
     * @param {string} recipientAddress - Endereço do destinatário
     * @returns {Promise<object>} - Taxa estimada
     */
    async estimateTransactionFee(type, recipientAddress) {
        try {
            const recipient = new PublicKey(recipientAddress);
            
            if (type === 'sol') {
                // Taxa fixa para transferência SOL
                return {
                    lamports: 10000,
                    sol: 0.00001,
                    formatted: '0.00001 SOL'
                };
            } 
            
            if (type === 'donut' || type === 'token') {
                // Verificar se precisa criar conta de token
                const mint = new PublicKey(this.donutMint);
                const recipientTokenAccount = await getAssociatedTokenAddress(mint, recipient);
                const accountExists = await this.connection.getAccountInfo(recipientTokenAccount);
                
                const baseFee = 10000; // Taxa base
                const createAccountFee = accountExists ? 0 : 2044280; // ~0.002 SOL para criar conta
                
                const totalFee = baseFee + createAccountFee;
                
                return {
                    lamports: totalFee,
                    sol: totalFee / LAMPORTS_PER_SOL,
                    formatted: `${(totalFee / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
                    createAccount: !accountExists,
                    breakdown: {
                        baseFee: baseFee / LAMPORTS_PER_SOL,
                        createAccountFee: createAccountFee / LAMPORTS_PER_SOL
                    }
                };
            }

            return {
                lamports: 10000,
                sol: 0.00001,
                formatted: '0.00001 SOL'
            };

        } catch (error) {
            console.error('❌ Erro ao calcular taxa:', error);
            return {
                lamports: 15000,
                sol: 0.000015,
                formatted: '0.000015 SOL (estimativa)',
                error: true
            };
        }
    }

    /**
     * Validar se endereço tem saldo suficiente
     * @param {string} publicKeyStr - Endereço da wallet
     * @param {string} tokenType - Tipo do token ('SOL' ou 'DONUT')
     * @param {number} amount - Quantidade a enviar
     * @returns {Promise<object>} - Resultado da validação
     */
    async validateSufficientBalance(publicKeyStr, tokenType, amount) {
        try {
            if (tokenType === 'SOL') {
                const balance = await this.getBalance(publicKeyStr);
                const lamportsNeeded = this.solToLamports(amount);
                const fee = 10000; // Taxa estimada
                const totalNeeded = lamportsNeeded + fee;
                
                return {
                    sufficient: balance >= totalNeeded,
                    available: this.lamportsToSol(balance),
                    needed: this.lamportsToSol(totalNeeded),
                    fee: this.lamportsToSol(fee)
                };
            }
            
            if (tokenType === 'DONUT') {
                const [tokenBalance, solBalance] = await Promise.all([
                    this.getTokenBalance(publicKeyStr, this.donutMint),
                    this.getBalance(publicKeyStr)
                ]);
                
                const tokenAmountNeeded = amount * 1e9; // DONUT tem 9 decimais
                const fee = 15000; // Taxa estimada para token
                
                return {
                    sufficient: tokenBalance >= tokenAmountNeeded && solBalance >= fee,
                    availableToken: tokenBalance / 1e9,
                    availableSol: this.lamportsToSol(solBalance),
                    neededToken: amount,
                    neededSol: this.lamportsToSol(fee)
                };
            }

            return { sufficient: false, error: 'Tipo de token não suportado' };

        } catch (error) {
            console.error('❌ Erro ao validar saldo:', error);
            return { 
                sufficient: false, 
                error: 'Erro ao verificar saldo' 
            };
        }
    }

    /**
     * ✅ NOVO: Parsing de erros de transação
     */
    parseTransactionError(error) {
        const message = error.message.toLowerCase();
        
        if (message.includes('insufficient funds')) {
            return 'Saldo insuficiente para completar a transação';
        }
        if (message.includes('invalid account')) {
            return 'Endereço de destino inválido';
        }
        if (message.includes('timeout')) {
            return 'Transação expirou. Tente novamente em alguns segundos';
        }
        if (message.includes('blockhash not found')) {
            return 'Erro de rede. Tente novamente em alguns segundos';
        }
        if (message.includes('transaction too large')) {
            return 'Transação muito complexa. Tente um valor menor';
        }
        
        return 'Erro na transação. Verifique os dados e tente novamente';
    }

    /**
     * Converter lamports para SOL
     * @param {number} lamports - Valor em lamports
     * @returns {number} - Valor em SOL
     */
    lamportsToSol(lamports) {
        return lamports / LAMPORTS_PER_SOL;
    }

    /**
     * Converter SOL para lamports
     * @param {number} sol - Valor em SOL
     * @returns {number} - Valor em lamports
     */
    solToLamports(sol) {
        return Math.floor(sol * LAMPORTS_PER_SOL);
    }

    /**
     *  Formatação para exibição
     */
    formatSOL(lamports) {
        const sol = this.lamportsToSol(lamports);
        return `${sol.toFixed(4)} SOL`;
    }

    formatToken(amount, symbol = 'DONUT') {
        return `${amount.toFixed(2)} ${symbol}`;
    }

    /**
     * Obter valor em USD aproximado baseado em preço fixo
     * @param {number} lamports - Valor em lamports
     * @param {number} solPriceUSD - Preço do SOL em USD (padrão: 100)
     * @returns {number} - Valor estimado em USD
     */
    getUSDValue(lamports, solPriceUSD = 100) {
        const sol = this.lamportsToSol(lamports);
        return sol * solPriceUSD;
    }

    /**
     * Verificar se um endereço é válido
     * @param {string} address - Endereço para verificar
     * @returns {boolean} - True se é válido
     */
    isValidAddress(address) {
        try {
            new PublicKey(address);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Obter informações da conta
     * @param {string} publicKeyStr - Public key da conta
     * @returns {Promise<object>} - Informações da conta
     */
    async getAccountInfo(publicKeyStr) {
        try {
            const publicKey = new PublicKey(publicKeyStr);
            const accountInfo = await this.connection.getAccountInfo(publicKey);

            return {
                exists: accountInfo !== null,
                lamports: accountInfo ? accountInfo.lamports : 0,
                owner: accountInfo ? accountInfo.owner.toString() : null,
                executable: accountInfo ? accountInfo.executable : false,
                rentEpoch: accountInfo ? accountInfo.rentEpoch : null
            };

        } catch (error) {
            this.logger.error('Error getting account info', { publicKey: publicKeyStr, error: error.message });
            throw new Error(`Erro ao obter informações da conta: ${error.message}`);
        }
    }

    /**
     * Obter transações recentes de uma wallet
     * @param {string} publicKeyStr - Public key da wallet
     * @param {number} limit - Limite de transações (padrão: 10)
     * @returns {Promise<Array>} - Lista de transações
     */
    async getRecentTransactions(publicKeyStr, limit = 10) {
        try {
            const publicKey = new PublicKey(publicKeyStr);
            
            const signatures = await this.connection.getSignaturesForAddress(
                publicKey,
                { limit }
            );

            const transactions = [];

            for (const sigInfo of signatures) {
                try {
                    const tx = await this.connection.getTransaction(sigInfo.signature, {
                        maxSupportedTransactionVersion: 0
                    });

                    if (tx) {
                        transactions.push({
                            signature: sigInfo.signature,
                            slot: sigInfo.slot,
                            blockTime: sigInfo.blockTime,
                            confirmationStatus: sigInfo.confirmationStatus,
                            fee: tx.meta?.fee || 0,
                            success: !tx.meta?.err,
                            error: tx.meta?.err
                        });
                    }
                } catch (txError) {
                    this.logger.warn('Error fetching transaction details', { 
                        signature: sigInfo.signature, 
                        error: txError.message 
                    });
                }
            }

            return transactions;

        } catch (error) {
            this.logger.error('Error getting recent transactions', { 
                publicKey: publicKeyStr, 
                error: error.message 
            });
            throw new Error(`Erro ao obter transações: ${error.message}`);
        }
    }

    /**
     * Monitorar mudanças em uma conta
     * @param {string} publicKeyStr - Public key para monitorar
     * @param {function} callback - Função para chamar em mudanças
     * @returns {number} - ID da subscription
     */
    async subscribeToAccount(publicKeyStr, callback) {
        try {
            const publicKey = new PublicKey(publicKeyStr);
            
            const subscriptionId = this.connection.onAccountChange(
                publicKey,
                (accountInfo, context) => {
                    callback({
                        publicKey: publicKeyStr,
                        lamports: accountInfo.lamports,
                        owner: accountInfo.owner.toString(),
                        slot: context.slot
                    });
                },
                'confirmed'
            );

            this.logger.info('Account subscription created', { publicKey: publicKeyStr, subscriptionId });
            return subscriptionId;

        } catch (error) {
            this.logger.error('Error creating account subscription', { 
                publicKey: publicKeyStr, 
                error: error.message 
            });
            throw new Error(`Erro ao criar subscription: ${error.message}`);
        }
    }

    /**
     * Remover subscription de conta
     * @param {number} subscriptionId - ID da subscription
     */
    async unsubscribeFromAccount(subscriptionId) {
        try {
            await this.connection.removeAccountChangeListener(subscriptionId);
            this.logger.info('Account subscription removed', { subscriptionId });
        } catch (error) {
            this.logger.error('Error removing account subscription', { 
                subscriptionId, 
                error: error.message 
            });
        }
    }

    /**
     * Verificar se a conexão RPC está funcionando
     * @returns {Promise<boolean>} - True se está funcionando
     */
    async isHealthy() {
        try {
            await this.connection.getVersion();
            return true;
        } catch (error) {
            this.logger.error('RPC health check failed', { error: error.message });
            return false;
        }
    }
}

module.exports = SolanaService;