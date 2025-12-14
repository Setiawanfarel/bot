const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeInMemoryStore, fetchLatestBaileysVersion } = require('@adiwajshing/baileys');
const P = require('pino');
const fs = require('fs');
const path = require('path');
const { initializeDB, findProductLocally, createBarcodeImage } = require('./lib/core');

async function start() {
  await initializeDB();

  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'baileys_auth'));
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ logger: P({ level: 'silent' }), printQRInTerminal: true, auth: state, version });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log('Connection closed, code', code);
      if (code !== DisconnectReason.loggedOut) start().catch(console.error);
    } else if (connection === 'open') {
      console.log('Baileys connected');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    try {
      const messages = m.messages;
      if (!messages || !messages[0] || messages[0].key?.fromMe) return;
      const msg = messages[0];
      const from = msg.key.remoteJid;
      const text = msg.message.conversation || (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) || '';
      const body = String(text || '').trim();
      if (!body) return;

      // handle commands
      if (body.toLowerCase().startsWith('.plu')) {
        const plis = body.substring(4).trim().split(/\s+/).filter(Boolean);
        if (!plis.length) {
          await sock.sendMessage(from, { text: 'Format: .plu <plu1> <plu2> ...' });
          return;
        }
        await sock.sendMessage(from, { text: '⏳ Mencari beberapa PLU...' });
        const results = [];
        for (const p of plis) {
          const prod = await findProductLocally(p);
          if (prod) results.push(`✅ ${p}: ${prod.productName || prod.nama}`);
          else results.push(`❌ ${p}: Tidak ditemukan`);
        }
        await sock.sendMessage(from, { text: `*Hasil Pencarian:*\n\n${results.join('\n')}` });
        return;
      }

      // default single lookup
      await sock.sendMessage(from, { text: '⏳ Mencari produk...' });
      const prod = await findProductLocally(body);
      if (!prod) {
        await sock.sendMessage(from, { text: `❌ PLU/Barcode "${body}" tidak ditemukan` });
        return;
      }

      // generate image
      const png = await createBarcodeImage(prod);
      await sock.sendMessage(from, { image: png, caption: `${prod.plu} - ${prod.productName || prod.nama}` });
    } catch (e) {
      console.error('message handler error', e);
    }
  });
}

start().catch(err => { console.error('fatal', err); process.exit(1); });
