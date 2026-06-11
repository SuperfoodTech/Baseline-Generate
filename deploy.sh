#!/bin/bash
# =============================================================================
# deploy.sh — Deploy production TANPA rebuild & TANPA Docker Hub
#
# Cara pakai:
#   chmod +x deploy.sh   (sekali saja)
#   ./deploy.sh
#
# Build pertama kali (atau setelah Dockerfile/deps berubah):
#   docker compose -f docker-compose.production.yml up -d --build
# =============================================================================

set -e

COMPOSE_FILE="docker-compose.production.yml"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  🚀 Deploy Production (tanpa rebuild)${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

echo -e "${YELLOW}[1/3] Pulling latest code from git...${NC}"
git pull origin main

echo ""
echo -e "${YELLOW}[2/3] Restarting containers (kode terbaru otomatis terbaca)...${NC}"
docker compose -f $COMPOSE_FILE restart

echo ""
echo -e "${YELLOW}[3/3] Status container:${NC}"
docker compose -f $COMPOSE_FILE ps

echo ""
echo -e "${GREEN}✅ Deploy selesai! Kode terbaru sudah aktif tanpa rebuild.${NC}"
echo ""
echo -e "💡 Jika ada perubahan di Dockerfile atau install package baru, jalankan:"
echo -e "   ${CYAN}docker compose -f $COMPOSE_FILE up -d --build${NC}"
