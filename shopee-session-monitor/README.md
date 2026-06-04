# Shopee Session Warmer

Layanan yang menjaga sesi Shopee Partner Portal tetap aktif dengan menjalankan browser headless secara berurutan untuk setiap akun, mengunjungi halaman Business Hours, dan menyimpan token yang diperbarui — berulang tanpa henti.

## Cara Kerja

1. Warmer membaca daftar akun dari `.env`.
2. Untuk setiap akun, warmer meluncurkan browser Selenium menggunakan profil Chrome khusus akun tersebut (`chrome_profile_{username}`).
3. Jika sesi sudah valid (sudah login), browser langsung mendarat di dashboard.
4. Warmer mengklik ke halaman **Business Hours** — ini memicu Shopee untuk menerbitkan cookie `shopee_tob_token` yang baru.
5. Token & cookie disimpan ke `src/shopee-omzet-automation/data/session_{username}.json`.
6. Browser ditutup, lalu pindah ke akun berikutnya.
7. Setelah seluruh akun selesai, warmer menunggu selama `LOOP_DELAY_SECONDS`, kemudian mengulang dari awal (akun A).

## Prasyarat

- Python yang dikonfigurasi di virtual environment `src/.venv` (menggunakan `uv`).
- Google Chrome sudah terpasang.
- Seluruh akun harus sudah pernah login setidaknya satu kali sehingga file session dan profil Chrome sudah tersedia.

## Cara Menjalankan (Lokal)

```bash
# Dari root direktori project (task-weekly/)
uv run shopee-session-monitor/warmer.py
```

Untuk tes lokal dengan browser GUI (agar bisa melihat prosesnya):
```
HEADLESS=false  ← sudah diatur di .env secara default
```

## Cara Menjalankan (Server / Produksi)

Ubah `.env`:
```
HEADLESS=true
```

Kemudian jalankan sebagai background process:
```bash
nohup uv run shopee-session-monitor/warmer.py > logs/warmer.log 2>&1 &
```

Atau daftarkan sebagai systemd service agar otomatis restart jika terjadi crash.

## Konfigurasi (`.env`)

| Variable | Default | Deskripsi |
|---|---|---|
| `HEADLESS` | `false` | `true` agar Chrome berjalan tanpa GUI |
| `LOOP_DELAY_SECONDS` | `1800` | Jeda antar siklus penuh (dalam detik) |
| `ACCOUNT_DELAY_SECONDS` | `15` | Jeda antar akun (dalam detik) |
| `ACCOUNTS` | *(semua akun)* | Daftar akun yang dipanaskan, pisahkan dengan koma |
| `DISCORD_WEBHOOK_URL` | *(kosong)* | URL webhook Discord untuk notifikasi (opsional) |

## Struktur File

```
shopee-session-monitor/
├── .env              ← konfigurasi aktif (tidak di-commit)
├── .env.example      ← template konfigurasi
├── README.md         ← dokumentasi ini
└── warmer.py         ← script utama
```
