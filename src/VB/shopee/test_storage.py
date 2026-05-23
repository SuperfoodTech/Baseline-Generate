import os
import sys
import time
from pathlib import Path
import json

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../shopee-omzet-automation')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager

from VB.core.browser import load_session

def check_storage():
    session_data = load_session("portal_f")
    if not session_data:
        print("❌ No session for portal_f.")
        return
        
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    
    # We do NOT use the user-data-dir to avoid locks
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    
    try:
        # Navigate to set domain context
        driver.get("https://partner.shopee.co.id/")
        time.sleep(3)
        
        # Inject cookies
        driver.add_cookie({"name": "shopee_tob_token", "value": session_data["shopee_tob_token"]})
        if session_data.get("shopee_tob_entity_id"):
            driver.add_cookie({"name": "shopee_tob_entity_id", "value": session_data["shopee_tob_entity_id"]})
        for n, v in session_data.get("extra_cookies", {}).items():
            try:
                driver.add_cookie({"name": n, "value": v})
            except:
                pass
                
        # Now refresh and navigate to food dashboard
        driver.get("https://partner.shopee.co.id/food/dashboard")
        time.sleep(5)
        
        # Dump localStorage
        print("--- LOCAL STORAGE KEYS ---")
        local_storage = driver.execute_script("return window.localStorage;")
        for k, v in local_storage.items():
            if "oft" in k.lower() or "spc" in k.lower() or len(str(v)) > 100:
                print(f"  {k}: {str(v)[:150]}...")
            else:
                print(f"  {k}: {v}")
                
        # Dump sessionStorage
        print("\n--- SESSION STORAGE KEYS ---")
        session_storage = driver.execute_script("return window.sessionStorage;")
        for k, v in session_storage.items():
            if "oft" in k.lower() or "spc" in k.lower() or len(str(v)) > 100:
                print(f"  {k}: {str(v)[:150]}...")
            else:
                print(f"  {k}: {v}")
                
        # Check cookies again
        print("\n--- ALL COOKIES ---")
        for c in driver.get_cookies():
            print(f"  {c['name']}: {c['value'][:100]}")
            
    finally:
        driver.quit()

if __name__ == "__main__":
    check_storage()
