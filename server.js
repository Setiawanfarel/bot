const http = require('http');
const url = require('url');
const { initializeDB, findProductLocally, createBarcodeImage } = require('./lib/core');

const PORT = process.env.PORT || 3000;

async function handler(req, res) {
  const u = url.parse(req.url, true);
  if (u.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (u.pathname === '/lookup') {
    const q = u.query.query || u.query.q || '';
    if (!q) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing query parameter' }));
      return;
    }
    const product = await findProductLocally(q);
    if (!product) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(product));
    return;
  }

  if (u.pathname === '/image') {
    const q = u.query.query || u.query.q || '';
    if (!q) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing query parameter' }));
      return;
    }
    const product = await findProductLocally(q);
    if (!product) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    try {
      const png = await createBarcodeImage(product);
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(png);
    } catch (e) {
      console.error('image generate error', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'image error' }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

(async () => {
  try {
    console.log('Initializing DB...');
    await initializeDB();
    const server = http.createServer((req, res) => {
      handler(req, res).catch(err => {
        console.error('handler error', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal' }));
      });
    });

    server.listen(PORT, () => console.log(`HTTP test server listening on http://localhost:${PORT}`));
  } catch (e) {
    console.error('startup error', e);
    process.exit(1);
  }
})();
