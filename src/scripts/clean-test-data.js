// src/scripts/clean-test-data.js
const Database = require('../database/connection');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function cleanTestData() {
    console.log('🧹 Script de Limpeza de Dados de Teste\n');
    
    const db = new Database();
    await db.connect();

    try {
        // Mostrar dados atuais
        console.log('📊 Dados atuais no banco:');
        
        const users = await db.all('SELECT COUNT(*) as count FROM users');
        console.log(`👥 Usuários: ${users[0].count}`);
        
        const wallets = await db.all('SELECT COUNT(*) as count FROM wallets');
        console.log(`💳 Wallets: ${wallets[0].count}`);
        
        const tasks = await db.all('SELECT COUNT(*) as count FROM tasks');
        console.log(`📋 Tarefas: ${tasks[0].count}`);
        
        console.log('\n⚠️  ATENÇÃO: Esta ação irá apagar TODOS os dados de teste!');
        console.log('Isso inclui: usuários, wallets, tarefas, notificações, etc.\n');
        
        // Perguntar confirmação
        const answer = await new Promise((resolve) => {
            rl.question('Deseja continuar? (sim/não): ', resolve);
        });

        if (answer.toLowerCase() !== 'sim' && answer.toLowerCase() !== 's') {
            console.log('\n❌ Operação cancelada.');
            process.exit(0);
        }

        console.log('\n🔄 Limpando dados...');

        // Limpar tabelas na ordem correta (respeitando foreign keys)
        await db.run('DELETE FROM notifications');
        console.log('✅ Notificações limpas');
        
        await db.run('DELETE FROM monitors');
        console.log('✅ Monitores limpos');
        
        await db.run('DELETE FROM invites');
        console.log('✅ Convites limpos');
        
        await db.run('DELETE FROM tasks');
        console.log('✅ Tarefas limpas');
        
        await db.run('DELETE FROM wallets');
        console.log('✅ Wallets limpas');
        
        await db.run('DELETE FROM users');
        console.log('✅ Usuários limpos');

        // Resetar autoincrement
        await db.run("DELETE FROM sqlite_sequence");
        console.log('✅ Contadores resetados');

        console.log('\n✨ Limpeza concluída com sucesso!');
        console.log('O banco de dados está limpo e pronto para novos testes.\n');

    } catch (error) {
        console.error('\n❌ Erro durante limpeza:', error);
    } finally {
        db.close();
        rl.close();
        process.exit(0);
    }
}

// Script para limpar wallet específica de um usuário
async function cleanUserWallet(telegramId) {
    const db = new Database();
    await db.connect();

    try {
        if (!telegramId) {
            console.log('❌ Por favor, forneça o ID do Telegram do usuário.');
            console.log('Uso: node clean-test-data.js --user <telegram_id>');
            process.exit(1);
        }

        console.log(`🔍 Buscando dados do usuário ${telegramId}...`);

        // Buscar wallets do usuário
        const wallets = await db.all(
            'SELECT * FROM wallets WHERE telegram_id = ?',
            [telegramId]
        );

        if (wallets.length === 0) {
            console.log('❌ Nenhuma wallet encontrada para este usuário.');
            process.exit(0);
        }

        console.log(`\n📋 Wallets encontradas: ${wallets.length}`);
        wallets.forEach(w => {
            console.log(`  - ${w.public_key} (${w.wallet_name}) - ${w.is_active ? 'ATIVA' : 'INATIVA'}`);
        });

        console.log('\nO que deseja fazer?');
        console.log('1. Desativar todas as wallets');
        console.log('2. Deletar todas as wallets');
        console.log('3. Cancelar');

        const choice = await new Promise((resolve) => {
            rl.question('\nEscolha (1/2/3): ', resolve);
        });

        switch(choice) {
            case '1':
                await db.run(
                    'UPDATE wallets SET is_active = 0 WHERE telegram_id = ?',
                    [telegramId]
                );
                console.log('✅ Todas as wallets foram desativadas.');
                break;
            
            case '2':
                await db.run(
                    'DELETE FROM wallets WHERE telegram_id = ?',
                    [telegramId]
                );
                console.log('✅ Todas as wallets foram deletadas.');
                break;
            
            default:
                console.log('❌ Operação cancelada.');
        }

    } catch (error) {
        console.error('❌ Erro:', error);
    } finally {
        db.close();
        rl.close();
        process.exit(0);
    }
}

// Verificar argumentos da linha de comando
const args = process.argv.slice(2);

if (args[0] === '--user' && args[1]) {
    cleanUserWallet(args[1]);
} else if (args[0] === '--help' || args[0] === '-h') {
    console.log('🍩 Script de Limpeza - Donut Bot\n');
    console.log('Uso:');
    console.log('  node clean-test-data.js          - Limpar TODOS os dados');
    console.log('  node clean-test-data.js --user <id> - Limpar wallet de usuário específico');
    console.log('  node clean-test-data.js --help   - Mostrar esta ajuda\n');
    process.exit(0);
} else {
    cleanTestData();
}