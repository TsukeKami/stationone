// server.js — StationOne (clean + label overlay only)
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const net = require("net");

// Default network printer settings — override with env vars if needed
const PRINTER_IP = process.env.PRINTER_IP || "192.168.8.212";
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);
function sendZPL(zpl) {
  const settings = loadJSON(SETTINGS_PATH, {});
  const ip = settings.printerIP || PRINTER_IP;
  const port = Number(settings.printerPort || PRINTER_PORT);

  return new Promise((resolve, reject) => {
    const client = new net.Socket();

    // ✅ timeout added correctly
    client.setTimeout(3000);

    client.connect(port, ip, () => {
      client.write(zpl);
      client.end();
      resolve();
    });

    client.on("timeout", () => {
      client.destroy();
      reject(new Error("Printer timeout"));
    });

    client.on("error", (err) => {
      reject(err);
    });
  });
}

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.use(cors());
app.use(express.json());

// Simple request logger
app.use((req, res, next) => {
  console.log(new Date().toISOString(), req.method, req.url);
  next();
});

// Serve your frontend from this folder (same dir as server.js)
const PUBLIC_DIR = path.join(__dirname);
app.use(express.static(PUBLIC_DIR));

// =========================
// Paths
// =========================
const DATA_DIR = path.join(__dirname, "data");
const LOG_DIR = path.join(__dirname, "logs");

const PRODUCTS_PATH = path.join(DATA_DIR, "products.json");
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");
const TASKS_PATH = path.join(DATA_DIR, "tasks.json");
const STAFF_PATH = path.join(DATA_DIR, "staff.json");
const LABELS_LOG_PATH = path.join(LOG_DIR, "labels-log.tsv");

// Staff is stored in data/staff.json. Each entry should be an object like:
// { id: "enock", name: "Enock", initials: "EM", active: true }

// =========================
// Helpers
// =========================
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function ensureFile(p, defaultContent) {
  if (!fs.existsSync(p)) {
    ensureDir(path.dirname(p));
    fs.writeFileSync(p, JSON.stringify(defaultContent, null, 2), "utf8");
  }
}

function loadJSON(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw || "null") ?? fallback;
  } catch (e) {
    console.error("Failed to load JSON", p, e);
    return fallback;
  }
}

function saveJSON(p, data) {
  try {
    ensureDir(path.dirname(p));
    fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save JSON", p, e);
  }
}

// Sanitize strings for ZPL
function safe(s) {
  return String(s || "")
    .replace(/[\^~]/g, " ")
    .trim();
}

function nowISO() {
  return new Date().toISOString();
}

// dd/MM/yy (no leading zeros like your prints)
function formatDateForLabel(date) {
  const d = new Date(date);
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = String(d.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}

// dd/MM/yy HH:mm for log
function formatDateTimeForLog(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(
    d.getFullYear()
  ).slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function calculateDatesForProduct(product, prepDate) {
  const prep = new Date(prepDate || Date.now());
  const begin = new Date(prep.getTime() + (product.prepToBeginHours || 0) * 3600000);
  const useBy = new Date(prep.getTime() + (product.prepToUseByHours || 0) * 3600000);
  return { prep, begin, useBy };
}

// Staff helpers
function loadStaffList() {
  try {
    ensureFile(STAFF_PATH, []);
    const list = loadJSON(STAFF_PATH, []);
    if (!Array.isArray(list)) return [];
    return list;
  } catch (e) {
    console.error("Failed to load staff list", e);
    return [];
  }
}

function getActiveStaff() {
  return loadStaffList().filter((s) => s && s.active !== false);
}

function appendLabelLog(entry) {
  const line =
    [
      entry.timestamp,
      entry.productId,
      entry.productName,
      entry.quantity,
      entry.initials,
      entry.printedBy || "",
      entry.prepDate,
      entry.beginUsing,
      entry.useBy,
      entry.printerProfile || "",
    ].join("\t") + "\n";

  fs.appendFile(LABELS_LOG_PATH, line, (err) => {
    if (err) console.error("Failed to append log", err);
  });
}

// USB printer helper is defined near the top of this file.

// =========================
// Init files
// =========================
ensureDir(DATA_DIR);
ensureDir(LOG_DIR);

ensureFile(PRODUCTS_PATH, [
  {
    id: "beef_pattie",
    name: "Beef Pattie",
    category: "pattie",
    unit: "tubs",
    maxTubs: 3,
    prepToBeginHours: 0,
    prepToUseByHours: 24,
    showInPlanner: true,
    isActive: true,
    displayOrder: 1,
  },
  {
    id: "beyond_pattie",
    name: "Beyond Pattie",
    category: "veg",
    unit: "tubs",
    maxTubs: 2,
    prepToBeginHours: 0,
    prepToUseByHours: 24,
    showInPlanner: true,
    isActive: true,
    displayOrder: 2,
  },
  {
    id: "garden_pattie",
    name: "Garden Pattie",
    category: "veg",
    unit: "tubs",
    maxTubs: 2,
    prepToBeginHours: 0,
    prepToUseByHours: 24,
    showInPlanner: true,
    isActive: true,
    displayOrder: 3,
  },
]);

ensureFile(SETTINGS_PATH, {
  storeName: "Store",
  timezone: "Australia/Brisbane",
  timeFormat24h: true,
  printerIP: PRINTER_IP,
  printerPort: PRINTER_PORT,

  // Label rotation: "B" = 90° one way, "L" = 90° the other way, "N" = no rotation.
  // You said the 90° rotate helped, so default to "B".
  labelRotation: "B",
});

ensureFile(TASKS_PATH, []);
// Ensure staff.json exists
ensureFile(STAFF_PATH, []);

if (!fs.existsSync(LABELS_LOG_PATH)) {
  const header =
    "timestamp\tproductId\tproductName\tquantity\tinitials\tprintedBy\tprepDate\tbeginUsing\tuseBy\tprinterProfile\n";
  fs.writeFileSync(LABELS_LOG_PATH, header, "utf8");
}

// =========================
// API: Products
// =========================
app.get("/api/products", (req, res) => {
  const products = loadJSON(PRODUCTS_PATH, []);
  res.json({ ok: true, products });
});

app.post("/api/products", (req, res) => {
  const products = loadJSON(PRODUCTS_PATH, []);
  const body = req.body || {};

  if (!body.name || typeof body.name !== "string") {
    return res.status(400).json({ ok: false, error: "Name is required" });
  }

  const id = (body.id || body.name.toLowerCase().replace(/\s+/g, "_")).trim();
  if (!id) return res.status(400).json({ ok: false, error: "Invalid ID" });

  if (products.some((p) => p.id === id)) {
    return res.status(400).json({ ok: false, error: "Product ID already exists" });
  }

  const newProduct = {
    id,
    name: body.name,
    category: body.category || "other",
    unit: body.unit || "tubs",
    maxTubs: body.maxTubs === null || body.maxTubs === "" ? null : Number(body.maxTubs),
    prepToBeginHours: Number(body.prepToBeginHours ?? 0),
    prepToUseByHours: Number(body.prepToUseByHours ?? 24),
    showInPlanner: !!body.showInPlanner,
    isActive: body.isActive !== false,
    displayOrder: body.displayOrder !== undefined ? Number(body.displayOrder) : products.length + 1,
  };

  products.push(newProduct);
  saveJSON(PRODUCTS_PATH, products);
  res.json({ ok: true, product: newProduct });
});

app.put("/api/products/:id", (req, res) => {
  const products = loadJSON(PRODUCTS_PATH, []);
  const idx = products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: "Product not found" });

  const body = req.body || {};
  const existing = products[idx];

  const updated = {
    ...existing,
    name: body.name ?? existing.name,
    category: body.category ?? existing.category,
    unit: body.unit ?? existing.unit,
    maxTubs:
      body.maxTubs === undefined
        ? existing.maxTubs
        : body.maxTubs === null || body.maxTubs === ""
        ? null
        : Number(body.maxTubs),
    prepToBeginHours:
      body.prepToBeginHours === undefined ? existing.prepToBeginHours : Number(body.prepToBeginHours),
    prepToUseByHours:
      body.prepToUseByHours === undefined ? existing.prepToUseByHours : Number(body.prepToUseByHours),
    showInPlanner: body.showInPlanner === undefined ? existing.showInPlanner : !!body.showInPlanner,
    isActive: body.isActive === undefined ? existing.isActive : !!body.isActive,
    displayOrder:
      body.displayOrder === undefined ? existing.displayOrder : Number(body.displayOrder),
  };

  products[idx] = updated;
  saveJSON(PRODUCTS_PATH, products);
  res.json({ ok: true, product: updated });
});

app.delete("/api/products/:id", (req, res) => {
  const products = loadJSON(PRODUCTS_PATH, []);
  const idx = products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: "Product not found" });

  products[idx].isActive = false;
  saveJSON(PRODUCTS_PATH, products);
  res.json({ ok: true });
});

// =========================
// API: Settings
// =========================
app.get("/api/settings", (req, res) => {
  const settings = loadJSON(SETTINGS_PATH, {});
  res.json({ ok: true, settings });
});

app.put("/api/settings", (req, res) => {
  const settings = loadJSON(SETTINGS_PATH, {});
  const body = req.body || {};

  const updated = {
    ...settings,
    storeName: body.storeName ?? settings.storeName ?? "Store",
    timezone: body.timezone ?? settings.timezone ?? "Australia/Brisbane",
    timeFormat24h:
      body.timeFormat24h === undefined ? settings.timeFormat24h ?? true : !!body.timeFormat24h,
    printerIP: body.printerIP ?? settings.printerIP ?? PRINTER_IP,
printerPort: body.printerPort ?? settings.printerPort ?? PRINTER_PORT,
    labelRotation: body.labelRotation ?? settings.labelRotation ?? "B",
  };

  saveJSON(SETTINGS_PATH, updated);
  res.json({ ok: true, settings: updated });
});

// =========================
// API: Tasks
// =========================
app.get("/api/tasks", (req, res) => {
  const tasks = loadJSON(TASKS_PATH, []);
  res.json({ ok: true, tasks });
});

// Staff list for dropdowns + validation
app.get('/api/staff', (req, res) => {
  // Return full staff list (management needs to see inactive entries).
  // Frontend will filter active staff for dropdowns.
  const staff = loadStaffList();
  res.json({ ok: true, staff });
});

// Save staff list helper
function saveStaffList(list) {
  try {
    if (!Array.isArray(list)) list = [];
    saveJSON(STAFF_PATH, list);
  } catch (e) {
    console.error('Failed to save staff list', e);
  }
}

// Create new staff
app.post('/api/staff', (req, res) => {
  try {
    const body = req.body || {};
    const name = (body.name || '').trim();
    const initials = (body.initials || '').trim();
    let id = (body.id || '').trim();
    if (!name && !id) return res.status(400).json({ ok: false, error: 'name or id required' });
    if (!id) id = name.toLowerCase().replace(/\s+/g, '_');

    const list = loadStaffList();
    if (list.some((s) => s && s.id === id)) {
      return res.status(400).json({ ok: false, error: 'staff id already exists' });
    }

    const item = { id, name: name || id, initials: initials || '', active: body.active !== false };
    list.push(item);
    saveStaffList(list);
    res.json({ ok: true, staff: item });
  } catch (err) {
    console.error('POST /api/staff error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Update staff by id
app.put('/api/staff/:id', (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const list = loadStaffList();
    const idx = list.findIndex((s) => s && s.id === id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'staff not found' });

    const existing = list[idx];
    const updated = {
      ...existing,
      name: body.name ?? existing.name,
      initials: body.initials ?? existing.initials,
      active: body.active === undefined ? existing.active : !!body.active,
    };

    list[idx] = updated;
    saveStaffList(list);
    res.json({ ok: true, staff: updated });
  } catch (err) {
    console.error('PUT /api/staff/:id error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Deactivate (soft-delete) staff by id
app.delete('/api/staff/:id', (req, res) => {
  try {
    const id = req.params.id;
    const list = loadStaffList();
    const idx = list.findIndex((s) => s && s.id === id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'staff not found' });
    list[idx].active = false;
    saveStaffList(list);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/staff/:id error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.put("/api/tasks", (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.tasks)) {
    return res.status(400).json({ ok: false, error: "tasks must be array" });
  }
  saveJSON(TASKS_PATH, body.tasks);
  res.json({ ok: true });
});

// =========================
// ZPL builder — OVERLAY ONLY (no sticker layout)
// =========================
function buildOverlayZPL({
  rotation, // "B" | "L" | "N"
  productName,
  batch,
  prepLabel,
  beginLabel,
  useByLabel,
  initials,
}) {
  // rotation mapping
  const fw =
    rotation === "B" ? "^FWB" : rotation === "L" ? "^FWL" : "^FWN";

  // Return a simple overlay with fixed coordinates per your request.
  return `
^XA
^PW640
^LL480
^LH0,0
^CI28
${fw}
^PON

; ===== Product (top) =====
^A0R,60,60
^FO525,315^FD${safe(productName)}^FS

; ===== Values (horizontal in blank areas) =====
^A0R,60,60
^FO400,350^FD${safe(prepLabel)}^FS

^A0R,60,60
^FO275,350^FD${safe(beginLabel)}^FS

^A0R,60,60
^FO160,350^FD${safe(useByLabel)}^FS

^A0R,60,60
^FO50,470^FD${safe(initials)}^FS

; ===== Batch.Product (vertical - right column) =====
^A0L,60,60
^FT260,940^FD${safe(batch || "")}^FS

^A0L,60,60
^FT275,820^FD${safe(productName || "")}^FS

^XZ
`.trim();
}

// =========================
// API: Print label
// =========================
app.post("/api/print-label", async (req, res) => {
  try {
    const body = req.body || {};
    const products = loadJSON(PRODUCTS_PATH, []);
    const settings = loadJSON(SETTINGS_PATH, {});
    const product = products.find((p) => p.id === body.productId);

    if (!product) {
      return res.status(400).json({ ok: false, error: "Unknown product" });
    }

    const quantity = Math.max(1, Number(body.quantity || 1));
    const initials = safe((body.initials || "").toUpperCase().slice(0, 4));
    const printedBy = (body.printedBy || "").trim();
    const prepDateInput = body.prepDate || new Date().toISOString();

    // Validate printedBy against staff.json (accept id, name, or initials)
    if (!printedBy) {
      return res.status(400).json({ ok: false, error: "printedBy is required" });
    }
    const staffList = loadStaffList();
    const matches = staffList.some((s) => {
      if (!s) return false;
      const idMatch = s.id && String(s.id) === printedBy;
      const nameMatch = s.name && String(s.name).toLowerCase() === printedBy.toLowerCase();
      const initMatch = s.initials && String(s.initials).toUpperCase() === printedBy.toUpperCase();
      return idMatch || nameMatch || initMatch;
    });
    if (!matches) {
      return res.status(400).json({ ok: false, error: "Invalid printedBy" });
    }

    const { prep, begin, useBy } = calculateDatesForProduct(product, prepDateInput);

    let prepFinal = prep;
let beginFinal = begin;
let useByFinal = useBy;

// Optional overrides from client
if (body.sameDates && product.id?.toLowerCase() !== "chicken") {
  beginFinal = prepFinal;
  useByFinal = prepFinal;
}

if (product.id?.toLowerCase() === "chicken") {
  beginFinal = prepFinal;
}

if (body.overrideBeginUsingISO) {
  const d = new Date(body.overrideBeginUsingISO);
  if (!isNaN(d.getTime())) beginFinal = d;
}

if (body.overrideUseByISO) {
  const d = new Date(body.overrideUseByISO);
  if (!isNaN(d.getTime())) useByFinal = d;
}

    // Sticker values – dates only
    const prepLabel = formatDateForLabel(prepFinal);
    const beginLabel = formatDateForLabel(beginFinal);

    // NOTE: keep your special-case if you ever add chicken back
    const useByLabel = formatDateForLabel(useByFinal);

    // Log values – full date+time
    const prepLog = formatDateTimeForLog(prepFinal);
    const beginLog = formatDateTimeForLog(beginFinal);
    const useByLog = formatDateTimeForLog(useByFinal);

    const rotation = settings.labelRotation || "B";
let batchValue = body.batch || "";

if (product.id?.toLowerCase() === "chicken") {
  batchValue = useByLabel;
}
    const singleZpl = buildOverlayZPL({
      rotation,
      productName: product.name,
      batch: batchValue,
      prepLabel,
      beginLabel,
      useByLabel,
      initials,
    });

    const zpl = (singleZpl + "\n").repeat(quantity);

    if (!body.previewOnly) {
      await sendZPL(zpl);
    }

    appendLabelLog({
      timestamp: nowISO(),
      productId: product.id,
      productName: product.name,
      quantity,
      initials,
      printedBy,
      prepDate: prepLog,
      beginUsing: beginLog,
      useBy: useByLog,
      printerProfile: `rotation:${rotation}`,
    });

    res.json({
      ok: true,
      label: {
        productId: product.id,
        productName: product.name,
        quantity,
        initials,
        printedBy,
        prepDate: prepLog,
        beginUsing: beginLog,
        useBy: useByLog,
      },
      zplPreview: body.previewOnly ? zpl : undefined,
    });
  } catch (err) {
    console.error("print-label error", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// (grid-test endpoint removed)

// =========================
// API: Logs
// =========================
app.get("/api/logs", (req, res) => {
  try {
    if (!fs.existsSync(LABELS_LOG_PATH)) return res.json({ ok: true, logs: [] });

    const raw = fs.readFileSync(LABELS_LOG_PATH, "utf8");
    const lines = raw.trim().split("\n");
    const header = lines.shift()?.split("\t") || [];

    const logs = lines
      .map((line) => {
        const parts = line.split("\t");
        const obj = {};
        header.forEach((h, i) => (obj[h] = parts[i]));
        return obj;
      })
      .reverse();

    res.json({ ok: true, logs });
  } catch (err) {
    console.error("logs error", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// =========================
// API: Overview
// =========================
app.get("/api/overview", (req, res) => {
  try {
    if (!fs.existsSync(LABELS_LOG_PATH)) {
      return res.json({ ok: true, todayTotal: 0, todayByProduct: [], lastPrintAt: null });
    }

    const raw = fs.readFileSync(LABELS_LOG_PATH, "utf8");
    const lines = raw.trim().split("\n");
    const header = lines.shift()?.split("\t") || [];

    const todayKey = new Date().toISOString().slice(0, 10);

    let todayTotal = 0;
    const byProduct = {};
    const byStaff = {};
    let lastPrintAt = null;

    for (const line of lines) {
      const parts = line.split("\t");
      const obj = {};
      header.forEach((h, i) => (obj[h] = parts[i]));

      if (!obj.timestamp) continue;

      if (obj.timestamp.startsWith(todayKey)) {
        const qty = Number(obj.quantity || 0) || 0;
        todayTotal += qty;
        byProduct[obj.productName] = (byProduct[obj.productName] || 0) + qty;
        const staffKey = (obj.printedBy && obj.printedBy.trim()) || (obj.initials && obj.initials.trim()) || "";
        if (staffKey) byStaff[staffKey] = (byStaff[staffKey] || 0) + qty;
      }

      if (!lastPrintAt || obj.timestamp > lastPrintAt) lastPrintAt = obj.timestamp;
    }

    const todayByProduct = Object.entries(byProduct)
      .map(([name, qty]) => ({ productName: name, quantity: qty }))
      .sort((a, b) => b.quantity - a.quantity);

    const todayByStaff = Object.entries(byStaff)
      .map(([printedBy, qty]) => ({ printedBy, quantity: qty }))
      .sort((a, b) => b.quantity - a.quantity);

    res.json({ ok: true, todayTotal, todayByProduct, todayByStaff, lastPrintAt });
  } catch (err) {
    console.error("overview error", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// =========================
// API: Burn test (fast alignment test)
// =========================
app.get("/api/burn-test", async (req, res) => {
  try {
    const settings = loadJSON(SETTINGS_PATH, {});
    const rotation = settings.labelRotation || "B";

    const zpl = buildOverlayZPL({
      rotation,
      productName: "Test Product",
      batch: "Test Batch",
      prepLabel: "13/12/25",
      beginLabel: "15/12/25",
      useByLabel: "16/12/25",
      initials: "Test Burn",
    });

    await sendZPL(zpl);
    res.json({ ok: true });
  } catch (err) {
    console.error("burn-test error", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// =========================
// Fallback: index.html (SPA)
// =========================
app.use((req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`StationOne listening on http://${HOST}:${PORT}`);
});
