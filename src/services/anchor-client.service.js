// src/services/anchor-client.service.js
const { 
    Connection, 
    PublicKey, 
    Transaction,
    SystemProgram,
    LAMPORTS_PER_SOL,
    sendAndConfirmTransaction,
    ComputeBudgetProgram,
    Keypair
} = require('@solana/web3.js');
const { 
    Program, 
    AnchorProvider, 
    web3, 
    BN 
} = require('@coral-xyz/anchor');
const { 
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction
} = require('@solana/spl-token');
const NodeWallet = require('@coral-xyz/anchor/dist/cjs/nodewallet').default;
const Logger = require('../utils/logger');
const config = require('../config/solana-programs.config');

class AnchorClientService {
    constructor() {
        this.logger = new Logger('AnchorClientService');
        this.connection = new Connection(config.RPC_URL, {
            commitment: 'confirmed',
            confirmTransactionInitialTimeout: 60000
        });
        
        // Programas Anchor
        this.matrixProgram = null;
        this.airdropProgram = null;
        
        // Cache de contas
        this.accountCache = new Map();
        this.cacheTimeout = 30000; // 30 segundos
        
        // Flag de inicialização
        this.initialized = false;
    }

    /**
     * Inicializar programas Anchor
     */
    async initialize(wallet = null) {
        try {
            // Se já está inicializado e não está forçando reinicialização
            if (this.initialized && !wallet) return true;

            // Provider sem wallet (somente leitura por padrão)
            const defaultWallet = wallet || new NodeWallet(Keypair.generate());
            
            const provider = new AnchorProvider(
                this.connection,
                defaultWallet,
                { commitment: 'confirmed' }
            );

            // Inicializar programa da matriz
            this.logger.info(`Inicializando programa Matrix com ID: ${config.PROGRAM_IDS.MATRIX.toString()}`);
            this.matrixProgram = new Program(
                config.MATRIX_IDL,
                config.PROGRAM_IDS.MATRIX,
                provider
            );

            // Inicializar programa do airdrop
            this.logger.info(`Inicializando programa Airdrop com ID: ${config.PROGRAM_IDS.AIRDROP.toString()}`);
            this.airdropProgram = new Program(
                config.AIRDROP_IDL,
                config.PROGRAM_IDS.AIRDROP,
                provider
            );

            this.initialized = true;
            this.logger.info('Programas Anchor inicializados');
            return true;
        } catch (error) {
            this.logger.error('Erro ao inicializar programas:', error);
            throw error;
        }
    }

    /**
     * Obter conta de usuário da matriz
     */
    async getUserAccount(walletAddress) {
        try {
            await this.initialize();
            
            const userPubkey = new PublicKey(walletAddress);
            
            // Derivar PDA do usuário
            const [userPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('user'), userPubkey.toBuffer()],
                this.matrixProgram.programId
            );

            // Verificar cache
            const cacheKey = `user_${userPDA.toString()}`;
            const cached = this.getCached(cacheKey);
            if (cached) return cached;

            // Buscar conta na blockchain
            // Tentar diferentes nomes possíveis de conta
            let account = null;
            const possibleAccountNames = ['userAccount', 'user', 'userState'];
            
            for (const accountName of possibleAccountNames) {
                try {
                    if (this.matrixProgram.account[accountName]) {
                        account = await this.matrixProgram.account[accountName].fetchNullable(userPDA);
                        if (account) {
                            this.logger.debug(`Conta encontrada usando: ${accountName}`);
                            break;
                        }
                    }
                } catch (e) {
                    // Continuar tentando
                }
            }
            
            if (account) {
                const result = {
                    exists: true,
                    pda: userPDA,
                    data: {
                        isRegistered: account.isRegistered !== undefined ? account.isRegistered : true,
                        referrer: account.referrer?.toString() || null,
                        ownerWallet: account.ownerWallet?.toString() || account.user?.toString() || walletAddress,
                        slots: account.chain?.slots || account.slots || [],
                        filledSlots: account.chain?.filledSlots || account.filledSlots || this.countFilledSlots(account),
                        reservedSol: account.reservedSol?.toNumber() || 0,
                        upline: account.upline || null
                    }
                };
                
                this.setCache(cacheKey, result);
                return result;
            }

            return { exists: false, pda: userPDA };
        } catch (error) {
            this.logger.error('Erro ao obter conta de usuário:', error);
            return { exists: false, error: error.message };
        }
    }

    /**
     * Verificar slots disponíveis do referenciador
     */
    async checkReferrerSlots(referrerAddress) {
        try {
            await this.initialize();
            
            const account = await this.getUserAccount(referrerAddress);
            
            if (!account.exists) {
                return {
                    isRegistered: false,
                    availableSlot: null,
                    message: 'Referenciador não está registrado na matriz'
                };
            }

            const filledSlots = account.data.filledSlots || 0;
            
            // Matriz 3x1 - máximo 3 slots
            if (filledSlots >= 3) {
                return {
                    isRegistered: true,
                    availableSlot: null,
                    filledSlots: 3,
                    message: 'Matriz do referenciador está completa (será reiniciada automaticamente)'
                };
            }

            return {
                isRegistered: true,
                availableSlot: filledSlots, // 0, 1 ou 2
                filledSlots: filledSlots,
                slots: account.data.slots,
                message: `Slot ${filledSlots + 1} disponível`
            };
        } catch (error) {
            this.logger.error('Erro ao verificar slots:', error);
            throw error;
        }
    }

    /**
     * Criar e popular Address Lookup Table
     */
    async createAndPopulateLookupTable(userKeypair, addresses) {
        try {
            const slot = await this.connection.getSlot();
            
            // Criar lookup table
            const [lookupTableInstruction, lookupTableAddress] = 
                web3.AddressLookupTableProgram.createLookupTable({
                    authority: userKeypair.publicKey,
                    payer: userKeypair.publicKey,
                    recentSlot: slot - 1
                });

            // Criar transação para criar a lookup table
            const createLutTx = new Transaction().add(lookupTableInstruction);
            const createSignature = await sendAndConfirmTransaction(
                this.connection, 
                createLutTx, 
                [userKeypair],
                { commitment: 'confirmed' }
            );

            this.logger.info(`Lookup table criada: ${lookupTableAddress.toString()}`);

            // Popular em batches de 20
            const BATCH_SIZE = 20;
            for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
                const batch = addresses.slice(i, i + BATCH_SIZE);
                
                const extendInstruction = web3.AddressLookupTableProgram.extendLookupTable({
                    payer: userKeypair.publicKey,
                    authority: userKeypair.publicKey,
                    lookupTable: lookupTableAddress,
                    addresses: batch
                });

                const extendTx = new Transaction().add(extendInstruction);
                await sendAndConfirmTransaction(
                    this.connection, 
                    extendTx, 
                    [userKeypair],
                    { commitment: 'confirmed' }
                );

                this.logger.info(`Adicionados ${batch.length} endereços à lookup table`);
            }

            // Aguardar ativação da lookup table
            await new Promise(resolve => setTimeout(resolve, 1000));

            return lookupTableAddress;

        } catch (error) {
            this.logger.error('Erro ao criar lookup table:', error);
            throw error;
        }
    }

    /**
     * Criar todas as transações preparatórias (ATAs, Airdrop, LUT)
     */
    async createPreparatoryTransactions(userKeypair, referrerAddress) {
        const transactions = [];
        
        try {
            await this.initialize();
            
            // 1. Verificar e criar ATAs
            const userWsolAccount = await getAssociatedTokenAddress(
                config.TOKEN_CONFIG.WSOL_MINT,
                userKeypair.publicKey
            );

            const userDonutAccount = await getAssociatedTokenAddress(
                config.TOKEN_CONFIG.DONUT_MINT,
                userKeypair.publicKey
            );

            const tx1 = new Transaction();
            let needsATAs = false;

            const wsolAccountInfo = await this.connection.getAccountInfo(userWsolAccount);
            if (!wsolAccountInfo) {
                tx1.add(
                    createAssociatedTokenAccountInstruction(
                        userKeypair.publicKey,
                        userWsolAccount,
                        userKeypair.publicKey,
                        config.TOKEN_CONFIG.WSOL_MINT
                    )
                );
                needsATAs = true;
            }

            const donutAccountInfo = await this.connection.getAccountInfo(userDonutAccount);
            if (!donutAccountInfo) {
                tx1.add(
                    createAssociatedTokenAccountInstruction(
                        userKeypair.publicKey,
                        userDonutAccount,
                        userKeypair.publicKey,
                        config.TOKEN_CONFIG.DONUT_MINT
                    )
                );
                needsATAs = true;
            }

            if (needsATAs) {
                transactions.push({
                    name: 'Create ATAs',
                    transaction: tx1
                });
            }

            // 2. Registrar no Airdrop se necessário
            const [airdropUserPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('user'), userKeypair.publicKey.toBuffer()],
                this.airdropProgram.programId
            );

            // Tentar buscar conta do airdrop
            let airdropAccount = null;
            const possibleAirdropNames = ['userAccount', 'user', 'airdropUser'];
            
            for (const accountName of possibleAirdropNames) {
                try {
                    if (this.airdropProgram.account[accountName]) {
                        airdropAccount = await this.airdropProgram.account[accountName].fetchNullable(airdropUserPDA);
                        if (airdropAccount !== null) break;
                    }
                } catch (e) {
                    // Continuar
                }
            }

            if (!airdropAccount) {
                const tx2 = new Transaction();
                
                // Tentar diferentes métodos de registro
                const possibleMethods = ['registerUser', 'register', 'createUser'];
                let registerInstruction = null;
                
                for (const methodName of possibleMethods) {
                    try {
                        if (this.airdropProgram.methods[methodName]) {
                            registerInstruction = await this.airdropProgram.methods[methodName]()
                                .accounts({
                                    programState: config.AIRDROP_CONFIG.PROGRAM_STATE,
                                    userWallet: userKeypair.publicKey,
                                    userAccount: airdropUserPDA,
                                    systemProgram: SystemProgram.programId
                                })
                                .instruction();
                            break;
                        }
                    } catch (e) {
                        // Continuar
                    }
                }
                
                if (registerInstruction) {
                    tx2.add(registerInstruction);
                    transactions.push({
                        name: 'Register Airdrop',
                        transaction: tx2
                    });
                }
            }

            // 3. Verificar slot do referenciador para determinar uplines necessárias
            const referrerPubkey = new PublicKey(referrerAddress);
            const referrerAccount = await this.getUserAccount(referrerAddress);
            
            // 4. Coletar TODOS os endereços necessários para a lookup table
            const lookupAddresses = [];
            
            // Endereços básicos sempre necessários
            lookupAddresses.push(
                // Contas principais
                config.MATRIX_CONFIG.STATE_ADDRESS,
                userKeypair.publicKey,
                referrerPubkey,
                
                // PDAs
                await this.getUserPDA(userKeypair.publicKey),
                await this.getUserPDA(referrerPubkey),
                
                // Token accounts
                userWsolAccount,
                userDonutAccount,
                
                // Mints
                config.TOKEN_CONFIG.WSOL_MINT,
                config.TOKEN_CONFIG.DONUT_MINT,
                
                // Meteora Pool
                config.METEORA_CONFIG.POOL,
                config.METEORA_CONFIG.B_VAULT,
                config.METEORA_CONFIG.B_TOKEN_VAULT,
                config.METEORA_CONFIG.B_VAULT_LP_MINT,
                config.METEORA_CONFIG.B_VAULT_LP,
                
                // Program accounts
                config.MATRIX_CONFIG.PROGRAM_SOL_VAULT,
                config.METEORA_CONFIG.PROTOCOL_TOKEN_FEE,
                
                // Programs
                config.METEORA_CONFIG.VAULT_PROGRAM,
                config.METEORA_CONFIG.AMM_PROGRAM,
                TOKEN_PROGRAM_ID,
                SystemProgram.programId,
                ASSOCIATED_TOKEN_PROGRAM_ID,
                web3.SYSVAR_RENT_PUBKEY
            );

            // 5. Adicionar uplines se for slot 2 (índice 2 = terceiro slot)
            const remainingAccounts = [];
            
            if (referrerAccount.exists && referrerAccount.data.filledSlots === 2) {
                this.logger.info('Slot 3 detectado - coletando uplines para recursividade');
                
                // Buscar uplines do referenciador
                if (referrerAccount.data.upline && referrerAccount.data.upline.upline) {
                    const uplines = referrerAccount.data.upline.upline;
                    
                    // Adicionar uplines aos endereços da lookup table
                    for (const uplineEntry of uplines) {
                        lookupAddresses.push(uplineEntry.pda);
                        lookupAddresses.push(uplineEntry.wallet);
                        
                        // Também adicionar aos remaining accounts para a instrução
                        remainingAccounts.push({
                            pubkey: uplineEntry.pda,
                            isWritable: true,
                            isSigner: false
                        });
                        remainingAccounts.push({
                            pubkey: uplineEntry.wallet,
                            isWritable: true,
                            isSigner: false
                        });
                    }
                    
                    this.logger.info(`Adicionados ${uplines.length} uplines para recursividade`);
                }
            }

            // 6. Adicionar ATAs do referenciador se necessário
            const referrerWsolAccount = await getAssociatedTokenAddress(
                config.TOKEN_CONFIG.WSOL_MINT,
                referrerPubkey
            );
            lookupAddresses.push(referrerWsolAccount);

            return {
                preparatoryTransactions: transactions,
                lookupAddresses: lookupAddresses,
                userWsolAccount,
                userDonutAccount,
                remainingAccounts,
                slotIndex: referrerAccount.exists ? referrerAccount.data.filledSlots : 0
            };

        } catch (error) {
            this.logger.error('Erro ao criar transações preparatórias:', error);
            throw error;
        }
    }
    
    /**
     * Helper para obter PDA do usuário
     */
    async getUserPDA(walletPubkey) {
        const [pda] = await PublicKey.findProgramAddress(
            [Buffer.from('user'), walletPubkey.toBuffer()],
            this.matrixProgram.programId
        );
        return pda;
    }

    /**
     * Criar transação de registro na matriz (versão corrigida)
     */
    async createRegistrationTransaction(userKeypair, referrerAddress, amountUSD = 10.3) {
        try {
            await this.initialize();
            
            this.logger.info(`Criando transação de registro: user=${userKeypair.publicKey.toString()}, referrer=${referrerAddress}, amount=${amountUSD}`);

            // Obter preço atual do SOL
            const solPrice = await this.getSolPrice();
            const amountInSol = amountUSD / solPrice;
            const amountInLamports = new BN(Math.floor(amountInSol * LAMPORTS_PER_SOL));

            this.logger.info(`Preço SOL: ${solPrice}, Amount: ${amountInSol} SOL (${amountInLamports.toString()} lamports)`);

            // Verificar saldo
            const balance = await this.connection.getBalance(userKeypair.publicKey);
            const requiredBalance = amountInLamports.toNumber() + 0.01 * LAMPORTS_PER_SOL; // +0.01 SOL para taxas
            
            if (balance < requiredBalance) {
                throw new Error(`Saldo insuficiente. Necessário: ${(requiredBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL, Disponível: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
            }

            // Derivar PDAs necessárias
            const [userPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('user'), userKeypair.publicKey.toBuffer()],
                this.matrixProgram.programId
            );

            const referrerPubkey = new PublicKey(referrerAddress);
            const [referrerPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('user'), referrerPubkey.toBuffer()],
                this.matrixProgram.programId
            );

            // Obter ATAs (já devem existir das transações preparatórias)
            const userWsolAccount = await getAssociatedTokenAddress(
                config.TOKEN_CONFIG.WSOL_MINT,
                userKeypair.publicKey
            );

            const userDonutAccount = await getAssociatedTokenAddress(
                config.TOKEN_CONFIG.DONUT_MINT,
                userKeypair.publicKey
            );

            // Criar transação principal
            const transaction = new Transaction();

            // Adicionar compute budget
            transaction.add(
                ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })
            );

            // Contas para a instrução de registro
            const accounts = {
                state: config.MATRIX_CONFIG.STATE_ADDRESS,
                userWallet: userKeypair.publicKey,
                referrer: referrerPDA,
                referrerWallet: referrerPubkey,
                user: userPDA,
                userWsolAccount: userWsolAccount,
                userDonutAccount: userDonutAccount,
                wsolMint: config.TOKEN_CONFIG.WSOL_MINT,
                pool: config.METEORA_CONFIG.POOL,
                bVault: config.METEORA_CONFIG.B_VAULT,
                bTokenVault: config.METEORA_CONFIG.B_TOKEN_VAULT,
                bVaultLpMint: config.METEORA_CONFIG.B_VAULT_LP_MINT,
                bVaultLp: config.METEORA_CONFIG.B_VAULT_LP,
                vaultProgram: config.METEORA_CONFIG.VAULT_PROGRAM,
                programSolVault: config.MATRIX_CONFIG.PROGRAM_SOL_VAULT,
                tokenMint: config.TOKEN_CONFIG.DONUT_MINT,
                protocolTokenFee: config.METEORA_CONFIG.PROTOCOL_TOKEN_FEE,
                ammProgram: config.METEORA_CONFIG.AMM_PROGRAM,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                rent: web3.SYSVAR_RENT_PUBKEY
            };

            // Adicionar remaining accounts para uplines (se slot 3)
            const referrerAccount = await this.getUserAccount(referrerAddress);
            const remainingAccounts = [];
            
            if (referrerAccount.exists && referrerAccount.data.filledSlots === 2) {
                // Slot 3 - precisa dos uplines para distribuição
                if (referrerAccount.data.upline && referrerAccount.data.upline.upline) {
                    for (const uplineEntry of referrerAccount.data.upline.upline) {
                        remainingAccounts.push({
                            pubkey: uplineEntry.pda,
                            isWritable: true,
                            isSigner: false
                        });
                        remainingAccounts.push({
                            pubkey: uplineEntry.wallet,
                            isWritable: true,
                            isSigner: false
                        });
                    }
                }
            }

            // Tentar diferentes métodos de registro
            let instruction = null;
            const possibleMethods = ['registerWithSolDeposit', 'register', 'registerUser', 'createUser'];
            
            for (const methodName of possibleMethods) {
                try {
                    if (this.matrixProgram.methods[methodName]) {
                        this.logger.info(`Usando método: ${methodName}`);
                        
                        if (methodName === 'registerWithSolDeposit') {
                            instruction = await this.matrixProgram.methods[methodName](amountInLamports)
                                .accounts(accounts)
                                .remainingAccounts(remainingAccounts)
                                .instruction();
                        } else {
                            instruction = await this.matrixProgram.methods[methodName]()
                                .accounts(accounts)
                                .remainingAccounts(remainingAccounts)
                                .instruction();
                        }
                        break;
                    }
                } catch (e) {
                    this.logger.debug(`Método ${methodName} não disponível`);
                }
            }

            if (!instruction) {
                throw new Error('Nenhum método de registro encontrado no programa');
            }

            transaction.add(instruction);

            return {
                transaction,
                userPDA,
                referrerPDA,
                amountSol: amountInSol,
                amountLamports: amountInLamports.toString(),
                slotOccupied: referrerAccount.exists ? referrerAccount.data.filledSlots : 0
            };

        } catch (error) {
            this.logger.error('Erro ao criar transação de registro:', error);
            throw error;
        }
    }

    /**
     * Executar registro completo na matriz (com transações preparatórias)
     */
    async executeRegistration(userKeypair, referrerAddress, amountUSD = 10.3) {
        try {
            await this.initialize();
            
            this.logger.info('=== INICIANDO REGISTRO NA MATRIZ ===');
            
            // 1. Criar transações preparatórias e coletar informações
            const { 
                preparatoryTransactions, 
                lookupAddresses,
                remainingAccounts,
                slotIndex
            } = await this.createPreparatoryTransactions(userKeypair, referrerAddress);

            this.logger.info(`Usuário ocupará slot ${slotIndex} (0-indexed)`);

            // 2. Executar transações preparatórias
            for (const { name, transaction } of preparatoryTransactions) {
                this.logger.info(`Executando: ${name}`);
                
                const { blockhash } = await this.connection.getLatestBlockhash();
                transaction.recentBlockhash = blockhash;
                transaction.feePayer = userKeypair.publicKey;
                
                const signature = await sendAndConfirmTransaction(
                    this.connection,
                    transaction,
                    [userKeypair],
                    { commitment: 'confirmed' }
                );
                
                this.logger.info(`${name} confirmado: ${signature}`);
                
                // Pequeno delay entre transações
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // 3. Criar e popular lookup table com TODOS os endereços
            let lookupTableAddress = null;
            if (lookupAddresses.length > 0) {
                this.logger.info(`Criando Address Lookup Table com ${lookupAddresses.length} endereços...`);
                lookupTableAddress = await this.createAndPopulateLookupTable(
                    userKeypair, 
                    lookupAddresses
                );
                
                // Aguardar ativação da lookup table
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // 4. Criar transação principal de registro
            const { 
                transaction: mainTransaction, 
                amountSol
            } = await this.createRegistrationTransactionWithRemainingAccounts(
                userKeypair,
                referrerAddress,
                amountUSD,
                remainingAccounts,
                slotIndex
            );

            // 5. Adicionar lookup table à transação se criada
            if (lookupTableAddress) {
                const lookupTableAccount = await this.connection.getAddressLookupTable(lookupTableAddress);
                if (lookupTableAccount.value) {
                    mainTransaction.addressLookupTableAccounts = [lookupTableAccount.value];
                    this.logger.info('Lookup table adicionada à transação principal');
                }
            }

            // 6. Executar transação principal
            this.logger.info('Executando registro principal na matriz...');
            const { blockhash } = await this.connection.getLatestBlockhash();
            mainTransaction.recentBlockhash = blockhash;
            mainTransaction.feePayer = userKeypair.publicKey;

            const signature = await sendAndConfirmTransaction(
                this.connection,
                mainTransaction,
                [userKeypair],
                {
                    commitment: 'confirmed',
                    maxRetries: 3,
                    preflightCommitment: 'confirmed'
                }
            );

            this.logger.info(`✅ REGISTRO CONFIRMADO: ${signature}`);
            this.logger.info(`Slot ocupado: ${slotIndex} (${this.getSlotBehaviorDescription(slotIndex)})`);

            // Limpar cache
            this.clearCache();

            return {
                success: true,
                signature,
                amountSol,
                slotOccupied: slotIndex,
                explorerUrl: `https://solscan.io/tx/${signature}`
            };

        } catch (error) {
            this.logger.error('❌ Erro ao executar registro:', error);
            
            // Parse melhor do erro
            let errorMessage = 'Erro ao registrar na blockchain';
            if (error.message) {
                if (error.message.includes('insufficient')) {
                    errorMessage = 'Saldo insuficiente para a transação';
                } else if (error.message.includes('already registered')) {
                    errorMessage = 'Usuário já está registrado na matriz';
                } else if (error.message.includes('slots filled')) {
                    errorMessage = 'Todos os slots do referenciador estão ocupados';
                } else {
                    errorMessage = error.message;
                }
            }
            
            return {
                success: false,
                error: errorMessage
            };
        }
    }

    /**
     * Criar transação de registro com remaining accounts
     */
    async createRegistrationTransactionWithRemainingAccounts(userKeypair, referrerAddress, amountUSD, remainingAccounts, slotIndex) {
        try {
            await this.initialize();
            
            // Obter preço atual do SOL
            const solPrice = await this.getSolPrice();
            const amountInSol = amountUSD / solPrice;
            const amountInLamports = new BN(Math.floor(amountInSol * LAMPORTS_PER_SOL));

            this.logger.info(`Valor: $${amountUSD} = ${amountInSol} SOL = ${amountInLamports.toString()} lamports`);

            // Verificar saldo
            const balance = await this.connection.getBalance(userKeypair.publicKey);
            const requiredBalance = amountInLamports.toNumber() + 0.01 * LAMPORTS_PER_SOL; // +0.01 SOL para taxas
            
            if (balance < requiredBalance) {
                throw new Error(`Saldo insuficiente. Necessário: ${(requiredBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL, Disponível: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
            }

            // Derivar PDAs necessárias
            const [userPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('user'), userKeypair.publicKey.toBuffer()],
                this.matrixProgram.programId
            );

            const referrerPubkey = new PublicKey(referrerAddress);
            const [referrerPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('user'), referrerPubkey.toBuffer()],
                this.matrixProgram.programId
            );

            // Obter ATAs (já devem existir das transações preparatórias)
            const userWsolAccount = await getAssociatedTokenAddress(
                config.TOKEN_CONFIG.WSOL_MINT,
                userKeypair.publicKey
            );

            const userDonutAccount = await getAssociatedTokenAddress(
                config.TOKEN_CONFIG.DONUT_MINT,
                userKeypair.publicKey
            );

            // Criar transação principal
            const transaction = new Transaction();

            // Adicionar compute budget (importante para slot 3 com recursividade)
            const computeUnits = slotIndex === 2 ? 600000 : 400000; // Mais units para slot 3
            transaction.add(
                ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })
            );

            // Contas para a instrução de registro
            const accounts = {
                state: config.MATRIX_CONFIG.STATE_ADDRESS,
                userWallet: userKeypair.publicKey,
                referrer: referrerPDA,
                referrerWallet: referrerPubkey,
                user: userPDA,
                userWsolAccount: userWsolAccount,
                userDonutAccount: userDonutAccount,
                wsolMint: config.TOKEN_CONFIG.WSOL_MINT,
                pool: config.METEORA_CONFIG.POOL,
                bVault: config.METEORA_CONFIG.B_VAULT,
                bTokenVault: config.METEORA_CONFIG.B_TOKEN_VAULT,
                bVaultLpMint: config.METEORA_CONFIG.B_VAULT_LP_MINT,
                bVaultLp: config.METEORA_CONFIG.B_VAULT_LP,
                vaultProgram: config.METEORA_CONFIG.VAULT_PROGRAM,
                programSolVault: config.MATRIX_CONFIG.PROGRAM_SOL_VAULT,
                tokenMint: config.TOKEN_CONFIG.DONUT_MINT,
                protocolTokenFee: config.METEORA_CONFIG.PROTOCOL_TOKEN_FEE,
                ammProgram: config.METEORA_CONFIG.AMM_PROGRAM,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                rent: web3.SYSVAR_RENT_PUBKEY
            };

            // Criar instrução com remaining accounts (se slot 3)
            let instruction = null;
            const possibleMethods = ['registerWithSolDeposit', 'register', 'registerUser'];
            
            for (const methodName of possibleMethods) {
                try {
                    if (this.matrixProgram.methods[methodName]) {
                        if (methodName === 'registerWithSolDeposit') {
                            instruction = await this.matrixProgram.methods[methodName](amountInLamports)
                                .accounts(accounts)
                                .remainingAccounts(remainingAccounts)
                                .instruction();
                        } else {
                            instruction = await this.matrixProgram.methods[methodName]()
                                .accounts(accounts)
                                .remainingAccounts(remainingAccounts)
                                .instruction();
                        }
                        this.logger.info(`Usando método: ${methodName}`);
                        break;
                    }
                } catch (e) {
                    // Continuar tentando
                }
            }

            if (!instruction) {
                throw new Error('Método de registro não encontrado no programa');
            }

            transaction.add(instruction);

            return {
                transaction,
                amountSol: amountInSol
            };

        } catch (error) {
            this.logger.error('Erro ao criar transação de registro:', error);
            throw error;
        }
    }

    /**
     * Helper para descrever comportamento do slot
     */
    getSlotBehaviorDescription(slotIndex) {
        const behaviors = {
            0: 'Slot 1 - Swap para DONUT e burn 100%',
            1: 'Slot 2 - SOL reservado para referenciador',
            2: 'Slot 3 - Pagamento com distribuição recursiva'
        };
        return behaviors[slotIndex] || 'Comportamento desconhecido';
    }

    /**
     * Obter preço atual do SOL via Chainlink
     */
    async getSolPrice() {
        try {
            // Cache de preço por 10 segundos
            const cached = this.getCached('sol_price', 10000);
            if (cached) return cached;

            // Buscar do feed Chainlink
            const feedAccount = await this.connection.getAccountInfo(
                config.CHAINLINK_CONFIG.SOL_USD_FEED
            );

            if (feedAccount && feedAccount.data) {
                // Parse do formato Chainlink (simplificado)
                // Os primeiros 8 bytes após os metadados contêm o preço
                const data = feedAccount.data;
                const price = data.readBigInt64LE(64) / 100000000; // 8 decimais
                
                if (price > 0) {
                    this.setCache('sol_price', price, 10000);
                    return price;
                }
            }
        } catch (error) {
            this.logger.warn('Erro ao obter preço do Chainlink:', error);
        }

        // Fallback para API externa se Chainlink falhar
        try {
            const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
            const data = await response.json();
            const price = data.solana.usd;
            
            this.setCache('sol_price', price, 10000);
            return price;
        } catch (error) {
            this.logger.error('Erro ao obter preço do SOL:', error);
            // Preço fallback
            return 180; // Valor seguro para evitar erros
        }
    }

    /**
     * Contar slots preenchidos
     */
    countFilledSlots(account) {
        let count = 0;
        const defaultKey = PublicKey.default.toString();
        
        // Verificar estrutura de slots
        if (account.slots && Array.isArray(account.slots)) {
            for (const slot of account.slots) {
                if (slot && slot.toString() !== defaultKey) count++;
            }
        } else {
            // Slots individuais
            if (account.slot1 && account.slot1.toString() !== defaultKey) count++;
            if (account.slot2 && account.slot2.toString() !== defaultKey) count++;
            if (account.slot3 && account.slot3.toString() !== defaultKey) count++;
        }
        
        return count;
    }

    /**
     * Monitorar transação
     */
    async monitorTransaction(signature, timeout = 60000) {
        try {
            const start = Date.now();
            
            while (Date.now() - start < timeout) {
                const status = await this.connection.getSignatureStatus(signature);
                
                if (status.value?.confirmationStatus === 'confirmed' || 
                    status.value?.confirmationStatus === 'finalized') {
                    return {
                        confirmed: true,
                        slot: status.value.slot,
                        status: status.value.confirmationStatus
                    };
                }
                
                if (status.value?.err) {
                    return {
                        confirmed: false,
                        error: status.value.err
                    };
                }
                
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            return {
                confirmed: false,
                error: 'Timeout'
            };

        } catch (error) {
            this.logger.error('Erro ao monitorar transação:', error);
            return {
                confirmed: false,
                error: error.message
            };
        }
    }

    /**
     * Derivar PDA do usuário
     */
    async deriveUserPDA(userPublicKey) {
        const [pda] = await PublicKey.findProgramAddress(
            [
                Buffer.from('user'),
                new PublicKey(userPublicKey).toBuffer()
            ],
            this.matrixProgram.programId
        );
        return pda;
    }

    /**
     * Verificar estado do programa
     */
    async getProgramState() {
        try {
            await this.initialize();

            // Tentar diferentes nomes de conta de estado
            const possibleStateNames = ['programState', 'state', 'globalState'];
            
            for (const stateName of possibleStateNames) {
                try {
                    if (this.matrixProgram.account[stateName]) {
                        const stateAccount = await this.matrixProgram.account[stateName].fetch(
                            config.MATRIX_CONFIG.STATE_ADDRESS
                        );

                        return {
                            isActive: stateAccount.isActive !== undefined ? stateAccount.isActive : true,
                            totalUsers: stateAccount.totalUsers?.toNumber() || 0,
                            totalVolume: stateAccount.totalVolume ? 
                                stateAccount.totalVolume.toNumber() / LAMPORTS_PER_SOL : 0,
                            owner: stateAccount.owner?.toString() || stateAccount.admin?.toString()
                        };
                    }
                } catch (e) {
                    // Continuar tentando
                }
            }

            return null;

        } catch (error) {
            this.logger.error('Erro ao buscar estado do programa:', error);
            return null;
        }
    }

    /**
     * Obter dados do airdrop
     */
    async getAirdropState() {
        try {
            await this.initialize();

            // Tentar diferentes nomes de conta
            const possibleStateNames = ['airdropState', 'state', 'programState'];
            
            for (const stateName of possibleStateNames) {
                try {
                    if (this.airdropProgram.account[stateName]) {
                        const state = await this.airdropProgram.account[stateName].fetch(
                            config.AIRDROP_CONFIG.PROGRAM_STATE
                        );

                        return {
                            isActive: state.isActive !== undefined ? state.isActive : true,
                            totalClaimed: state.totalClaimed?.toNumber() || 0,
                            remainingTokens: state.remainingTokens?.toNumber() || 0,
                            admin: state.admin?.toString() || state.owner?.toString()
                        };
                    }
                } catch (e) {
                    // Continuar tentando
                }
            }

            return null;

        } catch (error) {
            this.logger.error('Erro ao buscar estado do airdrop:', error);
            return null;
        }
    }

    /**
     * Sistema de cache simples
     */
    getCached(key, customTimeout = null) {
        const cached = this.accountCache.get(key);
        if (!cached) return null;
        
        const timeout = customTimeout || this.cacheTimeout;
        if (Date.now() - cached.timestamp > timeout) {
            this.accountCache.delete(key);
            return null;
        }
        
        return cached.data;
    }

    setCache(key, data, customTimeout = null) {
        this.accountCache.set(key, {
            data,
            timestamp: Date.now(),
            timeout: customTimeout || this.cacheTimeout
        });
    }

    clearCache() {
        this.accountCache.clear();
    }

    /**
     * Verificar saúde da conexão
     */
    async checkHealth() {
        try {
            const version = await this.connection.getVersion();
            const slot = await this.connection.getSlot();
            
            return {
                healthy: true,
                version,
                slot,
                rpc: config.RPC_URL
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message
            };
        }
    }
}

module.exports = AnchorClientService;