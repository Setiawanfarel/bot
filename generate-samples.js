const fs = require('fs');
const path = require('path');
const bwipjs = require('bwip-js');
const sharp = require('sharp');
const fetch = require('node-fetch');

const DATA_FILE = path.join(__dirname, 'barcodesheet.json');
const OUT_DIR = path.join(__dirname, 'outputs');
const COUNT = parseInt(process.env.SAMPLE_COUNT || '10', 10);

if (!fs.existsSync(DATA_FILE)) {
  console.error('barcodesheet.json not found in project root');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
fs.mkdirSync(OUT_DIR, { recursive: true });

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function fetchImageBuffer(url) {
  try {
    const res = await fetch(url, { timeout: 10000 });
    if (!res.ok) throw new Error('Status ' + res.status);
    return await res.buffer();
  } catch (err) {
    return null;
  }
}

async function makeImage(entry) {
  const targetWidth = 1000;
  const nama = entry.nama || 'Nama Tidak Tersedia';
  const plu = entry.plu || '';
  const code = (entry.barcode && entry.barcode.trim() !== '') ? entry.barcode : (plu || '');

  // barcode
  const isDigits = /^\d+$/.test(code);
  let bcid = 'code128';
  if (isDigits && code.length === 13) bcid = 'ean13';
  else if (isDigits && code.length === 12) bcid = 'upca';

  const barcodePng = await bwipjs.toBuffer({
    bcid,
    text: code || plu || '000000',
    scale: 2,
    height: 15,
    includetext: true,
    textxalign: 'center'
  });

  // product image
  let prodBuf = null;
  if (entry.gambar) {
    prodBuf = await fetchImageBuffer(entry.gambar);
  }
  if (!prodBuf) {
    // placeholder
    prodBuf = await sharp({ create: { width: targetWidth, height: 600, channels: 3, background: '#f6f6f6' } }).png().toBuffer();
  }

  const prodResized = await sharp(prodBuf).resize({ width: targetWidth }).png().toBuffer();
  const prodMeta = await sharp(prodResized).metadata();

  // info svg
  const lines = [nama, `PLU: ${plu}`];
  const fontSize = 36;
  const lineHeight = Math.round(fontSize * 1.4);
  const padding = 20;
  const infoHeight = padding * 2 + lineHeight * lines.length;
  const svgLines = lines.map((ln, i) => `<text x="${padding}" y="${padding + lineHeight * (i + 0.8)}" class="t">${esc(ln)}</text>`).join('');
  const infoSvg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${targetWidth}" height="${infoHeight}">\n  <rect width="100%" height="100%" fill="#ffffff"/>\n  <style>.t{font-family: Arial, Helvetica, sans-serif; font-size: ${fontSize}px; fill: #000000;}</style>\n  ${svgLines}\n</svg>`;
  const infoPng = await sharp(Buffer.from(infoSvg)).png().toBuffer();

  // leave side padding so barcode doesn't touch image edges
  const sidePadding = 60;
  const barcodeWidth = Math.max(200, targetWidth - sidePadding * 2);
  const barcodeResized = await sharp(barcodePng).resize({ width: barcodeWidth }).png().toBuffer();
  const barMeta = await sharp(barcodeResized).metadata();

  const totalHeight = prodMeta.height + infoHeight + barMeta.height;
  const finalImageBuffer = await sharp({ create: { width: targetWidth, height: totalHeight, channels: 3, background: '#ffffff' } })
    .composite([
      { input: prodResized, top: 0, left: 0 },
      { input: infoPng, top: prodMeta.height, left: 0 },
      { input: barcodeResized, top: prodMeta.height + infoHeight, left: sidePadding }
    ])
    .png()
    .toBuffer();

  return finalImageBuffer;
}

(async () => {
  console.log(`Generating up to ${COUNT} sample images into ${OUT_DIR}`);
  const items = data.slice(0, COUNT);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const buf = await makeImage(item);
      const filename = `${(item.plu || 'no-plu')}_${i + 1}.png`;
      const outPath = path.join(OUT_DIR, filename);
      fs.writeFileSync(outPath, buf);
      console.log(`✅ Wrote ${outPath}`);
    } catch (err) {
      console.error('❌ Failed to create image for', item.plu || item.barcode, err.message || err);
    }
  }
  console.log('Done');
})();
