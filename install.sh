#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 WhatsApp Barcode Bot - Automated Setup${NC}"
echo "================================================"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}❌ This script must be run as root (use sudo)${NC}"
   exit 1
fi

# Detect distro
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
fi

echo -e "${BLUE}📦 Detected OS: $OS${NC}"
echo ""

# Update system
echo -e "${YELLOW}📡 Updating system packages...${NC}"
apt-get update

# Install basic tools
echo -e "${YELLOW}🔧 Installing build tools...${NC}"
apt-get install -y curl git build-essential python3 wget

# Install Chromium dependencies (compatible with most Linux)
echo -e "${YELLOW}🎨 Installing Chromium dependencies...${NC}"
apt-get install -y \
  chromium-browser \
  libgbm-dev \
  libxss1 \
  libcups2 \
  libdbus-1-3 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxrandr2 \
  libxrender1 \
  libxtst6 \
  fonts-liberation \
  libnss3 \
  libxinerama1 \
  libxi6 \
  ca-certificates \
  fonts-dejavu-core || true

echo -e "${GREEN}✅ System dependencies installed${NC}"
echo ""

# Clone or update repository
BOT_DIR="/home/ubuntu/bot"
if [ ! -d "$BOT_DIR" ]; then
  echo -e "${YELLOW}📥 Cloning repository...${NC}"
  git clone https://github.com/Setiawanfarel/bot.git $BOT_DIR
  echo -e "${GREEN}✅ Repository cloned${NC}"
else
  echo -e "${YELLOW}📥 Updating repository...${NC}"
  cd $BOT_DIR
  git pull origin main
  echo -e "${GREEN}✅ Repository updated${NC}"
fi

cd $BOT_DIR

# Install Node modules
echo -e "${YELLOW}📦 Installing Node.js dependencies...${NC}"
npm install
echo -e "${GREEN}✅ Node.js dependencies installed${NC}"
echo ""

# Setup environment file
if [ ! -f ".env" ]; then
  echo -e "${YELLOW}⚙️  Creating .env file...${NC}"
  cp .env.example .env
  echo -e "${GREEN}✅ .env created${NC}"
else
  echo -e "${YELLOW}⚙️  .env already exists, skipping...${NC}"
fi
echo ""

# Create session directory
if [ ! -d "whatsapp-session" ]; then
  mkdir -p whatsapp-session
  chmod 755 whatsapp-session
  echo -e "${GREEN}✅ Session directory created${NC}"
fi

# Install PM2 globally
echo -e "${YELLOW}🚀 Installing PM2 process manager...${NC}"
npm install -g pm2
echo -e "${GREEN}✅ PM2 installed${NC}"
echo ""

# Start bot with PM2
echo -e "${YELLOW}🤖 Starting WhatsApp Bot...${NC}"
pm2 start bot.js --name "whatsapp-bot" --error /tmp/whatsapp-bot.err.log --out /tmp/whatsapp-bot.out.log
pm2 save

echo ""
echo -e "${GREEN}✅ Bot started!${NC}"
echo ""
echo -e "${BLUE}📱 NEXT STEPS:${NC}"
echo -e "  1. Check QR code: ${YELLOW}pm2 logs whatsapp-bot${NC}"
echo -e "  2. Scan QR with WhatsApp (Linked Devices)"
echo -e "  3. Test: Send PLU or Barcode to bot"
echo ""
echo -e "${BLUE}📊 USEFUL COMMANDS:${NC}"
echo -e "  Monitor:  ${YELLOW}pm2 monit${NC}"
echo -e "  Logs:     ${YELLOW}pm2 logs whatsapp-bot${NC}"
echo -e "  Restart:  ${YELLOW}pm2 restart whatsapp-bot${NC}"
echo -e "  Stop:     ${YELLOW}pm2 stop whatsapp-bot${NC}"
echo -e "  Status:   ${YELLOW}pm2 status${NC}"
echo ""
echo -e "${GREEN}🎉 Setup complete!${NC}"
echo "================================================"
