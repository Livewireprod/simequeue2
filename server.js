// server.js
// LAN-only Express API for queue + time slots + view settings + background image upload (PNG/JPG)

import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

const app = express();
app.use(express.json());

// --------------------
// In-memory state
// --------------------
let queue = [];
let settings = {
  // Slot system defaults
  slotMinutes: 15,
  dayStart: "09:00",
  dayEnd: "17:00",

  // View defaults (optional; UI can overwrite)
  viewFontFamily: "System",
  viewFontColor: "#ffffff",
  viewBgImageUrl: "",
  viewBgOverlay: 0.35,
  viewAlign: "center",
  viewJustify: "center",
  viewSize: "6xl",
  viewSpacing: "4",
  viewShowCount: 3,
};

// --------------------
// Helpers
// --------------------
function id() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function toHHMM(totalMins) {
  const h = String(Math.floor(totalMins / 60)).padStart(2, "0");
  const m = String(totalMins % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function generateSlots({ dayStart, dayEnd, slotMinutes }) {
  const start = toMinutes(dayStart);
  const end = toMinutes(dayEnd);
  const step = Number(slotMinutes) || 10;

  const slots = [];
  for (let t = start; t <= end - step; t += step) {
    slots.push(toHHMM(t));
  }
  return slots;
}

function getTakenTimes(list) {
  return new Set(list.map((q) => q.slot?.time).filter(Boolean));
}

function sortedQueue(list) {
  return [...list].sort((a, b) => {
    const am = Number.isFinite(a.slotMinutes) ? a.slotMinutes : Infinity;
    const bm = Number.isFinite(b.slotMinutes) ? b.slotMinutes : Infinity;
    if (am !== bm) return am - bm;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
}

// --------------------
// Uploads (background images)
// --------------------
const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === "image/png" || file.mimetype === "image/jpeg";
    cb(ok ? null : new Error("Only PNG or JPEG allowed"), ok);
  },
});

// Serve uploaded files
app.use("/uploads", express.static(UPLOAD_DIR));

// --------------------
// Routes
// --------------------
app.get("/health", (_req, res) => res.json({ ok: true }));

// Queue
app.get("/api/queue", (_req, res) => {
  res.json({ ok: true, queue: sortedQueue(queue) });
});

app.post("/api/queue", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ ok: false, error: "Name is required." });

  const mode = req.body?.mode === "manual" ? "manual" : "auto";
  const requestedTime = mode === "manual" ? String(req.body?.time || "").trim() : null;

  const slots = generateSlots(settings);
  const taken = getTakenTimes(queue);

  let chosenTime = null;

  if (mode === "manual") {
    if (!requestedTime) return res.status(400).json({ ok: false, error: "Time is required for manual mode" });
    if (!slots.includes(requestedTime)) return res.status(400).json({ ok: false, error: "Invalid time slot" });
    if (taken.has(requestedTime)) return res.status(409).json({ ok: false, error: "Slot already taken" });
    chosenTime = requestedTime;
  } else {
    chosenTime = slots.find((t) => !taken.has(t)) || null;
    if (!chosenTime) return res.status(409).json({ ok: false, error: "No slots available" });
  }

  const item = {
    id: id(),
    name,
    createdAt: new Date().toISOString(),
    slot: { type: mode, time: chosenTime },
    slotMinutes: toMinutes(chosenTime),
  };

  queue.push(item);

  res.status(201).json({ ok: true, item, queue: sortedQueue(queue) });
});

app.delete("/api/queue/:id", (req, res) => {
  const { id: deleteId } = req.params;
  const before = queue.length;

  queue = queue.filter((q) => q.id !== deleteId);

  if (queue.length === before) {
    return res.status(404).json({ ok: false, error: "not found" });
  }

  res.json({ ok: true, queue: sortedQueue(queue) });
});

// Slots helper
app.get("/api/slots", (_req, res) => {
  const slots = generateSlots(settings);
  const taken = Array.from(getTakenTimes(queue));
  res.json({ ok: true, slots, taken });
});

// Settings (includes slot settings + view settings)
app.get("/api/settings", (_req, res) => {
  res.json({ ok: true, settings });
});

app.put("/api/settings", (req, res) => {
  const update = req.body && typeof req.body === "object" ? req.body : null;
  if (!update) return res.status(400).json({ ok: false, error: "body must be an object" });

  settings = { ...settings, ...update };
  res.json({ ok: true, settings });
});

// Background image upload (PNG/JPG)
// Expects multipart/form-data with field name: "file"
app.post("/api/upload/background", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded" });

    const ext = req.file.mimetype === "image/png" ? ".png" : ".jpg";
    const newName = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const newPath = path.join(UPLOAD_DIR, newName);

    fs.renameSync(req.file.path, newPath);

    const url = `/uploads/${newName}`;

    // Auto-save into settings so /view can pick it up immediately
    settings = { ...settings, viewBgImageUrl: url };

    res.json({ ok: true, url, settings });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "Upload failed" });
  }
});

// --------------------
// Start
// --------------------
const PORT = Number(process.env.PORT || 9979);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`LAN server running on http://0.0.0.0:${PORT}`);
});
