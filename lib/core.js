const fs = require('fs');
const path = require('path');
const bwipjs = require('bwip-js');
const sharp = require('sharp');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, '..', 'barcode.db');
let db = null;

const barcodeCache = new Map();

// simple product cache
const PRODUCT_CACHE_LIMIT = 2000;
const productCache = new Map();

function initializeDB() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        db.run('CREATE INDEX IF NOT EXISTS idx_products_plu ON products(plu)');
        db.run('CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)');
      });
      resolve();
    });
  });
}

function queryDB(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('Database not initialized'));
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function findProductLocally(query) {
  try {
    const key = String(query || '').trim();
    if (!key) return null;
    if (productCache.has(key)) {
      const cached = productCache.get(key);
      productCache.delete(key);
      productCache.set(key, cached);
      return cached;
    }

    // try exact match
    let product = await queryDB('SELECT * FROM products WHERE plu = ?', [key]);
    if (!product) product = await queryDB('SELECT * FROM products WHERE barcode = ?', [key]);
    if (!product) {
      const digits = key.replace(/\D/g, '');
      if (digits && digits !== key) {
        product = await queryDB('SELECT * FROM products WHERE plu = ? OR barcode = ?', [digits, digits]);
      }
    }

    if (product) {
      productCache.set(key, product);
      if (productCache.size > PRODUCT_CACHE_LIMIT) {
        const oldest = productCache.keys().next().value;
        productCache.delete(oldest);
      }
    }

    return product || null;
  } catch (e) {
    console.error('findProductLocally error', e);
    return null;
  }
}

async function createBarcodeImage(product) {
  const plu = product.plu || 'N/A';
  const barcode = product.barcode || '';
  const nama = product.productName || product.nama || 'Nama Tidak Tersedia';
  const price = product.price || '-';
  const codeToRender = (barcode && barcode.trim() !== '') ? barcode : plu;

  // Generate barcode buffer (cached)
  const isDigits = /^\d+$/.test(codeToRender);
  let bcid = 'code128';
  if (isDigits && codeToRender.length === 13) bcid = 'ean13';
  else if (isDigits && codeToRender.length === 12) bcid = 'upca';

  const cacheKey = `${bcid}:${codeToRender}`;
  let barcodePng = barcodeCache.get(cacheKey);
  if (!barcodePng) {
    barcodePng = await bwipjs.toBuffer({ bcid, text: codeToRender, scale: 3.5, height: 15, includetext: true, textxalign: 'center' });
    barcodeCache.set(cacheKey, barcodePng);
  }

  const width = 540;
  const productHeight = 300;
  const namaHeight = 80;
  const barcodeHeight = 200;
  const priceHeight = 80;
  const totalHeight = productHeight + namaHeight + barcodeHeight + priceHeight + 10;

  // product image
  let productImage;
  const gambarUrl = product.gambar || product.imageUrl || '';
  if (gambarUrl && gambarUrl.trim() !== '') {
    try {
      const fetch = require('node-fetch');
      const res = await fetch(gambarUrl, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) {
        const buffer = await res.buffer();
        productImage = await sharp(buffer).resize(width, productHeight, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
      } else throw new Error('HTTP ' + res.status);
    } catch (e) {
      productImage = await sharp({ create: { width, height: productHeight, channels: 3, background: '#e8e8e8' } }).png().toBuffer();
    }
  } else {
    productImage = await sharp({ create: { width, height: productHeight, channels: 3, background: '#e8e8e8' } }).png().toBuffer();
  }

  // nama png
  const namaLines = nama.length > 40 ? nama.substring(0, 40) : nama;
  const namaSvg = `\n    <svg width="${width}" height="${namaHeight}" xmlns="http://www.w3.org/2000/svg">\n      <rect width="${width}" height="${namaHeight}" fill="#ffffff" stroke="#333" stroke-width="1"/>\n      <text x="${width/2}" y="50" text-anchor="middle" font-size="18" font-weight="bold" fill="#000">${escapeXml(namaLines)}</text>\n    </svg>\n  `;
  const namaPng = await sharp(Buffer.from(namaSvg)).png().toBuffer();

  // barcode composite
  const barcodeResized = await sharp(barcodePng).resize(width - 40, null, { withoutEnlargement: true }).png().toBuffer();
  const barcodeMeta = await sharp(barcodeResized).metadata();
  const barcodeLeftPos = Math.max(0, Math.round((width - barcodeMeta.width) / 2));
  const barcodeTopPos = Math.max(5, Math.round((barcodeHeight - barcodeMeta.height) / 2));
  const barcodeSectionSvg = `<svg width="${width}" height="${barcodeHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${barcodeHeight}" fill="#ffffff" stroke="#333" stroke-width="1"/></svg>`;
  const barcodeWithCodePng = await sharp(Buffer.from(barcodeSectionSvg)).composite([{ input: barcodeResized, top: barcodeTopPos, left: barcodeLeftPos }]).png().toBuffer();

  // price
  const priceDisplay = price && price !== '-' ? price : 'Rp 0,-';
  const priceSvg = `\n    <svg width="${width}" height="${priceHeight}" xmlns="http://www.w3.org/2000/svg">\n      <defs>\n        <linearGradient id="priceGrad" x1="0%" y1="0%" x2="0%" y2="100%">\n          <stop offset="0%" style="stop-color:#ff6b6b;stop-opacity:1" />\n          <stop offset="100%" style="stop-color:#ee5a52;stop-opacity:1" />\n        </linearGradient>\n      </defs>\n      <rect width="${width}" height="${priceHeight}" fill="url(#priceGrad)" stroke="#333" stroke-width="1"/>\n      <text x="${width/2}" y="55" text-anchor="middle" font-size="28" font-weight="bold" fill="#ffffff">${escapeXml(priceDisplay)}</text>\n    </svg>\n  `;
  const pricePng = await sharp(Buffer.from(priceSvg)).png().toBuffer();

  const final = await sharp({ create: { width, height: totalHeight, channels: 3, background: '#ffffff' } }).composite([
    { input: productImage, top: 0, left: 0 },
    { input: namaPng, top: productHeight, left: 0 },
    { input: barcodeWithCodePng, top: productHeight + namaHeight, left: 0 },
    { input: pricePng, top: productHeight + namaHeight + barcodeHeight + 10, left: 0 }
  ]).png().toBuffer();

  return final;
}

function escapeXml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

module.exports = { initializeDB, findProductLocally, createBarcodeImage };
