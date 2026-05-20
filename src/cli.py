#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════
  TASK WEEKLY — Unified OFD Transaction Pipeline
  Grab & Shopee in one CLI
═══════════════════════════════════════════════════════════════

Usage:
  python cli.py                      
  python cli.py grab  --start 2026-05-05 --end 2026-05-11
  python cli.py shopee --start 2026-05-05 --end 2026-05-11
  python cli.py all   --start 2026-05-05 --end 2026-05-11
"""

import argparse
import asyncio
import sys
import os
from datetime import datetime, timedelta


# ── Colour helpers (ANSI) ──────────────────────────────────────────────
RESET  = "\033[0m"
BOLD   = "\033[1m"
GREEN  = "\033[92m"
CYAN   = "\033[96m"
YELLOW = "\033[93m"
RED    = "\033[91m"
MAGENTA = "\033[95m"
DIM    = "\033[2m"


def banner():
    # Solid 3D Rounded Gradient Banner for OFD REPORT
    FONT = {
        'O': [" ▄██████▄ ", "██▀    ▀██", "██      ██", "██      ██", " ▀██████▀ "],
        'F': ["██████████", "██        ", "███████   ", "██        ", "██        "],
        'D': ["████████▄ ", "██     ▀██", "██      ██", "██     ▄██", "████████▀ "],
        'R': ["████████▄ ", "██     ▀██", "████████▀ ", "██     ▀██", "██      ██"],
        'E': ["██████████", "██        ", "███████   ", "██        ", "██████████"],
        'P': ["████████▄ ", "██     ▀██", "████████▀ ", "██        ", "██        "],
        'T': ["█████████", "    ██   ", "    ██   ", "    ██   ", "    ██   "]
    }

    def get_word_lines(word):
        widths = [len(FONT[char][0]) for char in word]
        letter_grids = []
        for char in word:
            grid = FONT[char]
            width = len(grid[0])
            comp_grid = [[' ' for _ in range(width + 1)] for _ in range(6)]
            for r in range(5):
                for c in range(width):
                    val = grid[r][c]
                    if val != ' ':
                        comp_grid[r][c] = val
            for r in range(5):
                for c in range(width):
                    val = grid[r][c]
                    if val != ' ':
                        if comp_grid[r+1][c+1] == ' ':
                            comp_grid[r+1][c+1] = '▒'
            letter_grids.append(comp_grid)
        return letter_grids, widths

    gradient_colors = [196, 197, 203, 204, 209, 210, 215, 216, 217, 223, 224, 225, 230, 231]
    
    # Render OFD
    t_grids, t_widths = get_word_lines("OFD")
    t_total = sum(t_widths) + 2 * 2
    
    # Render REPORT
    w_grids, w_widths = get_word_lines("REPORT")
    w_total = sum(w_widths) + 5 * 2

    print(f"  [90m=================================================================[0m")
    
    # Print OFD
    for r in range(6):
        line = "       "
        curr_col = 0
        for l_idx, grid in enumerate(t_grids):
            width = len(grid[0])
            for c in range(width):
                char = grid[r][c]
                factor = curr_col / max(1, t_total - 1)
                color_idx = min(len(gradient_colors) - 1, max(0, int(factor * (len(gradient_colors) - 1))))
                color_code = gradient_colors[color_idx]
                if char == '▒':
                    line += "[38;5;238m█[0m"
                elif char != ' ':
                    line += f"[38;5;{color_code}m{char}[0m"
                else:
                    line += ' '
                curr_col += 1
            line += "  "
            curr_col += 2
        print(line)
        
    print()
    
    # Print REPORT
    for r in range(6):
        line = "  "
        curr_col = 0
        for l_idx, grid in enumerate(w_grids):
            width = len(grid[0])
            for c in range(width):
                char = grid[r][c]
                factor = curr_col / max(1, w_total - 1)
                color_idx = min(len(gradient_colors) - 1, max(0, int(factor * (len(gradient_colors) - 1))))
                color_code = gradient_colors[color_idx]
                if char == '▒':
                    line += "[38;5;238m█[0m"
                elif char != ' ':
                    line += f"[38;5;{color_code}m{char}[0m"
                else:
                    line += ' '
                curr_col += 1
            line += "  "
            curr_col += 2
        print(line)
        
    print(f"  [90m=================================================================[0m")
    print()


# ── Helpers ────────────────────────────────────────────────────────────

def _resolve_python_executable() -> str:
    """
    Returns path to local .venv/bin/python if it exists,
    otherwise falls back to sys.executable.
    """
    base = os.path.dirname(os.path.abspath(__file__))
    venv_python = os.path.join(base, ".venv", "bin", "python")
    if os.path.isfile(venv_python):
        return venv_python
    return sys.executable


def _resolve_output_dir(platform_name: str, start_date: str, end_date: str) -> str:
    """
    Build an absolute output path under:
      task-weekly/src/laporan/{platform}/{start_date}_to_{end_date}
    """
    base = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(base, "laporan", platform_name, f"{start_date}_to_{end_date}")
    os.makedirs(out, exist_ok=True)
    return out


def _resolve_shopee_merchant(outlet_name: str, branch_name: str = None) -> str:
    """
    Lookup 'Merchant Name' Shopee dari Google Sheets berdasarkan 'Nama Outlet'
    dan opsional 'Cabang'.

    Logika:
      1. Jika branch_name diberikan → cari baris dengan Nama Outlet + Cabang cocok
         (cabang di Discord form = kolom 'Cabang' di GSheets)
         Ambil Merchant Name dari baris tersebut.
      2. Jika tidak ada match dengan cabang, atau branch_name tidak diberikan
         → fallback ke lookup Nama Outlet saja (ambil merchant pertama)
      3. Jika tidak ada match sama sekali → fallback ke outlet_name asli

    Returns:
        str: Merchant Name yang bersih (tanpa trailing underscore/spasi)
    """
    GSHEETS_URL = (
        "https://docs.google.com/spreadsheets/d/e/"
        "2PACX-1vQ3tLKBNXDqRgBw0mNhKZFxgvKx-JoiTDzm_s5Ix1cm7O6HCv4IvExOLR2HSRVaXSsx82V348mcr9X4"
        "/pub?gid=0&single=true&output=csv"
    )
    base = os.path.dirname(os.path.abspath(__file__))
    cache_path = os.path.join(base, "baseline", "shopee", "data", "master_merchants_cache.csv")

    def _clean(name: str) -> str:
        return str(name).strip().rstrip('_').strip()

    try:
        import pandas as pd
        import io

        # Gunakan cache jika ada dan masih segar (24 jam)
        if os.path.exists(cache_path):
            import time
            age_hours = (time.time() - os.path.getmtime(cache_path)) / 3600
            if age_hours < 24:
                df = pd.read_csv(cache_path)
            else:
                import requests
                resp = requests.get(GSHEETS_URL, timeout=15)
                df = pd.read_csv(io.StringIO(resp.text))
                os.makedirs(os.path.dirname(cache_path), exist_ok=True)
                df.to_csv(cache_path, index=False)
        else:
            import requests
            resp = requests.get(GSHEETS_URL, timeout=15)
            df = pd.read_csv(io.StringIO(resp.text))
            os.makedirs(os.path.dirname(cache_path), exist_ok=True)
            df.to_csv(cache_path, index=False)

        outlet_lower = outlet_name.strip().lower()

        # Base filter: ShopeeFood + Live + Nama Outlet cocok
        base_filter = (
            (df['Aplikasi'] == 'ShopeeFood') &
            (df['Status'] == 'Live') &
            (df['Nama Outlet'].str.strip().str.lower() == outlet_lower)
        )

        # ── Strategi 1: Lookup dengan Cabang (paling presisi) ──────────
        if branch_name:
            branch_lower = branch_name.strip().lower()
            sf_with_branch = df[
                base_filter &
                (df['Cabang'].str.strip().str.lower() == branch_lower)
            ]
            if not sf_with_branch.empty:
                merchant_name = _clean(sf_with_branch.iloc[0]['Merchant Name'])
                if merchant_name and merchant_name not in ('-', 'nan'):
                    print(f"  {CYAN}[SHOPEE LOOKUP] Outlet+Cabang '{outlet_name} / {branch_name}'"
                          f" → Merchant: '{merchant_name}'{RESET}")
                    return merchant_name

            print(f"  {YELLOW}[SHOPEE LOOKUP] Cabang '{branch_name}' tidak ditemukan di Shopee, "
                  f"fallback ke lookup outlet saja.{RESET}")

        # ── Strategi 2: Lookup hanya Nama Outlet ───────────────────────
        sf_df = df[base_filter]
        if not sf_df.empty:
            # Hapus duplikat Merchant Name (satu outlet bisa banyak row per merchant)
            unique_merchants = (
                sf_df['Merchant Name']
                .apply(_clean)
                .loc[lambda s: (s != '-') & (s != 'nan') & (s != '')]
                .drop_duplicates()
                .tolist()
            )
            if unique_merchants:
                if len(unique_merchants) == 1:
                    print(f"  {CYAN}[SHOPEE LOOKUP] Outlet '{outlet_name}'"
                          f" → Merchant: '{unique_merchants[0]}'{RESET}")
                    return unique_merchants[0]
                else:
                    # Beberapa merchant Shopee untuk outlet ini → ambil yang pertama
                    # (biasanya semua di bawah satu akun Shopee yang sama)
                    print(f"  {CYAN}[SHOPEE LOOKUP] Outlet '{outlet_name}' punya"
                          f" {len(unique_merchants)} merchant Shopee: {unique_merchants}."
                          f" Menggunakan: '{unique_merchants[0]}'{RESET}")
                    return unique_merchants[0]

        print(f"  {YELLOW}[SHOPEE LOOKUP] Tidak ditemukan Merchant Name untuk '{outlet_name}',"
              f" fallback ke nama outlet.{RESET}")
    except Exception as e:
        print(f"  {YELLOW}[SHOPEE LOOKUP] Gagal lookup GSheets: {e}. Fallback ke nama outlet.{RESET}")

    return outlet_name


# ── Runners ────────────────────────────────────────────────────────────

def run_grab(start_date: str, end_date: str, user_filter: str = None, outlet_filter: str = None, branch_filter: str = None):
    """
    Delegates to the existing Grab weekly pipeline.
    Working directory is set to grab-reportperformance/weekly so that
    relative paths (browser_data/, downloads/) resolve correctly.
    Output is routed to task-weekly/src/laporan/grab/{start}_to_{end}.
    """
    grab_weekly_dir = os.path.join(os.path.dirname(__file__), "grab-reportperformance", "weekly")
    
    if not os.path.isdir(grab_weekly_dir):
        print(f"{RED}[ERROR]{RESET} Grab weekly directory not found: {grab_weekly_dir}")
        return False

    output_dir = _resolve_output_dir("grab", start_date, end_date)

    import subprocess
    
    python_exe = _resolve_python_executable()
    cmd = [
        python_exe, "main.py",
        "--start-date", start_date,
        "--end-date", end_date,
        "--output-dir", output_dir,
    ]
    if user_filter:
        cmd.extend(["--user", user_filter])
    if outlet_filter:
        cmd.extend(["--outlet", outlet_filter])
    if branch_filter:
        cmd.extend(["--branch", branch_filter])

    print(f"\n{GREEN}{BOLD}▶ GRAB PIPELINE{RESET}")
    print(f"  {DIM}Directory : {grab_weekly_dir}{RESET}")
    print(f"  {DIM}Output    : {output_dir}{RESET}")
    print(f"  {DIM}Date Range: {start_date} → {end_date}{RESET}")
    print()

    result = subprocess.run(cmd, cwd=grab_weekly_dir)
    
    if result.returncode == 0:
        print(f"\n{GREEN}✓ Grab pipeline completed successfully.{RESET}")
        return True
    else:
        print(f"\n{RED}✗ Grab pipeline exited with code {result.returncode}.{RESET}")
        return False


def run_grab_baseline(start_date: str, end_date: str, user_filter: str = None, outlet_filter: str = None, branch_filter: str = None):
    grab_baseline_dir = os.path.join(os.path.dirname(__file__), "baseline", "grab")
    
    if not os.path.isdir(grab_baseline_dir):
        print(f"{RED}[ERROR]{RESET} Grab baseline directory not found: {grab_baseline_dir}")
        return False

    output_dir = _resolve_output_dir("grab_baseline", start_date, end_date)

    import subprocess
    
    python_exe = _resolve_python_executable()
    cmd = [
        python_exe, "run_baseline.py",
        "--start-date", start_date,
        "--end-date", end_date,
        "--output-dir", output_dir,
    ]
    if user_filter:
        cmd.extend(["--user", user_filter])
    if outlet_filter:
        cmd.extend(["--outlet", outlet_filter])
    if branch_filter:
        cmd.extend(["--branch", branch_filter])

    print(f"\n{GREEN}{BOLD}▶ GRAB BASELINE PIPELINE{RESET}")
    print(f"  {DIM}Directory : {grab_baseline_dir}{RESET}")
    print(f"  {DIM}Output    : {output_dir}{RESET}")
    print(f"  {DIM}Date Range: {start_date} → {end_date}{RESET}")
    print()

    result = subprocess.run(cmd, cwd=grab_baseline_dir)
    
    if result.returncode == 0:
        print(f"\n{GREEN}✓ Grab Baseline completed successfully.{RESET}")
        return True
    else:
        print(f"\n{RED}✗ Grab Baseline exited with code {result.returncode}.{RESET}")
        return False


def run_shopee(start_date: str, end_date: str, merchant_filter: str = None):
    """
    Delegates to the existing Shopee weekly pipeline.
    Working directory is set to shopee-omzet-automation so that
    relative paths (core/) resolve correctly.
    Output is routed to task-weekly/src/laporan/shopee/{start}_to_{end}.
    """
    shopee_dir = os.path.join(os.path.dirname(__file__), "shopee-omzet-automation")
    
    if not os.path.isdir(shopee_dir):
        print(f"{RED}[ERROR]{RESET} Shopee directory not found: {shopee_dir}")
        return False

    output_dir = _resolve_output_dir("shopee", start_date, end_date)

    import subprocess
    
    python_exe = _resolve_python_executable()
    cmd = [
        python_exe, "weekly/run_weekly.py",
        "--start", start_date,
        "--end", end_date,
        "--output-dir", output_dir,
    ]
    if merchant_filter:
        cmd.extend(["--merchant", merchant_filter])

    print(f"\n{MAGENTA}{BOLD}▶ SHOPEE PIPELINE{RESET}")
    print(f"  {DIM}Directory : {shopee_dir}{RESET}")
    print(f"  {DIM}Output    : {output_dir}{RESET}")
    print(f"  {DIM}Date Range: {start_date} → {end_date}{RESET}")
    print()

    result = subprocess.run(cmd, cwd=shopee_dir)
    
    if result.returncode == 0:
        print(f"\n{GREEN}✓ Shopee pipeline completed successfully.{RESET}")
        return True
    else:
        print(f"\n{RED}✗ Shopee pipeline exited with code {result.returncode}.{RESET}")
        return False


def run_shopee_baseline(start_date: str, end_date: str, merchant_filter: str = None):
    shopee_baseline_dir = os.path.join(os.path.dirname(__file__), "baseline", "shopee")
    
    if not os.path.isdir(shopee_baseline_dir):
        print(f"{RED}[ERROR]{RESET} Shopee baseline directory not found: {shopee_baseline_dir}")
        return False

    output_dir = _resolve_output_dir("shopee_baseline", start_date, end_date)

    import subprocess
    
    python_exe = _resolve_python_executable()
    cmd = [
        python_exe, "run_baseline.py",
        "--start", start_date,
        "--end", end_date,
        "--output-dir", output_dir,
    ]
    if merchant_filter:
        cmd.extend(["--merchant", merchant_filter])

    print(f"\n{MAGENTA}{BOLD}▶ SHOPEE BASELINE PIPELINE{RESET}")
    print(f"  {DIM}Directory : {shopee_baseline_dir}{RESET}")
    print(f"  {DIM}Output    : {output_dir}{RESET}")
    print(f"  {DIM}Date Range: {start_date} → {end_date}{RESET}")
    print()

    result = subprocess.run(cmd, cwd=shopee_baseline_dir)
    
    if result.returncode == 0:
        print(f"\n{GREEN}✓ Shopee Baseline completed successfully.{RESET}")
        return True
    else:
        print(f"\n{RED}✗ Shopee Baseline exited with code {result.returncode}.{RESET}")
        return False


def run_gofood(start_date: str, end_date: str, outlet_filter: str = None):
    """
    Delegates to the GoFood Login/Dashboard utility.
    Working directory is set to goscrapperv2 so that
    relative paths and imports resolve correctly.
    """
    gofood_dir = os.path.join(os.path.dirname(__file__), "goscrapperv2")
    
    if not os.path.isdir(gofood_dir):
        print(f"{RED}[ERROR]{RESET} GoFood directory not found: {gofood_dir}")
        return False

    import subprocess
    
    python_exe = _resolve_python_executable()
    # Menjalankan gofood.py untuk otomatis login (jika perlu) dan scrape data
    cmd = [
        python_exe, "gofood.py",
        "--start-date", start_date,
        "--end-date", end_date
    ]
    if outlet_filter:
        cmd.extend(["--outlet", outlet_filter])

    print(f"\n{YELLOW}{BOLD}▶ GOFOOD AUTO LOGIN & SCRAPE PIPELINE{RESET}")
    print(f"  {DIM}Directory : {gofood_dir}{RESET}")
    if outlet_filter:
        print(f"  {DIM}Outlet    : {outlet_filter}{RESET}")
    print(f"  {DIM}Date Range: {start_date} → {end_date}{RESET}")
    print()

    result = subprocess.run(cmd, cwd=gofood_dir)
    
    if result.returncode == 0:
        print(f"\n{GREEN}✓ GoFood login dan scrape data berhasil.{RESET}")
        return True
    else:
        print(f"\n{RED}✗ GoFood login/scrape data keluar dengan kode {result.returncode}.{RESET}")
        return False


# ── Interactive Mode ──────────────────────────────────────────────────

def interactive_mode():
    """Let the user pick task, platform & dates interactively."""
    # Clear screen to hide dependency check details
    os.system('cls' if os.name == 'nt' else 'clear')
    banner()

    # ─ Task selection ─
    print(f"  {BOLD}Pilih Task:{RESET}")
    print(f"    {GREEN}[1]{RESET} Baseline")
    print(f"    {CYAN}[2]{RESET} Weekly")
    print()

    while True:
        task_choice = input(f"  {BOLD}Pilihan (1/2):{RESET} ").strip()
        if task_choice in ("1", "2"):
            break
        print(f"  {RED}Input tidak valid. Masukkan 1 atau 2.{RESET}")

    if task_choice == "1":
        print(f"\n  {GREEN}[INFO] Mengaktifkan Mode Baseline.{RESET}")
        import pandas as pd
        import requests
        import io

        print(f"\n  {CYAN}[INFO] Mengunduh daftar outlet terbaru dari Google Sheets...{RESET}")
        CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ3tLKBNXDqRgBw0mNhKZFxgvKx-JoiTDzm_s5Ix1cm7O6HCv4IvExOLR2HSRVaXSsx82V348mcr9X4/pub?gid=0&single=true&output=csv"
        try:
            resp = requests.get(CSV_URL, timeout=30)
            resp.raise_for_status()
            df = pd.read_csv(io.StringIO(resp.text))
        except Exception as e:
            print(f"  {RED}[ERROR] Gagal mengunduh Google Sheets: {e}{RESET}")
            sys.exit(1)
            
        # Filter hanya outlet yang memiliki minimal 1 aplikasi berstatus "Live"
        df_live = df[df["Status"].str.contains("Live", na=False, case=False)]
        outlets = sorted(df_live["Nama Outlet"].dropna().unique())
        print(f"\n  {BOLD}Pilih Outlet untuk Baseline (Menarik seluruh cabang Grab, Shopee, & GoFood sekaligus):{RESET}")
        for idx, o_name in enumerate(outlets):
            print(f"    {GREEN}[{idx + 1}]{RESET} {o_name}")
        print()
        while True:
            try:
                o_choice = int(input(f"  {BOLD}Pilih nomor outlet (1-{len(outlets)}):{RESET} ").strip())
                if 1 <= o_choice <= len(outlets):
                    unified_outlet = outlets[o_choice - 1]
                    break
            except ValueError: pass
            print(f"  {RED}Pilihan tidak valid.{RESET}")

        platform = "all"
        scope_choice = "2"
        outlet = unified_outlet
        branch = None

        # Terjemahkan Nama Outlet ke Merchant Name (nama toko spesifik di ShopeeFood)
        shopee_merchant = unified_outlet
        try:
            # Mencari baris yang namanya cocok dan aplikasinya mengandung "Shopee"
            shopee_row = df_live[(df_live["Nama Outlet"] == unified_outlet) & (df_live["Aplikasi"].str.contains("Shopee", na=False, case=False))]
            if not shopee_row.empty:
                merchant_val = shopee_row.iloc[0].get("Merchant Name", "")
                # Jika tidak kosong dan bukan strip "-", gunakan nilai tersebut
                if pd.notna(merchant_val) and str(merchant_val).strip() != "-":
                    shopee_merchant = str(merchant_val).strip()
        except Exception:
            pass

    else:
        # ─ Platform selection ─
        print(f"\n  {BOLD}Pilih platform:{RESET}")
        print(f"    {GREEN}[1]{RESET} Grab")
        print(f"    {MAGENTA}[2]{RESET} Shopee")
        print(f"    {YELLOW}[3]{RESET} GoFood")
        print(f"    {CYAN}[4]{RESET} Semua Platform (Grab + Shopee + GoFood)")
        print()

        while True:
            choice = input(f"  {BOLD}Pilihan (1/2/3/4):{RESET} ").strip()
            if choice in ("1", "2", "3", "4"):
                break
            print(f"  {RED}Input tidak valid. Masukkan 1, 2, 3, atau 4.{RESET}")

        platform_map = {"1": "grab", "2": "shopee", "3": "gofood", "4": "all"}
        platform = platform_map[choice]

        # ─ Scope selection ─
        print(f"\n  {BOLD}Pilih cakupan outlet:{RESET}")
        print(f"    {GREEN}[1]{RESET} Pilih semua outlet")
        print(f"    {YELLOW}[2]{RESET} Pilih custom (Filter spesifik){RESET}")
        print()

        while True:
            scope_choice = input(f"  {BOLD}Pilihan (1/2):{RESET} ").strip()
            if scope_choice in ("1", "2"):
                break
            print(f"  {RED}Input tidak valid. Masukkan 1 atau 2.{RESET}")

        outlet = None
        branch = None
        shopee_merchant = None

        if scope_choice == "2":
            import pandas as pd
            import requests
            import io

            print(f"\n  {CYAN}[INFO] Mengunduh daftar merchant terbaru dari Google Sheets...{RESET}")
            CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ3tLKBNXDqRgBw0mNhKZFxgvKx-JoiTDzm_s5Ix1cm7O6HCv4IvExOLR2HSRVaXSsx82V348mcr9X4/pub?gid=0&single=true&output=csv"
            try:
                resp = requests.get(CSV_URL, timeout=30)
                resp.raise_for_status()
                df = pd.read_csv(io.StringIO(resp.text))
            except Exception as e:
                print(f"  {RED}[ERROR] Gagal mengunduh Google Sheets: {e}{RESET}")
                sys.exit(1)

            # --- FILTER CUSTOM GRAB ---
            if platform in ("grab", "all"):
                df_grab = df[df["Aplikasi"].str.contains("Grab", na=False, case=False) & df["Status"].str.contains("Live", na=False, case=False)]
                if not df_grab.empty:
                    outlets = sorted(df_grab["Nama Outlet"].dropna().unique())
                    print(f"\n  {BOLD}Pilih Outlet Grab:{RESET}")
                    for idx, o_name in enumerate(outlets):
                        print(f"    {GREEN}[{idx + 1}]{RESET} {o_name}")
                    print()
                    while True:
                        try:
                            o_choice = int(input(f"  {BOLD}Pilih nomor outlet Grab (1-{len(outlets)}):{RESET} ").strip())
                            if 1 <= o_choice <= len(outlets):
                                outlet = outlets[o_choice - 1]
                                break
                        except ValueError: pass
                        print(f"  {RED}Pilihan tidak valid.{RESET}")

                    df_branch = df_grab[df_grab["Nama Outlet"] == outlet]
                    branches = sorted(df_branch["Cabang"].dropna().unique())
                    print(f"\n  {BOLD}Pilih Cabang Grab untuk '{outlet}':{RESET}")
                    for idx, b_name in enumerate(branches):
                        print(f"    {GREEN}[{idx + 1}]{RESET} {b_name}")
                    print()
                    while True:
                        try:
                            b_choice = int(input(f"  {BOLD}Pilih nomor cabang Grab (1-{len(branches)}):{RESET} ").strip())
                            if 1 <= b_choice <= len(branches):
                                branch = branches[b_choice - 1]
                                break
                        except ValueError: pass
                        print(f"  {RED}Pilihan tidak valid.{RESET}")
                else:
                    print(f"  {RED}[ERROR] Tidak ada outlet Grab yang berstatus Live di Google Sheets.{RESET}")
                    sys.exit(1)

            # --- FILTER CUSTOM SHOPEE ---
            if platform in ("shopee", "all"):
                df_shopee = df[df["Aplikasi"].str.contains("Shopee", na=False, case=False) & df["Status"].str.contains("Live", na=False, case=False)]
                if not df_shopee.empty:
                    merchants = sorted(df_shopee["Merchant Name"].dropna().unique())
                    print(f"\n  {BOLD}Pilih Merchant ShopeeFood:{RESET}")
                    for idx, m_name in enumerate(merchants):
                        print(f"    {GREEN}[{idx + 1}]{RESET} {m_name}")
                    print()
                    while True:
                        try:
                            m_choice = int(input(f"  {BOLD}Pilih nomor merchant Shopee (1-{len(merchants)}):{RESET} ").strip())
                            if 1 <= m_choice <= len(merchants):
                                shopee_merchant = merchants[m_choice - 1]
                                break
                        except ValueError: pass
                        print(f"  {RED}Pilihan tidak valid.{RESET}")
                else:
                    print(f"  {RED}[ERROR] Tidak ada merchant Shopee yang berstatus Live di Google Sheets.{RESET}")
                    sys.exit(1)

            # --- FILTER CUSTOM GOFOOD ---
            if platform in ("gofood", "all"):
                df_gofood = df[df["Aplikasi"].str.contains("GoFood", na=False, case=False) & df["Status"].str.contains("Live", na=False, case=False)]
                if not df_gofood.empty:
                    gofood_outlets = sorted(df_gofood["Nama Outlet"].dropna().unique())
                    print(f"\n  {BOLD}Pilih Outlet GoFood:{RESET}")
                    for idx, o_name in enumerate(gofood_outlets):
                        print(f"    {GREEN}[{idx + 1}]{RESET} {o_name}")
                    print()
                    while True:
                        try:
                            o_choice = int(input(f"  {BOLD}Pilih nomor outlet GoFood (1-{len(gofood_outlets)}):{RESET} ").strip())
                            if 1 <= o_choice <= len(gofood_outlets):
                                outlet = gofood_outlets[o_choice - 1]
                                break
                        except ValueError: pass
                        print(f"  {RED}Pilihan tidak valid.{RESET}")
                else:
                    print(f"  {RED}[ERROR] Tidak ada outlet GoFood yang berstatus Live di Google Sheets.{RESET}")
                    sys.exit(1)

    # ─ Date input ─
    print()
    
    # Default: last 7 days
    default_end = datetime.now().strftime("%Y-%m-%d")
    default_start = (datetime.now() - timedelta(days=6)).strftime("%Y-%m-%d")

    print(f"  {DIM}Default: {default_start} s/d {default_end} (7 hari terakhir){RESET}")
    print()

    start_input = input(f"  {BOLD}Start date (YYYY-MM-DD){RESET} [{default_start}]: ").strip()
    end_input   = input(f"  {BOLD}End date   (YYYY-MM-DD){RESET} [{default_end}]: ").strip()

    start_date = start_input or default_start
    end_date   = end_input or default_end

    # Validate dates
    try:
        s = datetime.strptime(start_date, "%Y-%m-%d")
        e = datetime.strptime(end_date, "%Y-%m-%d")
        if s > e:
            print(f"\n  {RED}[ERROR] Start date harus sebelum atau sama dengan end date.{RESET}")
            sys.exit(1)
    except ValueError as err:
        print(f"\n  {RED}[ERROR] Format tanggal tidak valid: {err}{RESET}")
        sys.exit(1)

    # ─ Confirmation ─
    platform_label = {"grab": "Grab", "shopee": "Shopee", "gofood": "GoFood", "all": "Semua Platform (Grab + Shopee + GoFood)"}[platform]
    date_folder = f"{start_date}_to_{end_date}"
    
    print(f"\n  {CYAN}{'─'*50}{RESET}")
    print(f"  Platform : {BOLD}{platform_label}{RESET}")
    if scope_choice == "2":
        if outlet:
            print(f"  Grab Outlet : {BOLD}{outlet} ({branch}){RESET}")
        if shopee_merchant:
            print(f"  Shopee Merchant : {BOLD}{shopee_merchant}{RESET}")
    else:
        print(f"  Outlet   : {BOLD}Semua Outlet{RESET}")
    print(f"  Start    : {BOLD}{start_date}{RESET}")
    print(f"  End      : {BOLD}{end_date}{RESET}")
    print(f"  Output   : {DIM}laporan/{{platform}}/{date_folder}/{RESET}")
    print(f"  {CYAN}{'─'*50}{RESET}")
    
    confirm = input(f"\n  {BOLD}Lanjutkan? (Y/n):{RESET} ").strip().lower()
    if confirm in ("n", "no"):
        print(f"\n  {YELLOW}Dibatalkan.{RESET}")
        sys.exit(0)

    return task_choice, platform, start_date, end_date, outlet, branch, shopee_merchant


# ── Discord Webhook Notifier ───────────────────────────────────────────

def _notify_discord_pdf(outlet, start_date, end_date, aplikator,
                        pdf_url, pdf_name, omzet_gr, omzet_sf,
                        order_gr, order_sf, omzet_go="Rp 0", order_go="0"):
    """
    Kirim embed notifikasi PDF ke Discord channel via webhook.
    Hanya aktif ketika OFD_DISCORD_MODE=1 dan OFD_WEBHOOK_URL tersedia.
    Saat dijalankan manual, fungsi ini tidak melakukan apa-apa.
    """
    webhook_url = os.environ.get("OFD_WEBHOOK_URL", "")
    if not webhook_url:
        return  # mode manual — skip

    try:
        import requests as _req

        omzet_lines = []
        order_lines = []
        lower_app = aplikator.lower()
        if "go" in lower_app or "all" in lower_app:
            omzet_lines.append(f"GoFood: **{omzet_go}**")
            order_lines.append(f"GoFood: **{order_go}**")
        if "grab" in lower_app or "all" in lower_app:
            omzet_lines.append(f"GrabFood: **{omzet_gr}**")
            order_lines.append(f"GrabFood: **{order_gr}**")
        if "shopee" in lower_app or "all" in lower_app:
            omzet_lines.append(f"ShopeeFood: **{omzet_sf}**")
            order_lines.append(f"ShopeeFood: **{order_sf}**")
            
        omzet_str = "\n".join(omzet_lines) if omzet_lines else "-"
        order_str = "\n".join(order_lines) if order_lines else "-"

        embed = {
            "title"      : "📄 Laporan Baseline Selesai!",
            "description": (
                f"Laporan untuk **{outlet}** telah berhasil dibuat dan siap diunduh.\n\n"
                f"🔗 **[Klik di sini untuk membuka PDF]({pdf_url})**"
            ),
            "color"      : 0x00C853,  # hijau
            "fields"     : [
                {"name": "📍 Outlet",          "value": outlet,                              "inline": True},
                {"name": "📱 Aplikator",        "value": aplikator,                           "inline": True},
                {"name": "📅 Rentang Tanggal",  "value": f"`{start_date}` → `{end_date}`",   "inline": False},
                {"name": "📊 Rata-rata Omzet",  "value": omzet_str,                           "inline": True},
                {"name": "🛒 Rata-rata Order",  "value": order_str,                           "inline": True},
                {"name": "📁 Nama File",        "value": f"`{pdf_name}`",                    "inline": False},
            ],
            "footer"     : {"text": "Sistem Rekap Laporan Otomatis • OFD Report"},
            "timestamp"  : datetime.now().isoformat(),
        }

        payload = {"embeds": [embed]}
        resp = _req.post(webhook_url, json=payload, timeout=15)
        if resp.status_code in (200, 204):
            print(f"  {GREEN}✓ Notifikasi PDF berhasil dikirim ke Discord channel.{RESET}")
        else:
            print(f"  {YELLOW}⚠ Discord webhook response: {resp.status_code}{RESET}")
    except Exception as exc:
        print(f"  {YELLOW}⚠ Gagal kirim notifikasi Discord: {exc}{RESET}")


# ── Main ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Unified Weekly OFD Transaction Pipeline — Grab & Shopee",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python cli.py                                    # Interactive mode
  python cli.py grab  --start 2026-05-05 --end 2026-05-11
  python cli.py shopee --start 2026-05-05 --end 2026-05-11
  python cli.py all   --start 2026-05-05 --end 2026-05-11
        """,
    )
    parser.add_argument(
        "platform",
        nargs="?",
        type=lambda x: x.lower(),
        default=None,
        help="Platform to run: grab, shopee, gofood, all",
    )
    parser.add_argument("--start", type=str, default=None, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end",   type=str, default=None, help="End date (YYYY-MM-DD)")
    parser.add_argument("--user",  type=str, default=None, help="Filter specific username (Grab only)")
    parser.add_argument("--task",  type=str, choices=["1", "2"], default=None, help="Task type: 1 for Baseline, 2 for Weekly")
    parser.add_argument("--outlet", type=str, default=None, help="Filter specific outlet name")
    parser.add_argument("--branch", type=str, default=None, help="Filter specific branch name")

    args = parser.parse_args()

    # ── Discord Bridge Mode ─────────────────────────────────────────────
    # Dipanggil dari bridge/run_pipeline.js — bypass interactive mode.
    # Ketika dijalankan manual dari terminal, blok ini diabaikan sepenuhnya.
    if os.environ.get("OFD_DISCORD_MODE") == "1":
        task_choice     = os.environ.get("OFD_TASK_CHOICE", "2")
        platform        = os.environ.get("OFD_PLATFORM", args.platform or "all")
        start_date      = args.start or os.environ.get("OFD_START", "")
        end_date        = args.end   or os.environ.get("OFD_END", "")
        outlet          = os.environ.get("OFD_OUTLET") or None
        branch          = os.environ.get("OFD_CABANG") or None
        # Lookup Merchant Name Shopee dari GSheets berdasarkan Nama Outlet
        # Ini mengatasi mismatch nama outlet (Discord) vs merchant name Shopee (GSheets)
        shopee_merchant = _resolve_shopee_merchant(outlet, branch_name=branch) if outlet else None
        print(f"\n{CYAN}[DISCORD MODE] Task={task_choice} | Platform={platform} | Outlet={outlet} | Cabang={branch}{RESET}")
        banner()
    # ── Normal CLI Mode ─────────────────────────────────────────────────
    elif args.platform is None or args.start is None or args.end is None:
        task_choice, platform, start_date, end_date, outlet, branch, shopee_merchant = interactive_mode()
    else:
        task_choice = args.task or "2"
        platform   = args.platform.lower()
        start_date = args.start
        end_date   = args.end
        outlet     = args.outlet
        branch     = args.branch
        shopee_merchant = _resolve_shopee_merchant(outlet, branch_name=branch) if outlet else None
        banner()

    # ── Execute ──
    results = {}
    start_time = datetime.now()

    if "grab" in platform or platform == "all":
        if task_choice == "1":
            results["Grab"] = run_grab_baseline(start_date, end_date, user_filter=args.user, outlet_filter=outlet, branch_filter=branch)
        else:
            results["Grab"] = run_grab(start_date, end_date, user_filter=args.user, outlet_filter=outlet, branch_filter=branch)

    if "shopee" in platform or platform == "all":
        if task_choice == "1":
            results["Shopee"] = run_shopee_baseline(start_date, end_date, merchant_filter=shopee_merchant)
        else:
            results["Shopee"] = run_shopee(start_date, end_date, merchant_filter=shopee_merchant)

    if "gofood" in platform or platform == "all":
        results["GoFood"] = run_gofood(start_date, end_date, outlet_filter=outlet)

    # ── Summary ──
    elapsed = datetime.now() - start_time
    minutes = int(elapsed.total_seconds() // 60)
    seconds = int(elapsed.total_seconds() % 60)

    date_folder = f"{start_date}_to_{end_date}"
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    # ── Merge Baseline Outputs ──
    if task_choice == "1":
        print(f"\n{YELLOW}{BOLD}▶ PENGGABUNGAN LAPORAN BASELINE{RESET}")
        try:
            import pandas as pd
            frames = []
            
            outlet_safe = str(outlet or "").strip().replace(" ", "_").replace("/", "_").replace("\\", "_")
            
            # Find Grab Baseline output
            if "grab" in platform or platform == "all":
                # In run_baseline Grab, branches are appended. We check branch-specific file first, then fallback to empty branch file.
                grab_paths_to_check = []
                if branch:
                    branch_safe = str(branch).strip().replace(" ", "_").replace("/", "_").replace("\\", "_")
                    grab_paths_to_check.append(os.path.join(base_dir, "laporan", "grab_baseline", date_folder, f"BASELINE_CUSTOM_{outlet_safe}_{branch_safe}.xlsx"))
                grab_paths_to_check.append(os.path.join(base_dir, "laporan", "grab_baseline", date_folder, f"BASELINE_CUSTOM_{outlet_safe}_.xlsx"))
                
                # Fallback glob pattern for any BASELINE_CUSTOM_{outlet_safe}_*.xlsx
                import glob
                glob_pattern = os.path.join(base_dir, "laporan", "grab_baseline", date_folder, f"BASELINE_CUSTOM_{outlet_safe}_*.xlsx")
                for gp in glob.glob(glob_pattern):
                    if gp not in grab_paths_to_check:
                        grab_paths_to_check.append(gp)

                grab_path = None
                for p_check in grab_paths_to_check:
                    if os.path.exists(p_check):
                        grab_path = p_check
                        break
                        
                if grab_path:
                    print(f"  [INFO] Menemukan file Grab baseline: {grab_path}")
                    frames.append(pd.read_excel(grab_path))
                else:
                    print(f"  [INFO] File Grab baseline tidak ditemukan untuk: {outlet_safe}")
            
            # Find Shopee Baseline output
            if "shopee" in platform or platform == "all":
                shopee_paths_to_check = []
                shopee_safe = str(shopee_merchant or "").strip().replace(" ", "_").replace("/", "_").replace("\\", "_")
                shopee_paths_to_check.append(os.path.join(base_dir, "laporan", "shopee_baseline", date_folder, f"BASELINE_CUSTOM_{shopee_safe}.xlsx"))
                shopee_paths_to_check.append(os.path.join(base_dir, "laporan", "shopee_baseline", date_folder, f"BASELINE_CUSTOM_{shopee_safe}_.xlsx"))
                
                # Fallback glob pattern for any BASELINE_CUSTOM_{shopee_safe}*.xlsx
                import glob
                glob_pattern_sf = os.path.join(base_dir, "laporan", "shopee_baseline", date_folder, f"BASELINE_CUSTOM_{shopee_safe}*.xlsx")
                for gp in glob.glob(glob_pattern_sf):
                    if gp not in shopee_paths_to_check:
                        shopee_paths_to_check.append(gp)
                        
                shopee_path = None
                for p_check in shopee_paths_to_check:
                    if os.path.exists(p_check):
                        shopee_path = p_check
                        break
                        
                if shopee_path:
                    print(f"  [INFO] Menemukan file Shopee baseline: {shopee_path}")
                    frames.append(pd.read_excel(shopee_path))
                else:
                    print(f"  [INFO] File Shopee baseline tidak ditemukan untuk: {shopee_safe}")

            # Find GoFood Baseline output
            if "gofood" in platform or platform == "all":
                gofood_paths_to_check = []
                gofood_paths_to_check.append(os.path.join(base_dir, "goscrapperv2", "laporan_gofood", f"BASELINE_GOFOOD_{start_date}_to_{end_date}.xlsx"))
                
                gofood_path = None
                for p_check in gofood_paths_to_check:
                    if os.path.exists(p_check):
                        gofood_path = p_check
                        break
                        
                if gofood_path:
                    print(f"  [INFO] Menemukan file GoFood baseline: {gofood_path}")
                    frames.append(pd.read_excel(gofood_path))
                else:
                    print(f"  [INFO] File GoFood baseline tidak ditemukan untuk: {start_date} s/d {end_date}")
                
            if frames:
                combined_df = pd.concat(frames, ignore_index=True)
                final_baseline_dir = os.path.join(base_dir, "laporan", "baseline", date_folder)
                os.makedirs(final_baseline_dir, exist_ok=True)
                final_path = os.path.join(final_baseline_dir, f"BASELINE_GABUNGAN_{outlet_safe}.xlsx")
                
                with pd.ExcelWriter(final_path, engine="openpyxl") as writer:
                    combined_df.to_excel(writer, index=False, sheet_name="Baseline Summary")
                    
                print(f"  {GREEN}✓ File gabungan berhasil dibuat: {final_path}{RESET}")

                # ── Generate PDF via Webhook ──
                print(f"\n{YELLOW}{BOLD}▶ PEMBUATAN PDF BASELINE{RESET}")
                try:
                    import requests
                    import io
                    
                    # Hardcode URL Web App Anda di sini setelah di-deploy
                    webhook_url = "https://script.google.com/macros/s/AKfycbx8eXubEkNVX3gDDeC-1AOwjeYxL1dG7jjGm_UM2kj5-j92p9gttA87Mf4TJcwirIMR/exec"
                    if not webhook_url or "GANTI_DENGAN_URL_ANDA" in webhook_url:
                        print(f"  {YELLOW}⚠️ URL Webhook belum di-hardcode di cli.py.{RESET}")
                        print(f"  {DIM}Silakan deploy apps_script_pdf.js dan masukkan URL-nya ke variabel webhook_url di cli.py{RESET}")
                    else:
                        # 1. Fetch Owner from Credentials CSV
                        CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ3tLKBNXDqRgBw0mNhKZFxgvKx-JoiTDzm_s5Ix1cm7O6HCv4IvExOLR2HSRVaXSsx82V348mcr9X4/pub?gid=0&single=true&output=csv"
                        owner_name = "-"
                        try:
                            resp = requests.get(CSV_URL, timeout=10)
                            if resp.status_code == 200:
                                df_cred = pd.read_csv(io.StringIO(resp.text))
                                owner_row = df_cred[df_cred["Nama Outlet"].str.lower() == str(outlet).lower()].iloc[0]
                                owner_name = str(owner_row.get("Owner", "-"))
                        except Exception as e:
                            print(f"  {DIM}Gagal mengambil nama Owner: {e}{RESET}")

                        # 2. Extract metrics from combined DataFrame
                        omzet_go, order_go = 0.0, 0.0
                        omzet_gr, order_gr = 0.0, 0.0
                        omzet_sf, order_sf = 0.0, 0.0
                        
                        for _, row in combined_df.iterrows():
                            app = str(row.get("Aplikasi", "")).lower()
                            if "grab" in app:
                                omzet_gr += float(row.get("Rata-rata Omzet", 0))
                                order_gr += float(row.get("Rata-rata Order", 0))
                            elif "shopee" in app:
                                omzet_sf += float(row.get("Rata-rata Omzet", 0))
                                order_sf += float(row.get("Rata-rata Order", 0))
                            elif "go" in app:
                                omzet_go += float(row.get("Rata-rata Omzet", 0))
                                order_go += float(row.get("Rata-rata Order", 0))
                                
                        def format_rp(val):
                            return f"Rp {int(val):,}".replace(",", ".")
                            
                        indo_months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
                        now = datetime.now()
                        
                        payload = {
                            "action": "generate_baseline_pdf",
                            "tanggal": str(now.day),
                            "bulan": indo_months[now.month - 1],
                            "tahun": str(now.year),
                            "owner": owner_name,
                            "nama_outlet": str(outlet),
                            "omzet_go": format_rp(omzet_go),
                            "order_go": str(round(order_go, 1)),
                            "omzet_gr": format_rp(omzet_gr),
                            "order_gr": str(round(order_gr, 1)),
                            "omzet_sf": format_rp(omzet_sf),
                            "order_sf": str(round(order_sf, 1))
                        }
                        
                        print(f"  {CYAN}[INFO] Mengirim data agregasi ke Google Apps Script...{RESET}")
                        res = requests.post(webhook_url, json=payload, timeout=30)
                        if res.status_code == 200:
                            data = res.json()
                            if data.get("success"):
                                pdf_url = data.get('pdf_url', '')
                                print(f"  {GREEN}✓ PDF berhasil dibuat!{RESET}")
                                print(f"  {GREEN}  URL: {pdf_url}{RESET}")
                                # ── Kirim notifikasi PDF ke Discord channel ──
                                _notify_discord_pdf(
                                    outlet=str(outlet),
                                    start_date=start_date,
                                    end_date=end_date,
                                    aplikator=os.environ.get("OFD_APLIKATOR", "Grab + Shopee"),
                                    pdf_url=pdf_url,
                                    pdf_name=data.get('pdf_name', 'Baseline Report'),
                                    omzet_gr=format_rp(omzet_gr),
                                    omzet_sf=format_rp(omzet_sf),
                                    order_gr=str(round(order_gr, 1)),
                                    order_sf=str(round(order_sf, 1)),
                                    omzet_go=format_rp(omzet_go),
                                    order_go=str(round(order_go, 1)),
                                )
                            else:
                                print(f"  {RED}✗ Gagal membuat PDF: {data.get('error')}{RESET}")
                        else:
                            print(f"  {RED}✗ Error HTTP {res.status_code} saat menghubungi Webhook{RESET}")
                except Exception as e:
                    print(f"  {RED}✗ Terjadi kesalahan saat memproses Webhook PDF: {e}{RESET}")
            else:
                print(f"  {RED}✗ Tidak ditemukan file baseline untuk digabung.{RESET}")
        except Exception as e:
            print(f"  {RED}✗ Gagal menggabungkan laporan: {e}{RESET}")

    print(f"\n{CYAN}{BOLD}{'═'*58}{RESET}")
    print(f"{CYAN}{BOLD}  SUMMARY{RESET}")
    print(f"{CYAN}{BOLD}{'═'*58}{RESET}")
    print(f"  Date Range : {start_date} → {end_date}")
    print(f"  Duration   : {minutes}m {seconds}s")
    print()
    for name, success in results.items():
        status = f"{GREEN}✓ SUCCESS{RESET}" if success else f"{RED}✗ FAILED{RESET}"
        out_path = os.path.join(base_dir, "laporan", name.lower() + ("_baseline" if task_choice == "1" else ""), date_folder)
        print(f"  {name:10s} : {status}")
        print(f"  {'':10s}   {DIM}→ {out_path}{RESET}")
    print(f"\n{CYAN}{'═'*58}{RESET}\n")


if __name__ == "__main__":
    main()
