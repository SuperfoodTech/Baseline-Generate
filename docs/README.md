# System Documentation

Welcome to the documentation folder for the Superfood Reporting System (SRS). This directory contains technical specifications, database architectures, and design proposals.

---

## Document Index

### 1. [Database Entity-Relationship Diagram (ERD)](database_erd.md)
*   **File**: `database_erd.md`
*   **Description**: Details the PostgreSQL database schema used to process and standardize transaction data from GoFood and ShopeeFood. It outlines:
    *   **Dimension Tables**: `dim_merchants` (master store data).
    *   **Staging Tables**: `stg_grab_orders`, `stg_shopee_orders` (raw scraped data).
    *   **Fact Tables**: `fact_transactions` (unified, standardized transactions).
    *   **ETL Pipeline**: The flow of syncing merchant lists and normalizing staging records.

### 2. [Local Trigger Mitigation Proposal](mitigation_proposal_local_trigger.md)
*   **File**: `mitigation_proposal_local_trigger.md`
*   **Description**: A detailed system architecture proposal to bypass datacenter IP bans by running scraping pipelines locally on staff laptops (residential IPs) while retaining remote triggers/status updates inside Google Sheets. It details:
    *   **Arsitektur A (Polling Agent)**: The recommended approach using an Apps Script queue sheet and a local polling python daemon.
    *   **Arsitektur B (Webhook Tunnel)**: Real-time execution via Ngrok or Cloudflare Tunnel.
    *   **Arsitektur C (Desktop Launcher)**: Direct manual execution via local Tkinter GUI wrappers.

### 3. [Pipeline Documentation Excel](documentation_pipeline.xlsx)
*   **File**: `documentation_pipeline.xlsx` (Binary Excel file)
*   **Description**: Contains tabular documentation mapping the pipeline stages, platform credentials, schedule mappings, and execution flows.
