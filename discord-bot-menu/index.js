require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

const commandsPath = path.join(__dirname, 'src', 'commands');
if (fs.existsSync(commandsPath)) {
    const commandFolders = fs.readdirSync(commandsPath);
    for (const folder of commandFolders) {
        const folderPath = path.join(commandsPath, folder);
        if (fs.statSync(folderPath).isDirectory()) {
            const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
            for (const file of commandFiles) {
                const filePath = path.join(folderPath, file);
                const command = require(filePath);
                if ('data' in command && 'execute' in command) {
                    client.commands.set(command.data.name, command);
                }
            }
        }
    }
}

client.once('ready', () => {
    console.log(`Bot Menu Pipeline online sebagai ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
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
});

const startBot = async () => {
    try {
        console.log('Sedang mencoba menghubungkan ke Discord (Menu Bot)...');
        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        console.error('Gagal login ke Discord:', error);
        console.log('Mencoba login kembali dalam 10 detik...');
        setTimeout(startBot, 10000);
    }
};

startBot();
