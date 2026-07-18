const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const ERROR_DIR = path.resolve(__dirname, '../../src/data/discord_notifications');

let lastChannelId = null;
const alertCache = new Map();

function setLastChannelId(id) {
    lastChannelId = id;
}

function clearAlertCache() {
    alertCache.clear();
}

async function getNotificationChannel(client, channelIdOverride = null) {
    const targetId = channelIdOverride || lastChannelId;
    if (targetId) {
        try {
            const channel = await client.channels.fetch(targetId);
            if (channel) return channel;
        } catch { }
    }
    return null;
}

const processingFiles = new Set();

function startErrorPoller(client) {
    // Pastikan folder ada
    if (!fs.existsSync(ERROR_DIR)) {
        try {
            fs.mkdirSync(ERROR_DIR, { recursive: true });
        } catch (e) {
            console.error("Gagal membuat direktori error:", e);
        }
    }

    console.log("📡 [POLLER] Background Error Polling started...");

    setInterval(async () => {
        try {
            if (!fs.existsSync(ERROR_DIR)) return;
            const files = fs.readdirSync(ERROR_DIR).filter(f => f.startsWith('error_') && f.endsWith('.json'));

            for (const file of files) {
                if (processingFiles.has(file)) continue;
                processingFiles.add(file);

                try {
                    const filePath = path.join(ERROR_DIR, file);
                    if (!fs.existsSync(filePath)) continue;

                    const data = fs.readFileSync(filePath, 'utf8');
                    const content = JSON.parse(data);

                    if (!client.isReady()) continue;

                    const cacheKey = `${content.platform}_${content.merchant}`;
                    const now = Date.now();
                    if (alertCache.has(cacheKey)) {
                        if (now - alertCache.get(cacheKey) < 5 * 60 * 1000) { // 5 minutes cooldown
                            try { fs.unlinkSync(filePath); } catch (e) { }
                            continue; // Skip duplicate
                        }
                    }

                    const channel = await getNotificationChannel(client, content.channel_id);
                    if (channel) {
                        alertCache.set(cacheKey, now);
                        console.log(`📡 [POLLER] Background Error Request detected for ${content.merchant} (Channel: ${content.channel_id || lastChannelId}). Sending Discord message...`);

                        let embedColor = '#ff0000'; // Default red
                        let embedIcon = '⚠️';

                        if (content.error_type === 'OTP_TIMEOUT') {
                            embedColor = '#ffaa00'; // Orange
                            embedIcon = '⏳';
                        } else if (content.error_type === 'WRONG_CREDENTIALS') {
                            embedColor = '#ff0000'; // Red
                            embedIcon = '🚫';
                        } else if (content.error_type === 'BLOCKED_ACCOUNT') {
                            embedColor = '#000000'; // Black
                            embedIcon = '🛑';
                        } else if (content.error_type === 'NO_DATA') {
                            embedColor = '#aaaaaa'; // Grey
                            embedIcon = '📭';
                        }

                        const errorEmbed = new EmbedBuilder()
                            .setTitle(`${embedIcon} Masalah Sinkronisasi: ${content.platform}`)
                            .setDescription(`Sistem mendeteksi adanya kendala saat memproses data untuk outlet berikut:`)
                            .addFields(
                                { name: '🏢 Nama Merchant', value: `**${content.merchant}**`, inline: true },
                                { name: '📌 Detail Kendala', value: `\`${content.message}\``, inline: false }
                            )
                            .setColor(embedColor)
                            .setFooter({ text: 'Notifikasi Otomatis - Auto Reporting System' })
                            .setTimestamp();

                        await channel.send({ embeds: [errorEmbed] });

                        // Hapus file setelah berhasil dikirim
                        try {
                            fs.unlinkSync(filePath);
                            console.log(`🗑️ Berhasil menghapus notifikasi: ${file}`);
                        } catch (e) {
                            console.error(`Gagal menghapus file ${file}:`, e);
                        }
                    }
                } catch (e) {
                    console.error(`Gagal memproses file ${file}:`, e);
                } finally {
                    processingFiles.delete(file);
                }
            }
        } catch (error) {
            console.error("⚠️ [POLLER] Error in background Error Notification monitoring:", error);
        }
    }, 3000);
}

module.exports = { startErrorPoller, getNotificationChannel, setLastChannelId, clearAlertCache };
