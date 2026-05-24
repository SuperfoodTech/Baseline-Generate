# Superfood Reporting System (SRS) Database ERD

Berikut adalah Entity-Relationship Diagram (ERD) dan penjelasan struktur database PostgreSQL yang digunakan dalam repositori ini untuk mengolah data transaksi dari platform kuliner (GrabFood dan ShopeeFood).

---

## 1. Entity-Relationship Diagram (Mermaid)

```mermaid
erDiagram
    dim_merchants {
        TEXT store_id PK
        TEXT platform
        TEXT outlet_name
        TEXT branch_name
        TEXT group_code
        TEXT owner_name
        TEXT merchant_id
        TEXT merchant_name
        TEXT username
        TEXT status
        BOOLEAN is_active
        TIMESTAMP updated_at
    }

    stg_grab_orders {
        SERIAL id PK
        TEXT merchant_name
        TEXT merchant_id
        TEXT store_name
        TEXT store_id FK
        TEXT updated_on
        TIMESTAMP created_on
        TEXT status
        TEXT transaction_id
        TEXT long_order_id UK
        NUMERIC amount
        NUMERIC discount_merchant_funded
        NUMERIC delivery_fee_discount_merchant_funded
        NUMERIC net_sales
        NUMERIC marketing_success_fee
        NUMERIC order_commission
        NUMERIC total
        JSONB raw_metadata
        TIMESTAMP ingested_at
    }

    stg_shopee_orders {
        SERIAL id PK
        TEXT store_id FK
        TEXT store_name
        TEXT transaction_type
        TEXT transaction_id UK
        TIMESTAMP complete_time
        TEXT status
        NUMERIC food_original_price
        NUMERIC item_discounts
        NUMERIC flash_sale_discount
        NUMERIC surcharge_fee
        NUMERIC merchant_voucher_subsidy
        NUMERIC platform_flash_sale_subsidy
        NUMERIC food_voucher_subsidy
        NUMERIC food_direct_discount
        NUMERIC transaction_amount
        NUMERIC checkout_murah_price
        TEXT notes
        NUMERIC net_sales
        NUMERIC commission
        NUMERIC revenue
        JSONB raw_metadata
        TIMESTAMP ingested_at
    }

    fact_transactions {
        SERIAL id PK
        INTEGER order_id_duplicate
        INTEGER year
        TEXT month
        TEXT week
        DATE transaction_date
        INTEGER hour
        VARCHAR platform UK
        TEXT merchant_id
        TEXT group_code
        TEXT outlet_name
        TEXT branch_name
        TEXT store_name
        TIMESTAMP created_on
        TEXT status
        INTEGER is_success
        INTEGER is_cancelled
        TEXT external_id UK
        NUMERIC gross_sales
        NUMERIC discounts
        NUMERIC delivery_discount
        NUMERIC net_sales
        NUMERIC marketing_fee
        NUMERIC commission
        NUMERIC ofd_fees
        NUMERIC revenue
        TEXT gmv_vs_ofd_commission
        TEXT gmv_vs_ofd_fees
        TEXT gmv_vs_revenue
        TEXT move_to_oe_op
        INTEGER raw_record_id FK
        TIMESTAMP updated_at
    }

    dim_merchants ||--o{ stg_grab_orders : "1 to many (logical join via store_id)"
    dim_merchants ||--o{ stg_shopee_orders : "1 to many (logical join via store_id)"
    
    stg_grab_orders ||--o| fact_transactions : "1 to 1 logical mapping (platform = 'GrabFood', raw_record_id = stg_grab_orders.id)"
    stg_shopee_orders ||--o| fact_transactions : "1 to 1 logical mapping (platform = 'ShopeeFood', raw_record_id = stg_shopee_orders.id)"
```

---

## 2. Penjelasan Relasi & Arsitektur Tabel

Database ini dirancang menggunakan pendekatan **Staging & DWH (Data Warehouse)** sederhana dengan model *Star/Snowflake Schema*:

### A. Tabel Dimensi (Dimension Table)
*   **`dim_merchants`**: Menyimpan data master outlet/toko.
    *   **Primary Key**: `store_id` (unik untuk setiap outlet di masing-masing platform).
    *   Berperan sebagai *Single Source of Truth* untuk informasi administratif toko seperti `group_code`, `owner_name`, `branch_name`, dan status operasional (`is_active`).

### B. Tabel Staging (Raw Data Lake)
Tabel staging digunakan untuk menampung data mentah hasil *scraping* atau *API ingestion* dari masing-masing platform sebelum dinormalisasi ke tabel fakta.
*   **`stg_grab_orders`**: Menampung data transaksi mentah dari GrabFood. Relasi logis ke tabel master adalah melalui `store_id`.
*   **`stg_shopee_orders`**: Menampung data transaksi mentah dari ShopeeFood. Relasi logis ke tabel master adalah melalui `store_id`.

### C. Tabel Fakta (Fact Table / Tabel Gajah)
*   **`fact_transactions`**: Merupakan tabel terpadu (*unified*) yang menyatukan data transaksi dari GrabFood dan ShopeeFood ke dalam satu format standar agar mudah dianalisis.
    *   **Unique Constraint**: `(platform, external_id)` memastikan tidak ada data duplikat untuk transaksi yang sama.
    *   **`raw_record_id`**: Berfungsi sebagai foreign key logis ke tabel staging asal (`stg_grab_orders.id` jika `platform = 'GrabFood'` atau `stg_shopee_orders.id` jika `platform = 'ShopeeFood'`).
    *   **`external_id`**: Berisi ID unik transaksi eksternal dari platform (`long_order_id` untuk Grab atau `transaction_id` untuk Shopee).

---

## 3. Alur Sinkronisasi Data (Pipeline ETL)

1.  **Sync Merchants (`sync_merchants.py`)**:
    *   Mengambil data master dari Google Sheets.
    *   Melakukan upsert ke `dim_merchants` berdasarkan `store_id`.
    *   Hanya menyimpan data yang memiliki status aktif (`is_active = TRUE`).
2.  **Ingestion (`db_manager.py`)**:
    *   Data Grab/Shopee hasil scraping dimasukkan ke dalam `stg_grab_orders` / `stg_shopee_orders`.
3.  **Normalization (`functions.sql` -> `refresh_fact_transactions()`)**:
    *   Trigger atau fungsi database membaca data dari tabel staging, melakukan `LEFT JOIN` ke `dim_merchants` berdasarkan `store_id` untuk melengkapi data outlet (`group_code`, `outlet_name`, `branch_name`), lalu menyisipkan/mengupdate data ke dalam `fact_transactions`.
    *   Melakukan kalkulasi metrik finansial terstandarisasi seperti `net_sales` (GMV), `ofd_fees`, dan `revenue` (payout bersih).
