/**
 * bridge/run_menu_pipeline.js
 * ══════════════════════════════════════════════════════════════
 *  Jembatan Node.js → Python menu/cli.py
 *  Dipanggil oleh menuModal.js setelah form Discord selesai diisi.
 * ══════════════════════════════════════════════════════════════
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const TASK_WEEKLY_DIR = path.resolve(__dirname, '..', '..');
const VENV_PY_SRC = path.join(TASK_WEEKLY_DIR, 'src', '.venv', 'bin', 'python');
const VENV_PY_ROOT = path.join(TASK_WEEKLY_DIR, '.venv', 'bin', 'python');
const PYTHON_EXE = fs.existsSync(VENV_PY_SRC) 
    ? VENV_PY_SRC 
    : (fs.existsSync(VENV_PY_ROOT) ? VENV_PY_ROOT : 'python3');
const CLI_PATH = path.join(TASK_WEEKLY_DIR, 'menu', 'cli.py');

/**
 * Menghentikan atau mengaktifkan kembali shopee-warmer service.
 * @param {'pause'|'unpause'} action
 * @param {Function} onLog
 * @returns {Promise<boolean>}
 */
function controlWarmer(action, onLog = console.log) {
    return Promise.resolve(true);
}

/**
 * Jalankan pipeline menu dari formData Discord
 *
 * @param {Object}   formData
 * @param {string}   formData.aplikator       - "shopee" | "gofood" | "grab" | "all"
 * @param {string}   formData.storeChoice     - "all" | "new" | specific store ID
 * @param {boolean}  formData.overwrite       - true | false
 * @param {string}   [formData.channelId]
 * @param {Function} [onLog]                  - Callback(line:string) untuk live log
 * @returns {Promise<{success:boolean, exitCode:number, output:string}>}
 */
function runMenuPipeline(formData, onLog = () => { }) {
    let proc;
    const promise = new Promise(async (resolve) => {
        // Pause warmer sebelum memulai pipeline menu untuk mencegah konflik chrome session/profile
        await controlWarmer('pause', onLog);

        const env = {
            ...process.env,
            MENU_DISCORD_MODE: '1',
            MENU_APLIKATOR: formData.aplikator,
            MENU_STORE_CHOICE: formData.storeChoice,
            MENU_OVERWRITE: formData.overwrite ? '1' : '0',
            MENU_CHANNEL_ID: formData.channelId || ''
        };

        const args = [
            '-u',
            CLI_PATH
        ];

        onLog(`🚀 Menjalankan: \`${PYTHON_EXE} menu/cli.py\``);
        onLog(`📦 Platform: **${formData.aplikator.toUpperCase()}** | Target: **${formData.storeChoice}** | Overwrite: **${formData.overwrite}**`);

        let output = '';

        proc = spawn(PYTHON_EXE, args, {
            cwd: path.join(TASK_WEEKLY_DIR, 'menu'),
            env,
            detached: true,
        });

        proc.stdout.on('data', (data) => {
            const line = data.toString();
            output += line;
            process.stdout.write(data);
            const clean = line.replace(/\x1B\[[0-9;]*m/g, '').trim();
            if (clean) onLog(clean.substring(0, 200));
        });

        proc.stderr.on('data', (data) => {
            const str = data.toString();
            output += str;
            process.stderr.write(data);
        });

        const cleanupAndResolve = async (data) => {
            // Aktifkan kembali warmer
            await controlWarmer('unpause', onLog);
            
            if (proc && proc.pid) {
                try {
                    onLog(`🧹 [CLEANUP] Cleaning up process group ${proc.pid}...`);
                    process.kill(-proc.pid, 'SIGKILL');
                } catch (e) {
                    // Ignore
                }
            }
            resolve(data);
        };

        proc.on('close', async (exitCode) => {
            await cleanupAndResolve({
                success: exitCode === 0,
                exitCode: exitCode ?? -1,
                output: output.trim()
            });
        });

        proc.on('error', async (err) => {
            await cleanupAndResolve({
                success: false,
                exitCode: -1,
                output: `Gagal memulai proses: ${err.message}`,
            });
        });
    });
    return { promise, proc };
}

module.exports = { runMenuPipeline };
