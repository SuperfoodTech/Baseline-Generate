#!/bin/bash
# =============================================================================
# setup-systemd.sh — Install services ke systemd di server production
#
# Jalankan di SERVER (bukan lokal):
#   chmod +x setup-systemd.sh
#   ./setup-systemd.sh
# =============================================================================

set -e

REPO_DIR="/home/akbar/task-weekly"
SYSTEMD_DIR="/etc/systemd/system"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  ⚙️  Setup Systemd Services${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

# --- 1. Install PostgreSQL native jika belum ada ---
echo -e "${YELLOW}[1/6] Mengecek PostgreSQL...${NC}"
if ! command -v psql &>/dev/null; then
    echo "  → PostgreSQL belum terinstall. Installing..."
    sudo apt-get update -qq
    sudo apt-get install -y postgresql postgresql-client
    echo -e "  ${GREEN}✅ PostgreSQL terinstall.${NC}"
else
    echo -e "  ${GREEN}✅ PostgreSQL sudah ada: $(psql --version)${NC}"
fi

# Deteksi versi postgres yang terinstall
PG_VERSION=$(ls /usr/lib/postgresql/ | sort -V | tail -1)
echo "  → PostgreSQL version: $PG_VERSION"

# Update ExecStart di service file dengan versi yang benar
sed -i "s|postgresql/16|postgresql/$PG_VERSION|g" "$REPO_DIR/systemd/srs-postgres.service"

# --- 2. Init database PostgreSQL ---
echo ""
echo -e "${YELLOW}[2/6] Setup database PostgreSQL...${NC}"
PGDATA_DIR="/home/akbar/pgdata/srs_db"

if [ ! -f "$PGDATA_DIR/PG_VERSION" ]; then
    echo "  → Init database baru di $PGDATA_DIR..."
    mkdir -p "$PGDATA_DIR"
    /usr/lib/postgresql/$PG_VERSION/bin/initdb -D "$PGDATA_DIR" --locale=en_US.UTF-8 --encoding=UTF8
    echo -e "  ${GREEN}✅ Database diinit.${NC}"
else
    echo -e "  ${GREEN}✅ Database sudah ada di $PGDATA_DIR${NC}"
fi

# --- 3. Copy service files ke systemd ---
echo ""
echo -e "${YELLOW}[3/6] Menginstall service files ke systemd...${NC}"
sudo cp "$REPO_DIR/systemd/srs-postgres.service"  "$SYSTEMD_DIR/"
sudo cp "$REPO_DIR/systemd/ofd-bot.service"       "$SYSTEMD_DIR/"
sudo cp "$REPO_DIR/systemd/shopee-warmer.service"  "$SYSTEMD_DIR/"
sudo systemctl daemon-reload
echo -e "  ${GREEN}✅ Service files terinstall.${NC}"

# --- 4. Start & enable PostgreSQL ---
echo ""
echo -e "${YELLOW}[4/6] Menjalankan PostgreSQL...${NC}"
sudo systemctl enable srs-postgres
sudo systemctl restart srs-postgres
sleep 3

# Buat user dan database jika belum ada
/usr/lib/postgresql/$PG_VERSION/bin/psql -h localhost -p 5432 -U $(whoami) -d postgres -c \
  "DO \$\$ BEGIN
     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'superfood_admin') THEN
       CREATE USER superfood_admin WITH PASSWORD 'superfood_password';
     END IF;
   END \$\$;" 2>/dev/null || true

/usr/lib/postgresql/$PG_VERSION/bin/psql -h localhost -p 5432 -U $(whoami) -d postgres -c \
  "CREATE DATABASE srs_db OWNER superfood_admin;" 2>/dev/null || echo "  (DB sudah ada, skip)"

# Jalankan schema SQL jika ada
if ls "$REPO_DIR/src/database/"*.sql &>/dev/null; then
    echo "  → Menjalankan schema SQL..."
    for f in "$REPO_DIR/src/database/"*.sql; do
        PGPASSWORD=superfood_password psql -h localhost -U superfood_admin -d srs_db -f "$f" 2>/dev/null || true
    done
fi
echo -e "  ${GREEN}✅ PostgreSQL siap.${NC}"

# --- 5. Install npm dependencies untuk bot ---
echo ""
echo -e "${YELLOW}[5/6] Install npm dependencies untuk Discord bot...${NC}"
cd "$REPO_DIR/discord-bot-form"
npm install --silent
echo -e "  ${GREEN}✅ npm install selesai.${NC}"

# --- 6. Sync Python dependencies dengan uv ---
echo ""
echo -e "${YELLOW}[6/6] Sync Python dependencies dengan uv...${NC}"
cd "$REPO_DIR/src"
uv sync
echo -e "  ${GREEN}✅ uv sync selesai.${NC}"

# --- Start semua services ---
echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  🚀 Menjalankan semua services...${NC}"
echo -e "${CYAN}============================================${NC}"
sudo systemctl enable ofd-bot shopee-warmer
sudo systemctl restart ofd-bot shopee-warmer

sleep 3
echo ""
echo -e "${GREEN}✅ Setup selesai! Status services:${NC}"
echo ""
sudo systemctl status srs-postgres ofd-bot shopee-warmer --no-pager -l | head -60

echo ""
echo -e "${CYAN}Perintah berguna:${NC}"
echo "  sudo systemctl status ofd-bot shopee-warmer srs-postgres"
echo "  sudo journalctl -u ofd-bot -f"
echo "  sudo journalctl -u shopee-warmer -f"
echo "  ./deploy.sh   ← deploy terbaru setelah git pull"
