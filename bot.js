const { Client, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const bwipjs = require('bwip-js');
const sharp = require('sharp');

// safe fetch: use global fetch if available, otherwise dynamically import node-fetch
const fetchFunc = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args);
  return import('node-fetch').then(m => m.default(...args));
};

// URL API dari environment variables
const API_URL = process.env.API_URL || 'https://idmhelp.vercel.app/api/search?q=';

// Load barcode data lokal and build indexed maps for O(1) lookup
let barcodeData = [];
let pluMap = new Map();  // PLU -> product
let barcodeMap = new Map();  // barcode -> product
try {
  const dataPath = path.join(__dirname, 'barcodesheet.json');
  barcodeData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  // Build index maps
  barcodeData.forEach(item => {
    if (item.plu) pluMap.set(item.plu, item);
    if (item.barcode) barcodeMap.set(item.barcode, item);
  });
  console.log(`✅ Loaded ${barcodeData.length} local barcode records`);
} catch (error) {
  console.error('❌ Error loading barcodesheet.json:', error);
}

// Barcode cache: bcid+text -> buffer
const barcodeCache = new Map();

// Keep last requested product per chat to support .bulk without repeating PLU
const lastProductByChat = new Map();

// Helper: Fast lookup by PLU or barcode
function findProductLocally(query) {
  return pluMap.get(query) || barcodeMap.get(query) || null;
}

// Fungsi untuk mengambil data dari API
async function fetchProductFromAPI(query) {
  try {
    console.log(`📡 Fetching product from API for query: ${query}`);
    const response = await fetchFunc(`${API_URL}${encodeURIComponent(query)}`);
    if (!response || !response.ok) {
      console.error(`API returned status ${response && response.status}`);
      return null;
    }
    const rawData = await response.json();
    if (rawData && Array.isArray(rawData.data) && rawData.data.length > 0) {
      return rawData.data[0];
    }
    return null;
  } catch (error) {
    console.error('❌ Error fetching from API:', error && (error.message || error));
    return null;
  }
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Create combined image: product image (top), info block, barcode (bottom)
// OPTIMIZED: parallel fetch + caching
async function createCombinedImage(product, options = {}) {
  const targetWidth = options.targetWidth || 1000;
  const sidePadding = options.sidePadding || 60;
  const barcodeScale = options.barcodeScale || 2;
  const barcodeHeight = options.barcodeHeight || 15;

  const plu = product.plu || 'N/A';
  const barcode = product.barcode || '';
  const nama = product.productName || product.nama || 'Nama Tidak Tersedia';
  const gambar = product.imageUrl || product.gambar || '';

  const codeToRender = (barcode && barcode.trim() !== '') ? barcode : plu;

  // Determine barcode type
  const isDigits = /^\d+$/.test(codeToRender);
  let bcid = 'code128';
  if (isDigits && codeToRender.length === 13) bcid = 'ean13';
  else if (isDigits && codeToRender.length === 12) bcid = 'upca';

  // Check cache first
  const cacheKey = `${bcid}:${codeToRender}`;
  let barcodePng = barcodeCache.get(cacheKey);
  
  // Parallel: fetch image + generate barcode (if not cached)
  const [prodBuf] = await Promise.all([
    // Fetch product image with timeout and fallback
    (async () => {
      if (!gambar || gambar.trim() === '') {
        console.log('⚠️ No image URL provided, using blank fallback');
        return null;
      }
      try {
        const res = await fetchFunc(gambar, { timeout: 8000 });
        if (res && res.ok) {
          if (typeof res.arrayBuffer === 'function') {
            const ab = await res.arrayBuffer();
            return Buffer.from(ab);
          } else if (typeof res.buffer === 'function') {
            return await res.buffer();
          }
        } else {
          console.log(`⚠️ Image fetch failed with status ${res && res.status}`);
          return null;
        }
      } catch (e) {
        console.log(`⚠️ Image fetch error: ${e && e.message}`);
        return null;
      }
    })(),
    
    // Generate barcode (or use cache)
    (async () => {
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
          // Cache it
          barcodeCache.set(cacheKey, barcodePng);
        } catch (e) {
          console.error('❌ Barcode generation failed:', e);
          throw new Error(`Barcode generation error: ${e.message}`);
        }
      }
    })()
  ]);

  // Resize product image OR create blank fallback
  let prodResized;
  let prodMeta = { width: targetWidth, height: 500 };  // default dimensions
  
  if (prodBuf) {
    try {
      const meta = await sharp(prodBuf).metadata();
      const aspectRatio = meta.width / meta.height;
      const resizedHeight = Math.round(targetWidth / aspectRatio);
      prodResized = await sharp(prodBuf)
        .resize(targetWidth, resizedHeight, { fit: 'cover', withoutEnlargement: true })
        .png()
        .toBuffer();
      prodMeta = { width: targetWidth, height: resizedHeight };
      console.log(`✅ Image resized to ${targetWidth}x${resizedHeight}`);
    } catch (e) {
      console.warn(`⚠️ Image processing failed, using blank: ${e.message}`);
      prodResized = await sharp({ 
        create: { width: targetWidth, height: 500, channels: 3, background: '#f0f0f0' } 
      }).png().toBuffer();
      prodMeta = { width: targetWidth, height: 500 };
    }
  } else {
    // Create blank image with light gray background
    prodResized = await sharp({ 
      create: { width: targetWidth, height: 500, channels: 3, background: '#f0f0f0' } 
    }).png().toBuffer();
    prodMeta = { width: targetWidth, height: 500 };
  }

  // Resize barcode
  const barcodeResized = await sharp(barcodePng)
    .resize(targetWidth - 2 * sidePadding, null, { withoutEnlargement: true })
    .png()
    .toBuffer();
  const barcodeMeta = await sharp(barcodeResized).metadata();

  // Create info SVG
  const infoWidth = targetWidth;
  const infoHeight = 120;
  const infoSvg = `
    <svg width="${infoWidth}" height="${infoHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${infoWidth}" height="${infoHeight}" fill="#ffffff" stroke="#cccccc" stroke-width="1"/>
      <text x="10" y="30" font-size="18" font-weight="bold" fill="#000000">PLU: ${esc(plu)}</text>
      <text x="10" y="60" font-size="14" fill="#333333">Nama: ${esc(nama)}</text>
      <text x="10" y="90" font-size="12" fill="#666666">Barcode: ${esc(codeToRender)}</text>
    </svg>
  `;
  const infoPng = await sharp(Buffer.from(infoSvg)).png().toBuffer();

  // Final composite
  const labelHeight = prodMeta.height + infoHeight + barcodeMeta.height + 40;
  const canvas = sharp({ 
    create: { width: targetWidth, height: labelHeight, channels: 3, background: '#ffffff' } 
  });

  const composite = await canvas.composite([
    { input: prodResized, top: 0, left: 0 },
    { input: infoPng, top: prodMeta.height, left: 0 },
    { input: barcodeResized, top: prodMeta.height + infoHeight + 20, left: sidePadding }
  ]).png().toBuffer();

  return composite;
}

// Generate a bulk image composed of `qty` small labels stacked vertically
async function generateBulkImage(product, qty) {
  if (qty <= 0) throw new Error('qty must be > 0');
  if (qty > 200) throw new Error('qty too large');

  // label settings (smaller than single image)
  const labelWidth = 800;
  const productHeight = 220;
  const sidePadding = 20;
  const barcodeScale = 2;
  const barcodeHeight = 15;

  // Parallel fetch image + prepare barcode
  const codeToRender = (product.barcode && product.barcode.trim() !== '') ? product.barcode : (product.plu || '000000');
  const isDigits = /^\d+$/.test(codeToRender);
  let bcid = 'code128';
  if (isDigits && codeToRender.length === 13) bcid = 'ean13';
  else if (isDigits && codeToRender.length === 12) bcid = 'upca';

  const cacheKey = `${bcid}:${codeToRender}`;
  let barcodePng = barcodeCache.get(cacheKey);

  const gambar = product.imageUrl || product.gambar || '';
  
  // Parallel: fetch image + barcode generation
  const [prodBuf] = await Promise.all([
    (async () => {
      if (!gambar || gambar.trim() === '') return null;
      try {
        const res = await fetchFunc(gambar, { timeout: 8000 });
        if (res && res.ok) {
          if (typeof res.arrayBuffer === 'function') {
            const ab = await res.arrayBuffer();
            return Buffer.from(ab);
          } else if (typeof res.buffer === 'function') {
            return await res.buffer();
          }
        }
      } catch (e) {
        console.log(`⚠️ Bulk image fetch error: ${e.message}`);
      }
      return null;
    })(),
    
    (async () => {
      if (!barcodePng) {
        try {
          barcodePng = await bwipjs.toBuffer({
            bcid, text: codeToRender, scale: barcodeScale, height: barcodeHeight, includetext: true, textxalign: 'center'
          });
          barcodeCache.set(cacheKey, barcodePng);
        } catch (e) {
          console.error('❌ Barcode gen error:', e);
        }
      }
    })()
  ]);

  // Resize product image
  let prodResized;
  let prodMeta = { width: labelWidth, height: productHeight };
  
  if (prodBuf) {
    try {
      const meta = await sharp(prodBuf).metadata();
      const aspectRatio = meta.width / meta.height;
      const resizedHeight = Math.round(labelWidth / aspectRatio);
      prodResized = await sharp(prodBuf).resize(labelWidth, resizedHeight, { fit: 'cover' }).png().toBuffer();
      prodMeta = { width: labelWidth, height: resizedHeight };
    } catch (e) {
      console.warn(`⚠️ Bulk image processing error, using blank`);
      prodResized = await sharp({ create: { width: labelWidth, height: productHeight, channels: 3, background: '#f0f0f0' } }).png().toBuffer();
    }
  } else {
    prodResized = await sharp({ create: { width: labelWidth, height: productHeight, channels: 3, background: '#f0f0f0' } }).png().toBuffer();
  }

  // Resize barcode
  const barcodeWidth = Math.max(150, labelWidth - sidePadding * 2);
  const barcodeResized = await sharp(barcodePng).resize(barcodeWidth, null, { withoutEnlargement: true }).png().toBuffer();
  const barMeta = await sharp(barcodeResized).metadata();

  // Info SVG for label
  const nama = product.productName || product.nama || 'Nama Tidak Tersedia';
  const plu = product.plu || '';
  const infoHeight = 60;
  const infoSvg = `
    <svg width="${labelWidth}" height="${infoHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${labelWidth}" height="${infoHeight}" fill="#ffffff" stroke="#ccc" stroke-width="1"/>
      <text x="10" y="20" font-size="14" font-weight="bold" fill="#000">${esc(nama)}</text>
      <text x="10" y="40" font-size="12" fill="#333">PLU: ${esc(plu)}</text>
    </svg>
  `;
  const infoPng = await sharp(Buffer.from(infoSvg)).png().toBuffer();

  const labelHeight = prodMeta.height + infoHeight + barMeta.height + 15;
  const totalHeight = labelHeight * qty;
  const canvas = sharp({ create: { width: labelWidth, height: totalHeight, channels: 3, background: '#ffffff' } });
  
  const composites = [];
  for (let i = 0; i < qty; i++) {
    const top = i * labelHeight;
    composites.push({ input: prodResized, top: top, left: 0 });
    composites.push({ input: infoPng, top: top + prodMeta.height, left: 0 });
    composites.push({ input: barcodeResized, top: top + prodMeta.height + infoHeight + 10, left: sidePadding });
  }

  const final = await canvas.composite(composites).png().toBuffer();
  return final;
}

// Fungsi untuk menangani balasan (single product)
async function sendProductInfo(msg, product, client) {
  try {
    const finalImageBuffer = await createCombinedImage(product, { barcodeHeight: 15 });
    const media = new MessageMedia('image/png', finalImageBuffer.toString('base64'), 'product-with-barcode.png');
    const caption = `Harga tidak tersedia!\n\n*PLU:* ${product.plu || 'N/A'}\n\nUNTUK MEMBUAT BARCODE DENGAN JUMLAH BANYAK.\nSILAHKAN KETIK .BULK`;

    await client.sendMessage(msg.from, media, { caption });

    // store last product for bulk convenience
    lastProductByChat.set(msg.from, product);
  } catch (err) {
    console.error('❌ Error creating/sending combined image:', err);
    await client.sendMessage(msg.from, '⚠️ Terjadi kesalahan saat membuat gambar produk/barcode. Silakan coba lagi.');
  }
}

// Initialize WhatsApp client with optimized puppeteer settings for VPS
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
    // Try to use system chromium first, fallback to bundled
    executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser'
  }
});

// Display QR code for login
client.on('qr', (qr) => {
  console.log('\n📱 Scan QR code below with WhatsApp to login:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp Bot is ready!');
  console.log('Send PLU or Barcode number to search for products');
  console.log('Or use: .v2 [PLU/Barcode] to search via API');
});

// Handle incoming messages
client.on('message', async (msg) => {
  try {
    const userMessage = msg.body.trim();

    // .plu command: search multiple PLU separated by space
    if (userMessage.toLowerCase().startsWith('.plu')) {
      const pluList = userMessage.substring(4).trim().split(/\s+/);
      if (pluList.length === 0 || !pluList[0]) {
        await client.sendMessage(msg.from, 'Format: .plu <PLU1> <PLU2> <PLU3> ...\\nContoh: .plu 10000019 10000020 10000021');
        return;
      }

      const results = [];
      for (const plu of pluList) {
        const product = findProductLocally(plu);
        if (product) {
          results.push(`✅ ${plu}: ${product.productName || product.nama}`);
        } else {
          results.push(`❌ ${plu}: Tidak ditemukan`);
        }
      }
      await client.sendMessage(msg.from, `*Hasil Pencarian Multiple PLU:*\n\n${results.join('\n')}`);
      return;
    }

    // .v2 lookup via API
    if (userMessage.toLowerCase().startsWith('.v2')) {
      const query = userMessage.substring(3).trim();
      if (query.length > 0) {
        const product = await fetchProductFromAPI(query);
        if (product) {
          await sendProductInfo(msg, product, client);
        } else {
          await client.sendMessage(msg.from, `❌ *Produk V2 tidak ditemukan*\n\nQuery: *${query}*`);
        }
      } else {
        await client.sendMessage(msg.from, 'Silakan tambahkan PLU atau Barcode setelah .v2 (Contoh: .v2 20040194)');
      }
      return;
    }

    // .bulk command
    if (userMessage.toLowerCase().startsWith('.bulk')) {
      const parts = userMessage.split(/\s+/).slice(1);
      const qty = parseInt(parts[0], 10);
      if (!qty || qty <= 0) {
        await client.sendMessage(msg.from, 'Gunakan: .bulk <qty> [PLU/Barcode]\nContoh: .bulk 10 10000019\nAtau: .bulk 10 (menggunakan produk terakhir yang dicari)');
        return;
      }
      if (qty > 50) {
        await client.sendMessage(msg.from, 'Maaf, jumlah maksimal untuk .bulk saat ini adalah 50. Mohon kurangi qty.');
        return;
      }

      let product = null;
      const codeArg = parts[1];
      if (codeArg) {
        // Use fast map lookup instead of find
        product = findProductLocally(codeArg);
        if (!product) product = await fetchProductFromAPI(codeArg);
      } else {
        product = lastProductByChat.get(msg.from) || null;
      }

      if (!product) {
        await client.sendMessage(msg.from, 'Produk tidak ditemukan. Sebutkan PLU/Barcode setelah .bulk atau cari produk terlebih dahulu.');
        return;
      }

      await client.sendMessage(msg.from, `Membuat ${qty} label untuk produk: ${product.productName || product.nama || product.plu} ...`);
      try {
        const bulkBuffer = await generateBulkImage(product, qty);
        const media = new MessageMedia('image/png', bulkBuffer.toString('base64'), `bulk-${product.plu || 'no-plu'}-${qty}.png`);
        await client.sendMessage(msg.from, media, { caption: `Bulk ${qty} x ${product.productName || product.nama || product.plu}` });
      } catch (err) {
        console.error('❌ Error generating bulk image:', err);
        await client.sendMessage(msg.from, 'Terjadi kesalahan saat membuat bulk image. Coba lagi nanti.');
      }

      return;
    }

    // Default: search local dataset by PLU or barcode (fast map lookup)
    const product = findProductLocally(userMessage);
    if (product) {
      await sendProductInfo(msg, product, client);
    } else {
      let response = `❌ *Produk tidak ditemukan* (Mode Lokal)\n\n`;
      response += `Silakan kirimkan:\n`;
      response += `• *PLU* (contoh: 10000019)\n`;
      response += `• *Barcode* (contoh: 8992702000018)\n\n`;
      response += `_Untuk mencoba pencarian via API, gunakan format: .v2 [PLU/Barcode]_`;
      await client.sendMessage(msg.from, response);
    }
  } catch (error) {
    console.error('❌ Error handling message:', error);
    await client.sendMessage(msg.from, '❌ Terjadi kesalahan pada bot. Silakan coba lagi nanti.');
  }
});

client.on('disconnected', (reason) => {
  console.log('❌ WhatsApp disconnected:', reason);
});

client.on('error', (error) => {
  console.error('❌ Client error:', error);
});

client.initialize();

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  client.destroy();
  process.exit(0);
});
