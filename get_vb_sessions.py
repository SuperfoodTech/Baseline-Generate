import sys
import os
import time
from pathlib import Path

# Add src/shopee-omzet-automation to sys path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), 'src', 'shopee-omzet-automation')))

from core import browser

def main():
    accounts = [
        {"phone": "+6285136517303", "username": "auto7303", "password": "Auto@7303"},
        {"phone": "+6285136517304", "username": "auto7304", "password": "Auto@7304_"},
        {"phone": "+6285136517307", "username": "auto7307", "password": "Auto@7307"},
        {"phone": "+6285136517308", "username": "auto7308", "password": "Auto@7308"}
    ]

    print("Mendapatkan session untuk 4 akun VB + Agency Specific...")
    
    script_dir = Path(os.path.abspath(os.path.join(os.path.dirname(__file__), 'src', 'shopee-omzet-automation')))
    data_dir = script_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    
    for acc in accounts:
        username = acc['username']
        phone = acc['phone']
        password = acc['password']
        
        print(f"\n{'='*50}")
        print(f"Memproses akun: {username}")
        print(f"{'='*50}")
        
        # Override session file destination for each account
        session_path = data_dir / f"session_{username}.json"
        browser.SESSION_FILE = session_path
        
        # Panggil get_session
        session_data = browser.get_session(
            username=username,
            password=password,
            phone=phone,
            headless=False, # Run with browser UI for manual OTP input
            close_browser=True,
            interactive=False
        )
        
        if session_data:
            print(f"✅ Berhasil mendapatkan dan menyimpan session untuk {username}")
            print(f"📁 Disimpan di: {session_path}")
        else:
            print(f"❌ Gagal mendapatkan session untuk {username}")
            
        print("Menunggu beberapa detik sebelum lanjut...")
        time.sleep(5)

    print("\n✅ Semua proses get session selesai.")

if __name__ == "__main__":
    main()
