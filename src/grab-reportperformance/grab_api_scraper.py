import os
import json
import asyncio
import time
from datetime import datetime, timedelta
from playwright.async_api import async_playwright
from dotenv import load_dotenv

# Load environment variables
load_dotenv(override=True)

import logging

logger = logging.getLogger("GrabAuto")

class SessionStuckError(Exception):
    """Custom exception when API calls are stuck due to persistent network errors"""
    pass

class GrabAPI:
    def __init__(self, page, username, password):
        self.page = page
        self.username = username
        self.password = password
        self.base_url = "https://merchant.grab.com"

    async def call_api(self, url, method="GET", params=None):
        """Call Grab API from within the page context to reuse session/headers"""
        # Construct URL with params if GET
        full_url = url
        if params and method == "GET":
            query = "&".join([f"{k}={v}" for k, v in params.items()])
            full_url = f"{url}?{query}" if "?" not in url else f"{url}&{query}"
        
        js_code = f"""
        async () => {{
            try {{
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000);
                
                const response = await fetch("{full_url}", {{
                    method: "{method}",
                    signal: controller.signal,
                    headers: {{
                        "Accept": "application/json",
                        "Content-Type": "application/json"
                    }}
                }});
                clearTimeout(timeoutId);
                const status = response.status;
                const text = await response.text();
                try {{
                    return {{ status, data: JSON.parse(text) }};
                }} catch (e) {{
                    return {{ status, data: text }};
                }}
            }} catch (e) {{
                return {{ status: 0, error: e.toString() }};
            }}
        }}
        """
        
        for attempt in range(5):  # Increase to 5 attempts for network resilience
            try:
                # Wait for page to be relatively stable
                if self.page.is_closed():
                    return {"status": 0, "error": "Page closed"}
                
                res = await self.page.evaluate(js_code)
                
                # Handle cases where evaluate might return None
                if res is None:
                    res = {"status": 0, "error": "Evaluation returned None"}

                # Check if it's a network error from the JS side
                if res.get("status") == 0 and res.get("error"):
                    err_msg = res["error"].lower()
                    if "failed to fetch" in err_msg or "networkerror" in err_msg or "aborted" in err_msg:
                        if attempt < 4:
                            logger.info(f"  [Retry] Network error detected in JS fetch, retrying... ({attempt+1})")
                            # Capture screenshot for diagnosis
                            try:
                                os.makedirs("logs", exist_ok=True)
                                ss_path = f"logs/net_error_{self.username}_try{attempt+1}.png"
                                await self.page.screenshot(path=ss_path)
                            except: pass
                            await asyncio.sleep(3)
                            continue
                        else:
                            # If we hit the limit, raise SessionStuckError to trigger a full session refresh
                            raise SessionStuckError(f"Network stuck for {self.username} after 5 attempts")
                
                return res
            except SessionStuckError:
                raise # Re-raise to be caught by run_api_download_for_portal
            except Exception as e:
                err_msg = str(e).lower()
                if ("context was destroyed" in err_msg or "navigation" in err_msg or "network" in err_msg) and attempt < 4:
                    logger.info(f"  [Retry] Playwright execution error, retrying API call... ({attempt+1})")
                    await asyncio.sleep(2)
                    continue
                return {"status": 0, "error": str(e)}
        
        return {"status": 0, "error": "Max retries reached without successful response"}

    async def get_merchant_group_id(self):
        """GET /troy/user-profile/v1/merchant-selector"""
        url = f"{self.base_url}/troy/user-profile/v1/merchant-selector"
        resp = await self.call_api(url)
        status = resp.get("status")
        if status == 200:
            data = resp.get("data", {})
            merchants = data.get("merchants", [])
            if merchants:
                mgid = merchants[0].get("id")
                return mgid
        else:
            logger.warning(f"  [API] merchant-selector returned status {status}: {str(resp.get('data'))[:100]}")
        return None

    async def start_async_download(self, mgid, start_date, end_date):
        """GET /mex/finances/v1/async-transactions-download"""
        url = f"{self.base_url}/mex/finances/v1/async-transactions-download"
        params = {
            "merchant_group_id": mgid,
            "store_ids": "all",
            "from": start_date,
            "to": end_date,
            "currency": "IDR"
        }
        resp = await self.call_api(url, params=params)
        if resp.get("status") == 200:
            data = resp.get("data", {})
            ref_id = data.get("data", {}).get("ref_id")
            if ref_id:
                return ref_id, None
            return None, f"No ref_id in 200 response: {data}"
        
        err = f"Status {resp.get('status')}: {resp.get('data') or resp.get('error')}"
        return None, err

    async def poll_for_download(self, mgid, ref_id, max_retries=60):
        """Wait for report to be ready"""
        url = f"{self.base_url}/mex/finances/v1/generated-report/{ref_id}"
        params = {
            "merchant_group_id": mgid,
            "currency": "IDR"
        }
        
        last_error = "Timeout"
        for i in range(max_retries):
            resp = await self.call_api(url, params=params)
            if resp.get("status") == 200:
                outer = resp.get("data") or {}
                inner = outer.get("data") or {}
                status = inner.get("status")
                if status == "SUCCESS":
                    urls = inner.get("urls") or []
                    for u in urls:
                        if u.get("name") == "url" and u.get("url"):
                            return u.get("url"), None
                    return None, "Status SUCCESS but no valid URL found"
                elif status == "FAILED":
                    return None, f"Report generation FAILED: {inner}"
                else:
                    # Still processing
                    pass
            else:
                last_error = f"API status {resp.get('status')}: {resp.get('data') or resp.get('error')}"
            
            await asyncio.sleep(5)
        
        return None, f"Timed out after {max_retries} retries. Last state: {last_error}"

    async def download_csv(self, download_url, filename):
        """Download CSV from URL using page context (to reuse cookies)"""
        try:
            # Use context.request to inherit cookies and headers from the active session
            response = await self.page.context.request.get(download_url, timeout=60000)
            if response.status == 200:
                os.makedirs(os.path.dirname(filename), exist_ok=True)
                body = await response.body()
                with open(filename, 'wb') as f:
                    f.write(body)
                return True, None
            return False, f"HTTP {response.status}"
        except Exception as e:
            return False, str(e)

async def perform_login(page, user, pwd):
    """Robust login steps — clears cookies on mismatch and handles sticky 'Welcome back' pages."""
    CLEAN_LOGIN_URL = (
        "https://weblogin.grab.com/merchant/login"
        "?service_id=MEXUSERS&redirect=https%3A%2F%2Fmerchant.grab.com%2Fportal"
    )
    
    # Random stagger to avoid simultaneous hits
    import random
    stagger = random.uniform(1.0, 5.0)
    await asyncio.sleep(stagger)
    
    try:
        print(f"  [Login] Navigating to login page for {user}...")
        for attempt in range(3):
            try:
                # Use clean login URL directly to avoid most 'Welcome back' issues
                await page.goto(CLEAN_LOGIN_URL, wait_until="domcontentloaded", timeout=60000)
                break
            except Exception as nav_err:
                if attempt < 2:
                    logger.info(f"  [Login] Navigation error ({nav_err}), retrying... ({attempt+1})")
                    await asyncio.sleep(5)
                else:
                    raise nav_err

        await page.wait_for_timeout(3000)

        # Check for block pages
        content = await page.content()
        if "Attention Required" in await page.title() or "cloudflare" in content.lower() or "distil" in content.lower():
            logger.error(f"  ✗ [BLOCK] Detected anti-bot page for {user}.")
            await page.screenshot(path=f"blocked_{user}.png")
            return False

        # --- Handle Sticky "Welcome back" / Saved Accounts page ---
        is_saved_accounts = "saved-accounts" in page.url
        welcome_back_locator = page.locator('h1:has-text("Welcome back"), h2:has-text("Welcome back"), div:has-text("Welcome back")')

        if is_saved_accounts or await welcome_back_locator.count() > 0:
            content_lower = (await page.content()).lower()
            if user.lower() in content_lower:
                logger.info(f"  [Login] Saved account matches {user}, clicking 'Continue'...")
                continue_btn = page.locator('button:has-text("Continue"), button:has-text("Lanjut")')
                if await continue_btn.count() > 0:
                    await continue_btn.first.click()
                    # Wait for either dashboard or password field
                    try:
                        await page.wait_for_selector('input[type="password"], .dashboard, .portal-content', timeout=10000)
                    except: pass
                    
                    if "login" not in page.url.lower() and "saved-accounts" not in page.url:
                        return True
            else:
                # IMPORTANT: If it's a mismatch, don't just click "another user", 
                # CLEAR COOKIES to force a fresh login form
                logger.info(f"  [Login] Saved account mismatch for {user}. Clearing cookies for fresh start...")
                await page.context.clear_cookies()
                await page.goto(CLEAN_LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(2000)

        # --- Normal Login Flow ---
        user_selectors = [
            'input[type="email"]', 'input[name="email"]', 'input[type="text"]',
            'input[placeholder*="Email" i]', 'input[placeholder*="Username" i]',
            '#email', '#username',
        ]

        async def find_username_field():
            for sel in user_selectors:
                try:
                    el = page.locator(sel).first
                    if await el.is_visible(timeout=5000) and await el.is_enabled():
                        return el
                except: continue
            return None

        user_field = await find_username_field()
        if not user_field and "saved-accounts" in page.url:
            await page.goto(CLEAN_LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(2000)
            user_field = await find_username_field()

        if user_field:
            await user_field.click()
            await user_field.fill("")
            await user_field.fill(user)
            await page.wait_for_timeout(500)
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(2000)

        # Password field
        pwd_selector = 'input[type="password"], #password'
        try:
            await page.wait_for_selector(pwd_selector, timeout=15000)
        except:
            continue_btns = page.locator('button:has-text("Continue"), button:has-text("Next"), button:has-text("Lanjut")')
            if await continue_btns.count() > 0:
                await continue_btns.first.click()
                try: await page.wait_for_selector(pwd_selector, timeout=10000)
                except: pass
        
        if await page.locator(pwd_selector).count() > 0:
            await page.fill(pwd_selector, pwd)
            await page.wait_for_timeout(500)
            await page.keyboard.press("Enter")
            
            try:
                await page.wait_for_url(lambda u: "login" not in u.lower() and "saved-accounts" not in u, timeout=30000)
                await page.wait_for_load_state("networkidle")
            except: pass
        
        return "login" not in page.url.lower() and "saved-accounts" not in page.url
    except Exception as e:
        logger.error(f"  ✗ [Login] Failed: {e}")
        return False

async def run_api_download_for_portal(user, pwd, start_date: str = None, end_date: str = None, browser=None):
    session_dir = "sessions"
    os.makedirs(session_dir, exist_ok=True)
    session_path = os.path.join(session_dir, f"{user}.json")
    
    p = None
    managed_browser = None
    
    for run_attempt in range(3):
        storage_state = session_path if os.path.exists(session_path) and run_attempt == 0 else None
        
        try:
            if browser is None and managed_browser is None:
                p = await async_playwright().start()
                headless_env = os.getenv("HEADLESS", "true").lower() == "true"
                managed_browser = await p.chromium.launch(headless=headless_env)
                browser = managed_browser
            
            context = await browser.new_context(
                storage_state=storage_state,
                user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            )
            page = await context.new_page()
            
            if run_attempt > 0:
                logger.info(f"  [Action] Persistent network error. Re-opening session for {user} (Attempt {run_attempt+1})...")

            logger.info(f"  [Isolation] Checking session for {user}...")
            try:
                await page.goto("https://merchant.grab.com/dashboard", wait_until="domcontentloaded", timeout=30000)
            except: pass
            
            api = GrabAPI(page, user, pwd)
            mgid = await api.get_merchant_group_id()
            
            if not mgid:
                logger.info(f"  [Session] Not active. Logging in...")
                if await perform_login(page, user, pwd):
                    mgid = await api.get_merchant_group_id()
                    if mgid:
                        await context.storage_state(path=session_path)
                        logger.info(f"  [Session] Login success, session saved.")
                    else:
                        logger.error(f"  ✗ [Session] Login success but failed to get MGID for {user}.")
                        os.makedirs("logs", exist_ok=True)
                        ss_path = f"logs/auth_fail_mgid_{user}.png"
                        await page.screenshot(path=ss_path)
                else:
                    logger.error(f"  ✗ [Session] Login failed for {user}.")
                    os.makedirs("logs", exist_ok=True)
                    ss_path = f"logs/login_fail_{user}.png"
                    await page.screenshot(path=ss_path)
            else:
                await context.storage_state(path=session_path)

            if not mgid:
                await context.close()
                if run_attempt < 2: continue
                return None, "Auth failed"

            report_end = end_date or datetime.now().strftime("%Y-%m-%d")
            report_start = start_date or (datetime.now() - timedelta(days=120)).strftime("%Y-%m-%d")
            
            ref_id, err = await api.start_async_download(mgid, report_start, report_end)
            if not ref_id:
                await context.close()
                if run_attempt < 2: continue
                return None, f"Request failed: {err}"
                
            download_url, err = await api.poll_for_download(mgid, ref_id)
            if not download_url:
                await context.close()
                if run_attempt < 2: continue
                return None, f"Polling failed: {err}"
                
            filename = f"downloads/grab_transactions_{user}.csv"
            success, err = await api.download_csv(download_url, filename)
            
            if not success:
                os.makedirs("logs", exist_ok=True)
                ss_path = f"logs/download_fail_{user}.png"
                await page.screenshot(path=ss_path)
                await context.close()
                if run_attempt < 2: continue
                return None, f"Download failed: {err}"

            await context.close()
            return (filename, None)

        except SessionStuckError as se:
            logger.warning(f"  [Action] {se}. Closing and re-opening context for {user}...")
            if 'context' in locals(): await context.close()
            if run_attempt < 2: continue
            return None, str(se)
        except Exception as e:
            logger.error(f"  [Error] Run attempt {run_attempt+1} failed for {user}: {e}")
            if 'context' in locals(): await context.close()
            if run_attempt < 2: continue
            return None, str(e)
            
    if managed_browser: await managed_browser.close()
    if p: await p.stop()
    return None, "Max account-level retries reached"

if __name__ == "__main__":
    async def main():
        load_dotenv()
        u, p = os.getenv("GRAB_USERNAME_PORTAL1"), os.getenv("GRAB_PASSWORD_PORTAL1")
        if u and p:
            res, err = await run_api_download_for_portal(u, p)
            print(f"Result: {res or err}")
    asyncio.run(main())
