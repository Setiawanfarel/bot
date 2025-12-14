const bwipjs = require('bwip-js');
const sharp = require('sharp');
const fs = require('fs');

async function run() {
  try {
    const codeToRender = '8992702000018'; // contoh barcode EAN-13
    const nama = 'Contoh Produk Test';
    const plu = '10000019';

    const isDigits = /^\d+$/.test(codeToRender);
    let bcid = 'code128';
    if (isDigits && codeToRender.length === 13) bcid = 'ean13';
    else if (isDigits && codeToRender.length === 12) bcid = 'upca';

    const barcodePng = await bwipjs.toBuffer({
      bcid: bcid,
      text: codeToRender,
      scale: 4,
      height: 80,
      includetext: true,
      textxalign: 'center'
    });

    // Buat placeholder produk lokal (tanpa internet)
    const targetWidth = 1000;
    const productHeight = 600;
    const prodBuf = await sharp({ create: { width: targetWidth, height: productHeight, channels: 3, background: '#f6f6f6' } }).png().toBuffer();
    const prodResized = await sharp(prodBuf).resize({ width: targetWidth }).png().toBuffer();
    const prodMeta = await sharp(prodResized).metadata();

    // Buat SVG info block
    const lines = [nama, `PLU: ${plu}`];
    const fontSize = 36;
    const lineHeight = Math.round(fontSize * 1.4);
    const padding = 20;
    const infoHeight = padding * 2 + lineHeight * lines.length;
    const svgLines = lines.map((ln, i) => `<text x="${padding}" y="${padding + lineHeight * (i + 0.8)}" class="t">${ln}</text>`).join('');
    const infoSvg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${targetWidth}" height="${infoHeight}">\n  <rect width="100%" height="100%" fill="#ffffff"/>\n  <style>.t{font-family: Arial, Helvetica, sans-serif; font-size: ${fontSize}px; fill: #000000;}</style>\n  ${svgLines}\n</svg>`;
    const infoPng = await sharp(Buffer.from(infoSvg)).png().toBuffer();

    // Resize barcode
    const barcodeResized = await sharp(barcodePng).resize({ width: targetWidth }).png().toBuffer();
    const barMeta = await sharp(barcodeResized).metadata();

    const totalHeight = prodMeta.height + infoHeight + barMeta.height;

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
