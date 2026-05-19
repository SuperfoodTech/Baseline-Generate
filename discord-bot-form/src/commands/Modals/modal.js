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

const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ3tLKBNXDqRgBw0mNhKZFxgvKx-JoiTDzm_s5Ix1cm7O6HCv4IvExOLR2HSRVaXSsx82V348mcr9X4/pub?gid=0&single=true&output=csv';

let cachedSheetData = null;
let lastCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 menit cache


const makeProgressEmbed = (step, title, description, fields = []) => {
    const steps = [
        { name: 'Tagihan', icon: '📝' },
        { name: 'Outlet', icon: '🏢' },
        { name: 'Cabang', icon: '📍' },
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
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📊 Sinkronisasi Laporan Mingguan')
            .setDescription(
                'Halo! Saya siap membantu merekap data laporan mingguan Anda. Mari kita mulai proses sinkronisasi datanya.\n\n' +
                '**Pilih tipe laporan yang ingin Anda generate:**\n\n' +
                '🔹 **Baseline:** Untuk perbandingan standar performa.\n' +
                '🔹 **Weekly Billing:** Untuk rincian transaksi mingguan.\n\n' +
                'Klik tombol di bawah untuk mengisi formulir...'
            )
            .setFooter({ text: 'Sistem Rekap Laporan Otomatis' })
            .setTimestamp();

        const button = new ButtonBuilder()
            .setCustomId('open_tagihan_modal')
            .setLabel('Klik untuk mengisi formulir!')
            .setEmoji('📝')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(button);

        await interaction.reply({
            embeds: [embed],
            components: [row]
        });
    },

    async startFormFlow(interaction) {
        await interaction.deferReply({ flags: 64 });

        // Tampilkan loading screen yang estetik
        const loadingEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🔄 Menghubungkan ke Google Sheets...')
            .setDescription('Mohon tunggu sejenak, kami sedang menyinkronkan daftar outlet dan cabang terbaru secara langsung...')
            .setFooter({ text: 'Sistem Rekap Laporan Otomatis' })
            .setTimestamp();

        let message = await interaction.editReply({ embeds: [loadingEmbed], components: [] });

        try {
            const { outlets, outletBranchMap } = await this.fetchSheetData();
            const formData = {};

            // 1. Pilih Jenis Tagihan
            const taskResult = await this.askSelection(interaction, {
                title: 'Pilih Jenis Laporan',
                step: 0,
                placeholder: 'Pilih Jenis Tagihan',
                options: [
                    { label: 'Baseline', value: 'baseline', description: 'Laporan perbandingan standar performa' },
                    { label: 'Weekly (Coming Soon)', value: 'weekly_disabled', description: '⚠️ Fitur ini belum tersedia' }
                ],
                isFirstStep: true
            });

            // Blokir jika user pilih Weekly (disabled)
            if (taskResult.values[0] === 'weekly_disabled') {
                await taskResult.lastInteraction.update({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFFAA00)
                            .setTitle('⚠️ Fitur Weekly Belum Tersedia')
                            .setDescription('Saat ini hanya mode **Baseline** yang tersedia. Fitur Weekly akan segera hadir.\nSilakan jalankan `/start` dan pilih **Baseline**.')
                            .setTimestamp()
                    ],
                    components: []
                });
                return;
            }
            formData.tagihan = taskResult.values[0];

            // 2. Pilih Outlet
            const maxOutletOpts = outlets.length > 24 ? 24 : outlets.length;
            const outletOptions = [
                { label: '🌟 Pilih Semua', value: 'all' },
                ...outlets.slice(0, 24).map(name => ({
                    label: name.substring(0, 100),
                    value: name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 100)
                }))
            ];

            const outletResult = await this.askSelection(taskResult.lastInteraction, {
                title: 'Pilih Outlet',
                step: 1,
                placeholder: 'Pilih satu atau lebih outlet...',
                options: outletOptions,
                minValues: 1,
                maxValues: maxOutletOpts + 1,
                fields: [
                    { name: 'Jenis Laporan', value: formData.tagihan.toUpperCase(), inline: true }
                ]
            });

            const selectedOutletValues = outletResult.values;
            let selectedOutletNames;
            if (selectedOutletValues.includes('all')) {
                selectedOutletNames = outlets.slice(0, 24);
            } else {
                selectedOutletNames = outlets.filter(name =>
                    selectedOutletValues.includes(name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 100))
                );
            }
            formData.outlet = selectedOutletNames.join(', ');

            // 3. Filter Cabang berdasarkan Outlet yang dipilih
            let filteredBranchesSet = new Set();
            let outletValuesForBranches = selectedOutletValues;
            if (selectedOutletValues.includes('all')) {
                outletValuesForBranches = outlets.slice(0, 24).map(name =>
                    name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 100)
                );
            }
            outletValuesForBranches.forEach(outletVal => {
                const branchesForOutlet = outletBranchMap[outletVal] || [];
                branchesForOutlet.forEach(b => filteredBranchesSet.add(b));
            });
            let filteredBranches = Array.from(filteredBranchesSet);
            if (filteredBranches.length === 0) filteredBranches = ['Pilih Cabang (Tidak ada data)'];

            const maxCabangOpts = filteredBranches.length > 24 ? 24 : filteredBranches.length;
            const cabangOptions = [
                { label: '🌟 Pilih Semua', value: 'all' },
                ...filteredBranches.slice(0, 24).map(name => ({
                    label: name.substring(0, 100),
                    value: name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 100)
                }))
            ];

            const cabangResult = await this.askSelection(outletResult.lastInteraction, {
                title: 'Pilih Cabang',
                step: 2,
                placeholder: 'Pilih satu atau lebih cabang...',
                options: cabangOptions,
                minValues: 1,
                maxValues: maxCabangOpts + 1,
                fields: [
                    { name: 'Jenis Laporan', value: formData.tagihan.toUpperCase(), inline: true },
                    { name: 'Outlet Terpilih', value: formData.outlet.length > 1024 ? formData.outlet.substring(0, 1020) + '...' : formData.outlet, inline: false }
                ]
            });

            const selectedCabangValues = cabangResult.values;
            let selectedCabangNames;
            if (selectedCabangValues.includes('all')) {
                selectedCabangNames = filteredBranches.slice(0, 24);
            } else {
                selectedCabangNames = filteredBranches.filter(name =>
                    selectedCabangValues.includes(name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 100))
                );
            }
            formData.cabang = selectedCabangNames.join(', ');

            // 4. Pilih Aplikator
            const aplikatorOptions = [
                { label: '🌟 Pilih Semua', value: 'all' },
                { label: 'GoFood', value: 'gofood' },
                { label: 'GrabFood', value: 'grabfood' },
                { label: 'ShopeeFood', value: 'shopeefood' }
            ];

            const aplikatorResult = await this.askSelection(cabangResult.lastInteraction, {
                title: 'Pilih Aplikator',
                step: 3,
                placeholder: 'Pilih satu atau lebih aplikator...',
                options: aplikatorOptions,
                minValues: 1,
                maxValues: 4,
                fields: [
                    { name: 'Jenis Laporan', value: formData.tagihan.toUpperCase(), inline: true },
                    { name: 'Outlet Terpilih', value: formData.outlet.length > 512 ? formData.outlet.substring(0, 508) + '...' : formData.outlet, inline: false },
                    { name: 'Cabang Terpilih', value: formData.cabang.length > 512 ? formData.cabang.substring(0, 508) + '...' : formData.cabang, inline: false }
                ]
            });

            const selectedAplikatorValues = aplikatorResult.values;
            if (selectedAplikatorValues.includes('all')) {
                formData.aplikator = 'GoFood, GrabFood, ShopeeFood';
            } else {
                formData.aplikator = selectedAplikatorValues.map(val => {
                    if (val === 'gofood') return 'GoFood';
                    if (val === 'grabfood') return 'GrabFood';
                    if (val === 'shopeefood') return 'ShopeeFood';
                    return val;
                }).join(', ');
            }

            // 5. Pilih Rentang Tanggal
            const dateFields = [
                { name: 'Jenis Laporan', value: formData.tagihan.toUpperCase(), inline: true },
                { name: 'Aplikator', value: formData.aplikator, inline: true },
                { name: 'Outlet Terpilih', value: formData.outlet.length > 512 ? formData.outlet.substring(0, 508) + '...' : formData.outlet, inline: false },
                { name: 'Cabang Terpilih', value: formData.cabang.length > 512 ? formData.cabang.substring(0, 508) + '...' : formData.cabang, inline: false }
            ];

            // Kirim aplikatorResult.lastInteraction ke askDateModal agar direspon secara atomik dengan .update()
            const dateResult = await this.askDateModal(aplikatorResult.lastInteraction, 4, dateFields);
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
                    { name: 'Rentang Tanggal', value: `📅 ${formData.tanggalMulai} s/d ${formData.tanggalSelesai}`, inline: false },
                    { name: 'Outlet', value: formData.outlet.length > 512 ? formData.outlet.substring(0, 508) + '...' : formData.outlet },
                    { name: 'Cabang', value: formData.cabang.length > 512 ? formData.cabang.substring(0, 508) + '...' : formData.cabang }
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
                    { name: 'Rentang Tanggal', value: `📅 ${formData.tanggalMulai} s/d ${formData.tanggalSelesai}`, inline: false },
                    { name: 'Outlet', value: formData.outlet.length > 1024 ? formData.outlet.substring(0, 1020) + '...' : formData.outlet },
                    { name: 'Cabang', value: formData.cabang.length > 1024 ? formData.cabang.substring(0, 1020) + '...' : formData.cabang }
                )
                .setFooter({ text: 'Sistem Rekap Laporan Otomatis • Antigravity' })
                .setTimestamp();

            await interaction.channel.send({ embeds: [summaryEmbed] });

            // ── Jalankan Pipeline OFD via Bridge ────────────────────────────────
            const { runPipeline } = require('../../../bridge/run_pipeline');

            // Status awal — LIVE PROGRESS
            let currentPhase = '🔄 Memulai pipeline...';
            let phaseNumber = 0;
            const totalPhases = 4;

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
                            `> 📱 **Platform:** ${formData.aplikator}\n` +
                            `> 📅 **Rentang:** ${formData.tanggalMulai} s/d ${formData.tanggalSelesai}\n\n` +
                            `🔄 *Memulai pipeline...*\n` +
                            `⏱️ Estimasi waktu: **5–15 menit**`
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
                                    `> 📱 **Platform:** ${formData.aplikator}\n` +
                                    `> 📅 **Rentang:** ${formData.tanggalMulai} s/d ${formData.tanggalSelesai}\n\n` +
                                    `${currentPhase}\n` +
                                    `⏱️ Estimasi waktu: **5–15 menit**`
                                )
                                .setFooter({ text: 'Sistem Rekap Laporan Otomatis' })
                                .setTimestamp()
                        ]
                    });
                } catch (e) { /* ignore edit errors */ }
            };

            // Jalankan pipeline dengan live log tracking
            runPipeline(formData, async (logLine) => {
                console.log(`[PIPELINE] ${logLine}`);

                // Deteksi fase dari output log
                const lower = logLine.toLowerCase();
                let newPhase = null;

                if (lower.includes('grab') && (lower.includes('pipeline') || lower.includes('automation') || lower.includes('fetching'))) {
                    newPhase = '📗 **[1/4]** Scraping data Grab...';
                    phaseNumber = 1;
                } else if (lower.includes('shopee') && (lower.includes('pipeline') || lower.includes('launching') || lower.includes('triggering'))) {
                    newPhase = '🟠 **[2/4]** Scraping data Shopee...';
                    phaseNumber = 2;
                } else if (lower.includes('penggabungan') || lower.includes('gabung') || lower.includes('merging')) {
                    newPhase = '📊 **[3/4]** Menggabungkan laporan Grab + Shopee...';
                    phaseNumber = 3;
                } else if (lower.includes('pdf') || lower.includes('apps script') || lower.includes('webhook')) {
                    newPhase = '📄 **[4/4]** Membuat PDF & mengirim ke Discord...';
                    phaseNumber = 4;
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
                // ── FINAL STATUS — Akurat berdasarkan hasil pipeline ──
                if (result.success) {
                    // Cek apakah output mengandung tanda partial failure
                    const hasWarning = result.output.includes('FAILED') ||
                                       result.output.includes('No merchants to process') ||
                                       result.output.includes('Tidak ditemukan file baseline');
                    
                    if (hasWarning) {
                        // Pipeline exit 0 tapi ada warning — partial success
                        const cleanOutput = result.output.replace(/\x1B\[[0-9;]*m/g, '');
                        const pdfUrlMatch = cleanOutput.match(/URL:\s*(https:\/\/drive\.google\.com\/file\/d\/[^\s\r\n]+)/);
                        const pdfUrl = pdfUrlMatch ? pdfUrlMatch[1].trim() : null;

                        const embed = new EmbedBuilder()
                            .setColor(0xFFAA00)
                            .setTitle('⚠️ Pipeline Selesai dengan Peringatan')
                            .setDescription(
                                `Pipeline **${formData.tagihan.toUpperCase()}** selesai, tetapi ada beberapa peringatan:\n\n` +
                                `> Sebagian data mungkin tidak lengkap. Periksa laporan yang dihasilkan.\n` +
                                (pdfUrl 
                                    ? `🔗 **[Klik di sini untuk membuka PDF](${pdfUrl})**`
                                    : `> Jika PDF terkirim, cek pesan di atas. ☝️`) + `\n\n` +
                                `📄 Cek juga log server untuk detail.`
                            )
                            .setFooter({ text: 'Sistem Rekap Laporan Otomatis' })
                            .setTimestamp();

                        const components = [];
                        if (pdfUrl) {
                            components.push(
                                new ActionRowBuilder().addComponents(
                                    new ButtonBuilder()
                                        .setLabel('📄 Buka PDF Laporan')
                                        .setStyle(ButtonStyle.Link)
                                        .setURL(pdfUrl)
                                )
                            );
                        }

                        await statusMsg.edit({
                            embeds: [embed],
                            components: components
                        });
                    } else {
                        // Full success
                        const cleanOutput = result.output.replace(/\x1B\[[0-9;]*m/g, '');
                        const pdfUrlMatch = cleanOutput.match(/URL:\s*(https:\/\/drive\.google\.com\/file\/d\/[^\s\r\n]+)/);
                        const pdfUrl = pdfUrlMatch ? pdfUrlMatch[1].trim() : null;

                        const embed = new EmbedBuilder()
                            .setColor(0x00C853)
                            .setTitle('✅ Pipeline Selesai!')
                            .setDescription(
                                `Pipeline **${formData.tagihan.toUpperCase()}** berhasil dijalankan.\n` +
                                `${makeProgressBar(totalPhases, totalPhases)}\n\n` +
                                (pdfUrl 
                                    ? `🔗 **[Klik di sini untuk membuka PDF](${pdfUrl})**`
                                    : `📄 **PDF laporan telah dikirim ke channel ini.** Cek pesan di atas! ☝️`)
                            )
                            .setFooter({ text: 'Sistem Rekap Laporan Otomatis' })
                            .setTimestamp();

                        const components = [];
                        if (pdfUrl) {
                            components.push(
                                new ActionRowBuilder().addComponents(
                                    new ButtonBuilder()
                                        .setLabel('📄 Buka PDF Laporan')
                                        .setStyle(ButtonStyle.Link)
                                        .setURL(pdfUrl)
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
                console.error('[PIPELINE] Unexpected error:', err);
                await statusMsg.edit({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle('❌ Pipeline Error Tidak Terduga')
                            .setDescription(`\`${err.message}\``)
                            .setTimestamp()
                    ]
                }).catch(() => {});
            });
            // ── End Pipeline ─────────────────────────────────────────────────────

        } catch (error) {
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

        const getEmbed = () => {
            let description = 'Silakan klik tombol **📅 Atur Rentang Tanggal** di bawah untuk memasukkan tanggal mulai dan tanggal selesai melalui popup formulir.';
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
                    .setCustomId('open_date_modal_btn')
                    .setLabel('📅 Atur Rentang Tanggal')
                    .setStyle(ButtonStyle.Primary)
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
                filter: i => i.user.id === interaction.user.id && i.customId === 'open_date_modal_btn',
                time: 300000
            });

            let latestInteraction = null;

            collector.on('collect', async i => {
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
        let selectedValues = [];

        const getComponents = () => {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('selection_menu')
                .setPlaceholder(placeholder)
                .setMinValues(minValues)
                .setMaxValues(maxValues)
                .addOptions(options.map(opt => ({
                    ...opt,
                    default: selectedValues.includes(opt.value)
                })));

            const selectRow = new ActionRowBuilder().addComponents(selectMenu);

            const nextButton = new ButtonBuilder()
                .setCustomId('continue_btn')
                .setLabel(selectedValues.length > 0 ? '➡️ Lanjutkan' : 'Pilih opsi terlebih dahulu')
                .setStyle(selectedValues.length > 0 ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(selectedValues.length === 0);

            const buttonRow = new ActionRowBuilder().addComponents(nextButton);

            return [selectRow, buttonRow];
        };

        const getEmbed = () => {
            let description = `Silakan pilih opsi dari menu di bawah, lalu klik **Lanjutkan**.\n\n`;
            if (selectedValues.length > 0) {
                const labelList = selectedValues.map(val => {
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
                if (i.customId === 'selection_menu') {
                    selectedValues = i.values;
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
                    resolve({ values: selectedValues, lastInteraction: latestInteraction });
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

        return new Promise((resolve, reject) => {
            const fetchUrl = (url) => {
                https.get(url, (res) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        return fetchUrl(res.headers.location);
                    }
                    if (res.statusCode !== 200) {
                        return reject(new Error(`HTTP Status ${res.statusCode}`));
                    }
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => {
                        try {
                            const lines = data.split(/\r?\n/);
                            if (lines.length < 2) {
                                return resolve({ outlets: [], outletBranchMap: {} });
                            }
                            const headers = lines[0].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
                            const nameIdx = headers.findIndex(h => h.trim().replace(/^"|"$/g, '') === 'Nama Outlet');
                            const statusIdx = headers.findIndex(h => h.trim().replace(/^"|"$/g, '') === 'Status');
                            const cabangIdx = headers.findIndex(h => h.trim().replace(/^"|"$/g, '') === 'Cabang');

                            const outletSet = new Set();
                            const outletBranchMap = {};

                            for (let i = 1; i < lines.length; i++) {
                                const line = lines[i].trim();
                                if (!line) continue;
                                const columns = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);

                                if (nameIdx !== -1 && statusIdx !== -1 && columns.length > Math.max(nameIdx, statusIdx)) {
                                    let outletName = columns[nameIdx].replace(/^"|"$/g, '').trim();
                                    let status = columns[statusIdx].replace(/^"|"$/g, '').trim();

                                    if (outletName && outletName !== '-' && outletName !== '' && status === 'Live') {
                                        outletSet.add(outletName);

                                        const normalizedOutlet = outletName.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 100);
                                        if (!outletBranchMap[normalizedOutlet]) {
                                            outletBranchMap[normalizedOutlet] = new Set();
                                        }

                                        if (cabangIdx !== -1 && columns.length > cabangIdx) {
                                            let cabangName = columns[cabangIdx].replace(/^"|"$/g, '').trim();
                                            if (cabangName && cabangName !== '-' && cabangName !== '') {
                                                outletBranchMap[normalizedOutlet].add(cabangName);
                                            }
                                        }
                                    }
                                }
                            }

                            const outlets = Array.from(outletSet);
                            const finalMap = {};
                            for (const key in outletBranchMap) {
                                finalMap[key] = Array.from(outletBranchMap[key]);
                            }

                            const result = { outlets, outletBranchMap: finalMap };
                            cachedSheetData = result;
                            lastCacheTime = now;
                            resolve(result);
                        } catch (e) {
                            reject(e);
                        }
                    });
                }).on('error', (err) => reject(err));
            };
            fetchUrl(SHEET_CSV_URL);
        });
    }
}