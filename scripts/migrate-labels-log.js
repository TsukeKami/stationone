const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '..', 'logs', 'labels-log.tsv');
if (!fs.existsSync(LOG_PATH)) {
  console.error('No labels-log.tsv found at', LOG_PATH);
  process.exit(1);
}

const raw = fs.readFileSync(LOG_PATH, 'utf8');
const lines = raw.split('\n');
if (lines.length === 0) {
  console.error('Empty file');
  process.exit(1);
}

const originalHeader = (lines.shift() || '').trim();
const oldCols = originalHeader.split('\t').map(s => s.trim()).filter(Boolean);

const targetCols = [
  'timestamp',
  'productId',
  'productName',
  'quantity',
  'initials',
  'printedBy',
  'prepDate',
  'beginUsing',
  'useBy',
  'printerProfile'
];

// backup
const bakName = `labels-log.tsv.bak.${new Date().toISOString().replace(/[:]/g, '-')}.txt`;
const bakPath = path.join(path.dirname(LOG_PATH), bakName);
fs.writeFileSync(bakPath, raw, 'utf8');
console.log('Backup written to', bakPath);

function slugifyName(name){
  if (!name) return '';
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const outRows = [];
for (const line of lines) {
  if (!line.trim()) continue;
  const parts = line.split('\t');
  const obj = {};
  for (let i = 0; i < oldCols.length; i++) {
    obj[oldCols[i]] = parts[i] !== undefined ? parts[i] : '';
  }

  // Build normalized row values
  const row = {};

  // timestamp
  row.timestamp = obj.timestamp || obj.Time || obj.time || '';

  // productId — prefer explicit id, else slug of product name
  row.productId = obj.productId || obj.product || obj.productName || slugifyName(obj.product || obj.productName || '');

  // productName
  row.productName = obj.productName || obj.product || '';

  // quantity
  row.quantity = obj.quantity || obj.qty || obj.Qty || '';

  // initials
  row.initials = obj.initials || obj.initial || '';

  // printedBy
  row.printedBy = obj.printedBy || '';

  // prepDate
  row.prepDate = obj.prepDate || '';

  // beginUsing (aliases)
  row.beginUsing = obj.beginUsing || obj.beginUse || '';

  // useBy
  row.useBy = obj.useBy || '';

  // printerProfile: preserve old batch/rotation into this field
  row.printerProfile = obj.printerProfile || obj.batch || obj.Batch || obj.rotation || '';

  // ensure targetCols order
  const vals = targetCols.map(k => (row[k] !== undefined ? row[k] : ''));
  outRows.push(vals.join('\t'));
}

const out = targetCols.join('\t') + '\n' + outRows.join('\n') + '\n';
fs.writeFileSync(LOG_PATH, out, 'utf8');
console.log('Migration complete — normalized', outRows.length, 'rows');
console.log('Original header was:', originalHeader);
console.log('New header is:', targetCols.join('\t'));
process.exit(0);
