# 📋 Catatan Pembaruan Sistem (Changelog) — Version 1.1.0

**Tanggal Rilis:** 12 September 2026  
**Repositori:** `automation-report-V1`  
**Status:** Stabil & Teruji di Lingkungan Lokal (Belum di-push ke Remote Git)

---

## 📌 Ringkasan Eksekutif
Pembaruan versi **v1.1.0** berfokus pada dua pilar utama:
1. **Penyempurnaan & Stabilisasi Otomasi Login GoFood (`goscrapperv2`)**: Mengatasi masalah kegagalan login pada akun baru, eliminasi benturan selector modal cookie OneTrust, pencegahan salah klik tombol submit, injeksi stealth headless browser, dan penanganan sinkronisasi OTP Gmail agar tidak mengambil kode kedaluwarsa.
2. **Pembersihan Arsitektur & Eliminasi Dead Code**: Menghapus modul dan bot yang sudah tidak terpakai, menghilangkan duplikasi entrypoint CLI, memperbaiki fallback Google Sheets agar bebas error 401, serta merapikan konfigurasi Docker.

---

## 🛠️ Rincian Pembaruan per Komponen

### 1. Modul Otomasi GoFood (`src/goscrapperv2/gofood.py` & `src/goscrapperv2/LoginManual.py`)

#### 🔴 Masalah yang Ditemukan Sebelumnya:
* **OneTrust Cookie Trap (Ghost Input):** Selector lama `div[class*="otp" i] input` tidak sengaja mencocokkan panel preferensi cookie OneTrust (`div.otPcPanel`) yang memuat elemen tersembunyi `<input id="vendor-search-handler">`. Akibatnya kode OTP diketikkan ke elemen tak kasat mata, sementara field OTP asli (`#auth-otp-input`) tetap kosong.
* **Tombol Kembar "Masuk":** Pada layar OTP terdapat dua tombol: `#verify-otp-button` ("Masuk", nonaktif sebelum 4 digit terisi) dan `#verify-with-password-button` ("Masuk dengan password", selalu aktif). Selector lama `button:has-text("Masuk")` sering kali melompat mengklik tombol kedua, menyebabkan browser mental kembali ke halaman login awal.
* **Deteksi Bot Headless:** Browser Chromium headless tanpa skrip stealth mengekspos bendera `navigator.webdriver = true` dan kehilangan objek `window.chrome`, memicu sistem proteksi Gojek membatalkan sesi login.
* **Snapshot OTP Usang (Race Condition):** Jeda statis 1.5 detik sering kali melewatkan tombol *"Masuk dengan OTP"*. Polling Gmail kemudian memungut kode OTP lama dari sesi sebelumnya yang berbeda dengan snapshot awal, mengakibatkan OTP ditolak karena kedaluwarsa.
* **Timeout Prematur 15 Detik:** Kondisi `if time.time() - start_time > 15 and "/auth/login" in page.url: break` mematikan browser secara paksa sebelum pertukaran token dan redirect selesai.

#### 🟢 Solusi & Peningkatan yang Diterapkan:
* **Target Eksplisit Field OTP:**
  Mengunci selector langsung ke `#auth-otp-input` dan menyaring hanya elemen yang tampak:
  ```python
  otp_input_selector = '#auth-otp-input, input[name="otp"]:not(#vendor-search-handler), ...'
  otp_fields = [f for f in raw_otp if f.is_visible()]
  ```
* **Pemicu Event Input React (`.fill()`):**
  Menggunakan `element.fill(otp_code)` untuk memicu state validation React secara instan dan andal.
* **Target Khusus Tombol Submit OTP (`#verify-otp-button`):**
  Menunggu tombol submit utama berstatus `is_enabled() == True` dan memfilter agar tidak pernah menyentuh tombol *"Masuk dengan password"*:
  ```python
  specific_submit = page.locator('#verify-otp-button, button[name="verify-otp-button"]').first
  ```
* **Injeksi Skrip Stealth Headless:**
  Menambahkan `context.add_init_script()` untuk menyamarkan `navigator.webdriver` menjadi `undefined`, serta me-mock `window.chrome`, `plugins`, dan `languages` (`id-ID`, `id`, `en-US`).
* **Sinkronisasi Snapshot OTP Tepat Waktu:**
  Mengganti jeda statis dengan `btn_otp.wait_for(state="visible", timeout=6000)` dan mengambil snapshot OTP Gmail tepat beberapa milidetik sebelum tombol *"Masuk dengan OTP"* diklik.
* **Auto-Switch Mode Email:**
  Otomatis mendeteksi jika halaman login terbuka dalam mode nomor HP dan mengklik *"Masuk dengan email"*.
* **Penanganan Akun Baru & Multi-Storage:**
  Otomatis mendeteksi layar pemilihan outlet (`/choose-outlet`), popup persetujuan ketentuan, serta menambahkan fallback pembacaan token dari `localStorage['access_token']`.
* **Deteksi Rute `/dashboard` & Akselerasi Sukses:**
  Menambahkan pengecekan eksplisit terhadap URL rute autentikasi sukses (`/dashboard`, `/analytics`, `/order`, `/reports`). Begitu router browser berpindah ke rute ini, script langsung mengonfirmasi status sukses, menyedot token dari cookies/storage, dan menghentikan loop tunggu tanpa perlu menunggu timeout.
* **Optimalisasi Batas Waktu Cepat (10 Detik) & Observability:**
  Mengatur batas waktu tunggu maksimal menjadi **10 detik** (sangat responsif, langsung beralih/mencoba ulang jika router tidak segera berpindah ke dashboard), disertai penyimpanan tangkapan layar otomatis (`login_timeout_debug.png`) jika terjadi timeout.

---

### 2. Entrypoint CLI & Struktur Repositori

* **Delegator Wrapper Root (`cli.py`):**
  * Mengganti file root `cli.py` (sebelumnya 47 KB file lama tak terawat) dengan wrapper transparan 35 baris.
  * Wrapper ini otomatis mendeteksi Python virtualenv (`src/.venv` atau root) dan meneruskan argumen serta eksekusi ke `src/cli.py` dengan working directory `src/`.
* **Portabilitas Folder Laporan (`src/cli.py`):**
  * Fungsi `_resolve_output_dir()` kini memvalidasi izin tulis (`os.access(..., os.W_OK)`). Jika folder jaringan `/mnt/volume_web_scraping/baseline` tidak tersedia di lingkungan pengujian lokal, output otomatis dialihkan ke folder lokal `src/laporan/`.
* **Sentralisasi Konfigurasi Google Sheets:**
  * Mengganti URL fallback privat Google Sheets (`/export?format=csv`) yang memicu error `401 Unauthorized` di `gofood.py`, `run_baseline.py`, dan `src/cli.py` menjadi URL publik resmi (`pub?output=csv`).
  * Menambahkan loader `.env` otomatis di level teratas `src/cli.py`.

---

### 3. Pembersihan File Ad-Hoc & Modul Tidak Terpakai

Sesuai konfirmasi kebutuhan operasional, file dan modul berikut telah dibersihkan dari repositori:
* **Modul yang Dihapus:**
  * `menu/` & `discord-bot-menu/` (mekanisme penarik menu sudah tidak dipakai).
  * `shopee-session-monitor/` & `discord-bot-session-monitor/` (pemantau sesi lama yang sudah ditinggalkan).
  * Skrip eksperimen: `src/patch_baseline.py`, `src/patch_baseline_browser.py`, `check_shopee_browsers.py`, `deploy_menu.sh`.
  * Service systemd: `systemd/menu-bot.service`, `systemd/shopee-warmer.service`.
  * File sampel output data biner: `src/revenue_2026-03-01_sampai_2026-05-31.xlsx`.
* **Konfigurasi Deployment:**
  * Menghapus service yang telah usang dari `docker-compose.yml`, `docker-compose.production.yml`, dan `docker-compose.staging.yml`.
  * Memperbarui dokumentasi arsitektur di `README.md`.

---

## 🧪 Matriks Pengujian & Verifikasi

| Komponen / Skenario | Pengujian | Hasil | Catatan |
| :--- | :--- | :---: | :--- |
| **Kompilasi Kode** | `python3 -m py_compile ...` | 🟢 PASS | Bebas error sintaks pada seluruh file Python. |
| **Wrapper CLI** | `python cli.py --help` | 🟢 PASS | Argumen didelegasikan sempurna ke `src/cli.py`. |
| **Login Akun Baru** | Otomasi headless GoFood | 🟢 PASS | Berhasil melewati OTP & menangkap cabang ke `.env`. |
| **OneTrust Isolation** | DOM matching test | 🟢 PASS | Input `#vendor-search-handler` terisolasi 100%. |
| **Button Target Safety** | OTP Submit test | 🟢 PASS | `#verify-otp-button` ditargetkan tanpa menyentuh password button. |

---

## 🔒 Kebijakan Version Control (Git)
> [!IMPORTANT]
> Sesuai instruksi pengembang, seluruh perubahan pada rilis **v1.1.0** ini **TIDAK di-push ke GitHub** dan murni disimpan pada workspace lokal untuk memastikan stabilitas sebelum deployment resmi.
