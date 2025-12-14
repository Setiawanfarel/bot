const bwipjs = require('bwip-js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function createTestBarcode() {
  try {
    console.log('🎨 Testing barcode generation (WHATSAPP OPTIMIZED)...\n');

    const plu = '10000019';
    const barcode = '8992702000018';
    const nama = 'Indomilk Susu Kental Manis Putih 370G';
    const price = 'Rp 12.500';
    const codeToRender = barcode || plu;

    // Detect barcode type
    const isDigits = /^\d+$/.test(codeToRender);
    let bcid = 'code128';
    if (isDigits && codeToRender.length === 13) bcid = 'ean13';
    else if (isDigits && codeToRender.length === 12) bcid = 'upca';

    console.log(`📊 Barcode type: ${bcid}`);
    console.log(`📝 Code: ${codeToRender}\n`);

    // Generate barcode (scale 3.5 untuk WhatsApp optimal)
    const barcodePng = await bwipjs.toBuffer({
      bcid: bcid,
      text: codeToRender,
      scale: 3.5,
      height: 15,
      includetext: true,
      textxalign: 'center'
    });

    console.log('✅ Barcode PNG generated (scale 3.5)');

    // Layout optimal untuk WhatsApp (540px width standard)
    const width = 540;
    const productHeight = 400;
    const namaHeight = 100;
    const barcodeHeight = 200;
    const priceHeight = 100;
    const totalHeight = productHeight + namaHeight + barcodeHeight + priceHeight + 20;

    // 1. Product placeholder
    const productImage = await sharp({
      create: {
        width: width,
        height: productHeight,
        channels: 3,
        background: '#e8e8e8'
      }
    }).png().toBuffer();

    console.log('✅ Gambar produk placeholder (500px)');

    // 2. Nama produk CENTER
    const namaLines = nama.length > 40 ? nama.substring(0, 40) : nama;
    const namaSvg = `
      <svg width="${width}" height="${namaHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${namaHeight}" fill="#ffffff" stroke="#000" stroke-width="1"/>
        <text x="${width/2}" y="55" text-anchor="middle" font-size="26" font-weight="bold" fill="#000000">${esc(namaLines)}</text>
      </svg>
    `;
    const namaPng = await sharp(Buffer.from(namaSvg)).png().toBuffer();

    console.log('✅ Nama produk CENTER (100px)');

    // 3. Barcode resize untuk WhatsApp optimal
    const barcodeResized = await sharp(barcodePng)
      .resize(width - 40, null, { withoutEnlargement: true })
      .png()
      .toBuffer();

    // Get dimension barcode yang sudah diresize
    const barcodeMeta = await sharp(barcodeResized).metadata();

    // 4. Barcode section dengan kode angka CENTER
    const barcodeSectionSvg = `
      <svg width="${width}" height="${barcodeHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${barcodeHeight}" fill="#ffffff" stroke="#333" stroke-width="1"/>
        <text x="${width/2}" y="${barcodeHeight - 10}" text-anchor="middle" font-size="18" font-weight="bold" fill="#000000">${esc(codeToRender)}</text>
      </svg>
    `;
    
    // Composite barcode ke SVG (center horizontal)
    const barcodeLeftPos = (width - barcodeMeta.width) / 2;
    const barcodeWithCodePng = await sharp(Buffer.from(barcodeSectionSvg))
      .png()
      .composite([
        { input: barcodeResized, top: 20, left: Math.round(barcodeLeftPos) }
      ])
      .png()
      .toBuffer();

    console.log('✅ Barcode scale 3 + angka CENTER (200px)');

    // 5. Harga CENTER dengan gradient
    const priceDisplay = price || 'Rp 0,-';
    const priceSvg = `
      <svg width="${width}" height="${priceHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="priceGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#ff6b6b;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#ee5a52;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="${width}" height="${priceHeight}" fill="url(#priceGrad)" stroke="#333" stroke-width="1"/>
        <text x="${width/2}" y="65" text-anchor="middle" font-size="36" font-weight="bold" fill="#ffffff">${esc(priceDisplay)}</text>
      </svg>
    `;
    const pricePng = await sharp(Buffer.from(priceSvg)).png().toBuffer();

    console.log('✅ Harga CENTER dengan gradient merah (100px)');

    // 6. Composite semua layer
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

    console.log('✅ Semua layer digabung');

    // Save
    const outputPath = path.join(__dirname, 'test-barcode-output.png');
    fs.writeFileSync(outputPath, final);

    console.log(`\n✅ SUCCESS! Test barcode image generated`);
    console.log(`📍 File: ${outputPath}`);
    console.log(`📏 Dimensions: ${width}x${totalHeight}px (WhatsApp optimized)`);
    console.log(`💾 File size: ${(final.length / 1024).toFixed(2)}KB`);
    console.log(`\n📋 Layout (SEMUA CENTER):`);
    console.log(`   1️⃣  Gambar produk: 400px (placeholder gray)`);
    console.log(`   2️⃣  Nama produk: 100px (26px bold, CENTER)`);
    console.log(`   3️⃣  Barcode: 200px (scale 3.5 + kode angka CENTER)`);
    console.log(`   4️⃣  Harga: 100px (36px bold gradient merah, CENTER)`);
    console.log(`\n📱 WHATSAPP OPTIMIZED - 540px width standard! ✨`);


  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
}

createTestBarcode();
