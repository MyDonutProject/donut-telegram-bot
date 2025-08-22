// src/services/bot-anchor-client.service.js
// VERSÃO COMPLETA COM TODOS OS MÉTODOS DO SISTEMA ORIGINAL

const { 
    Connection, 
    PublicKey, 
    Transaction,
    SystemProgram,
    LAMPORTS_PER_SOL,
    ComputeBudgetProgram,
    TransactionMessage,
    VersionedTransaction,
    AddressLookupTableProgram,
    SYSVAR_RENT_PUBKEY,
    SYSVAR_INSTRUCTIONS_PUBKEY
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

class BotAnchorClientService {
    constructor() {
        this.logger = new Logger('BotAnchorClientService');
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
     * Inicializar programas Anchor - VERSÃO ROBUSTA
     */

    async initialize(wallet = null) {
        try {
            if (this.initialized && !wallet) return true;
    
            this.logger.info('🔧 Inicializando BotAnchorClientService...');
    
            // Validar configuração
            await this.validateConfiguration();
    
            // Criar provider
            const defaultWallet = wallet || new NodeWallet(web3.Keypair.generate());
            const provider = new AnchorProvider(
                this.connection,
                defaultWallet,
                { commitment: 'confirmed' }
            );
    
            // INICIALIZAR PROGRAMA MATRIX
            this.logger.info('🔧 Inicializando programa Matrix...');
            
            const matrixIdl = JSON.parse(JSON.stringify(config.MATRIX_IDL));
            const matrixProgramId = new PublicKey(config.PROGRAM_IDS.MATRIX.toString());
            
            this.matrixProgram = new Program(
                matrixIdl,
                matrixProgramId,
                provider
            );
            
            this.logger.info(`✅ Programa Matrix inicializado: ${matrixProgramId.toString()}`);
    
            // INICIALIZAR PROGRAMA AIRDROP
            this.logger.info('🔧 Inicializando programa Airdrop...');
            
            const airdropIdl = JSON.parse(JSON.stringify(config.AIRDROP_IDL));
            const airdropProgramId = new PublicKey(config.PROGRAM_IDS.AIRDROP.toString());
            
            this.airdropProgram = new Program(
                airdropIdl,
                airdropProgramId,
                provider
            );
            
            this.logger.info(`✅ Programa Airdrop inicializado: ${airdropProgramId.toString()}`);
    
            this.initialized = true;
            this.logger.info('✅ BotAnchorClientService inicializado com sucesso!');
            
            return true;
    
        } catch (error) {
            this.logger.error('❌ Erro ao inicializar BotAnchorClientService:', error);
            throw error;
        }
    }

    /**
     * Validar configuração antes de inicializar
     */
    async validateConfiguration() {
        this.logger.info('🔍 Validando configuração...');

        // Validar Program IDs
        if (!config.PROGRAM_IDS || !config.PROGRAM_IDS.MATRIX || !config.PROGRAM_IDS.AIRDROP) {
            throw new Error('Program IDs não estão configurados corretamente');
        }

        // Validar se são PublicKeys válidos
        try {
            const matrixPubkey = new PublicKey(config.PROGRAM_IDS.MATRIX.toString());
            const airdropPubkey = new PublicKey(config.PROGRAM_IDS.AIRDROP.toString());
            
            this.logger.info(`✅ Matrix Program ID válido: ${matrixPubkey.toString()}`);
            this.logger.info(`✅ Airdrop Program ID válido: ${airdropPubkey.toString()}`);
        } catch (error) {
            throw new Error(`Program IDs inválidos: ${error.message}`);
        }

        // Validar IDLs
        if (!config.MATRIX_IDL) {
            throw new Error('Matrix IDL não foi carregado');
        }

        if (!config.AIRDROP_IDL) {
            throw new Error('Airdrop IDL não foi carregado');
        }

        // Validar estrutura dos IDLs
        if (!config.MATRIX_IDL.instructions || !Array.isArray(config.MATRIX_IDL.instructions)) {
            throw new Error('Matrix IDL não tem instruções válidas');
        }

        if (!config.AIRDROP_IDL.instructions || !Array.isArray(config.AIRDROP_IDL.instructions)) {
            throw new Error('Airdrop IDL não tem instruções válidas');
        }

        this.logger.info(`✅ Matrix IDL: ${config.MATRIX_IDL.instructions.length} instruções`);
        this.logger.info(`✅ Airdrop IDL: ${config.AIRDROP_IDL.instructions.length} instruções`);

        // Validar conexão RPC
        try {
            const version = await this.connection.getVersion();
            this.logger.info(`✅ Conexão RPC válida: ${JSON.stringify(version)}`);
        } catch (error) {
            throw new Error(`Erro na conexão RPC: ${error.message}`);
        }

        this.logger.info('✅ Configuração validada com sucesso!');
    }

    /**
     * MÉTODO PRINCIPAL: Executar registro completo para BOT
     */
    async executeRegistrationForBot(userKeypair, referrerAddress, amountUSD = 10.3) {
        try {
            await this.initialize();
            
            this.logger.info('=== INICIANDO REGISTRO COMPLETO PARA BOT ===');
            this.logger.info(`User: ${userKeypair.publicKey.toString()}`);
            this.logger.info(`Referrer: ${referrerAddress}`);
            this.logger.info(`Amount: $${amountUSD} USD`);

            // 1. EXECUTAR TRANSAÇÕES PREPARATÓRIAS (múltiplas transações)
            this.logger.info('📋 Passo 1: Executando transações preparatórias...');
            const preparatoryResult = await this.executePreparatoryTransactions(
                userKeypair, 
                referrerAddress
            );

            // 2. CRIAR E POPULAR LOOKUP TABLE (múltiplas transações)
            this.logger.info('📋 Passo 2: Criando Address Lookup Table...');
            const lookupTableAddress = await this.createAndPopulateLookupTable(
                userKeypair, 
                preparatoryResult.allAddresses
            );

            // 3. AGUARDAR ATIVAÇÃO DA LUT
            this.logger.info('📋 Passo 3: Aguardando ativação da Lookup Table...');
            await this.waitForLookupTableActivation(lookupTableAddress);

            // 4. EXECUTAR REGISTRO PRINCIPAL COM LUT (transação final)
            this.logger.info('📋 Passo 4: Executando registro principal...');
            const registrationResult = await this.executeMainRegistrationWithLUT(
                userKeypair,
                referrerAddress,
                amountUSD,
                lookupTableAddress,
                preparatoryResult.remainingAccounts,
                preparatoryResult.slotIndex
            );

            this.logger.info('✅ REGISTRO COMPLETO PARA BOT FINALIZADO COM SUCESSO!');

            return {
                success: true,
                signature: registrationResult.signature,
                amountSol: registrationResult.amountSol,
                slotOccupied: preparatoryResult.slotIndex,
                explorerUrl: `https://solscan.io/tx/${registrationResult.signature}`,
                preparatoryTransactions: preparatoryResult.signatures,
                lookupTableAddress: lookupTableAddress.toString()
            };

        } catch (error) {
            this.logger.error('❌ Erro no registro completo para bot:', error);
            
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
     * Executar TODAS as transações preparatórias
     * (ATA + Airdrop + coleta de endereços)
     */
    async executePreparatoryTransactions(userKeypair, referrerAddress) {
        const signatures = [];

        try {
            // 1. CRIAR ATAs (TRANSAÇÃO SEPARADA)
            this.logger.info('🔧 Criando Associated Token Accounts...');
            const ataResult = await this.createRequiredATAs(userKeypair);
            if (ataResult.signature) {
                signatures.push({
                    type: 'ATA_Creation',
                    signature: ataResult.signature
                });
            }

            // 2. REGISTRAR NO AIRDROP (TRANSAÇÃO SEPARADA)
            this.logger.info('🎁 Registrando no programa de Airdrop...');
            const airdropResult = await this.registerInAirdropIfNeeded(userKeypair);
            if (airdropResult.signature) {
                signatures.push({
                    type: 'Airdrop_Registration',
                    signature: airdropResult.signature
                });
            }

            // 3. ANALISAR REFERRER E PREPARAR UPLINES (se Slot 3)
            this.logger.info('🔍 Analisando referrer e preparando uplines...');
            const referrerAnalysis = await this.analyzeReferrerAndPrepareUplines(referrerAddress);
            
            // 4. COLETAR TODOS OS ENDEREÇOS PARA LUT
            this.logger.info('📍 Coletando endereços para Address Lookup Table...');
            const allAddresses = this.collectAllAddressesForLUT(
                userKeypair.publicKey,
                referrerAddress,
                referrerAnalysis.uplineAccounts
            );

            this.logger.info(`✅ Transações preparatórias executadas: ${signatures.length} transações`);
            this.logger.info(`📍 Endereços coletados para LUT: ${allAddresses.length} endereços`);

            return {
                signatures,
                allAddresses,
                remainingAccounts: referrerAnalysis.uplineAccounts,
                slotIndex: referrerAnalysis.slotIndex,
                userWsolAccount: ataResult.userWsolAccount,
                userDonutAccount: ataResult.userDonutAccount
            };

        } catch (error) {
            this.logger.error('❌ Erro nas transações preparatórias:', error);
            throw error;
        }
    }

    /**
     * Criar ATAs necessárias (TRANSAÇÃO SEPARADA)
     */
    async createRequiredATAs(userKeypair) {
        try {
            const userWsolAccount = await getAssociatedTokenAddress(
                config.TOKEN_CONFIG.WSOL_MINT,
                userKeypair.publicKey
            );

            const userDonutAccount = await getAssociatedTokenAddress(
                config.TOKEN_CONFIG.DONUT_MINT,
                userKeypair.publicKey
            );

            // Verificar quais ATAs já existem
            const [wsolAccountInfo, donutAccountInfo] = await Promise.all([
                this.connection.getAccountInfo(userWsolAccount),
                this.connection.getAccountInfo(userDonutAccount)
            ]);

            const needsWsolATA = !wsolAccountInfo;
            const needsDonutATA = !donutAccountInfo;

            if (!needsWsolATA && !needsDonutATA) {
                this.logger.info('✅ Todas as ATAs já existem');
                return {
                    signature: null,
                    userWsolAccount,
                    userDonutAccount
                };
            }

            // Criar transação de ATAs
            const transaction = new Transaction();

            if (needsWsolATA) {
                this.logger.info('➕ Adicionando instrução para criar WSOL ATA');
                transaction.add(
                    createAssociatedTokenAccountInstruction(
                        userKeypair.publicKey,
                        userWsolAccount,
                        userKeypair.publicKey,
                        config.TOKEN_CONFIG.WSOL_MINT
                    )
                );
            }

            if (needsDonutATA) {
                this.logger.info('➕ Adicionando instrução para criar DONUT ATA');
                transaction.add(
                    createAssociatedTokenAccountInstruction(
                        userKeypair.publicKey,
                        userDonutAccount,
                        userKeypair.publicKey,
                        config.TOKEN_CONFIG.DONUT_MINT
                    )
                );
            }

            // Executar transação
            const signature = await this.executeTransaction(transaction, userKeypair, 'ATA Creation');

            this.logger.info(`✅ ATAs criadas: ${signature}`);

            return {
                signature,
                userWsolAccount,
                userDonutAccount
            };

        } catch (error) {
            this.logger.error('❌ Erro ao criar ATAs:', error);
            throw error;
        }
    }

    /**
     * Registrar no Airdrop se necessário (TRANSAÇÃO SEPARADA)
     */
    async registerInAirdropIfNeeded(userKeypair) {
        try {
            // Derivar PDA do usuário no airdrop
            const [airdropUserPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('user_account'), userKeypair.publicKey.toBuffer()],
                this.airdropProgram.programId
            );

            // Verificar se já está registrado
            let airdropAccount = null;
            const possibleAirdropNames = ['userAccount', 'user', 'airdropUser'];
            
            for (const accountName of possibleAirdropNames) {
                try {
                    if (this.airdropProgram.account[accountName]) {
                        airdropAccount = await this.airdropProgram.account[accountName].fetchNullable(airdropUserPDA);
                        if (airdropAccount !== null) {
                            this.logger.info(`✅ Usuário já registrado no airdrop (conta: ${accountName})`);
                            return { signature: null };
                        }
                    }
                } catch (e) {
                    // Continuar tentando
                }
            }

            // Criar transação de registro
            const transaction = new Transaction();
            
            // Tentar diferentes métodos de registro
            const possibleMethods = ['registerUser', 'register', 'createUser'];
            let registerInstruction = null;
            
            for (const methodName of possibleMethods) {
                try {
                    if (this.airdropProgram.methods[methodName]) {
                        this.logger.info(`🔧 Tentando método de registro: ${methodName}`);
                        
                        registerInstruction = await this.airdropProgram.methods[methodName]()
                            .accounts({
                                programState: config.AIRDROP_CONFIG.PROGRAM_STATE,
                                userWallet: userKeypair.publicKey,
                                userAccount: airdropUserPDA,
                                systemProgram: SystemProgram.programId
                            })
                            .instruction();
                        
                        this.logger.info(`✅ Instrução de registro criada com método: ${methodName}`);
                        break;
                    }
                } catch (e) {
                    this.logger.debug(`❌ Método ${methodName} falhou: ${e.message}`);
                }
            }
            
            if (!registerInstruction) {
                this.logger.warn('⚠️ Nenhum método de registro do airdrop funcionou');
                return { signature: null };
            }

            transaction.add(registerInstruction);

            // Executar transação
            const signature = await this.executeTransaction(transaction, userKeypair, 'Airdrop Registration');

            this.logger.info(`✅ Registrado no airdrop: ${signature}`);

            return { signature };

        } catch (error) {
            this.logger.error('❌ Erro ao registrar no airdrop:', error);
            // Não falhar por causa do airdrop
            return { signature: null };
        }
    }

    /**
     * Analisar referrer e preparar uplines (para Slot 3)
     */
    async analyzeReferrerAndPrepareUplines(referrerAddress) {
        try {
            const referrerPubkey = new PublicKey(referrerAddress);
            
            // Obter conta do referrer
            const referrerAccount = await this.getUserAccount(referrerAddress);
            
            if (!referrerAccount.exists) {
                this.logger.info('ℹ️ Referrer não tem conta (usando slot 0)');
                return {
                    slotIndex: 0,
                    uplineAccounts: []
                };
            }

            const slotIndex = referrerAccount.data.filledSlots || 0;
            const uplineAccounts = [];

            // Se for Slot 3 (índice 2), preparar uplines
            if (slotIndex === 2) {
                this.logger.info('🔄 SLOT 3 DETECTADO - Preparando recursão...');
                
                if (referrerAccount.data.upline && referrerAccount.data.upline.upline) {
                    const uplines = referrerAccount.data.upline.upline;
                    
                    for (let i = 0; i < Math.min(uplines.length, 6); i++) {
                        const uplineEntry = uplines[i];
                        
                        try {
                            // Verificar se upline está registrado
                            const uplineAccount = await this.getUserAccount(uplineEntry.wallet.toString());
                            
                            if (uplineAccount.exists && uplineAccount.data.isRegistered) {
                                // Verificar se está registrado no airdrop
                                const isAirdropRegistered = await this.isUserRegisteredInAirdrop(uplineEntry.wallet);
                                
                                if (isAirdropRegistered) {
                                    uplineAccounts.push({
                                        pubkey: uplineEntry.pda,
                                        isWritable: true,
                                        isSigner: false
                                    });
                                    uplineAccounts.push({
                                        pubkey: uplineEntry.wallet,
                                        isWritable: true,
                                        isSigner: false
                                    });
                                    
                                    this.logger.info(`✅ Upline ${i + 1} adicionado: ${uplineEntry.wallet.toString()}`);
                                }
                            }
                        } catch (e) {
                            this.logger.warn(`⚠️ Erro ao processar upline ${i + 1}: ${e.message}`);
                        }
                    }
                    
                    this.logger.info(`✅ Total de uplines preparados: ${uplineAccounts.length / 2}`);
                }
            }

            return {
                slotIndex,
                uplineAccounts
            };

        } catch (error) {
            this.logger.error('❌ Erro ao analisar referrer:', error);
            return {
                slotIndex: 0,
                uplineAccounts: []
            };
        }
    }

    /**
     * Coletar TODOS os endereços necessários para Address Lookup Table
     */
    collectAllAddressesForLUT(userWallet, referrerAddress, uplineAccounts) {
        const addresses = [];

        try {
            // Endereços básicos sempre necessários
            addresses.push(
                // Contas principais
                config.MATRIX_CONFIG.STATE_ADDRESS,
                userWallet,
                new PublicKey(referrerAddress),
                
                // Mints
                config.TOKEN_CONFIG.WSOL_MINT,
                config.TOKEN_CONFIG.DONUT_MINT,
                
                // Meteora Pool e Vaults
                config.METEORA_CONFIG.POOL,
                config.METEORA_CONFIG.B_VAULT,
                config.METEORA_CONFIG.B_TOKEN_VAULT,
                config.METEORA_CONFIG.B_VAULT_LP_MINT,
                config.METEORA_CONFIG.B_VAULT_LP,
                config.METEORA_CONFIG.A_VAULT,
                config.METEORA_CONFIG.A_TOKEN_VAULT,
                config.METEORA_CONFIG.A_VAULT_LP,
                config.METEORA_CONFIG.A_VAULT_LP_MINT,
                
                // Program accounts
                config.MATRIX_CONFIG.PROGRAM_SOL_VAULT,
                config.METEORA_CONFIG.PROTOCOL_TOKEN_FEE,
                
                // Programs
                config.METEORA_CONFIG.VAULT_PROGRAM,
                config.METEORA_CONFIG.AMM_PROGRAM,
                TOKEN_PROGRAM_ID,
                SystemProgram.programId,
                ASSOCIATED_TOKEN_PROGRAM_ID,
                SYSVAR_RENT_PUBKEY,
                
                // Chainlink
                config.CHAINLINK_CONFIG.PROGRAM,
                config.CHAINLINK_CONFIG.SOL_USD_FEED
            );

            // Adicionar uplines se houver (Slot 3)
            for (const account of uplineAccounts) {
                addresses.push(account.pubkey);
            }

            // Remover duplicatas
            const uniqueAddresses = [];
            const seen = new Set();
            
            for (const addr of addresses) {
                const addrStr = addr.toString();
                if (!seen.has(addrStr)) {
                    seen.add(addrStr);
                    uniqueAddresses.push(addr);
                }
            }

            this.logger.info(`📍 Endereços únicos coletados: ${uniqueAddresses.length}`);

            return uniqueAddresses;

        } catch (error) {
            this.logger.error('❌ Erro ao coletar endereços:', error);
            throw error;
        }
    }

    /**
     * Criar e popular Address Lookup Table (MÚLTIPLAS TRANSAÇÕES)
     */
    async createAndPopulateLookupTable(userKeypair, addresses) {
        try {
            // 1. CRIAR LOOKUP TABLE (TRANSAÇÃO SEPARADA)
            this.logger.info('🔧 Criando Address Lookup Table...');
            
            const slot = await this.connection.getSlot();
            const [createInstruction, lookupTableAddress] = 
                AddressLookupTableProgram.createLookupTable({
                    authority: userKeypair.publicKey,
                    payer: userKeypair.publicKey,
                    recentSlot: slot - 1
                });

            const createTransaction = new Transaction().add(createInstruction);
            const createSignature = await this.executeTransaction(createTransaction, userKeypair, 'LUT Creation');
            
            this.logger.info(`✅ Lookup Table criada: ${lookupTableAddress.toString()}`);

            // 2. POPULAR EM BATCHES (MÚLTIPLAS TRANSAÇÕES SEPARADAS)
            this.logger.info('📝 Populando Lookup Table em batches...');
            
            const BATCH_SIZE = 25;
            const batches = [];
            
            for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
                batches.push(addresses.slice(i, i + BATCH_SIZE));
            }

            this.logger.info(`📦 Criados ${batches.length} batches para população`);

            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                
                this.logger.info(`📝 Populando batch ${i + 1}/${batches.length} (${batch.length} endereços)...`);
                
                const extendInstruction = AddressLookupTableProgram.extendLookupTable({
                    payer: userKeypair.publicKey,
                    authority: userKeypair.publicKey,
                    lookupTable: lookupTableAddress,
                    addresses: batch
                });

                const extendTransaction = new Transaction().add(extendInstruction);
                const extendSignature = await this.executeTransaction(
                    extendTransaction, 
                    userKeypair, 
                    `LUT Population Batch ${i + 1}`
                );
                
                this.logger.info(`✅ Batch ${i + 1} populado: ${extendSignature}`);
                
                // Delay entre batches
                await this.sleep(1000);
            }

            this.logger.info(`✅ Lookup Table completamente populada: ${lookupTableAddress.toString()}`);

            return lookupTableAddress;

        } catch (error) {
            this.logger.error('❌ Erro ao criar/popular Lookup Table:', error);
            throw error;
        }
    }

    /**
     * Aguardar ativação da Lookup Table
     */
    async waitForLookupTableActivation(lookupTableAddress, maxRetries = 10) {
        this.logger.info('⏳ Aguardando ativação da Lookup Table...');
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                const lookupTableAccount = await this.connection.getAddressLookupTable(lookupTableAddress);
                
                if (lookupTableAccount.value && lookupTableAccount.value.state) {
                    this.logger.info(`✅ Lookup Table ativa com ${lookupTableAccount.value.state.addresses.length} endereços`);
                    return lookupTableAccount.value;
                }
                
                this.logger.info(`⏳ Tentativa ${i + 1}/${maxRetries} - aguardando...`);
                await this.sleep(3000);
                
            } catch (error) {
                this.logger.warn(`⚠️ Erro na tentativa ${i + 1}: ${error.message}`);
                await this.sleep(3000);
            }
        }
        
        throw new Error('Lookup Table não ativou após múltiplas tentativas');
    }

    /**
     * Executar registro principal com Lookup Table (TRANSAÇÃO FINAL)
     */
    async executeMainRegistrationWithLUT(userKeypair, referrerAddress, amountUSD, lookupTableAddress, remainingAccounts, slotIndex) {
        try {
            // 1. Preparar valores
            const solPrice = await this.getSolPrice();
            const amountInSol = amountUSD / solPrice;
            const amountInLamports = new BN(Math.floor(amountInSol * LAMPORTS_PER_SOL));

            this.logger.info(`💰 Registro: $${amountUSD} = ${amountInSol.toFixed(4)} SOL = ${amountInLamports.toString()} lamports`);

            // 2. Verificar saldo
            const balance = await this.connection.getBalance(userKeypair.publicKey);
            const requiredBalance = amountInLamports.toNumber() + 0.02 * LAMPORTS_PER_SOL; // +0.02 SOL para taxas
            
            if (balance < requiredBalance) {
                throw new Error(`Saldo insuficiente. Necessário: ${(requiredBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL, Disponível: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
            }

            // 3. Obter Lookup Table Account
            const lookupTableAccount = await this.connection.getAddressLookupTable(lookupTableAddress);
            if (!lookupTableAccount.value) {
                throw new Error('Lookup Table não está disponível');
            }

            // 4. Derivar PDAs
            const [userPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('user_account'), userKeypair.publicKey.toBuffer()],
                this.matrixProgram.programId
            );

            const referrerPubkey = new PublicKey(referrerAddress);
            const [referrerPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('user_account'), referrerPubkey.toBuffer()],
                this.matrixProgram.programId
            );

            // 5. Obter ATAs
            const userWsolAccount = await getAssociatedTokenAddress(
                config.TOKEN_CONFIG.WSOL_MINT,
                userKeypair.publicKey
            );

            const userDonutAccount = await getAssociatedTokenAddress(
                config.TOKEN_CONFIG.DONUT_MINT,
                userKeypair.publicKey
            );

            // 6. Criar instruções
            const instructions = [];

            // Compute budget (mais units para Slot 3)
            const computeUnits = slotIndex === 2 ? 1400000 : 1000000;
            instructions.push(
                ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250000 })
            );

            // 7. Criar instrução de registro
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
                rent: SYSVAR_RENT_PUBKEY
            };

            // Adicionar contas do airdrop se Slot 3
            if (slotIndex === 2 && remainingAccounts.length > 0) {
                this.logger.info(`🔄 Adicionando ${remainingAccounts.length} remaining accounts para Slot 3`);
                
                // Adicionar contas do airdrop
                accounts.airdropProgram = config.AIRDROP_CONFIG.PROGRAM_ID;
                accounts.airdropProgramState = config.AIRDROP_CONFIG.PROGRAM_STATE;
                accounts.instructionSysvar = SYSVAR_INSTRUCTIONS_PUBKEY;
                
                // Adicionar referrer airdrop PDA
                const [referrerAirdropPDA] = await PublicKey.findProgramAddress(
                    [Buffer.from('user_account'), referrerPubkey.toBuffer()],
                    config.AIRDROP_CONFIG.PROGRAM_ID
                );
                accounts.referrerAirdropAccount = referrerAirdropPDA;
            }

            // 8. Criar instrução de registro
            let registerInstruction = null;
            const possibleMethods = ['registerWithSolDeposit', 'register', 'registerUser'];
            
            for (const methodName of possibleMethods) {
                try {
                    if (this.matrixProgram.methods[methodName]) {
                        this.logger.info(`🔧 Usando método de registro: ${methodName}`);
                        
                        if (methodName === 'registerWithSolDeposit') {
                            registerInstruction = await this.matrixProgram.methods[methodName](amountInLamports)
                                .accounts(accounts)
                                .remainingAccounts(remainingAccounts)
                                .instruction();
                        } else {
                            registerInstruction = await this.matrixProgram.methods[methodName]()
                                .accounts(accounts)
                                .remainingAccounts(remainingAccounts)
                                .instruction();
                        }
                        break;
                    }
                } catch (e) {
                    this.logger.debug(`❌ Método ${methodName} falhou: ${e.message}`);
                }
            }

            if (!registerInstruction) {
                throw new Error('Nenhum método de registro funcionou');
            }

            instructions.push(registerInstruction);

            // 9. Criar versioned transaction com LUT
            const { blockhash } = await this.connection.getLatestBlockhash();
            
            const messageV0 = new TransactionMessage({
                payerKey: userKeypair.publicKey,
                recentBlockhash: blockhash,
                instructions,
            }).compileToV0Message([lookupTableAccount.value]);

            const transaction = new VersionedTransaction(messageV0);

            // 10. Assinar e enviar
            transaction.sign([userKeypair]);

            this.logger.info('📤 Enviando transação de registro principal...');
            
            const signature = await this.connection.sendRawTransaction(
                transaction.serialize(),
                { 
                    skipPreflight: false, 
                    maxRetries: 3,
                    preflightCommitment: 'confirmed'
                }
            );

            // 11. Confirmar
            this.logger.info('⏳ Aguardando confirmação...');
            await this.connection.confirmTransaction(signature, 'confirmed');

            this.logger.info(`✅ REGISTRO PRINCIPAL CONFIRMADO: ${signature}`);
            this.logger.info(`🎯 Slot ocupado: ${slotIndex} (${this.getSlotBehaviorDescription(slotIndex)})`);

            return {
                signature,
                amountSol: amountInSol
            };

        } catch (error) {
            this.logger.error('❌ Erro no registro principal:', error);
            throw error;
        }
    }

    /**
     * Executar uma transação individual (helper)
     */
    async executeTransaction(transaction, keypair, description = 'Transaction') {
        try {
            // Obter blockhash recente
            const { blockhash } = await this.connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = keypair.publicKey;

            // Assinar
            transaction.sign(keypair);

            // Enviar
            const signature = await this.connection.sendRawTransaction(
                transaction.serialize(),
                { 
                    skipPreflight: false, 
                    maxRetries: 3,
                    preflightCommitment: 'confirmed'
                }
            );

            // Confirmar
            await this.connection.confirmTransaction(signature, 'confirmed');

            this.logger.info(`✅ ${description} confirmada: ${signature}`);

            return signature;

        } catch (error) {
            this.logger.error(`❌ Erro em ${description}:`, error);
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
            
            const [userPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('user_account'), userPubkey.toBuffer()],
                this.matrixProgram.programId
            );

            // Verificar cache
            const cacheKey = `user_${userPDA.toString()}`;
            const cached = this.getCached(cacheKey);
            if (cached) return cached;

            // Buscar conta na blockchain
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
     * Verificar slots do referenciador
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
     * Verificar se usuário está registrado no airdrop
     */
    async isUserRegisteredInAirdrop(userWallet) {
        try {
            const userPubkey = new PublicKey(userWallet.toString());
            
            const [airdropUserPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('user_account'), userPubkey.toBuffer()],
                this.airdropProgram.programId
            );

            const possibleNames = ['userAccount', 'user', 'airdropUser'];
            
            for (const accountName of possibleNames) {
                try {
                    if (this.airdropProgram.account[accountName]) {
                        const account = await this.airdropProgram.account[accountName].fetchNullable(airdropUserPDA);
                        if (account !== null) {
                            return true;
                        }
                    }
                } catch (e) {
                    // Continuar
                }
            }
            
            return false;
        } catch (error) {
            this.logger.error('Erro ao verificar registro no airdrop:', error);
            return false;
        }
    }

    /**
     * Obter preço atual do SOL
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
                const data = feedAccount.data;
                const price = Number(data.readBigInt64LE(64)) / 100000000; // 8 decimals
                
                if (price > 0) {
                    this.setCache('sol_price', price, 10000);
                    return price;
                }
            }
        } catch (error) {
            this.logger.warn('Erro ao obter preço do Chainlink:', error);
        }

        // Fallback para API externa
        try {
            const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
            const data = await response.json();
            const price = data.solana.usd;
            
            this.setCache('sol_price', price, 10000);
            return price;
        } catch (error) {
            this.logger.error('Erro ao obter preço do SOL:', error);
            return 180; // Preço fallback
        }
    }

    /**
     * Derivar PDA do usuário
     */
    async deriveUserPDA(userPublicKey) {
        const [pda] = await PublicKey.findProgramAddress(
            [
                Buffer.from('user_account'),
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
     * Contar slots preenchidos
     */
    countFilledSlots(account) {
        let count = 0;
        const defaultKey = PublicKey.default.toString();
        
        if (account.slots && Array.isArray(account.slots)) {
            for (const slot of account.slots) {
                if (slot && slot.toString() !== defaultKey) count++;
            }
        } else {
            if (account.slot1 && account.slot1.toString() !== defaultKey) count++;
            if (account.slot2 && account.slot2.toString() !== defaultKey) count++;
            if (account.slot3 && account.slot3.toString() !== defaultKey) count++;
        }
        
        return count;
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
     * Sleep helper
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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
                rpc: config.RPC_URL,
                initialized: this.initialized
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message,
                initialized: this.initialized
            };
        }
    }
}

module.exports = BotAnchorClientService;