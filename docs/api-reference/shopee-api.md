# 🟠 ShopeeFood API Reference

**Source:** `src/shopee-omzet-automation/core/client.py`  
**Portal:** https://partner.shopee.co.id  
**API Bases:**
- **Seller API:** `https://foody.shopee.co.id`
- **Partner API (gRPC gateway):** `https://api.partner.shopee.co.id`
- **Buyer API (public):** `https://shopee.co.id`

---

## Autentikasi

ShopeeFood menggunakan dua token yang didapat setelah login via Selenium browser:

| Token | Sumber | Keterangan |
|---|---|---|
| `shopee_tob_token` | Cookie browser | Token utama auth Seller API |
| `shopee_tob_entity_id` | Cookie browser | ID merchant/store yang aktif saat ini |

Keduanya disimpan di `src/shopee-omzet-automation/data/session_{username}.json` dan di-refresh oleh **Shopee Session Warmer** secara berkala.

---

## Class: `ShopeeClient`

```python
from core.client import ShopeeClient

client = ShopeeClient(
    tob_token="<shopee_tob_token>",
    entity_id="<shopee_tob_entity_id>",
    extra_cookies=cookie_dict   # seluruh cookie dari browser
)
```

---

## Header Builders

### `_seller_headers(override_entity_id=None)`

Digunakan untuk endpoint `foody.shopee.co.id/api/seller/*`:

```http
Host: foody.shopee.co.id
Accept: application/json, text/plain, */*
Content-Type: application/json
User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ...
Cookie: shopee_tob_token=<token>; shopee_tob_entity_id=<entity_id>; ...
X-Sf-Platform: 2
Operate-Source: partnerapp
Origin: https://partner.shopee.co.id
Referer: https://partner.shopee.co.id/
```

> `override_entity_id` — untuk switch context ke store ID berbeda tanpa mengganti token.

---

### `_partner_headers()`

Digunakan untuk endpoint `api.partner.shopee.co.id` (gRPC gateway):

```http
accept: application/json, text/plain, */*
accept-encoding: gzip, deflate, br, zstd
accept-language: en-US,en;q=0.9
content-type: application/json
origin: https://partner.shopee.co.id
referer: https://partner.shopee.co.id/
shopee-baggage: PFB=undefined
x-merchant-from: 12
x-merchant-language: id
x-merchant-login-from: 12
x-merchant-requestid: <uuid4>       ← dibuat baru setiap request
x-merchant-timezone: Asia/Jakarta
x-merchant-tob-clientid: undefined
x-merchant-token: <shopee_tob_token>
```

---

### `_wallet_headers()`

Seperti `_seller_headers` tapi `shopee_tob_entity_id` dikosongkan (merchant-level context):

```http
Cookie: shopee_tob_token=<token>; shopee_tob_entity_id=; ...
```

---

### `_buyer_headers()` (Public, tanpa auth)

```http
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...
Accept: application/json
```

---

## Endpoints — Seller API (`foody.shopee.co.id`)

### 1. Get All Stores

Mendapatkan daftar semua store di bawah merchant yang sedang login.

```
POST https://foody.shopee.co.id/api/seller/stores
```

**Request Body:**
```json
{
  "page_no": 1,
  "page_size": 50
}
```

**Response (kunci penting):**
```json
{
  "code": 0,
  "data": {
    "stores": [
      {
        "store_id": "12345",
        "store_name": "Nama Store",
        "status": 1
      }
    ],
    "total": 5
  }
}
```

> Pagination otomatis sampai semua store diambil.

---

### 2. Get Store Detail

Mengambil detail lengkap satu store (rating, lokasi, status).

```
GET https://foody.shopee.co.id/api/seller/store
```

**Auth:** `shopee_tob_entity_id` dalam cookie di-set ke `store_id` target.

**Response (kunci penting):**
```json
{
  "code": 0,
  "data": {
    "store_id": "12345",
    "store_name": "Nama Store",
    "rating": 4.8,
    "rater_count": 1250,
    "address": "Jl. ...",
    "lat": -6.123,
    "lon": 106.456,
    "status": 1,
    "logo": "<image_id>",
    "banner": "<image_id>"
  }
}
```

---

### 3. Get Store Dishes

Mengambil daftar menu/katalog dari satu store.

```
GET https://foody.shopee.co.id/api/seller/store/dishes
```

**Response:**
```json
{
  "code": 0,
  "data": {
    "catalogs": [
      {
        "catalog_name": "Menu Utama",
        "dishes": [
          {
            "dish_id": "789",
            "dish_name": "Nasi Goreng",
            "price": 2500000    ← bagi 100000 = Rp 25.000
          }
        ]
      }
    ]
  }
}
```

> ⚠️ **Harga:** Unit harga adalah 1/100000 IDR. Bagi dengan `100000` untuk mendapatkan Rupiah.

---

### 4. Get Store Option Groups (Modifier)

Mengambil daftar modifier/topping untuk store.

```
POST https://foody.shopee.co.id/api/seller/store/option-groups/search
```

**Request Body:**
```json
{
  "page_no": 1,
  "page_size": 100,
  "filter": {
    "dish_ids": ["789", "790"]   ← opsional
  }
}
```

---

### 5. Get Order Detail

Mengambil detail satu order berdasarkan `order_id`.

```
GET https://foody.shopee.co.id/api/seller/mis/orders/{order_id}
```

**Path Parameter:**
- `order_id` — ID order

**Auth:** `shopee_tob_entity_id` dalam cookie harus diset ke `store_id` yang memiliki order tersebut.

---

### 6. Submit Wallet Export

Memulai export laporan transaksi wallet dalam format Excel.

```
POST https://foody.shopee.co.id/api/seller/v1/wallet/export-task/submit
```

**Request Body:**
```json
{
  "export_type": 56,
  "filter": {
    "search_start_time": "1735689600",    ← Unix timestamp (detik, string)
    "search_end_time": "1738281600",
    "search_wallet_ids": ["13629594"]     ← wallet_id dari VB portal map
  }
}
```

**VB Portal Wallet ID Map:**
| Entity ID | Wallet ID | Portal |
|---|---|---|
| `11511947` | `13629594` | SuperFood |
| `14367488` | `16612848` | WonderFood |
| `14384953` | `16634272` | LOKARASA |
| `15892383` | `18362777` | Gurame Bakar / Do Eat |

**Response:**
```json
{
  "code": 0,
  "data": {
    "task_id": "987654321"
  }
}
```

---

### 7. Get Wallet Report List

Mengambil daftar laporan wallet yang sudah dibuat.

```
GET https://foody.shopee.co.id/api/seller/v1/wallet/export-task/list?export_type=56&page_num=1&page_size=20
```

**Response:**
```json
{
  "code": 0,
  "data": {
    "task_list": [
      {
        "task_id": "987654321",
        "task_name": "Wallet Export Jan 2025",
        "task_status": 3,           ← 3 = ready/success
        "file_url": "https://..."
      }
    ]
  }
}
```

---

### 8. Search Wallet Transactions (Direct)

Mengambil transaksi wallet secara langsung (tanpa generate report), paginated.

```
POST https://foody.shopee.co.id/api/seller/v1/wallet/transaction/search
```

**Request Body:**
```json
{
  "filter": {
    "search_start_time": "1735689600",   ← Unix timestamp string
    "search_end_time": "1738281600"
  },
  "mw": "13629594",                      ← wallet_id (opsional jika diketahui)
  "page_num": 1,
  "page_size": 50                         ← MAX 50 (Shopee enforce)
}
```

> ⚠️ **Limit:** `page_size` maksimal **50**. Nilai di atas 50 akan mengembalikan `ERROR_PARAMS_INVALID`.

**Response:**
```json
{
  "code": 0,
  "data": {
    "transaction_logs": [...],
    "total": 250
  }
}
```

---

## Endpoints — Partner API (`api.partner.shopee.co.id`)

### 9. Get Transaction List

Mengambil daftar transaksi/order dari gRPC gateway.

```
POST https://api.partner.shopee.co.id/nb/mss/web-api/PartnerTransactionServer/GetTransactionList
```

**Headers tambahan:**
```http
x-merchant-from: <entity_id>
x-merchant-storeid: <store_id>
x-merchant-token: <shopee_tob_token>
```

**Request Body:**
```json
{
  "pageNo": 1,
  "pageSize": 50,
  "filter": {
    "storeIdList": [12345],
    "startTime": 1735689600,     ← Unix timestamp detik (integer)
    "endTime": 1738281600,
    "serviceList": [2]           ← 2 = ShopeeFood
  },
  "sorter": {
    "field": "createTime",
    "order": "descend"
  }
}
```

**Response:**
```json
{
  "errorCode": 0,
  "data": {
    "list": [...],
    "total": 150
  }
}
```

> ⚠️ Field error menggunakan `errorCode` (bukan `code`) dan `errorMsg` (bukan `msg`).

---

### 10. Export Transaction List

Memicu pembuatan export Excel untuk transaksi.

```
POST https://api.partner.shopee.co.id/nb/mss/web-api/PartnerTransactionServer/ExportTransactionList
```

**Request Body:**
```json
{
  "pageNo": 1,
  "pageSize": 10,
  "filter": {
    "startTime": 1735689600,
    "endTime": 1738281600,
    "serviceList": [2],
    "storeIdList": [12345],          ← gunakan ini ATAU merchantIdList
    "merchantIdList": [67890]        ← gunakan ini ATAU storeIdList
  },
  "sorter": {
    "field": "createTime",
    "order": "descend"
  }
}
```

**Headers tambahan (jika by store):**
```http
x-merchant-storeid: <store_id>
```

**Headers tambahan (jika by merchant):**
```http
x-merchant-merchantid: <merchant_id>
```

---

### 11. Get Report List

Mengambil daftar laporan yang sudah di-generate.

```
POST https://api.partner.shopee.co.id/nb/mss/web-api/PartnerReportServer/GetReportList
```

**Request Body:**
```json
{
  "filter": {
    "reportTypeList": [2],
    "serviceList": [2]
  },
  "pageNo": 1,
  "pageSize": 20
}
```

**Response (normalized):**
```json
{
  "errorCode": 0,
  "data": {
    "reportInfoList": [
      {
        "reportId": "rpt-xxx",
        "reportName": "Transaction Report",
        "reportStatus": 2,           ← 2 = ready/success
        "downLoadUrl": "https://...",
        "createTime": 1738281600,
        "filterData": "{\"startTime\":...}"
      }
    ]
  }
}
```

---

## Endpoints — Buyer API (Public, tanpa auth)

### 12. Get Public Store Detail

```
GET https://shopee.co.id/api/v4/shopee_food/get_store_detail?store_id=<id>
```

**Response:**
```json
{
  "error": 0,
  "data": {
    "name": "Nama Store",
    "rating": 4.8,
    "category_tags": [...]
  }
}
```

---

### 13. Get Public Reviews

```
GET https://shopee.co.id/api/v4/shopee_food/get_review_list?store_id=<id>&offset=0&limit=50
```

**Query Parameters:**

| Parameter | Tipe | Keterangan |
|---|---|---|
| `store_id` | string | ID store |
| `offset` | int | Offset paginasi (default: 0) |
| `limit` | int | Jumlah review per page (max: 50) |

---

## Token Refresh Flow (Session Warmer)

```
1. Selenium buka https://partner.shopee.co.id dengan profile Chrome
2. Login menggunakan username/password
3. Navigasi ke /settings/shopee-food/business-hours-settings
   → Shopee issue fresh shopee_tob_token cookie
4. Extract cookies → simpan ke session_{username}.json
5. shopee_api_scraper.py load session_{username}.json → buat ShopeeClient
```

---

## Parameter Waktu

| API | Format | Contoh |
|---|---|---|
| Seller API (`/api/seller/*`) | Unix timestamp **detik** (int) | `1735689600` |
| Partner API (GetTransactionList) | Unix timestamp **detik** (int) | `1735689600` |
| Wallet API (filter) | Unix timestamp **detik** sebagai **string** | `"1735689600"` |
| Wallet Export (filter) | Unix timestamp **detik** sebagai **string** | `"1735689600"` |

**Konversi dari datetime:**
```python
from datetime import datetime
dt = datetime(2025, 1, 1)
unix_sec = int(dt.timestamp())             # → 1735689600
unix_sec_str = str(int(dt.timestamp()))    # → "1735689600"  (untuk wallet)
```

---

## Response Code Convention

| Field | Platform | Nilai sukses |
|---|---|---|
| `code` | Seller API, Wallet API | `0` |
| `errorCode` | Partner API (gRPC gateway) | `0` |
| `error` | Buyer API (public) | `0` |
| `reportStatus` | Report List | `2` |
| `task_status` | Wallet Report List | `3` |

---

## Catatan Penting

- **entity_id vs store_id vs merchant_id:** Shopee menggunakan 3 level hierarki:
  - `merchant_id` → level akun merchant (1 per login)
  - `entity_id` → `shopee_tob_entity_id`, biasanya sama dengan `merchant_id` utama
  - `store_id` → ID toko spesifik (bisa ada banyak per merchant)
- **x-merchant-requestid:** Harus UUID v4 unik setiap request untuk Partner API
- **serviceList: [2]:** Angka `2` berarti ShopeeFood; jangan diubah untuk scraper ini
- **File URL expiry:** URL download dari `downLoadUrl` atau `file_url` biasanya expire dalam 1–24 jam
- **Token expiry:** `shopee_tob_token` expire dalam ~2 jam; Session Warmer me-refresh setiap 30 menit
