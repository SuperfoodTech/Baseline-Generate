const {
    SlashCommandBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    EmbedBuilder,
    StringSelectMenuBuilder
} = require('discord.js');
const https = require('https');

const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ3tLKBNXDqRgBw0mNhKZFxgvKx-JoiTDzm_s5Ix1cm7O6HCv4IvExOLR2HSRVaXSsx82V348mcr9X4/pub?gid=0&single=true&output=csv';

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

            // Kirim aplikatorResult.lastInteraction ke askDatePicker agar direspon secara atomik dengan .update()
            const resultMulai = await this.askDatePicker(aplikatorResult.lastInteraction, 'Pilih Tanggal Mulai', 4, dateFields);
            formData.tanggalMulai = resultMulai.date;

            const dateFieldsWithStart = [
                ...dateFields,
                { name: 'Tanggal Mulai', value: formData.tanggalMulai, inline: true }
            ];

            // Kirim resultMulai.lastInteraction ke askDatePicker berikutnya
            const resultSelesai = await this.askDatePicker(resultMulai.lastInteraction, 'Pilih Tanggal Selesai', 4, dateFieldsWithStart);
            formData.tanggalSelesai = resultSelesai.date;

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

            await resultSelesai.lastInteraction.update({
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
                        await statusMsg.edit({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(0xFFAA00)
                                    .setTitle('⚠️ Pipeline Selesai dengan Peringatan')
                                    .setDescription(
                                        `Pipeline **${formData.tagihan.toUpperCase()}** selesai, tetapi ada beberapa peringatan:\n\n` +
                                        `> Sebagian data mungkin tidak lengkap. Periksa laporan yang dihasilkan.\n` +
                                        `> Jika PDF terkirim, cek pesan di atas. ☝️\n\n` +
                                        `📄 Cek juga log server untuk detail.`
                                    )
                                    .setFooter({ text: 'Sistem Rekap Laporan Otomatis' })
                                    .setTimestamp()
                            ]
                        });
                    } else {
                        // Full success
                        await statusMsg.edit({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(0x00C853)
                                    .setTitle('✅ Pipeline Selesai!')
                                    .setDescription(
                                        `Pipeline **${formData.tagihan.toUpperCase()}** berhasil dijalankan.\n` +
                                        `${makeProgressBar(totalPhases, totalPhases)}\n\n` +
                                        `📄 **PDF laporan telah dikirim ke channel ini.** Cek pesan di atas! ☝️`
                                    )
                                    .setFooter({ text: 'Sistem Rekap Laporan Otomatis' })
                                    .setTimestamp()
                            ]
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

    async askDatePicker(interaction, title, step, fields) {
        let selectedDay = null;
        let selectedMonth = new Date().getMonth() + 1;
        let selectedYear = new Date().getFullYear();
        let dayPage = 1;

        const months = [
            'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
            'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
        ];

        const getComponents = () => {
            // Hitung jumlah hari valid untuk bulan+tahun yang dipilih
            const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();

            const rowMonth = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('select_month')
                    .setPlaceholder('Pilih Bulan')
                    .addOptions(months.map((m, i) => ({ label: m, value: (i + 1).toString(), default: selectedMonth === i + 1 })))
            );

            // Jika hari yang sudah dipilih melebihi batas bulan, reset ke null
            if (selectedDay && selectedDay > daysInMonth) {
                selectedDay = null;
            }

            // Halaman 1: hari 1-20, Halaman 2: hari 21-daysInMonth (bukan selalu 31)
            const startDay = dayPage === 1 ? 1 : 21;
            const endDay   = dayPage === 1 ? 20 : daysInMonth;
            const dayOptions = [];
            for (let i = startDay; i <= endDay; i++) {
                dayOptions.push({ label: i.toString(), value: i.toString(), default: selectedDay === i });
            }

            // Jika halaman 2 dan bulan tidak punya hari 21+, paksa ke halaman 1
            if (dayPage === 2 && startDay > daysInMonth) {
                dayPage = 1;
            }

            const rowDay = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('select_day')
                    .setPlaceholder(`Pilih Tanggal (${startDay}-${endDay})`)
                    .addOptions(dayOptions.length > 0 ? dayOptions : [{ label: '1', value: '1' }])
            );

            const rowPagination = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('prev_page')
                    .setLabel('⬅️ Halaman Hari 1-20')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(dayPage === 1),
                new ButtonBuilder()
                    .setCustomId('next_page')
                    .setLabel(`Halaman Hari 21-${daysInMonth} ➡️`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(dayPage === 2 || daysInMonth <= 20)
            );

            const rowYear = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('select_year')
                    .setPlaceholder('Pilih Tahun')
                    .addOptions([
                        { label: '2024', value: '2024', default: selectedYear === 2024 },
                        { label: '2025', value: '2025', default: selectedYear === 2025 },
                        { label: '2026', value: '2026', default: selectedYear === 2026 }
                    ])
            );

            const rowConfirm = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('confirm_date')
                    .setLabel(selectedDay ? `Konfirmasi: ${selectedDay}-${selectedMonth}-${selectedYear}` : 'Pilih Tanggal Dahulu')
                    .setStyle(selectedDay ? ButtonStyle.Success : ButtonStyle.Secondary)
                    .setDisabled(!selectedDay)
            );

            return [rowMonth, rowDay, rowPagination, rowYear, rowConfirm];
        };

        const getEmbed = () => {
            const dateStr = selectedDay ? `**${selectedDay.toString().padStart(2, '0')}-${selectedMonth.toString().padStart(2, '0')}-${selectedYear}**` : '*Belum ditentukan*';
            return makeProgressEmbed(
                step,
                title,
                `Silakan gunakan menu dropdown dan paginasi hari di bawah untuk memilih tanggal.\n\n📅 **Tanggal Terpilih Sementara:** ${dateStr}`,
                fields
            );
        };

        // Respon secara atomik menggunakan update() dari interaction yang dilewatkan
        await interaction.update({
            embeds: [getEmbed()],
            components: getComponents()
        });

        return new Promise((resolve, reject) => {
            const collector = interaction.message.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 300000
            });

            let latestInteraction = null;

            collector.on('collect', async i => {
                latestInteraction = i;
                if (i.customId === 'select_month') {
                    selectedMonth = parseInt(i.values[0]);
                    await i.update({ embeds: [getEmbed()], components: getComponents() });
                } else if (i.customId === 'select_day') {
                    selectedDay = parseInt(i.values[0]);
                    await i.update({ embeds: [getEmbed()], components: getComponents() });
                } else if (i.customId === 'select_year') {
                    selectedYear = parseInt(i.values[0]);
                    await i.update({ embeds: [getEmbed()], components: getComponents() });
                } else if (i.customId === 'next_page') {
                    dayPage = 2;
                    await i.update({ embeds: [getEmbed()], components: getComponents() });
                } else if (i.customId === 'prev_page') {
                    dayPage = 1;
                    await i.update({ embeds: [getEmbed()], components: getComponents() });
                } else if (i.customId === 'confirm_date') {
                    collector.stop('confirmed');
                }
            });

            collector.on('end', (collected, reason) => {
                if (reason === 'confirmed' && latestInteraction) {
                    const formattedDate = `${selectedDay.toString().padStart(2, '0')}-${selectedMonth.toString().padStart(2, '0')}-${selectedYear}`;
                    resolve({ date: formattedDate, lastInteraction: latestInteraction });
                } else {
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

        const message = await interaction.message || await interaction.fetchReply();

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

                            resolve({ outlets, outletBranchMap: finalMap });
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