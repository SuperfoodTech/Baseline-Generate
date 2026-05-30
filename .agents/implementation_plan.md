# 🗺️ Rencana Implementasi: Dukungan Multi-Merchant / Multi-Portal pada Task Baseline

Dokumen ini berisi rencana perbaikan untuk mendukung eksekusi multi-merchant (ShopeeFood) dan multi-portal (GrabFood) pada outlet dengan nama yang sama khusus untuk **Task Baseline**.

---

## 📌 Masalah yang Diidentifikasi
1. **ShopeeFood (Hanya Mengambil Satu Merchant):**
   Pada task baseline, ketika satu outlet dipilih (misal: `"RM Ampera Tunas Harapan"`), sistem pencarian merchant ShopeeFood hanya mengambil baris pertama (`iloc[0]`), sehingga merchant kedua (`Tunas Harapan Borobudur_`) tidak ikut dieksekusi.
2. **GrabFood (Overwriting File Intermediate):**
   Jika terdapat beberapa portal GrabFood dengan nama outlet yang sama dan tanpa cabang, file Excel intermediate hasil unduhannya akan disimpan dengan nama yang sama (misal: `RM_Ampera_Tunas_Harapan.xlsx`). Hal ini menyebabkan file portal pertama tertimpa oleh portal berikutnya.
3. **Penyaringan Filter Shopee Pasca-Merge (`cli.py`):**
   Pada akhir proses, `cli.py` membaca `BASELINE_MASTER_SHOPEE.xlsx` & memfilternya menggunakan list `shopee_merchant`. Namun, karena string merchant berupa gabungan pipe (misal: `['Padang Tunas Harapan Mojolangu|Tunas Harapan Borobudur_']`), pencocokan menggunakan `.isin()` gagal karena tidak dipecah menjadi elemen-elemen individual.

---

## 🛠️ Langkah-Langkah Implementasi

### 1. Pencarian Multi-Merchant ShopeeFood (`src/cli.py`)
- **Modifikasi `_resolve_shopee_merchant`**:
  Jika `task_choice == "1"` (Baseline), ambil semua `Merchant Name` unik yang berasosiasi dengan outlet tersebut, lalu gabungkan dengan pemisah pipe `|`.
- **Modifikasi `interactive_mode`**:
  Lakukan hal serupa saat melakukan pencarian merchant ShopeeFood secara interaktif untuk opsi Baseline.

### 2. Pencegahan Overwrite & Perbaikan Merger GrabFood (`src/baseline/grab/run_baseline.py`)
- **Nama File Intermediate Unik**:
  Pada `run_baseline.py` milik Grab, jika terdeteksi ada lebih dari 1 portal dengan kombinasi `outlet` dan `branch` yang sama, sertakan username (`_{user}`) di akhir nama file intermediate.
- **Penyelarasan Merger**:
  Sesuaikan logika deteksi file di bagian penggabungan data agar dapat mendeteksi file intermediate yang memiliki suffix username tersebut, sehingga semuanya ikut digabungkan ke dalam file master.

### 3. Normalisasi List Merchant Shopee (`src/cli.py`)
- **Pemisahan String Pipe**:
  Di dalam `main()` pada `cli.py`, sebelum menjalankan pipeline dan proses merging, pecah nilai `shopee_merchant` (jika mengandung `|`) menjadi elemen list individual.
  Hal ini akan menjamin filter `.isin(m_lower)` pada baris ke-1208 dapat bekerja dengan tepat.

---

## 🧪 Skenario Pengujian & Validasi
1. Jalankan CLI secara interaktif untuk mode Baseline.
2. Pilih outlet `"RM Ampera Tunas Harapan"`.
3. Pastikan log menunjukkan pencarian merchant ShopeeFood menghasilkan kedua merchant (`Padang Tunas Harapan Mojolangu` dan `Tunas Harapan Borobudur_`).
4. Verifikasi bahwa proses scraping berjalan untuk seluruh merchant/portal tersebut secara berurutan.
5. Verifikasi bahwa file excel gabungan di `laporan/baseline/{tanggal}` berisi data yang lengkap dari seluruh merchant/portal yang dieksekusi.
