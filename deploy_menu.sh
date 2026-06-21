#!/bin/bash
# =============================================================================
# deploy_menu.sh — Deploy Menu Pipeline Bot via systemctl
#
# Cara pakai:
#   ./deploy_menu.sh
# =============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  🚀 Deploy Menu Bot Production (systemctl)${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

echo -e "${YELLOW}[1/3] Pulling latest code...${NC}"
git pull origin main

echo ""
echo -e "${YELLOW}[2/3] Restarting menu-bot service...${NC}"
# Bersihkan seluruh sisa zombie chrome/chromedriver di background
sudo killall -q -9 chrome google-chrome chromedriver chrome-headless-shell || true
sudo systemctl restart menu-bot

echo ""
echo -e "${YELLOW}[3/3] Status:${NC}"
sudo systemctl status menu-bot --no-pager | grep -E "(Active|●)"

echo ""
echo -e "${GREEN}✅ Deploy menu bot selesai! Kode terbaru sudah aktif.${NC}"
echo ""
echo "  Live logs menu bot : sudo journalctl -u menu-bot -f"
