const fetch = require('node-fetch');
const bwipjs = require('bwip-js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const barcodeCache = new Map();

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Load barcodesheet
const barcodesheet = JSON.parse(fs.readFileSync('./barcodesheet.json', 'utf8'));

async function generateBulkImage(product, qty) {
  const plu = product.plu || 'N/A';
  const barcode = product.barcode || '';
  const nama = product.nama || 'Nama Tidak Tersedia';
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

  // Label dimensions
  const width = 540;
  const productHeight = 300;
  const namaHeight = 80;
  const barcodeHeight = 200;
  const qtyHeight = 60;        // Quantity section
  const priceHeight = 80;
  const totalHeight = productHeight + namaHeight + barcodeHeight + qtyHeight + priceHeight + 10;

  // 1. Product image
  let productImage;
  const gambarUrl = product.gambar || '';
  
  if (gambarUrl && gambarUrl.trim() !== '') {
    try {
      const response = await fetch(gambarUrl, {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (response.ok) {
        const buffer = await response.buffer();
        productImage = await sharp(buffer)
          .resize(width, productHeight, { fit: 'contain', background: '#ffffff' })
          .png()
          .toBuffer();
        console.log(`    ✅ Image fetched: ${gambarUrl.substring(0, 60)}...`);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (e) {
      productImage = await sharp({
        create: { width: width, height: productHeight, channels: 3, background: '#e8e8e8' }
      }).png().toBuffer();
    }
  } else {
    productImage = await sharp({
      create: { width: width, height: productHeight, channels: 3, background: '#e8e8e8' }
    }).png().toBuffer();
  }

  // 2. Nama produk
  const namaLines = nama.length > 40 ? nama.substring(0, 40) : nama;
  const namaSvg = `
    <svg width="${width}" height="${namaHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${namaHeight}" fill="#ffffff" stroke="#333" stroke-width="1"/>
      <text x="${width/2}" y="50" text-anchor="middle" font-size="18" font-weight="bold" fill="#000">${esc(namaLines)}</text>
    </svg>
  `;
  const namaPng = await sharp(Buffer.from(namaSvg)).png().toBuffer();

  // 3. Barcode
  const barcodeResized = await sharp(barcodePng)
    .resize(width - 40, null, { withoutEnlargement: true })
    .png()
    .toBuffer();

  const barcodeMeta = await sharp(barcodeResized).metadata();
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

  // 4. Quantity section (BARU - blue gradient)
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

  // 5. Harga
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

  // 6. Composite: SINGLE LABEL dengan quantity
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

async function testBulk() {
  console.log('🎨 Testing BULK dengan SINGLE LABEL + Quantity...\n');

  const product = barcodesheet.find(p => p.plu === '10000019');
  
  if (!product) {
    console.log('❌ Product not found');
    return;
  }

  const testQtys = [5, 12, 20];

  for (const qty of testQtys) {
    console.log(`📦 [${qty}x] ${product.nama}`);
    
    try {
      const png = await generateBulkImage(product, qty);
      const filename = `test-bulk-qty${qty}-plu${product.plu}.png`;
      const outputPath = path.join(__dirname, filename);
      fs.writeFileSync(outputPath, png);

      console.log(`    ✅ Saved: ${filename} (${(png.length / 1024).toFixed(2)}KB)`);
      console.log(`    📐 Dimensions: 540×${300 + 80 + 200 + 60 + 80 + 10}px\n`);
    } catch (err) {
      console.log(`    ❌ Error: ${err.message}\n`);
    }
  }

  console.log('✅ BULK test complete!');
  console.log('\n📝 Notes:');
  console.log('   - Hanya 1 label per file (bukan berulang)');
  console.log('   - Qty ditampilkan dalam BLUE GRADIENT box');
  console.log('   - Format: Product Image + Nama + Barcode + Qty + Price');
}

testBulk().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
