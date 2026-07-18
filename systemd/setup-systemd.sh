#!/bin/bash
# =============================================================================
# setup-systemd.sh — Install services ke systemd di server production
#
# Jalankan di SERVER (bukan lokal):
#   bash ~/task-weekly/systemd/setup-systemd.sh
# =============================================================================

set -e

# Deteksi user asli meski dijalankan via sudo
REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME=$(eval echo "~$REAL_USER")
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEMD_DIR="/etc/systemd/system"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

# Detect npm path (including NVM support)
NPM_PATH=$(which npm 2>/dev/null || true)
if [ -z "$NPM_PATH" ]; then
    # Try NVM path directly using wildcards
    NPM_PATH=$(ls -d "$REAL_HOME"/.nvm/versions/node/*/bin/npm 2>/dev/null | tail -n 1 || true)
fi

if [ -z "$NPM_PATH" ]; then
    echo -e "${RED}❌ ERROR: npm tidak ditemukan! Silakan install Node.js/npm terlebih dahulu.${NC}"
    exit 1
fi
NPM_DIR="$(dirname "$NPM_PATH")"

# Detect uv path
UV_PATH=$(which uv 2>/dev/null || true)
if [ -z "$UV_PATH" ] && [ -f "$REAL_HOME/.local/bin/uv" ]; then
    UV_PATH="$REAL_HOME/.local/bin/uv"
fi

if [ -z "$UV_PATH" ]; then
    echo -e "${RED}❌ ERROR: uv tidak ditemukan! Silakan install uv terlebih dahulu.${NC}"
    exit 1
fi

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  ⚙️  Setup Systemd Services${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

# --- 1. Install PostgreSQL native jika belum ada ---
echo -e "${YELLOW}[1/5] Mengecek PostgreSQL...${NC}"
if ! command -v psql &>/dev/null; then
    echo "  → PostgreSQL belum terinstall. Installing..."
    sudo apt-get update -qq
    sudo apt-get install -y postgresql postgresql-client
    echo -e "  ${GREEN}✅ PostgreSQL terinstall.${NC}"
else
    echo -e "  ${GREEN}✅ PostgreSQL sudah ada: $(psql --version)${NC}"
fi

# Pastikan postgres system service running
sudo systemctl enable postgresql
sudo systemctl start postgresql
sleep 2
echo -e "  ${GREEN}✅ PostgreSQL system service running.${NC}"

# --- 2. Buat user dan database ---
echo ""
echo -e "${YELLOW}[2/5] Setup user & database PostgreSQL...${NC}"

# Buat user superfood_admin jika belum ada
sudo -u postgres psql -c \
  "DO \$\$ BEGIN
     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'superfood_admin') THEN
       CREATE USER superfood_admin WITH PASSWORD 'superfood_password';
     END IF;
   END \$\$;" 2>/dev/null

# Buat database srs_db jika belum ada
sudo -u postgres psql -c \
  "SELECT 1 FROM pg_database WHERE datname='srs_db'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE srs_db OWNER superfood_admin;"

# Grant privileges
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE srs_db TO superfood_admin;"

# Jalankan schema SQL jika ada
if ls "$REPO_DIR/src/database/"*.sql &>/dev/null 2>&1; then
    echo "  → Menjalankan schema SQL..."
    for f in "$REPO_DIR/src/database/"*.sql; do
        PGPASSWORD=superfood_password psql -h localhost -U superfood_admin -d srs_db -f "$f" 2>/dev/null || true
    done
fi
echo -e "  ${GREEN}✅ Database srs_db siap.${NC}"

# --- 3. Copy service files ke systemd ---
echo ""
echo -e "${YELLOW}[3/5] Menginstall service files ke systemd...${NC}"
sudo cp "$REPO_DIR/systemd/ofd-bot-staging.service"       "$SYSTEMD_DIR/"
sudo sed -i "s|User=akbar|User=$REAL_USER|g" "$SYSTEMD_DIR/ofd-bot-staging.service"
sudo sed -i "s|/home/akbar/task-weekly|$REPO_DIR|g" "$SYSTEMD_DIR/ofd-bot-staging.service"
sudo sed -i "s|ExecStart=/usr/bin/npm|ExecStart=$NPM_PATH|g" "$SYSTEMD_DIR/ofd-bot-staging.service"
# Inject path containing node to systemd PATH environment
sudo sed -i "/Environment=NODE_ENV=production/a Environment=PATH=$NPM_DIR:/usr/local/bin:/usr/bin:/bin" "$SYSTEMD_DIR/ofd-bot-staging.service"
sudo systemctl daemon-reload
echo -e "  ${GREEN}✅ Service files terinstall dan terkonfigurasi untuk user $REAL_USER.${NC}"

# --- 4. Install npm dependencies ---
echo ""
echo -e "${YELLOW}[4/5] Install npm dependencies untuk Discord bot...${NC}"
cd "$REPO_DIR/discord-bot-form"
PATH="$NPM_DIR:$PATH" "$NPM_PATH" install --silent
echo -e "  ${GREEN}✅ npm install selesai.${NC}"

# --- 5. Sync Python dependencies dengan uv ---
echo ""
echo -e "${YELLOW}[5/5] Sync Python dependencies dengan uv...${NC}"
cd "$REPO_DIR/src"
PATH="$(dirname "$UV_PATH"):$PATH" "$UV_PATH" sync
echo -e "  ${GREEN}✅ uv sync selesai.${NC}"

# --- Enable & Start services ---
echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  🚀 Menjalankan semua services...${NC}"
echo -e "${CYAN}============================================${NC}"
sudo systemctl enable ofd-bot-staging
sudo systemctl restart ofd-bot-staging
sleep 3

echo ""
echo -e "${GREEN}✅ Setup selesai! Status services:${NC}"
echo ""
sudo systemctl status ofd-bot-staging --no-pager -l | head -40

echo ""
echo -e "${CYAN}Perintah berguna:${NC}"
echo "  sudo systemctl status ofd-bot-staging"
echo "  sudo journalctl -u ofd-bot-staging -f"
echo "  ./deploy.sh  ← deploy setelah git pull"
