import os
import sys
import shutil
import subprocess
from pathlib import Path

def clear_caches():
    print("🧹 Cleaning local master/credentials caches to ensure fresh test mock data is loaded...")
    paths_to_delete = [
        "src/baseline/shopee/data/master_merchants_cache.csv",
        "src/baseline/shopee/data/shopee_credentials_cache.csv",
        "src/shopee-omzet-automation/data/master_merchants_cache.csv",
        "src/shopee-omzet-automation/data/shopee_credentials_cache.csv",
        "data/master_merchants_cache.csv",
        "data/shopee_credentials_cache.csv",
    ]
    for p in paths_to_delete:
        full_path = Path(p)
        if full_path.exists():
            try:
                full_path.unlink()
                print(f"   Deleted cache: {p}")
            except Exception as e:
                print(f"   Failed to delete cache {p}: {e}")

def run_subprocess(cmd, cwd):
    # Set PYTHONPATH to prioritize test_mock_lib
    env = os.environ.copy()
    mock_lib_path = os.path.abspath("test_mock_lib")
    env["PYTHONPATH"] = mock_lib_path + os.pathsep + env.get("PYTHONPATH", "")
    
    try:
        result = subprocess.run(cmd, cwd=cwd, env=env)
        return result.returncode == 0
    except Exception as e:
        print(f"❌ Failed to run command: {e}")
        return False

def run_grab_test():
    clear_caches()
    print("\n🚀 Starting GrabFood Baseline Test (via Subprocess)...")
    
    python_exe = sys.executable
    cmd = [
        python_exe, "run_baseline.py",
        "--start", "2026-02-01",
        "--end", "2026-04-30",
        "--output-dir", os.path.abspath("src/laporan/grab_baseline/2026-02-01_to_2026-04-30")
    ]
    grab_dir = os.path.abspath("src/baseline/grab")
    
    if run_subprocess(cmd, cwd=grab_dir):
        print("\n🎉 GrabFood Baseline Test completed successfully.")
    else:
        print("\n❌ GrabFood Test failed.")

def run_shopee_test():
    clear_caches()
    print("\n🚀 Starting ShopeeFood Baseline Test (via Subprocess)...")
    
    python_exe = sys.executable
    cmd = [
        python_exe, "run_baseline.py",
        "--start", "2026-02-01",
        "--end", "2026-04-30",
        "--output-dir", os.path.abspath("src/laporan/shopee_baseline/2026-02-01_to_2026-04-30")
    ]
    shopee_dir = os.path.abspath("src/baseline/shopee")
    
    if run_subprocess(cmd, cwd=shopee_dir):
        print("\n🎉 ShopeeFood Baseline Test completed successfully.")
    else:
        print("\n❌ ShopeeFood Test failed.")

def run_gofood_test():
    clear_caches()
    print("\n🚀 Starting GoFood Baseline Test (via Subprocess)...")
    
    python_exe = sys.executable
    cmd = [
        python_exe, "gofood.py",
        "--start-date", "2026-02-01",
        "--end-date", "2026-04-30",
        "--output-dir", os.path.abspath("src/laporan/gofood_baseline/2026-02-01_to_2026-04-30"),
        "--task", "1"
    ]
    gofood_dir = os.path.abspath("src/goscrapperv2")
    
    if run_subprocess(cmd, cwd=gofood_dir):
        print("\n🎉 GoFood Baseline Test completed successfully.")
    else:
        print("\n❌ GoFood Test failed.")

def main():
    while True:
        print("\n" + "="*50)
        print("    MULTI PORTAL BASELINE TEST RUNNER")
        print("="*50)
        print("1. Run GrabFood Baseline Test")
        print("2. Run ShopeeFood Baseline Test")
        print("3. Run GoFood Baseline Test")
        print("4. Run All Platforms Tests")
        print("5. Keluar")
        
        choice = input("\nMasukkan pilihan (1-5): ").strip()
        if choice == "1":
            run_grab_test()
        elif choice == "2":
            run_shopee_test()
        elif choice == "3":
            run_gofood_test()
        elif choice == "4":
            run_grab_test()
            run_shopee_test()
            run_gofood_test()
        elif choice == "5":
            print("Keluar.")
            break
        else:
            print("Pilihan tidak valid.")

if __name__ == "__main__":
    main()
