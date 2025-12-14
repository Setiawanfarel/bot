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

async function generateBarcodeForPLU(plu) {
  const product = barcodesheet.find(p => p.plu === plu);
  
  if (!product) {
    console.log(`❌ PLU ${plu} not found in barcodesheet`);
    return;
  }

  console.log(`\n🎨 Generating barcode for PLU ${plu}...`);
  console.log(`📦 Product: ${product.nama}`);
  console.log(`🔖 Barcode: ${product.barcode}\n`);

  try {
    const barcode = product.barcode || product.plu;
    const codeToRender = barcode;

    // Detect barcode type
    const isDigits = /^\d+$/.test(codeToRender);
    let bcid = 'code128';
    if (isDigits && codeToRender.length === 13) bcid = 'ean13';
    else if (isDigits && codeToRender.length === 12) bcid = 'upca';

    // Generate barcode
    const cacheKey = `${bcid}:${codeToRender}`;
    let barcodePng = barcodeCache.get(cacheKey);

    if (!barcodePng) {
      barcodePng = await bwipjs.toBuffer({
        bcid,
        text: codeToRender,
        scale: 3.5,
        height: 15,
        includetext: true,
        textxalign: 'center'
      });
      barcodeCache.set(cacheKey, barcodePng);
    }

    // Dimensions
    const width = 540;
    const productHeight = 300;
    const namaHeight = 80;
    const barcodeHeight = 200;
    const priceHeight = 80;
    const totalHeight = productHeight + namaHeight + barcodeHeight + priceHeight + 10;

    // 1. Fetch product image
    console.log('📥 Fetching product image...');
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
          console.log(`✅ Image fetched (${(buffer.length / 1024).toFixed(2)}KB)`);
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (e) {
        console.log(`⚠️  Image fetch failed: ${e.message}, using placeholder`);
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
      productImage = await sharp({
        create: {
          width: width,
          height: productHeight,
          channels: 3,
          background: '#e8e8e8'
        }
      }).png().toBuffer();
    }

    // 2. Nama produk
    const namaLines = product.nama.length > 40 ? product.nama.substring(0, 40) : product.nama;
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

    const barcodeSectionSvg = `
      <svg width="${width}" height="${barcodeHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${barcodeHeight}" fill="#ffffff" stroke="#333" stroke-width="1"/>
      </svg>
    `;
    
    const barcodeLeftPos = (width - barcodeMeta.width) / 2;
    const barcodeTopPos = Math.max(5, Math.min(barcodeHeight - barcodeMeta.height - 5, (barcodeHeight - barcodeMeta.height) / 2));
    const barcodeWithCodePng = await sharp(Buffer.from(barcodeSectionSvg))
      .png()
      .composite([
        { input: barcodeResized, top: Math.round(barcodeTopPos), left: Math.round(barcodeLeftPos) }
      ])
      .png()
      .toBuffer();

    // 4. Price (mock - tidak ada di barcodesheet)
    const priceDisplay = product.price || 'Rp 0,-';
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

    // 5. Composite
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
        { input: pricePng, top: productHeight + namaHeight + barcodeHeight + 10, left: 0 }
      ])
      .png()
      .toBuffer();

    const filename = `test-plu-${plu}.png`;
    const outputPath = path.join(__dirname, filename);
    fs.writeFileSync(outputPath, final);

    console.log(`\n✅ SUCCESS!`);
    console.log(`📍 Saved: ${filename}`);
    console.log(`📏 Dimensions: ${width}x${totalHeight}px`);
    console.log(`💾 File size: ${(final.length / 1024).toFixed(2)}KB`);
    console.log(`\n📋 Layout:`);
    console.log(`   - Product image: ${productHeight}px (dari CDN)`);
    console.log(`   - Nama: ${namaHeight}px`);
    console.log(`   - Barcode: ${barcodeHeight}px`);
    console.log(`   - Price: ${priceHeight}px`);

  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

// Test dengan PLU 20132698
generateBarcodeForPLU('20132698');
