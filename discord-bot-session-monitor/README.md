# Discord Bot Session Monitor

Sebuah bot Discord untuk memantau status sesi login Shopee secara otomatis. Bot ini dirancang untuk dijalankan sebagai bagian dari sistem otomasi `task-weekly` (Superfood Automation).

## Fitur Utama

- **Pengecekan Sesi Harian Otomatis**: Secara otomatis memicu verifikasi sesi seluruh akun Shopee setiap pukul 08:00 WIB.
- **Slash Commands**: Jalankan perintah `/check-shopee` untuk memicu verifikasi sesi secara manual kapan saja dari Discord.
- **Interaksi Tombol OTP Terintegrasi**: Ketika browser memerlukan kode verifikasi OTP (WhatsApp/SMS), bot akan mengirimkan pesan interaktif dengan tombol "Masukkan OTP". Ketika diklik, modal akan muncul bagi pengguna untuk menginputkan kode OTP secara aman dan langsung meneruskannya ke browser.
- **Pemulihan Sesi Sekuensial**: Jika terdeteksi adanya sesi bermasalah/mati, bot akan memunculkan tombol "Pulihkan Sesi Bermasalah" untuk menjalankan pemulihan sekuensial satu-per-satu bagi akun-akun yang bermasalah.

## Prasyarat

- Node.js versi 16.x atau lebih baru
- Token Bot Discord, Client ID, dan Guild ID (Server ID)
- Python yang dikonfigurasi di Virtual Environment (`src/.venv/bin/python`) dengan pustaka-pustaka otomasi yang terpasang

## Cara Setup

1. **Salin File Environment**:
   Salin file `.env.example` menjadi `.env` di direktori ini:
   ```bash
   cp .env.example .env
   ```

2. **Konfigurasi Variabel Environment**:
   Buka file `.env` yang baru dibuat dan isi kredensial bot Anda:
   - `DISCORD_TOKEN`: Token bot Anda dari Discord Developer Portal.
   - `CLIENT_ID`: Application ID / Client ID bot Anda.
   - `GUILD_ID`: ID Server (Guild) tempat bot digunakan.
   - `WEBHOOK_URL`: URL Webhook Discord untuk cadangan notifikasi status sesi.
   - `VB_APPS_SCRIPT_URL`: URL Apps Script eksternal jika terintegrasi.
   - `HEADLESS`: Atur ke `true` untuk menjalankan browser secara headless (di latar belakang), atau `false` untuk menampilkan GUI browser saat pemulihan sesi.

3. **Install Dependensi**:
   ```bash
   npm install
   ```

4. **Daftarkan Slash Commands**:
   Jalankan perintah ini sekali untuk mendaftarkan perintah `/check-shopee` ke server Discord target Anda:
   ```bash
   npm run deploy
   ```

5. **Jalankan Bot**:
   ```bash
   npm start
   ```

## Struktur File

- `index.js`: Logika utama bot Discord (penanganan interaksi modal, tombol, slash command, scheduler harian, pemanggilan skrip Python).
- `deploy-commands.js`: Skrip pendaftaran/register slash command ke Discord API.
- `package.json` & `package-lock.json`: Definisi dependensi Node.js.
- `data/`: Folder lokal tempat penyimpanan data status sesi (diabaikan dari git).
