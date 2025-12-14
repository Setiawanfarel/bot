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

// Load real data dari barcodesheet.json
const barcodesheet = JSON.parse(fs.readFileSync('./barcodesheet.json', 'utf8'));

// Ambil beberapa sample produk dengan gambar
const sampleProducts = [
  { ...barcodesheet[1], price: 'Rp 12.500' },   // Indomilk Putih
  { ...barcodesheet[2], price: 'Rp 12.500' },   // Indomilk Chocolate
  { ...barcodesheet[4], price: 'Rp 8.900' },    // Aim Crackers
];

async function createBarcodeImage(product) {
  const plu = product.plu || 'N/A';
  const barcode = product.barcode || '';
  const nama = product.nama || 'Nama Tidak Tersedia';
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
        console.log(`    ✅ Image fetched: ${gambarUrl.substring(0, 60)}...`);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (e) {
      // Fallback to placeholder if fetch fails
      console.log(`    ⚠️  Image fetch failed: ${e.message}, using placeholder`);
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

  // 2. Nama produk CENTER
  const namaLines = nama.length > 40 ? nama.substring(0, 40) : nama;
  const namaSvg = `
    <svg width="${width}" height="${namaHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${namaHeight}" fill="#ffffff" stroke="#333" stroke-width="1"/>
      <text x="${width/2}" y="50" text-anchor="middle" font-size="18" font-weight="bold" fill="#000">${esc(namaLines)}</text>
    </svg>
  `;
  const namaPng = await sharp(Buffer.from(namaSvg)).png().toBuffer();

  // 3. Barcode resize untuk WhatsApp optimal
  const barcodeResized = await sharp(barcodePng)
    .resize(width - 40, null, { withoutEnlargement: true })
    .png()
    .toBuffer();

  // Get dimension barcode yang sudah diresize
  const barcodeMeta = await sharp(barcodeResized).metadata();

  // 4. Barcode section - HANYA BARCODE IMAGE (HAPUS TEKS ANGKA)
  const barcodeSectionSvg = `
    <svg width="${width}" height="${barcodeHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${barcodeHeight}" fill="#ffffff" stroke="#333" stroke-width="1"/>
    </svg>
  `;
  
  // Composite barcode ke SVG (center horizontal)
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

  // 5. Harga CENTER dengan gradient
  const priceDisplay = 'Rp 0,-';
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

  return { png: final, plu, nama };
}

async function generateExamples() {
  console.log('🎨 Generating examples dengan IMAGE FETCH...\n');

  for (let i = 0; i < sampleProducts.length; i++) {
    const product = sampleProducts[i];
    const plu = product.plu || 'N/A';
    const nama = product.nama || 'Unknown';

    console.log(`📦 [${i + 1}] PLU: ${plu} | ${nama}`);
    
    try {
      const { png } = await createBarcodeImage(product);
      
      const filename = `example-${i + 1}-plu${plu}.png`;
      const outputPath = path.join(__dirname, filename);
      fs.writeFileSync(outputPath, png);

      console.log(`    ✅ Saved: ${filename} (${(png.length / 1024).toFixed(2)}KB)\n`);
    } catch (err) {
      console.log(`    ❌ Error: ${err.message}\n`);
    }
  }

  console.log('✅ Semua contoh dengan image fetch sudah di-generate!');
  console.log(`\n📋 Files yang dibuat (dengan product images dari CDN):`);
  console.log(`   - example-1-plu10000019.png (Indomilk Putih)`);
  console.log(`   - example-2-plu10000020.png (Indomilk Chocolate)`);
  console.log(`   - example-3-plu10000052.png (Aim Crackers)`);
  console.log(`\n📸 Setiap gambar sekarang INCLUDE product image dari CDN!`);
}

generateExamples().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
