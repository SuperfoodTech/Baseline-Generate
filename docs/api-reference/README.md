# 📡 API Reference — OFD Automation Report

Folder ini mendokumentasikan semua API endpoint, header, dan parameter yang digunakan oleh masing-masing scraper dalam project `automation-report-V1`.

## Daftar Scraper

| Scraper | Platform | File Dokumentasi | Source |
|---|---|---|---|
| **GoFood** | GoBiz Merchant Portal | [gofood-api.md](./gofood-api.md) | `src/goscrapperv2/gofood.py` |
| **GrabFood** | Grab Merchant Portal | [grab-api.md](./grab-api.md) | `src/grab-reportperformance/grab_api_scraper.py` |
| **ShopeeFood** | Shopee Partner Portal | [shopee-api.md](./shopee-api.md) | `src/shopee-omzet-automation/core/client.py` |

## Konvensi Dokumen

Setiap file dokumentasi menggunakan format:
- **Endpoint** — URL lengkap beserta method HTTP
- **Auth** — Token/cookie yang dibutuhkan
- **Headers** — Header wajib dan opsional
- **Request Payload / Params** — Body/query yang dikirim
- **Response** — Struktur data kunci yang dikembalikan
- **Catatan** — Gotcha, rate limit, atau perilaku khusus yang perlu diketahui

## Cara Auth Masing-Masing Platform

| Platform | Mekanisme Auth | Token Storage |
|---|---|---|
| **GoFood** | Bearer token dari login Playwright | In-memory session |
| **GrabFood** | Cookie session dari login Playwright (Chromium) | `sessions/` directory |
| **ShopeeFood** | `shopee_tob_token` + `shopee_tob_entity_id` cookie | `session_{username}.json` |

> **Catatan:** Semua scraper menggunakan Playwright/Selenium untuk mendapatkan token awal via login browser, kemudian melakukan API call langsung via `requests` / `fetch` untuk efisiensi.
