const { 
    SlashCommandBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder,
    AttachmentBuilder,
    StringSelectMenuBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { runWeeklyPipeline } = require('../../../bridge/run_weekly_pipeline');
const modalCmd = require('./modal');

// Path to weekly directory
const WEEKLY_DIR = path.resolve(__dirname, '../../../../weekly');

// Memory lock for active weekly pipeline jobs
let isWeeklyJobRunning = false;
let activeWeeklyProcess = null;

// Progress steps helper
const makeProgressEmbed = (currentStepName, title, description, fields = [], hasOutletStep = true) => {
    const allSteps = [
        { name: 'Aplikator', icon: '📱' },
        { name: 'Cakupan', icon: '🏢' }
    ];
    if (hasOutletStep) {
        allSteps.push({ name: 'Outlet', icon: '🏪' });
    }
    allSteps.push({ name: 'Periode', icon: '📅' });

    let progressStr = '';
    const currentStepIdx = allSteps.findIndex(s => s.name === currentStepName);

    for (let i = 0; i < allSteps.length; i++) {
        if (i < currentStepIdx) {
            progressStr += `✅ **${allSteps[i].name}**`;
        } else if (i === currentStepIdx) {
            progressStr += `🔵 __**${allSteps[i].name}**__`;
        } else {
            progressStr += `⚪ ${allSteps[i].name}`;
        }
        if (i < allSteps.length - 1) {
            progressStr += ' ➔ ';
        }
    }

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(title)
        .setDescription(`**Langkah Progres:**\n${progressStr}\n\n${description}`)
        .setFooter({ text: 'Sistem Weekly Agency Performance' })
        .setTimestamp();

    if (fields && fields.length > 0) {
        embed.addFields(fields);
    }

    return embed;
};

// Selection helper
async function askSelection(interaction, { stepName, title, placeholder, options, minValues = 1, maxValues = 1, fields = [], isFirstStep = false, hasOutletStep = true }) {
    let selectedValues = new Set();

    const getComponents = () => {
        const rows = [];
        const chunks = [];
        for (let i = 0; i < options.length; i += 25) {
            chunks.push(options.slice(i, i + 25));
        }

        const safeChunks = chunks.slice(0, 4); // Limit to 4 select menus
        safeChunks.forEach((chunk, index) => {
            const currentMax = Math.min(maxValues, chunk.length);

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`agency_selection_menu_${index}`)
                .setPlaceholder(placeholder + (safeChunks.length > 1 ? ` (Bagian ${index + 1})` : ''))
                .setMinValues(0)
                .setMaxValues(currentMax)
                .addOptions(chunk.map(opt => ({
                    ...opt,
                    default: selectedValues.has(opt.value)
                })));

            rows.push(new ActionRowBuilder().addComponents(selectMenu));
        });

        const isDisabled = selectedValues.size < minValues;

        const nextButton = new ButtonBuilder()
            .setCustomId('agency_continue_btn')
            .setLabel(selectedValues.size >= minValues ? '➡️ Lanjutkan' : (minValues === 1 ? 'Pilih opsi terlebih dahulu' : `Pilih minimal ${minValues} opsi`))
            .setStyle(selectedValues.size >= minValues ? ButtonStyle.Success : ButtonStyle.Secondary)
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

        return makeProgressEmbed(stepName, title, description, fields, hasOutletStep);
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
            if (i.customId.startsWith('agency_selection_menu')) {
                const menuIndex = parseInt(i.customId.split('_').pop());
                const currentChunk = options.slice(menuIndex * 25, (menuIndex + 1) * 25);

                currentChunk.forEach(opt => selectedValues.delete(opt.value));
                i.values.forEach(val => selectedValues.add(val));

                await i.update({
                    embeds: [getEmbed()],
                    components: getComponents()
                });
            } else if (i.customId === 'agency_continue_btn') {
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
}

// Date helpers
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

const toISOFormat = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('agency')
        .setDescription('Kirim formulir Laporan Transaksi Mingguan (Weekly) Agency'),

    async execute(interaction) {
        if (isWeeklyJobRunning) {
            return interaction.reply({
                content: '⚠️ **Sistem Sibuk!** Laporan Weekly Agency lain sedang berjalan. Harap tunggu hingga proses sebelumnya selesai.',
                flags: 64
            });
        }

        await interaction.deferReply({ flags: 64 });

        let sheetData;
        try {
            sheetData = await modalCmd.fetchSheetData();
        } catch (err) {
            console.error('Gagal mengambil data sheet:', err);
            sheetData = { outlets: [] };
        }
        const allOutlets = sheetData.outlets || [];

        try {
            // STEP 0: Pilih Aplikator
            const aplikatorResult = await askSelection(interaction, {
                stepName: 'Aplikator',
                title: '📱 Pilih Aplikator',
                placeholder: 'Pilih platform aplikator...',
                options: [
                    { label: '🌟 Semua Aplikator', value: 'all', description: 'Tarik data untuk GrabFood & ShopeeFood' },
                    { label: 'GrabFood', value: 'grab', emoji: { name: '🟢' }, description: 'Hanya tarik data GrabFood' },
                    { label: 'ShopeeFood', value: 'shopee', emoji: { name: '🟠' }, description: 'Hanya tarik data ShopeeFood' }
                ],
                minValues: 1,
                maxValues: 1,
                isFirstStep: true,
                hasOutletStep: true
            });

            const platform = aplikatorResult.values[0];

            // STEP 1: Pilih Cakupan Tarikan
            const scopeResult = await askSelection(aplikatorResult.lastInteraction, {
                stepName: 'Cakupan',
                title: '🏢 Cakupan Outlet',
                placeholder: 'Pilih cakupan outlet...',
                options: [
                    { label: 'Semua Outlet', value: 'all_outlets', description: 'Tarik data untuk seluruh outlet di GSheets' },
                    { label: 'Pilih Merchant Tertentu', value: 'select_merchant', description: 'Pilih satu atau lebih outlet dari daftar' }
                ],
                minValues: 1,
                maxValues: 1,
                fields: [
                    { name: 'Platform', value: platform.toUpperCase(), inline: true }
                ],
                hasOutletStep: true
            });

            const scope = scopeResult.values[0];
            const hasOutletStep = scope === 'select_merchant';

            let selectedOutlets = [];
            let lastInteractionAfterOutlet = scopeResult.lastInteraction;

            // STEP 2: Pilih Outlet (Jika select_merchant)
            if (hasOutletStep) {
                if (allOutlets.length === 0) {
                    return lastInteractionAfterOutlet.reply({
                        content: '❌ Gagal meload daftar outlet dari Google Sheets.',
                        flags: 64
                    });
                }

                const outletOptions = allOutlets.map(name => ({
                    label: name.substring(0, 100),
                    value: name
                }));

                const outletResult = await askSelection(scopeResult.lastInteraction, {
                    stepName: 'Outlet',
                    title: '🏪 Pilih Outlet',
                    placeholder: 'Pilih satu atau lebih outlet...',
                    options: outletOptions,
                    minValues: 1,
                    maxValues: outletOptions.length,
                    fields: [
                        { name: 'Platform', value: platform.toUpperCase(), inline: true },
                        { name: 'Cakupan', value: 'Merchant Terpilih', inline: true }
                    ],
                    hasOutletStep: true
                });

                selectedOutlets = outletResult.values;
                lastInteractionAfterOutlet = outletResult.lastInteraction;
            }

            // STEP 3: Pilih Periode
            // Hitung tanggal default (7 hari terakhir, Senin - Minggu)
            const today = new Date();
            const dayOfWeek = today.getDay();
            const daysToLastSunday = dayOfWeek === 0 ? 7 : dayOfWeek;
            const lastSunday = new Date(today);
            lastSunday.setDate(today.getDate() - daysToLastSunday);
            const lastMonday = new Date(lastSunday);
            lastMonday.setDate(lastSunday.getDate() - 6);

            const formatDateDisplay = (d) => {
                const day = String(d.getDate()).padStart(2, '0');
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const year = d.getFullYear();
                return `${day}-${month}-${year}`;
            };

            const defaultStartDisp = formatDateDisplay(lastMonday);
            const defaultEndDisp = formatDateDisplay(lastSunday);

            const defaultStartISO = toISOFormat(lastMonday);
            const defaultEndISO = toISOFormat(lastSunday);

            const periodeOptions = [
                { label: '7 Hari Penuh (Senin-Minggu)', value: '7_days_full', description: `${defaultStartDisp} s/d ${defaultEndDisp}` },
                { label: 'Input Tanggal Manual (Custom)', value: 'custom_date', description: 'Tentukan rentang tanggal secara bebas' }
            ];

            const currentFields = [
                { name: 'Platform', value: platform.toUpperCase(), inline: true },
                { name: 'Cakupan', value: hasOutletStep ? `Merchant Terpilih (${selectedOutlets.length})` : 'Semua Outlet', inline: true }
            ];

            const periodResult = await askSelection(lastInteractionAfterOutlet, {
                stepName: 'Periode',
                title: '📅 Pilih Periode',
                placeholder: 'Pilih tipe periode...',
                options: periodeOptions,
                minValues: 1,
                maxValues: 1,
                fields: currentFields,
                hasOutletStep: hasOutletStep
            });

            const periodChoice = periodResult.values[0];
            let startDate = '';
            let endDate = '';
            let finalInteraction = periodResult.lastInteraction;

            if (periodChoice === '7_days_full') {
                startDate = defaultStartISO;
                endDate = defaultEndISO;
            } else {
                // Tampilkan menu tombol agar user bisa mengklik untuk input tanggal manual
                let errorMsg = null;

                const getEmbed = () => {
                    let desc = 'Silakan klik tombol **Input Tanggal** di bawah untuk menentukan rentang tanggal manual.';
                    if (errorMsg) {
                        desc += `\n\n❌ **Error:** ${errorMsg}`;
                    }
                    return makeProgressEmbed('Periode', '📅 Input Tanggal Manual', desc, currentFields, hasOutletStep);
                };

                const getComponents = () => {
                    return [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('agency_open_date_modal_btn')
                                .setLabel('📝 Input Tanggal')
                                .setStyle(ButtonStyle.Primary)
                        )
                    ];
                };

                await finalInteraction.update({
                    embeds: [getEmbed()],
                    components: getComponents()
                });

                const msg = finalInteraction.message || await finalInteraction.fetchReply();

                const getDates = () => {
                    return new Promise((resolveDate, rejectDate) => {
                        const collector = msg.createMessageComponentCollector({
                            filter: i => i.user.id === interaction.user.id && i.customId === 'agency_open_date_modal_btn',
                            time: 300000
                        });

                        collector.on('collect', async i => {
                            const modalId = `agency_date_modal_${Date.now()}`;
                            const dateModal = new ModalBuilder()
                                .setCustomId(modalId)
                                .setTitle('Rentang Tanggal Custom');

                            const startInput = new TextInputBuilder()
                                .setCustomId('start_date_input')
                                .setLabel('TANGGAL MULAI (DD-MM-YYYY)')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('Contoh: 01-06-2026')
                                .setMinLength(10)
                                .setMaxLength(10)
                                .setRequired(true);

                            const endInput = new TextInputBuilder()
                                .setCustomId('end_date_input')
                                .setLabel('TANGGAL SELESAI (DD-MM-YYYY)')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('Contoh: 07-06-2026')
                                .setMinLength(10)
                                .setMaxLength(10)
                                .setRequired(true);

                            dateModal.addComponents(
                                new ActionRowBuilder().addComponents(startInput),
                                new ActionRowBuilder().addComponents(endInput)
                            );

                            await i.showModal(dateModal);

                            try {
                                const modalSubmit = await i.awaitModalSubmit({
                                    filter: mi => mi.user.id === interaction.user.id && mi.customId === modalId,
                                    time: 120000
                                });

                                const startDateStr = modalSubmit.fields.getTextInputValue('start_date_input').trim();
                                const endDateStr = modalSubmit.fields.getTextInputValue('end_date_input').trim();

                                const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
                                if (!dateRegex.test(startDateStr) || !dateRegex.test(endDateStr)) {
                                    errorMsg = 'Format tanggal salah. Gunakan format DD-MM-YYYY (contoh: 01-06-2026).';
                                    await modalSubmit.update({
                                        embeds: [getEmbed()],
                                        components: getComponents()
                                    });
                                    return;
                                }

                                const parsedStart = parseDate(startDateStr);
                                const parsedEnd = parseDate(endDateStr);

                                if (!parsedStart || !parsedEnd) {
                                    errorMsg = 'Tanggal tidak ada di kalender (contoh: 31 Februari).';
                                    await modalSubmit.update({
                                        embeds: [getEmbed()],
                                        components: getComponents()
                                    });
                                    return;
                                }

                                if (parsedStart > parsedEnd) {
                                    errorMsg = 'Tanggal mulai tidak boleh melebihi tanggal selesai.';
                                    await modalSubmit.update({
                                        embeds: [getEmbed()],
                                        components: getComponents()
                                    });
                                    return;
                                }

                                // valid
                                collector.stop('confirmed');
                                resolveDate({
                                    startISO: toISOFormat(parsedStart),
                                    endISO: toISOFormat(parsedEnd),
                                    lastInteract: modalSubmit
                                });
                            } catch (err) {
                                console.error('Error awaiting modal submit:', err);
                            }
                        });

                        collector.on('end', (collected, reason) => {
                            if (reason !== 'confirmed') {
                                rejectDate(new Error('Timeout atau dibatalkan'));
                            }
                        });
                    });
                };

                const dateResults = await getDates();
                startDate = dateResults.startISO;
                endDate = dateResults.endISO;
                finalInteraction = dateResults.lastInteract;
            }

            // Mulai Eksekusi Pipeline
            isWeeklyJobRunning = true;
            await finalInteraction.update({
                content: '⏳ **Menyiapkan penarikan data weekly...**',
                embeds: [],
                components: []
            });

            const startTime = Date.now();
            let currentLog = 'Memulai pipeline weekly...';
            let lastUpdate = Date.now();

            const makeProgressBar = (filledCount, totalCount = 5) => {
                const filled = '█'.repeat(filledCount);
                const empty = '░'.repeat(totalCount - filledCount);
                return `[${filled}${empty}] ${filledCount}/${totalCount}`;
            };

            const buildProgressEmbed = (progressStep = 1, extraDesc = '') => {
                let progressLabel = '';
                switch(progressStep) {
                    case 1: progressLabel = 'Initial setup & validation'; break;
                    case 2: progressLabel = 'Pausing warmer & acquiring lock'; break;
                    case 3: progressLabel = 'Running weekly scraper'; break;
                    case 4: progressLabel = 'Generating and merging Excel reports'; break;
                    case 5: progressLabel = 'Completed'; break;
                }

                return new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('📊 Progress Weekly Agency Pipeline')
                    .setDescription(
                        `Weekly pipeline sedang dijalankan.\n\n` +
                        `${makeProgressBar(progressStep)}\n` +
                        `> 📍 **Platform:** ${platform.toUpperCase()}\n` +
                        `> 📅 **Rentang:** ${startDate} s/d ${endDate}\n` +
                        `${selectedOutlets.length > 0 ? `> 🏢 **Outlet:** ${selectedOutlets.join(', ')}\n` : ''}\n` +
                        `**Status saat ini:** ${progressLabel}\n` +
                        `\`\`\`\n${extraDesc || currentLog}\n\`\`\``
                    )
                    .setFooter({ text: 'Sistem Weekly Agency Performance' })
                    .setTimestamp();
            };

            const cancelRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('cancel_weekly_pipeline')
                    .setLabel('⏹️ Batalkan Proses')
                    .setStyle(ButtonStyle.Danger)
            );

            const progressMsg = await finalInteraction.editReply({
                content: null,
                embeds: [buildProgressEmbed(1)],
                components: [cancelRow]
            });

            const outletStr = selectedOutlets.length > 0 ? selectedOutlets.join('|') : '';

            const formData = {
                platform,
                startDate,
                endDate,
                outlet: outletStr,
                branch: '',
                user: '',
                channelId: interaction.channelId
            };

            const pipeline = runWeeklyPipeline(formData, async (logLine) => {
                currentLog = logLine;
                let step = 3;
                if (logLine.includes('[JOB LOCK]') || logLine.includes('[WARMER]')) {
                    step = 2;
                } else if (logLine.includes('PHASE 3') || logLine.includes('PHASE 4') || logLine.includes('Master Aggregation') || logLine.includes('Merging')) {
                    step = 4;
                }

                if (Date.now() - lastUpdate > 3000) {
                    lastUpdate = Date.now();
                    await progressMsg.edit({
                        embeds: [buildProgressEmbed(step)],
                        components: [cancelRow]
                    }).catch(() => {});
                }
            });

            activeWeeklyProcess = pipeline.proc;

            pipeline.promise.then(async (result) => {
                isWeeklyJobRunning = false;
                activeWeeklyProcess = null;

                const isCancelled = pipeline.proc && pipeline.proc.cancelled;
                if (isCancelled) {
                    return;
                }

                const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
                const durationStr = `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`;

                if (result.success) {
                    const attachments = [];
                    const searchPaths = platform === 'all' ? ['grab', 'shopee'] : [platform];
                    
                    for (const plat of searchPaths) {
                        const dir = path.join(WEEKLY_DIR, 'laporan', plat, `${startDate}_to_${endDate}`);
                        if (fs.existsSync(dir)) {
                            const dirFiles = fs.readdirSync(dir);
                            for (const file of dirFiles) {
                                if (file.endsWith('.xlsx') && (file.startsWith('0Master') || file.startsWith('CUSTOM_') || file.startsWith('Merged_'))) {
                                    const filePath = path.join(dir, file);
                                    const stats = fs.statSync(filePath);
                                    if (stats.size < 8 * 1024 * 1024) {
                                        attachments.push(new AttachmentBuilder(filePath));
                                    }
                                }
                            }
                        }
                    }

                    const successEmbed = new EmbedBuilder()
                        .setColor(0x00C853)
                        .setTitle('✅ Weekly Agency Pipeline Selesai!')
                        .setDescription(
                            `Pipeline weekly selesai dijalankan dengan sukses.\n\n` +
                            `> 📍 **Platform:** ${platform.toUpperCase()}\n` +
                            `> 📅 **Rentang:** ${startDate} s/d ${endDate}\n` +
                            `${selectedOutlets.length > 0 ? `> 🏢 **Outlet:** ${selectedOutlets.join(', ')}\n` : ''}` +
                            `> ⏱️ **Durasi:** ${durationStr}\n\n` +
                            `Laporan Excel hasil kalkulasi dilampirkan di bawah ini.`
                        )
                        .setFooter({ text: 'Sistem Weekly Agency Performance' })
                        .setTimestamp();

                    await progressMsg.edit({
                        embeds: [successEmbed],
                        files: attachments,
                        components: []
                    });
                } else {
                    const errSnippet = result.output.slice(-600)
                        .replace(/\x1B\[[0-9;]*m/g, '')
                        .replace(/```/g, "'''");

                    const failedEmbed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('❌ Weekly Agency Pipeline Gagal')
                        .setDescription(
                            `Weekly pipeline gagal dijalankan.\n\n` +
                            `**Exit Code:** \`${result.exitCode}\`\n` +
                            `**Log terakhir:**\n` +
                            `\`\`\`\n${errSnippet || 'Tidak ada detail error.'}\n\`\`\``
                        )
                        .setFooter({ text: 'Hubungi administrator jika masalah berlanjut.' })
                        .setTimestamp();

                    await progressMsg.edit({
                        embeds: [failedEmbed],
                        components: []
                    });
                }
            }).catch(async (err) => {
                isWeeklyJobRunning = false;
                activeWeeklyProcess = null;
                
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Error Tidak Terduga')
                    .setDescription(`\`${err.message}\``)
                    .setTimestamp();

                await progressMsg.edit({
                    embeds: [errorEmbed],
                    components: []
                }).catch(() => {});
            });

        } catch (err) {
            isWeeklyJobRunning = false;
            activeWeeklyProcess = null;
            console.error('Error during agency flow:', err);
            // Don't log timeout/cancel errors as critical errors
            if (err.message !== 'Timeout or cancelled' && err.message !== 'Timeout atau dibatalkan') {
                await interaction.followUp({
                    content: `❌ **Terjadi kesalahan:** ${err.message}`,
                    flags: 64
                }).catch(() => {});
            }
        }
    },

    async cancelWeeklyPipeline(interaction) {
        if (activeWeeklyProcess && !activeWeeklyProcess.killed) {
            activeWeeklyProcess.cancelled = true;
            try {
                process.kill(-activeWeeklyProcess.pid, 'SIGKILL');
            } catch (e) {
                try { activeWeeklyProcess.kill('SIGKILL'); } catch (err) {}
            }
            activeWeeklyProcess = null;
            isWeeklyJobRunning = false;

            await interaction.update({
                content: '⏹️ **Proses Weekly Pipeline dibatalkan secara paksa.**',
                embeds: [],
                components: []
            });
        } else {
            await interaction.reply({
                content: '⚠️ **Gagal membatalkan:** Proses tidak ditemukan atau sudah selesai.',
                flags: 64
            });
        }
    }
};
