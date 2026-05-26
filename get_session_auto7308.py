import sys
import os
import time
from pathlib import Path

# Add src/shopee-omzet-automation to sys path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), 'src', 'shopee-omzet-automation')))

from core import browser

def main():
    # Hanya untuk akun auto7308
    acc = {"phone": "+6285136517308", "username": "auto7308", "password": "Auto@7308"}

    print("Mendapatkan session khusus untuk akun auto7308...")
    
    script_dir = Path(os.path.abspath(os.path.join(os.path.dirname(__file__), 'src', 'shopee-omzet-automation')))
    data_dir = script_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    
    username = acc['username']
    phone = acc['phone']
    password = acc['password']
    
    print(f"\n{'='*50}")
    print(f"Memproses akun: {username}")
    print(f"{'='*50}")
    
    # Override session file destination
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

    print("\n✅ Proses get session selesai.")

if __name__ == "__main__":
    main()
