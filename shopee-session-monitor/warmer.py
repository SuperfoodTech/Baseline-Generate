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
from datetime import datetime

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


# ── Helpers ────────────────────────────────────────────────────────────────────

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
        log.error(f"  │  [{username}] ❌ Exception: {exc}")
        send_discord_alert(
            f"🔴 **[Session Warmer]** Exception saat memproses akun `{username}`: `{exc}`"
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

    cycle = 0
    while True:
        cycle += 1
        cycle_start = datetime.now()

        log.info("=" * 65)
        log.info(f"  🔁 SIKLUS #{cycle} — {cycle_start.strftime('%Y-%m-%d %H:%M:%S')}")
        log.info("=" * 65 + "\n")

        # Load (and potentially refresh) credential list each cycle
        accounts = load_credentials()
        if not accounts:
            log.error("❌ Tidak ada akun untuk diproses. Menunggu 60 detik...")
            time.sleep(60)
            continue

        total    = len(accounts)
        success  = 0
        failed   = 0

        for idx, acc in enumerate(accounts, start=1):
            log.info(f"  [{idx}/{total}] Akun: {acc['username']}")
            ok = warm_account(acc)
            if ok:
                success += 1
            else:
                failed += 1

            # Delay between accounts (skip after the last one)
            if idx < total:
                log.info(f"  ⏳ Menunggu {ACCOUNT_DELAY_SECONDS}s sebelum akun berikutnya...\n")
                time.sleep(ACCOUNT_DELAY_SECONDS)

        # ── Cycle Summary ──────────────────────────────────────────────────
        elapsed = (datetime.now() - cycle_start).seconds
        log.info("\n" + "=" * 65)
        log.info(f"  ✅ Siklus #{cycle} selesai dalam {elapsed}s")
        log.info(f"     Berhasil : {success}/{total}")
        log.info(f"     Gagal    : {failed}/{total}")
        log.info("=" * 65 + "\n")

        if DISCORD_WEBHOOK_URL:
            status_icon = "✅" if failed == 0 else "⚠️"
            send_discord_alert(
                f"{status_icon} **[Session Warmer]** Siklus #{cycle} selesai. "
                f"Berhasil: **{success}/{total}** | Gagal: **{failed}/{total}**. "
                f"Siklus berikutnya dalam {LOOP_DELAY_SECONDS // 60} menit."
            )

        log.info(f"  😴 Tidur {LOOP_DELAY_SECONDS}s ({LOOP_DELAY_SECONDS // 60} menit) sebelum siklus berikutnya...\n")
        time.sleep(LOOP_DELAY_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log.info("\n🛑 Warmer dihentikan oleh pengguna (Ctrl+C).")
    except Exception as fatal:
        log.critical(f"💀 Fatal error: {fatal}", exc_info=True)
        send_discord_alert(f"💀 **[Session Warmer]** Fatal error: `{fatal}`")
        sys.exit(1)
