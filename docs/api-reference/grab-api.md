# 📗 GrabFood API Reference

**Source:** `src/grab-reportperformance/grab_api_scraper.py`  
**Portal:** https://merchant.grab.com  
**API Base:** `https://merchant.grab.com`  
**Login URL:** `https://weblogin.grab.com/merchant/login`

---

## Autentikasi

GrabFood menggunakan **cookie session** yang didapat setelah login via browser (Playwright dengan Chromium). Semua API call dieksekusi **dalam konteks browser yang sudah login** menggunakan `page.evaluate()` untuk memanfaatkan cookie secara otomatis.

| Item | Nilai |
|---|---|
| **Login URL** | `https://weblogin.grab.com/merchant/login` |
| **Auth method** | Cookie session (automatic via browser context) |
| **Session storage** | `sessions/<username>/` directory |

---

## Header Standar

Header dikelola otomatis oleh browser context Playwright. Untuk direct `requests` call (download file), menggunakan cookie dari browser.

```http
Accept: */*
Origin: https://merchant.grab.com
Referer: https://merchant.grab.com/dashboard
```

---

## Class: `GrabMerchantAPI`

Wrapper API yang berjalan di dalam page context Playwright. Semua method menggunakan `page.evaluate()` untuk memanfaatkan session cookies browser.

```python
api = GrabMerchantAPI(page, username, password)
```

---

## Endpoints

### 1. Get Merchant Group ID

Mendapatkan `merchant_group_id` (mgid) yang dibutuhkan untuk semua endpoint laporan.

```
GET https://merchant.grab.com/troy/user-profile/v1/merchant-selector
```

**Dieksekusi via:** `page.evaluate()` (pakai cookie browser)

**Response (kunci penting):**
```json
{
  "data": {
    "merchantGroups": [
      {
        "merchantGroupID": "MGID-XXXX",
        "merchantGroupName": "Nama Merchant"
      }
    ]
  }
}
```

**Penggunaan:**
```python
mgid = await api.get_merchant_group_id()
```

---

### 2. Start Async Transaction Download

Memulai proses pembuatan laporan CSV secara asinkron. Mengembalikan `ref_id` untuk di-poll kemudian.

```
GET https://merchant.grab.com/mex/finances/v1/async-transactions-download
```

**Query Parameters:**

| Parameter | Tipe | Contoh | Keterangan |
|---|---|---|---|
| `merchant_group_id` | string | `"MGID-XXXX"` | ID merchant group |
| `from` | string | `"2025-01-01"` | Tanggal mulai (YYYY-MM-DD) |
| `to` | string | `"2025-01-31"` | Tanggal akhir (YYYY-MM-DD) |
| `currency` | string | `"IDR"` | Mata uang |

**Response:**
```json
{
  "data": {
    "referenceID": "ref-abc123"
  }
}
```

**Penggunaan:**
```python
ref_id, err = await api.start_async_download(mgid, start_date, end_date)
```

---

### 3. Poll for Download URL

Mengecek status laporan asinkron dan mendapatkan URL download saat sudah siap.

```
GET https://merchant.grab.com/mex/finances/v1/generated-report/{ref_id}
```

**Path Parameter:**
- `ref_id` — Reference ID dari endpoint start_async_download

**Response:**
```json
{
  "data": {
    "status": "SUCCESS",
    "downloadURL": "https://s3.amazonaws.com/grab-reports/..."
  }
}
```

**Polling behavior:**
- Max retries: 60 kali
- Interval: ~5 detik per retry
- Status yang valid: `"SUCCESS"`, `"COMPLETED"`

**Penggunaan:**
```python
download_url, err = await api.poll_for_download(mgid, ref_id)
# max_retries=60 (default)
```

---

### 4. Download CSV

Mendownload file CSV dari URL yang sudah didapat.

```
GET <download_url>   (S3 presigned URL)
```

File disimpan ke `src/grab-reportperformance/data/<filename>.csv`

**Penggunaan:**
```python
success, err = await api.download_csv(download_url, filename)
```

---

### 5. Get Stores List (Fallback)

Digunakan sebagai fallback jika async download gagal. Mengambil daftar stores untuk mendapatkan ID merchant spesifik.

```
GET https://merchant.grab.com/mex/finances/v1/transactions
```

**Query Parameters:**

| Parameter | Tipe | Contoh | Keterangan |
|---|---|---|---|
| `merchant_group_id` | string | `"MGID-XXXX"` | ID merchant group |
| `from` | string | `"2025-01-01"` | Tanggal mulai |
| `to` | string | `"2025-01-01"` | Tanggal (sama dengan from) |
| `limit` | int | `50` | Jumlah per halaman |
| `offset` | int | `0` | Offset paginasi |
| `currency` | string | `"IDR"` | Mata uang |

---

### 6. MEX Insights Download — Fallback CSV

Endpoint fallback untuk mengunduh insights dalam format CSV.

```
GET https://merchant.grab.com/mex-insights/download/v1/csv
```

**Query Parameters:**

| Parameter | Tipe | Keterangan |
|---|---|---|
| `merchant_group_id` | string | ID merchant group |
| `currency` | string | `"IDR"` |

**Response:**
```json
{
  "data": {
    "referenceID": "ref-xyz789"
  }
}
```

Kemudian di-poll via:
```
GET https://merchant.grab.com/mex-insights/download/v1/generated-insights/{ref_id}
```

Saat sukses, response mengandung `s3_url` untuk download langsung.

---

## Alur Lengkap Scraping

```
1. Login Playwright → buka https://merchant.grab.com/dashboard
2. GET /troy/user-profile/v1/merchant-selector → dapat mgid
3. GET /mex/finances/v1/async-transactions-download → dapat ref_id
4. Poll GET /mex/finances/v1/generated-report/{ref_id} → tunggu SUCCESS
5. GET <download_url> → download CSV
6. Parse CSV → ekstrak kolom yang relevan → agregasi → output
```

**Jika langkah 3-5 gagal (fallback):**
```
3b. GET /mex/finances/v1/transactions → daftar store_ids
4b. GET /mex-insights/download/v1/csv → dapat ref_id insights
5b. Poll → dapat s3_url → download via requests.get(s3_url)
```

---

## Parameter Tanggal

| Parameter | Format | Contoh |
|---|---|---|
| `start_date` | `"YYYY-MM-DD"` | `"2025-01-01"` |
| `end_date` | `"YYYY-MM-DD"` | `"2025-01-31"` |

Fungsi konversi tersedia di `grab_api_scraper.py`:
```python
# Dari CLI: DD-MM-YYYY → YYYY-MM-DD
from bridge.run_pipeline import convertDate
start = convertDate("01-01-2025")  # → "2025-01-01"
```

---

## Metode `call_api`

Helper internal yang mengeksekusi fetch di dalam browser page context:

```python
async def call_api(self, url, method="GET", params=None) -> dict | None
```

- Menambahkan query params ke URL jika `method="GET"` dan `params` diberikan
- Semua request melalui `page.evaluate()` — memanfaatkan cookie browser secara otomatis
- Return `None` jika response bukan JSON valid

---

## File Session

Playwright menyimpan state browser (cookie, localStorage) ke direktori:
```
src/grab-reportperformance/sessions/<username>/
```

Sehingga login ulang tidak diperlukan setiap kali scraper dijalankan (sampai session expired).

---

## Catatan Penting

- **Async download** bisa memakan waktu 1–10 menit tergantung jumlah data
- **Rate limit:** Grab membatasi request; jangan poll terlalu agresif (gunakan interval ≥ 5 detik)
- **mgid format:** Bisa berformat `"MGID-XXXX"` (string) atau integer, tergantung endpoint
- **Currency:** Selalu gunakan `"IDR"` untuk merchant Indonesia
- **Session expiry:** Cookie Grab merchant biasanya expire dalam 24 jam; jika expired, scraper otomatis re-login
- **Detected as bot:** Grab memiliki deteksi bot agresif — gunakan `slow_mo` di Playwright dan hindari headless murni
