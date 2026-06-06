# AI Agent Repository Guide & Architecture Map

Welcome! This document is designed for other AI agents working on this repository. It outlines the codebase structure, execution requirements, session management details, and development conventions.

---

## 1. Repository Overview & Objective

This repository automates the extraction, processing, and baseline reconciliation of transaction data for major online food delivery (OFD) merchant portals in Indonesia:
*   **GoFood Merchant Portal** (GoJek)
*   **GrabFood Merchant Portal** (Grab)
*   **Shopee Food Partner Portal** (Shopee)

The final output is compiled, reconciled against Google Sheet baselines, and reported/notified to the operations team via Discord bots.

---

## 2. Codebase Directory Map

Here is the directory structure and the purpose of each component:

```
├── .agents/                      # AI Agent documentation and instructions
│   └── README.md                 # This guide file
├── docs/                         # System documentation (ERD, Architecture Proposals)
│   ├── database_erd.md           # Star-schema PostgreSQL ERD
│   ├── README.md                 # Entrypoint for documentation files
│   └── mitigation_proposal_local_trigger.md # Residential IP scraping architecture proposal
├── discord-bot-form/             # Node.js Discord Bot for operation forms and job triggers
├── discord-bot-session-monitor/ # Node.js Discord Bot for session health monitoring
├── shopee-session-monitor/       # Shopee session warmer
│   └── warmer.py                 # Keeps Shopee sessions alive and alerts on expiration
├── src/                          # Main source directory
│   ├── .venv/                    # Python virtual environment (contains dependencies)
│   ├── baseline/                 # Reconciliation & baseline calculations
│   │   ├── grab/                 # Grab baseline calculation scripts
│   │   ├── shopee/               # Shopee baseline calculation scripts
│   │   └── recalculate_baseline_gabungan.py # Merges all OFD platform baselines
│   ├── goscrapperv2/             # GoFood Playwright automation
│   │   ├── gofood.py             # GoFood transaction scraping engine
│   │   └── check_session.py      # Restores and tests GoFood sessions
│   ├── grab-reportperformance/   # Grab performance report scraping via direct API requests
│   │   └── API/                  # Grab HTTP request headers & payload samples
│   ├── shopee-omzet-automation/  # Shopee Food automation
│   │   ├── core/
│   │   │   ├── browser.py        # Core Selenium browser launcher & session manager
│   │   │   └── logger.py         # Standard logging setup
│   │   ├── data/                 # Chrome Profiles and session JSONs (Whitelisted)
│   │   ├── run_omzet.py          # Main Shopee omzet automation script
│   │   ├── shopee_api_scraper.py # Playwright API interceptor for Shopee transaction data
│   │   ├── open_dashboard_7307.py# Headful helper to manually inspect account 7307
│   │   └── switch_merchant_7307.py# Headful helper to switch merchant for account 7307
│   ├── cli.py                    # Master CLI trigger script for scraping
│   └── upload_master.py          # Uploads processed results back to GSheets
├── check_shopee_sessions.py      # Cron script to validate all Shopee sessions and send alerts
└── get_shopee_session.py         # Utility script for manual Shopee session login (OTP input)
```

---

## 3. Environment & Python Execution Rule

> [!IMPORTANT]
> **CRITICAL RULE FOR EXECUTING PYTHON SCRIPTS:**
> Always run python scripts using the virtual environment python executable located at `src/.venv/bin/python`.
> Running scripts with global `python` or `python3` will fail with `ModuleNotFoundError` for packages like `requests`, `pandas`, `playwright`, or `selenium`.

**Correct Example:**
```bash
src/.venv/bin/python check_shopee_sessions.py
```

---

## 4. Session Persistence & Git Whitelisting

Web scrapers require logged-in sessions to bypass 2FA (SMS OTP / WhatsApp OTP) and CAPTCHAs. Session states are persisted to prevent repetitive manual logins.

### Shopee Session Mechanics
*   **Location**: `src/shopee-omzet-automation/data/`
*   **Session JSON files**: `session_auto73*.json` containing `shopee_tob_token` and `shopee_tob_entity_id`.
*   **Chrome Profiles**: `chrome_profile_auto73*` containing browser local state.
*   **Git Rules (Very Important)**:
    To prevent repository bloat, `.gitignore` is configured to ignore all temporary cache, service worker, GPUCache, and local DB files from chrome profiles. **ONLY** the following files are tracked and committed:
    *   `Local State` (contains key for cookie decryption)
    *   `profile_auto73*/Cookies` (SQLite cookie database)
    *   `profile_auto73*/Preferences`
    *   `profile_auto73*/Sessions/` (Active tabs & windows state)
    
    *If you modify session profiles, stage them using native `git add` which respects `.gitignore` rules (never use the `-f` force flag).*

### GoFood Session Mechanics
*   **Location**: `src/goscrapperv2/session_*.json`
*   **Restoration**: `src/goscrapperv2/check_session.py` launches a headful Chromium instance and injects the cookies and localStorage/sessionStorage from the JSON file to bypass login screens.

---

## 5. Merchant Switching Logic (Shopee)

Accounts (like `auto7307`) are associated with multiple merchants. If the scraper needs to pull data for a different merchant than the active one, it triggers a merchant switch:
1. Navigates to the Partner Dashboard.
2. Hovers over the Profile Dropdown menu.
3. Clicks **"Pilih Merchant Lain"** (or **"Switch Merchant"**).
4. Selects the target merchant from the list.
5. In `core/browser.py`, `_trigger_and_extract_tokens` will temporarily delete the `shopee_tob_token` cookie and navigate to the Business Hours page to trigger the portal to issue a fresh `shopee_tob_token` cookie for the new merchant.

---

## 6. Daily Cron & Monitoring

*   **`check_shopee_sessions.py`**: Runs daily to query GSheet credentials, test all Shopee sessions via `browser.validate_session()`, and dispatch a comprehensive embed report (showing active vs expired accounts) to Discord via webhook.
*   **`shopee-session-monitor/warmer.py`**: Wakes up sessions periodically to prevent token expiration.
