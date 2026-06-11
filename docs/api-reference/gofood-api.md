# 📗 GoFood API Reference

**Source:** `src/goscrapperv2/gofood.py`  
**Portal:** https://portal.gofoodmerchant.co.id  
**API Base:** `https://api.gobiz.co.id` + `https://portal.gofoodmerchant.co.id/analytics-backend`

---

## Autentikasi

GoFood menggunakan **Bearer Token** yang didapat setelah login via browser (Playwright).

| Item | Nilai |
|---|---|
| **Login URL** | `https://portal.gofoodmerchant.co.id/auth/login/email` |
| **Token key** | `Authorization: Bearer <token>` |
| **Origin** | `https://portal.gofoodmerchant.co.id` |

Token disimpan **in-memory** dalam session `requests`. Untuk menjaga sesi tetap hidup, scraper menggunakan **session cookies** dari browser Playwright.

---

## Header Standar

```http
Accept: application/json, text/plain, */*
Content-Type: application/json
Authorization: Bearer <access_token>
Origin: https://portal.gofoodmerchant.co.id
Referer: https://portal.gofoodmerchant.co.id/
```

---

## Endpoints

### 1. Search Merchant

Mencari merchant ID berdasarkan nama untuk mendapatkan `merchant_id` aktif.

```
POST https://api.gobiz.co.id/v1/merchants/search
```

**Request Body:**
```json
{
  "page": 1,
  "page_size": 10,
  "keyword": "<nama_merchant>"
}
```

**Response (kunci penting):**
```json
{
  "data": {
    "merchants": [
      {
        "merchant_id": "123456",
        "merchant_name": "Nama Merchant",
        "status": "active"
      }
    ]
  }
}
```

---

### 2. Get User Info (Verifikasi Sesi)

Memverifikasi bahwa token masih valid dan mendapatkan informasi merchant aktif.

```
GET https://api.gobiz.co.id/v1/users/me
```

**Headers tambahan:**
```http
Authorization: Bearer <access_token>
```

**Response (kunci penting):**
```json
{
  "data": {
    "merchant_id": "123456",
    "email": "user@example.com",
    "display_name": "Nama Merchant"
  }
}
```

> ⚠️ Jika `Authorization` kosong atau `'None'`, request akan di-skip dan dianggap sesi tidak valid.

---

### 3. Sales Data (Omzet) — Grafana Datasource Proxy

Mengambil data penjualan agregat (total omzet, jumlah order) untuk rentang tanggal tertentu.

```
POST https://portal.gofoodmerchant.co.id/analytics-backend/api/datasources/proxy/63/_msearch?max_concurrent_shard_requests=5
```

**Headers:**
```http
Content-Type: application/x-ndjson
Referer: https://portal.gofoodmerchant.co.id/analytics/sales-gofood?date_range=custom&end_date=<end>&start_date=<start>&merchant_id=<id>
```

**Request Body:** NDJSON format (newline-delimited JSON), dibangun dinamis berdasarkan `merchant_id`, `start_date`, `end_date`.

**Parameter waktu:**
- Format: Unix timestamp milidetik (`int`)
- `start_date`, `end_date` → dikonversi ke ms: `int(dt.timestamp() * 1000)`

---

### 4. Orders Data — Grafana Datasource Proxy (Sumber berbeda)

Mengambil jumlah order per hari (berbeda datasource dengan omzet).

```
POST https://portal.gofoodmerchant.co.id/analytics-backend/api/datasources/proxy/46/_msearch?max_concurrent_shard_requests=5
```

**Payload order** (NDJSON):
```
{"search_type":"query_then_fetch","index":"gofood_order_*","ignore_unavailable":true}
{"size":0,"query":{"bool":{"filter":[{"range":{"created_at":{"gte":<from_ms>,"lte":<to_ms>}}},{"term":{"merchant_id":"<id>"}}]}},"aggs":{"total_orders":{"value_count":{"field":"order_id"}}}}
```

---

### 5. Net Revenue & Commission Data

Sama seperti endpoint Sales (#3), datasource `/63/`, tetapi dengan payload Elasticsearch berbeda yang mengagregasi `net_revenue` dan `commission_amount`.

```
POST https://portal.gofoodmerchant.co.id/analytics-backend/api/datasources/proxy/63/_msearch?max_concurrent_shard_requests=5
```

---

### 6. Ad Spend Data

Mengambil biaya iklan (Promo GoCash / CPC).

```
POST https://portal.gofoodmerchant.co.id/analytics-backend/api/datasources/proxy/63/_msearch?max_concurrent_shard_requests=5
```

---

### 7. Cancelled Orders

Mengambil data order yang dibatalkan.

```
POST https://portal.gofoodmerchant.co.id/analytics-backend/api/datasources/proxy/46/_msearch?max_concurrent_shard_requests=5
```

---

## Alur Lengkap Scraping

```
1. Login Playwright → dapat Bearer Token
2. GET /v1/users/me → verifikasi sesi + dapat merchant_id
3. POST /v1/merchants/search → cari & konfirmasi merchant aktif
4. POST datasource/63 → ambil omzet, net revenue, commission, ad spend
5. POST datasource/46 → ambil order count & cancelled orders
6. Agregasi → hitung rata-rata per bulan → tulis ke Google Sheets
```

---

## Parameter Tanggal

| Parameter | Format | Contoh |
|---|---|---|
| `start_date` | `datetime` object | `datetime(2025, 1, 1)` |
| `end_date` | `datetime` object | `datetime(2025, 1, 31)` |
| Untuk Elasticsearch query | Unix timestamp **ms** | `1735689600000` |

**Konversi:**
```python
range_from_ms = int(start_date.timestamp() * 1000)
range_to_ms   = int(end_date.timestamp() * 1000)
```

---

## Environment Variables

```env
# OTP endpoint (opsional, untuk auto-OTP)
OTP_ENDPOINT_URL=https://script.google.com/macros/s/.../exec

# Google Sheets credential URL (CSV published)
SHEET_PUBLISHED_URL=https://docs.google.com/spreadsheets/d/e/.../pub?output=csv

# Proxy (opsional)
PROXY_SERVER=http://user:pass@host:port
```

---

## Catatan Penting

- **Datasource `/63/`** → omzet, net revenue, komisi, iklan (Elasticsearch index: `gofood_sales_*`)
- **Datasource `/46/`** → order count, cancelled orders (Elasticsearch index: `gofood_order_*`)
- **Rate limit:** Tidak ada throttle eksplisit, namun request berlebihan dapat memicu Cloudflare challenge
- **Token expiry:** Bearer token biasanya expire dalam ~1 jam; scraper harus re-login jika token kadaluarsa
- **merchant_id vs store_id:** GoFood menggunakan `merchant_id` (bukan `store_id`), berbeda dengan Shopee
