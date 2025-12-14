const { Client, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const bwipjs = require('bwip-js');
const sharp = require('sharp');
const sqlite3 = require('sqlite3').verbose();

// Database connection
const dbPath = path.join(__dirname, 'barcode.db');
let db = null;

// Initialize database
function initializeDB() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('❌ Database error:', err);
        reject(err);
      } else {
        console.log('✅ Database connected');
        resolve();
      }
    });
  });
}

// Query helper
function queryDB(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Query all helper
function queryAllDB(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// Barcode cache
const barcodeCache = new Map();
const lastProductByChat = new Map();

function findProductLocally(query) {
  return new Promise(async (resolve) => {
    try {
      // Try PLU first
      let product = await queryDB('SELECT * FROM products WHERE plu = ?', [query]);
      if (product) {
        resolve(product);
        return;
      }
      
      // Try barcode
      product = await queryDB('SELECT * FROM products WHERE barcode = ?', [query]);
      resolve(product || null);
    } catch (err) {
      console.error('❌ DB query error:', err);
      resolve(null);
    }
  });
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Create barcode image only (no product image, no API fetch)
async function createBarcodeImage(product, options = {}) {
  const targetWidth = options.targetWidth || 1000;
  const sidePadding = options.sidePadding || 60;
  const barcodeScale = options.barcodeScale || 2;
  const barcodeHeight = options.barcodeHeight || 10;

  const plu = product.plu || 'N/A';
  const barcode = product.barcode || '';
  const nama = product.productName || product.nama || 'Nama Tidak Tersedia';

  const codeToRender = (barcode && barcode.trim() !== '') ? barcode : plu;

  // Generate barcode
  const isDigits = /^\d+$/.test(codeToRender);
  let bcid = 'code128';
  if (isDigits && codeToRender.length === 13) bcid = 'ean13';
  else if (isDigits && codeToRender.length === 12) bcid = 'upca';

  const cacheKey = `${bcid}:${codeToRender}`;
  let barcodePng = barcodeCache.get(cacheKey);

  if (!barcodePng) {
    try {
      barcodePng = await bwipjs.toBuffer({
        bcid,
        text: codeToRender,
        scale: barcodeScale,
        height: barcodeHeight,
        includetext: true,
        textxalign: 'center'
      });
      barcodeCache.set(cacheKey, barcodePng);
      console.log(`✅ Barcode generated for ${codeToRender}`);
    } catch (e) {
      console.error('❌ Barcode generation failed:', e);
      throw new Error(`Barcode error: ${e.message}`);
    }
  }

  // Create info SVG
  const infoHeight = 100;
  const infoSvg = `
    <svg width="${targetWidth}" height="${infoHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${targetWidth}" height="${infoHeight}" fill="#ffffff" stroke="#000000" stroke-width="2"/>
      <text x="20" y="30" font-size="20" font-weight="bold" fill="#000000">PLU: ${esc(plu)}</text>
      <text x="20" y="60" font-size="16" fill="#333333">${esc(nama)}</text>
      <text x="20" y="85" font-size="12" fill="#666666">Barcode: ${esc(codeToRender)}</text>
    </svg>
  `;
  
  const infoPng = await sharp(Buffer.from(infoSvg)).png().toBuffer();

  // Resize barcode
  const barcodeResized = await sharp(barcodePng)
    .resize(targetWidth - 2 * sidePadding, null, { withoutEnlargement: true })
    .png()
    .toBuffer();
  
  const barcodeMeta = await sharp(barcodeResized).metadata();

  // Create final image: info + barcode
  const totalHeight = infoHeight + barcodeMeta.height + 30;
  const canvas = sharp({
    create: { width: targetWidth, height: totalHeight, channels: 3, background: '#ffffff' }
  });

  const composite = await canvas.composite([
    { input: infoPng, top: 0, left: 0 },
    { input: barcodeResized, top: infoHeight + 15, left: sidePadding }
  ]).png().toBuffer();

  return composite;
}

// Generate bulk image (multiple barcodes)
async function generateBulkImage(product, qty) {
  if (qty <= 0 || qty > 200) throw new Error('qty invalid');

  const plu = product.plu || 'N/A';
  const barcode = product.barcode || '';
  const nama = product.productName || product.nama || 'Nama Tidak Tersedia';

  const codeToRender = (barcode && barcode.trim() !== '') ? barcode : plu;

  // Barcode type
  const isDigits = /^\d+$/.test(codeToRender);
  let bcid = 'code128';
  if (isDigits && codeToRender.length === 13) bcid = 'ean13';
  else if (isDigits && codeToRender.length === 12) bcid = 'upca';

  const cacheKey = `${bcid}:${codeToRender}`;
  let barcodePng = barcodeCache.get(cacheKey);

  if (!barcodePng) {
    barcodePng = await bwipjs.toBuffer({
      bcid, text: codeToRender, scale: 2, height: 10, includetext: true, textxalign: 'center'
    });
    barcodeCache.set(cacheKey, barcodePng);
  }

  // Label dimensions
  const labelWidth = 800;
  const infoHeight = 80;
  const sidePadding = 20;

  // Info SVG for bulk
  const infoSvg = `
    <svg width="${labelWidth}" height="${infoHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${labelWidth}" height="${infoHeight}" fill="#ffffff" stroke="#ccc" stroke-width="1"/>
      <text x="10" y="25" font-size="16" font-weight="bold" fill="#000">${esc(plu)} - ${esc(nama)}</text>
      <text x="10" y="50" font-size="12" fill="#333">Code: ${esc(codeToRender)}</text>
      <text x="10" y="70" font-size="11" fill="#666">Scan barcode di bawah</text>
    </svg>
  `;

  const infoPng = await sharp(Buffer.from(infoSvg)).png().toBuffer();

  // Resize barcode
  const barcodeResized = await sharp(barcodePng)
    .resize(labelWidth - 2 * sidePadding, null, { withoutEnlargement: true })
    .png()
    .toBuffer();

  const barcodeMeta = await sharp(barcodeResized).metadata();
  const labelHeight = infoHeight + barcodeMeta.height + 20;
  const totalHeight = labelHeight * qty;

  const canvas = sharp({
    create: { width: labelWidth, height: totalHeight, channels: 3, background: '#ffffff' }
  });

  const composites = [];
  for (let i = 0; i < qty; i++) {
    const top = i * labelHeight;
    composites.push({ input: infoPng, top: top, left: 0 });
    composites.push({ input: barcodeResized, top: top + infoHeight + 10, left: sidePadding });
  }

  return await canvas.composite(composites).png().toBuffer();
}

// Send barcode
async function sendBarcodeInfo(msg, product, client) {
  try {
    const buffer = await createBarcodeImage(product, { barcodeHeight: 10 });
    const media = new MessageMedia('image/png', buffer.toString('base64'), 'barcode.png');
    
    const caption = `*PLU:* ${product.plu || 'N/A'}\n*Nama:* ${product.productName || product.nama || 'N/A'}\n\nGunakan .bulk <qty> untuk membuat banyak label`;
    
    await client.sendMessage(msg.from, media, { caption });
    lastProductByChat.set(msg.from, product);
    
  } catch (err) {
    console.error('❌ Error creating barcode:', err);
    await client.sendMessage(msg.from, '❌ Error membuat barcode');
  }
}

// Initialize client
const client = new Client({
  session: 'whatsapp-session',
  puppeteer: {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-web-resources',
      '--metrics-recording-only',
      '--disable-breakpad'
    ],
    executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser'
  }
});

client.on('qr', (qr) => {
  console.log('\n📱 Scan QR code below with WhatsApp to login:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp Bot Ready!');
  console.log('Send PLU or Barcode to search');
  console.log('Commands: .plu <plu1> <plu2> ... or .bulk <qty> <plu>');
});

// Message handler
client.on('message', async (msg) => {
  try {
    const userMessage = msg.body.trim();

    // .plu multiple search
    if (userMessage.toLowerCase().startsWith('.plu')) {
      const pluList = userMessage.substring(4).trim().split(/\s+/);
      if (!pluList[0]) {
        await client.sendMessage(msg.from, 'Format: .plu <plu1> <plu2> ...');
        return;
      }

      const results = [];
      for (const plu of pluList) {
        const product = await findProductLocally(plu);
        if (product) {
          results.push(`✅ ${plu}: ${product.productName || product.nama}`);
        } else {
          results.push(`❌ ${plu}: Tidak ditemukan`);
        }
      }
      await client.sendMessage(msg.from, `*Hasil Pencarian:*\n\n${results.join('\n')}`);
      return;
    }

    // .bulk command
    if (userMessage.toLowerCase().startsWith('.bulk')) {
      const parts = userMessage.split(/\s+/).slice(1);
      const qty = parseInt(parts[0], 10);
      
      if (!qty || qty <= 0 || qty > 100) {
        await client.sendMessage(msg.from, 'Format: .bulk <qty> [plu]\nContoh: .bulk 10 10000019');
        return;
      }

      let product = null;
      if (parts[1]) {
        product = await findProductLocally(parts[1]);
      } else {
        product = lastProductByChat.get(msg.from);
      }

      if (!product) {
        await client.sendMessage(msg.from, 'Produk tidak ditemukan');
        return;
      }

      await client.sendMessage(msg.from, `Membuat ${qty} label...`);
      try {
        const buffer = await generateBulkImage(product, qty);
        const media = new MessageMedia('image/png', buffer.toString('base64'), `bulk-${qty}.png`);
        await client.sendMessage(msg.from, media, { caption: `Bulk ${qty}x ${product.plu}` });
      } catch (err) {
        console.error('❌ Bulk error:', err);
        await client.sendMessage(msg.from, '❌ Error membuat bulk');
      }
      return;
    }

    // Default: search lokal
    const product = await findProductLocally(userMessage);
    if (product) {
      await sendBarcodeInfo(msg, product, client);
    } else {
      await client.sendMessage(msg.from, `❌ PLU/Barcode "${userMessage}" tidak ditemukan\n\nGunakan format:\n• PLU: 10000019\n• Barcode: 8992702000018\n• Multiple: .plu 10000019 10000020\n• Bulk: .bulk 10 10000019`);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    await client.sendMessage(msg.from, '❌ Error');
  }
});

client.on('disconnected', (reason) => {
  console.log('❌ Disconnected:', reason);
});

client.on('error', (error) => {
  console.error('❌ Error:', error);
});

// Initialize and start
(async () => {
  try {
    await initializeDB();
    client.initialize();
  } catch (err) {
    console.error('❌ Initialization failed:', err);
    process.exit(1);
  }
})();

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  client.destroy();
  process.exit(0);
});
