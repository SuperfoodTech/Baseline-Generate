# LLM Council Transcript: Perbaikan Otomasi Login GoFood Akun Baru

**Tanggal:** 11 September 2026  
**Topik:** Investigasi & Solusi Kegagalan Login Otomatis GoFood Akun Baru (`bakmierose1@byfoodmaster.com`, `bakmirose2@byfoodmaster.com`)  
**Metodologi:** Andrej Karpathy's 5-Advisor LLM Council with Anonymous Peer Review & Chairman Synthesis  

---

## 1. Framing Pertanyaan

> **Pertanyaan & Masalah Inti:**  
> Pada sistem otomatisasi `src/goscrapperv2/gofood.py`, proses login otomatis untuk akun baru gagal dan mengalami perulangan (retry loop) setelah pengisian OTP.  
> Dari log produksi:
> ```
> 🤖 OTP didapat: 5305. Memasukkan OTP...
> ✅ OTP berhasil diisi otomatis.
> 🤖 Mengklik tombol OTP: 'Masuk'
> ⚠️ (Fallback) Timeout 15 detik: URL masih stuck di halaman login. Mempercepat percobaan ulang...
> ⚠️ Token tidak ditemukan. Kembali ke login page dengan email yang sama...
> ```
> Namun, ketika pengguna melakukan login manual di browser dengan akun baru tersebut, login berhasil dan langsung masuk tanpa hambatan.  
> 
> **Konteks & Bukti DOM Internal:**
> 1. Pada halaman `https://portal.gofoodmerchant.co.id/auth/login/email`, selector `div[class*="otp" i] input` tidak sengaja mencocokkan banner cookie OneTrust (`div.otPcPanel` yang memuat `<input id="vendor-search-handler">`). Elemen ini berada di posisi paling atas DOM (`index 0`) dan tersembunyi (`is_visible=False`).
> 2. Kode `otp_fields[0].focus()` dan `otp_fields[0].type(...)` mengetikkan OTP ke input pencarian cookie OneTrust yang tersembunyi, bukan ke input OTP sebenarnya (`#auth-otp-input`).
> 3. Field OTP asli (`#auth-otp-input`) tetap kosong, sehingga tombol submit "Masuk" tetap berstatus `disabled=True` atau form tidak pernah terkirim.
> 4. Terdapat batas waktu agresif 15 detik (`if time.time() - start_time > 15 and "/auth/login" in page.url: break`), padahal pada server VPS (1 vCPU) dan akun baru yang membutuhkan redirect/pemilihan outlet, proses handshake token membutuhkan waktu lebih dari 15 detik.
> 5. Pengecekan token hanya membaca `context.cookies()`, mengabaikan `localStorage` dan potensi popup/modal persetujuan untuk akun baru.
>
> **Taruhan:** Keandalan penarikan data mingguan untuk seluruh outlet mitra GoFood tanpa intervensi manual developer.

---

## 2. Analisis 5 Penasihat Independen

### Advisor 1: The Contrarian
> *"Kalian berasumsi bahwa masalahnya ada pada otentikasi Gojek yang berubah atau akun baru memiliki alur khusus. Itu keliru. Masalah terbesarnya adalah 'Silent Ghost Failure' pada selector Playwright.  
> Log kalian mencatat `✅ OTP berhasil diisi otomatis`, tapi faktanya kode kalian mengetik angka ke elemen hantu (`vendor-search-handler` milik OneTrust) karena kecocokan regex `class*="otp"` terhadap `otPcPanel`! Kalian mengira OTP sudah masuk, padahal input aslinya masih kosong melompong.  
> Lebih parah lagi, fallback 15 detik kalian membunuh proses yang sebenarnya sedang berjalan. Pada Single Page Application (SPA), URL `/auth/login/email` tidak serta merta berganti dalam 15 detik di server murah 1 vCPU 2GB. Membunuh halaman di detik ke-15 menjamin 100% kegagalan. Jangan tambahkan fitur baru sebelum kalian memperbaiki dua cacat fatal ini: hapus selector liar OneTrust dan perpanjang timeout hingga 45-60 detik."*

### Advisor 2: The First Principles Thinker
> *"Mari kita dekonstruksi anatomi interaksi browser pada login GoBiz/GoFood:  
> 1. Input: Ada 1 field teks nyata dengan ID unik `#auth-otp-input` (atau `input[name="otp"]`) dengan `maxLength=4`.  
> 2. Event: React menunggu event `input` atau `change` nyata pada elemen tersebut agar state tombol submit berubah dari `disabled=True` ke `disabled=False`.  
> 3. Submit: Tombol submit adalah `button` bertuliskan 'Masuk' yang menjadi aktif hanya setelah 4 digit valid terisi. Jika submit berhasil, Gojek mengirim request POST ke auth server dan mengembalikan cookie `access_token` atau menyimpannya di storage.  
> 4. Redirect: Pada akun baru, Gojek seringkali mengarahkan ke pemilihan outlet (`/choose-outlet`) atau menampilkan dialog onboarding.  
> Solusi prinsip dasarnya jelas: spesifikkan selector langsung ke `input#auth-otp-input`, validasi nilai field dengan `element.fill(otp_code)` (bukan sekadar `type`), pastikan tombol 'Masuk' benar-benar `enabled` sebelum diklik, dan dengarkan event network/URL navigation bukan polling buta 15 detik."*

### Advisor 3: The Expansionist
> *"Kegagalan ini adalah peluang emas untuk membuat modul otentikasi GoFood menjadi 'bulletproof' untuk jangka panjang. Jangan hanya memperbaiki input OTP hari ini lalu jebol lagi bulan depan saat Gojek update UI.  
> Buat arsitektur deteksi yang komprehensif:  
> 1. Multi-layer OTP Selector: Prioritaskan ID eksplisit `#auth-otp-input`, lalu filter hanya elemen yang `is_visible() == True` dan `is_enabled() == True`.  
> 2. Multi-storage Token Extractor: Ambil token dari `context.cookies()`, `localStorage['access_token']`, dan intercept network response `api.gobiz.co.id`.  
> 3. Automatic Screenshot & HTML Dump on Failure: Jika timeout terjadi, otomatis simpan screenshot dan dump teks halaman. Jangan biarkan developer menebak-nebak di terminal gelap.  
> 4. Handler Intermediary Screen: Antisipasi layar pemilihan outlet dan modal 'Setuju' untuk akun baru."*

### Advisor 4: The Outsider
> *"Sebagai pihak luar yang melihat ini secara sederhana: Pengguna bilang 'saya tes manual di browser biasa langsung bisa masuk'. Kenapa manusia bisa, bot gagal?  
> Karena manusia:  
> 1. Melihat kotak OTP di tengah layar dan mengkliknya (tidak mungkin mengklik OneTrust banner yang tersembunyi).  
> 2. Mengetik 4 angka, melihat tombol 'Masuk' berubah biru/aktif, lalu mengkliknya.  
> 3. Menunggu halaman berputar sampai masuk ke dashboard (manusia tidak menekan tombol 'batal' di detik ke-15 hanya karena loading).  
> 4. Jika muncul pilihan outlet, manusia memilihnya.  
> Tirulah apa yang dilakukan mata dan tangan manusia: cari elemen yang VISIBLE, tunggu sampai tombol submit benar-benar ENABLED, dan berikan waktu loading yang wajar."*

### Advisor 5: The Executor
> *"Cukup teorinya. Ini langkah bedah langsung pada `src/goscrapperv2/gofood.py`:  
> 1. Ubah baris 675: Ganti `otp_input_selector` agar menargetkan `input#auth-otp-input, input[name='otp']:not(#vendor-search-handler)` dan wajib `visible=True`.  
> 2. Ubah baris 725-730: Ambil elemen yang visible `[f for f in page.locator(selector).all() if f.is_visible()]`. Gunakan `field.fill(otp_code)` untuk mentrigger React state secara instan.  
> 3. Tunggu tombol submit menjadi aktif (`submit_btn.wait_for(state='visible')` dan pastikan `is_enabled()`).  
> 4. Hapus pemotongan agresif 15 detik di baris 846-855 (`if "/auth/login" in page.url: break`). Biarkan loop berjalan hingga 45-60 detik.  
> 5. Tambahkan fallback pengecekan token di `localStorage`.  
> 6. Uji langsung dengan akun `bakmirose2@byfoodmaster.com`."*

---

## 3. Peer Review Antar Penasihat (Anonymized)

- **Reviewer A (menilai Response E - Executor):** Terkuat secara praktis. Langsung menemukan titik baris kode yang rusak dan memberikan instruksi perbaikan tanpa basa-basi.
- **Reviewer B (menilai Response A - Contrarian):** Mengidentifikasi blind spot terbesar: bahwa `✅ OTP berhasil diisi otomatis` adalah pesan palsu karena input OneTrust cookie tersembunyi.
- **Reviewer C (menilai Response B - First Principles):** Benar dalam menekankan React state event (`fill` vs `type`) yang menjadi alasan mengapa tombol 'Masuk' tetap disabled.
- **Reviewer D (menilai Response C - Expansionist):** Terlalu over-engineered jika harus intercept seluruh network traffic, namun ide automatic screenshot saat timeout sangat penting untuk observability di VPS.
- **Reviewer E (menilai Response D - Outsider):** Menjaga fokus pada realitas: tiru aksi pengguna manual.

**Konsensus Blind Spot yang Ditemukan Bersama:**  
Semua penasihat sepakat bahwa script selama ini tertipu oleh elemen DOM OneTrust `otPcPanel`, dan pembunuhan sesi di detik ke-15 adalah bug logika fatal.

---

## 4. Chairman Synthesis & Final Verdict

### Di Mana Dewan Sepakat (High-Confidence Signals)
1. **Penyebab Utama Kegagalan Input OTP:** Selector regex `div[class*="otp" i]` mencocokkan `otPcPanel` (OneTrust Cookie Banner), mengarahkan input ke `<input id="vendor-search-handler">` yang tersembunyi. Input OTP asli tidak pernah terisi.
2. **Penyebab Utama Timeout Prematur:** Kondisi `if time.time() - start_time > 15 and "/auth/login" in page.url` membunuh browser saat proses login dan redirect akun baru belum tuntas.
3. **Solusi Teknis:** Gunakan selector presisi `#auth-otp-input`, filter hanya elemen `is_visible()`, gunakan `.fill()`, pastikan tombol submit aktif, dan naikkan timeout ke minimal 45 detik.

### Rekomendasi Rencana Aksi
1. Perbaiki selector dan input OTP di `src/goscrapperv2/gofood.py`.
2. Hapus abort 15 detik berbasis URL login, beri toleransi waktu redirect hingga 45 detik.
3. Tambahkan pembacaan `localStorage` untuk `access_token` jika cookie belum terisi.
4. Tangani otomatis jika muncul halaman pemilihan outlet (`/choose-outlet`).
5. Uji langsung menggunakan `bakmirose2@byfoodmaster.com` di lingkungan lokal tanpa melakukan `git push`.

### The One Thing to Do First
> **Lakukan patch pada `src/goscrapperv2/gofood.py` untuk mengeliminasi benturan selector OneTrust dan menghapus timeout 15 detik yang mematikan sesi.**

