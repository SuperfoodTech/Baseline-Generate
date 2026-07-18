#!/usr/bin/env python3
"""
=================================================================
  SUPERFOOD TECH — Unified Menu & Modifier Extractor Pipeline
  Interactive CLI for Shopee, Grab & GoFood
=================================================================
"""

import os
import sys
import time
import re
from datetime import datetime

# Add parent directory of menu_core to sys.path so imports work
MENU_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, MENU_DIR)

def get_output_dir(applicator, clean_outlet):
    app_dir = "Gofood" if applicator == "gofood" else ("grab" if applicator == "grab" else "shopee")
    return os.path.join(MENU_DIR, app_dir, "outlets", clean_outlet)

from menu_core.sheets import get_outlets_for_applicator
from menu_core.shopee import extract_shopee_menu
from menu_core.grab import extract_grab_menu
from menu_core.gofood import extract_gofood_menu

RESET   = "\033[0m"
BOLD    = "\033[1m"
GREEN   = "\033[92m"
CYAN    = "\033[96m"
YELLOW  = "\033[93m"
RED     = "\033[91m"
MAGENTA = "\033[95m"
DIM     = "\033[2m"

def banner():
    print(f"\033[90m=================================================================\033[0m")
    print(f"  {BOLD}{CYAN}      SUPERFOOD TECH — MENU & MODIFIER EXTRACTOR PIPELINE{RESET}")
    print(f"\033[90m=================================================================\033[0m")
    print()

def interactive_menu():
    state = "applicator"
    applicator = None
    outlets = []
    selected_outlet = None
    
    while True:
        if state == "applicator":
            os.system('cls' if os.name == 'nt' else 'clear')
            banner()
            print(f"  {BOLD}Pilih Aplikator/Platform:{RESET}")
            print(f"    {MAGENTA}[1]{RESET} ShopeeFood")
            print(f"    {GREEN}[2]{RESET} GrabFood")
            print(f"    {CYAN}[3]{RESET} GoFood")
            print(f"    {YELLOW}[4]{RESET} Keluar")
            print()
            
            choice = input(f"  {BOLD}Pilihan (1/2/3/4):{RESET} ").strip()
            if choice == "4":
                print("  Keluar.")
                sys.exit(0)
            elif choice == "1":
                applicator = "shopee"
                state = "load_outlets"
            elif choice == "2":
                applicator = "grab"
                state = "load_outlets"
            elif choice == "3":
                applicator = "gofood"
                state = "load_outlets"
            else:
                print(f"  {RED}Pilihan tidak valid.{RESET}")
                time.sleep(1)
                
        elif state == "load_outlets":
            print(f"\n  [*] Mengunduh & memuat daftar outlet untuk {applicator.upper()}...")
            try:
                outlets = get_outlets_for_applicator(applicator)
                if not outlets:
                    print(f"  {RED}[ERROR] Tidak ada outlet live yang ditemukan untuk {applicator.upper()}.{RESET}")
                    time.sleep(2)
                    state = "applicator"
                else:
                    state = "select_outlet"
            except Exception as e:
                print(f"  {RED}[ERROR] Gagal memuat daftar outlet: {e}{RESET}")
                time.sleep(3)
                state = "applicator"
                
        elif state == "select_outlet":
            os.system('cls' if os.name == 'nt' else 'clear')
            banner()
            
            # Get unique Nama Outlet (nama_outlet) values
            unique_outlets = sorted(list(set(o['nama_outlet'] for o in outlets if o['nama_outlet'])))
            
            print(f"  {BOLD}Pilih Nama Outlet {applicator.upper()}:{RESET}")
            print(f"    {GREEN}[all]{RESET} Jalankan semua outlet dan cabang")
            print(f"    {GREEN}[new]{RESET} Jalankan HANYA outlet/cabang yang belum ditarik")
            for idx, name in enumerate(unique_outlets):
                print(f"    {GREEN}[{idx + 1:3d}]{RESET} {name}")
                
            print(f"    {YELLOW}[b  ]{RESET} Kembali ke pemilihan aplikator")
            print()
            
            choice = input(f"  {BOLD}Pilih nomor outlet (atau 'all'/'new'/'b'):{RESET} ").strip()
            if choice.lower() == 'b':
                state = "applicator"
            elif choice.lower() == 'all':
                selected_outlet = outlets
                state = "confirm_all"
            elif choice.lower() == 'new':
                # Filter outlets to keep only those that have not been run
                filtered_outlets = []
                for o in outlets:
                    raw_outlet = o.get('nama_outlet') or o.get('nama_resto_final') or o.get('merchant_name') or 'unknown'
                    clean_outlet = "".join(c for c in raw_outlet if c.isalnum() or c in (' ', '_', '-')).strip()
                    clean_outlet = re.sub(r'\s+', ' ', clean_outlet).lower()
                    
                    output_dir = get_output_dir(applicator, clean_outlet)
                    
                    is_processed = False
                    if os.path.exists(output_dir):
                        files = os.listdir(output_dir)
                        has_files = any(f.endswith('.csv') or f.endswith('.xlsx') for f in files)
                        if len(files) > 0 and has_files:
                            is_processed = True
                            
                    if not is_processed:
                        filtered_outlets.append(o)
                
                if not filtered_outlets:
                    print(f"\n  {GREEN}Semua outlet sudah berhasil ditarik sebelumnya!{RESET}")
                    time.sleep(3)
                else:
                    selected_outlet = filtered_outlets
                    state = "confirm_all"
            else:
                try:
                    idx = int(choice) - 1
                    if 0 <= idx < len(unique_outlets):
                        target_parent = unique_outlets[idx]
                        # Find all branches under this parent
                        matching_branches = [o for o in outlets if o['nama_outlet'] == target_parent]
                        
                        if len(matching_branches) == 1:
                            selected_outlet = matching_branches[0]
                            state = "confirm"
                        else:
                            parent_name = target_parent
                            branches = matching_branches
                            state = "select_branch"
                    else:
                        print(f"  {RED}Nomor outlet di luar jangkauan.{RESET}")
                        time.sleep(1)
                except ValueError:
                    print(f"  {RED}Pilihan tidak valid.{RESET}")
                    time.sleep(1)
                    
        elif state == "select_branch":
            os.system('cls' if os.name == 'nt' else 'clear')
            banner()
            print(f"  {BOLD}Pilih Cabang untuk '{parent_name}':{RESET}")
            print(f"    {GREEN}[all]{RESET} Jalankan semua cabang untuk outlet ini")
            print(f"    {GREEN}[new]{RESET} Jalankan HANYA cabang yang belum ditarik")
            
            for idx, b in enumerate(branches):
                branch_name = b['brand'] or b['nama_resto_final'] or b['merchant_name']
                print(f"    {GREEN}[{idx + 1:3d}]{RESET} {branch_name} (ID: {b['store_id']})")
                
            print(f"    {YELLOW}[b  ]{RESET} Kembali ke pemilihan outlet")
            print()
            
            choice = input(f"  {BOLD}Pilih nomor cabang (atau 'all'/'new'/'b'):{RESET} ").strip()
            if choice.lower() == 'b':
                state = "select_outlet"
            elif choice.lower() == 'all':
                selected_outlet = branches
                state = "confirm_all"
            elif choice.lower() == 'new':
                # Filter branches to keep only those that have not been run
                filtered_branches = []
                for o in branches:
                    raw_outlet = o.get('nama_outlet') or o.get('nama_resto_final') or o.get('merchant_name') or 'unknown'
                    clean_outlet = "".join(c for c in raw_outlet if c.isalnum() or c in (' ', '_', '-')).strip()
                    clean_outlet = re.sub(r'\s+', ' ', clean_outlet).lower()
                    
                    output_dir = get_output_dir(applicator, clean_outlet)
                    
                    is_processed = False
                    if os.path.exists(output_dir):
                        files = os.listdir(output_dir)
                        has_files = any(f.endswith('.csv') or f.endswith('.xlsx') for f in files)
                        if len(files) > 0 and has_files:
                            is_processed = True
                            
                    if not is_processed:
                        filtered_branches.append(o)
                
                if not filtered_branches:
                    print(f"\n  {GREEN}Semua cabang untuk outlet ini sudah berhasil ditarik sebelumnya!{RESET}")
                    time.sleep(3)
                else:
                    selected_outlet = filtered_branches
                    state = "confirm_all"
            else:
                try:
                    idx = int(choice) - 1
                    if 0 <= idx < len(branches):
                        selected_outlet = branches[idx]
                        state = "confirm"
                    else:
                        print(f"  {RED}Nomor cabang di luar jangkauan.{RESET}")
                        time.sleep(1)
                except ValueError:
                    print(f"  {RED}Pilihan tidak valid.{RESET}")
                    time.sleep(1)
                    
        elif state == "confirm":
            os.system('cls' if os.name == 'nt' else 'clear')
            banner()
            print(f"  {CYAN}{'─'*60}{RESET}")
            print(f"  Aplikator : {BOLD}{applicator.upper()}{RESET}")
            name_to_show = selected_outlet['brand'] or selected_outlet['nama_resto_final'] or selected_outlet['nama_outlet']
            print(f"  Outlet    : {BOLD}{name_to_show}{RESET}")
            print(f"  Store ID  : {BOLD}{selected_outlet['store_id']}{RESET}")
            print(f"  {CYAN}{'─'*60}{RESET}")
            print()
            print(f"  {BOLD}Konfirmasi tindakan:{RESET}")
            print(f"    {GREEN}[1]{RESET} Lanjutkan Tarik Menu")
            print(f"    {YELLOW}[2]{RESET} Kembali ke daftar outlet")
            print(f"    {RED}[3]{RESET} Batal dan Keluar")
            print()
            
            choice = input(f"  {BOLD}Pilihan (1/2/3):{RESET} ").strip()
            if choice == "1":
                break
            elif choice == "2":
                state = "select_outlet"
            elif choice == "3":
                print("  Dibatalkan.")
                sys.exit(0)
            else:
                print(f"  {RED}Pilihan tidak valid.{RESET}")
                time.sleep(1)
                
        elif state == "confirm_all":
            os.system('cls' if os.name == 'nt' else 'clear')
            banner()
            
            # Count unprocessed outlets
            unprocessed_count = 0
            for o in selected_outlet:
                raw_outlet = o.get('nama_outlet') or o.get('nama_resto_final') or o.get('merchant_name') or 'unknown'
                clean_outlet = "".join(c for c in raw_outlet if c.isalnum() or c in (' ', '_', '-')).strip()
                clean_outlet = re.sub(r'\s+', ' ', clean_outlet).lower()
                
                output_dir = get_output_dir(applicator, clean_outlet)
                
                is_processed = False
                if os.path.exists(output_dir):
                    files = os.listdir(output_dir)
                    has_files = any(f.endswith('.csv') or f.endswith('.xlsx') for f in files)
                    if len(files) > 0 and has_files:
                        is_processed = True
                if not is_processed:
                    unprocessed_count += 1
            
            print(f"  {CYAN}{'─'*60}{RESET}")
            print(f"  Aplikator : {BOLD}{applicator.upper()}{RESET}")
            print(f"  Mode      : {BOLD}{YELLOW}BATCH RUN (Massal){RESET}")
            print(f"  Total     : {BOLD}{len(selected_outlet)} outlet/cabang{RESET}")
            print(f"  Belum Run : {BOLD}{GREEN}{unprocessed_count} outlet/cabang{RESET}")
            print(f"  Sudah Run : {BOLD}{len(selected_outlet) - unprocessed_count} outlet/cabang (Skipped jika pilih [2]){RESET}")
            print(f"  Jeda      : {BOLD}Setiap 10 outlet akan dijeda 1 menit{RESET}")
            print(f"  {CYAN}{'─'*60}{RESET}")
            print()
            print(f"  {BOLD}Konfirmasi tindakan:{RESET}")
            print(f"    {GREEN}[1]{RESET} Lanjutkan Jalankan SEMUA (Overwrite)")
            print(f"    {GREEN}[2]{RESET} Lanjutkan Jalankan HANYA yang Belum Selesai ({unprocessed_count} outlet)")
            print(f"    {YELLOW}[3]{RESET} Kembali ke daftar outlet")
            print(f"    {RED}[4]{RESET} Batal dan Keluar")
            print()
            
            choice = input(f"  {BOLD}Pilihan (1/2/3/4):{RESET} ").strip()
            if choice == "1":
                break
            elif choice == "2":
                filtered_outlets = []
                for o in selected_outlet:
                    raw_outlet = o.get('nama_outlet') or o.get('nama_resto_final') or o.get('merchant_name') or 'unknown'
                    clean_outlet = "".join(c for c in raw_outlet if c.isalnum() or c in (' ', '_', '-')).strip()
                    clean_outlet = re.sub(r'\s+', ' ', clean_outlet).lower()
                    
                    output_dir = get_output_dir(applicator, clean_outlet)
                    
                    is_processed = False
                    if os.path.exists(output_dir):
                        files = os.listdir(output_dir)
                        has_files = any(f.endswith('.csv') or f.endswith('.xlsx') for f in files)
                        if len(files) > 0 and has_files:
                            is_processed = True
                            
                    if not is_processed:
                        filtered_outlets.append(o)
                
                if not filtered_outlets:
                    print(f"\n  {GREEN}Semua outlet dalam batch ini sudah berhasil ditarik sebelumnya!{RESET}")
                    time.sleep(3)
                    state = "select_outlet"
                else:
                    selected_outlet = filtered_outlets
                    break
            elif choice == "3":
                state = "select_outlet"
            elif choice == "4":
                print("  Dibatalkan.")
                sys.exit(0)
            else:
                print(f"  {RED}Pilihan tidak valid.{RESET}")
                time.sleep(1)
                
    return applicator, selected_outlet

def main():
    if os.environ.get("MENU_DISCORD_MODE") == "1":
        # Discord mode bypass
        target_app = os.environ.get("MENU_APLIKATOR", "shopee").lower()
        store_choice = os.environ.get("MENU_STORE_CHOICE", "all").lower()
        overwrite = os.environ.get("MENU_OVERWRITE") == "1"

        apps = ["shopee", "grab", "gofood"] if target_app == "all" else [target_app]

        for app in apps:
            print(f"\n{CYAN}=== MEMULAI EKSEKUSI DISCORD UNTUK PLATFORM: {app.upper()} ==={RESET}")
            try:
                outlets = get_outlets_for_applicator(app)
            except Exception as e:
                print(f"  {RED}[ERROR] Gagal memuat daftar outlet untuk {app.upper()}: {e}{RESET}")
                continue

            if not outlets:
                print(f"  {YELLOW}[WARN] Tidak ada outlet ditemukan untuk {app.upper()}{RESET}")
                continue

            # Resolve target outlet
            if store_choice == "all":
                target_outlets = outlets
            elif store_choice == "new":
                # Filter outlets to keep only those that have not been run (unless overwrite is true)
                filtered_outlets = []
                for o in outlets:
                    raw_outlet = o.get('nama_outlet') or o.get('nama_resto_final') or o.get('merchant_name') or 'unknown'
                    clean_outlet = "".join(c for c in raw_outlet if c.isalnum() or c in (' ', '_', '-')).strip()
                    clean_outlet = re.sub(r'\s+', ' ', clean_outlet).lower()
                    
                    output_dir = get_output_dir(app, clean_outlet)
                    
                    is_processed = False
                    if not overwrite and os.path.exists(output_dir):
                        files = os.listdir(output_dir)
                        has_files = any(f.endswith('.csv') or f.endswith('.xlsx') for f in files)
                        if len(files) > 0 and has_files:
                            is_processed = True
                    if not is_processed:
                        filtered_outlets.append(o)
                target_outlets = filtered_outlets
            else:
                # specific Store ID or comma-separated Store IDs
                selected_ids = [x.strip() for x in store_choice.split(',') if x.strip()]
                target_outlets = [o for o in outlets if o['store_id'] in selected_ids]

            if not target_outlets:
                print(f"  {GREEN}Tidak ada outlet yang perlu diproses.{RESET}")
                continue

            # Run execution for target_outlets
            total_outlets = len(target_outlets)
            success_count = 0
            fail_count = 0

            for idx, o in enumerate(target_outlets):
                raw_outlet = o.get('nama_outlet') or o.get('nama_resto_final') or o.get('merchant_name') or 'unknown'
                clean_outlet = "".join(c for c in raw_outlet if c.isalnum() or c in (' ', '_', '-')).strip()
                clean_outlet = re.sub(r'\s+', ' ', clean_outlet).lower()
                
                output_dir = get_output_dir(app, clean_outlet)
                os.makedirs(output_dir, exist_ok=True)
                
                name_to_show = o['brand'] or o['nama_resto_final'] or o['nama_outlet']
                print(f"\n{BOLD}[{idx + 1}/{total_outlets}] Memproses: {name_to_show} (ID: {o['store_id']}){RESET}")
                
                success = False
                result_data = None
                
                try:
                    if app == "shopee":
                        success, result_data = extract_shopee_menu(o, output_dir)
                    elif app == "grab":
                        success, result_data = extract_grab_menu(o, output_dir)
                    elif app == "gofood":
                        success, result_data = extract_gofood_menu(o, output_dir)
                except Exception as e:
                    success = False
                    result_data = f"Exception occurred: {e}"
                    
                if success and isinstance(result_data, dict):
                    success_count += 1
                    print(f"  {GREEN}✔ Berhasil! {result_data.get('items_count', 0)} item, {result_data.get('mods_count', 0)} modifier.{RESET}")
                else:
                    fail_count += 1
                    print(f"  {RED}✘ Gagal: {result_data}{RESET}")
                    
                if (idx + 1) < total_outlets and (idx + 1) % 10 == 0:
                    print(f"\n{YELLOW}[BATCH] Selesai memproses 10 outlet. Menunggu jeda 1 menit...{RESET}")
                    time.sleep(60)

            print(f"\n{CYAN}=== SELESAI PLATFORM: {app.upper()} ==={RESET}")
            print(f"  - Sukses : {GREEN}{success_count}{RESET}")
            print(f"  - Gagal  : {RED}{fail_count}{RESET}")
        return

    try:
        applicator, outlet = interactive_menu()
    except KeyboardInterrupt:
        print("\n  Dibatalkan oleh pengguna.")
        sys.exit(0)

    if isinstance(outlet, list):
        total_outlets = len(outlet)
        print(f"\n{CYAN}=== MEMULAI PENARIKAN MENU MASSAL ({total_outlets} OUTLET) ==={RESET}")
        print(f"[*] Waktu mulai: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        success_count = 0
        fail_count = 0
        
        for idx, o in enumerate(outlet):
            raw_outlet = o.get('nama_outlet') or o.get('nama_resto_final') or o.get('merchant_name') or 'unknown'
            clean_outlet = "".join(c for c in raw_outlet if c.isalnum() or c in (' ', '_', '-')).strip()
            clean_outlet = re.sub(r'\s+', ' ', clean_outlet).lower()
            
            output_dir = get_output_dir(applicator, clean_outlet)
            os.makedirs(output_dir, exist_ok=True)
            
            name_to_show = o['brand'] or o['nama_resto_final'] or o['nama_outlet']
            print(f"\n{BOLD}[{idx + 1}/{total_outlets}] Memproses: {name_to_show} (ID: {o['store_id']}){RESET}")
            
            success = False
            result_data = None
            
            try:
                if applicator == "shopee":
                    success, result_data = extract_shopee_menu(o, output_dir)
                elif applicator == "grab":
                    success, result_data = extract_grab_menu(o, output_dir)
                elif applicator == "gofood":
                    success, result_data = extract_gofood_menu(o, output_dir)
            except Exception as e:
                success = False
                result_data = f"Exception occurred: {e}"
                
            if success and isinstance(result_data, dict):
                success_count += 1
                print(f"  {GREEN}✔ Berhasil! {result_data.get('items_count', 0)} item, {result_data.get('mods_count', 0)} modifier.{RESET}")
            else:
                fail_count += 1
                print(f"  {RED}✘ Gagal: {result_data}{RESET}")
                
            # Delay logic: 1 minute pause after every 10 outlets
            if (idx + 1) < total_outlets and (idx + 1) % 10 == 0:
                print(f"\n{YELLOW}[BATCH] Selesai memproses 10 outlet. Menunggu jeda 1 menit sebelum batch berikutnya...{RESET}")
                for remaining in range(60, 0, -1):
                    sys.stdout.write(f"\rMenunggu... {remaining} detik")
                    sys.stdout.flush()
                    time.sleep(1)
                print(f"\r{GREEN}[BATCH] Jeda selesai. Melanjutkan penarikan...{RESET}\n")
                
        print(f"\n{CYAN}=== PENARIKAN MENU MASSAL SELESAI ==={RESET}")
        print(f"  - Sukses : {GREEN}{success_count}{RESET}")
        print(f"  - Gagal  : {RED}{fail_count}{RESET}")
        
    else:
        print(f"\n{CYAN}=== MEMULAI PENARIKAN MENU ==={RESET}")
        print(f"[*] Waktu mulai: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        raw_outlet = outlet.get('nama_outlet') or outlet.get('nama_resto_final') or outlet.get('merchant_name') or 'unknown'
        clean_outlet = "".join(c for c in raw_outlet if c.isalnum() or c in (' ', '_', '-')).strip()
        clean_outlet = re.sub(r'\s+', ' ', clean_outlet).lower()
        
        output_dir = get_output_dir(applicator, clean_outlet)
        os.makedirs(output_dir, exist_ok=True)
        
        success = False
        result_data = None
        
        if applicator == "shopee":
            success, result_data = extract_shopee_menu(outlet, output_dir)
        elif applicator == "grab":
            success, result_data = extract_grab_menu(outlet, output_dir)
        elif applicator == "gofood":
            success, result_data = extract_gofood_menu(outlet, output_dir)
            
        if success and isinstance(result_data, dict):
            print(f"\n{GREEN}{BOLD}✔ PENARIKAN MENU BERHASIL!{RESET}")
            print(f"  - Total Item     : {result_data['items_count']}")
            print(f"  - Total Modifier : {result_data['mods_count']}")
            print(f"  - Hasil disimpan di directory: {output_dir}")
            print(f"    1. Items CSV     : {result_data['items_csv']}")
            print(f"    2. Modifiers CSV : {result_data['mods_csv']}")
            print(f"    3. Excel Unified : {result_data['excel']}")
        else:
            print(f"\n{RED}{BOLD}✘ PENARIKAN MENU GAGAL / STUB{RESET}")
            if isinstance(result_data, str):
                print(f"  Info: {result_data}")
            
if __name__ == "__main__":
    main()
