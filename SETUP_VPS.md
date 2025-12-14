# WhatsApp Barcode Bot - Setup Guide untuk VPS

Bot WhatsApp untuk generate barcode produk dengan jumlah bulk untuk sistem POS (Indomaret compatible).

## Fitur

✅ **Cari Produk**: Kirimkan PLU atau Barcode untuk mencari produk  
✅ **Generate Barcode**: Otomatis membuat gambar produk + info + barcode scannable  
✅ **Bulk Label**: Generate banyak label dengan sekali perintah  
✅ **Mode Lokal**: Cari dari database lokal (`barcodesheet.json`)  
✅ **Mode API**: Cari via API dengan `.v2 [PLU/Barcode]`  
✅ **Interactive**: Bot menanyakan qty setelah produk ditemukan  

## Requirement

- **Node.js**: v16+ (gunakan `node --version` untuk cek)
- **npm**: v8+
- **Python 3.x**: (untuk build sharp)
- **VPS Linux** (Ubuntu/Debian recommended)

## Setup di VPS

### 1. Clone Repository

```bash
cd /home/username
git clone https://github.com/Setiawanfarel/bot.git
cd bot
```

### 2. Install Dependencies

```bash
npm install
```

Jika ada error saat install sharp, coba:

```bash
npm install --save-dev build-essential python3
npm install
```

### 3. Setup Environment Variables

Buat file `.env` di root project:

```bash
nano .env
```

Isi dengan:

```
API_URL=https://idmhelp.vercel.app/api/search?q=
```

Simpan dengan `CTRL+X` → `Y` → `ENTER`

### 4. Pastikan `barcodesheet.json` Ada

File ini harus sudah ada di root folder (database lokal produk).

Jika belum ada, hubungi admin untuk mendapatkan file.

### 5. Test Lokal (Optional)

```bash
node bot.js
```

Scan QR code yang muncul dengan WhatsApp untuk login. Setelah ready, bot siap menerima pesan.

---

## Deploy di VPS dengan PM2 (Recommended)

### Install PM2

```bash
npm install -g pm2
```

### Jalankan Bot dengan PM2

```bash
pm2 start bot.js --name "whatsapp-bot"
```

### Setup Auto-start saat VPS Reboot

```bash
pm2 startup
pm2 save
```

### Monitor Bot

```bash
pm2 monit
```

### Lihat Logs

```bash
pm2 logs whatsapp-bot
```

### Stop Bot

```bash
pm2 stop whatsapp-bot
```

### Restart Bot

```bash
pm2 restart whatsapp-bot
```

---

## 🔧 Automated Setup Script (Recommended)

Jika setup manual rumit, gunakan script otomatis ini:

```bash
# Download dan jalankan setup script
cd /home/ubuntu
wget https://raw.githubusercontent.com/Setiawanfarel/bot/main/install.sh -O install.sh
chmod +x install.sh
./install.sh
```

Atau manual script di VPS:

```bash
#!/bin/bash
set -e

echo "🚀 Installing WhatsApp Bot Dependencies..."

# Update system
sudo apt-get update
echo "✅ System updated"

# Install Node.js dependencies
sudo apt-get install -y curl git build-essential python3
echo "✅ Build tools installed"

# Install Chromium dependencies
sudo apt-get install -y \
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
  fonts-dejavu-core
echo "✅ Chromium dependencies installed"

# Clone repository
if [ ! -d "bot" ]; then
  git clone https://github.com/Setiawanfarel/bot.git
fi
cd bot

# Install Node modules
npm install
echo "✅ Node modules installed"

# Setup environment
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "✅ .env created"
fi

# Install PM2 globally
sudo npm install -g pm2
echo "✅ PM2 installed"

# Start bot with PM2
pm2 start bot.js --name "whatsapp-bot"
pm2 save
sudo pm2 startup
echo "✅ Bot started with PM2"

echo ""
echo "🎉 Setup Complete!"
echo "📱 Scan QR code yang muncul dengan WhatsApp"
echo "📊 Monitor: pm2 monit"
echo "📋 Logs: pm2 logs whatsapp-bot"
```

---

### 1. Cari Produk Lokal (Default)

Kirimkan **PLU** atau **Barcode**:

```
10000019
```

atau

```
8992702000018
```

Bot akan:
- Tampilkan gambar produk
- Tampilkan info (PLU, nama)
- Tampilkan barcode scannable
- Tanya qty untuk membuat bulk

### 2. Cari Produk via API

Gunakan `.v2 [PLU/Barcode]`:

```
.v2 10000019
```

### 3. Generate Bulk Label

**Opsi A**: Balas dengan angka setelah bot tanya qty

Bot: "_Jika ingin membuat banyak label untuk produk ini, kirimkan jumlah (angka)..._"

Kirimkan:

```
10
```

**Opsi B**: Gunakan command langsung

```
.bulk 10 10000019
```

atau (menggunakan produk terakhir dicari):

```
.bulk 10
```

---

## Troubleshooting

### Error: "Failed to launch the browser process!" - libatk-1.0.so.0

**Penyebab**: Puppeteer membutuhkan library sistem untuk Chromium, atau Chromium bundled corrupt

**✅ SOLUSI PALING EFEKTIF (Tested)**:

```bash
# Step 1: Update system & install Chromium dari repo
sudo apt-get update
sudo apt-get install -y chromium-browser

# Step 2: Bersihkan Chromium bundled yang corrupt
cd /home/ubuntu/bot
rm -rf node_modules/puppeteer-core/.local-chromium

# Step 3: Reinstall & set env untuk gunakan system Chromium
npm install
export CHROME_PATH=/usr/bin/chromium-browser

# Step 4: Restart bot
pm2 restart whatsapp-bot

# Cek logs untuk confirm
pm2 logs whatsapp-bot
```

**Alternatif: Jika masih error, skip install Chromium bundled**:

```bash
# Set environment variable permanent di .bashrc
echo 'export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true' >> ~/.bashrc
echo 'export CHROME_PATH=/usr/bin/chromium-browser' >> ~/.bashrc
source ~/.bashrc

# Reinstall
cd /home/ubuntu/bot
npm install
pm2 restart whatsapp-bot
```

**Jika error persisten, gunakan cara manual dengan semua dependencies**:

```bash
# Install ALL chromium dependencies (comprehensive)
sudo apt-get install -y \
  chromium-browser \
  gconf-service \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  fonts-liberation \
  libnss3 \
  libcups2 \
  libdbus-1-3 \
  libgconf-2-4 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  ca-certificates \
  libatk-1.0-0 \
  libatk-bridge2.0-0 \
  libcairo-gobject2 \
  libgbm-dev \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libxinerama1

# Reinstall bot
cd /home/ubuntu/bot
npm cache clean --force
rm -rf node_modules
npm install
pm2 restart whatsapp-bot
```

**Opsi Terakhir: Skip bundled Puppeteer, install custom**:

```bash
# Gunakan system Chromium saja
cd /home/ubuntu/bot
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export CHROME_PATH=/usr/bin/chromium-browser
npm install
pm2 restart whatsapp-bot
```

### Error: "Cannot find module 'whatsapp-web.js'"

**Solusi**:

```bash
npm install
npm install whatsapp-web.js --save
```

### Error: "EACCES: permission denied"

**Solusi**:

```bash
sudo chown -R $USER:$USER /home/username/bot
npm install
```

### Bot tidak respond

**Cek**:

```bash
pm2 logs whatsapp-bot
```

Lihat error terakhir di log.

**Restart**:

```bash
pm2 restart whatsapp-bot
```

### Error: "sharp module not found"

**Solusi**:

```bash
npm install --save-dev build-essential python3
npm install
```

### Session tidak ter-save (perlu scan QR setiap restart)

**Penyebab**: Folder session tidak writable

**Solusi**:

```bash
# Pastikan folder writable
chmod -R 755 /home/ubuntu/bot/whatsapp-session
# atau hapus dan buat baru
rm -rf /home/ubuntu/bot/whatsapp-session
mkdir -p /home/ubuntu/bot/whatsapp-session
chmod 755 /home/ubuntu/bot/whatsapp-session
pm2 restart whatsapp-bot
```

---

## File Structure

```
bot/
├── bot.js                    # Main bot file
├── package.json              # Dependencies
├── .env                      # Environment variables (jangan commit)
├── .gitignore                # Git ignore rules
├── barcodesheet.json         # Database lokal (jangan commit)
├── .git/                     # Git history
├── node_modules/             # Dependencies folder (jangan commit)
├── whatsapp-session/         # WhatsApp session (jangan commit)
└── README.md                 # This file
```

---

## Update Bot

Untuk update ke versi terbaru:

```bash
git pull origin main
npm install
pm2 restart whatsapp-bot
```

---

## Support

Jika ada masalah, hubungi admin atau periksa logs:

```bash
pm2 logs whatsapp-bot
```

---

**Last Update**: December 2025
