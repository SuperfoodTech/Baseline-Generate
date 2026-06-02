import sys
import os
import time
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import pandas as pd
import requests

# Add src/shopee-omzet-automation to sys path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), 'src', 'shopee-omzet-automation')))

from core import browser
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.action_chains import ActionChains

def get_bd_credentials():
    cache_creds = "data/shopee_credentials_cache.csv"
    if not os.path.exists(cache_creds):
        # Mengunduh fresh list jika tidak ada cache
        url_creds = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYSUnKOqk29LCktTxdb0wPLbWMbRaWRP3eC_UA4AwYod1FW6zDMhtLMC5ghIvot2B8upCDfBsn-TCP/pub?gid=565510790&single=true&output=csv"
        try:
            resp = requests.get(url_creds, timeout=15)
            resp.raise_for_status()
            os.makedirs("data", exist_ok=True)
            with open(cache_creds, "w", encoding="utf-8") as f:
                f.write(resp.text)
        except Exception as e:
            print(f"❌ Gagal mengunduh kredensial: {e}", flush=True)
            return []
            
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
    seen = set()
    unique_accounts = []
    for acc in accounts:
        if acc["username"] not in seen:
            seen.add(acc["username"])
            unique_accounts.append(acc)
    return unique_accounts

def check_account_session(acc):
    username = acc["username"]
    password = acc["password"]
    phone = acc["phone"]
    if phone.startswith("+"):
        phone = phone[1:]
        
    print(f"🚀 [{username}] Memulai verifikasi sesi...", flush=True)
    shopee_omzet_dir = Path(browser.__file__).resolve().parent.parent
    session_path = shopee_omzet_dir / "data" / f"session_{username}.json"
    browser.set_session_file(session_path)
    
    # Hubungkan browser (headless=True secara default di server/docker)
    headless = os.getenv("HEADLESS", "true").lower() == "true"
    
    session_data = None
    try:
        session_data = browser.get_session(
            username=username,
            password=password,
            phone=phone,
            headless=headless,
            close_browser=False, # Pertahankan untuk pengujian switch merchant
            interactive=True     # Harus True agar memicu input OTP jika dibutuhkan
        )
    except Exception as e:
        print(f"❌ [{username}] Terjadi kesalahan saat inisialisasi sesi: {e}", flush=True)
        return {"username": username, "status": "ERROR", "message": str(e)}
        
    if not session_data:
        return {"username": username, "status": "EXPIRED", "message": "Sesi kedaluwarsa / Gagal Login"}
        
    driver = session_data.get("driver")
    if not driver:
        return {"username": username, "status": "EXPIRED", "message": "Driver browser tidak ditemukan"}
        
    try:
        wait = WebDriverWait(driver, 20)
        
        # 1. Pastikan berada di dashboard
        if "/food/dashboard" not in driver.current_url:
            driver.get(browser.PARTNER_DASHBOARD)
            time.sleep(3)
            
        # 2. Dapatkan merchant saat ini
        try:
            current_merchant = wait.until(
                EC.visibility_of_element_located((By.CSS_SELECTOR, ".merchantName"))
            ).text.strip()
        except Exception as e:
            return {"username": username, "status": "EXPIRED", "message": "Gagal mendeteksi nama merchant di dashboard"}
            
        # 3. Buka menu untuk memindai merchant lain yang tersedia
        profile_menu = wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, ".merchantName")))
        actions = ActionChains(driver)
        actions.move_to_element(profile_menu).click().perform()
        time.sleep(2)
        
        # Hover ke "Pilih Merchant Lain" / "Switch Merchant"
        try:
            switch_trigger = wait.until(EC.presence_of_element_located((By.XPATH, "//span[contains(text(), 'Pilih Merchant Lain') or contains(text(), 'Switch Merchant')]")))
            actions.move_to_element(switch_trigger).perform()
            time.sleep(2)
        except:
            # Fallback JS click
            driver.execute_script("""
                var spans = document.querySelectorAll('span, p, div');
                for (var s of spans) {
                    if (s.innerText.includes('Pilih Merchant Lain') || s.innerText.includes('Switch Merchant')) {
                        s.click();
                        break;
                    }
                }
            """)
            time.sleep(2)
            
        # Dapatkan daftar merchant dari menu dropdown
        merchant_options = driver.execute_script("""
            var items = document.querySelectorAll('li.ant-menu-item, li[role="menuitem"], .ant-dropdown-menu-item, [class*="menu-item"]');
            var names = [];
            for (var i = 0; i < items.length; i++) {
                var text = (items[i].innerText || "").trim();
                if (text && !text.includes('Pilih Merchant') && !text.includes('Switch')) {
                    names.push(text);
                }
            }
            return names;
        """)
        
        # Membersihkan daftar nama merchant dengan menyaring non-merchant (blacklist)
        blacklist = {
            'halaman utama', 'notifikasi', 'pusat bantuan', 'performa outlet', 
            'menu', 'baru', 'manajemen pesanan', 'payout', 'faktur pajak', 
            'faktur', 'laporan saya', 'akun', 'ubah bahasa', 'syarat & ketentuan', 
            'log out', 'switch merchant', 'pilih merchant lain', 'shopeefood', 
            'kembali', 'bantuan', 'transaksi', 'saldo', 'promosi', 'pengaturan'
        }
        
        clean_merchant_options = []
        for name in merchant_options:
            lines = [line.strip() for line in name.split('\n') if line.strip()]
            if lines:
                first_line = lines[0]
                if first_line.lower() not in blacklist and len(first_line) > 3:
                    clean_merchant_options.append(first_line)
                    
        # Filter merchant lain (yang tidak sama dengan current_merchant)
        other_merchants = [m for m in clean_merchant_options if m.lower() != current_merchant.lower()]
        
        if not other_merchants:
            # Hanya ada 1 merchant, pengetesan switch dilewati, sesi dianggap aktif
            print(f"✅ [{username}] Sesi aktif (Single Merchant: '{current_merchant}')", flush=True)
            return {"username": username, "status": "ACTIVE", "message": f"Aktif ({current_merchant})"}
            
        target_merchant = other_merchants[0]
        
        # Lakukan switch
        switch_success = browser.auto_switch_merchant(driver, target_merchant)
        if switch_success:
            time.sleep(3)
            # Kembalikan ke merchant semula
            switch_back_success = browser.auto_switch_merchant(driver, current_merchant)
            if switch_back_success:
                print(f"✅ [{username}] Sesi aktif & Sukses uji pemindahan merchant ('{current_merchant}' 🔄 '{target_merchant}')", flush=True)
                return {"username": username, "status": "ACTIVE", "message": f"Aktif & Switch Sukses ({current_merchant})"}
            else:
                print(f"⚠️ [{username}] Gagal kembali ke merchant awal ('{current_merchant}'). Mencoba memulihkan dengan membuka ulang browser...", flush=True)
                try:
                    driver.quit()
                    driver = None
                except:
                    pass
                time.sleep(2)
                try:
                    session_data = browser.get_session(
                        username=username,
                        password=password,
                        phone=phone,
                        headless=headless,
                        close_browser=False,
                        interactive=True
                    )
                    if session_data and "driver" in session_data:
                        driver = session_data["driver"]
                        wait = WebDriverWait(driver, 20)
                        if "/food/dashboard" not in driver.current_url:
                            driver.get(browser.PARTNER_DASHBOARD)
                            time.sleep(3)
                        current_merchant_reopened = wait.until(
                            EC.visibility_of_element_located((By.CSS_SELECTOR, ".merchantName"))
                        ).text.strip()
                        print(f"✅ [{username}] Berhasil pulih setelah buka ulang browser. Merchant saat ini: '{current_merchant_reopened}'", flush=True)
                        return {"username": username, "status": "ACTIVE", "message": f"Aktif & Pulih ({current_merchant_reopened})"}
                except Exception as recovery_error:
                    print(f"❌ [{username}] Gagal memulihkan browser: {recovery_error}", flush=True)
                return {"username": username, "status": "WARNING", "message": "Gagal kembali ke merchant awal"}
        else:
            return {"username": username, "status": "WARNING", "message": "Gagal berpindah ke merchant alternatif"}
            
    except Exception as e:
        return {"username": username, "status": "ERROR", "message": f"Terjadi kesalahan saat pengujian: {e}"}
    finally:
        if driver:
            try:
                driver.quit()
            except:
                pass

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--username', type=str, default=None, help='Target username to check')
    parser.add_argument('--sequential', action='store_true', help='Run checks sequentially')
    args = parser.parse_args()

    accounts = get_bd_credentials()
    if not accounts:
        print("❌ Tidak ada akun untuk diproses.", flush=True)
        return
        
    if args.username:
        accounts = [acc for acc in accounts if acc["username"].lower() == args.username.lower()]
        if not accounts:
            print(f"❌ Akun {args.username} tidak ditemukan di kredensial.", flush=True)
            return

    is_seq = args.sequential or (len(accounts) == 1)
    
    if is_seq:
        print(f"⚙️ Memulai verifikasi sesi secara sekuensial untuk {len(accounts)} akun (Headless)...", flush=True)
        results = []
        for acc in accounts:
            try:
                res = check_account_session(acc)
                results.append(res)
            except Exception as e:
                results.append({"username": acc["username"], "status": "ERROR", "message": str(e)})
    else:
        print(f"⚙️ Memulai verifikasi sesi paralel untuk {len(accounts)} akun (Headless)...", flush=True)
        results = []
        with ThreadPoolExecutor(max_workers=len(accounts)) as executor:
            futures = {executor.submit(check_account_session, acc): acc for acc in accounts}
            for future in as_completed(futures):
                acc = futures[future]
                try:
                    res = future.result()
                    results.append(res)
                except Exception as e:
                    results.append({"username": acc["username"], "status": "ERROR", "message": str(e)})
                
    # Tampilkan output JSON final yang dapat dibaca oleh Node.js bot
    print(f"\nFINAL_RESULTS: {json.dumps(results)}")

if __name__ == "__main__":
    main()
