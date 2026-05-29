require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');

// 1. Inisialisasi Client (Bot)
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// 2. Collection untuk menyimpan data command
client.commands = new Collection();

// 3. Membaca semua file command di dalam folder src/commands/
const commandsPath = path.join(__dirname, 'src', 'commands');
const commandFolders = fs.readdirSync(commandsPath);

for (const folder of commandFolders) {
    const folderPath = path.join(commandsPath, folder);

    // Periksa apakah ini direktori (folder)
    if (fs.statSync(folderPath).isDirectory()) {
        const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const filePath = path.join(folderPath, file);
            const command = require(filePath);

            // Set command ke dalam Collection jika ada data dan execute-nya
            if ('data' in command && 'execute' in command) {
                client.commands.set(command.data.name, command);
            } else {
                console.log(`[WARNING] Command di ${filePath} tidak memiliki properti "data" atau "execute".`);
            }
        }
    }
}

// 4. Event ketika bot berhasil menyala
client.once('clientReady', () => {
    console.log(`Bot sudah online sebagai ${client.user.tag}!`);
});

// 5. Event ketika user menggunakan Slash Command atau berinteraksi dengan Menu
client.on('interactionCreate', async interaction => {
    // Jika interaksi adalah Slash Command
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);

        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(error);
            const content = 'Terjadi kesalahan saat mengeksekusi command ini!';
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: content, flags: 64 });
            } else {
                await interaction.reply({ content: content, flags: 64 });
            }
        }
    }
    // Jika interaksi adalah Button
    else if (interaction.isButton()) {
        if (interaction.customId === 'open_tagihan_modal') {
            const command = client.commands.get('start');
            if (command && command.startFormFlow) {
                await command.startFormFlow(interaction);
            }
        } else if (interaction.customId === 'refresh_sheets_cache') {
            const command = client.commands.get('start');
            if (command && command.clearCache) {
                command.clearCache();
                await interaction.reply({
                    content: '🔄 **Cache berhasil dihapus!** Mengambil data terbaru dari Google Sheets pada pengisian formulir berikutnya.',
                    flags: 64 // ephemeral (only the clicker sees it)
                });
            }
        }
    }
});

// 6. Penanganan Error Global (Mencegah bot mati total)
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});

client.on('error', error => {
    console.error('Discord client error:', error);
});

client.on('shardError', error => {
    console.error('Websocket connection error:', error);
});

// 7. Login ke Discord dengan Fungsi Retry
const startBot = async () => {
    try {
        console.log('Sedang mencoba menghubungkan ke Discord...');
        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        console.error('Gagal login ke Discord:', error);
        console.log('Mencoba login kembali dalam 10 detik...');
        setTimeout(startBot, 10000); // Retry setiap 10 detik jika gagal
    }
};

startBot();
