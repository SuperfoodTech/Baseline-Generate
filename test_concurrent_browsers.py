import sys
import os
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import pandas as pd
import requests

# Add src/shopee-omzet-automation to sys path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), 'src', 'shopee-omzet-automation')))

from core import browser

def get_bd_credentials():
    url_creds = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYSUnKOqk29LCktTxdb0wPLbWMbRaWRP3eC_UA4AwYod1FW6zDMhtLMC5ghIvot2B8upCDfBsn-TCP/pub?gid=565510790&single=true&output=csv"
    cache_creds = "data/shopee_credentials_cache.csv"
    os.makedirs("data", exist_ok=True)
    
    print("🌐 Downloading credentials from Google Sheets...")
    try:
        resp = requests.get(url_creds, timeout=15)
        resp.raise_for_status()
        with open(cache_creds, "w", encoding="utf-8") as f:
            f.write(resp.text)
    except Exception as e:
        print(f"⚠️ Failed to download fresh credentials: {e}. Using cached list if available.")
        if not os.path.exists(cache_creds):
            print("❌ No cache found. Aborting.")
            sys.exit(1)
            
    df = pd.read_csv(cache_creds)
    target_bds = ["auto7303", "auto7304_", "auto7307", "auto7308"]
    accounts = []
    
    for _, row in df.iterrows():
        username = str(row.get('Username', '')).strip()
        password = str(row.get('Password', '')).strip()
        phone = str(row.get('Phone', '')).strip()
        if username in target_bds:
            accounts.append({
                "username": username,
                "password": password,
                "phone": phone
            })
            
    # Remove duplicates
    seen = set()
    unique_accounts = []
    for acc in accounts:
        if acc["username"] not in seen:
            seen.add(acc["username"])
            unique_accounts.append(acc)
            
    return unique_accounts

def check_and_login_account(acc):
    username = acc["username"]
    password = acc["password"]
    phone = acc["phone"]
    
    if phone.startswith("+"):
        phone = phone[1:]
        
    print(f"\n🔑 Checking session for '{username}'...")
    
    shopee_omzet_dir = Path(browser.__file__).resolve().parent.parent
    session_path = shopee_omzet_dir / "data" / f"session_{username}.json"
    browser.set_session_file(session_path)
    
    print(f"Browser will open (headless=False). If '{username}' is not logged in, please enter the OTP in the browser.")
    try:
        # Panggil get_session (akan mencoba restore token dahulu. Jika gagal/kedaluwarsa, ia akan ke halaman login)
        session_data = browser.get_session(
            username=username,
            password=password,
            phone=phone,
            headless=False,
            close_browser=True,
            interactive=True
        )
        
        if session_data:
            print(f"✅ [{username}] Sesi AKTIF dan tersimpan di: {session_path.name}")
            return True
        else:
            print(f"❌ [{username}] Gagal mendapatkan/menyimpan sesi.")
            return False
    except Exception as e:
        print(f"❌ [{username}] Error saat memeriksa sesi: {e}")
        return False

def launch_preview_window(acc):
    username = acc["username"]
    shopee_omzet_dir = Path(browser.__file__).resolve().parent.parent
    browser.set_session_file(shopee_omzet_dir / "data" / f"session_{username}.json")
    
    driver = None
    try:
        driver = browser._init_driver(headless=False)
        print(f"🚀 [{username}] Browser terbuka.")
        driver.get(browser.PARTNER_DASHBOARD)
        print(f"📍 [{username}] Berhasil diarahkan ke dashboard. Menjaga jendela tetap terbuka selama 45 detik...")
        time.sleep(45)
    except Exception as e:
        print(f"❌ [{username}] Gagal preview dashboard: {e}")
    finally:
        if driver:
            try:
                driver.quit()
                print(f"🛑 [{username}] Browser ditutup.")
            except:
                pass

def main():
    print("="*60)
    print("      SHOPEE CONCURRENT ISOLATED CHROME INSTANCE TESTER")
    print("="*60)
    
    accounts = get_bd_credentials()
    if not accounts:
        print("❌ No matching BD accounts found.")
        return
        
    shopee_omzet_dir = Path(browser.__file__).resolve().parent.parent
    
    while True:
        print("\nStatus Sesi Akun BD:")
        print(f"{'No.':<4} {'Username':<15} {'Status File Sesi':<20}")
        print("-"*45)
        for idx, acc in enumerate(accounts, 1):
            session_file = shopee_omzet_dir / "data" / f"session_{acc['username']}.json"
            status = "🟢 Ada/Terbuat" if session_file.exists() else "🔴 Belum Ada"
            print(f"{idx:<4} {acc['username']:<15} {status:<20}")
            
        print("\nPilih Menu:")
        print("1. Cek & Login Akun Satu per Satu (Untuk input OTP jika belum login)")
        print("2. Test Jalankan 4 Jendela Bersamaan (Concurrent Dashboard Preview)")
        print("3. Keluar")
        
        choice = input("\nMasukkan pilihan (1-3): ").strip()
        if choice == "1":
            for acc in accounts:
                check_and_login_account(acc)
                input("\nTekan Enter untuk lanjut ke akun berikutnya...")
        elif choice == "2":
            print("\nMemulai 4 jendela Chrome bersamaan secara paralel...")
            with ThreadPoolExecutor(max_workers=4) as executor:
                futures = {executor.submit(launch_preview_window, acc): acc for acc in accounts}
                for future in as_completed(futures):
                    acc = futures[future]
                    try:
                        future.result()
                    except Exception as e:
                        print(f"❌ [{acc['username']}] Exception: {e}")
            print("\n🎉 Concurrent test completed.")
        elif choice == "3":
            print("Keluar dari program.")
            break
        else:
            print("Pilihan tidak valid.")

if __name__ == "__main__":
    main()
