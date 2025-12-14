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

## Cara Menggunakan Bot

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

**Penyebab**: Puppeteer membutuhkan library sistem untuk Chromium

**Solusi**:

```bash
# Install dependencies Chromium di Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y \
  libgbm-dev \
  libatk-1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdbus-1-3 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  fonts-liberation \
  libappindicator1 \
  libnss3 \
  libasound2 \
  libxinerama1 \
  libxi6

# Lalu reinstall bot
npm install
pm2 restart whatsapp-bot
```

Jika error berlanjut, coba dengan flag `--ignore-gpu`:

```bash
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
npm install
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
