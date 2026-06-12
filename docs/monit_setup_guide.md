# Panduan Setup & Penggunaan Monit di Server

Monit adalah alat pemantau sistem Unix yang sangat ringan (RAM < 10MB) dan tangguh. Kita bisa menggunakannya untuk memantau RAM server, serta memicu skrip pembersih `clean-orphans.sh` jika penggunaan memori kritis.

---

## 📥 1. Instalasi Monit

Jalankan perintah berikut di server melalui SSH:
```bash
sudo apt update
sudo apt install -y monit
```

Pastikan service Monit aktif dan berjalan secara otomatis saat server booting:
```bash
sudo systemctl enable --now monit
```

---

## 🛠️ 2. Konfigurasi Monit

Buka file konfigurasi Monit di `/etc/monit/monitrc`:
```bash
sudo nano /etc/monit/monitrc
```

Tambahkan baris berikut di bagian paling bawah file konfigurasi tersebut:

```monit
# ── 1. Pemantauan RAM & CPU Server ───────────────────────────────────────────
check system $HOST
    # Jika penggunaan RAM > 85% selama 2 siklus (2 x 2 menit), jalankan pembersihan
    if memory usage > 85% for 2 cycles then exec "/bin/bash /home/akbar/task-weekly/clean-orphans.sh >> /home/akbar/task-weekly/clean-orphans.log 2>&1"

# ── 2. Pemantauan Service Warmer & Bot ───────────────────────────────────────
check program shopee-warmer with path "/usr/bin/systemctl is-active shopee-warmer"
    if status != 0 then exec "/usr/bin/systemctl start shopee-warmer"

check program ofd-bot with path "/usr/bin/systemctl is-active ofd-bot"
    if status != 0 then exec "/usr/bin/systemctl start ofd-bot"
```

> [!IMPORTANT]
> Monit secara default memeriksa status setiap 120 detik (2 menit). Anda dapat menyesuaikan interval ini pada baris `set daemon 120` di dalam file `monitrc`.

Setelah selesai mengedit file, uji konfigurasi untuk memastikan tidak ada kesalahan penulisan:
```bash
sudo monit -t
```
Jika outputnya adalah `Control file syntax OK`, muat ulang konfigurasi Monit:
```bash
sudo monit reload
```

---

## 🖥️ 3. Menggunakan Dashboard CLI Monit

Anda dapat melihat status seluruh service dan performa sistem secara langsung di terminal dengan perintah:
```bash
sudo monit status
```

Outputnya akan berupa dashboard interaktif seperti ini:
```text
System 'web-scrapers-ubuntu-s-1vcpu-2gb-sgp1'
  status                       OK
  monitoring status            Monitored
  load average                 [1.12, 1.45, 1.87]
  cpu                          4.2%usr 1.1%sys 0.5%wait
  memory usage                 54.2% [1.0 GiB/1.9 GiB]
  swap usage                   13.3% [267 MiB/2.0 GiB]

Program 'shopee-warmer'
  status                       Status ok
  monitoring status            Monitored
  last exit value              0

Program 'ofd-bot'
  status                       Status ok
  monitoring status            Monitored
  last exit value              0
```

---

## 🌐 4. Mengaktifkan Web GUI Monit (Opsional)

Monit juga menyediakan Web GUI cantik yang bisa diakses via browser. Untuk mengaktifkannya, buka `/etc/monit/monitrc` dan cari baris berikut (buka comment `#` jika ada):

```monit
set httpd port 2812 and
    use address localhost  # Hanya izinkan localhost (gunakan SSH Tunnel)
    allow admin:monit      # Username: admin, Password: monit
```

Setelah reload, Anda bisa membuat SSH tunnel dari komputer lokal ke server:
```bash
ssh -L 2812:localhost:2812 akbar@168.144.143.203
```
Kemudian buka browser Anda dan akses: `http://localhost:2812` (masuk dengan user `admin` dan password `monit`).
