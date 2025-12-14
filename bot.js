const { Client, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const bwipjs = require('bwip-js');

// URL API dari environment variables
const API_URL = process.env.API_URL || 'https://idmhelp.vercel.app/api/search?q=';

// Load barcode data lokal
let barcodeData = [];
try {
  const dataPath = path.join(__dirname, 'barcodesheet.json');
  barcodeData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  console.log(`✅ Loaded ${barcodeData.length} local barcode records`);
} catch (error) {
  console.error('❌ Error loading barcodesheet.json:', error);
}

// Fungsi untuk mengambil data dari API
async function fetchProductFromAPI(query) {
    try {
        const fetch = (await import('node-fetch')).default;
        console.log(`📡 Fetching product from API for query: ${query}`);
        const { Client, MessageMedia } = require('whatsapp-web.js');
        const qrcode = require('qrcode-terminal');
        const fs = require('fs');
        const path = require('path');
        require('dotenv').config();
        const bwipjs = require('bwip-js');
        const sharp = require('sharp');
        const fetch = require('node-fetch');

        // URL API dari environment variables
        const API_URL = process.env.API_URL || 'https://idmhelp.vercel.app/api/search?q=';

        // Load barcode data lokal
        let barcodeData = [];
        try {
          const dataPath = path.join(__dirname, 'barcodesheet.json');
          barcodeData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
          console.log(`✅ Loaded ${barcodeData.length} local barcode records`);
        } catch (error) {
          console.error('❌ Error loading barcodesheet.json:', error);
        }

        // Keep last requested product per chat to support .bulk without repeating PLU
        const lastProductByChat = new Map();
        // Track chats waiting for a qty input (after product lookup)
        const awaitingQtyByChat = new Map();

        // Fungsi untuk mengambil data dari API
        async function fetchProductFromAPI(query) {
          try {
            console.log(`📡 Fetching product from API for query: ${query}`);
            const response = await fetch(`${API_URL}${query}`);
            if (!response.ok) {
              console.error(`API returned status ${response.status}`);
              return null;
            }
            const rawData = await response.json();
            if (rawData && Array.isArray(rawData.data) && rawData.data.length > 0) {
              return rawData.data[0];
            }
            return null;
          } catch (error) {
            console.error('❌ Error fetching from API:', error.message || error);
            return null;
          }
        }

        function esc(s) {
          return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        // Create combined image: product image (top), info block, barcode (bottom)
        async function createCombinedImage(product, options = {}) {
          const targetWidth = options.targetWidth || 1000;
          const sidePadding = options.sidePadding || 60;
          const barcodeScale = options.barcodeScale || 2;
          const barcodeHeight = options.barcodeHeight || 15;

          const plu = product.plu || 'N/A';
          const barcode = product.barcode || '';
          const nama = product.productName || product.nama || 'Nama Tidak Tersedia';
          const gambar = product.imageUrl || product.gambar || '';

          const codeToRender = (barcode && barcode.trim() !== '') ? barcode : plu;

          // generate barcode
          const isDigits = /^\d+$/.test(codeToRender);
          let bcid = 'code128';
          if (isDigits && codeToRender.length === 13) bcid = 'ean13';
          else if (isDigits && codeToRender.length === 12) bcid = 'upca';

          const barcodePng = await bwipjs.toBuffer({
            bcid: bcid,
            text: codeToRender,
            scale: barcodeScale,
            height: barcodeHeight,
            includetext: true,
            textxalign: 'center'
          });

          // product image buffer
          let prodBuf = null;
          if (gambar) {
            try {
              const res = await fetch(gambar, { timeout: 10000 });
              if (res.ok) prodBuf = await res.buffer();
            } catch (e) {
              console.log('⚠️ Could not fetch product image:', e.message || e);
              prodBuf = null;
            }
          }
          if (!prodBuf) {
            prodBuf = await sharp({ create: { width: targetWidth, height: 600, channels: 3, background: '#ffffff' } }).png().toBuffer();
          }

          const prodResized = await sharp(prodBuf).resize({ width: targetWidth }).png().toBuffer();
          const prodMeta = await sharp(prodResized).metadata();

          // info SVG block
          const lines = [nama, `PLU: ${plu}`];
          const fontSize = 36;
          const lineHeight = Math.round(fontSize * 1.4);
          const padding = 20;
          const infoHeight = padding * 2 + lineHeight * lines.length;
          const svgLines = lines.map((ln, i) => `<text x="${padding}" y="${padding + lineHeight * (i + 0.8)}" class="t">${esc(ln)}</text>`).join('');
          const infoSvg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${targetWidth}" height="${infoHeight}">\n  <rect width="100%" height="100%" fill="#ffffff"/>\n  <style>.t{font-family: Arial, Helvetica, sans-serif; font-size: ${fontSize}px; fill: #000000;}</style>\n  ${svgLines}\n</svg>`;
          const infoPng = await sharp(Buffer.from(infoSvg)).png().toBuffer();

          // barcode resize with side padding
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

        // Generate a bulk image composed of `qty` small labels stacked vertically
        async function generateBulkImage(product, qty) {
          if (qty <= 0) throw new Error('qty must be > 0');
          if (qty > 200) throw new Error('qty too large');

          // label settings (smaller than single image)
          const labelWidth = 800;
          const productHeight = 220;
          const sidePadding = 20;
          const barcodeScale = 2;
          const barcodeHeight = 15;

          // prepare product buffer once
          let prodBuf = null;
          const gambar = product.imageUrl || product.gambar || '';
          if (gambar) {
            try {
              const res = await fetch(gambar, { timeout: 10000 });
              if (res.ok) prodBuf = await res.buffer();
            } catch (e) {
              prodBuf = null;
            }
          }
          if (!prodBuf) prodBuf = await sharp({ create: { width: labelWidth, height: productHeight, channels: 3, background: '#ffffff' } }).png().toBuffer();

          const prodResized = await sharp(prodBuf).resize({ width: labelWidth }).png().toBuffer();
          const prodMeta = await sharp(prodResized).metadata();

          // barcode image
          const codeToRender = (product.barcode && product.barcode.trim() !== '') ? product.barcode : (product.plu || '000000');
          const isDigits = /^\d+$/.test(codeToRender);
          let bcid = 'code128';
          if (isDigits && codeToRender.length === 13) bcid = 'ean13';
          else if (isDigits && codeToRender.length === 12) bcid = 'upca';

          const barcodePng = await bwipjs.toBuffer({ bcid, text: codeToRender, scale: barcodeScale, height: barcodeHeight, includetext: true, textxalign: 'center' });
          const barcodeWidth = Math.max(150, labelWidth - sidePadding * 2);
          const barcodeResized = await sharp(barcodePng).resize({ width: barcodeWidth }).png().toBuffer();
          const barMeta = await sharp(barcodeResized).metadata();

          // info svg for label
          const nama = product.productName || product.nama || 'Nama Tidak Tersedia';
          const plu = product.plu || '';
          const fontSize = 24;
          const lineHeight = Math.round(fontSize * 1.4);
          const padding = 10;
          const lines = [nama, `PLU: ${plu}`];
          const infoHeight = padding * 2 + lineHeight * lines.length;
          const svgLines = lines.map((ln, i) => `<text x="${padding}" y="${padding + lineHeight * (i + 0.8)}" class="t">${esc(ln)}</text>`).join('');
          const infoSvg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${labelWidth}" height="${infoHeight}">\n  <rect width="100%" height="100%" fill="#ffffff"/>\n  <style>.t{font-family: Arial, Helvetica, sans-serif; font-size: ${fontSize}px; fill: #000000;}</style>\n  ${svgLines}\n</svg>`;
          const infoPng = await sharp(Buffer.from(infoSvg)).png().toBuffer();

          const labelHeight = prodMeta.height + infoHeight + barMeta.height;

          const totalHeight = labelHeight * qty;
          const canvas = sharp({ create: { width: labelWidth, height: totalHeight, channels: 3, background: '#ffffff' } });
          const composites = [];
          for (let i = 0; i < qty; i++) {
            const top = i * labelHeight;
            composites.push({ input: prodResized, top: top, left: 0 });
            composites.push({ input: infoPng, top: top + prodMeta.height, left: 0 });
            composites.push({ input: barcodeResized, top: top + prodMeta.height + infoHeight, left: sidePadding });
          }

          const final = await canvas.composite(composites).png().toBuffer();
          return final;
        }

        // Fungsi untuk menangani balasan (single product)
        async function sendProductInfo(msg, product) {
          try {
            const finalImageBuffer = await createCombinedImage(product, { barcodeHeight: 15 });
            const media = new MessageMedia('image/png', finalImageBuffer.toString('base64'), 'product-with-barcode.png');
            const caption = `Harga tidak tersedia!\n\n*PLU:* ${product.plu || 'N/A'}\n\nUNTUK MEMBUAT BARCODE DENGAN JUMLAH BANYAK.\nSILAHKAN KETIK .BULK`;

            await client.sendMessage(msg.from, media, { caption });

            // store last product for bulk convenience
            lastProductByChat.set(msg.from, product);
            // ask user for qty input for bulk convenience
            awaitingQtyByChat.set(msg.from, product);
            await client.sendMessage(msg.from, 'Jika ingin membuat banyak label untuk produk ini, kirimkan jumlah (angka), atau gunakan perintah: .bulk <qty>. Maksimum 50.');
          } catch (err) {
            console.error('❌ Error creating/sending combined image:', err);
            await client.sendMessage(msg.from, '⚠️ Terjadi kesalahan saat membuat gambar produk/barcode. Silakan coba lagi.');
          }
        }

        // Initialize WhatsApp client
        const client = new Client({ session: 'whatsapp-session' });

        // Display QR code for login
        client.on('qr', (qr) => {
          console.log('\n📱 Scan QR code below with WhatsApp to login:');
          qrcode.generate(qr, { small: true });
        });

        client.on('ready', () => {
          console.log('✅ WhatsApp Bot is ready!');
          console.log('Send PLU or Barcode number to search for products');
          console.log('Or use: .v2 [PLU/Barcode] to search via API');
        });

        // Handle incoming messages
        client.on('message', async (msg) => {
          try {
            const userMessage = msg.body.trim();

            // If the bot is awaiting a qty for this chat and the user replies with a number, handle it
            if (/^\d+$/.test(userMessage) && awaitingQtyByChat.has(msg.from)) {
              const qty = parseInt(userMessage, 10);
              const product = awaitingQtyByChat.get(msg.from);
              // clear awaiting state regardless
              awaitingQtyByChat.delete(msg.from);

              if (!product) {
                await client.sendMessage(msg.from, 'Produk tidak ditemukan. Silakan cari produk terlebih dahulu.');
                return;
              }
              if (!qty || qty <= 0) {
                await client.sendMessage(msg.from, 'Jumlah tidak valid. Masukkan angka > 0.');
                return;
              }
              if (qty > 50) {
                await client.sendMessage(msg.from, 'Maaf, jumlah maksimal saat ini adalah 50. Gunakan nilai lebih kecil atau gunakan .bulk dengan opsi lain.');
                return;
              }

              await client.sendMessage(msg.from, `Membuat ${qty} label untuk produk: ${product.productName || product.nama || product.plu} ...`);
              try {
                const bulkBuffer = await generateBulkImage(product, qty);
                const media = new MessageMedia('image/png', bulkBuffer.toString('base64'), `bulk-${product.plu || 'no-plu'}-${qty}.png`);
                await client.sendMessage(msg.from, media, { caption: `Bulk ${qty} x ${product.productName || product.nama || product.plu}` });
                // store last product
                lastProductByChat.set(msg.from, product);
              } catch (err) {
                console.error('❌ Error generating bulk image:', err);
                await client.sendMessage(msg.from, 'Terjadi kesalahan saat membuat bulk image. Coba lagi nanti.');
              }
              return;
            }

            // .v2 lookup via API
            if (userMessage.toLowerCase().startsWith('.v2')) {
              const query = userMessage.substring(3).trim();
              if (query.length > 0) {
                const product = await fetchProductFromAPI(query);
                if (product) {
                  await sendProductInfo(msg, product);
                } else {
                  await client.sendMessage(msg.from, `❌ *Produk V2 tidak ditemukan*\n\nQuery: *${query}*`);
                }
              } else {
                await client.sendMessage(msg.from, 'Silakan tambahkan PLU atau Barcode setelah .v2 (Contoh: .v2 20040194)');
              }
              return;
            }

            // .bulk command
            if (userMessage.toLowerCase().startsWith('.bulk')) {
              const parts = userMessage.split(/\s+/).slice(1);
              const qty = parseInt(parts[0], 10);
              if (!qty || qty <= 0) {
                await client.sendMessage(msg.from, 'Gunakan: .bulk <qty> [PLU/Barcode]\nContoh: .bulk 10 10000019\nAtau: .bulk 10 (menggunakan produk terakhir yang dicari)');
                return;
              }
              if (qty > 50) {
                await client.sendMessage(msg.from, 'Maaf, jumlah maksimal untuk .bulk saat ini adalah 50. Mohon kurangi qty.');
                return;
              }

              let product = null;
              const codeArg = parts[1];
              if (codeArg) {
                product = barcodeData.find(item => item.plu === codeArg || item.barcode === codeArg);
                if (!product) product = await fetchProductFromAPI(codeArg);
              } else {
                product = lastProductByChat.get(msg.from) || null;
              }

              if (!product) {
                await client.sendMessage(msg.from, 'Produk tidak ditemukan. Sebutkan PLU/Barcode setelah .bulk atau cari produk terlebih dahulu.');
                return;
              }

              await client.sendMessage(msg.from, `Membuat ${qty} label untuk produk: ${product.productName || product.nama || product.plu} ...`);
              try {
                const bulkBuffer = await generateBulkImage(product, qty);
                const media = new MessageMedia('image/png', bulkBuffer.toString('base64'), `bulk-${product.plu || 'no-plu'}-${qty}.png`);
                await client.sendMessage(msg.from, media, { caption: `Bulk ${qty} x ${product.productName || product.nama || product.plu}` });
              } catch (err) {
                console.error('❌ Error generating bulk image:', err);
                await client.sendMessage(msg.from, 'Terjadi kesalahan saat membuat bulk image. Coba lagi nanti.');
              }

              return;
            }

            // Default: search local dataset by PLU or barcode
            const product = barcodeData.find(item => item.plu === userMessage || item.barcode === userMessage);
            if (product) {
              await sendProductInfo(msg, product);
            } else {
              let response = `❌ *Produk tidak ditemukan* (Mode Lokal)\n\n`;
              response += `Silakan kirimkan:\n`;
              response += `• *PLU* (contoh: 10000019)\n`;
              response += `• *Barcode* (contoh: 8992702000018)\n\n`;
              response += `_Untuk mencoba pencarian via API, gunakan format: .v2 [PLU/Barcode]_`;
              await client.sendMessage(msg.from, response);
            }
          } catch (error) {
            console.error('❌ Error handling message:', error);
            await client.sendMessage(msg.from, '❌ Terjadi kesalahan pada bot. Silakan coba lagi nanti.');
          }
        });

        client.on('disconnected', (reason) => {
          console.log('❌ WhatsApp disconnected:', reason);
        });

        client.on('error', (error) => {
          console.error('❌ Client error:', error);
        });

        client.initialize();

        process.on('SIGINT', () => {
          console.log('\n👋 Shutting down...');
          client.destroy();
          process.exit(0);
        });