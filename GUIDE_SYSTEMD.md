# 🛠️ Panduan Hands-On: Update System & Session (Systemd)

Panduan praktis untuk mengelola, memperbarui kode, dan meng-update session/profile Chrome secara langsung pada server production berbasis `systemctl`.

---

## 1. Cara Update Sistem / Update Kode (Deploy)

Ketika kamu melakukan perubahan kode (misal push dari lokal ke GitHub), jalankan langkah berikut di server:

```bash
# 1. Masuk ke folder project
cd ~/task-weekly

# 2. Jalankan script deploy (Otomatis git pull & restart services)
./deploy.sh
```

> **INFO:** Proses ini instan (hanya 2-5 detik) karena tidak membutuhkan build docker image ulang.

---

## 2. Cara Update Session / Chrome Profile (Akun Shopee)

Karena kita tidak memakai Docker, Chrome Profile dan file session disimpan langsung di folder project server.

### Langkah A: Update file Session `.json` & Chrome Profile
1. Pastikan file profile terbaru (`chrome_profile_autoXXXX`) dan file session `.json` sudah ada di laptop lokal kamu di dalam folder:
   `src/shopee-omzet-automation/data/`
2. Push file-file tersebut ke GitHub main branch (atau sync langsung ke server).
3. Di server, lakukan pull:
   ```bash
   cd ~/task-weekly
   git pull origin main
   ```

### Langkah B: Restart Service agar memuat Session Baru
Setelah file session di server ter-update, restart service warmer agar menggunakan profil yang baru:
```bash
sudo systemctl restart shopee-warmer
```

---

## 3. Perintah Monitoring yang Sering Digunakan

Gunakan perintah ini untuk memantau apakah sistem berjalan lancar setelah di-update:

| Kebutuhan | Perintah |
|---|---|
| **Cek status kedua service** | `sudo systemctl status ofd-bot shopee-warmer` |
| **Cek log live Discord Bot** | `sudo journalctl -u ofd-bot -f` |
| **Cek log live Shopee Warmer** | `sudo journalctl -u shopee-warmer -f` |
| **Cek penggunaan RAM real-time** | `free -h` |
| **Cek penggunaan RAM per service**| `systemctl status shopee-warmer ofd-bot | grep Memory` |

---

## 4. Troubleshooting Cepat

* **Error: `SingletonLock` / Session Not Created**
  Jika Chrome crash karena lock file lama menempel di folder profile, systemd otomatis menghapusnya saat startup. Jika perlu hapus manual:
  ```bash
  rm -f ~/task-weekly/src/shopee-omzet-automation/data/chrome_profile_*/SingletonLock
  sudo systemctl restart shopee-warmer
  ```

* **Service tidak bisa jalan / Stuck**
  Coba restart paksa:
  ```bash
  sudo systemctl restart ofd-bot shopee-warmer
  ```

---

## 5. Setup Auto-Deploy GitHub ke Systemd (CD)

Ada dua metode utama untuk membuat branch `main` di GitHub otomatis ter-deploy ke systemd di server setiap kali kamu melakukan `git push`:

### Metode A: Menggunakan GitHub Actions & SSH (Direkomendasikan)
Metode ini paling umum dan bersih. GitHub Actions akan masuk ke server menggunakan SSH Key, lalu menjalankan `./deploy.sh`.

#### Langkah 1: Buat SSH Key Pair khusus untuk Deploy (di Server)
1. Login ke SSH server kamu sebagai user `akbar` (atau user yang menjalankan systemd).
2. Generate key pair baru:
   ```bash
   ssh-keygen -t ed25519 -C "github-actions-deploy"
   ```
   *(Tekan Enter untuk default path `/home/akbar/.ssh/id_ed25519` dan kosongkan passphrase)*.
3. Daftarkan public key ke file `authorized_keys`:
   ```bash
   cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   chmod 700 ~/.ssh
   ```
4. Salin isi **Private Key** untuk dimasukkan ke GitHub:
   ```bash
   cat ~/.ssh/id_ed25519
   ```

#### Langkah 2: Daftarkan Secrets di Repository GitHub
Buka repository GitHub kamu, pergi ke **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret**.
Tambahkan secrets berikut:
1. `SSH_HOST`: IP Address / Hostname server kamu.
2. `SSH_USERNAME`: Username server kamu (misal `akbar`).
3. `SSH_PRIVATE_KEY`: Tempel isi private key yang tadi kamu salin (mulai dari `-----BEGIN OPENSSH PRIVATE KEY-----` sampai akhir).
4. `SSH_PORT`: `22` (atau port SSH custom jika ada).

File workflow GitHub Actions sudah disediakan di `.github/workflows/deploy.yml`. Begitu secrets di atas ditambahkan, setiap kali kamu push ke `main`, GitHub akan otomatis melakukan SSH ke server dan menjalankan `./deploy.sh`.

---

### Metode B: Menggunakan GitHub Self-Hosted Runner (Alternatif)
Jika server berada di balik firewall/NAT sehingga port SSH-nya tidak bisa diakses dari internet publik oleh server GitHub, kamu bisa menggunakan **GitHub Self-Hosted Runner**.

1. Di GitHub repository, buka **Settings** -> **Actions** -> **Runners** -> **New self-hosted runner**.
2. Pilih OS **Linux** dan ikuti instruksi command line untuk men-download dan mengkonfigurasi runner di server kamu.
3. Jalankan runner sebagai service systemd di server agar selalu aktif di background:
   ```bash
   sudo ./svc.sh install
   sudo ./svc.sh start
   ```
4. Ubah file `.github/workflows/deploy.yml` bagian `runs-on` menjadi `self-hosted` dan jalankan script deploy lokal:
   ```yaml
   runs-on: self-hosted
   steps:
     - name: Run Deploy Script
       run: |
         cd ~/task-weekly
         ./deploy.sh
   ```
