const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle 
} = require('discord.js');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

const PYTHON_PATH = path.resolve(__dirname, '../src/.venv/bin/python');
// Menggunakan skrip browser check yang baru
const SCRIPT_PATH = path.resolve(__dirname, '../check_shopee_browsers.py');

// Menyimpan ID channel terakhir untuk pengiriman otomatis via scheduler
let lastChannelId = null;

// Helper untuk mencari channel notifikasi
async function getNotificationChannel(interaction = null) {
    if (interaction && interaction.channelId) {
        lastChannelId = interaction.channelId;
        return interaction.channel;
    }
    if (lastChannelId) {
        try {
            const channel = await client.channels.fetch(lastChannelId);
            if (channel) return channel;
        } catch {}
    }
    // Cari di server aktif
    for (const [guildId, guild] of client.guilds.cache) {
        try {
            const channels = await guild.channels.fetch();
            const target = channels.find(c => 
                c.name === 'shopee-monitor' || 
                c.name === 'general' || 
                c.name === 'welcome' || 
                c.type === 0 // Text Channel
            );
            if (target) {
                lastChannelId = target.id;
                return target;
            }
        } catch (e) {
            console.error(`Gagal mengambil channel di guild ${guild.name}:`, e);
        }
    }
    return null;
}

// Fungsi untuk mengeksekusi skrip python checker
function runSessionCheck(interaction = null, targetUsername = null, isSequential = true) {
    return new Promise(async (resolve, reject) => {
        const channel = await getNotificationChannel(interaction);
        if (!channel) {
            console.warn("⚠️ Tidak dapat menemukan channel notifikasi Discord untuk OTP / Laporan.");
        }

        const args = [SCRIPT_PATH];
        if (targetUsername) {
            args.push('--username', targetUsername);
        }
        if (isSequential) {
            args.push('--sequential');
        }

        console.log(`Executing: ${PYTHON_PATH} ${args.join(' ')}`);
        
        // Atur environment variable agar Python tahu sedang di-run dari Discord
        const proc = spawn(PYTHON_PATH, args, {
            env: { 
                ...process.env, 
                OFD_DISCORD_MODE: '1',
                HEADLESS: process.env.HEADLESS !== undefined ? process.env.HEADLESS : 'true'
            }
        });
        
        let stdoutData = '';
        let stderrData = '';
        
        proc.stdout.on('data', async (data) => {
            const chunk = data.toString();
            stdoutData += chunk;
            process.stdout.write(data);
            
            // Deteksi baris OTP Request
            const lines = chunk.split('\n');
            for (const line of lines) {
                if (line.includes('DISCORD_OTP_REQUEST:')) {
                    try {
                        const jsonStr = line.substring(line.indexOf('DISCORD_OTP_REQUEST:') + 'DISCORD_OTP_REQUEST:'.length).trim();
                        const requestData = JSON.parse(jsonStr);
                        console.log(`🔑 Terdeteksi Permintaan OTP untuk: ${requestData.username}`);
                        
                        if (channel) {
                            const otpEmbed = new EmbedBuilder()
                                .setTitle('🔑 Shopee OTP Required')
                                .setDescription(`Akun **${requestData.username}** (${requestData.phone}) memerlukan kode verifikasi OTP untuk melanjutkan login.`)
                                .setColor('#ff4500')
                                .setFooter({ text: 'Klik tombol di bawah untuk memasukkan kode OTP' })
                                .setTimestamp();
                                
                            const btn = new ButtonBuilder()
                                .setCustomId(`otp_btn_${requestData.username}`)
                                .setLabel('Masukkan OTP')
                                .setStyle(ButtonStyle.Primary);
                                
                            const row = new ActionRowBuilder().addComponents(btn);
                            
                            await channel.send({ embeds: [otpEmbed], components: [row] });
                        }
                    } catch (err) {
                        console.error("Gagal mem-parsing payload OTP request:", err);
                    }
                }
            }
        });
        
        proc.stderr.on('data', (data) => {
            stderrData += data.toString();
            process.stderr.write(data);
        });
        
        proc.on('close', async (code) => {
            if (code === 0) {
                // Cari hasil JSON final
                const match = stdoutData.match(/FINAL_RESULTS:\s*(\[.*\])/);
                if (match) {
                    try {
                        const results = JSON.parse(match[1]);
                        if (channel) {
                            const reportEmbed = new EmbedBuilder()
                                .setTitle('📊 Laporan Verifikasi Sesi Shopee')
                                .setTimestamp();

                            let description = '';
                            let troubledAccounts = [];
                            results.forEach(res => {
                                const statusEmoji = res.status === 'ACTIVE' ? '🟢' : (res.status === 'WARNING' ? '🟡' : '🔴');
                                description += `${statusEmoji} **${res.username}**: ${res.message}\n`;
                                if (res.status !== 'ACTIVE') {
                                    troubledAccounts.push(res.username);
                                }
                            });
                            
                            reportEmbed.setDescription(description);

                            if (troubledAccounts.length > 0) {
                                reportEmbed.setColor('#ff9900');
                                const restoreBtn = new ButtonBuilder()
                                    .setCustomId(`restore_btn:${troubledAccounts.join(',')}`)
                                    .setLabel('🔴 Pulihkan Sesi Bermasalah')
                                    .setStyle(ButtonStyle.Danger);
                                    
                                const row = new ActionRowBuilder().addComponents(restoreBtn);
                                await channel.send({ embeds: [reportEmbed], components: [row] });
                            } else {
                                reportEmbed.setColor('#00ff00');
                                await channel.send({ embeds: [reportEmbed] });
                            }
                        }
                    } catch (err) {
                        console.error("Gagal mem-parsing final results:", err);
                    }
                }
                resolve(stdoutData);
            } else {
                reject(new Error(`Exit code ${code}. Detail: ${stderrData || stdoutData}`));
            }
        });
    });
}

client.once('ready', () => {
    console.log(`🤖 Bot pemantau sesi Shopee aktif sebagai: ${client.user.tag}`);
    
    // Scheduler Harian (Setiap Hari pukul 08:00 WIB)
    setInterval(() => {
        const now = new Date();
        const offset = 7; // WIB (UTC+7)
        const wibTime = new Date(now.getTime() + (offset * 3600 * 1000));
        
        const hours = wibTime.getUTCHours();
        const minutes = wibTime.getUTCMinutes();
        const seconds = wibTime.getUTCSeconds();
        
        if (hours === 8 && minutes === 0 && seconds === 0) {
            console.log("⏰ Jam 08:00 WIB. Memulai verifikasi sesi Shopee harian...");
            runSessionCheck()
                .then(() => console.log("✅ Pengecekan sesi harian selesai."))
                .catch(err => console.error("❌ Pengecekan sesi harian gagal:", err));
        }
    }, 1000);
});

client.on('interactionCreate', async interaction => {
    // 1. Tangani Slash Commands
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'check-shopee') {
            try {
                await interaction.deferReply();
                console.log(`👤 ${interaction.user.tag} memicu perintah /check-shopee`);
                // Simpan channelId terakhir
                lastChannelId = interaction.channelId;
                
                await interaction.editReply("🔍 Memulai pengecekan sesi & switch merchant untuk seluruh akun... (Proses sedang berjalan secara sekuensial)");
                await runSessionCheck(interaction);
            } catch (error) {
                console.error("Kesalahan saat memproses slash command check-shopee:", error);
                try {
                    if (interaction.deferred) {
                        await interaction.editReply(`❌ Gagal menjalankan verifikasi sesi:\n\`\`\`${error.message.substring(0, 1800)}\`\`\``);
                    } else {
                        await interaction.reply({ content: `❌ Gagal menjalankan verifikasi sesi: ${error.message}`, ephemeral: true });
                    }
                } catch (e) {
                    console.error("Gagal mengirimkan pesan error ke Discord:", e);
                }
            }
        }
    }
    
    // 2. Tangani Tombol Klik "Masukkan OTP" atau "Pulihkan Sesi Bermasalah"
    if (interaction.isButton()) {
        if (interaction.customId.startsWith('restore_btn:')) {
            const usernamesStr = interaction.customId.split(':')[1];
            const usernames = usernamesStr.split(',').filter(Boolean);
            
            await interaction.reply({ 
                content: `🛠️ Memulai pemulihan sekuensial (satu per satu) untuk ${usernames.length} akun: **${usernames.join(', ')}**...`, 
                ephemeral: false 
            });
            
            const runSequentialRecovery = async (index) => {
                if (index >= usernames.length) {
                    await interaction.channel.send({ content: "✅ Seluruh proses pemulihan sesi selesai!" });
                    return;
                }
                
                const currentUsername = usernames[index];
                await interaction.channel.send({ content: `🚀 [${index + 1}/${usernames.length}] Memproses pemulihan untuk akun **${currentUsername}**...` });
                
                try {
                    await runSessionCheck(interaction, currentUsername, true);
                    await interaction.channel.send({ content: `✅ Pemulihan akun **${currentUsername}** selesai diproses.` });
                } catch (err) {
                    console.error(`Gagal memulihkan ${currentUsername}:`, err);
                    await interaction.channel.send({ content: `❌ Pemulihan akun **${currentUsername}** gagal: ${err.message}` });
                }
                
                // Lanjutkan ke akun berikutnya
                await runSequentialRecovery(index + 1);
            };
            
            runSequentialRecovery(0).catch(err => {
                console.error("Kesalahan antrean pemulihan sekuensial:", err);
            });
            return;
        }

        if (interaction.customId.startsWith('otp_btn_')) {
            const username = interaction.customId.replace('otp_btn_', '');
            
            const modal = new ModalBuilder()
                .setCustomId(`otp_modal_${username}`)
                .setTitle(`OTP Shopee: ${username}`);
                
            const otpInput = new TextInputBuilder()
                .setCustomId('otp_code')
                .setLabel('Kode OTP 6-Digit')
                .setStyle(TextInputStyle.Short)
                .setMinLength(6)
                .setMaxLength(6)
                .setPlaceholder('Masukkan 6 angka OTP')
                .setRequired(true);
                
            const firstActionRow = new ActionRowBuilder().addComponents(otpInput);
            modal.addComponents(firstActionRow);
            
            await interaction.showModal(modal);
        }
    }
    
    // 3. Tangani Pengiriman Form Modal OTP
    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('otp_modal_')) {
            const username = interaction.customId.replace('otp_modal_', '');
            const otpCode = interaction.fields.getTextInputValue('otp_code').trim();
            
            const otpFilePath = path.resolve(__dirname, `../src/shopee-omzet-automation/data/otp_request_${username}.json`);
            
            if (fs.existsSync(otpFilePath)) {
                try {
                    const fileContent = JSON.parse(fs.readFileSync(otpFilePath, 'utf8'));
                    fileContent.status = 'RECEIVED';
                    fileContent.code = otpCode;
                    fileContent.received_at = new Date().toISOString();
                    
                    fs.writeFileSync(otpFilePath, JSON.stringify(fileContent, null, 2));
                    
                    await interaction.reply({ content: `✅ OTP untuk **${username}** berhasil diteruskan ke browser!`, ephemeral: true });
                    
                    // Update pesan asli agar tombol hilang dan status berubah
                    if (interaction.message) {
                        const successEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                            .setDescription(`Akun **${username}** (${fileContent.phone}) - **OTP Berhasil Terkirim** ✅`)
                            .setColor('#00ff00')
                            .setFooter({ text: 'Sedang melanjutkan proses login di browser...' });
                        await interaction.message.edit({ embeds: [successEmbed], components: [] });
                    }
                } catch (err) {
                    console.error(err);
                    await interaction.reply({ content: `❌ Gagal memproses OTP: ${err.message}`, ephemeral: true });
                }
            } else {
                await interaction.reply({ content: `❌ Request OTP untuk **${username}** sudah kedaluwarsa atau tidak aktif.`, ephemeral: true });
            }
        }
    }
});

if (!process.env.DISCORD_TOKEN) {
    console.error("❌ Error: DISCORD_TOKEN tidak ditemukan di file .env");
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);

// Tambahkan penanganan error global agar bot tidak crash karena masalah koneksi/API Discord
client.on('error', error => {
    console.error('⚠️ Discord Client Error:', error);
});

process.on('unhandledRejection', error => {
    console.error('⚠️ Unhandled Promise Rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('⚠️ Uncaught Exception:', error);
});
