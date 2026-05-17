#!/usr/bin/env bash
# TASK WEEKLY - OFD Transaction Pipeline Launcher

clear

# ── STEP 0: MASUK KE DIREKTORI SRC (Hanya jika folder src ada) ──────
if [ -d "src" ]; then
    cd src
fi

echo "================================================================="
echo "    TASK WEEKLY - OFD Transaction Pipeline Launcher"
echo "================================================================="
echo ""

# ── STEP 1: DETEKSI ATAU INSTAL UV ──────────────────────────────────
if ! command -v uv &> /dev/null; then
    echo "[WARN] 'uv' tidak terdeteksi di laptop ini!"
    echo "[INFO] Menginstal 'uv' secara otomatis..."
    
    curl -LsSf https://astral.sh/uv/install.sh | sh
    
    # Tambahkan path uv ke sesi shell aktif agar bisa langsung dipakai
    export PATH="$HOME/.local/bin:$PATH"
    
    # Cek kembali
    if ! command -v uv &> /dev/null; then
        echo "[ERROR] Gagal menginstal 'uv' secara otomatis!"
        echo "Silakan jalankan perintah berikut di Terminal Anda:"
        echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
        echo ""
        read -p "Tekan [Enter] untuk keluar..."
        exit 1
    fi
    echo "[SUCCESS] 'uv' berhasil diinstal!"
    echo ""
fi

echo "[SUCCESS] 'uv' Terdeteksi: $(uv --version)"
echo ""

# ── STEP 2: OTOMATIS SYNC DEPENDENSI VIA UV ──────────────────────────
echo "[INFO] Sinkronisasi dependensi menggunakan 'uv sync'..."
uv sync

if [ $? -ne 0 ]; then
    echo "[ERROR] Gagal melakukan sinkronisasi dengan 'uv sync'!"
    read -p "Tekan [Enter] untuk keluar..."
    exit 1
fi
echo "[SUCCESS] Dependensi berhasil disinkronkan."
echo ""

# ── STEP 3: MENGUNDUH BROWSER UNTUK PLAYWRIGHT ───────────────────────
if [ ! -f ".venv/.installed" ]; then
    echo "[INFO] Mengunduh browser Chromium untuk otomatisasi Grab/Shopee..."
    uv run python -m playwright install chromium
    
    if [ $? -ne 0 ]; then
        echo "[ERROR] Gagal mengunduh browser Chromium!"
        read -p "Tekan [Enter] untuk keluar..."
        exit 1
    fi
    echo "Sukses diinstal pada $(date)" > .venv/.installed
    echo "[SUCCESS] Browser Chromium berhasil diinstal!"
    echo ""
fi

# ── STEP 4: JALANKAN PROGRAM UTAMA ─────────────────────────────────
# Force Headful mode for local run (so staff can solve OTP/CAPTCHAs)
export HEADLESS=false

echo "================================================================="
echo "                   MENJALANKAN INTERAKTIF CLI"
echo "================================================================="
echo ""
uv run python cli.py

echo ""
echo "================================================================="
echo "                     PROSES SELESAI"
echo "================================================================="
echo ""
read -p "Tekan [Enter] untuk keluar..."
