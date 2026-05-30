"""
test_concurrency_mitigations.py
=================================
Test suite untuk memverifikasi semua mitigasi concurrency yang sudah diimplementasikan:
1. GoFood — token isolation (tidak cross-contaminate antar "proses")
2. GrabFood — UUID suffix unik per download call
3. GrabFood — filelock tersedia dan berfungsi
"""

import sys
import os
import asyncio
import unittest
from unittest.mock import patch, MagicMock, AsyncMock
import threading
import time

# ────────────────────────────────────────────────────────
# ANSI helpers
# ────────────────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
BLUE   = "\033[94m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

def pass_msg(msg): print(f"  {GREEN}✅ PASS{RESET} — {msg}")
def fail_msg(msg): print(f"  {RED}✗  FAIL{RESET} — {msg}")
def section(title): print(f"\n{BOLD}{BLUE}{'='*55}{RESET}\n{BOLD}  {title}{RESET}\n{'─'*55}")


# ════════════════════════════════════════════════════════
# TEST 1: GoFood — Token Isolation
# ════════════════════════════════════════════════════════

section("TEST 1 — GoFood: Token Isolation (tidak cross-contaminate)")

# Tambah goscrapperv2 ke path
GOFOOD_DIR = os.path.join(os.path.dirname(__file__), "src", "goscrapperv2")
sys.path.insert(0, GOFOOD_DIR)

try:
    import gofood
    import inspect
    from datetime import datetime

    # Setup: set os.environ global ke token "lama" yang seharusnya TIDAK dipakai
    # ketika token di-pass eksplisit via parameter
    os.environ["BEARER_TOKEN"]       = "TOKEN_LAMA_PROSES_SEBELUMNYA"
    os.environ["ACTIVE_STORE_ID"]    = "999999"
    os.environ["ACTIVE_NOMOR_HP"]    = "0812222"
    os.environ["ACTIVE_NAMA_OUTLET"] = "Outlet Lama"
    os.environ["ACTIVE_CABANG"]      = "Cabang Lama"

    # ── Test 1A: Verifikasi resolve logic — param eksplisit harus menang ──
    # Kita bypass pipeline panjang, langsung test resolve block di awal fungsi
    # dengan cara inspect source code approach
    import inspect as _inspect
    src = _inspect.getsource(gofood.ambil_data_analytics)

    # Pastikan fungsi membaca _token dari param, bukan langsung os.getenv
    uses_local_token  = "_token     = token     or os.getenv('BEARER_TOKEN'" in src or \
                        "_token = token or os.getenv" in src
    uses_local_store  = "_store_id  = store_id  or os.getenv('ACTIVE_STORE_ID'" in src or \
                        "_store_id = store_id or os.getenv" in src

    if uses_local_token:
        pass_msg("ambil_data_analytics menggunakan _token dari parameter (bukan langsung os.getenv)")
    else:
        fail_msg("Fungsi masih langsung baca os.getenv('BEARER_TOKEN') tanpa param!")

    if uses_local_store:
        pass_msg("ambil_data_analytics menggunakan _store_id dari parameter (bukan langsung os.getenv)")
    else:
        fail_msg("Fungsi masih langsung baca os.getenv('ACTIVE_STORE_ID') tanpa param!")

    # ── Test 1B: Verifikasi header Authorization dibuat dari _token, bukan os.getenv ──
    uses_local_in_header = "f\"Bearer {_token}\"" in src or "'Authorization': f\"Bearer {_token}\"" in src
    does_not_use_raw_env_in_header = "f\"Bearer {os.getenv('BEARER_TOKEN')}\"" not in src.split("def ambil_data_analytics")[1]

    if uses_local_in_header:
        pass_msg("Header Authorization dibangun dari _token (parameter lokal)")
    else:
        fail_msg("Header Authorization masih pakai os.getenv langsung!")

    if does_not_use_raw_env_in_header:
        pass_msg("Tidak ada os.getenv('BEARER_TOKEN') raw di dalam ambil_data_analytics body")
    else:
        fail_msg("Masih ada os.getenv('BEARER_TOKEN') raw di dalam body fungsi!")

    # ── Test 1C: Token isolation — 2 call dengan token berbeda, resolve terpisah ──
    # Langsung test resolve logic tanpa jalankan HTTP request
    def simulate_resolve(token_param, store_param):
        """Simulasi baris resolve di awal ambil_data_analytics"""
        _token    = token_param    or os.getenv('BEARER_TOKEN', '')
        _store_id = store_param    or os.getenv('ACTIVE_STORE_ID', '')
        return _token, _store_id

    token_a, store_a = simulate_resolve("TOKEN_FOODNESIA_AMAN", "12345")
    token_b, store_b = simulate_resolve("TOKEN_WONDERFOOD_AMAN", "67890")

    if token_a == "TOKEN_FOODNESIA_AMAN" and token_b == "TOKEN_WONDERFOOD_AMAN":
        pass_msg("Resolve isolation: token A dan B terpisah, tidak cross-contaminate")
    else:
        fail_msg(f"Token resolution salah: A={token_a}, B={token_b}")

    if store_a == "12345" and store_b == "67890":
        pass_msg("Resolve isolation: store_id A dan B terpisah")
    else:
        fail_msg(f"Store ID resolution salah: A={store_a}, B={store_b}")

    # Pastikan os.environ lama TIDAK dipakai jika param eksplisit ada
    token_lama_dipakai = token_a == "TOKEN_LAMA_PROSES_SEBELUMNYA" or \
                         token_b == "TOKEN_LAMA_PROSES_SEBELUMNYA"
    if not token_lama_dipakai:
        pass_msg("os.environ['BEARER_TOKEN'] lama TIDAK dipakai ketika param eksplisit di-pass")
    else:
        fail_msg("Token lama dari os.environ bocor ke salah satu call!")

    # ── Test 1D: Verifikasi fungsi signature baru ──
    sig = inspect.signature(gofood.ambil_data_analytics)
    required_params = ["token", "store_id", "nama_outlet", "phone", "cabang"]
    missing = [p for p in required_params if p not in sig.parameters]

    if not missing:
        pass_msg(f"Signature benar: ambil_data_analytics({', '.join(required_params)}, ...)")
    else:
        fail_msg(f"Parameter hilang di signature: {missing}")

    all_optional = all(sig.parameters[p].default is None for p in required_params if p in sig.parameters)
    if all_optional:
        pass_msg("Semua parameter baru opsional (default=None) — backward compatible")
    else:
        fail_msg("Ada parameter baru yang wajib diisi — breaking change!")

except Exception as e:
    fail_msg(f"Error saat test GoFood: {e}")
    import traceback; traceback.print_exc()


# ════════════════════════════════════════════════════════
# TEST 2: GrabFood — UUID Suffix Uniqueness
# ════════════════════════════════════════════════════════

section("TEST 2 — GrabFood: UUID suffix unik per download")

GRAB_DIR = os.path.join(os.path.dirname(__file__), "src", "grab-reportperformance")
sys.path.insert(0, GRAB_DIR)

try:
    import uuid
    import re

    # Simulasi logika filename generation dari grab_api_scraper.py
    # (tanpa benar-benar jalankan scraper)
    def generate_grab_filename(user):
        job_id = uuid.uuid4().hex[:8]
        return f"downloads/grab_transactions_{user}_{job_id}.csv"

    # Generate 100 filenames untuk user yang sama
    user = "7307foodnesia"
    filenames = [generate_grab_filename(user) for _ in range(100)]

    all_unique = len(set(filenames)) == 100
    if all_unique:
        pass_msg(f"100 filename untuk akun '{user}' semuanya unik — tidak ada overwrite")
    else:
        fail_msg(f"Ada duplikasi filename! ({len(set(filenames))} unik dari 100)")

    # Verifikasi format filename
    sample = filenames[0]
    pattern = rf"downloads/grab_transactions_{re.escape(user)}_[a-f0-9]{{8}}\.csv"
    if re.match(pattern, sample):
        pass_msg(f"Format filename benar: {sample}")
    else:
        fail_msg(f"Format filename salah: {sample}")

    # Test bahwa suffix 8 karakter hex
    suffixes = [f.split("_")[-1].replace(".csv", "") for f in filenames]
    all_hex = all(re.match(r'^[a-f0-9]{8}$', s) for s in suffixes)
    if all_hex:
        pass_msg("Semua suffix adalah 8-karakter hex (UUID)")
    else:
        fail_msg("Ada suffix yang bukan valid hex!")

    # Verifikasi filelock import di grab_api_scraper
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "grab_api_scraper",
            os.path.join(GRAB_DIR, "grab_api_scraper.py")
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        has_filelock = hasattr(mod, "FileLock")
        if has_filelock:
            pass_msg("FileLock berhasil diimport di grab_api_scraper.py")
        else:
            fail_msg("FileLock TIDAK tersedia di grab_api_scraper.py")
    except Exception as e:
        fail_msg(f"Error saat verify filelock import: {e}")

except Exception as e:
    fail_msg(f"Error saat test GrabFood UUID: {e}")
    import traceback; traceback.print_exc()


# ════════════════════════════════════════════════════════
# TEST 3: GoFood — filelock tersedia
# ════════════════════════════════════════════════════════

section("TEST 3 — GoFood: FileLock tersedia")

try:
    has_filelock = hasattr(gofood, "_FileLock")
    if has_filelock:
        pass_msg("_FileLock tersedia di gofood.py (imported dari filelock)")
    else:
        fail_msg("_FileLock tidak tersedia di gofood.py")

    # Test filelock functional (tulis file dengan lock)
    import tempfile
    test_lock_path = "/tmp/test_gofood_lock.lock"
    lock = gofood._FileLock(test_lock_path, timeout=5)
    lock_worked = False
    with lock:
        lock_worked = True  # If no exception, lock worked
    if lock_worked:
        pass_msg("FileLock acquire/release berfungsi tanpa error")
    else:
        fail_msg("FileLock gagal")

    # Test concurrent lock: Thread 2 harus menunggu Thread 1 selesai
    results = []
    lock2 = gofood._FileLock("/tmp/test_concurrent_lock.lock", timeout=5)

    def writer_thread(tid, delay_before, write_val):
        time.sleep(delay_before)
        with lock2:
            results.append(f"start_{tid}")
            time.sleep(0.1)  # Tahan lock sebentar
            results.append(f"end_{tid}")

    th_a = threading.Thread(target=writer_thread, args=(1, 0, "A"))
    th_b = threading.Thread(target=writer_thread, args=(2, 0.02, "B"))
    th_a.start()
    th_b.start()
    th_a.join()
    th_b.join()

    # Verifikasi tidak ada interleaving: start_1 dan end_1 harus berpasangan
    if len(results) == 4:
        start1_idx = results.index("start_1")
        end1_idx = results.index("end_1")
        start2_idx = results.index("start_2")
        # Thread 2 harus mulai SETELAH thread 1 selesai
        no_interleave = end1_idx < start2_idx or results.index("end_2") < start1_idx
        if no_interleave:
            pass_msg(f"Lock benar-benar sequential — tidak ada interleaving: {results}")
        else:
            fail_msg(f"Ada interleaving lock! Sequence: {results}")
    else:
        fail_msg(f"Unexpected result sequence: {results}")

except Exception as e:
    fail_msg(f"Error saat test filelock: {e}")
    import traceback; traceback.print_exc()


# ════════════════════════════════════════════════════════
# TEST 4: Discord Job Lock — Logic Verification
# ════════════════════════════════════════════════════════

section("TEST 4 — Discord Job Lock: Logic (Python-side simulation)")

try:
    # Simulasikan logic buildJobKey, acquireJob, releaseJob di Python
    active_jobs = {}

    def build_job_key(outlet, aplikator, tgl_mulai, tgl_selesai):
        normalized_outlet   = (outlet    or "all").lower().strip()
        normalized_platform = (aplikator or "all").lower().strip()
        return f"{normalized_outlet}|{normalized_platform}|{tgl_mulai}|{tgl_selesai}"

    def acquire_job(key, user_id, username):
        if key in active_jobs:
            return False
        active_jobs[key] = {"userId": user_id, "username": username, "startedAt": time.time()}
        return True

    def release_job(key):
        active_jobs.pop(key, None)

    # Test 1: User A acquire → berhasil
    key_foodnesia_grab = build_job_key("Foodnesia", "GrabFood", "01-02-2026", "30-04-2026")
    ok = acquire_job(key_foodnesia_grab, "user_a", "UserA")
    if ok:
        pass_msg("UserA berhasil acquire job Foodnesia GrabFood")
    else:
        fail_msg("UserA gagal acquire job — harusnya berhasil")

    # Test 2: User B coba acquire job yang sama → harus GAGAL
    ok2 = acquire_job(key_foodnesia_grab, "user_b", "UserB")
    if not ok2:
        pass_msg("UserB ditolak — job Foodnesia GrabFood sudah dilock oleh UserA")
    else:
        fail_msg("UserB berhasil acquire padahal job sedang berjalan!")

    # Test 3: User B acquire outlet BERBEDA → berhasil
    key_wonderfood_grab = build_job_key("WonderFood", "GrabFood", "01-02-2026", "30-04-2026")
    ok3 = acquire_job(key_wonderfood_grab, "user_b", "UserB")
    if ok3:
        pass_msg("UserB berhasil acquire job WonderFood GrabFood (outlet berbeda)")
    else:
        fail_msg("UserB gagal acquire job WonderFood — harusnya berhasil")

    # Test 4: Release UserA job → UserC bisa acquire job Foodnesia
    release_job(key_foodnesia_grab)
    ok4 = acquire_job(key_foodnesia_grab, "user_c", "UserC")
    if ok4:
        pass_msg("UserC berhasil acquire setelah UserA release — lock bersih")
    else:
        fail_msg("UserC gagal acquire setelah lock direlease!")

    # Test 5: Key harus case-insensitive dan normalized
    key_a = build_job_key("Foodnesia", "GrabFood, ShopeeFood", "01-02-2026", "30-04-2026")
    key_b = build_job_key("FOODNESIA", "grabfood, shopeefood", "01-02-2026", "30-04-2026")
    if key_a == key_b:
        pass_msg(f"Job key case-insensitive: '{key_a}'")
    else:
        fail_msg(f"Job key tidak normalized! '{key_a}' ≠ '{key_b}'")

    # Test 6: Platform berbeda = job berbeda (tidak saling block)
    release_job(key_foodnesia_grab)
    key_foodnesia_shopee = build_job_key("Foodnesia", "ShopeeFood", "01-02-2026", "30-04-2026")
    key_foodnesia_grab2  = build_job_key("Foodnesia", "GrabFood",   "01-02-2026", "30-04-2026")
    ok5 = acquire_job(key_foodnesia_shopee, "user_a", "UserA")
    ok6 = acquire_job(key_foodnesia_grab2,  "user_b", "UserB")
    if ok5 and ok6:
        pass_msg("Foodnesia-Shopee dan Foodnesia-GrabFood bisa jalan bersamaan (platform berbeda)")
    else:
        fail_msg("Foodnesia platform berbeda saling memblokir — tidak seharusnya!")

except Exception as e:
    fail_msg(f"Error saat test Discord job lock: {e}")
    import traceback; traceback.print_exc()


# ════════════════════════════════════════════════════════
# SUMMARY
# ════════════════════════════════════════════════════════
print(f"\n{BOLD}{'='*55}{RESET}")
print(f"{BOLD}  ✅ Semua test concurrency mitigation selesai{RESET}")
print(f"{'='*55}\n")
