# Shopee Session & Device Fingerprint Guidelines

This document outlines the strict guidelines and rules for managing Shopee sessions, authentication, and browser profiles in this repository. **All developers and AI agents must adhere to these rules.**

---

## 🚨 Core Rules

### 1. Never Delete Device Fingerprint Cookies or Storage
Shopee uses specific browser-level cookies and HTML5 LocalStorage keys to identify trusted devices. Wiping these will force Shopee to treat the next login attempt as a "new device", triggering a **mandatory OTP** (SMS/WhatsApp).
* **DO NOT** delete device fingerprint cookies (e.g., `SPC_EC`, `SPC_F`, `SPC_R_T`).
* **DO NOT** call `driver.delete_all_cookies()`.
* **DO NOT** clear HTML5 storage via `window.localStorage.clear()` or `window.sessionStorage.clear()`.
* **DO NOT** wipe/recreate the Chrome User Data profile folder (`chrome_profile_*`) automatically.

### 2. Never Trigger OTP Automatically
If a session requires credentials/OTP, the automated warm-up and reporting pipelines must **fail-fast** rather than prompting for OTP.
* If the login process redirects to a verification page or exhibits elements like OTP inputs (`input[maxlength='6']`) or verification text, **immediately abort** and return `False`.
* Automated scripts must never trigger OTP code delivery (such as choosing a verification method or requesting WhatsApp OTP) during automated runs.

### 3. Handle degraded sessions via UI Logout & Relogin Only
When the session is degraded (e.g. `Unknown Merchant` is detected by the UI name checker or API because the Shopee token has expired), it is normal to perform a recovery flow:
* Navigate to the logout UI, click the profile dropdown, and confirm logout.
* Allow the Chrome profile's session management to automatically log back in (using the preserved device fingerprints) without requesting credentials/OTP.
* If the UI logout fails, **abort the recovery immediately**. Do not use manual cookie deletion fallback.

---

## 🛠️ Code Reference

The session recovery and login flows are implemented in:
* **[browser.py](file:///home/akbarhann/project/task-weekly/src/shopee-omzet-automation/core/browser.py)**
  * `_deliberate_logout_and_relogin()`: Clean logout via UI preserving device trust.
  * `_perform_login()`: Login flow that halts and fails immediately on OTP detection.
