# Base image Node.js (LTS)
FROM node:20-bookworm-slim

# Set timezone & environment
ENV TZ=Asia/Jakarta \
    DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production

# Install dependensi sistem minimal
RUN apt-get update && apt-get install -y \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# Setup Working Directory
WORKDIR /app/discord-bot-session-monitor

# Copy package files terlebih dahulu untuk memanfaatkan Docker layer cache
COPY package.json package-lock.json ./

# Install dependensi Node.js
RUN npm ci --omit=dev

# Copy seluruh source code bot
COPY . .

# Jalankan bot
CMD ["node", "index.js"]
