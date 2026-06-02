# Menggunakan base image Python 3.12 Debian Bookworm
FROM python:3.12-bookworm

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PATH="/root/.local/bin:$PATH"

# Menginstal dependensi sistem termasuk Node.js (untuk Discord bot)
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y \
    nodejs \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Menginstal Google Chrome (untuk Selenium)
RUN curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/googlechrom-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/googlechrom-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Menginstal uv untuk manajemen dependensi Python
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# Setup Working Directory
WORKDIR /app

# Copy seluruh file project
COPY . /app

# Setup Environment Python (menggunakan uv sync)
WORKDIR /app/src
RUN uv sync

# Install Playwright beserta dependensi Chromium-nya
RUN uv run playwright install --with-deps chromium

# Setup Environment Node.js untuk Discord Bot
WORKDIR /app/discord-bot-form
RUN npm install

# Setup Environment Node.js untuk Discord Bot (Session Monitor)
WORKDIR /app/discord-bot-session-monitor
RUN npm install

# Command bawaan ketika container berjalan
CMD ["npm", "start"]
