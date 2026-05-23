"""
src/VB/shopee/debug_browser.py
==============================
Launches Chrome (non-headless) using a specified VB portal's cached session.
Keeps the browser open indefinitely (no timeout) so the developer can inspect
DevTools, analyze API calls, and debug transactions.
"""

import os
import sys
import time
from pathlib import Path
import json

# Add paths to sys.path to allow correct imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../shopee-omzet-automation')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager

from VB.core.browser import load_session

def launch_debug_browser(account_name="portal_f"):
    # Load session cookies
    session_data = load_session(account_name)
    if not session_data:
        print(f"❌ No cached session found for '{account_name}'. Run init_sessions.py first!")
        return

    print(f"🌐 Launching Chrome for '{account_name}' in debug mode...")
    options = Options()
    options.add_argument("--log-level=3")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_experimental_option("excludeSwitches", ["enable-automation", "enable-logging"])
    options.add_argument("--start-maximized")

    # Isolate Chrome data directories per account
    script_dir = Path(__file__).parent.parent
    profile_dir = script_dir / "data" / "chrome_profiles" / account_name
    options.add_argument(f"--user-data-dir={profile_dir.resolve()}")
    options.add_argument(f"--profile-directory=profile_{account_name}")

    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    driver.set_page_load_timeout(120)

    try:
        # Navigate to domain first to set cookies
        driver.get("https://partner.shopee.co.id/")
        time.sleep(3)

        # Inject session cookies
        driver.add_cookie({"name": "shopee_tob_token", "value": session_data["shopee_tob_token"]})
        if session_data.get("shopee_tob_entity_id"):
            driver.add_cookie({"name": "shopee_tob_entity_id", "value": session_data["shopee_tob_entity_id"]})
        for n, v in session_data.get("extra_cookies", {}).items():
            try:
                driver.add_cookie({"name": n, "value": v})
            except:
                pass

        # Go to food dashboard
        driver.get("https://partner.shopee.co.id/food/dashboard")
        print("\n==================================================================")
        print(f"✅ Browser is open and authenticated as '{account_name}'.")
        print("🛠️  You can open DevTools (F12) to inspect the API requests.")
        print("🚫 This script will NOT time out and will keep the browser open.")
        print("⌨️  Press Ctrl+C in this terminal when you want to close the browser.")
        print("==================================================================\n")

        # Keep open indefinitely
        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        print("\n👋 Closing browser...")
    finally:
        try:
            driver.quit()
        except:
            pass

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Launch Shopee VB Browser for API Debugging")
    parser.add_argument("--portal", type=str, default="portal_f", help="Portal name to use (default: portal_f)")
    args = parser.parse_args()
    
    launch_debug_browser(account_name=args.portal)
