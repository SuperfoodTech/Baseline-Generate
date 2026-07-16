require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { startErrorPoller, setLastChannelId, clearAlertCache } = require('./src/errorPoller');
const { runPipeline } = require('./bridge/run_pipeline');
const recentTasks = require('./src/taskCache');
const modalCmd = require('./src/commands/Modals/modal.js');

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
                    flags: ['Ephemeral'] // ephemeral (only the clicker sees it)
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
            else if (platform === 'failed') {
                // Keep the cached failed applicators list as is
            }
            else formData.aplikator = platform;

            const jobKey = modalCmd.buildJobKey(formData.outlet, formData.aplikator, formData.tanggalMulai, formData.tanggalSelesai);
            if (!modalCmd.acquireJob(jobKey, interaction.user.id, interaction.user.username)) {
                return interaction.reply({
                    content: `⚠️ **Sistem Sibuk!** Proses untuk **${formData.aplikator}** (Outlet: ${formData.outlet}) sedang berjalan. Harap tunggu hingga proses sebelumnya selesai.`,
                    ephemeral: true
                });
            }

            // Force clear all local CSV caches to guarantee fresh data download
            const { execSync } = require('child_process');
            try {
                execSync('find . -type f -name "*cache*.csv" -delete', { cwd: path.join(__dirname, '..') });
            } catch (e) { }

            await interaction.reply({
                content: `🔄 Sedang mengantre proses **Re-Run** untuk **${formData.aplikator}** (Outlet: ${formData.outlet})... Caches telah dihapus. Pantau *progress* di bawah ini.`
            });

            // Re-bind error poller to this channel and reset spam protection cache
            setLastChannelId(interaction.channelId);
            clearAlertCache();

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
                    .setTitle(`🔄 Re-Run KKS: ${formData.aplikator}`)
                    .setDescription(
                        `KKS **${formData.tagihan.toUpperCase()}** sedang diproses ulang.\n\n` +
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
                const isPlatformLog = (platform === 'failed')
                    ? (lower.includes('grab') || lower.includes('shopee') || lower.includes('gofood'))
                    : lower.includes(platform);
                if (isPlatformLog && (lower.includes('pipeline') || lower.includes('automation') || lower.includes('fetching') || lower.includes('scrapperv2'))) {
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
                    await statusMsg.edit({ embeds: [buildEmbed()], components: [cancelRow] }).catch(() => { });
                }
            });

            activeReRuns.set(taskId, pipeline.proc);

            pipeline.promise.then(async (result) => {
                const isCancelled = pipeline.proc ? pipeline.proc.cancelled : false;
                activeReRuns.delete(taskId);

                modalCmd.releaseJob(jobKey);

                if (isCancelled) {
                    return; // statusMsg sudah diupdate oleh handler cancel_rerun_
                }

                if (result.success) {
                    let failedPlatforms = [];
                    if (result.resultData && result.resultData.results) {
                        for (const [platform, success] of Object.entries(result.resultData.results)) {
                            if (!success) {
                                failedPlatforms.push(platform);
                            }
                        }
                    } else if (result.notifData) {
                        const { aplikator, omzet_gr, omzet_sf, omzet_go } = result.notifData;
                        const lowerApp = (aplikator || '').toLowerCase();
                        if ((lowerApp.includes('grab') || lowerApp.includes('all')) && (!omzet_gr || omzet_gr === 'Rp 0')) failedPlatforms.push('Grab');
                        if ((lowerApp.includes('shopee') || lowerApp.includes('all')) && (!omzet_sf || omzet_sf === 'Rp 0')) failedPlatforms.push('Shopee');
                        if ((lowerApp.includes('gofood') || lowerApp.includes('all')) && (!omzet_go || omzet_go === 'Rp 0')) failedPlatforms.push('GoFood');
                    }
                    result.failedPlatforms = failedPlatforms;

                    let embeds = [];
                    let components = [];

                    if (result.notifData) {
                        const { outlet, start_date, end_date, aplikator, pdf_name, omzet_gr, omzet_sf, order_gr, order_sf, omzet_go, order_go } = result.notifData;
                        const embed = new EmbedBuilder()
                            .setTitle('✅ Re-Run Selesai')
                            .setColor(0x00FF00)
                            .setFooter({ text: 'Sistem Re-Run Performance' });

                        const omzetLines = [];
                        const orderLines = [];
                        const lowerApp = (aplikator || '').toLowerCase();
                        if (lowerApp.includes('gofood') || lowerApp.includes('all')) {
                            omzetLines.push(`GoFood: **${omzet_go || 'Rp 0'}**`);
                            orderLines.push(`GoFood: **${order_go || '0'}**`);
                        }
                        if (lowerApp.includes('grab') || lowerApp.includes('all')) {
                            omzetLines.push(`GrabFood: **${omzet_gr || 'Rp 0'}**`);
                            orderLines.push(`GrabFood: **${order_gr || '0'}**`);
                        }
                        if (lowerApp.includes('shopee') || lowerApp.includes('all')) {
                            omzetLines.push(`ShopeeFood: **${omzet_sf || 'Rp 0'}**`);
                            orderLines.push(`ShopeeFood: **${order_sf || '0'}**`);
                        }

                        const omzetStr = omzetLines.join('\n') || '-';
                        const orderStr = orderLines.join('\n') || '-';

                        const pdfUrl = result.notifData.pdf_url || (result.output.replace(/\x1B\[[0-9;]*m/g, '').match(/URL:\s*(https:\/\/drive\.google\.com\/file\/d\/[^\s\r\n]+)/) || [])[1];

                        let desc = `Laporan untuk **${outlet}** telah diperbarui melalui Re-Run.\n\n`;
                        const actionRow = new ActionRowBuilder();
                        if (pdfUrl) {
                            desc += `🔗 **[Klik di sini untuk membuka PDF Laporan](${pdfUrl})**`;
                            actionRow.addComponents(
                                new ButtonBuilder()
                                    .setLabel('📄 Buka PDF Laporan')
                                    .setStyle(ButtonStyle.Link)
                                    .setURL(pdfUrl)
                            );
                        }

                        if (failedPlatforms.length > 0) {
                            const reRunData = { ...formData };
                            reRunData.aplikator = failedPlatforms.map(p => {
                                if (p.toLowerCase() === 'grab') return 'GrabFood';
                                if (p.toLowerCase() === 'shopee') return 'ShopeeFood';
                                if (p.toLowerCase() === 'gofood') return 'GoFood';
                                return p;
                            }).join(', ');

                            const newTaskId = Math.random().toString(36).substring(2, 10);
                            recentTasks.set(newTaskId, reRunData);

                            if (actionRow.components.length < 5) {
                                actionRow.addComponents(
                                    new ButtonBuilder()
                                        .setCustomId(`rerun_failed_${newTaskId}`)
                                        .setLabel(`🔄 Re-Run`)
                                        .setStyle(ButtonStyle.Secondary)
                                );
                            }
                        }

                        if (actionRow.components.length > 0) {
                            components.push(actionRow);
                        }

                        embed.setDescription(desc);
                        embed.addFields(
                            { name: '📍 Outlet', value: outlet, inline: true },
                            { name: '📱 Aplikator', value: aplikator, inline: true },
                            { name: '📅 Rentang Tanggal', value: `\`${start_date}\` → \`${end_date}\``, inline: false },
                            { name: '📊 Rata-rata Omzet / Bulan', value: omzetStr, inline: true },
                            { name: '🛒 Rata-rata Order / Bulan', value: orderStr, inline: true },
                            { name: '📁 Nama File', value: `\`${pdf_name}\``, inline: false }
                        );

                        embeds.push(embed);

                        if (failedPlatforms.length > 0) {
                            const warningEmbed = new EmbedBuilder()
                                .setTitle('⚠️ MASIH ADA DATA KOSONG')
                                .setDescription(`Setelah Re-Run, data transaksi untuk **${failedPlatforms.join(', ')}** masih gagal didapatkan (Terbaca Rp 0).`)
                                .setColor(0xFF0000);
                            embeds.push(warningEmbed);
                        }
                    } else {
                        const embed = new EmbedBuilder()
                            .setTitle('⚠️ Re-Run Selesai dengan Peringatan')
                            .setDescription(`Re-Run KKS **Baseline Performance** selesai, tetapi ada beberapa peringatan:\n\n> Sebagian data mungkin tidak lengkap. Periksa laporan yang dihasilkan.`)
                            .setColor(0xFFAA00)
                            .setTimestamp()
                            .setFooter({ text: 'Sistem Re-Run Performance' });

                        embeds.push(embed);

                        const actionRow = new ActionRowBuilder();
                        if (failedPlatforms.length > 0) {
                            const reRunData = { ...formData };
                            reRunData.aplikator = failedPlatforms.map(p => {
                                if (p.toLowerCase() === 'grab') return 'GrabFood';
                                if (p.toLowerCase() === 'shopee') return 'ShopeeFood';
                                if (p.toLowerCase() === 'gofood') return 'GoFood';
                                return p;
                            }).join(', ');

                            const newTaskId = Math.random().toString(36).substring(2, 10);
                            recentTasks.set(newTaskId, reRunData);

                            actionRow.addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`rerun_failed_${newTaskId}`)
                                    .setLabel(`🔄 Re-Run`)
                                    .setStyle(ButtonStyle.Secondary)
                            );
                            components.push(actionRow);
                        }
                    }

                    // Disable tombol Re-Run di pesan original jika TIDAK ada platform yang gagal
                    if (failedPlatforms.length === 0) {
                        if (interaction.message && interaction.message.components) {
                            try {
                                const newComponents = interaction.message.components.map(row => {
                                    const newRow = new ActionRowBuilder();
                                    row.components.forEach(btn => {
                                        if (btn.customId === interaction.customId) {
                                            const labelText = (platform === 'failed') ? '✅ Re-Run Selesai' : `✅ Berhasil: ${platform.toUpperCase()}`;
                                            newRow.addComponents(ButtonBuilder.from(btn).setDisabled(true).setLabel(labelText));
                                        } else {
                                            newRow.addComponents(ButtonBuilder.from(btn));
                                        }
                                    });
                                    return newRow;
                                });
                                await interaction.message.edit({ components: newComponents });
                            } catch (err) {
                                console.error('Gagal update pesan original Re-Run:', err);
                            }
                        }
                    }

                    await statusMsg.edit({
                        content: ``,
                        embeds: embeds.length ? embeds : [{
                            title: '✅ Re-Run Selesai!',
                            description: `Laporan untuk **${formData.aplikator}** berhasil diproses, namun tidak ada ringkasan data yang bisa ditampilkan.`,
                            color: 0x00FF00
                        }],
                        components: components
                    });
                } else {
                    await statusMsg.edit({
                        content: `❌ **Re-Run Gagal!** Proses **${formData.aplikator}** berhenti dengan error (Exit Code: ${result.exitCode}).`,
                        embeds: [], components: []
                    });
                }
            }).catch(async (err) => {
                activeReRuns.delete(taskId);
                modalCmd.releaseJob(jobKey);
                await statusMsg.edit({
                    content: `❌ **Re-Run Error Tidak Terduga:** ${err.message}`,
                    embeds: [], components: []
                });
            });
        } else if (interaction.customId.startsWith('cancel_rerun_')) {
            const taskId = interaction.customId.replace('cancel_rerun_', '');
            const proc = activeReRuns.get(taskId);

            if (proc && !proc.killed) {
                proc.cancelled = true;
                try {
                    process.kill(-proc.pid, 'SIGKILL'); // Kill process group forcefully
                } catch (e) {
                    try { proc.kill('SIGKILL'); } catch (err) { }
                }
                activeReRuns.delete(taskId);

                await interaction.update({
                    content: '⏹️ **Proses Re-Run dibatalkan secara paksa.**',
                    embeds: [],
                    components: []
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
            req.on('error', () => { });
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
