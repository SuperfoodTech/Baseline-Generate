const {
    SlashCommandBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    EmbedBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const https = require('https');

function fetchCSV(url) {
    return new Promise((resolve, reject) => {
        const fetchUrl = (currentUrl) => {
            https.get(currentUrl, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return fetchUrl(res.headers.location);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`HTTP Status ${res.statusCode}`));
                }
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(data));
            }).on('error', (err) => reject(err));
        };
        fetchUrl(url + '&t=' + Date.now());
    });
}

const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ3tLKBNXDqRgBw0mNhKZFxgvKx-JoiTDzm_s5Ix1cm7O6HCv4IvExOLR2HSRVaXSsx82V348mcr9X4/pub?gid=0&single=true&output=csv';

let cachedSheetData = null;
let lastCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 menit cache

// ── Job Lock — mencegah 2 user menjalankan pipeline yang sama secara bersamaan ──
// Key: "<outlet>|<platform>|<startDate>|<endDate>"
// Value: { userId, username, startedAt }
const activeJobs = new Map();

/**
 * Buat kunci unik untuk sebuah job berdasarkan outlet + platform + tanggal.
 * @param {string} outlet
 * @param {string} aplikator
 * @param {string} tanggalMulai
 * @param {string} tanggalSelesai
 * @returns {string}
 */
function buildJobKey(outlet, aplikator, tanggalMulai, tanggalSelesai) {
    const normalizedOutlet = (outlet || 'all').toLowerCase().trim();
    const normalizedPlatform = (aplikator || 'all').toLowerCase().trim();
    return `${normalizedOutlet}|${normalizedPlatform}|${tanggalMulai}|${tanggalSelesai}`;
}

/**
 * Coba ambil lock untuk job ini.
 * @returns {boolean} true jika berhasil (tidak ada job yang sedang berjalan), false jika sudah ada
 */
function acquireJob(key, userId, username) {
    if (activeJobs.has(key)) return false;
    activeJobs.set(key, { userId, username, startedAt: new Date() });
    return true;
}

/**
 * Lepas lock untuk job ini.
 */
function releaseJob(key) {
    activeJobs.delete(key);
    console.log(`[JOB LOCK] Released: ${key}`);
}


const makeProgressEmbed = (step, title, description, fields = []) => {
    const steps = [
        { name: 'BD', icon: '👤' },
        { name: 'Outlet', icon: '🏢' },
        { name: 'Aplikator', icon: '📱' },
        { name: 'Tanggal', icon: '📅' }
    ];

    let progressStr = '';
    for (let i = 0; i < steps.length; i++) {
        if (i < step) {
            progressStr += `✅ **${steps[i].name}**`;
        } else if (i === step) {
            progressStr += `🔵 __**${steps[i].name}**__`;
        } else {
            progressStr += `⚪ ${steps[i].name}`;
        }
        if (i < steps.length - 1) {
            progressStr += ' ➔ ';
        }
    }

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`${steps[step].icon} ${title}`)
        .setDescription(`**Langkah Progres:**\n${progressStr}\n\n${description}`)
        .setFooter({ text: 'Sistem Rekap Laporan Otomatis' })
        .setTimestamp();

    if (fields && fields.length > 0) {
        embed.addFields(fields);
    }

    return embed;
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('start')
        .setDescription('Kirim formulir rekap laporan'),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            await this.fetchSheetData();
        } catch (err) {
            console.error('Gagal mengambil data sheet di awal:', err);
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📊 Generate Baseline Report')
            .setDescription(
                'Klik tombol di bawah untuk mengisi formulir...'
            )
            .setFooter({ text: 'Sistem Rekap Laporan Otomatis' })
            .setTimestamp();

        const button = new ButtonBuilder()
            .setCustomId('open_tagihan_modal')
            .setLabel('Klik untuk mengisi formulir!')
            .setEmoji('📝')
            .setStyle(ButtonStyle.Primary);

        const refreshButton = new ButtonBuilder()
            .setCustomId('refresh_sheets_cache')
            .setLabel('Refresh ')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(button, refreshButton);

        await interaction.editReply({
            embeds: [embed],
            components: [row]
        });
    },

    clearCache() {
        cachedSheetData = null;
        lastCacheTime = 0;
        console.log('[CACHE] Google Sheets cache cleared manually.');
        this.deleteBaselineCaches();
    },

    deleteBaselineCaches() {
        const fs = require('fs');
        const path = require('path');
        const pathsToDelete = [
            path.resolve(__dirname, '..', '..', '..', '..', 'src', 'baseline', 'shopee', 'data', 'master_merchants_cache.csv'),
            path.resolve(__dirname, '..', '..', '..', '..', 'src', 'baseline', 'shopee', 'data', 'shopee_credentials_cache.csv'),
            path.resolve(__dirname, '..', '..', '..', '..', 'data', 'master_merchants_cache.csv'),
            path.resolve(__dirname, '..', '..', '..', '..', 'data', 'shopee_credentials_cache.csv')
        ];
        for (const p of pathsToDelete) {
            if (fs.existsSync(p)) {
                try {
                    fs.unlinkSync(p);
                    console.log(`[CACHE] Baseline Python cache file deleted: ${p}`);
                } catch (err) {
                    console.error(`[CACHE] Failed to delete baseline python cache file ${p}:`, err);
                }
            }
        }
    },

    async refreshCache(interaction) {
        await interaction.deferReply({ flags: 64 });
        try {
            cachedSheetData = null;
            lastCacheTime = 0;
            this.deleteBaselineCaches();
            await this.fetchSheetData();
            await interaction.editReply({
                content: '✅ **Data Google Sheets berhasil diperbarui!** Silakan klik tombol **Klik untuk mengisi formulir!** untuk menggunakan data terbaru.',
                components: []
            });
        } catch (err) {
            console.error('Gagal melakukan refresh cache:', err);
            await interaction.editReply({
                content: '❌ **Gagal memperbarui data dari Google Sheets.** Silakan coba beberapa saat lagi.',
                components: []
            });
        }
    },

    async startFormFlow(interaction) {
        await interaction.deferReply({ flags: 64 });

        const isCached = cachedSheetData && (Date.now() - lastCacheTime < CACHE_DURATION);
        let sheetData;

        try {
            if (isCached) {
                sheetData = cachedSheetData;
            } else {
                const loadingEmbed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('🔄 Menghubungkan ke Google Sheets...')
                    .setDescription('Mohon tunggu sejenak, kami sedang menyinkronkan daftar outlet dan BD terbaru secara langsung...')
                    .setFooter({ text: 'Sistem Rekap Laporan Otomatis' })
                    .setTimestamp();

                await interaction.editReply({ embeds: [loadingEmbed], components: [] });
                sheetData = await this.fetchSheetData();
            }

            const { outlets, bds, userToBdMap, bdToUserMap, outletAppMap, bdOutletsMap, outletBdMap } = sheetData;
            const formData = {};

            formData.tagihan = 'baseline';
            formData.cabang = ''; // Cabang/Brand is empty for baseline

            // 1. Pilih BD (single select, tanpa opsi 'Semua')
            const bdOptions = bds.map(name => ({
                label: name,
                value: name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 100),
                description: `Proses outlet di bawah ${name}`
            }));

            const bdResult = await this.askSelection(interaction, {
                title: 'Pilih BD',
                step: 0,
                placeholder: 'Pilih BD...',
                options: bdOptions,
                minValues: 1,
                maxValues: 1,
                isFirstStep: true,
                fields: [
                    { name: 'Jenis Laporan', value: formData.tagihan.toUpperCase(), inline: true }
                ]
            });

            const selectedBdValues = bdResult.values;
            const selectedBdNames = bds.filter(name =>
                selectedBdValues.includes(name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 100))
            );
            const selectedUsernames = [];
            for (const name of selectedBdNames) {
                const mappedUser = bdToUserMap[name.toLowerCase()] || name.toLowerCase();
                selectedUsernames.push(mappedUser);
            }
            formData.bd = selectedUsernames.join('|');
            const bdDisplay = selectedBdNames.join(', ');

            // Filter outlets berdasarkan BD terpilih
            const outletNamesSet = new Set();
            selectedBdNames.forEach(name => {
                const bdOutlets = bdOutletsMap[name.toLowerCase()] || [];
                bdOutlets.forEach(o => outletNamesSet.add(o));
            });
            let filteredOutlets = Array.from(outletNamesSet);
            if (filteredOutlets.length === 0) {
                filteredOutlets = outlets;
            }

            // 2. Pilih Outlet (single select, tanpa opsi 'Semua')
            const outletOptions = filteredOutlets.slice(0, 25).map(name => ({
                label: name.substring(0, 100),
                value: name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 100)
            }));

            const outletResult = await this.askSelection(bdResult.lastInteraction, {
                title: 'Pilih Outlet',
                step: 1,
                placeholder: 'Pilih outlet...',
                options: outletOptions,
                minValues: 1,
                maxValues: 1,
                fields: [
                    { name: 'Jenis Laporan', value: formData.tagihan.toUpperCase(), inline: true },
                    { name: 'BD Terpilih', value: bdDisplay.length > 512 ? bdDisplay.substring(0, 508) + '...' : bdDisplay, inline: true }
                ]
            });

            const selectedOutletValues = outletResult.values;
            const selectedOutletNames = filteredOutlets.filter(name =>
                selectedOutletValues.includes(name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 100))
            );
            formData.outlet = selectedOutletNames.join(', ');

            // 3. Pilih Aplikator
            const availableApps = new Set();
            let selectedOutletVals = selectedOutletValues;
            if (selectedOutletValues.includes('all')) {
                selectedOutletVals = filteredOutlets.map(name => name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 100));
            }

            selectedOutletVals.forEach(outletVal => {
                const apps = outletAppMap[outletVal] || [];
                apps.forEach(a => availableApps.add(a));
            });

            if (availableApps.size === 0) {
                availableApps.add('gofood');
                availableApps.add('grabfood');
                availableApps.add('shopeefood');
            }

            const allApps = [
                { label: 'GoFood', value: 'gofood', emoji: '🔴' },
                { label: 'GrabFood', value: 'grabfood', emoji: '🟢' },
                { label: 'ShopeeFood', value: 'shopeefood', emoji: '🟠' }
            ];

            // Tampilkan semua aplikator yang tersedia + opsi 'Pilih Semua'
            const aplikatorOptions = [
                {
                    label: '🌟 Pilih Semua yang Tersedia',
                    value: 'all',
                    description: `Pilih semua aplikator aktif (${Array.from(availableApps).join(', ')})`
                }
            ];
            allApps.forEach(app => {
                if (availableApps.has(app.value)) {
                    aplikatorOptions.push({
                        label: app.label,
                        value: app.value,
                        description: `Tersedia untuk outlet terpilih`,
                        emoji: app.emoji
                    });
                }
            });

            const aplikatorResult = await this.askSelection(outletResult.lastInteraction, {
                title: 'Pilih Aplikator',
                step: 2,
                placeholder: 'Pilih satu atau lebih aplikator...',
                options: aplikatorOptions,
                minValues: 1,
                maxValues: aplikatorOptions.length,
                fields: [
                    { name: 'Jenis Laporan', value: formData.tagihan.toUpperCase(), inline: true },
                    { name: 'BD Terpilih', value: bdDisplay.length > 512 ? bdDisplay.substring(0, 508) + '...' : bdDisplay, inline: true },
                    { name: 'Outlet Terpilih', value: formData.outlet.length > 512 ? formData.outlet.substring(0, 508) + '...' : formData.outlet, inline: false }
                ]
            });

            const selectedAplikatorValues = aplikatorResult.values;
            if (selectedAplikatorValues.includes('all')) {
                formData.aplikator = Array.from(availableApps).map(val => {
                    if (val === 'gofood') return 'GoFood';
                    if (val === 'grabfood') return 'GrabFood';
                    if (val === 'shopeefood') return 'ShopeeFood';
                    return val;
                }).join(', ');
            } else {
                formData.aplikator = selectedAplikatorValues.map(val => {
                    if (val === 'gofood') return 'GoFood';
                    if (val === 'grabfood') return 'GrabFood';
                    if (val === 'shopeefood') return 'ShopeeFood';
                    return val;
                }).join(', ');
            }

            // 4. Pilih Rentang Tanggal
            const dateFields = [
                { name: 'Jenis Laporan', value: formData.tagihan.toUpperCase(), inline: true },
                { name: 'Aplikator', value: formData.aplikator, inline: true },
                { name: 'BD Terpilih', value: bdDisplay.length > 512 ? bdDisplay.substring(0, 508) + '...' : bdDisplay, inline: true },
                { name: 'Outlet Terpilih', value: formData.outlet.length > 512 ? formData.outlet.substring(0, 508) + '...' : formData.outlet, inline: false }
            ];

            const dateResult = await this.askDateModal(aplikatorResult.lastInteraction, 3, dateFields);
            formData.tanggalMulai = dateResult.tanggalMulai;
            formData.tanggalSelesai = dateResult.tanggalSelesai;

            // ── REVIEW & KONFIRMASI ─────────────────────────────────────────
            const reviewEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('📋 Review Data Sebelum Dijalankan')
                .setDescription('Periksa kembali data di bawah ini. Jika sudah benar, tekan **Jalankan Pipeline**. Proses ini membutuhkan waktu **5–15 menit** dan tidak bisa dibatalkan.')
                .addFields(
                    { name: 'Jenis Tagihan', value: formData.tagihan.toUpperCase(), inline: true },
                    { name: 'Aplikator', value: formData.aplikator, inline: true },
                    { name: 'BD', value: bdDisplay || 'Semua BD', inline: true },
                    { name: 'Rentang Tanggal', value: `📅 ${formData.tanggalMulai} s/d ${formData.tanggalSelesai}`, inline: false },
                    { name: 'Outlet', value: formData.outlet.length > 512 ? formData.outlet.substring(0, 508) + '...' : formData.outlet }
                )
                .setFooter({ text: 'Sistem Rekap Laporan Otomatis' })
                .setTimestamp();

            const confirmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('confirm_run')
                    .setLabel('✅ Jalankan Pipeline')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('cancel_run')
                    .setLabel('❌ Batalkan')
                    .setStyle(ButtonStyle.Danger)
            );

            await dateResult.lastInteraction.update({
                embeds: [reviewEmbed],
                components: [confirmRow]
            });
            message = await interaction.fetchReply();

            const confirmInteraction = await message.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id && ['confirm_run', 'cancel_run'].includes(i.customId),
                time: 300000
            });

            if (confirmInteraction.customId === 'cancel_run') {
                await confirmInteraction.update({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle('❌ Pipeline Dibatalkan')
                            .setDescription('Anda membatalkan eksekusi pipeline. Silakan jalankan `/start` kembali jika ingin mengulang.')
                            .setTimestamp()
                    ],
                    components: []
                });
                return;
            }

            // User confirmed — update ephemeral
            await confirmInteraction.update({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('✅ Pengisian Formulir Berhasil')
                        .setDescription('Data sudah dikonfirmasi. Pipeline sedang dijalankan di server.\nLihat progres di channel ini!')
                        .setTimestamp()
                ],
                components: []
            });

            // Kirim rangkuman final ke channel secara publik
            const summaryEmbed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Data Diterima')
                .setDescription('Berikut adalah rangkuman data laporan mingguan yang berhasil direkapitulasi secara otomatis.')
                .addFields(
                    { name: 'Jenis Tagihan', value: formData.tagihan.toUpperCase(), inline: true },
                    { name: 'Aplikator', value: formData.aplikator, inline: true },
                    { name: 'BD', value: bdDisplay || 'Semua BD', inline: true },
                    { name: 'Rentang Tanggal', value: `📅 ${formData.tanggalMulai} s/d ${formData.tanggalSelesai}`, inline: false },
                    { name: 'Outlet', value: formData.outlet.length > 1024 ? formData.outlet.substring(0, 1020) + '...' : formData.outlet }
                )
                .setFooter({ text: 'Sistem Rekap Laporan Otomatis' })
                .setTimestamp();

            await interaction.channel.send({ embeds: [summaryEmbed] });

            // ── Jalankan Pipeline OFD via Bridge ────────────────────────────────
            const { runPipeline } = require('../../../bridge/run_pipeline');

            // Status awal — LIVE PROGRESS
            let currentPhase = '🔄 Memulai pipeline...';
            let phaseNumber = 0;

            const selectedApps = selectedAplikatorValues.includes('all')
                ? Array.from(availableApps)
                : selectedAplikatorValues;

            const platforms = [];
            if (selectedApps.includes('gofood')) platforms.push('gofood');
            if (selectedApps.includes('grabfood')) platforms.push('grab');
            if (selectedApps.includes('shopeefood')) platforms.push('shopee');

            const steps = [];
            if (platforms.includes('grab')) {
                steps.push({ id: 'grab', name: '📗 Scraping data Grab...' });
            }
            if (platforms.includes('shopee')) {
                steps.push({ id: 'shopee', name: '🟠 Scraping data Shopee...' });
            }
            if (platforms.includes('gofood')) {
                steps.push({ id: 'gofood', name: '🟢 Scraping data GoFood...' });
            }
            if (platforms.length > 1) {
                steps.push({ id: 'merge', name: '📊 Menggabungkan laporan...' });
            }
            steps.push({ id: 'pdf', name: '📄 Membuat PDF Laporan...' });

            const totalPhases = steps.length;

            const makeProgressBar = (phase, total) => {
                const filled = '█'.repeat(phase);
                const empty = '░'.repeat(total - phase);
                return `[${filled}${empty}] ${phase}/${total}`;
            };

            const statusMsg = await interaction.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFFA500)
                        .setTitle('⏳ Pipeline Sedang Berjalan...')
                        .setDescription(
                            `Pipeline **${formData.tagihan.toUpperCase()}** sedang diproses.\n\n` +
                            `${makeProgressBar(0, totalPhases)}\n` +
                            `> 📍 **Outlet:** ${formData.outlet.substring(0, 100)}\n` +
                            `> 👤 **BD:** ${bdDisplay || 'Semua BD'}\n` +
                            `> 📱 **Platform:** ${formData.aplikator}\n` +
                            `> 📅 **Rentang:** ${formData.tanggalMulai} s/d ${formData.tanggalSelesai}\n\n` +
                            `🔄 *Memulai pipeline...*\n` +
                            `⏱️ Estimasi waktu: **3–10 menit**`
                        )
                        .setFooter({ text: 'Sistem Rekap Laporan Otomatis' })
                        .setTimestamp()
                ]
            });

            // Live progress updater — update setiap kali fase berubah
            let lastUpdateTime = Date.now();
            const MIN_UPDATE_INTERVAL = 5000; // minimal 5 detik antar update

            const updateProgress = async () => {
                try {
                    await statusMsg.edit({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(0xFFA500)
                                .setTitle('⏳ Pipeline Sedang Berjalan...')
                                .setDescription(
                                    `Pipeline **${formData.tagihan.toUpperCase()}** sedang diproses.\n\n` +
                                    `${makeProgressBar(phaseNumber, totalPhases)}\n` +
                                    `> 📍 **Outlet:** ${formData.outlet.substring(0, 100)}\n` +
                                    `> 👤 **BD:** ${bdDisplay || 'Semua BD'}\n` +
                                    `> 📱 **Platform:** ${formData.aplikator}\n` +
                                    `> 📅 **Rentang:** ${formData.tanggalMulai} s/d ${formData.tanggalSelesai}\n\n` +
                                    `${currentPhase}\n` +
                                    `⏱️ Estimasi waktu: **3–10 menit**`
                                )
                                .setFooter({ text: 'Sistem Rekap Laporan Otomatis' })
                                .setTimestamp()
                        ]
                    });
                } catch (e) { /* ignore edit errors */ }
            };

            // ── Job Lock Check — pastikan tidak ada pipeline yang sama berjalan ──
            const jobKey = buildJobKey(formData.outlet, formData.aplikator, formData.tanggalMulai, formData.tanggalSelesai);
            const acquired = acquireJob(jobKey, interaction.user.id, interaction.user.username);

            if (!acquired) {
                const existingJob = activeJobs.get(jobKey);
                const runningDuration = existingJob
                    ? Math.round((Date.now() - existingJob.startedAt.getTime()) / 1000 / 60)
                    : '?';

                await interaction.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF6B00)
                            .setTitle('⚠️ Pipeline Sedang Berjalan')
                            .setDescription(
                                `Pipeline untuk **${formData.outlet}** (${formData.aplikator}) sedang diproses oleh **${existingJob?.username || 'pengguna lain'}**.\n\n` +
                                `⏳ Sudah berjalan selama **${runningDuration} menit**.\n\n` +
                                `Mohon tunggu hingga proses selesai sebelum menjalankan pipeline yang sama.`
                            )
                            .addFields(
                                { name: '📍 Outlet', value: formData.outlet, inline: true },
                                { name: '📱 Platform', value: formData.aplikator, inline: true },
                                { name: '📅 Tanggal', value: `${formData.tanggalMulai} s/d ${formData.tanggalSelesai}`, inline: false }
                            )
                            .setFooter({ text: 'Sistem Rekap Laporan Otomatis' })
                            .setTimestamp()
                    ]
                });
                return;
            }

            console.log(`[JOB LOCK] Acquired by ${interaction.user.username}: ${jobKey}`);

            // Jalankan pipeline dengan live log tracking
            runPipeline(formData, async (logLine) => {
                console.log(`[PIPELINE] ${logLine}`);

                // Deteksi fase dari output log
                const lower = logLine.toLowerCase();
                let newPhase = null;

                let matchedIndex = -1;
                if (lower.includes('grab') && (lower.includes('pipeline') || lower.includes('automation') || lower.includes('fetching'))) {
                    matchedIndex = steps.findIndex(s => s.id === 'grab');
                } else if (lower.includes('shopee') && (lower.includes('pipeline') || lower.includes('launching') || lower.includes('triggering'))) {
                    matchedIndex = steps.findIndex(s => s.id === 'shopee');
                } else if (lower.includes('gofood') && (lower.includes('pipeline') || lower.includes('login') || lower.includes('scrapperv2') || lower.includes('memproses'))) {
                    matchedIndex = steps.findIndex(s => s.id === 'gofood');
                } else if (lower.includes('penggabungan') || lower.includes('gabung') || lower.includes('merging')) {
                    matchedIndex = steps.findIndex(s => s.id === 'merge');
                } else if (lower.includes('pdf') || lower.includes('apps script') || lower.includes('webhook')) {
                    matchedIndex = steps.findIndex(s => s.id === 'pdf');
                }

                if (matchedIndex !== -1) {
                    phaseNumber = matchedIndex + 1;
                    const step = steps[matchedIndex];
                    newPhase = `**[${phaseNumber}/${totalPhases}]** ${step.name}`;
                }

                if (newPhase && newPhase !== currentPhase) {
                    currentPhase = newPhase;
                    const now = Date.now();
                    if (now - lastUpdateTime >= MIN_UPDATE_INTERVAL) {
                        lastUpdateTime = now;
                        await updateProgress();
                    }
                }
            }).then(async (result) => {
                releaseJob(jobKey);
                // ── FINAL STATUS — Akurat berdasarkan hasil pipeline ──
                if (result.success) {
                    // Cek apakah output mengandung tanda partial failure
                    const hasWarning = result.output.includes('FAILED') ||
                        result.output.includes('No merchants to process') ||
                        result.output.includes('Tidak ditemukan file baseline');

                    const makeNotifEmbed = (title, color, defaultDesc) => {
                        const embed = new EmbedBuilder()
                            .setColor(color)
                            .setTitle(title)
                            .setTimestamp()
                            .setFooter({ text: 'Sistem Rekap Laporan Otomatis' });

                        const pdfUrl = result.notifData ? result.notifData.pdf_url : null;
                        const finalPdfUrl = pdfUrl || (result.output.replace(/\x1B\[[0-9;]*m/g, '').match(/URL:\s*(https:\/\/drive\.google\.com\/file\/d\/[^\s\r\n]+)/) || [])[1];

                        if (result.notifData) {
                            const { outlet, start_date, end_date, aplikator, pdf_name, omzet_gr, omzet_sf, order_gr, order_sf, omzet_go, order_go } = result.notifData;

                            const omzetLines = [];
                            const orderLines = [];
                            const lowerApp = aplikator.toLowerCase();

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

                            embed.setDescription(
                                `Laporan untuk **${outlet}** telah berhasil dibuat dan siap diunduh.\n\n` +
                                (finalPdfUrl ? `🔗 **[Klik di sini untuk membuka PDF](${finalPdfUrl})**` : '')
                            );

                            embed.addFields(
                                { name: '📍 Outlet', value: outlet, inline: true },
                                { name: '📱 Aplikator', value: aplikator, inline: true },
                                { name: '📅 Rentang Tanggal', value: `\`${start_date}\` → \`${end_date}\``, inline: false },
                                { name: '📊 Rata-rata Omzet', value: omzetStr, inline: true },
                                { name: '🛒 Rata-rata Order', value: orderStr, inline: true },
                                { name: '📁 Nama File', value: `\`${pdf_name}\``, inline: false }
                            );
                        } else {
                            embed.setDescription(
                                defaultDesc + `\n\n` +
                                (finalPdfUrl ? `🔗 **[Klik di sini untuk membuka PDF](${finalPdfUrl})**` : '')
                            );
                        }
                        return { embed, finalPdfUrl };
                    };

                    if (hasWarning) {
                        const { embed, finalPdfUrl } = makeNotifEmbed(
                            '⚠️ Pipeline Selesai dengan Peringatan',
                            0xFFAA00,
                            `Pipeline **${formData.tagihan.toUpperCase()}** selesai, tetapi ada beberapa peringatan:\n\n` +
                            `> Sebagian data mungkin tidak lengkap. Periksa laporan yang dihasilkan.`
                        );

                        const components = [];
                        if (finalPdfUrl) {
                            components.push(
                                new ActionRowBuilder().addComponents(
                                    new ButtonBuilder()
                                        .setLabel('📄 Buka PDF Laporan')
                                        .setStyle(ButtonStyle.Link)
                                        .setURL(finalPdfUrl)
                                )
                            );
                        }

                        await statusMsg.edit({
                            embeds: [embed],
                            components: components
                        });
                    } else {
                        const { embed, finalPdfUrl } = makeNotifEmbed(
                            '✅ Pipeline Selesai!',
                            0x00C853,
                            `Pipeline **${formData.tagihan.toUpperCase()}** berhasil dijalankan.\n` +
                            `${makeProgressBar(totalPhases, totalPhases)}`
                        );

                        const components = [];
                        if (finalPdfUrl) {
                            components.push(
                                new ActionRowBuilder().addComponents(
                                    new ButtonBuilder()
                                        .setLabel('📄 Buka PDF Laporan')
                                        .setStyle(ButtonStyle.Link)
                                        .setURL(finalPdfUrl)
                                )
                            );
                        }

                        await statusMsg.edit({
                            embeds: [embed],
                            components: components
                        });
                    }
                } else {
                    // Pipeline gagal (exit code ≠ 0)
                    const errSnippet = result.output.slice(-600)
                        .replace(/\x1B\[[0-9;]*m/g, '')  // strip ANSI
                        .replace(/```/g, "'''");
                    await statusMsg.edit({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(0xFF0000)
                                .setTitle('❌ Pipeline Gagal')
                                .setDescription(
                                    `Pipeline **${formData.tagihan.toUpperCase()}** gagal dijalankan.\n\n` +
                                    `**Exit Code:** \`${result.exitCode}\`\n` +
                                    `\`\`\`\n${errSnippet.substring(0, 1000)}\n\`\`\``
                                )
                                .setFooter({ text: 'Hubungi admin jika masalah berlanjut.' })
                                .setTimestamp()
                        ]
                    });
                }
            }).catch(async (err) => {
                releaseJob(jobKey);
                console.error('[PIPELINE] Unexpected error:', err);
                await statusMsg.edit({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle('❌ Pipeline Error Tidak Terduga')
                            .setDescription(`\`${err.message}\``)
                            .setTimestamp()
                    ]
                }).catch(() => { });
            });
            // ── End Pipeline ─────────────────────────────────────────────────────

        } catch (error) {
            // Lepas job lock jika sudah di-acquire tapi flow gagal (timeout/error sebelum pipeline selesai)
            if (typeof jobKey !== 'undefined' && activeJobs.has(jobKey)) {
                releaseJob(jobKey);
            }
            console.error('Error in form flow:', error);
            // Gunakan interaction original untuk merespon pembatalan sebagai fallback aman
            try {
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle('❌ Form Pengisian Dibatalkan')
                            .setDescription('Waktu pengisian formulir habis (timeout) atau terjadi kesalahan teknis. Silakan coba jalankan perintah `/start` kembali.')
                            .setTimestamp()
                    ],
                    components: []
                });
            } catch (err) {
                console.error('Failed to send error response:', err);
            }
        }
    },

    async askDateModal(interaction, step, fields) {
        let errorMsg = null;

        const calculateThreeFullMonths = () => {
            const today = new Date();
            const currentYear = today.getFullYear();
            const currentMonth = today.getMonth(); // 0-indexed (0 = Jan, 4 = May)

            // Start date: 1st day of month - 3 (e.g. Feb 1st if May)
            const startDate = new Date(currentYear, currentMonth - 3, 1);
            // End date: last day of month - 1 (day 0 of current month)
            const endDate = new Date(currentYear, currentMonth, 0);

            const format = (d) => {
                const day = String(d.getDate()).padStart(2, '0');
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const year = d.getFullYear();
                return `${day}-${month}-${year}`;
            };

            return {
                startStr: format(startDate),
                endStr: format(endDate)
            };
        };

        const { startStr, endStr } = calculateThreeFullMonths();

        const getEmbed = () => {
            let description = 'Silakan pilih **📅 3 Bulan Penuh** untuk langsung menggunakan data 3 bulan penuh terakhir, atau klik **⚙️ Custom Date Range** untuk memasukkan tanggal manual.';
            if (errorMsg) {
                description = `⚠️ **Format tidak valid:** ${errorMsg}\n\n${description}`;
            }
            return makeProgressEmbed(
                step,
                'Masukkan Rentang Tanggal',
                description,
                fields
            );
        };

        const getComponents = () => {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('shortcut_3_months_btn')
                    .setLabel(`📅 3 Bulan Penuh (${startStr} s/d ${endStr})`)
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('open_date_modal_btn')
                    .setLabel('⚙️ Custom Date Range')
                    .setStyle(ButtonStyle.Secondary)
            );
            return [row];
        };

        // Update interaction first to show the button
        await interaction.update({
            embeds: [getEmbed()],
            components: getComponents()
        });

        const msg = interaction.message || await interaction.fetchReply();

        return new Promise((resolve, reject) => {
            const collector = msg.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id && ['open_date_modal_btn', 'shortcut_3_months_btn'].includes(i.customId),
                time: 300000
            });

            let latestInteraction = null;

            collector.on('collect', async i => {
                latestInteraction = i;

                if (i.customId === 'shortcut_3_months_btn') {
                    errorMsg = null;
                    collector.stop('confirmed');
                    resolve({
                        tanggalMulai: startStr,
                        tanggalSelesai: endStr,
                        lastInteraction: i
                    });
                    return;
                }

                const modalId = `date_modal_${Date.now()}`;
                const modal = new ModalBuilder()
                    .setCustomId(modalId)
                    .setTitle('Rentang Tanggal Laporan');

                const startInput = new TextInputBuilder()
                    .setCustomId('start_date_input')
                    .setLabel('TANGGAL MULAI (DD-MM-YYYY)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Contoh: 01-02-2026')
                    .setMinLength(10)
                    .setMaxLength(10)
                    .setRequired(true);

                const endInput = new TextInputBuilder()
                    .setCustomId('end_date_input')
                    .setLabel('TANGGAL SELESAI (DD-MM-YYYY)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Contoh: 07-02-2026')
                    .setMinLength(10)
                    .setMaxLength(10)
                    .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(startInput),
                    new ActionRowBuilder().addComponents(endInput)
                );

                await i.showModal(modal);

                try {
                    const modalInteraction = await i.awaitModalSubmit({
                        filter: mi => mi.user.id === interaction.user.id && mi.customId === modalId,
                        time: 120000
                    });

                    latestInteraction = modalInteraction;

                    const startDateStr = modalInteraction.fields.getTextInputValue('start_date_input').trim();
                    const endDateStr = modalInteraction.fields.getTextInputValue('end_date_input').trim();

                    // Validation logic
                    const parseDate = (str) => {
                        const parts = str.split('-');
                        if (parts.length !== 3) return null;
                        const day = parseInt(parts[0], 10);
                        const month = parseInt(parts[1], 10);
                        const year = parseInt(parts[2], 10);
                        if (isNaN(day) || isNaN(month) || isNaN(year)) return null;

                        const date = new Date(year, month - 1, day);
                        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
                            return null;
                        }
                        return date;
                    };

                    const regex = /^\d{2}-\d{2}-\d{4}$/;
                    if (!regex.test(startDateStr) || !regex.test(endDateStr)) {
                        errorMsg = 'Format salah. Gunakan DD-MM-YYYY (contoh: 01-02-2026).';
                        await modalInteraction.update({
                            embeds: [getEmbed()],
                            components: getComponents()
                        });
                        return;
                    }

                    const startDate = parseDate(startDateStr);
                    const endDate = parseDate(endDateStr);

                    if (!startDate || !endDate) {
                        errorMsg = 'Nilai tanggal tidak ada di kalender (contoh: 31 Februari).';
                        await modalInteraction.update({
                            embeds: [getEmbed()],
                            components: getComponents()
                        });
                        return;
                    }

                    if (startDate > endDate) {
                        errorMsg = 'Tanggal Mulai tidak boleh melewati Tanggal Selesai.';
                        await modalInteraction.update({
                            embeds: [getEmbed()],
                            components: getComponents()
                        });
                        return;
                    }

                    // Success!
                    errorMsg = null;
                    collector.stop('confirmed');
                    resolve({
                        tanggalMulai: startDateStr,
                        tanggalSelesai: endDateStr,
                        lastInteraction: modalInteraction
                    });
                } catch (err) {
                    console.error('Modal submit/timeout error:', err);
                }
            });

            collector.on('end', (collected, reason) => {
                if (reason !== 'confirmed') {
                    reject(new Error('Timeout or cancelled'));
                }
            });
        });
    },

    async askSelection(interaction, { title, step, placeholder, options, minValues = 1, maxValues = 1, fields = [], isFirstStep = false }) {
        let selectedValues = new Set();

        const getComponents = () => {
            const rows = [];

            const chunks = [];
            for (let i = 0; i < options.length; i += 25) {
                chunks.push(options.slice(i, i + 25));
            }

            const safeChunks = chunks.slice(0, 4);

            safeChunks.forEach((chunk, index) => {
                const currentMax = Math.min(maxValues, chunk.length);

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`selection_menu_${index}`)
                    .setPlaceholder(placeholder + (safeChunks.length > 1 ? ` (Bagian ${index + 1})` : ''))
                    .setMinValues(0)
                    .setMaxValues(currentMax)
                    .addOptions(chunk.map(opt => ({
                        ...opt,
                        default: selectedValues.has(opt.value)
                    })));

                rows.push(new ActionRowBuilder().addComponents(selectMenu));
            });

            const selectedArray = Array.from(selectedValues);
            const hasDisabledSelected = selectedArray.some(val => val.endsWith('_disabled'));
            const isDisabled = selectedValues.size < minValues || hasDisabledSelected;

            const nextButton = new ButtonBuilder()
                .setCustomId('continue_btn')
                .setLabel(hasDisabledSelected ? '⚠️ Opsi tidak tersedia terpilih' : (selectedValues.size >= minValues ? '➡️ Lanjutkan' : (minValues === 1 ? 'Pilih opsi terlebih dahulu' : `Pilih minimal ${minValues} opsi`)))
                .setStyle(hasDisabledSelected ? ButtonStyle.Danger : (selectedValues.size >= minValues ? ButtonStyle.Success : ButtonStyle.Secondary))
                .setDisabled(isDisabled);

            rows.push(new ActionRowBuilder().addComponents(nextButton));

            return rows;
        };

        const getEmbed = () => {
            const selectedArray = Array.from(selectedValues);
            let description = `Silakan pilih opsi dari menu di bawah, lalu klik **Lanjutkan**.\n\n`;
            if (selectedArray.length > 0) {
                const labelList = selectedArray.map(val => {
                    const found = options.find(opt => opt.value === val);
                    return found ? found.label : val;
                }).join(', ');

                const displayList = labelList.length > 300 ? labelList.substring(0, 297) + '...' : labelList;
                description += `🔹 **Pilihan saat ini:** ${displayList}`;
            } else {
                description += `⚠️ *Belum ada opsi terpilih*`;
            }

            return makeProgressEmbed(step, title, description, fields);
        };

        if (isFirstStep) {
            await interaction.editReply({
                embeds: [getEmbed()],
                components: getComponents()
            });
        } else {
            await interaction.update({
                embeds: [getEmbed()],
                components: getComponents()
            });
        }

        const message = isFirstStep ? await interaction.fetchReply() : (interaction.message || await interaction.fetchReply());

        return new Promise((resolve, reject) => {
            const collector = message.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            });

            let latestInteraction = null;

            collector.on('collect', async i => {
                latestInteraction = i;
                if (i.customId.startsWith('selection_menu')) {
                    const menuIndex = parseInt(i.customId.split('_').pop());
                    const currentChunk = options.slice(menuIndex * 25, (menuIndex + 1) * 25);

                    currentChunk.forEach(opt => selectedValues.delete(opt.value));
                    i.values.forEach(val => selectedValues.add(val));

                    await i.update({
                        embeds: [getEmbed()],
                        components: getComponents()
                    });
                } else if (i.customId === 'continue_btn') {
                    collector.stop('confirmed');
                }
            });

            collector.on('end', (collected, reason) => {
                if (reason === 'confirmed' && latestInteraction) {
                    resolve({ values: Array.from(selectedValues), lastInteraction: latestInteraction });
                } else {
                    reject(new Error('Timeout or cancelled'));
                }
            });
        });
    },

    fetchSheetData() {
        const now = Date.now();
        if (cachedSheetData && (now - lastCacheTime < CACHE_DURATION)) {
            return Promise.resolve(cachedSheetData);
        }

        const baselineUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ3tLKBNXDqRgBw0mNhKZFxgvKx-JoiTDzm_s5Ix1cm7O6HCv4IvExOLR2HSRVaXSsx82V348mcr9X4/pub?gid=880434015&single=true&output=csv';
        const credsUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRYSUnKOqk29LCktTxdb0wPLbWMbRaWRP3eC_UA4AwYod1FW6zDMhtLMC5ghIvot2B8upCDfBsn-TCP/pub?gid=565510790&single=true&output=csv';

        return Promise.all([fetchCSV(baselineUrl), fetchCSV(credsUrl)])
            .then(([baselineData, credsData]) => {
                // Parse Credentials to map username -> BD Name
                const credsLines = credsData.split(/\r?\n/);
                const credsHeaders = credsLines[0].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(h => h.trim().replace(/^"|"$/g, ''));
                const userIdx = credsHeaders.indexOf('Username');
                const bdIdx = credsHeaders.indexOf('BD');

                const userToBdMap = {};
                const bdToUserMap = {};

                for (let i = 1; i < credsLines.length; i++) {
                    const line = credsLines[i].trim();
                    if (!line) continue;
                    const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
                    if (userIdx !== -1 && bdIdx !== -1 && cols.length > Math.max(userIdx, bdIdx)) {
                        const username = cols[userIdx];
                        const bdName = cols[bdIdx];
                        if (username && bdName && bdName !== '-') {
                            userToBdMap[username.toLowerCase()] = bdName;
                            bdToUserMap[bdName.toLowerCase()] = username.toLowerCase();
                        }
                    }
                }

                // Parse Master Baseline
                const baseLines = baselineData.split(/\r?\n/);
                const baseHeaders = baseLines[0].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(h => h.trim().replace(/^"|"$/g, ''));
                const nameIdx = baseHeaders.indexOf('Nama Outlet');
                const appIdx = baseHeaders.indexOf('Aplikasi');
                const usernameIdx = baseHeaders.indexOf('Nama Pengguna');

                const outlets = [];
                const outletAppMap = {};
                const outletBdMap = {}; // outlet name (lowercase) -> username/bd
                const bds = new Set();

                // Populate unique BD names strictly from credentials mapping
                for (const u in userToBdMap) {
                    bds.add(userToBdMap[u]);
                }

                const bdOutletsMap = {}; // bd name (lowercase) -> list of outlet names

                const outletSet = new Set();

                for (let i = 1; i < baseLines.length; i++) {
                    const line = baseLines[i].trim();
                    if (!line) continue;
                    const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());

                    if (nameIdx !== -1 && cols.length > nameIdx) {
                        const outletName = cols[nameIdx];
                        if (outletName && outletName !== '-') {
                            outletSet.add(outletName);
                            const normalizedOutlet = outletName.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 100);

                            // App normalization
                            if (appIdx !== -1 && cols.length > appIdx) {
                                const appName = cols[appIdx].toLowerCase();
                                let normApp = null;
                                if (appName.includes('go')) normApp = 'gofood';
                                if (appName.includes('grab')) normApp = 'grabfood';
                                if (appName.includes('shopee')) normApp = 'shopeefood';

                                if (normApp) {
                                    if (!outletAppMap[normalizedOutlet]) {
                                        outletAppMap[normalizedOutlet] = new Set();
                                    }
                                    outletAppMap[normalizedOutlet].add(normApp);
                                }
                            }

                            // BD matching
                            if (usernameIdx !== -1 && cols.length > usernameIdx) {
                                const username = cols[usernameIdx].toLowerCase();
                                const bdName = userToBdMap[username]; // ONLY map if username is found in credentials mapping
                                if (bdName) {
                                    const bdKey = bdName.toLowerCase();
                                    if (!bdOutletsMap[bdKey]) {
                                        bdOutletsMap[bdKey] = new Set();
                                    }
                                    bdOutletsMap[bdKey].add(outletName);

                                    if (!outletBdMap[normalizedOutlet]) {
                                        outletBdMap[normalizedOutlet] = new Set();
                                    }
                                    outletBdMap[normalizedOutlet].add(bdName);
                                }
                            }
                        }
                    }
                }

                // Convert sets to arrays
                const finalOutlets = Array.from(outletSet);
                const finalBds = Array.from(bds);

                const finalOutletAppMap = {};
                for (const k in outletAppMap) {
                    finalOutletAppMap[k] = Array.from(outletAppMap[k]);
                }

                const finalBdOutletsMap = {};
                for (const k in bdOutletsMap) {
                    finalBdOutletsMap[k] = Array.from(bdOutletsMap[k]);
                }

                const finalOutletBdMap = {};
                for (const k in outletBdMap) {
                    finalOutletBdMap[k] = Array.from(outletBdMap[k]);
                }

                const result = {
                    outlets: finalOutlets,
                    bds: finalBds,
                    userToBdMap,
                    bdToUserMap,
                    outletAppMap: finalOutletAppMap,
                    bdOutletsMap: finalBdOutletsMap,
                    outletBdMap: finalOutletBdMap
                };

                cachedSheetData = result;
                lastCacheTime = now;
                return result;
            });
    }
}