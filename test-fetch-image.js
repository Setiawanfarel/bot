const sharp = require('sharp');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

async function testImageFetch() {
  try {
    const imageUrl = 'https://cdn-klik.klikindomaret.com/klik-catalog/product/10000019_1.jpg';
    
    console.log('🖼️  Testing image fetch...\n');
    console.log(`📍 URL: ${imageUrl}\n`);

    // Test 1: Simple fetch
    console.log('1️⃣  Testing basic fetch...');
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Content-Type: ${response.headers.get('content-type')}`);
    console.log(`   Content-Length: ${response.headers.get('content-length')} bytes`);

    if (!response.ok) {
      console.log(`   ❌ FAILED - HTTP ${response.status}`);
      return;
    }

    // Test 2: Download dan resize
    console.log(`\n2️⃣  Testing download & resize...`);
    const buffer = await response.buffer();
    console.log(`   ✅ Downloaded: ${(buffer.length / 1024).toFixed(2)}KB`);

    // Resize to 540px width
    const resized = await sharp(buffer)
      .resize(540, 400, { fit: 'cover' })
      .png()
      .toBuffer();

    console.log(`   ✅ Resized to 540x400px: ${(resized.length / 1024).toFixed(2)}KB`);

    // Save test
    const outputPath = path.join(__dirname, 'test-fetch-image.png');
    fs.writeFileSync(outputPath, resized);
    console.log(`   ✅ Saved to: ${outputPath}`);

    console.log(`\n✨ SUCCESS! Image fetch works perfectly!`);
    console.log(`\n📊 Hasil:`);
    console.log(`   - URL accessible ✅`);
    console.log(`   - Image downloadable ✅`);
    console.log(`   - Can resize with sharp ✅`);
    console.log(`   - Ready for composite ✅`);

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.log('\n📋 Details:');
    console.log(`   Error: ${err.code || err.message}`);
    if (err.response) {
      console.log(`   Status: ${err.response.status}`);
    }
  }
}

testImageFetch();
