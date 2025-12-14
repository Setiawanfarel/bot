const bwipjs = require('bwip-js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Load real data dari barcodesheet.json
const barcodesheet = JSON.parse(fs.readFileSync('./barcodesheet.json', 'utf8'));

// Ambil beberapa sample produk
const sampleProducts = [
  barcodesheet[1],  // Indomilk Susu Kental Manis Putih
  barcodesheet[2],  // Indomilk Kental Manis Chocolate
  barcodesheet[4],  // Aim Crackers
];

// Mock prices (karena barcodesheet tidak ada price field)
const prices = ['Rp 12.500', 'Rp 12.500', 'Rp 8.900'];

async function createBarcodeImage(product, price) {
  const plu = product.plu || 'N/A';
  const barcode = product.barcode || '';
  const nama = product.nama || 'Nama Tidak Tersedia';
  const codeToRender = (barcode && barcode.trim() !== '') ? barcode : plu;

  // Generate barcode
  const isDigits = /^\d+$/.test(codeToRender);
  let bcid = 'code128';
  if (isDigits && codeToRender.length === 13) bcid = 'ean13';
  else if (isDigits && codeToRender.length === 12) bcid = 'upca';

  const barcodePng = await bwipjs.toBuffer({
    bcid,
    text: codeToRender,
    scale: 4,
    height: 20,
    includetext: true,
    textxalign: 'center'
  });

  // Layout: gambar atas + nama + barcode + harga bawah
  const width = 800;
  const productHeight = 600;
  const namaHeight = 80;
  const barcodeHeight = 150;
  const priceHeight = 70;
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

  // 2. Nama produk
  const namaSvg = `
    <svg width="${width}" height="${namaHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${namaHeight}" fill="#ffffff" stroke="#000" stroke-width="1"/>
      <text x="15" y="50" font-size="28" font-weight="bold" fill="#000000">${esc(nama.substring(0, 50))}</text>
    </svg>
  `;
  const namaPng = await sharp(Buffer.from(namaSvg)).png().toBuffer();

  // 3. Barcode BESAR
  const barcodeResized = await sharp(barcodePng)
    .resize(width - 40, null, { withoutEnlargement: true })
    .png()
    .toBuffer();

  // 4. Harga
  const priceSvg = `
    <svg width="${width}" height="${priceHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${priceHeight}" fill="#ffffff" stroke="#000" stroke-width="1"/>
      <text x="15" y="50" font-size="36" font-weight="bold" fill="#d32f2f">${esc(price)}</text>
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
      { input: barcodeResized, top: productHeight + namaHeight + 10, left: 20 },
      { input: pricePng, top: productHeight + namaHeight + barcodeHeight + 10, left: 0 }
    ])
    .png()
    .toBuffer();

  return final;
}

async function generateExamples() {
  try {
    console.log('🎨 Generating examples dari real data...\n');

    for (let i = 0; i < sampleProducts.length; i++) {
      const product = sampleProducts[i];
      console.log(`📦 [${i + 1}] PLU: ${product.plu} | ${product.nama.substring(0, 40)}`);

      const buffer = await createBarcodeImage(product, prices[i]);
      const outputPath = path.join(__dirname, `example-${i + 1}-plu${product.plu}.png`);
      fs.writeFileSync(outputPath, buffer);

      console.log(`    ✅ Saved: example-${i + 1}-plu${product.plu}.png (${(buffer.length / 1024).toFixed(2)}KB)\n`);
    }

    console.log('✅ Semua contoh sudah di-generate!');
    console.log('\n📋 File yang dibuat:');
    console.log('   - example-1-plu10000019.png (Indomilk Putih)');
    console.log('   - example-2-plu10000020.png (Indomilk Chocolate)');
    console.log('   - example-3-plu10000052.png (Aim Crackers)');
    console.log('\n📁 Check folder untuk melihat hasilnya!');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

generateExamples();
