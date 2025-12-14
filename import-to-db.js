const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'barcode.db');
const sheetPath = path.join(__dirname, 'barcodesheet.json');

// Open/create database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Database error:', err);
    process.exit(1);
  }
  console.log('✅ Database connected');
});

// Create table
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plu TEXT UNIQUE NOT NULL,
      barcode TEXT,
      productName TEXT,
      nama TEXT,
      imageUrl TEXT,
      gambar TEXT,
      price REAL,
      category TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('❌ Table creation error:', err);
      process.exit(1);
    }
    console.log('✅ Table ready');
  });

  // Create indexes for fast lookup
  db.run('CREATE INDEX IF NOT EXISTS idx_plu ON products(plu)', (err) => {
    if (err) console.error('❌ Index plu error:', err);
    else console.log('✅ Index plu created');
  });

  db.run('CREATE INDEX IF NOT EXISTS idx_barcode ON products(barcode)', (err) => {
    if (err) console.error('❌ Index barcode error:', err);
    else console.log('✅ Index barcode created');
  });

  // Read barcode sheet
  try {
    const data = JSON.parse(fs.readFileSync(sheetPath, 'utf8'));
    console.log(`📊 Read ${data.length} records from barcodesheet.json`);

    // Import data
    let imported = 0;
    let skipped = 0;

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO products (plu, barcode, productName, nama, imageUrl, gambar, price, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    data.forEach((item, index) => {
      stmt.run(
        item.plu || '',
        item.barcode || '',
        item.productName || '',
        item.nama || '',
        item.imageUrl || '',
        item.gambar || '',
        item.price || 0,
        item.category || '',
        (err) => {
          if (err && err.message.includes('UNIQUE')) {
            skipped++;
          } else if (err) {
            console.error(`❌ Error at row ${index}:`, err.message);
          } else {
            imported++;
          }
        }
      );
    });

    stmt.finalize((err) => {
      if (err) {
        console.error('❌ Finalize error:', err);
        process.exit(1);
      }

      setTimeout(() => {
        // Verify count
        db.get('SELECT COUNT(*) as count FROM products', (err, row) => {
          if (err) {
            console.error('❌ Count error:', err);
          } else {
            console.log(`\n✅ Import complete!`);
            console.log(`   Total in DB: ${row.count}`);
            console.log(`   Imported: ${imported}`);
            console.log(`   Skipped (duplicates): ${skipped}`);
          }
          
          db.close((err) => {
            if (err) console.error('❌ Close error:', err);
            else console.log('✅ Database closed');
            process.exit(0);
          });
        });
      }, 100);
    });

  } catch (error) {
    console.error('❌ Error reading barcodesheet.json:', error.message);
    db.close();
    process.exit(1);
  }
});
