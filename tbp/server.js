// GrainGuard server - zero dependencies. Run with:  node server.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_FILE = path.join(__dirname, "data", "readings.json");
const MAX_READINGS = 5000;      // kept in memory + on disk
const OFFLINE_AFTER_MS = 20000; // device shown offline if silent this long

// ---------- storage ----------
let readings = [];
try {
  readings = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  console.log(`Loaded ${readings.length} saved readings`);
} catch {
  readings = [];
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFile(DATA_FILE, JSON.stringify(readings), (err) => {
      if (err) console.error("Save failed:", err.message);
    });
  }, 1000);
}

// ---------- helpers ----------
function sendJSON(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e5) reject(new Error("Body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const str = (v, fallback) => (typeof v === "string" && v.length < 40 ? v : fallback);

function clean(r) {
  return {
    deviceId: str(r.deviceId, "unknown"),
    temperature: num(r.temperature),
    humidity: num(r.humidity),
    motion: r.motion === true,
    grainMoistureRaw: num(r.grainMoistureRaw),
    grainStatus: str(r.grainStatus, "UNKNOWN"),
    gasRaw: num(r.gasRaw),
    gasStatus: str(r.gasStatus, "UNKNOWN"),
  };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname));
  if (!file.startsWith(PUBLIC_DIR)) return sendJSON(res, 403, { error: "Forbidden" });
  fs.readFile(file, (err, data) => {
    if (err) return sendJSON(res, 404, { error: "Not found" });
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

// ---------- routes ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,DELETE",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  try {
    // ESP32 sends a reading
    if (p === "/api/readings" && req.method === "POST") {
      const data = JSON.parse(await readBody(req));
      const reading = { ...clean(data), receivedAt: new Date().toISOString() };
      readings.push(reading);
      if (readings.length > MAX_READINGS) readings.splice(0, readings.length - MAX_READINGS);
      scheduleSave();
      console.log(
        `[${new Date().toLocaleTimeString()}] ${reading.deviceId}: ` +
          `T=${reading.temperature}°C H=${reading.humidity}% ` +
          `grain=${reading.grainMoistureRaw} (${reading.grainStatus}) ` +
          `gas=${reading.gasRaw} (${reading.gasStatus}) motion=${reading.motion}`
      );
      return sendJSON(res, 201, { ok: true });
    }

    // Latest single reading (ESP32 reads this back)
    if (p === "/api/readings/latest" && req.method === "GET") {
      if (!readings.length) return sendJSON(res, 404, { error: "No readings yet" });
      return sendJSON(res, 200, readings[readings.length - 1]);
    }

    // History for the dashboard
    if (p === "/api/readings" && req.method === "GET") {
      const limit = Math.min(parseInt(url.searchParams.get("limit")) || 200, MAX_READINGS);
      return sendJSON(res, 200, readings.slice(-limit));
    }

    // Clear history
    if (p === "/api/readings" && req.method === "DELETE") {
      readings = [];
      scheduleSave();
      return sendJSON(res, 200, { ok: true });
    }

    // Device online/offline + counts
    if (p === "/api/status" && req.method === "GET") {
      const last = readings[readings.length - 1];
      const lastSeen = last ? Date.parse(last.receivedAt) : null;
      return sendJSON(res, 200, {
        online: lastSeen !== null && Date.now() - lastSeen < OFFLINE_AFTER_MS,
        lastSeen: last ? last.receivedAt : null,
        total: readings.length,
        serverTime: new Date().toISOString(),
      });
    }

    // CSV export
    if (p === "/api/readings.csv" && req.method === "GET") {
      const cols = ["receivedAt", "deviceId", "temperature", "humidity", "motion",
        "grainMoistureRaw", "grainStatus", "gasRaw", "gasStatus"];
      const csv = [cols.join(",")]
        .concat(readings.map((r) => cols.map((c) => (r[c] ?? "")).join(",")))
        .join("\n");
      res.writeHead(200, {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="grainguard-readings.csv"',
      });
      return res.end(csv);
    }

    if (req.method === "GET") return serveStatic(req, res, p);
    sendJSON(res, 404, { error: "Not found" });
  } catch (err) {
    sendJSON(res, 400, { error: err.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("================================");
  console.log("     GRAINGUARD SERVER");
  console.log("================================");
  console.log(`Dashboard on this laptop: http://localhost:${PORT}`);
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
  if (ips.length) {
    console.log("\nPut ONE of these in the ESP32 code as SERVER:");
    ips.forEach((ip) => console.log(`   String SERVER = "http://${ip}:${PORT}";`));
    console.log("(use the one on the same WiFi/hotspot as the ESP32)");
  } else {
    console.log("No network found - connect the laptop to the WiFi/hotspot first.");
  }
  console.log("\nWaiting for readings...\n");
});
