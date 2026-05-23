import os
import sys
import time

# Menambahkan path src agar bisa membaca modul VB.core
src_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, src_dir)
# Menambahkan path shopee-omzet-automation agar VB.core.client bisa mengimpor modul core bawaan
sys.path.insert(0, os.path.join(src_dir, "shopee-omzet-automation"))

from VB.core.browser import _init_driver, load_session
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By

def main():
    print("🚀 Membuka sesi Portal D (Gurame Bakar, Do Eat)...")
    
    # Init browser secara paksa
    driver = _init_driver(headless=False, account_name="portal_d")
    
    print("⏳ Mencoba me-load session yang tersimpan...")
    saved = load_session("portal_d")
    
    driver.get("https://partner.shopee.co.id/food/dashboard")
    time.sleep(3)
    
    if saved:
        print("🔍 Menginjeksi cookie session ke browser...")
        driver.add_cookie({"name": "shopee_tob_token", "value": saved["shopee_tob_token"]})
        if saved.get("shopee_tob_entity_id"):
            driver.add_cookie({"name": "shopee_tob_entity_id", "value": saved["shopee_tob_entity_id"]})
        for n, v in saved.get("extra_cookies", {}).items():
            try: driver.add_cookie({"name": n, "value": v})
            except: pass
        driver.refresh()
        time.sleep(4)
        
        if "dashboard" in driver.current_url.lower() or "merchant-selector" in driver.current_url.lower():
            print("✅ Berhasil masuk ke dashboard dengan session yang tersimpan!")
        else:
            print("⚠️ Cookie mungkin sudah expired, silakan login ulang di browser.")
    else:
        print("⚠️ Tidak ada session tersimpan, silakan login manual.")
        
    print("\n" + "="*50)
    print("⏳ SESI BROWSER TERBUKA TANPA TIMEOUT")
    print("🔎 Silakan gunakan browser ini untuk inspeksi Network/API.")
    print("❌ Tekan CTRL+C di terminal ini untuk menutup program.")
    print("="*50 + "\n")
    
    try:
        # Loop abadi tanpa timeout
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n🛑 Menutup program (browser mungkin masih terbuka)...")
        print("👋 Sampai jumpa!")

if __name__ == "__main__":
    main()
