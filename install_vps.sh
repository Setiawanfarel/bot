#!/usr/bin/env bash
set -euo pipefail

# install_vps.sh
# Satu-perintah setup untuk VPS (Debian/Ubuntu)
# Use: sudo ./install_vps.sh

REPO_DIR="$(pwd)"
NODE_VERSION=18
PM2_USER="$(logname 2>/dev/null || echo $SUDO_USER)"

echo "[1/9] Pastikan script dijalankan dari folder project: $REPO_DIR"

if [ "$EUID" -ne 0 ]; then
  echo "This script should be run with sudo. Re-run: sudo $0"
  exit 1
fi

echo "[2/9] Update package lists"
apt update -y

echo "[3/9] Install base packages"
apt install -y git curl build-essential ca-certificates gnupg lsb-release ufw

echo "[4/9] Install Node.js $NODE_VERSION (NodeSource)"
curl -fsSL https://deb.nodesource.com/setup_$NODE_VERSION.x | bash -
apt install -y nodejs

echo "Node version: $(node -v)"

echo "[5/9] Install Chromium (optional, used by whatsapp-web.js). If you only use Baileys, Chromium is not required."
if ! command -v chromium-browser >/dev/null 2>&1; then
  apt install -y chromium
fi

echo "[6/9] Install pm2 globally"
npm install -g pm2

echo "[7/9] Install project dependencies"
cd "$REPO_DIR"
# ensure ownership
chown -R "$PM2_USER":"$PM2_USER" "$REPO_DIR" || true
sudo -u "$PM2_USER" npm install --no-audit --no-fund

echo "[8/9] Import barcodesheet.json -> barcode.db (this may take some minutes)"
# run importer as the non-root user to keep DB owned by that user
sudo -u "$PM2_USER" node import-to-db.js || true

echo "[9/9] Setup pm2 processes and startup"
# Start server (HTTP test) and Baileys bot via pm2 under PM2_USER
sudo -u "$PM2_USER" pm2 start server.js --name bot-server || true
sudo -u "$PM2_USER" pm2 start bot-baileys.js --name whatsapp-baileys || true

# Save pm2 process list and enable startup
sudo -u "$PM2_USER" pm2 save
PM2_STARTUP_CMD=$(pm2 startup systemd -u $PM2_USER --hp "/home/$PM2_USER" | sed -n '1,2p') || true
echo "$PM2_STARTUP_CMD"

# Open firewall port for HTTP test server
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp
  ufw allow 3000/tcp
  ufw --force enable || true
fi

cat <<EOF

Done.
Next steps:
- Check pm2 status: sudo -u $PM2_USER pm2 status
- View logs: sudo -u $PM2_USER pm2 logs whatsapp-baileys --lines 200
- If using Baileys, scan QR shown in pm2 logs terminal.
- If you prefer systemd, pm2 startup commands were printed above — run them as instructed.

If you want me to enable TLS/reverse-proxy (nginx) or create systemd unit instead of pm2, tell me.
EOF
