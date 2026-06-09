require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { startErrorPoller, setLastChannelId } = require('./src/errorPoller');
const { runPipeline } = require('./bridge/run_pipeline');
const recentTasks = require('./src/taskCache');

const activeReRuns = new Map();

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
    startErrorPoller(client);
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
        } else if (interaction.customId.startsWith('cancel_pipeline_')) {
            const command = client.commands.get('start');
            if (command && command.cancelPipeline) {
                await command.cancelPipeline(interaction);
            }
        } else if (interaction.customId.startsWith('rerun_')) {
            const parts = interaction.customId.split('_');
            const platform = parts[1].toLowerCase(); 
            const taskId = parts[2];
            
            const cachedData = recentTasks.get(taskId);
            if (!cachedData) {
                return interaction.reply({
                    content: '❌ **Sesi Re-Run Kedaluwarsa!** Cache tugas ini sudah hilang karena bot di-restart atau sudah terlalu lama. Silakan jalankan ulang via perintah `/start`.',
                    ephemeral: true
                });
            }

            // Create a copy of formData and isolate the platform
            const formData = { ...cachedData };
            
            // Map the platform shortcut back to form data aplikator
            if (platform === 'grab') formData.aplikator = 'GrabFood';
            else if (platform === 'shopee') formData.aplikator = 'ShopeeFood';
            else if (platform === 'gofood') formData.aplikator = 'GoFood';
            else formData.aplikator = platform;

            await interaction.reply({ 
                content: `🔄 Sedang mengantre proses **Re-Run** untuk **${formData.aplikator}** (Outlet: ${formData.outlet})... Pantau *progress* di bawah ini.`, 
                ephemeral: false 
            });

            // Re-bind error poller to this channel
            setLastChannelId(interaction.channelId);

            const bdDisplay = formData.bd ? formData.bd.split('|').join(', ') : 'Semua BD';
            const steps = [
                { id: platform, name: `Scraping data ${formData.aplikator}...` },
                { id: 'merge', name: '📊 Menggabungkan laporan...' },
                { id: 'pdf', name: '📄 Membuat PDF Laporan...' }
            ];
            const totalPhases = steps.length;
            let phaseNumber = 0;
            let currentPhase = 'Memulai proses...';

            const makeProgressBar = (phase, total) => {
                const filled = '█'.repeat(phase);
                const empty = '░'.repeat(total - phase);
                return `[${filled}${empty}] ${phase}/${total}`;
            };

            const buildEmbed = () => {
                return new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle(`🔄 Re-Run Pipeline: ${formData.aplikator}`)
                    .setDescription(
                        `Pipeline **${formData.tagihan.toUpperCase()}** sedang diproses ulang.\n\n` +
                        `${makeProgressBar(phaseNumber, totalPhases)}\n` +
                        `> 📍 **Outlet:** ${formData.outlet.substring(0, 100)}\n` +
                        `> 👤 **BD:** ${bdDisplay}\n` +
                        `> 📱 **Platform:** ${formData.aplikator}\n` +
                        `> 📅 **Rentang:** ${formData.tanggalMulai} s/d ${formData.tanggalSelesai}\n\n` +
                        `${currentPhase}\n` +
                        `⏱️ Estimasi waktu: **1–5 menit**`
                    )
                    .setFooter({ text: 'Sistem Re-Run Performance' })
                    .setTimestamp();
            };

            const cancelRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`cancel_rerun_${taskId}`)
                    .setLabel('⏹️ Batalkan Proses')
                    .setStyle(ButtonStyle.Danger)
            );

            // Create an initial status message
            const statusMsg = await interaction.channel.send({
                embeds: [buildEmbed()],
                components: [cancelRow]
            });

            let lastUpdate = Date.now();
            
            // Run pipeline
            const pipeline = runPipeline(formData, async (logLine) => {
                const lower = logLine.toLowerCase();
                let newPhase = null;

                let matchedIndex = -1;
                if (lower.includes(platform) && (lower.includes('pipeline') || lower.includes('automation') || lower.includes('fetching') || lower.includes('scrapperv2'))) {
                    matchedIndex = 0;
                } else if (lower.includes('penggabungan') || lower.includes('gabung') || lower.includes('merging')) {
                    matchedIndex = 1;
                } else if (lower.includes('pdf') || lower.includes('apps script') || lower.includes('webhook')) {
                    matchedIndex = 2;
                }

                if (matchedIndex !== -1) {
                    phaseNumber = matchedIndex + 1;
                    currentPhase = `**[${phaseNumber}/${totalPhases}]** ${steps[matchedIndex].name}`;
                }

                if (Date.now() - lastUpdate > 3000) {
                    lastUpdate = Date.now();
                    await statusMsg.edit({ embeds: [buildEmbed()], components: [cancelRow] }).catch(() => {});
                }
            });
            
            activeReRuns.set(taskId, pipeline.proc);

            pipeline.promise.then(async (result) => {
                activeReRuns.delete(taskId);
                if (result.success) {
                    await statusMsg.edit({
                        content: `✅ **Re-Run Selesai!** Laporan untuk **${formData.aplikator}** berhasil diproses.`,
                        embeds: [], components: []
                    });
                } else {
                    await statusMsg.edit({
                        content: `❌ **Re-Run Gagal!** Proses **${formData.aplikator}** berhenti dengan error (Exit Code: ${result.exitCode}).`,
                        embeds: [], components: []
                    });
                }
            }).catch(async (err) => {
                activeReRuns.delete(taskId);
                await statusMsg.edit({
                    content: `❌ **Re-Run Error Tidak Terduga:** ${err.message}`,
                    embeds: [], components: []
                });
            });
        } else if (interaction.customId.startsWith('cancel_rerun_')) {
            const taskId = interaction.customId.replace('cancel_rerun_', '');
            const proc = activeReRuns.get(taskId);
            
            if (proc && !proc.killed) {
                try {
                    process.kill(-proc.pid, 'SIGINT'); // Kill process group
                } catch (e) {
                    try { proc.kill('SIGINT'); } catch (err) {}
                }
                activeReRuns.delete(taskId);
                
                await interaction.reply({
                    content: '⏹️ **Sinyal pembatalan dikirim.** Proses Re-Run akan segera dihentikan.',
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: '⚠️ **Gagal membatalkan:** Proses tidak ditemukan atau sudah selesai.',
                    ephemeral: true
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
        
        // Ensure warmer is unpaused on startup to recover from any previous crashes
        try {
            const http = require('http');
            const req = http.request({
                socketPath: '/var/run/docker.sock',
                path: '/v1.41/containers/shopee_session_warmer/unpause',
                method: 'POST',
                headers: {
                    'Host': 'localhost',
                    'Content-Length': 0
                }
            }, (res) => {
                console.log(`[STARTUP] Checked warmer status: HTTP ${res.statusCode}`);
            });
            req.on('error', () => {});
            req.end();
        } catch (e) {
            console.warn('[STARTUP] Failed to check warmer container status via Docker socket:', e.message);
        }

        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        console.error('Gagal login ke Discord:', error);
        console.log('Mencoba login kembali dalam 10 detik...');
        setTimeout(startBot, 10000); // Retry setiap 10 detik jika gagal
    }
};

startBot();
