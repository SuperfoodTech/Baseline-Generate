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
