"""
core/browser.py
===============
Handles Shopee Partner login via Selenium and session token persistence.

Flow:
1. Try to load a saved session from `data/session.json`.
2. Validate the saved token against the Shopee API (lightweight call).
3. If valid → use tokens directly (no browser needed).
4. If invalid/missing → open browser, login, extract tokens, save to file.
5. After login, navigate to the business-hours-settings page which triggers
   Shopee to issue the shopee_tob_token cookie.
"""

import os
import json
import time
import random
from datetime import datetime
from pathlib import Path

import requests
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys
from selenium.common.exceptions import TimeoutException, NoSuchElementException

from core.logger import get_logger
from core.otp import get_latest_otp

log = get_logger("browser")

# ── Constants ──────────────────────────────────────────────────────────────────
SESSION_FILE    = Path("data/session.json")
PARTNER_DASHBOARD = "https://partner.shopee.co.id/food/dashboard"
TOKEN_TRIGGER_PAGE = "https://partner.shopee.co.id/settings/shopee-food/business-hours-settings"
VALIDATE_URL    = "https://foody.shopee.co.id/api/seller/stores"
SHOPEE_IMG_BASE = "https://down-id.img.susercontent.com/file"


# ── Helpers ────────────────────────────────────────────────────────────────────

def human_like_typing(element, text: str):
    # Direct input is faster; using it as requested
    element.send_keys(text)

def build_img_url(img_id: str) -> str:
    if not img_id: return ""
    return f"{SHOPEE_IMG_BASE}/{img_id}"


# ── Session Persistence ────────────────────────────────────────────────────────

def save_session(tob_token: str, entity_id: str, extra_cookies: dict = None):
    SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "shopee_tob_token": tob_token,
        "shopee_tob_entity_id": entity_id,
        "saved_at": datetime.now().isoformat(),
        "extra_cookies": extra_cookies or {},
    }
    SESSION_FILE.write_text(json.dumps(payload, indent=2))
    log.debug(f"✅ Session saved to {SESSION_FILE}")

def load_session() -> dict | None:
    if not SESSION_FILE.exists(): return None
    try:
        data = json.loads(SESSION_FILE.read_text())
        if data.get("shopee_tob_token"):
            log.info(f"📂 [SESSION] Found cached session (saved at {data.get('saved_at')})")
            return data
    except: pass
    return None

def validate_session(tob_token: str, entity_id: str) -> bool:
    log.debug("🔍 Validating saved session token...")
    headers = {
        "Cookie": f"shopee_tob_entity_id={entity_id}; shopee_tob_token={tob_token}",
        "Accept": "application/json",
        "X-Sf-Platform": "2",
        "Operate-Source": "partnerapp",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }
    try:
        resp = requests.post(VALIDATE_URL, json={"page_no": 1, "page_size": 1}, headers=headers, timeout=8)
        if resp.json().get("code") == 0:
            log.info("✅ [SESSION] Saved session is still valid.")
            return True
    except: pass
    return False


# ── Token Extraction ───────────────────────────────────────────────────────────

def extract_tokens_from_driver(driver) -> tuple:
    tob_token = None
    entity_id = None
    for c in driver.get_cookies():
        name = c["name"]
        val = c["value"]
        if name == "shopee_tob_token": 
            tob_token = val
        elif name.lower() in ["shopee_tob_entity_id", "shopee_foody_mid", "x-merchant-id", "spc_merchant_id", "merchant_id", "shopid", "shop_id"]:
            if val and not entity_id: entity_id = val
            
    if not entity_id:
        try: 
            # Try API first (Most accurate) - using full URL and credentials
            api_js = """
            var done = arguments[arguments.length - 1];
            let token = document.cookie.split('; ').find(row => row.startsWith('shopee_tob_token='))?.split('=')[1];
            fetch('https://api.partner.shopee.co.id/nb/mss/web-api/PartnerAccountServer/GetUserInfo', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-merchant-token': token || ''
                },
                body: '{}',
                credentials: 'include'
            })
            .then(r => r.json())
            .then(j => done(j.data ? j.data.merchantId : null))
            .catch(() => done(null));
            """
            entity_id = driver.execute_async_script(api_js)
        except: pass

    if not entity_id:
        try: 
            entity_id = driver.execute_script("""
                let ids = [];
                // 1. Check all numeric storage values
                for (let i = 0; i < localStorage.length; i++) {
                    let k = localStorage.key(i);
                    let v = localStorage.getItem(k);
                    if (/^\\d{6,12}$/.test(v)) ids.push(v);
                }
                // ... rest of fallback logic ...
                let specific = localStorage.getItem('shopee_tob_entity_id') || 
                               localStorage.getItem('shopee_foody_mid') || 
                               localStorage.getItem('merchant_id') || 
                               localStorage.getItem('spc_merchant_id');
                if (specific) return specific;
                return ids[0] || null;
            """)
        except: pass
    
    return tob_token, (str(entity_id).strip() if entity_id else None)

def get_all_cookies_dict(driver) -> dict:
    return {c["name"]: c["value"] for c in driver.get_cookies()}

def _trigger_and_extract_tokens(driver) -> tuple:
    log.debug("  🔄 Triggering fresh token issuance...")
    try:
        try: driver.delete_cookie("shopee_tob_token")
        except: pass
        driver.get(TOKEN_TRIGGER_PAGE)
        for _ in range(10):
            tob_token, entity_id = extract_tokens_from_driver(driver)
            if tob_token: return tob_token, entity_id
            time.sleep(1)
    except: pass
    return extract_tokens_from_driver(driver)


# ── Driver Initialization ──────────────────────────────────────────────────────

def _init_driver(headless: bool):
    options = Options()
    options.add_argument("--log-level=3")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation", "enable-logging"])
    if headless:
        options.add_argument("--headless=new")
        options.add_argument("--window-size=1920,1080")
    else:
        options.add_argument("--start-maximized")
    
    script_dir = Path(__file__).parent.parent
    profile_dir = script_dir / "data" / "chrome_profile"
    options.add_argument(f"--user-data-dir={profile_dir.resolve()}")
    options.add_argument("--profile-directory=shopee_profile")

    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    driver.set_page_load_timeout(60)
    return driver


# ── Login Logic ────────────────────────────────────────────────────────────────

def _perform_login(driver, wait, username: str = None, password: str = None, phone: str = None) -> bool:
    log.info("➡️  [AUTH] Starting login sequence...")
    if phone:
        try:
            wait.until(EC.element_to_be_clickable((By.XPATH, "//a[contains(text(), 'Log in dengan no. HP')]"))).click()
            time.sleep(1)
        except: pass
        phone_input = wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, "input[type='tel']")))
        phone_input.send_keys(Keys.CONTROL + "a", Keys.BACKSPACE)
        human_like_typing(phone_input, phone)
        wait.until(EC.element_to_be_clickable((By.XPATH, "//button[contains(., 'Selanjutnya')]"))).click()
    else:
        # Wait for page to stabilize
        time.sleep(2)
        
        # Robust selectors for login fields
        user_input = None
        # Try finding ANY visible text input first
        try:
            inputs = driver.find_elements(By.CSS_SELECTOR, "input")
            for inp in inputs:
                p = (inp.get_attribute("placeholder") or "").lower()
                n = (inp.get_attribute("name") or "").lower()
                t = (inp.get_attribute("type") or "").lower()
                if inp.is_displayed() and (t == "text" or "user" in n or "phone" in n or "handphone" in p or "username" in p):
                    user_input = inp
                    break
        except: pass

        if not user_input:
            # Last ditch attempt with specific selectors
            for sel in ["input[name='userName']", "input[placeholder*='handphone']", "input[placeholder*='Username']", "input[type='text']"]:
                try:
                    el = wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, sel)))
                    if el.is_displayed(): user_input = el; break
                except: continue
        
        if not user_input:
            log.error(f"❌ Failed to find Username field. URL: {driver.current_url}")
            # Log all input attributes for debugging
            try:
                all_inps = driver.find_elements(By.TAG_NAME, "input")
                log.debug(f"  Found {len(all_inps)} input tags on page.")
                for i, el in enumerate(all_inps):
                    log.debug(f"    [{i}] name={el.get_attribute('name')} type={el.get_attribute('type')} placeholder={el.get_attribute('placeholder')} visible={el.is_displayed()}")
            except: pass
            raise Exception("Could not find Username input field")

        pass_input = None
        for sel in ["input[type='password']", "input[placeholder='Password']"]:
            try:
                el = wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, sel)))
                if el.is_displayed(): pass_input = el; break
            except: continue
            
        if not pass_input: raise Exception("Could not find Password input field")

        user_input.send_keys(Keys.CONTROL + "a", Keys.BACKSPACE)
        human_like_typing(user_input, username)
        pass_input.send_keys(Keys.CONTROL + "a", Keys.BACKSPACE)
        human_like_typing(pass_input, password)
        
        # Click login button
        login_btn = None
        for btn_sel in ["//button[contains(., 'Masuk') or contains(., 'Log In')]", "//button[@type='submit']"]:
            try:
                btn = wait.until(EC.element_to_be_clickable((By.XPATH, btn_sel)))
                if btn.is_displayed(): login_btn = btn; break
            except: continue

        if login_btn: login_btn.click()
        else: raise Exception("Could not find Login button")

    log.debug("  ⏳ Waiting for post-login redirect or OTP...")
    start_wait = time.time()
    otp_attempted = False
    last_resend_time = time.time()
    while time.time() - start_wait < 300:
        if "/authenticate/login" not in driver.current_url: break
        try:
            otp_input = None
            for sel in ["input.shopee-otp-input__input", ".shopee-otp-input input", "input[maxlength='6']"]:
                els = driver.find_elements(By.CSS_SELECTOR, sel)
                for el in els:
                    if el.is_displayed(): otp_input = el; break
                if otp_input: break

            if otp_input and not otp_attempted:
                otp_code = get_latest_otp(timeout_mins=3)
                if otp_code:
                    log.info(f"⌨️  [AUTH] Filling OTP: {otp_code}")
                    otp_input.click()
                    human_like_typing(otp_input, otp_code)
                    time.sleep(0.5)
                    otp_input.send_keys(Keys.ENTER)
                    otp_attempted = True
                elif time.time() - last_resend_time > 65:
                    btns = driver.find_elements(By.XPATH, "//button[contains(., 'Kirim ulang') or contains(., 'Resend')]")
                    for b in btns:
                        if b.is_displayed() and not any(c.isdigit() for c in b.text):
                            b.click(); last_resend_time = time.time(); break

            if otp_attempted or not otp_input:
                for cs in ["//button[contains(., 'Lanjutkan')]", "//button[contains(., 'Confirm')]", ".shopee-button--primary"]:
                    btns = driver.find_elements(By.XPATH, cs) if cs.startswith("//") else driver.find_elements(By.CSS_SELECTOR, cs)
                    for b in btns:
                        if b.is_displayed() and "ulang" not in b.text.lower():
                            b.click(); time.sleep(1); break
        except: pass
        time.sleep(2)

    return True

def auto_switch_merchant(driver, target_name):
    """
    Automated merchant switch using the profile menu dropdown on the dashboard.
    This avoids the selector page which often triggers forced re-logins.
    """
    log.info(f"🔄 [MERCHANT] Switching to: {target_name}...")
    try:
        # 0. Fast Loader Removal
        driver.execute_script("document.querySelectorAll('.ant-spin, [class*=\"loading\"], .shopee-loading').forEach(el => el.remove());")
        
        wait = WebDriverWait(driver, 15)

        js_selector_click = """
            var targetName = arguments[0].toLowerCase().trim();
            var labels = document.querySelectorAll('.merchantInfo, .shop-name, .merchant-name, span, div, li, p');
            var firstMerchant = null;
            var foundTarget = false;

            for (var i = 0; i < labels.length; i++) {
                var el = labels[i];
                var text = (el.innerText || "").toLowerCase().trim();
                
                // Track first clickable-looking merchant
                if (!firstMerchant && (el.classList.contains('merchantInfo') || el.classList.contains('shop-name'))) {
                    firstMerchant = el;
                }

                if (text === targetName || (text.includes(targetName) && el.children.length < 3)) {
                    el.scrollIntoView({block: 'center'});
                    el.click();
                    foundTarget = true;
                    break;
                }
            }
            
            // Fallback: If target not found, click the first one to get to dashboard
            if (!foundTarget && firstMerchant) {
                firstMerchant.scrollIntoView({block: 'center'});
                firstMerchant.click();
                foundTarget = true;
            }

            if (!foundTarget) return false;
            
            // 2. Click the confirmation button (Masuk / Konfirmasi)
            setTimeout(() => {
                var btns = document.querySelectorAll('button');
                for (var b of btns) {
                    var bText = (b.innerText || "").toLowerCase();
                    if (bText.includes('masuk') || bText.includes('konfirmasi') || bText.includes('lanjutkan') || bText.includes('ok')) {
                        b.click();
                        break;
                    }
                }
            }, 600);
            
            return true;
        """

        # PHASE 1: Handle initial merchant selector page right after login
        current_url = driver.current_url
        if "onboarding" in current_url or "merchant-selector" in current_url:
            log.debug(f"  📍 Detected Merchant Selector page (URL: {current_url}). Attempting to bypass...")
            time.sleep(3)
            
            for attempt in range(5):
                if driver.execute_script(js_selector_click, target_name):
                    log.debug(f"  ✅ Triggered selection on selector page. Waiting for dashboard...")
                    try:
                        wait.until(lambda d: "/food/dashboard" in d.current_url)
                        time.sleep(3)
                        # Re-check current name after landing on dashboard
                        try:
                            actual_name = driver.find_element(By.CSS_SELECTOR, ".merchantName").text.strip().lower()
                            if target_name.lower() in actual_name:
                                return True
                            else:
                                log.info(f"  📍 Landed on dashboard as '{actual_name}'. Will switch to target now.")
                                break 
                        except:
                            break
                    except: pass
                # Scroll if not found
                driver.execute_script("window.scrollBy(0, 300);")
                time.sleep(1)
            
            if "onboarding" in driver.current_url or "merchant-selector" in driver.current_url:
                raise Exception(f"Failed to bypass Merchant Selector page")

        # PHASE 2: Dashboard Switch Logic
        if "/food/dashboard" not in driver.current_url:
            driver.get(PARTNER_DASHBOARD)
            time.sleep(2)
        
        # PHASE 2: Dashboard Switch Logic
        if "/food/dashboard" not in driver.current_url:
            driver.get(PARTNER_DASHBOARD)
            time.sleep(2)
        
        # Use ActionChains to hover Profile then "Pilih Merchant Lain"
        try:
            actions = ActionChains(driver)
            # 1. Hover/Click merchantName (Profile)
            profile_menu = wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, ".merchantName")))
            actions.move_to_element(profile_menu).click().perform()
            time.sleep(1)
            
            # 2. Hover "Pilih Merchant Lain"
            try:
                switch_trigger = wait.until(EC.presence_of_element_located((By.XPATH, "//span[contains(text(), 'Pilih Merchant Lain') or contains(text(), 'Switch Merchant')]")))
                actions.move_to_element(switch_trigger).perform()
                time.sleep(1)
            except:
                # If hover fails, try JS click as fallback
                driver.execute_script("""
                    var spans = document.querySelectorAll('span, p, div');
                    for (var s of spans) {
                        if (s.innerText.includes('Pilih Merchant Lain') || s.innerText.includes('Switch Merchant')) {
                            s.click();
                            break;
                        }
                    }
                """)
                time.sleep(1)
        except Exception as e:
            log.warning(f"  ⚠️ Failed to trigger merchant menu: {e}")
            return False

        # Use JS to click the target merchant in the revealed list
        js_switch_script = """
            var targetName = arguments[0].toLowerCase().trim();
            var items = document.querySelectorAll('li.ant-menu-item, li[role="menuitem"], .ant-dropdown-menu-item, [class*="menu-item"]');
            for (var i = 0; i < items.length; i++) {
                var text = (items[i].innerText || "").toLowerCase().trim();
                if (text === targetName || text.includes(targetName)) {
                    items[i].click();
                    return true;
                }
            }
            return false;
        """
        
        if driver.execute_script(js_switch_script, target_name):
            log.debug(f"  ✅ Clicked {target_name} in menu.")
        else:
            log.warning(f"  ⚠️ Could not find {target_name} in the list. Will retry...")
            return False

        # Wait for the merchant name in the header to actually update
        try:
            wait.until(lambda d: target_name.lower() in d.find_element(By.CSS_SELECTOR, ".merchantName").text.lower())
            log.info(f"✅ [MERCHANT] Switched to: {target_name}")
            return True
        except:
            log.warning(f"❌ [MERCHANT] UI name did not update to {target_name} in 15s.")
            return False
    except Exception as e:
        log.error(f"❌ Auto-switch failed: {e}")
        return False
    except Exception as e:
        log.error(f"❌ Auto-switch failed: {e}")
        return False





def _handle_merchant_selection(driver, active_id_forced=None):
    """
    Handles merchant selection, either automatically if a target is known 
    or interactively if needed.
    """
    try:
        # Get active ID robustly
        active_id = active_id_forced
        if not active_id:
            _, active_id = extract_tokens_from_driver(driver)
            
        if active_id:
            log.info(f"📍 [MERCHANT] Active ID: {active_id}")
        
        # Try to find all merchants for interactive selection
        all_found = {}
        all_merchants_data = {}
        try:
            with open("API/response.json", "r") as f:
                data = json.load(f)
                for m in data.get("data", {}).get("selectMerchant", {}).get("merchantList", []):
                    all_merchants_data[m["merchantName"].lower()] = str(m["merchantId"])
        except: pass

        target_names = list(all_merchants_data.keys())
        
        # Robust JS scan for merchant list
        for attempt in range(10):
            log.debug(f"  📥 Scanning for merchants (Attempt {attempt+1}/10)...")
            scan_result = driver.execute_script("""
                var results = [];
                var items = document.querySelectorAll('div, li, span, p');
                for (var i = 0; i < items.length; i++) {
                    var el = items[i];
                    if (el.children.length > 5) continue;
                    var text = (el.innerText || "").trim().split('\\n')[0];
                    if (!text || text.length < 3) continue;
                    
                    let rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        results.push({ name: text, index: i });
                    }
                }
                return results;
            """)

            if scan_result:
                all_els = driver.find_elements(By.CSS_SELECTOR, 'div, li, span, p')
                for r in scan_result:
                    name = r['name']
                    name_key = name.lower()
                    m_id = all_merchants_data.get(name_key) or "Unknown"
                    if m_id != active_id and name not in all_found:
                        all_found[name] = {"name": name, "element": all_els[r['index']], "id": m_id}
            
            if len(all_found) >= 20: break
            # Try to scroll the list container
            driver.execute_script("document.querySelectorAll('div[class*=\"menu\"], ul[class*=\"menu\"], .ant-popover-content').forEach(el => el.scrollTop += 300);")
            time.sleep(1.5)

        merchants = sorted(all_found.values(), key=lambda x: x['name'])
        if not merchants:
            if "/food/dashboard" in driver.current_url: return True
            log.warning("⚠️ No merchants found in scan.")
            return False

        print("\n" + "="*75 + f"\n  DAFTAR MERCHANT ({len(merchants)} ditemukan):\n" + "="*75)
        for i, m in enumerate(merchants, 1):
            print(f"  {i:2}. {m['name']} (ID: {m['id']})")
        choice = input(f"\nPilih nomor (1-{len(merchants)}) atau Enter untuk lanjut: ").strip()
        if not choice: return True
        
        idx = int(choice)-1
        if 0 <= idx < len(merchants):
            sel = merchants[idx]
            log.info(f"👉 Memilih: {sel['name']}")
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", sel["element"])
            time.sleep(0.5)
            try: sel["element"].click()
            except: driver.execute_script("arguments[0].click();", sel["element"])
            
            log.info("  ⏳ Waiting for dashboard redirect...")
            WebDriverWait(driver, 30).until(EC.url_contains("/food/dashboard"))
            time.sleep(2)
            return True
        return False
    except Exception as e:
        log.error(f"Selection error: {e}")
        return False



def return_to_selector(driver) -> bool:
    """
    Navigates to the merchant selection interface using UI clicks (Profile -> Pilih Merchant Lain).
    This avoids using the full-page redirect URL.
    """
    log.debug("🔄 Opening merchant selector via UI menu...")
    try:
        # Ensure we are on a page where the menu exists
        if "/food/dashboard" not in driver.current_url:
            driver.get(PARTNER_DASHBOARD)
            time.sleep(2)

        wait = WebDriverWait(driver, 15)
        actions = ActionChains(driver)

        # 1. Find and hover over Profile/Account menu or Merchant Name
        selectors = [
            ".merchantName", 
            "li[data-menu-id*='account']", 
            ".ant-menu-item-only-child[data-menu-id*='account']",
            "div[class*='account']",
            ".user-info",
            "li.ant-menu-item:last-child"
        ]
        profile_menu = None
        for sel in selectors:
            try:
                el = driver.find_element(By.CSS_SELECTOR, sel)
                if el.is_displayed():
                    profile_menu = el
                    break
            except: continue
        
        if not profile_menu:
            log.warning("⚠️ Could not find profile/merchant menu in UI.")
            # If user strictly doesn't want URL, we try one more thing: look for any element with 'Pilih Merchant'
            try:
                el = driver.find_element(By.XPATH, "//*[contains(text(), 'Pilih Merchant')]")
                el.click()
                return True
            except:
                log.warning("⚠️ Falling back to URL navigation.")
                driver.get("https://partner.shopee.co.id/authenticate/merchant-selector")
                return True

        # Try to click directly or hover
        try:
            actions.move_to_element(profile_menu).perform()
            time.sleep(0.5)
        except: pass
        
        # Look for "Pilih Merchant Lain" or just click the merchant name if it opens a menu
        try:
            switch_trigger = wait.until(EC.element_to_be_clickable((By.XPATH, "//span[text()='Pilih Merchant Lain' or text()='Switch Merchant' or contains(text(), 'Ubah')]")))
            driver.execute_script("arguments[0].click();", switch_trigger)
        except:
            # Maybe clicking the merchantName itself opens it?
            driver.execute_script("arguments[0].click();", profile_menu)
        
        time.sleep(2) # Wait for list to appear
        return True
    except Exception as e:
        log.error(f"❌ Failed to open selector via UI: {e}")
        # Final fallback
        driver.get("https://partner.shopee.co.id/authenticate/merchant-selector")
        return True

def get_session(username=None, password=None, phone=None, headless=True, close_browser=True, target_name=None) -> dict | None:
    log.info(f"🌐 [BROWSER] Launching (headless={headless})...")
    driver = _init_driver(headless=headless)
    wait = WebDriverWait(driver, 30)

    try:
        # ── Step 1: Check browser state first (Profile session) ──
        driver.get(PARTNER_DASHBOARD)
        time.sleep(4)
        
        is_logged_in = False
        current_url = driver.current_url.lower()
        if "dashboard" in current_url or "merchant-selector" in current_url:
            log.info("✅ [SESSION] Browser is already logged in.")
            is_logged_in = True
        else:
            saved = load_session()
            if saved:
                log.debug("🔍 Attempting to restore session from saved tokens...")
                # Inject cookies
                driver.add_cookie({"name": "shopee_tob_token", "value": saved["shopee_tob_token"]})
                if saved.get("shopee_tob_entity_id"):
                    driver.add_cookie({"name": "shopee_tob_entity_id", "value": saved["shopee_tob_entity_id"]})
                
                # Also inject extra cookies if any
                for n, v in saved.get("extra_cookies", {}).items():
                    try: driver.add_cookie({"name": n, "value": v})
                    except: pass
                
                driver.refresh()
                time.sleep(4)
                current_url = driver.current_url.lower()
                if "dashboard" in current_url or "merchant-selector" in current_url:
                    log.info("✅ [SESSION] Restored from saved tokens.")
                    is_logged_in = True

        # ── Step 3: Login if all above failed ──
        if not is_logged_in:
            log.info("⚠️ [SESSION] No active session. Navigating to login...")
            driver.get("https://partner.shopee.co.id/login")
            time.sleep(5)
            
            # Check if we are still on login/auth page or about:blank
            current_url = driver.current_url.lower()
            if "login" in current_url or "authenticate" in current_url or "about:blank" in current_url:
                success = _perform_login(driver, wait, username, password, phone)
                if not success: return None
                
            # ── NEW: Explicit Onboarding Bypass ──
            time.sleep(3)
            if "onboarding" in driver.current_url or "merchant-selector" in driver.current_url:
                log.info("📍 [SESSION] Detected Onboarding page. Selecting first available merchant...")
                
                bypass_js = """
                    // 1. Remove loading animations/overlays that block clicks
                    var loaders = document.querySelectorAll('.ant-spin, [class*="loading"], .shopee-loading, .ant-spin-nested-loading');
                    loaders.forEach(el => el.remove());

                    // 2. Target the merchant row identified by the user (.merchantInfo)
                    var target = document.querySelector('.merchantInfo, .ant-list-item, .shop-name');
                    if (target) {
                        target.scrollIntoView({block: 'center'});
                        target.click();
                        
                        // Handle potential confirmation modal immediately
                        setTimeout(() => {
                            var btns = document.querySelectorAll('button');
                            for (var b of btns) {
                                var bText = (b.innerText || "").toLowerCase();
                                if (bText.includes('masuk') || bText.includes('konfirmasi') || bText.includes('lanjutkan') || bText.includes('ok')) {
                                    b.click();
                                }
                            }
                        }, 500);
                        return true;
                    }
                    return false;
                """
                
                bypass_success = False
                for attempt in range(10):
                    if driver.execute_script(bypass_js):
                        log.debug("  ✅ Selection triggered via JS.")
                        try:
                            # Wait up to 10s for dashboard
                            wait.until(lambda d: "/food/dashboard" in d.current_url)
                            log.debug("  ✅ Landed on dashboard.")
                            bypass_success = True
                            break
                        except: pass
                    
                    # Scroll container as fallback
                    try:
                        container = driver.find_element(By.CSS_SELECTOR, ".ant-list-items, [role='list']")
                        driver.execute_script("arguments[0].scrollTop += 300;", container)
                    except: pass
                    time.sleep(1)
                
                if bypass_success:
                    time.sleep(2)
        
        # ── Step 4: Extract current ID & Name via API ──
        log.debug("🔍 Fetching active merchant info via API...")
        active_id = None
        active_name = "Unknown Merchant"
        
        try:
            # Use execute_async_script with full URL and token
            api_js = """
            var done = arguments[arguments.length - 1];
            let token = document.cookie.split('; ').find(row => row.startsWith('shopee_tob_token='))?.split('=')[1];
            fetch('https://api.partner.shopee.co.id/nb/mss/web-api/PartnerAccountServer/GetUserInfo', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-merchant-token': token || '',
                    'x-merchant-language': 'id',
                    'x-merchant-login-from': '12'
                },
                body: '{}',
                credentials: 'include'
            })
            .then(r => r.json())
            .then(j => done(j.data || null))
            .catch(() => done(null));
            """
            driver.set_script_timeout(10)
            user_data = driver.execute_async_script(api_js)
            if user_data:
                active_id = str(user_data.get("merchantId") or "")
                active_name = user_data.get("merchantName") or "Unknown Merchant"
        except: pass

        # ── Step 4.5: Fallback to UI Name Matching (Very robust if API/response.json exists) ──
        if not active_id or active_id == "None":
            try:
                # Wait up to 5s for UI name
                ui_name = ""
                for _ in range(5):
                    try:
                        el = driver.find_element(By.CLASS_NAME, "merchantName")
                        if el.text.strip():
                            ui_name = el.text.strip()
                            break
                    except: pass
                    time.sleep(1)
                
                if ui_name:
                    active_name = ui_name
                    # Look up ID in local database
                    with open("API/response.json", "r") as f:
                        m_data = json.load(f)
                        for m in m_data.get("data", {}).get("selectMerchant", {}).get("merchantList", []):
                            if m["merchantName"].lower() == ui_name.lower():
                                active_id = str(m["merchantId"])
                                log.info(f"📍 [MERCHANT] Detected: {active_name} (ID: {active_id})")
                                break
            except: pass

        if not active_id:
            _, active_id = extract_tokens_from_driver(driver)
        
        # ── Step 5: Decision - Switch or Stay? ──
        do_switch = False
        
        if target_name:
            # Automated mode: switch if current name doesn't match target
            if active_name.lower() != target_name.lower():
                log.info(f"📍 [MERCHANT] Current: {active_name} | Target: {target_name}. Switching...")
                do_switch = True
            else:
                log.info(f"✅ [MERCHANT] Already as target: {active_name}")
                do_switch = False
        else:
            # Interactive mode
            if active_id and active_id != "None":
                log.info(f"📍 [MERCHANT] Current: {active_name} (ID: {active_id})")
                choice = input(f"❓ Switch merchant? (y/N): ").strip().lower()
                if choice == 'y':
                    do_switch = True
            else:
                log.info("📍 [MERCHANT] No active merchant detected. Redirecting...")
                do_switch = True

        if do_switch:
            if target_name:
                success = auto_switch_merchant(driver, target_name)
            else:
                if "/food/dashboard" in driver.current_url:
                    log.info("🔄 Navigating to merchant selector...")
                    return_to_selector(driver)
                success = _handle_merchant_selection(driver, active_id_forced=active_id)
            
            if not success: return None
        else:
            # If staying, ensure we are on dashboard
            if "/food/dashboard" not in driver.current_url:
                driver.get(PARTNER_DASHBOARD)
                time.sleep(2)


        # ── Step 4: Final Token Extraction ──
        t, eid = _trigger_and_extract_tokens(driver)
        if not t: return None
        all_c = get_all_cookies_dict(driver)
        save_session(t, eid or "", extra_cookies=all_c)
        res = {"shopee_tob_token": t, "shopee_tob_entity_id": eid or "", "extra_cookies": all_c}
        if not close_browser: res["driver"] = driver
        return res
    except Exception as e:
        log.error(f"Browser session error: {e}")
        return None
    finally:
        if close_browser: driver.quit()

def refresh_tokens(driver) -> dict:
    t, eid = _trigger_and_extract_tokens(driver)
    all_c = get_all_cookies_dict(driver)
    save_session(t, eid or "", extra_cookies=all_c)
    return {"shopee_tob_token": t, "shopee_tob_entity_id": eid or "", "extra_cookies": all_c}
