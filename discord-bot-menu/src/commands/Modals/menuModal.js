const {
    SlashCommandBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    EmbedBuilder,
    StringSelectMenuBuilder
} = require('discord.js');
const https = require('https');
const { runMenuPipeline } = require('../../../bridge/run_menu_pipeline');

// Cache untuk data Google Sheets
let cachedSheetData = null;
let lastCacheTime = 0;
const CACHE_DURATION = 15 * 60 * 1000; // 15 menit (dari sebelumnya 10 detik)

function fetchCSV(url) {
    return new Promise((resolve, reject) => {
        const fetchUrl = (currentUrl) => {
            const req = https.get(currentUrl, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return fetchUrl(res.headers.location);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`HTTP Status ${res.statusCode}`));
                }
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(data));
            });
            
            req.on('error', (err) => reject(err));
            
            // Set request timeout 15 detik agar tidak menggantung selamanya
            req.setTimeout(15000, () => {
                req.destroy();
                reject(new Error('Request timeout fetching Google Sheets'));
            });
        };
        fetchUrl(url + '&t=' + Date.now());
    });
}

const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/14eCb8DAEXhmbYj9MFj2KzC7AhkulbCbSNPltN2m-go0/export?format=csv&gid=0';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('menu')
        .setDescription('Tarik data menu dan modifier dari aplikator'),

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🚀 Menu & Modifier Extractor Pipeline')
            .setDescription('Mulai jalankan pipeline penarikan menu. Pilih tombol di bawah untuk melanjutkan.')
            .setTimestamp();

        const startButton = new ButtonBuilder()
            .setCustomId('start_menu_flow')
            .setLabel('Mulai Isi Form')
            .setEmoji('📝')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(startButton);

        const msg = await interaction.editReply({
            embeds: [embed],
            components: [row]
        });

        try {
            const btnInteraction = await msg.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id && i.customId === 'start_menu_flow',
                time: 60000
            });

            await this.startFormFlow(btnInteraction, msg);
        } catch (err) {
            console.error('[Menu Flow Error]:', err);
            if (err.name === 'Error [InteractionCollectorError]' || (err.message && err.message.includes('time'))) {
                await interaction.followUp({ content: '⏱️ Waktu pengisian formulir telah habis.', flags: 64 });
            } else {
                await interaction.followUp({ content: `❌ Terjadi kesalahan sistem: ${err.message || err}`, flags: 64 });
            }
        }
    },

    async fetchSheetData() {
        const now = Date.now();
        if (cachedSheetData && (now - lastCacheTime < CACHE_DURATION)) {
            return cachedSheetData;
        }

        try {
            const data = await fetchCSV(SHEET_CSV_URL);
            const lines = data.split(/\r?\n/);
            const headers = lines[0].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(h => h.trim().replace(/^"|"$/g, ''));
            
            const nameIdx = headers.indexOf('Nama Outlet');
            const storeIdIdx = headers.indexOf('Store ID');
            const appIdx = headers.indexOf('Aplikasi');
            const statusIdx = headers.indexOf('Status');
            const namaPenggunaIdx = headers.indexOf('Nama Pengguna');
            const merchantNameIdx = headers.indexOf('Merchant Name');
            const emailGo1Idx = headers.indexOf('Email Login Go 1');
            const emailGo2Idx = headers.indexOf('Email Login Go 2');

            const outlets = [];

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());

                if (nameIdx !== -1 && cols.length > nameIdx) {
                    const status = statusIdx !== -1 && cols.length > statusIdx ? cols[statusIdx].toLowerCase().trim() : '';
                    if (status !== 'live') continue;

                    const outletName = cols[nameIdx];
                    const storeId = storeIdIdx !== -1 && cols.length > storeIdIdx ? cols[storeIdIdx] : '';
                    const app = appIdx !== -1 && cols.length > appIdx ? cols[appIdx].toLowerCase().trim() : '';
                    
                    const namaPengguna = namaPenggunaIdx !== -1 && cols.length > namaPenggunaIdx ? cols[namaPenggunaIdx].trim() : '';
                    const merchantName = merchantNameIdx !== -1 && cols.length > merchantNameIdx ? cols[merchantNameIdx].trim() : '';
                    const emailGo1 = emailGo1Idx !== -1 && cols.length > emailGo1Idx ? cols[emailGo1Idx].trim() : '';
                    const emailGo2 = emailGo2Idx !== -1 && cols.length > emailGo2Idx ? cols[emailGo2Idx].trim() : '';

                    outlets.push({
                        name: outletName,
                        storeId: storeId,
                        app: app,
                        namaPengguna: namaPengguna,
                        merchantName: merchantName,
                        emailGo1: emailGo1,
                        emailGo2: emailGo2
                    });
                }
            }

            cachedSheetData = outlets;
            lastCacheTime = now;
            return outlets;
        } catch (e) {
            console.error('Error fetching sheet data:', e);
            return [];
        }
    },

    async startFormFlow(interaction, msg) {
        await interaction.deferUpdate();

        // 1. Pilih Aplikator
        const aplikatorOptions = [
            { label: 'ShopeeFood', value: 'shopee', emoji: '🟠', description: 'Tarik menu ShopeeFood' },
            { label: 'GoFood', value: 'gofood', emoji: '🔴', description: 'Tarik menu GoFood' },
            { label: 'GrabFood', value: 'grab', emoji: '🟢', description: 'Tarik menu GrabFood' },
            { label: 'Semua Aplikator', value: 'all', emoji: '🌟', description: 'Tarik menu dari semua aplikator' }
        ];

        const appResult = await this.askSelection(interaction, msg, {
            title: 'Pilih Aplikator / Platform',
            placeholder: 'Pilih Aplikator...',
            options: aplikatorOptions
        });

        const selectedApp = appResult.values[0];

        // 2. Pilih Target Outlet (Pilih Semua atau Custom)
        const outletChoiceOptions = [
            { label: '🌟 Pilih Semua Outlet', value: 'all', description: 'Memproses seluruh outlet terdaftar' },
            { label: '⚙️ Pilih Custom Outlet', value: 'custom', description: 'Memilih satu atau beberapa outlet secara spesifik' }
        ];

        const outletChoiceResult = await this.askSelection(appResult.lastInteraction, msg, {
            title: 'Pilih Target Outlet',
            placeholder: 'Tentukan target outlet...',
            options: outletChoiceOptions
        });

        const selectedOutletChoice = outletChoiceResult.values[0];

        let selectedStores = [];
        let finalLastInteraction = outletChoiceResult.lastInteraction;

        // Fetch master outlets untuk filtering
        const allOutlets = await this.fetchSheetData();

        if (selectedOutletChoice === 'custom') {
            // Kita harus menentukan platform mana saja yang perlu dipilih outletnya
            const platformsToSelect = selectedApp === 'all' ? ['grab', 'shopee', 'gofood'] : [selectedApp];

            for (const plat of platformsToSelect) {
                let filtered = [];
                let platTitle = '';
                let platEmoji = '';

                if (plat === 'grab') {
                    // Filter Grab: namaPengguna tidak null/kosong/'-'
                    filtered = allOutlets.filter(o => 
                        o.app.includes('grab') && 
                        o.namaPengguna && 
                        o.namaPengguna !== '-' && 
                        o.namaPengguna.toLowerCase() !== 'nan'
                    );
                    platTitle = 'GrabFood';
                    platEmoji = '🟢';
                } else if (plat === 'shopee') {
                    // Filter Shopee: merchantName tidak kosong/'-'
                    filtered = allOutlets.filter(o => 
                        o.app.includes('shopee') && 
                        o.merchantName && 
                        o.merchantName !== '-' && 
                        o.merchantName.toLowerCase() !== 'nan'
                    );
                    platTitle = 'ShopeeFood';
                    platEmoji = '🟠';
                } else if (plat === 'gofood') {
                    // Filter GoFood: Email Login Go 1 atau Email Login Go 2 tidak kosong/'-'
                    filtered = allOutlets.filter(o => 
                        o.app.includes('go') && (
                            (o.emailGo1 && o.emailGo1 !== '-' && o.emailGo1.toLowerCase() !== 'nan') ||
                            (o.emailGo2 && o.emailGo2 !== '-' && o.emailGo2.toLowerCase() !== 'nan')
                        )
                    );
                    platTitle = 'GoFood';
                    platEmoji = '🔴';
                }

                if (filtered.length === 0) {
                    // Skip jika tidak ada outlet yang memenuhi syarat
                    continue;
                }

                // Susun opsi untuk dropdown outlet spesifik
                const customOptions = filtered.slice(0, 25).map(o => ({
                    label: o.name.substring(0, 100),
                    value: o.storeId,
                    description: `Store ID: ${o.storeId}`
                }));

                const customSelectResult = await this.askSelection(finalLastInteraction, msg, {
                    title: `${platEmoji} Pilih Custom Outlet ${platTitle}`,
                    placeholder: `Pilih satu atau lebih outlet ${platTitle}...`,
                    options: customOptions,
                    minValues: 1,
                    maxValues: Math.min(customOptions.length, 25)
                });

                selectedStores.push(...customSelectResult.values);
                finalLastInteraction = customSelectResult.lastInteraction;
            }
        }

        // 3. Tentukan Mode Eksekusi
        // Jika pilihan pertama "Semua Aplikator" dan pilihan kedua "Semua Outlet", atau jika custom outlet selesai dipilih:
        const modeOptions = [
            { label: 'Skip Existing (Hanya yang belum ditarik)', value: 'skip', emoji: '⏩' },
            { label: 'Overwrite All (Tarik ulang & timpa semua)', value: 'overwrite', emoji: '🔄' }
        ];

        const modeResult = await this.askSelection(finalLastInteraction, msg, {
            title: 'Pilih Mode Eksekusi',
            placeholder: 'Pilih Mode...',
            options: modeOptions
        });

        const isOverwrite = modeResult.values[0] === 'overwrite';
        finalLastInteraction = modeResult.lastInteraction;

        // Resolusi Target Display untuk Review Embed
        let targetDisplay = '';
        let storeChoiceVal = 'all';

        if (selectedOutletChoice === 'all') {
            targetDisplay = 'Semua Outlet Terdaftar';
            storeChoiceVal = 'all';
        } else {
            // Find store names
            const storeNames = selectedStores.map(id => {
                const found = allOutlets.find(o => o.storeId === id);
                return found ? found.name : id;
            });
            targetDisplay = storeNames.join(', ');
            storeChoiceVal = selectedStores.join(',');
        }

        // 4. REVIEW & KONFIRMASI FINAL
        const reviewEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📋 Konfirmasi Eksekusi Menu Pipeline')
            .setDescription('Periksa kembali data di bawah ini sebelum menjalankan pipeline.')
            .addFields(
                { name: '📱 Aplikator', value: selectedApp.toUpperCase(), inline: true },
                { name: '📍 Target Outlet', value: targetDisplay.length > 512 ? targetDisplay.substring(0, 508) + '...' : targetDisplay, inline: false },
                { name: '🔄 Mode Overwrite', value: isOverwrite ? 'Ya (Overwrite All)' : 'Tidak (Skip Existing)', inline: false }
            )
            .setTimestamp();

        const confirmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('confirm_menu_run').setLabel('Jalankan Pipeline').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('cancel_menu_run').setLabel('Batalkan').setStyle(ButtonStyle.Danger)
        );

        await finalLastInteraction.update({
            embeds: [reviewEmbed],
            components: [confirmRow]
        });

        // msg sudah didapatkan dari parameter startFormFlow
        try {
            const confirmInteraction = await msg.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id && ['confirm_menu_run', 'cancel_menu_run'].includes(i.customId),
                time: 120000
            });

            if (confirmInteraction.customId === 'cancel_menu_run') {
                await confirmInteraction.update({
                    embeds: [new EmbedBuilder().setColor(0xFF0000).setTitle('❌ Dibatalkan').setDescription('Pipeline penarikan menu dibatalkan oleh pengguna.')],
                    components: []
                });
                return;
            }

            await confirmInteraction.update({
                embeds: [new EmbedBuilder().setColor(0x00FF00).setTitle('✅ Berhasil Memulai').setDescription('Pipeline sedang dijalankan di server. Pantau progresnya di channel ini.')],
                components: []
            });

            // Kirim notifikasi publik ke channel
            const pubEmbed = new EmbedBuilder()
                .setColor(0xFFA500)
                .setTitle('⏳ Pipeline Penarikan Menu Dimulai...')
                .setDescription(`Menjalankan penarikan menu:\n\n> 📱 **Platform:** ${selectedApp.toUpperCase()}\n> 📍 **Target:** ${targetDisplay.length > 256 ? targetDisplay.substring(0, 252) + '...' : targetDisplay}\n> 🔄 **Overwrite:** ${isOverwrite ? 'Ya' : 'Tidak'}`)
                .setTimestamp();

            const statusMsg = await interaction.channel.send({ embeds: [pubEmbed] });

            // Eksekusi Pipeline via Bridge
            const formData = {
                aplikator: selectedApp,
                storeChoice: storeChoiceVal,
                overwrite: isOverwrite,
                channelId: interaction.channelId
            };

            let logBuffer = [];
            const pipeline = runMenuPipeline(formData, (logLine) => {
                logBuffer.push(logLine);
                if (logBuffer.length > 5) logBuffer.shift(); // keep last 5 lines
                
                statusMsg.edit({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFFA500)
                            .setTitle('⏳ Pipeline Penarikan Menu Sedang Berjalan...')
                            .setDescription(`> 📱 **Platform:** ${selectedApp.toUpperCase()}\n> 📍 **Target:** ${targetDisplay.length > 256 ? targetDisplay.substring(0, 252) + '...' : targetDisplay}\n\n**Log Terkini:**\n\`\`\`\n${logBuffer.join('\n')}\n\`\`\``)
                            .setTimestamp()
                    ]
                }).catch(() => {});
            });

            pipeline.promise.then(async (result) => {
                if (result.success) {
                    await statusMsg.edit({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(0x00FF00)
                                .setTitle('✅ Penarikan Menu Selesai!')
                                .setDescription(`Pipeline selesai dieksekusi dengan sukses.\n\n> 📱 **Platform:** ${selectedApp.toUpperCase()}\n> 📍 **Target:** ${targetDisplay.length > 256 ? targetDisplay.substring(0, 252) + '...' : targetDisplay}\n\nData menu & modifier telah berhasil disimpan ke folder output server.`)
                                .setTimestamp()
                        ]
                    });
                } else {
                    await statusMsg.edit({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(0xFF0000)
                                .setTitle('❌ Pipeline Gagal')
                                .setDescription(`Terjadi kesalahan saat menjalankan pipeline penarikan menu.\n\n**Detail Error:**\n\`\`\`\n${result.output.substring(0, 1000)}\n\`\`\``)
                                .setTimestamp()
                        ]
                    });
                }
            });

        } catch (err) {
            console.error(err);
        }
    },

    async askSelection(interaction, msg, { title, placeholder, options, minValues = 1, maxValues = 1 }) {
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(title)
            .setDescription(`Silakan tentukan pilihan Anda pada menu dropdown di bawah.`)
            .setTimestamp();

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('temp_select')
            .setPlaceholder(placeholder)
            .setMinValues(minValues)
            .setMaxValues(maxValues)
            .addOptions(options.map(opt => ({
                label: opt.label,
                value: opt.value,
                description: opt.description || '',
                emoji: opt.emoji || null
            })));

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.editReply({
            embeds: [embed],
            components: [row]
        });

        const selectInteraction = await msg.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id && i.customId === 'temp_select',
            time: 60000
        });

        await selectInteraction.deferUpdate();
        return { values: selectInteraction.values, lastInteraction: selectInteraction };
    }
};
