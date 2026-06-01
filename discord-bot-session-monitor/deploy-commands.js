const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
    new SlashCommandBuilder()
        .setName('check-shopee')
        .setDescription('Cek status validitas sesi akun Shopee secara real-time dan kirim laporan ke Discord Webhook')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) {
            console.error('❌ Error: DISCORD_TOKEN, CLIENT_ID, atau GUILD_ID tidak ditemukan di environment.');
            process.exit(1);
        }
        
        console.log('⏳ Mendaftarkan slash commands...');
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands },
        );
        console.log('✅ Slash commands berhasil didaftarkan!');
    } catch (error) {
        console.error('❌ Terjadi kesalahan saat registrasi command:', error);
    }
})();
