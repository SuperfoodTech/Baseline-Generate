"""
shopee-session-monitor/warmer.py
================================
Shopee Session Warmer

Keeps the Shopee Partner Portal session tokens alive for all target accounts
(auto7303 – auto7313) by running a sequential, continuous loop that:

  1. Loads session credentials from Google Sheets (cached locally).
  2. For each account, opens a Selenium browser (using the account's dedicated
     Chrome profile) and navigates to the dashboard.
  3. Navigates to the Business Hours settings page — this triggers Shopee to
     issue a fresh shopee_tob_token cookie.
  4. Saves the new token + cookies to session_{username}.json.
  5. Closes the browser and moves to the next account.
  6. After all accounts are done, waits LOOP_DELAY_SECONDS then repeats.

Usage (from project root / task-weekly/):
    uv run shopee-session-monitor/warmer.py

Environment variables are loaded from shopee-session-monitor/.env.
"""

import os
import sys
import time
import json
import csv
import logging
import requests
from pathlib import Path
from datetime import datetime, timedelta
import threading

# ── Path Setup ─────────────────────────────────────────────────────────────────
# Allow importing from src/shopee-omzet-automation/core
SCRIPT_DIR   = Path(__file__).resolve().parent          # shopee-session-monitor/
PROJECT_ROOT = SCRIPT_DIR.parent                        # task-weekly/
OMZET_DIR    = PROJECT_ROOT / "src" / "shopee-omzet-automation"

sys.path.insert(0, str(OMZET_DIR))

# ── Load .env (from this directory) ────────────────────────────────────────────
def _load_dotenv(env_path: Path):
    """Minimal .env loader — sets os.environ without requiring python-dotenv."""
    if not env_path.exists():
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val

_load_dotenv(SCRIPT_DIR / ".env")

# ── Config from environment ─────────────────────────────────────────────────────
HEADLESS             = os.getenv("HEADLESS", "true").lower() == "true"
LOOP_DELAY_SECONDS   = int(os.getenv("LOOP_DELAY_SECONDS", "1800"))
ACCOUNT_DELAY_SECONDS = int(os.getenv("ACCOUNT_DELAY_SECONDS", "15"))
_accounts_env        = os.getenv("ACCOUNTS", "")
TARGET_ACCOUNTS      = [a.strip() for a in _accounts_env.split(",") if a.strip()] if _accounts_env else []
DISCORD_WEBHOOK_URL  = os.getenv("DISCORD_WEBHOOK_URL", "").strip()
UPTIME_KUMA_PUSH_URL = os.getenv("UPTIME_KUMA_PUSH_URL", "").strip()
# Jam pengiriman daily summary (default: 07:00 WIB)
DAILY_SUMMARY_HOUR   = int(os.getenv("DAILY_SUMMARY_HOUR", "7"))

# ── Watchdog & Heartbeat Config ───────────────────────────────────────────────
LAST_ACTIVE = time.time()
HEARTBEAT_INTERVAL_SECONDS = 30   # Cek setiap 30 detik
STUCK_THRESHOLD_SECONDS = 180     # 3 menit tanpa aktivitas = stuck

# ── OFD Job Lock Config ───────────────────────────────────────────────────────
# run_pipeline.js menulis file ini ke shared volume saat pipeline OFD dimulai,
# dan menghapusnya saat pipeline selesai. Warmer membaca file ini untuk tahu
# bahwa Docker pause bersifat intentional (bukan stuck).
# Path harus sama dengan yang digunakan run_pipeline.js (shared volume).
OFD_JOB_LOCK_FILE = Path(os.getenv("OFD_JOB_LOCK_FILE", "").strip() or "") or (
    DATA_DIR / "ofd_job.lock"
)

# ── Logger ─────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("warmer")

# ── Paths ─────────────────────────────────────────────────────────────────────
DATA_DIR          = OMZET_DIR / "data"   # Where session_*.json & chrome_profile_* live
CREDS_CACHE_PATH  = PROJECT_ROOT / "data" / "shopee_credentials_cache.csv"
CREDS_URL         = (
    "https://docs.google.com/spreadsheets/d/e/"
    "2PACX-1vRYSUnKOqk29LCktTxdb0wPLbWMbRaWRP3eC_UA4AwYod1FW6zDMhtLMC5ghIvot2B8upCDfBsn-TCP"
    "/pub?gid=565510790&single=true&output=csv"
)

# Business hours URL — navigating here forces Shopee to issue a fresh tob_token
BUSINESS_HOURS_URL = "https://partner.shopee.co.id/settings/shopee-food/business-hours-settings"

# ── Stats File — persists across restarts ──────────────────────────────────────
# Disimpan di DATA_DIR (shared volume) agar survive Docker/os.execv restart.
STATS_FILE = DATA_DIR / "warmer_stats.json"

# ── Session start time (untuk hitung uptime) ─────────────────────────────────
SESSION_START = datetime.now()


# ── Helpers ────────────────────────────────────────────────────────────────────

# ── Stats Persistence ─────────────────────────────────────────────────────────

def _load_stats() -> dict:
    """Muat stats dari file JSON. Return dict kosong jika belum ada."""
    try:
        if STATS_FILE.exists():
            return json.loads(STATS_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {
        "period_start": datetime.now().isoformat(),
        "stuck_restarts": 0,
        "docker_restarts": 0,
        "down_events": [],      # list of {ts, reason, username}
        "last_error": None,     # {ts, username, reason}
        "last_stuck_at": None,
        "total_cycles": 0,
        "total_success": 0,
        "total_failed": 0,
    }


def _save_stats(stats: dict):
    """Simpan stats ke file JSON secara atomic."""
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp = STATS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(STATS_FILE)
    except Exception as exc:
        log.warning(f"⚠️  Gagal menyimpan stats: {exc}")


def record_stuck_restart(stuck_seconds: float):
    """Catat event auto-restart karena stuck."""
    stats = _load_stats()
    stats["stuck_restarts"] = stats.get("stuck_restarts", 0) + 1
    stats["last_stuck_at"] = datetime.now().isoformat()
    stats["last_error"] = {
        "ts": datetime.now().isoformat(),
        "username": "(watchdog)",
        "reason": f"Warmer STUCK selama {stuck_seconds:.0f}s — auto-restart dipicu.",
    }
    _save_stats(stats)


def record_down_event(username: str, reason: str):
    """Catat event akun gagal diproses (down event)."""
    stats = _load_stats()
    event = {
        "ts": datetime.now().isoformat(),
        "username": username,
        "reason": reason,
    }
    events = stats.get("down_events", [])
    # Simpan max 50 event terakhir
    events.append(event)
    if len(events) > 50:
        events = events[-50:]
    stats["down_events"] = events
    stats["last_error"] = event
    stats["total_failed"] = stats.get("total_failed", 0) + 1
    _save_stats(stats)


def record_cycle_done(success: int, failed: int):
    """Catat hasil siklus."""
    stats = _load_stats()
    stats["total_cycles"] = stats.get("total_cycles", 0) + 1
    stats["total_success"] = stats.get("total_success", 0) + success
    _save_stats(stats)


def reset_stats_period():
    """Reset statistik untuk periode 24 jam baru."""
    _save_stats({
        "period_start": datetime.now().isoformat(),
        "stuck_restarts": 0,
        "docker_restarts": 0,
        "down_events": [],
        "last_error": None,
        "last_stuck_at": None,
        "total_cycles": 0,
        "total_success": 0,
        "total_failed": 0,
    })


def is_ofd_job_locked() -> bool:
    """
    Cek apakah pipeline OFD sedang berjalan dengan membaca file lock.

    run_pipeline.js (ofd_discord_bot) menulis file ini ke shared volume
    saat pipeline dimulai dan menghapusnya saat selesai.
    Jauh lebih reliable daripada pgrep karena:
    - Tidak bergantung pada nama proses / PID
    - Bekerja di dalam container Docker yang ter-isolasi
    - Path-nya ada di shared volume yang bisa diakses kedua container
    """
    try:
        return OFD_JOB_LOCK_FILE.exists()
    except Exception:
        return False


def wait_for_ofd_job(caller_context: str = ""):
    """
    Mem-pause eksekusi selama file lock OFD masih ada.
    Selama menunggu, LAST_ACTIVE tetap diupdate agar watchdog TIDAK
    menganggap warmer sebagai stuck dan melakukan restart.

    Catatan: Saat Docker container warmer di-pause oleh run_pipeline.js,
    seluruh proses di-freeze — loop ini tidak jalan. Yang penting adalah
    SETELAH di-unpause, watchdog tidak langsung restart karena LAST_ACTIVE
    sudah stale. Watchdog harus cek lock file sebelum memutuskan restart.

    Args:
        caller_context: Label opsional untuk log (misal: nama akun).
    """
    global LAST_ACTIVE
    if not is_ofd_job_locked():
        return  # Tidak ada pipeline aktif, lanjut langsung

    label = f"[{caller_context}] " if caller_context else ""
    log.info(f"  ⏸️  {label}Job lock OFD terdeteksi ('{OFD_JOB_LOCK_FILE.name}') — warmer menunggu pipeline selesai.")
    send_discord_alert(
        f"⏸️ **[Session Warmer]** {label}Pause sementara — pipeline OFD sedang aktif (job lock ditemukan)."
    )

    waited = 0
    while is_ofd_job_locked():
        # ⚠️  KUNCI: Update LAST_ACTIVE saat menunggu agar watchdog tidak restart
        LAST_ACTIVE = time.time()
        time.sleep(10)
        waited += 10
        log.info(
            f"  ⏸️  {label}Masih menunggu pipeline OFD selesai... (sudah {waited}s)"
        )

    log.info(f"  ▶️  {label}Job lock sudah hilang. Warmer RESUME.")
    # Reset timestamp setelah resume agar watchdog mulai menghitung ulang bersih
    LAST_ACTIVE = time.time()

def send_discord_alert(message: str):
    """Posts a plain-text message to the Discord webhook (if configured)."""
    if not DISCORD_WEBHOOK_URL:
        return
    try:
        requests.post(
            DISCORD_WEBHOOK_URL,
            json={"content": message},
            timeout=10,
        )
    except Exception as exc:
        log.warning(f"⚠️  Discord alert failed: {exc}")

def heartbeat_and_watchdog():
    """Background thread to send heartbeats and check if the main loop is stuck."""
    global LAST_ACTIVE
    while True:
        time.sleep(HEARTBEAT_INTERVAL_SECONDS)
        now = time.time()
        time_since_active = now - LAST_ACTIVE

        # 1. Stuck Detection
        if time_since_active > STUCK_THRESHOLD_SECONDS:
            # ⚠️  PENTING: Jangan restart jika warmer sedang di-pause oleh Docker
            # karena pipeline OFD aktif (ditandai dengan job lock file).
            # Saat Docker pause, seluruh proses di-freeze sehingga LAST_ACTIVE
            # tidak bisa diupdate — ini bukan stuck, tapi intentional pause.
            if is_ofd_job_locked():
                log.info(
                    f"⏸️  Watchdog: LAST_ACTIVE stale ({time_since_active:.0f}s) tapi "
                    f"job lock OFD aktif — ini Docker pause, bukan stuck. Reset timer."
                )
                LAST_ACTIVE = time.time()  # Reset agar tidak loop terus
            else:
                log.error(
                    f"💀 Warmer terdeteksi STUCK (tidak ada aktivitas selama {time_since_active:.0f}s). Restarting..."
                )
                record_stuck_restart(time_since_active)
                send_discord_alert(
                    f"💀 **[Session Warmer]** Terdeteksi STUCK selama {time_since_active:.0f}s. "
                    "Melakukan restart otomatis..."
                )
                os.execv(sys.executable, ['python'] + sys.argv)

        # 2. Heartbeat to Uptime Kuma
        if UPTIME_KUMA_PUSH_URL:
            try:
                requests.get(UPTIME_KUMA_PUSH_URL, timeout=10)
            except Exception as e:
                log.warning(f"⚠️  Uptime Kuma push gagal: {e}")


def send_daily_summary():
    """Kirim ringkasan 24 jam ke Discord via embed webhook."""
    if not DISCORD_WEBHOOK_URL:
        return

    stats = _load_stats()
    now   = datetime.now()

    # ── Hitung periode ──────────────────────────────────────────────────
    try:
        period_start = datetime.fromisoformat(stats.get("period_start", now.isoformat()))
    except Exception:
        period_start = now
    period_hours = max(1, round((now - period_start).total_seconds() / 3600))

    # ── Uptime sesi ini ─────────────────────────────────────────────────
    uptime_sec  = (now - SESSION_START).total_seconds()
    uptime_str  = f"{int(uptime_sec // 3600)}j {int((uptime_sec % 3600) // 60)}m"

    # ── Statistik ───────────────────────────────────────────────────────
    stuck_cnt   = stats.get("stuck_restarts", 0)
    down_events = stats.get("down_events", [])
    # Filter hanya 24 jam terakhir
    cutoff      = now - timedelta(hours=24)
    recent_down = [
        e for e in down_events
        if datetime.fromisoformat(e["ts"]) >= cutoff
    ]
    down_cnt    = len(recent_down)
    cycle_cnt   = stats.get("total_cycles", 0)
    total_ok    = stats.get("total_success", 0)
    total_fail  = stats.get("total_failed", 0)

    # ── Status warna & teks ─────────────────────────────────────────────
    if stuck_cnt > 0 or down_cnt > 5:
        color  = 0xFF4444   # merah
        status = "⚠️ Ada Masalah"
    elif down_cnt > 0:
        color  = 0xFFAA00   # kuning
        status = "🟡 Perlu Perhatian"
    else:
        color  = 0x00CC66   # hijau
        status = "✅ Normal"

    # ── Last error ──────────────────────────────────────────────────────
    last_err = stats.get("last_error")
    if last_err:
        try:
            err_ts  = datetime.fromisoformat(last_err["ts"]).strftime("%d/%m %H:%M")
        except Exception:
            err_ts  = "?"
        last_err_str = (
            f"`{last_err.get('username', '?')}` @ {err_ts}\n"
            f"{last_err.get('reason', '-')[:200]}"
        )
    else:
        last_err_str = "Tidak ada error dalam periode ini."

    # ── Tabel down events terbaru (max 5) ───────────────────────────────
    if recent_down:
        down_lines = []
        for ev in recent_down[-5:]:
            try:
                ev_ts = datetime.fromisoformat(ev["ts"]).strftime("%H:%M")
            except Exception:
                ev_ts = "?"
            reason_short = ev.get("reason", "-")[:60]
            down_lines.append(f"• `{ev.get('username','?')}` {ev_ts} — {reason_short}")
        down_detail = "\n".join(down_lines)
    else:
        down_detail = "Tidak ada kegagalan dalam 24 jam terakhir. 🎉"

    # ── Bangun embed payload ─────────────────────────────────────────────
    embed = {
        "title": f"📊 Laporan Harian Session Warmer — {now.strftime('%d %b %Y')}",
        "color": color,
        "description": (
            f"**Status saat ini:** {status}\n"
            f"**Uptime sesi:** {uptime_str}\n"
            f"**Periode laporan:** {period_hours} jam terakhir"
        ),
        "fields": [
            {
                "name": "🔁 Siklus & Akun",
                "value": (
                    f"Siklus selesai: **{cycle_cnt}**\n"
                    f"Sukses: **{total_ok}** | Gagal: **{total_fail}**"
                ),
                "inline": True,
            },
            {
                "name": "⚡ Restart & Down",
                "value": (
                    f"Auto-restart (stuck): **{stuck_cnt}x**\n"
                    f"Akun gagal (24j): **{down_cnt}x**"
                ),
                "inline": True,
            },
            {
                "name": f"🔴 Kegagalan Akun Terakhir (24j — {down_cnt} total)",
                "value": down_detail,
                "inline": False,
            },
            {
                "name": "🪲 Error Terakhir",
                "value": last_err_str,
                "inline": False,
            },
        ],
        "footer": {"text": "Shopee Session Warmer • Daily Report"},
        "timestamp": now.isoformat(),
    }

    try:
        requests.post(
            DISCORD_WEBHOOK_URL,
            json={"embeds": [embed]},
            timeout=15,
        )
        log.info("📊 Daily summary berhasil dikirim ke Discord.")
    except Exception as exc:
        log.warning(f"⚠️  Gagal mengirim daily summary: {exc}")

    # Reset stats untuk periode berikutnya
    reset_stats_period()


def daily_summary_thread():
    """Thread background: kirim summary setiap hari pada jam DAILY_SUMMARY_HOUR."""
    log.info(f"📅 Daily summary thread aktif — akan kirim setiap pukul {DAILY_SUMMARY_HOUR:02d}:00.")
    last_sent_date = None

    while True:
        time.sleep(60)  # Cek setiap menit
        now = datetime.now()
        if now.hour == DAILY_SUMMARY_HOUR and now.date() != last_sent_date:
            log.info("📊 Mengirim daily summary ke Discord...")
            try:
                send_daily_summary()
                last_sent_date = now.date()
            except Exception as exc:
                log.warning(f"⚠️  Daily summary thread error: {exc}")


def load_credentials() -> list[dict]:
    """
    Returns a list of dicts with keys: username, password, phone.
    Attempts to download a fresh copy from Google Sheets; falls back to
    the locally cached CSV if the network is unavailable.
    Filters to only the accounts listed in TARGET_ACCOUNTS.
    """
    CREDS_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Try to download fresh credentials
    try:
        log.info("🌐 Mengunduh kredensial terbaru dari Google Sheets...")
        resp = requests.get(CREDS_URL, timeout=15)
        resp.raise_for_status()
        CREDS_CACHE_PATH.write_text(resp.text, encoding="utf-8")
        log.info("✅ Kredensial berhasil diperbarui.")
    except Exception as exc:
        log.warning(f"⚠️  Gagal mengunduh kredensial: {exc}. Menggunakan cache lokal.")
        if not CREDS_CACHE_PATH.exists():
            log.error("❌ Cache kredensial tidak ditemukan. Hentikan program.")
            sys.exit(1)

    # Parse CSV
    all_accounts: list[dict] = []
    with open(CREDS_CACHE_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            username = (row.get("Username") or "").strip()
            password = (row.get("Password") or "").strip()
            phone    = (row.get("Phone") or "").strip()
            if username and password:
                all_accounts.append({
                    "username": username,
                    "password": password,
                    "phone":    phone,
                })

    # Filter to configured target accounts (preserve order)
    if TARGET_ACCOUNTS:
        lookup = {acc["username"]: acc for acc in all_accounts}
        filtered = []
        for name in TARGET_ACCOUNTS:
            if name in lookup:
                filtered.append(lookup[name])
            else:
                log.warning(f"⚠️  Akun '{name}' tidak ditemukan di kredensial — dilewati.")
        return filtered

    return all_accounts


# ── Core Warm Logic ────────────────────────────────────────────────────────────

def warm_account(acc: dict) -> bool:
    """
    Opens a browser for one account, navigates to Business Hours to refresh
    the session token, saves it, and closes the browser.

    Returns True on success, False on failure.
    """
    # Late import so that the sys.path insert above takes effect first.
    from core import browser

    username = acc["username"]
    password = acc["password"]
    phone    = acc["phone"]

    # Normalise phone — remove leading + to match existing scripts
    if phone.startswith("+"):
        phone = phone[1:]

    log.info(f"  ┌─ [{username}] Mulai proses warming...")

    # Point the browser module at the account-specific session file
    session_path = DATA_DIR / f"session_{username}.json"
    browser.set_session_file(session_path)

    # Check if a session file exists at all (pre-condition)
    if not session_path.exists():
        log.warning(f"  │  [{username}] ⚠️  File sesi tidak ditemukan: {session_path}")
        log.warning(f"  │  [{username}] Akun harus login manual terlebih dahulu (jalankan get_shopee_session.py).")
        send_discord_alert(
            f"⚠️ **[Session Warmer]** Akun `{username}` tidak memiliki file sesi. "
            "Login manual diperlukan."
        )
        log.info(f"  └─ [{username}] SKIP (tidak ada sesi)\n")
        return False

    driver = None
    try:
        # ── 1. Open browser with existing session ──────────────────────────
        log.info(f"  │  [{username}] 🌐 Membuka browser (headless={HEADLESS})...")
        session_data = browser.get_session(
            username=username,
            password=password,
            phone=phone,
            headless=HEADLESS,
            close_browser=False,  # We manage the driver lifecycle manually
            interactive=False,    # Never block waiting for terminal input
        )

        if not session_data:
            log.error(f"  │  [{username}] ❌ get_session gagal — sesi mungkin kedaluwarsa.")
            send_discord_alert(
                f"🔴 **[Session Warmer]** Akun `{username}` gagal login. "
                "Sesi mungkin kedaluwarsa — login manual diperlukan."
            )
            log.info(f"  └─ [{username}] GAGAL\n")
            return False

        driver = session_data.get("driver")
        if not driver:
            log.error(f"  │  [{username}] ❌ Driver tidak tersedia dalam session_data.")
            log.info(f"  └─ [{username}] GAGAL\n")
            return False

        log.info(f"  │  [{username}] ✅ Browser terbuka. URL: {driver.current_url}")

        # ── 1.5 Cek kesehatan sesi via teks profil .merchantName ──────────
        # Sesi SEHAT  → profil bertuliskan "Admin: SuperFood" (ada titik dua + nama merchant)
        # Sesi RUSAK  → profil hanya bertuliskan "Admin" saja (tanpa titik dua / nama merchant)
        try:
            profile_text = driver.execute_script("""
                var el = document.querySelector('.merchantName');
                if (el && el.offsetHeight > 0) return (el.innerText || '').trim().split('\\n')[0];
                var triggers = document.querySelectorAll('.ant-dropdown-trigger, .ant-dropdown-link');
                for (var t of triggers) {
                    var txt = (t.innerText || '').trim().split('\\n')[0];
                    if (txt) return txt;
                }
                return null;
            """)

            # Sesi RUSAK hanya jika profil kosong atau hanya bertuliskan "Admin" saja
            # (tanpa nama merchant). Nama seperti "SuperFood", "WonderFood", "Admin: X"
            # semua dianggap valid karena nama merchant terbaca.
            session_degraded = (
                not profile_text or
                profile_text.strip().lower() == "admin"
            )

            if session_degraded:
                log.warning(f"  │  [{username}] ⚠️  Profil menunjukkan '{profile_text}' — merchant tidak aktif. Trigger recovery...")
                recovered = browser._deliberate_logout_and_relogin(
                    driver,
                    username=username,
                    password=password,
                    phone=phone,
                )
                if not recovered:
                    log.error(f"  │  [{username}] ❌ Recovery logout-relogin gagal.")
                    send_discord_alert(
                        f"🔴 **[Session Warmer]** Akun `{username}` sesi rusak dan recovery gagal — perlu intervensi manual."
                    )
                    log.info(f"  └─ [{username}] GAGAL\n")
                    return False
                log.info(f"  │  [{username}] ✅ Recovery berhasil. Melanjutkan refresh token...")
            else:
                log.info(f"  │  [{username}] ✅ Sesi aktif: {profile_text}")

        except Exception as _profile_err:
            log.warning(f"  │  [{username}] ⚠️  Tidak bisa membaca profil: {_profile_err}")

        # ── 2. Navigate to Business Hours — triggers fresh tob_token ───────
        log.info(f"  │  [{username}] 🔄 Navigasi ke Business Hours untuk refresh token...")
        session_tokens = browser.refresh_tokens(driver)

        tob_token  = session_tokens.get("shopee_tob_token", "")
        entity_id  = session_tokens.get("shopee_tob_entity_id", "")

        if tob_token:
            log.info(f"  │  [{username}] ✅ Token diperbarui (entity_id={entity_id}, token={tob_token[:20]}...)")
        else:
            log.warning(f"  │  [{username}] ⚠️  Token baru tidak terdeteksi — sesi mungkin bermasalah.")

        log.info(f"  │  [{username}] 💾 Sesi tersimpan ke: {session_path}")
        log.info(f"  └─ [{username}] SELESAI ✅\n")
        return True

    except Exception as exc:
        exc_str = str(exc)
        log.error(f"  │  [{username}] ❌ Exception: {exc_str}")
        
        # Buat pesan error yang lebih mudah dipahami untuk Discord
        friendly_error = "Terjadi kesalahan sistem yang tidak terduga saat memproses halaman."
        if "Chrome failed to start" in exc_str or "Chrome instance exited" in exc_str or "DevToolsActivePort" in exc_str:
            friendly_error = "Browser Google Chrome gagal terbuka atau tertutup otomatis (biasanya karena masalah memori server atau ChromeDriver crash)."
        elif "Timeout" in exc_str or "timeout" in exc_str.lower():
            friendly_error = "Koneksi lambat atau halaman memakan waktu terlalu lama untuk dimuat (Timeout)."
        elif "NoSuchElement" in exc_str or "intercepted" in exc_str:
            friendly_error = "Ada masalah pada tampilan halaman web Shopee (elemen tombol tidak ditemukan atau tertutup popup lain)."
        elif "session not created" in exc_str:
            friendly_error = "Gagal membuat sesi browser baru (Kecocokan versi Chrome dan ChromeDriver bermasalah)."
        elif "ERR_INTERNET_DISCONNECTED" in exc_str or "ERR_CONNECTION" in exc_str:
            friendly_error = "Koneksi internet server terputus."

        record_down_event(username, friendly_error)
        send_discord_alert(
            f"🔴 **[Session Warmer]** Gagal memproses akun `{username}`.\n"
            f"**Alasan:** {friendly_error}"
        )
        log.info(f"  └─ [{username}] ERROR\n")
        return False

    finally:
        if driver:
            try:
                driver.quit()
                log.debug(f"          [{username}] Browser ditutup.")
            except Exception:
                pass


# ── Main Loop ─────────────────────────────────────────────────────────────────

def main():
    log.info("=" * 65)
    log.info("  🚀 Shopee Session Warmer — Starting Up")
    log.info(f"  Headless        : {HEADLESS}")
    log.info(f"  Loop delay      : {LOOP_DELAY_SECONDS}s ({LOOP_DELAY_SECONDS // 60} menit)")
    log.info(f"  Account delay   : {ACCOUNT_DELAY_SECONDS}s")
    log.info(f"  Target accounts : {', '.join(TARGET_ACCOUNTS) if TARGET_ACCOUNTS else '(semua)'}")
    log.info("=" * 65 + "\n")

    send_discord_alert("🚀 **[Session Warmer]** Service started successfully. Monitoring active.")

    cycle = 0
    while True:
        cycle += 1
        cycle_start = datetime.now()

        log.info("=" * 65)
        log.info(f"  🔁 SIKLUS #{cycle} — {cycle_start.strftime('%Y-%m-%d %H:%M:%S')}")
        log.info("=" * 65 + "\n")
        
        global LAST_ACTIVE
        LAST_ACTIVE = time.time()

        # Load (and potentially refresh) credential list each cycle
        accounts = load_credentials()
        if not accounts:
            log.error("❌ Tidak ada akun untuk diproses. Menunggu 60 detik...")
            for _ in range(60):
                LAST_ACTIVE = time.time()
                time.sleep(1)
            continue

        total    = len(accounts)
        success  = 0
        failed   = 0

        for idx, acc in enumerate(accounts, start=1):
            LAST_ACTIVE = time.time()  # Update activity timestamp

            # ── Pause jika pipeline OFD sedang aktif (job lock file) ──────────
            # wait_for_ofd_job() akan terus update LAST_ACTIVE saat menunggu,
            # sehingga watchdog TIDAK akan salah mendeteksi ini sebagai stuck.
            wait_for_ofd_job(caller_context=acc['username'])

            log.info(f"  [{idx}/{total}] Akun: {acc['username']}")
            ok = warm_account(acc)
            if ok:
                success += 1
            else:
                failed += 1

            # Delay between accounts (skip after the last one)
            if idx < total:
                log.info(f"  ⏳ Menunggu {ACCOUNT_DELAY_SECONDS}s sebelum akun berikutnya...\n")
                for _ in range(ACCOUNT_DELAY_SECONDS):
                    LAST_ACTIVE = time.time()
                    time.sleep(1)

        # ── Cycle Summary ──────────────────────────────────────────────────
        elapsed = (datetime.now() - cycle_start).seconds
        log.info("\n" + "=" * 65)
        log.info(f"  ✅ Siklus #{cycle} selesai dalam {elapsed}s")
        log.info(f"     Berhasil : {success}/{total}")
        log.info(f"     Gagal    : {failed}/{total}")
        log.info("=" * 65 + "\n")

        # Catat hasil siklus ke stats
        record_cycle_done(success, failed)

        if DISCORD_WEBHOOK_URL and failed > 0:
            send_discord_alert(
                f"⚠️ **[Session Warmer]** Siklus #{cycle} selesai dengan KEGAGALAN. "
                f"Berhasil: **{success}/{total}** | Gagal: **{failed}/{total}**. "
                f"Siklus berikutnya dalam {LOOP_DELAY_SECONDS // 60} menit."
            )

        log.info(f"  😴 Tidur {LOOP_DELAY_SECONDS}s ({LOOP_DELAY_SECONDS // 60} menit) sebelum siklus berikutnya...\n")
        # Sleep in small chunks to keep watchdog happy
        for _ in range(LOOP_DELAY_SECONDS):
            LAST_ACTIVE = time.time()
            time.sleep(1)


if __name__ == "__main__":
    # Catat restart Docker (proses baru = container di-restart)
    boot_stats = _load_stats()
    boot_stats["docker_restarts"] = boot_stats.get("docker_restarts", 0) + 1
    _save_stats(boot_stats)

    # Start heartbeat watchdog thread
    watchdog_thread = threading.Thread(target=heartbeat_and_watchdog, daemon=True)
    watchdog_thread.start()

    # Start daily summary thread
    summary_thread = threading.Thread(target=daily_summary_thread, daemon=True)
    summary_thread.start()

    try:
        main()
    except KeyboardInterrupt:
        log.info("\n🛑 Warmer dihentikan oleh pengguna (Ctrl+C).")
    except Exception as fatal:
        log.critical(f"💀 Fatal error: {fatal}", exc_info=True)
        send_discord_alert(f"💀 **[Session Warmer]** Fatal error: `{fatal}`")
        sys.exit(1)
