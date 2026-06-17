const { 
    SlashCommandBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder,
    AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { runWeeklyPipeline } = require('../../../bridge/run_weekly_pipeline');

// Path to weekly directory
const WEEKLY_DIR = path.resolve(__dirname, '../../../../weekly');

// Memory lock for active weekly pipeline jobs
let isWeeklyJobRunning = false;
let activeWeeklyProcess = null;

function normalizeDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split(/[-/]/);
    if (parts.length !== 3) return dateStr;
    
    let day, month, year;
    if (parts[0].length === 4) {
        // YYYY-MM-DD
        year = parts[0];
        month = parts[1];
        day = parts[2];
    } else {
        // DD-MM-YYYY
        day = parts[0];
        month = parts[1];
        year = parts[2];
    }
    
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('agency')
        .setDescription('Kirim formulir Laporan Transaksi Mingguan (Weekly) Agency'),

    async execute(interaction) {
        if (isWeeklyJobRunning) {
            return interaction.reply({
                content: '⚠️ **Sistem Sibuk!** Laporan Weekly Agency lain sedang berjalan. Harap tunggu hingga proses sebelumnya selesai.',
                ephemeral: true
            });
        }

        const modal = new ModalBuilder()
            .setCustomId('agency_report_modal')
            .setTitle('Form Laporan Mingguan Agency');
        
        // 1. Platform (grab / shopee / all)
        const platformInput = new TextInputBuilder()
            .setCustomId('platform')
            .setLabel('Platform (grab / shopee / all)')
            .setStyle(TextInputStyle.Short)
            .setValue('shopee')
            .setPlaceholder('Contoh: shopee')
            .setRequired(true);

        // 2. Tanggal Mulai (YYYY-MM-DD atau DD-MM-YYYY)
        const startDateInput = new TextInputBuilder()
            .setCustomId('start_date')
            .setLabel('Tanggal Mulai (DD-MM-YYYY)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Contoh: 01-06-2026')
            .setRequired(true);

        // 3. Tanggal Selesai (YYYY-MM-DD atau DD-MM-YYYY)
        const endDateInput = new TextInputBuilder()
            .setCustomId('end_date')
            .setLabel('Tanggal Selesai (DD-MM-YYYY)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Contoh: 07-06-2026')
            .setRequired(true);

        // 4. Nama Outlet (Opsional)
        const outletInput = new TextInputBuilder()
            .setCustomId('outlet')
            .setLabel('Nama Outlet (Opsional)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Contoh: WonderFood')
            .setRequired(false);

        // 5. Cabang / User (Opsional)
        const branchInput = new TextInputBuilder()
            .setCustomId('branch_or_user')
            .setLabel('Cabang / User Grab (Opsional)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Contoh: Cabang Utama / username@email.com')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(platformInput),
            new ActionRowBuilder().addComponents(startDateInput),
            new ActionRowBuilder().addComponents(endDateInput),
            new ActionRowBuilder().addComponents(outletInput),
            new ActionRowBuilder().addComponents(branchInput)
        );

        await interaction.showModal(modal);
    },

    async handleModalSubmit(interaction) {
        if (isWeeklyJobRunning) {
            return interaction.reply({
                content: '⚠️ **Sistem Sibuk!** Laporan Weekly Agency lain sedang berjalan. Harap tunggu hingga proses sebelumnya selesai.',
                ephemeral: true
            });
        }

        const platform = interaction.fields.getTextInputValue('platform').trim().toLowerCase();
        const startDateRaw = interaction.fields.getTextInputValue('start_date').trim();
        const endDateRaw = interaction.fields.getTextInputValue('end_date').trim();
        const outlet = interaction.fields.getTextInputValue('outlet').trim();
        const branchOrUser = interaction.fields.getTextInputValue('branch_or_user').trim();

        // 1. Validasi platform
        if (!['grab', 'shopee', 'all'].includes(platform)) {
            return interaction.reply({
                content: '❌ **Platform tidak valid!** Masukkan `grab`, `shopee`, or `all`.',
                ephemeral: true
            });
        }

        // 2. Validasi format tanggal sederhana
        const dateRegex = /^(\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|\d{4}\/\d{2}\/\d{2})$/;
        if (!dateRegex.test(startDateRaw) || !dateRegex.test(endDateRaw)) {
            return interaction.reply({
                content: '❌ **Format tanggal tidak valid!** Gunakan format DD-MM-YYYY (contoh: 01-06-2026) atau YYYY-MM-DD.',
                ephemeral: true
            });
        }

        const startDate = normalizeDate(startDateRaw);
        const endDate = normalizeDate(endDateRaw);

        // 3. Parse branch / user
        let branch = '';
        let user = '';
        if (branchOrUser) {
            if (branchOrUser.includes('@')) {
                user = branchOrUser;
            } else {
                branch = branchOrUser;
            }
        }

        // Set state to running
        isWeeklyJobRunning = true;

        await interaction.deferReply();

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
                    `${outlet ? `> 🏢 **Outlet:** ${outlet}\n` : ''}` +
                    `${branch ? `> 🌿 **Cabang:** ${branch}\n` : ''}` +
                    `${user ? `> 👤 **User:** ${user}\n` : ''}\n` +
                    `**Status saat ini:** ${progressLabel}\n` +
                    `\`\`\`\n${extraDesc || currentLog}\n\`\`\``
                )
                .setFooter({ text: 'Sistem Weekly Agency Performance' })
                .setTimestamp();
        };

        // Button to cancel the weekly pipeline run
        const cancelRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('cancel_weekly_pipeline')
                .setLabel('⏹️ Batalkan Proses')
                .setStyle(ButtonStyle.Danger)
        );

        const progressMsg = await interaction.editReply({
            embeds: [buildProgressEmbed(1)],
            components: [cancelRow]
        });

        // Setup the runner
        const formData = {
            platform,
            startDate,
            endDate,
            outlet,
            branch,
            user,
            channelId: interaction.channelId
        };

        const pipeline = runWeeklyPipeline(formData, async (logLine) => {
            currentLog = logLine;
            let step = 3; // Scraping phase
            if (logLine.includes('[JOB LOCK]') || logLine.includes('[WARMER]')) {
                step = 2;
            } else if (logLine.includes('PHASE 3') || logLine.includes('PHASE 4') || logLine.includes('Master Aggregation') || logLine.includes('Merging')) {
                step = 4;
            }

            // Limit edits to avoid rate limits (at most every 3 seconds)
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
                return; // Handled by cancel interaction
            }

            const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
            const durationStr = `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`;

            if (result.success) {
                // Find generated Excel files to upload
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
                                if (stats.size < 8 * 1024 * 1024) { // Limit to 8MB
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
                        `${outlet ? `> 🏢 **Outlet:** ${outlet}\n` : ''}` +
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
                    .replace(/\x1B\[[0-9;]*m/g, '') // strip ANSI
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
    },

    async cancelWeeklyPipeline(interaction) {
        if (activeWeeklyProcess && !activeWeeklyProcess.killed) {
            activeWeeklyProcess.cancelled = true;
            try {
                process.kill(-activeWeeklyProcess.pid, 'SIGKILL'); // kill process group
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
                ephemeral: true
            });
        }
    }
};
