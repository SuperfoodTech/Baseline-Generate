import argparse
import asyncio
import io
import os
import shutil
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv
import sys
import os
# Add parent directory to sys.path to allow importing grab_api_scraper
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import logging
from logging.handlers import RotatingFileHandler
from datetime import datetime

from grab_api_scraper import run_api_download_for_portal

# --- Logging Setup ---
def setup_logger():
    os.makedirs("logs", exist_ok=True)
    # Generate timestamped filename
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_file = f"logs/grab_run_{timestamp}.log"
    
    # Only clean up non-log files (like old screenshots)
    for f in Path("logs").glob("*"):
        if f.is_file() and not f.name.endswith(".log"):
            try: f.unlink()
            except: pass

    logger = logging.getLogger("GrabAuto")
    logger.setLevel(logging.INFO)
    # Clear existing handlers if any (for notebook/interactive environments)
    if logger.hasHandlers():
        logger.handlers.clear()

    formatter = logging.Formatter('[%(asctime)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S')

    # Console
    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(formatter)
    logger.addHandler(ch)

    # File
    fh = logging.FileHandler(log_file, mode='w', encoding='utf-8')
    fh.setFormatter(formatter)
    logger.addHandler(fh)
    
    return logger

log = setup_logger()

CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRUOPDeyWtcCQT2OaNTmplVoIs0FxGFT-6UA3W-AJ_-RAG3H57UTADOyK2O1YnwMhphQPL2Nj86s7N6/pub?gid=0&single=true&output=csv"

async def run_all(date_start: str = None, date_end: str = None, output_dir: str = None, user_filter: str = None):
    # Reload env just in case
    load_dotenv(override=True)
    
    log.info(f"Fetching merchant list from spreadsheet...")
    try:
        resp = requests.get(CSV_URL, timeout=30)
        resp.raise_for_status()
        df = pd.read_csv(io.StringIO(resp.text))
        
        # Filter for GrabFood and Status Live
        grab_df = df[df["Aplikasi"].str.contains("Grab", na=False, case=False)]
        grab_df = grab_df[grab_df["Status"].str.contains("Live", na=False, case=False)]
        
        portals = []
        for idx, row in grab_df.iterrows():
            user_sf = row.get("Nama Pengguna.1")
            user_mt = row.get("Nama Pengguna")
            pwd_sf = row.get("Kata Sandi.1")
            pwd_mt = row.get("Kata Sandi")
            
            user = user_sf if pd.notna(user_sf) and str(user_sf).strip() != "-" else user_mt
            pwd = pwd_sf if pd.notna(pwd_sf) and str(pwd_sf).strip() != "-" else pwd_mt
            
            if pd.notna(user) and pd.notna(pwd) and str(user).strip() != "-" and str(pwd).strip() != "-":
                portals.append({
                    "id": len(portals) + 1,
                    "outlet": row.get("Nama Outlet", "Unknown"),
                    "branch": row.get("Cabang", "Unknown"),
                    "user": str(user).strip(),
                    "pwd": str(pwd).strip()
                })
        
    except Exception as e:
        log.error(f"Failed to fetch or parse spreadsheet: {e}")
        return

    # Determine output directory
    if output_dir:
        laporan_dir = Path(output_dir)
    else:
        start_str = date_start or "all"
        end_str = date_end or "all"
        laporan_dir = Path("laporan") / f"{start_str}_{end_str}"
    
    # Auto-cleanup old CSV files
    if laporan_dir.exists():
        old_csvs = list(laporan_dir.glob("*.csv"))
        if old_csvs:
            log.info(f"Cleaning up {len(old_csvs)} old CSV files in {laporan_dir}...")
            for f in old_csvs:
                try: f.unlink()
                except: pass

    log.info("="*60)
    log.info(f"  GRAB MULTI-PORTAL AUTOMATION ({len(portals)} portals)")
    
    unique_users = {}
    for p_info in portals:
        u = p_info["user"]
        if user_filter and user_filter.lower() not in u.lower():
            continue

        if u not in unique_users:
            unique_users[u] = {"pwd": p_info["pwd"], "portals": []}
        unique_users[u]["portals"].append(p_info)
    
    log.info(f"  Unique Accounts: {len(unique_users)}")
    log.info("="*60)
    
    from playwright.async_api import async_playwright
    
    async with async_playwright() as p:
        # Load headless setting from config.json walk-up
        headless_env = True
        try:
            import json
            for parent in Path(__file__).resolve().parents:
                config_file = parent / "config.json"
                if config_file.exists():
                    with open(config_file, "r") as f:
                        headless_env = json.load(f).get("headless_grab", True)
                    break
        except Exception:
            pass
        browser = await p.chromium.launch(headless=headless_env)
        semaphore = asyncio.Semaphore(3)
        failures = []

        async def process_user(username, info):
            password = info["pwd"]
            related_portals = info["portals"]
            first_outlet = related_portals[0]["outlet"]
            
            async with semaphore:
                log.info(f"[ACCOUNT] Starting for: {username} ({first_outlet})")
                try:
                    downloaded_file, err = await run_api_download_for_portal(
                        username, password, 
                        start_date=date_start, 
                        end_date=date_end,
                        browser=browser
                    )

                    if not downloaded_file:
                        log.error(f"  ✗ [ACCOUNT] {username} Failed: {err}")
                        failures.append({"user": username, "error": err, "outlets": [p["outlet"] for p in related_portals]})
                        return

                    for portal in related_portals:
                        portal_id = portal["id"]
                        outlet_name = f"{portal['outlet']} ({portal['branch']})"
                        laporan_dir.mkdir(parents=True, exist_ok=True)
                        
                        portal_safe_name = f"{portal['outlet']}_{portal['branch']}".replace("/", "_").replace("\\", "_")
                        dest = laporan_dir / f"{portal_safe_name}.csv"
                        shutil.copy2(downloaded_file, dest)
                        log.info(f"  ✓ [PORTAL {portal_id}] {outlet_name} — Saved to: {dest.name}")

                except Exception as e:
                    log.error(f"  ✗ [ACCOUNT] {username} CRITICAL ERROR: {str(e)}")

        tasks = [process_user(u, info) for u, info in unique_users.items()]
        await asyncio.gather(*tasks)
        await browser.close()

    log.info("="*60)
    log.info("  ALL PORTALS FINISHED PROCESSING")
    if failures:
        log.info("-" * 60)
        log.info(f"  FAILED ACCOUNTS ({len(failures)}):")
        for f in failures:
            log.info(f"  - {f['user']}: {f['error']}")
    else:
        log.info("  ✓ ALL ACCOUNTS PROCESSED SUCCESSFULLY")
    log.info("="*60)

    # --- Gabungkan semua CSV menjadi file master ---
    if output_dir:
        laporan_dir = Path(output_dir)
    else:
        start_str = date_start or "all"
        end_str = date_end or "all"
        laporan_dir = Path("laporan") / f"{start_str}_{end_str}"

    csv_files = sorted(laporan_dir.glob("*.csv")) if laporan_dir.exists() else []
    # Exclude master file jika sudah ada dari run sebelumnya
    csv_files = [f for f in csv_files if f.stem != "MASTER"]

    if not csv_files:
        print("\n[SKIP] Tidak ada file CSV untuk digabung.")
        return

    print(f"\nMenggabungkan {len(csv_files)} file CSV menjadi master...")
    frames = []
    for csv_path in csv_files:
        try:
            df = pd.read_csv(csv_path)
            df.insert(0, "Merchant", csv_path.stem)
            frames.append(df)
        except Exception as e:
            print(f"  [WARN] Gagal baca {csv_path.name}: {e}")

    if not frames:
        log.info("[SKIP] Semua file gagal dibaca.")
        return

    master_df = pd.concat(frames, ignore_index=True)

    # Deduplicate based on Transaction ID if it exists
    if "Transaction ID" in master_df.columns:
        before_count = len(master_df)
        master_df = master_df.drop_duplicates(subset=["Transaction ID"], keep="first")
        after_count = len(master_df)
        if before_count > after_count:
            log.info(f"  [INFO] Menghapus {before_count - after_count} baris duplikat.")

    # Normalisasi kolom tanggal
    date_cols = ["Updated On", "Created On", "Transfer Date"]
    for col in date_cols:
        if col in master_df.columns:
            parsed = pd.to_datetime(master_df[col], format="%d %b %Y %I:%M %p", errors="coerce")
            mask_failed = parsed.isna() & master_df[col].notna()
            if mask_failed.any():
                parsed[mask_failed] = pd.to_datetime(master_df.loc[mask_failed, col], errors="coerce")
            master_df[col] = parsed.dt.strftime("%Y-%m-%d at %H:%M").where(parsed.notna(), other=master_df[col])

    # Simpan sebagai CSV
    master_csv = laporan_dir / "MASTER.csv"
    master_df.to_csv(master_csv, index=False)

    # Simpan sebagai Excel
    master_xlsx = laporan_dir / "MASTER.xlsx"
    master_df.to_excel(master_xlsx, index=False, sheet_name="All Merchants")

    log.info(f"✓ Master CSV  : {master_csv}")
    log.info(f"✓ Master Excel: {master_xlsx}")
    log.info(f"  Total baris : {len(master_df):,} | Merchant: {master_df['Merchant'].nunique()}")

    # --- Distribusi ke Google Sheets via Apps Script ---
    apps_script_url = "https://script.google.com/macros/s/AKfycbxuqQ72VfP-5f-h-ud1XZDgG47KDwyP8gDg2AFzIjq6JrnZnWGenRs50G06RxsPiSxj/exec"
    if apps_script_url:
        log.info("\n📤 [PROGRESS] Mengirim data ke Google Sheets...")
        
        dist_df = master_df.copy()
        
        # Tambah Flag dan Month
        dist_df["Flag"] = "Final OP"
        
        def get_month_from_grab(date_str):
            try:
                # Format: "YYYY-MM-DD at HH:MM"
                return date_str.split(" ")[0][:7]
            except:
                return ""
        
        if "Created On" in dist_df.columns:
            dist_df["Month"] = dist_df["Created On"].apply(get_month_from_grab)
        else:
            dist_df["Month"] = ""
            
        dist_df["Move to OE/OP"] = ""
        
        # Headers target Grab (sesuai urutan di sheet)
        target_headers = [
            "Flag", "Month", "Merchant Name", "Merchant ID", "Store Name", "Store ID", 
            "Updated On", "Created On", "Type", "Category", "Subcategory", "Status", 
            "Transaction ID", "Linked Transaction ID", "Partner transaction ID 1", 
            "Partner transaction ID 2", "Long Order ID", "Short Order ID", "Booking ID", 
            "Order Channel", "Order Type", "Payment Method", "Receiving account / Source of fund", 
            "Terminal ID", "Channel", "Offer Type", "Grab Fee (%)", "Points Multiplier", 
            "Points Issued", "Settlement ID", "Transfer Date", "Amount", "Tax on Order Value", 
            "Restaurant Packaging Charge", "Non-Member Fee", "Restaurant Service Charge", 
            "Offer", "Discount (Merchant-Funded)", "Delivery Fee Discount (Merchant-Funded)", 
            "Delivery Charge (Grab Online Store)", "Delivery Charge (Merchant Delivery)", 
            "GrabExpress Delivery Service Fee", "Net Sales", "Net MDR", "Tax on MDR", 
            "Grab Fee", "Marketing success fee", "Delivery Commission", "Channel Commission", 
            "Order commission", "GrabFood / GrabMart Other Commission", "GrabKitchen Commission", 
            "GrabKitchen Other Commission", "Withholding Tax", "Total", "Tax on MDR (%)", 
            "Delivery Commission (%)", "Channel Commission (%)", "Order Commission (%)",
            "Tax on GrabFood / GrabMart Commission, Adjustments, Ads",
            "Tax on Total GrabKitchen Commission", "Cancellation Reason", "Cancelled by", 
            "Reason for Refund", "Description", "Incident group", "Incident alias", 
            "Customer refund Item", "Appeal link", "Appeal status", "Package/Voucher Used", 
            "Attributed Service Fee", "Attributed Promo", "Move to OE/OP"
        ]

        # Rename columns from MASTER to match target headers
        rename_map = {
            "Step-up commission": "GrabFood / GrabMart Other Commission",
            "Tax on GrabFood/GrabMart commission, adjustments, ads": "Tax on GrabFood / GrabMart Commission, Adjustments, Ads"
        }
        dist_df = dist_df.rename(columns=rename_map)
        
        # Pastikan semua kolom ada (isi kosong jika tidak ada)
        for col in target_headers:
            if col not in dist_df.columns:
                dist_df[col] = ""
        
        # Pilih kolom sesuai urutan target
        final_df = dist_df[target_headers]
        
        # Payload JSON (Handle NaN values which are not JSON compliant)
        payload = final_df.fillna("").to_dict(orient="records")
        
        try:
            response = requests.post(
                f"{apps_script_url}?sheet=Grab&clear=true",
                json=payload,
                timeout=60
            )
            if response.status_code == 200:
                res_json = response.json()
                if res_json.get("status") == "success":
                    log.info(f"✅ [SUCCESS] Berhasil mengirim {res_json.get('rows_added')} baris ke sheet Grab.")
                else:
                    log.error(f"❌ [ERROR] Apps Script error: {res_json.get('message')}")
            else:
                log.error(f"❌ [ERROR] Gagal mengirim data: HTTP {response.status_code}")
        except Exception as e:
            log.error(f"❌ [ERROR] Gagal terhubung ke Apps Script: {e}")
    else:
        log.info("\n⚠️ [SKIP] APPS_SCRIPT_URL tidak ditemukan di .env. Melewati distribusi ke G-Sheets.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Jalankan scraper Grab multi-portal dan hitung omzet."
    )
    parser.add_argument(
        "--start-date",
        default=None,
        help="Filter awal (inklusif), format YYYY-MM-DD. Contoh: 2026-02-01",
    )
    parser.add_argument(
        "--end-date",
        default=None,
        help="Filter akhir (inklusif), format YYYY-MM-DD. Contoh: 2026-04-30",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Override output directory for reports.",
    )
    parser.add_argument(
        "--user",
        default=None,
        help="Filter specific username to run.",
    )
    args = parser.parse_args()
    asyncio.run(run_all(date_start=args.start_date, date_end=args.end_date, output_dir=args.output_dir, user_filter=args.user))
