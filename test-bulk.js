const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const bwipjs = require('bwip-js');

// Helper function
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const barcodeCache = new Map();

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
      bcid, text: codeToRender, scale: 3, height: 15, includetext: true, textxalign: 'center'
    });
    barcodeCache.set(cacheKey, barcodePng);
  }

  // Label dimensions - WhatsApp optimized (540px width standard)
  const labelWidth = 540;
  const productH = 400;     // Gambar produk placeholder
  const namaH = 100;        // Nama produk CENTER
  const barcodeH = 200;     // Barcode + kode CENTER
  const priceH = 100;       // Harga CENTER
  const labelHeight = productH + namaH + barcodeH + priceH + 20;

  // 1. Product placeholder
  const productImg = await sharp({
    create: { width: labelWidth, height: productH, channels: 3, background: '#e8e8e8' }
  }).png().toBuffer();

  // 2. Nama produk CENTER
  const namaLines = nama.length > 40 ? nama.substring(0, 40) : nama;
  const namaSvg = `
    <svg width="${labelWidth}" height="${namaH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${labelWidth}" height="${namaH}" fill="#ffffff" stroke="#333" stroke-width="1"/>
      <text x="${labelWidth/2}" y="65" text-anchor="middle" font-size="22" font-weight="bold" fill="#000">${esc(namaLines)}</text>
    </svg>
  `;
  const namaPng = await sharp(Buffer.from(namaSvg)).png().toBuffer();

  // 3. Barcode resized untuk WhatsApp
  const barcodeResized = await sharp(barcodePng)
    .resize(labelWidth - 60, null, { withoutEnlargement: true })
    .png()
    .toBuffer();

  // Get barcode metadata untuk centering
  const barcodeMeta = await sharp(barcodeResized).metadata();

  // 4. Barcode section dengan kode angka CENTER
  const barcodeSvg = `
    <svg width="${labelWidth}" height="${barcodeH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${labelWidth}" height="${barcodeH}" fill="#ffffff" stroke="#333" stroke-width="1"/>
      <text x="${labelWidth/2}" y="${barcodeH - 10}" text-anchor="middle" font-size="18" font-weight="bold" fill="#000">${esc(codeToRender)}</text>
    </svg>
  `;
  const barcodeLeftPos = (labelWidth - barcodeMeta.width) / 2;
  const barcodeWithCodePng = await sharp(Buffer.from(barcodeSvg))
    .png()
    .composite([
      { input: barcodeResized, top: 20, left: Math.round(barcodeLeftPos) }
    ])
    .png()
    .toBuffer();

  // 5. Harga CENTER (merah bold)
  const priceSvg = `
    <svg width="${labelWidth}" height="${priceH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${labelWidth}" height="${priceH}" fill="#ffffff" stroke="#333" stroke-width="1"/>
      <text x="${labelWidth/2}" y="65" text-anchor="middle" font-size="36" font-weight="bold" fill="#d32f2f">${esc(price)}</text>
    </svg>
  `;
  const pricePng = await sharp(Buffer.from(priceSvg)).png().toBuffer();

  // Create bulk canvas
  const totalHeight = labelHeight * qty;
  const canvas = sharp({
    create: { width: labelWidth, height: totalHeight, channels: 3, background: '#ffffff' }
  });

  const composites = [];
  for (let i = 0; i < qty; i++) {
    const top = i * labelHeight;
    composites.push({ input: productImg, top: top, left: 0 });
    composites.push({ input: namaPng, top: top + productH, left: 0 });
    composites.push({ input: barcodeWithCodePng, top: top + productH + namaH, left: 0 });
    composites.push({ input: pricePng, top: top + productH + namaH + barcodeH + 10, left: 0 });
  }

  const final = await canvas.composite(composites).png().toBuffer();
  return final;
}

async function test() {
  try {
    const product = {
      plu: '10000019',
      barcode: '8992702000018',
      nama: 'Indomilk Susu Kental Manis Putih 370G',
      price: 'Rp 12.500'
    };

    console.log('🎨 Testing bulk image generation (qty 3)...\n');

    const img = await generateBulkImage(product, 3);
    const outputPath = path.join(__dirname, 'test-bulk-output.png');
    fs.writeFileSync(outputPath, img);

    console.log(`✅ Bulk image generated!`);
    console.log(`📍 File: ${outputPath}`);
    console.log(`📏 Dimensions: 540x${820 * 3}px (WhatsApp optimized, 3 labels)`);
    console.log(`💾 File size: ${(img.length / 1024).toFixed(2)}KB`);
    console.log(`\n✨ Each label: 540x820px`);

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

test();
