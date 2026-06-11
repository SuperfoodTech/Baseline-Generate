#!/bin/bash
# =============================================================================
# deploy.sh — Deploy production via systemctl (tanpa Docker, tanpa rebuild)
#
# Cara pakai:
#   ./deploy.sh
# =============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  🚀 Deploy Production (systemctl)${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

echo -e "${YELLOW}[1/3] Pulling latest code, chrome profiles & sessions...${NC}"
git pull origin main

echo ""
echo -e "${YELLOW}[2/3] Restarting services...${NC}"
# Bersihkan seluruh sisa zombie chrome/chromedriver di background
sudo killall -q -9 chrome google-chrome chromedriver chrome-headless-shell || true
sudo systemctl restart ofd-bot shopee-warmer

echo ""
echo -e "${YELLOW}[3/3] Status:${NC}"
sudo systemctl status ofd-bot shopee-warmer --no-pager | grep -E "(Active|●)"

echo ""
echo -e "${GREEN}✅ Deploy selesai! Kode & session terbaru sudah aktif.${NC}"
echo ""
echo "  Live logs bot   : sudo journalctl -u ofd-bot -f"
echo "  Live logs warmer: sudo journalctl -u shopee-warmer -f"
