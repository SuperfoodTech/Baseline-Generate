/**
 * bridge/run_pipeline.js
 * ══════════════════════════════════════════════════════════════
 *  Jembatan Node.js → Python cli.py
 *  Dipanggil oleh modal.js setelah form Discord selesai diisi.
 *  cli.py tetap bisa dijalankan manual dari terminal seperti biasa.
 * ══════════════════════════════════════════════════════════════
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { spawn }  = require('child_process');
const path       = require('path');
const fs         = require('fs');

// ── Path resolver ────────────────────────────────────────────
// bridge/ berada di: task-weekly/discord-bot-form/bridge/
// src/    berada di: task-weekly/src/
// Jadi dari __dirname (bridge/), naik 2 level ke task-weekly/, lalu masuk src/
const SRC_DIR    = path.resolve(__dirname, '..', '..', 'src');
const VENV_PY    = path.join(SRC_DIR, '.venv', 'bin', 'python');
const PYTHON_EXE = fs.existsSync(VENV_PY) ? VENV_PY : 'python3';
const CLI_PATH   = path.join(SRC_DIR, 'cli.py');

/**
 * Konversi tanggal DD-MM-YYYY → YYYY-MM-DD
 * @param {string} ddmmyyyy
 * @returns {string}
 */
function convertDate(ddmmyyyy) {
    const parts = ddmmyyyy.split('-');
    if (parts.length !== 3) return ddmmyyyy;
    const [day, month, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Deteksi platform dari string aplikator Discord
 * "GoFood, GrabFood, ShopeeFood" | "GrabFood" | "ShopeeFood" | dll.
 * @param {string} aplikator
 * @returns {'grab'|'shopee'|'all'}
 */
function detectPlatform(aplikator) {
    const lower    = aplikator.toLowerCase();
    const hasGo    = lower.includes('gofood');
    const hasGrab  = lower.includes('grabfood');
    const hasShopee = lower.includes('shopeefood');
    
    const selected = [];
    if (hasGo) selected.push('gofood');
    if (hasGrab) selected.push('grab');
    if (hasShopee) selected.push('shopee');
    
    if (selected.length > 0) {
        return selected.join(',');
    }
    return 'all';
}

/**
 * Ambil outlet/cabang pertama dari string multi-select
 * "Outlet A, Outlet B" → "Outlet A"
 * @param {string} str
 * @returns {string}
 */
function firstValue(str) {
    return (str || '').split(',')[0].trim();
}

/**
 * Jalankan pipeline OFD dari formData Discord
 *
 * @param {Object}   formData
 * @param {string}   formData.tagihan         - "weekly" | "baseline"
 * @param {string}   formData.outlet          - nama outlet (bisa koma-separated)
 * @param {string}   formData.cabang          - nama cabang (bisa koma-separated)
 * @param {string}   formData.aplikator       - "GoFood, GrabFood, ShopeeFood"
 * @param {string}   formData.tanggalMulai    - "DD-MM-YYYY"
 * @param {string}   formData.tanggalSelesai  - "DD-MM-YYYY"
 * @param {Function} [onLog]                  - Callback(line:string) untuk live log
 * @returns {Promise<{success:boolean, exitCode:number, output:string}>}
 */
function runPipeline(formData, onLog = () => {}) {
    return new Promise((resolve) => {
        const startDate  = convertDate(formData.tanggalMulai);
        const endDate    = convertDate(formData.tanggalSelesai);
        const platform   = detectPlatform(formData.aplikator);
        const taskChoice = formData.tagihan === 'baseline' ? '1' : '2';
        const outlet     = firstValue(formData.outlet);

        // Multi-cabang: jika hanya 1 cabang dipilih → filter spesifik
        // Jika banyak cabang atau "all" → kirim kosong agar cli.py proses semua
        const cabangList = (formData.cabang || '').split(',').map(s => s.trim()).filter(Boolean);
        const cabang     = cabangList.length === 1 ? cabangList[0] : '';

        // ── Env vars yang dibaca cli.py (Discord mode) ──────────────
        const env = {
            ...process.env,
            OFD_DISCORD_MODE : '1',
            OFD_TASK_CHOICE  : taskChoice,
            OFD_PLATFORM     : platform,
            OFD_OUTLET       : outlet,
            OFD_CABANG       : cabang,
            OFD_APLIKATOR    : formData.aplikator || '',
            OFD_WEBHOOK_URL  : process.env.WEBHOOK_URL || '',
        };

        // ── Argumen CLI ─────────────────────────────────────────────
        // cli.py non-interaktif: python cli.py <platform> --start ... --end ...
        const args = [
            CLI_PATH,
            platform,
            '--start', startDate,
            '--end',   endDate,
        ];

        onLog(`🚀 Menjalankan: \`${PYTHON_EXE} cli.py ${args.slice(1).join(' ')}\``);
        onLog(`📦 Mode: **${formData.tagihan.toUpperCase()}** | Platform: **${platform.toUpperCase()}**`);
        onLog(`📍 Outlet: **${outlet}** | Brand: **${cabang || '(semua)'}**`);

        let output = '';

        const proc = spawn(PYTHON_EXE, args, {
            cwd : SRC_DIR,
            env,
        });

        proc.stdout.on('data', (data) => {
            const line = data.toString();
            output += line;
            process.stdout.write(data); // Stream to docker compose logs live and uncropped
            // Kirim baris penting ke Discord (filter noise ANSI)
            const clean = line.replace(/\x1B\[[0-9;]*m/g, '').trim();
            if (clean) onLog(clean.substring(0, 200));
        });

        proc.stderr.on('data', (data) => {
            const str = data.toString();
            output += str;
            process.stderr.write(data); // Stream errors to docker compose logs live and uncropped
        });

        proc.on('close', (exitCode) => {
            resolve({
                success  : exitCode === 0,
                exitCode : exitCode ?? -1,
                output   : output.trim(),
            });
        });

        proc.on('error', (err) => {
            resolve({
                success  : false,
                exitCode : -1,
                output   : `Gagal memulai proses: ${err.message}`,
            });
        });
    });
}

module.exports = { runPipeline, convertDate, detectPlatform };
