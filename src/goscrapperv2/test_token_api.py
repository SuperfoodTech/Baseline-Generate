import os
import requests
from dotenv import load_dotenv

load_dotenv()

def main():
    token = os.getenv("BEARER_TOKEN")
    if not token:
        print("❌ Error: BEARER_TOKEN tidak ditemukan di file .env!")
        return

    headers = {
        'Accept': 'application/json, text/plain, */*',
        'Authentication-Type': 'go-id',
        'Authorization': f"Bearer {token}",
        'Origin': 'https://portal.gofoodmerchant.co.id',
        'Referer': 'https://portal.gofoodmerchant.co.id/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.84 Safari/537.36'
    }

    url = "https://api.gobiz.co.id/v1/users/me"
    
    print("Checking session token via GoBiz API...")
    try:
        response = requests.get(url, headers=headers)
        if response.status_code == 200:
            data = response.json()
            user_info = data.get('user', {})
            full_name = user_info.get('full_name', 'Unknown')
            email = user_info.get('email', 'Unknown')
            phone = user_info.get('phone_number', 'Unknown')
            print("\n" + "="*50)
            print("✅ TOKEN VALID DAN AKTIF!")
            print(f"Nama User   : {full_name}")
            print(f"Email       : {email}")
            print(f"Nomor HP    : {phone}")
            print("="*50 + "\n")
        else:
            print(f"❌ Gagal: API mengembalikan status code {response.status_code}")
            print(f"Detail Response: {response.text}")
    except Exception as e:
        print(f"❌ Terjadi kesalahan koneksi: {e}")

if __name__ == "__main__":
    main()
