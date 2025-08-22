// src/config/solana-programs.config.js
const { PublicKey } = require('@solana/web3.js');
const path = require('path');
const fs = require('fs');

// Função auxiliar para carregar JSON com tratamento de erro
function loadJSONSafely(filePath, defaultValue = {}) {
    try {
        console.log(`🔍 Tentando carregar: ${filePath}`);
        
        if (!fs.existsSync(filePath)) {
            console.error(`❌ Arquivo não encontrado: ${filePath}`);
            return defaultValue;
        }
        
        const content = fs.readFileSync(filePath, 'utf8');
        if (!content || content.trim() === '') {
            console.error(`❌ Arquivo vazio: ${filePath}`);
            return defaultValue;
        }
        
        const parsed = JSON.parse(content);
        console.log(`✅ JSON carregado com sucesso: ${filePath} (${Object.keys(parsed).length} chaves)`);
        return parsed;
    } catch (error) {
        console.error(`❌ Erro ao carregar ${filePath}:`, error);
        return defaultValue;
    }
}

// Carregar configurações dos contratos
const addressesPath = path.join(__dirname, '../../contracts/config/addresses.json');
const addresses = loadJSONSafely(addressesPath, {
    network: "mainnet-beta",
    programs: {
        matrix: "27j1sNEtfRWBYnaNfWcbpJ4t3QAiWqq9rB4bBgLATmPW",
        airdrop: "ABSanWxsMbM2uLfBz31vbB33qdaEjE8wjRfVWgBw9Cdw"
    }
});

// Carregar IDLs
const matrixIdlPath = path.join(__dirname, '../../contracts/idl/matrix.json');
const airdropIdlPath = path.join(__dirname, '../../contracts/idl/airdrop.json');

console.log('🔍 Carregando IDLs...');
console.log('  Matrix IDL path:', matrixIdlPath);
console.log('  Airdrop IDL path:', airdropIdlPath);

const MATRIX_IDL = loadJSONSafely(matrixIdlPath, {});
const AIRDROP_IDL = loadJSONSafely(airdropIdlPath, {});

console.log('📋 IDLs carregados:');
console.log('  Matrix IDL:', MATRIX_IDL && MATRIX_IDL.instructions ? `✅ ${MATRIX_IDL.instructions.length} instruções` : '❌ Vazio');
console.log('  Airdrop IDL:', AIRDROP_IDL && AIRDROP_IDL.instructions ? `✅ ${AIRDROP_IDL.instructions.length} instruções` : '❌ Vazio');

// Configuração da rede
const NETWORK = process.env.SOLANA_NETWORK || addresses.network || 'mainnet-beta';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Program IDs - GARANTIR que sejam PublicKey válidos
const PROGRAM_IDS = {
    MATRIX: new PublicKey(addresses.programs?.matrix || "27j1sNEtfRWBYnaNfWcbpJ4t3QAiWqq9rB4bBgLATmPW"),
    AIRDROP: new PublicKey(addresses.programs?.airdrop || "ABSanWxsMbM2uLfBz31vbB33qdaEjE8wjRfVWgBw9Cdw"),
    SYSTEM: new PublicKey(addresses.systemProgram || "11111111111111111111111111111111"),
    TOKEN: new PublicKey(addresses.tokenProgram || "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    ASSOCIATED_TOKEN: new PublicKey(addresses.associatedTokenProgram || "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    RENT: new PublicKey(addresses.rent || "SysvarRent111111111111111111111111111111111")
};

// Endereços da Matriz
const MATRIX_CONFIG = {
    PROGRAM_ID: PROGRAM_IDS.MATRIX,
    STATE_ADDRESS: new PublicKey(addresses.matrix?.stateAddress || "C5w4cAmQXU1K8HYCBBACRw451QNsmRbtLS7J59rL1DEN"),
    PROGRAM_SOL_VAULT: new PublicKey(addresses.matrix?.programSolVault || "4zim7ftQ6Kk2Ygd4tgakof4k7CQM9Dsm3idbYjWGXvSy"),
    PROGRAM_SOL_VAULT_BUMP: addresses.matrix?.programSolVaultBump || 255,
    OWNER_WALLET: new PublicKey(addresses.matrix?.ownerWallet || "24bvHXAxxVT2HxuoBptyG9guhE4vUKUTzFWPVBmHRCzw"),
    MULTISIG_TREASURY: new PublicKey(addresses.matrix?.multisigTreasury || "QgNN4aW9hPz4ANP1LqzR2FkDPZo9MzDZxDQ4abovHYv"),
    DEFAULT_REFERRER: new PublicKey(addresses.matrix?.defaultReferrer || "7xGZx4p8ta1jsMU96opkeH8iF84gfLv5kaEvbTfeEGxU")
};

// Endereços do Airdrop
const AIRDROP_CONFIG = {
    PROGRAM_ID: PROGRAM_IDS.AIRDROP,
    PROGRAM_STATE: new PublicKey(addresses.airdrop?.programState || "9HFnt2fksAfQhYh2TfKczpiBmBsE1kGASsf6VHcaTUwt"),
    TOKEN_VAULT: new PublicKey(addresses.airdrop?.tokenVault || "BbQZnzMhpxQwL5ECdeZQ2BDFFQ6QWUf9FFo8psGwKij9"),
    VAULT_METADATA: new PublicKey(addresses.airdrop?.vaultMetadata || "3dNWQT9QkN7qS1QL2p2WMGpYazRaphvDdQ4WotPdRkpt"),
    ADMIN_PUBLIC_KEY: new PublicKey(addresses.airdrop?.adminPublicKey || "24bvHXAxxVT2HxuoBptyG9guhE4vUKUTzFWPVBmHRCzw")
};

// Tokens
const TOKEN_CONFIG = {
    DONUT_MINT: new PublicKey(addresses.tokens?.donut || "DoNUTcc99FrkpQyeaLkYRcangQboNBYP17x7wbqvCqdo"),
    WSOL_MINT: new PublicKey(addresses.tokens?.wsol || "So11111111111111111111111111111111111111112")
};

// Meteora (Pool e Vaults)
const METEORA_CONFIG = {
    POOL: new PublicKey(addresses.meteora?.pool || "CbPqqtMDr23yGoBgWwYdd3DdDPs6Md9fkYDLvN2nhhTE"),
    AMM_PROGRAM: new PublicKey(addresses.meteora?.ammProgram || "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB"),
    VAULT_PROGRAM: new PublicKey(addresses.meteora?.vaultProgram || "24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi"),
    
    // Vault A (DONUT)
    A_VAULT: new PublicKey(addresses.meteora?.aVault || "5w7Jtio3JdQNA5AJ5xscf4CXCoYyh8bKLRMifrwyVvmC"),
    A_TOKEN_VAULT: new PublicKey(addresses.meteora?.aTokenVault || "EpCRN19HhzSRouHX2A3ww3v6MkivZntuYzMoEKbi4TBd"),
    A_VAULT_LP: new PublicKey(addresses.meteora?.aVaultLp || "AVd4YdUCmU5uC1pvCNeDMi9aLq2zLX7m3Waxc1AMoUTa"),
    A_VAULT_LP_MINT: new PublicKey(addresses.meteora?.aVaultLpMint || "36kcK9rFc8pQhzDnGj95ik86gnENqKZxNoKu4Lu6UcNZ"),
    
    // Vault B (WSOL)
    B_VAULT: new PublicKey(addresses.meteora?.bVault || "FERjPVNEa7Udq8CEv68h6tPL46Tq7ieE49HrE2wea3XT"),
    B_TOKEN_VAULT: new PublicKey(addresses.meteora?.bTokenVault || "HZeLxbZ9uHtSpwZC3LBr4Nubd14iHwz7bRSghRZf5VCG"),
    B_VAULT_LP: new PublicKey(addresses.meteora?.bVaultLp || "AqjUDqBoSSHrmMPaj9NaLaFVVTxLGJf2vAtNGTVur1XP"),
    B_VAULT_LP_MINT: new PublicKey(addresses.meteora?.bVaultLpMint || "FZN7QZ8ZUUAxMPfxYEYkH3cXUASzH8EqA6B4tyCL8f1j"),
    
    PROTOCOL_TOKEN_FEE: new PublicKey(addresses.meteora?.protocolTokenFee || "FjT6jkxcZPU78v5E4Pomri1Kq6SBmkuz1n5M36xZyhwW")
};

// Chainlink Oracle
const CHAINLINK_CONFIG = {
    PROGRAM: new PublicKey(addresses.chainlink?.program || "HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny"),
    SOL_USD_FEED: new PublicKey(addresses.chainlink?.solUsdFeed || "99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR")
};

// Configurações de valor para matriz
const MATRIX_VALUES = {
    REGISTRATION_USD: 10.00,  // $10 USD para registro
    BUFFER_PERCENT: 0.03,     // 3% de margem de segurança
    MIN_BALANCE_USD: 15.00,   // Mínimo recomendado na wallet
    SLOT_PAYMENT_USD: 10.00,  // Pagamento por slot
    
    // Calcular valor com buffer
    getRegistrationAmountWithBuffer() {
        return this.REGISTRATION_USD * (1 + this.BUFFER_PERCENT);
    }
};

// Helper para derivar PDAs
const derivePDA = async (seeds, programId) => {
    const [pda, bump] = await PublicKey.findProgramAddress(seeds, programId);
    return { pda, bump };
};

// Função para obter todos os endereços necessários para registro
function getRegistrationAccounts(userWallet, referrerAddress = null) {
    const referrer = referrerAddress 
        ? new PublicKey(referrerAddress)
        : MATRIX_CONFIG.DEFAULT_REFERRER;
        
    return {
        state: MATRIX_CONFIG.STATE_ADDRESS,
        userWallet: new PublicKey(userWallet),
        referrer: referrer,
        programSolVault: MATRIX_CONFIG.PROGRAM_SOL_VAULT,
        wsolMint: TOKEN_CONFIG.WSOL_MINT,
        pool: METEORA_CONFIG.POOL,
        bVault: METEORA_CONFIG.B_VAULT,
        bTokenVault: METEORA_CONFIG.B_TOKEN_VAULT,
        bVaultLpMint: METEORA_CONFIG.B_VAULT_LP_MINT,
        bVaultLp: METEORA_CONFIG.B_VAULT_LP,
        vaultProgram: METEORA_CONFIG.VAULT_PROGRAM,
        tokenMint: TOKEN_CONFIG.DONUT_MINT,
        protocolTokenFee: METEORA_CONFIG.PROTOCOL_TOKEN_FEE,
        ammProgram: METEORA_CONFIG.AMM_PROGRAM,
        tokenProgram: PROGRAM_IDS.TOKEN,
        systemProgram: PROGRAM_IDS.SYSTEM,
        associatedTokenProgram: PROGRAM_IDS.ASSOCIATED_TOKEN,
        rent: PROGRAM_IDS.RENT
    };
}

// Validar se todos os endereços críticos estão configurados
function validateConfig() {
    const critical = [
        { name: 'MATRIX Program', key: PROGRAM_IDS.MATRIX },
        { name: 'AIRDROP Program', key: PROGRAM_IDS.AIRDROP },
        { name: 'Matrix State', key: MATRIX_CONFIG.STATE_ADDRESS },
        { name: 'Sol Vault', key: MATRIX_CONFIG.PROGRAM_SOL_VAULT },
        { name: 'Meteora Pool', key: METEORA_CONFIG.POOL },
        { name: 'DONUT Mint', key: TOKEN_CONFIG.DONUT_MINT }
    ];
    
    // Validar IDLs
    if (!MATRIX_IDL || Object.keys(MATRIX_IDL).length === 0) {
        console.error('❌ IDL da Matrix não foi carregado');
        return false;
    }
    
    if (!AIRDROP_IDL || Object.keys(AIRDROP_IDL).length === 0) {
        console.error('❌ IDL do Airdrop não foi carregado');
        return false;
    }
    
    // Validar estrutura dos IDLs
    if (!MATRIX_IDL.instructions || !Array.isArray(MATRIX_IDL.instructions)) {
        console.error('❌ IDL da Matrix não tem instruções válidas');
        return false;
    }
    
    if (!AIRDROP_IDL.instructions || !Array.isArray(AIRDROP_IDL.instructions)) {
        console.error('❌ IDL do Airdrop não tem instruções válidas');
        return false;
    }
    
    console.log(`✅ Matrix IDL: ${MATRIX_IDL.instructions.length} instruções`);
    console.log(`✅ Airdrop IDL: ${AIRDROP_IDL.instructions.length} instruções`);
    
    let isValid = true;
    
    for (const { name, key } of critical) {
        if (!key) {
            console.error(`❌ Configuração crítica faltando: ${name}`);
            isValid = false;
        } else {
            // Para PublicKeys, verificar se é válido
            if (key.toString() === PublicKey.default.toString()) {
                console.error(`❌ Configuração crítica faltando: ${name}`);
                isValid = false;
            } else {
                console.log(`✅ ${name}: ${key.toString()}`);
            }
        }
    }
    
    if (!isValid) {
        console.error('❌ Configuração crítica faltando. Verifique addresses.json');
        return false;
    }
    
    console.log('✅ Configuração Solana validada com sucesso');
    return true;
}

// Exportar configurações
module.exports = {
    // Configurações de rede
    NETWORK,
    RPC_URL,
    
    // IDLs
    MATRIX_IDL,
    AIRDROP_IDL,
    
    // Program IDs
    PROGRAM_IDS,
    
    // Configurações específicas
    MATRIX_CONFIG,
    AIRDROP_CONFIG,
    TOKEN_CONFIG,
    METEORA_CONFIG,
    CHAINLINK_CONFIG,
    
    // Valores da matriz 
    MATRIX_VALUES,
    
    // Helpers
    derivePDA,
    getRegistrationAccounts,
    validateConfig
};

// Validar ao carregar o módulo
try {
    const isValid = validateConfig();
    if (!isValid) {
        console.error('⚠️ Aviso: Configuração incompleta - alguns componentes podem não funcionar corretamente');
    }
} catch (error) {
    console.error('⚠️ Aviso: Erro durante validação da configuração -', error.message);
}