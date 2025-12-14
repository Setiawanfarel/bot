const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
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

// In-memory product cache (LRU-like, simple)
const PRODUCT_CACHE_LIMIT = 2000;
const productCache = new Map();
// Initialize database
function initializeDB() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('❌ Database error:', err);
        reject(err);
      } else {
        // Ensure useful indexes exist to make lookups by PLU/barcode fast
        db.serialize(() => {
          db.run('CREATE INDEX IF NOT EXISTS idx_products_plu ON products(plu)');
          db.run('CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)');
        });

        console.log('✅ Database connected (indexes ensured)');
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
    const start = Date.now();
    db.get(sql, params, (err, row) => {
      const elapsed = Date.now() - start;
      if (err) {
        console.error(`❌ DB error (${elapsed}ms):`, err);
        reject(err);
      } else {
        // minimal timing log for slow queries
        if (elapsed > 20) console.log(`⏱️  DB query ${sql} took ${elapsed}ms`);
        resolve(row);
      }
    });
  });
}

// Barcode cache
const barcodeCache = new Map();
const lastProductByChat = new Map();

async function findProductLocally(query) {
  try {
    const key = String(query || '').trim();
    if (!key) return null;

    // Check in-memory cache first
    if (productCache.has(key)) {
      // Move to newest (simple LRU behavior)
      const cached = productCache.get(key);
      productCache.delete(key);
      productCache.set(key, cached);
      // Very fast return
      // console.log(`🔁 Cache hit for ${key}`);
      return cached;
    }

    const t0 = Date.now();
    // Try PLU first
    let product = await queryDB('SELECT * FROM products WHERE plu = ?', [key]);
    if (!product) {
      // try barcode exact
      product = await queryDB('SELECT * FROM products WHERE barcode = ?', [key]);
    }
    // If still not found, try digits-only (user may send formatting characters)
    if (!product) {
      const digits = key.replace(/\D/g, '');
      if (digits && digits !== key) {
        product = await queryDB('SELECT * FROM products WHERE plu = ? OR barcode = ?', [digits, digits]);
      }
    }
    const elapsed = Date.now() - t0;
    if (elapsed > 10) console.log(`🔎 Lookup for ${key} took ${elapsed}ms`);

    if (product) {
      productCache.set(key, product);
      // Evict oldest if needed
      if (productCache.size > PRODUCT_CACHE_LIMIT) {
        const oldestKey = productCache.keys().next().value;
        productCache.delete(oldestKey);
      }
    }
    if (!product) console.log(`🔍 Lookup miss for key="${key}" (tried digits-only: ${key.replace(/\D/g,'')})`);
    return product || null;
  } catch (err) {
    console.error('❌ DB query error:', err);
    return null;
  }
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Create image: gambar produk (atas) + nama produk + barcode + harga (bawah) - OPTIMIZED FOR WHATSAPP
async function createBarcodeImage(product, options = {}) {
  const plu = product.plu || 'N/A';
  const barcode = product.barcode || '';
  const nama = product.productName || product.nama || 'Nama Tidak Tersedia';
  const price = product.price || '-';

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
        scale: 3.5,
        height: 15,
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

  // Dimension optimal untuk WhatsApp (540px standard width)
  const width = 540;
  const productHeight = 300;    // Gambar produk
  const namaHeight = 80;        // Nama produk CENTER
  const barcodeHeight = 200;    // Barcode (diperbesar untuk visibility)
  const priceHeight = 80;       // Harga CENTER
  const totalHeight = productHeight + namaHeight + barcodeHeight + priceHeight + 10;

  // 1. Product image (fetch from CDN or use placeholder)
  let productImage;
  const gambarUrl = product.gambar || '';
  
  if (gambarUrl && gambarUrl.trim() !== '') {
    try {
      // Try to fetch real product image
      const response = await fetch(gambarUrl, {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (response.ok) {
        const buffer = await response.buffer();
        // Use 'contain' to show full image without cropping, with white background
        productImage = await sharp(buffer)
          .resize(width, productHeight, { fit: 'contain', background: '#ffffff' })
          .png()
          .toBuffer();
        console.log(`✅ Product image fetched for ${plu}`);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (e) {
      // Fallback to placeholder if fetch fails
      console.warn(`⚠️  Image fetch failed for ${plu}: ${e.message}, using placeholder`);
      productImage = await sharp({
        create: {
          width: width,
          height: productHeight,
          channels: 3,
          background: '#e8e8e8'
        }
      }).png().toBuffer();
    }
  } else {
    // No image URL - use gray placeholder
    productImage = await sharp({
      create: {
        width: width,
        height: productHeight,
        channels: 3,
        background: '#e8e8e8'
      }
    }).png().toBuffer();
  }


  // 2. Nama produk SVG (CENTER)
  const namaLines = nama.length > 40 ? nama.substring(0, 40) : nama;
  const namaSvg = `
    <svg width="${width}" height="${namaHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${namaHeight}" fill="#ffffff" stroke="#333" stroke-width="1"/>
      <text x="${width/2}" y="50" text-anchor="middle" font-size="18" font-weight="bold" fill="#000000">${esc(namaLines)}</text>
    </svg>
  `;
  const namaPng = await sharp(Buffer.from(namaSvg)).png().toBuffer();

  // 3. Resize barcode untuk WhatsApp optimal
  const barcodeResized = await sharp(barcodePng)
    .resize(Math.max(1, width - 80), null, { withoutEnlargement: true })
    .png()
    .toBuffer();

  // Get barcode metadata untuk centering
  const barcodeMeta = await sharp(barcodeResized).metadata();

  // 4. Barcode section - HANYA BARCODE IMAGE (HAPUS TEKS ANGKA)
  const barcodeSectionSvg = `
    <svg width="${width}" height="${barcodeHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${barcodeHeight}" fill="#ffffff" stroke="#333" stroke-width="1"/>
    </svg>
  `;
  
  const barcodeLeftPos = (width - barcodeMeta.width) / 2;
  // Ensure barcode doesn't exceed section height
  const barcodeTopPos = Math.max(5, Math.min(barcodeHeight - barcodeMeta.height - 5, (barcodeHeight - barcodeMeta.height) / 2));
  const barcodeWithCodePng = await sharp(Buffer.from(barcodeSectionSvg))
    .png()
    .composite([
      { input: barcodeResized, top: Math.round(barcodeTopPos), left: Math.round(barcodeLeftPos) }
    ])
    .png()
    .toBuffer();

  // 5. Harga SVG (CENTER)
  const priceDisplay = price && price !== '-' ? price : 'Rp 0,-';
  const priceSvg = `
    <svg width="${width}" height="${priceHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="priceGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#ff6b6b;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#ee5a52;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${priceHeight}" fill="url(#priceGrad)" stroke="#333" stroke-width="1"/>
      <text x="${width/2}" y="55" text-anchor="middle" font-size="28" font-weight="bold" fill="#ffffff">${esc(priceDisplay)}</text>
    </svg>
  `;
  const pricePng = await sharp(Buffer.from(priceSvg)).png().toBuffer();

  // 6. Composite: gambar + nama + barcode + harga
  const canvas = sharp({
    create: {
      width: width,
      height: totalHeight,
      channels: 3,
      background: '#ffffff'
    }
  });

  const final = await canvas.composite([
    { input: productImage, top: 0, left: 0 },
    { input: namaPng, top: productHeight, left: 0 },
    { input: barcodeWithCodePng, top: productHeight + namaHeight + 10, left: 0 },
    { input: pricePng, top: productHeight + namaHeight + barcodeHeight + 10, left: 0 }
  ]).png().toBuffer();

  return final;
}

// Generate bulk image (multiple labels) - WHATSAPP OPTIMIZED dengan 540px width
async function generateBulkImage(product, qty) {
  if (qty <= 0 || qty > 200) throw new Error('qty invalid');

  const plu = product.plu || 'N/A';
  const barcode = product.barcode || '';
  const nama = product.productName || product.nama || 'Nama Tidak Tersedia';
  const price = product.price || '-';

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
      bcid, text: codeToRender, scale: 3.5, height: 15, includetext: true, textxalign: 'center'
    });
    barcodeCache.set(cacheKey, barcodePng);
  }

  // Label dimensions - WhatsApp optimized (540px width standard)
  const width = 540;
  const productHeight = 300;     // Gambar produk
  const namaHeight = 80;         // Nama produk CENTER
  const barcodeHeight = 200;     // Barcode (diperbesar untuk visibility)
  const qtyHeight = 60;          // Quantity section (BARU - untuk info jumlah)
  const priceHeight = 80;        // Harga CENTER
  const totalHeight = productHeight + namaHeight + barcodeHeight + qtyHeight + priceHeight + 10;

  // 1. Product image (fetch from CDN or use placeholder)
  let productImage;
  const gambarUrl = product.gambar || '';
  
  if (gambarUrl && gambarUrl.trim() !== '') {
    try {
      // Try to fetch real product image
      const response = await fetch(gambarUrl, {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (response.ok) {
        const buffer = await response.buffer();
        // Use 'contain' to show full image without cropping
        productImage = await sharp(buffer)
          .resize(width, productHeight, { fit: 'contain', background: '#ffffff' })
          .png()
          .toBuffer();
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (e) {
      // Fallback to placeholder if fetch fails
      productImage = await sharp({
        create: { width: width, height: productHeight, channels: 3, background: '#e8e8e8' }
      }).png().toBuffer();
    }
  } else {
    // No image URL - use gray placeholder
    productImage = await sharp({
      create: { width: width, height: productHeight, channels: 3, background: '#e8e8e8' }
    }).png().toBuffer();
  }

  // 2. Nama produk CENTER
  const namaLines = nama.length > 40 ? nama.substring(0, 40) : nama;
  const namaSvg = `
    <svg width="${width}" height="${namaHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${namaHeight}" fill="#ffffff" stroke="#333" stroke-width="1"/>
      <text x="${width/2}" y="50" text-anchor="middle" font-size="18" font-weight="bold" fill="#000">${esc(namaLines)}</text>
    </svg>
  `;
  const namaPng = await sharp(Buffer.from(namaSvg)).png().toBuffer();

  // 3. Barcode resized untuk WhatsApp
  const barcodeResized = await sharp(barcodePng)
    .resize(Math.max(1, width - 80), null, { withoutEnlargement: true })
    .png()
    .toBuffer();

  // Get barcode metadata untuk centering
  const barcodeMeta = await sharp(barcodeResized).metadata();

  // 4. Barcode section - HANYA BARCODE IMAGE
  const barcodeSvg = `
    <svg width="${width}" height="${barcodeHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${barcodeHeight}" fill="#ffffff" stroke="#333" stroke-width="1"/>
    </svg>
  `;
  const barcodeLeftPos = (width - barcodeMeta.width) / 2;
  const barcodeTopPos = Math.max(5, Math.min(barcodeHeight - barcodeMeta.height - 5, (barcodeHeight - barcodeMeta.height) / 2));
  const barcodeWithCodePng = await sharp(Buffer.from(barcodeSvg))
    .png()
    .composite([
      { input: barcodeResized, top: Math.round(barcodeTopPos), left: Math.round(barcodeLeftPos) }
    ])
    .png()
    .toBuffer();

  // 5. Quantity section (BARU - single label untuk bulk)
  const qtySvg = `
    <svg width="${width}" height="${qtyHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="qtyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#4c7dff;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#2c5aa0;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${qtyHeight}" fill="url(#qtyGrad)" stroke="#333" stroke-width="1"/>
      <text x="${width/2}" y="42" text-anchor="middle" font-size="32" font-weight="bold" fill="#ffffff">Qty: ${qty}</text>
    </svg>
  `;
  const qtyPng = await sharp(Buffer.from(qtySvg)).png().toBuffer();

  // 6. Harga CENTER dengan gradient
  const priceDisplay = price && price !== '-' ? price : 'Rp 0,-';
  const priceSvg = `
    <svg width="${width}" height="${priceHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="priceGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#ff6b6b;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#ee5a52;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${priceHeight}" fill="url(#priceGrad)" stroke="#333" stroke-width="1"/>
      <text x="${width/2}" y="55" text-anchor="middle" font-size="28" font-weight="bold" fill="#ffffff">${esc(priceDisplay)}</text>
    </svg>
  `;
  const pricePng = await sharp(Buffer.from(priceSvg)).png().toBuffer();

  // 7. Composite: SINGLE LABEL dengan quantity info
  const final = await sharp({
    create: {
      width: width,
      height: totalHeight,
      channels: 3,
      background: '#ffffff'
    }
  })
    .composite([
      { input: productImage, top: 0, left: 0 },
      { input: namaPng, top: productHeight, left: 0 },
      { input: barcodeWithCodePng, top: productHeight + namaHeight, left: 0 },
      { input: qtyPng, top: productHeight + namaHeight + barcodeHeight, left: 0 },
      { input: pricePng, top: productHeight + namaHeight + barcodeHeight + qtyHeight, left: 0 }
    ])
    .png()
    .toBuffer();

  return final;
}

// Send barcode
async function sendBarcodeInfo(msg, product, client) {
  try {
    await client.sendMessage(msg.from, '⏳ Membuat barcode...');
    const buffer = await createBarcodeImage(product);
    const media = new MessageMedia('image/png', buffer.toString('base64'), 'barcode.png');
    
    const caption = `✅ *PLU:* ${product.plu || 'N/A'}\n*Nama:* ${product.productName || product.nama || 'N/A'}\n\n📦 Gunakan:\n• .bulk <qty> untuk banyak label\n• .plu <plu1> <plu2> untuk cari multiple`;
    
    await client.sendMessage(msg.from, media, { caption });
    lastProductByChat.set(msg.from, product);
    
  } catch (err) {
    console.error('❌ Error creating barcode:', err);
    await client.sendMessage(msg.from, '❌ Error membuat barcode');
  }
}

// Initialize client (use LocalAuth to persist session)
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'whatsapp-bot' }),
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

client.on('authenticated', (session) => {
  console.log('🔐 Authenticated with WhatsApp');
});

client.on('auth_failure', (msg) => {
  console.error('❌ Authentication failure:', msg);
});

client.on('qr', (qr) => {
  console.log('\n📱 Scan QR code below with WhatsApp to login:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp Bot Ready!');
  console.log('📝 Send PLU or Barcode to search');
  console.log('📋 Commands: .plu <plu1> <plu2> ... or .bulk <qty> <plu>');
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

      // Send quick acknowledgement so user sees bot is processing
      await client.sendMessage(msg.from, '⏳ Mencari beberapa PLU...');

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

      await client.sendMessage(msg.from, `⏳ Membuat ${qty} label...`);
      try {
        const buffer = await generateBulkImage(product, qty);
        const media = new MessageMedia('image/png', buffer.toString('base64'), `bulk-${qty}.png`);
        await client.sendMessage(msg.from, media, { caption: `✅ Bulk ${qty}x ${product.plu}` });
      } catch (err) {
        console.error('❌ Bulk error:', err);
        await client.sendMessage(msg.from, '❌ Error membuat bulk');
      }
      return;
    }

    // Default: search lokal
    await client.sendMessage(msg.from, '⏳ Mencari produk...');
    const product = await findProductLocally(userMessage);
    if (product) {
      await sendBarcodeInfo(msg, product, client);
    } else {
      await client.sendMessage(msg.from, `❌ PLU/Barcode "${userMessage}" tidak ditemukan\n\nGunakan:\n• PLU: 10000019\n• Barcode: 8992702000018\n• Multiple: .plu 10000019 10000020\n• Bulk: .bulk 10 10000019`);
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
