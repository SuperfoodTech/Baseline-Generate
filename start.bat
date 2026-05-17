@echo off
title TASK WEEKLY - OFD Transaction Pipeline Launcher 
cls

:: ── STEP 0: MASUK KE DIREKTORI SRC (Hanya jika folder src ada) ─────
if exist src\ (
    cd src
)

echo =================================================================
echo     TASK WEEKLY - OFD Transaction Pipeline Launcher
echo =================================================================
echo.

:: ── STEP 1: DETEKSI ATAU INSTAL UV ─────────────────────────────────
where uv >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] 'uv' tidak terdeteksi di laptop ini!
    echo [INFO] Menginstal 'uv' secara otomatis...
    
    powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
    
    :: Tambahkan path uv ke sesi cmd aktif agar bisa langsung dipakai
    set "PATH=%USERPROFILE%\.local\bin;%PATH%"
    
    :: Cek kembali
    where uv >nul 2>&1
    if %errorlevel% neq 0 (
        echo [ERROR] Gagal menginstal 'uv' secara otomatis!
        echo Silakan jalankan perintah berikut di PowerShell Anda:
        echo   irm https://astral.sh/uv/install.ps1 | iex
        echo.
        pause
        exit /b
    )
    echo [SUCCESS] 'uv' berhasil diinstal!
    echo.
)

echo [SUCCESS] 'uv' Terdeteksi:
uv --version
echo.

:: ── STEP 2: OTOMATIS SYNC DEPENDENSI VIA UV ─────────────────────────
echo [INFO] Sinkronisasi dependensi menggunakan 'uv sync'...
uv sync

if %errorlevel% neq 0 (
    echo [ERROR] Gagal melakukan sinkronisasi dengan 'uv sync'!
    pause
    exit /b
)
echo [SUCCESS] Dependensi berhasil disinkronkan.
echo.

:: ── STEP 3: MENGUNDUH BROWSER UNTUK PLAYWRIGHT ──────────────────────
if not exist .venv\.installed (
    echo [INFO] Mengunduh browser Chromium untuk otomatisasi Grab/Shopee...
    uv run python -m playwright install chromium
    
    if %errorlevel% neq 0 (
        echo [ERROR] Gagal mengunduh browser Chromium!
        pause
        exit /b
    )
    echo Sukses diinstal pada %date% %time% > .venv\.installed
    echo [SUCCESS] Browser Chromium berhasil diinstal!
    echo.
)

:: ── STEP 4: JALANKAN PROGRAM UTAMA ────────────────────────────────
:: Force Headful mode for local run (so staff can solve OTP/CAPTCHAs)
set HEADLESS=false

echo =================================================================
echo                    MENJALANKAN INTERAKTIF CLI
echo =================================================================
echo.
uv run python cli.py

echo.
echo =================================================================
echo                      PROSES SELESAI
echo =================================================================
echo.
pause
