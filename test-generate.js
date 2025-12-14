const bwipjs = require('bwip-js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function run() {
  try {
    const codeToRender = '8992702000018';
    const nama = 'Mie Instan Favorit';
    const plu = '10000019';

    console.log('🎨 Testing barcode generation...');

    const isDigits = /^\d+$/.test(codeToRender);
    let bcid = 'code128';
    if (isDigits && codeToRender.length === 13) bcid = 'ean13';
    else if (isDigits && codeToRender.length === 12) bcid = 'upca';

    console.log(`📊 Barcode type: ${bcid}`);

    const barcodePng = await bwipjs.toBuffer({
      bcid: bcid,
      text: codeToRender,
      scale: 3,
      height: 15,
      includetext: true,
      textxalign: 'center'
    });

    console.log('✅ Barcode generated');

    // Layout POS-standard
    const width = 800;
    const productHeight = 600;
    const barcodeHeight = 150;
    const infoHeight = 200;
    const totalHeight = productHeight + barcodeHeight + infoHeight + 40;

    // 1. Product placeholder
    const productImage = await sharp({
      create: {
        width: width,
        height: productHeight,
        channels: 3,
        background: '#e8e8e8'
      }
    }).png().toBuffer();

    console.log('✅ Product placeholder created');

    // 2. Resize barcode
    const barcodeResized = await sharp(barcodePng)
      .resize(width - 40, null, { withoutEnlargement: true })
      .png()
      .toBuffer();

    console.log('✅ Barcode resized');

    // 3. Info SVG dengan layout baru
    const infoSvg = `
      <svg width="${width}" height="${infoHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${infoHeight}" fill="#ffffff" stroke="#000" stroke-width="2"/>
        <text x="20" y="50" font-size="36" font-weight="bold" fill="#000000">PLU: ${esc(plu)}</text>
        <text x="20" y="100" font-size="28" fill="#333333">${esc(nama)}</text>
        <text x="20" y="145" font-size="20" fill="#666666">Barcode: ${esc(codeToRender)}</text>
        <text x="20" y="185" font-size="18" fill="#999999">Scan barcode untuk checkout</text>
      </svg>
    `;

    const infoPng = await sharp(Buffer.from(infoSvg))
      .png()
      .toBuffer();

    console.log('✅ Info SVG created');

    const finalImageBuffer = await sharp({ create: { width: targetWidth, height: totalHeight, channels: 3, background: '#ffffff' } })
      .composite([
        { input: prodResized, top: 0, left: 0 },
        { input: infoPng, top: prodMeta.height, left: 0 },
        { input: barcodeResized, top: prodMeta.height + infoHeight, left: 0 }
      ])
      .png()
      .toBuffer();

    const outPath = './test-output.png';
    fs.writeFileSync(outPath, finalImageBuffer);
    console.log('✅ Wrote test image to', outPath);
  } catch (err) {
    console.error('❌ Test generation failed:', err);
    process.exit(1);
  }
}

run();
