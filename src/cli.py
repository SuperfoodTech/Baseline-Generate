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


# ── Interactive Mode ──────────────────────────────────────────────────

def interactive_mode():
    """Let the user pick platform & dates interactively."""
    # Clear screen to hide dependency check details
    os.system('cls' if os.name == 'nt' else 'clear')
    banner()

    # ─ Platform selection ─
    print(f"  {BOLD}Pilih platform:{RESET}")
    print(f"    {GREEN}[1]{RESET} Grab")
    print(f"    {MAGENTA}[2]{RESET} Shopee")
    print(f"    {CYAN}[3]{RESET} Keduanya (Grab + Shopee)")
    print()

    while True:
        choice = input(f"  {BOLD}Pilihan (1/2/3):{RESET} ").strip()
        if choice in ("1", "2", "3"):
            break
        print(f"  {RED}Input tidak valid. Masukkan 1, 2, atau 3.{RESET}")

    platform_map = {"1": "grab", "2": "shopee", "3": "all"}
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
    platform_label = {"grab": "Grab", "shopee": "Shopee", "all": "Grab + Shopee"}[platform]
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

    return platform, start_date, end_date, outlet, branch, shopee_merchant


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
        choices=["grab", "shopee", "all"],
        default=None,
        help="Platform to run: grab, shopee, or all",
    )
    parser.add_argument("--start", type=str, default=None, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end",   type=str, default=None, help="End date (YYYY-MM-DD)")
    parser.add_argument("--user",  type=str, default=None, help="Filter specific username (Grab only)")

    args = parser.parse_args()

    # If no platform provided or dates missing → interactive
    if args.platform is None or args.start is None or args.end is None:
        platform, start_date, end_date, outlet, branch, shopee_merchant = interactive_mode()
    else:
        platform   = args.platform.lower()
        start_date = args.start
        end_date   = args.end
        outlet     = None
        branch     = None
        shopee_merchant = None
        banner()

    # ── Execute ──
    results = {}
    start_time = datetime.now()

    if platform in ("grab", "all"):
        results["Grab"] = run_grab(start_date, end_date, user_filter=args.user, outlet_filter=outlet, branch_filter=branch)

    if platform in ("shopee", "all"):
        results["Shopee"] = run_shopee(start_date, end_date, merchant_filter=shopee_merchant)

    # ── Summary ──
    elapsed = datetime.now() - start_time
    minutes = int(elapsed.total_seconds() // 60)
    seconds = int(elapsed.total_seconds() % 60)

    date_folder = f"{start_date}_to_{end_date}"
    base_dir = os.path.dirname(os.path.abspath(__file__))

    print(f"\n{CYAN}{BOLD}{'═'*58}{RESET}")
    print(f"{CYAN}{BOLD}  SUMMARY{RESET}")
    print(f"{CYAN}{BOLD}{'═'*58}{RESET}")
    print(f"  Date Range : {start_date} → {end_date}")
    print(f"  Duration   : {minutes}m {seconds}s")
    print()
    for name, success in results.items():
        status = f"{GREEN}✓ SUCCESS{RESET}" if success else f"{RED}✗ FAILED{RESET}"
        out_path = os.path.join(base_dir, "laporan", name.lower(), date_folder)
        print(f"  {name:10s} : {status}")
        print(f"  {'':10s}   {DIM}→ {out_path}{RESET}")
    print(f"\n{CYAN}{'═'*58}{RESET}\n")


if __name__ == "__main__":
    main()
