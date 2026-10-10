import http from 'node:http'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import { Server } from 'socket.io'
import { initDb, insertReading, getLatest, getHistory, closeDb } from './db.js'
import { computeScore, statusFor } from './risk.js'
import { maybeSendAlert } from './alerts.js'

// Load server/.env no matter which folder the server is started from
dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) })

const PORT = Number(process.env.PORT) || 4000
const API_KEY = process.env.API_KEY || ''
const ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const app = express()
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: ORIGINS } })

app.use(cors({ origin: ORIGINS }))
app.use(express.json({ limit: '10kb' }))

// ── Validation ──────────────────────────────────────────────
const FIELDS = [
  { key: 't', label: 'temperature, °C', min: -40, max: 125, decimals: 1 },
  { key: 'h', label: 'humidity, %', min: 0, max: 100, decimals: 0 },
  { key: 'g', label: 'gas index, ppm', min: 0, max: 100000, decimals: 0 },
  { key: 'p', label: 'pest activity, events', min: 0, max: 100000, decimals: 0 },
]

function parseReading(body) {
  const values = {}
  for (const f of FIELDS) {
    const raw = body[f.key]
    const n =
      typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
    if (!Number.isFinite(n)) return { error: `"${f.key}" is required and must be a number (${f.label})` }
    if (n < f.min || n > f.max) return { error: `"${f.key}" must be between ${f.min} and ${f.max} (${f.label})` }
    const k = 10 ** f.decimals
    values[f.key] = Math.round(n * k) / k
  }
  return { values }
}

function requireKey(req, res, next) {
  if (!API_KEY) return next()
  if (req.get('x-api-key') === API_KEY) return next()
  return res.status(401).json({ error: 'Invalid or missing x-api-key header' })
}

// ── Routes ──────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }))

// ESP32 -> server
app.post('/api/telemetry', requireKey, async (req, res, next) => {
  try {
    const parsed = parseReading(req.body ?? {})
    if (parsed.error) return res.status(400).json({ error: parsed.error })

    const { t, h, g, p } = parsed.values
    const score = computeScore({ t, h, g, p })
    const reading = await insertReading({
      at: new Date().toISOString(),
      t,
      h,
      g,
      p,
      score,
      status: statusFor(score),
    })

    io.emit('telemetry_update', reading)

    // Alerts run in the background so a slow mail server never delays the ESP32's request
    maybeSendAlert(reading)
      .then((r) => {
        if (r.sent) console.log(`[alert] sent via ${r.channels.join(', ')} (score ${reading.score})`)
      })
      .catch((err) => console.error('[alert] failed:', err.message))

    res.status(201).json({ ok: true, reading })
  } catch (err) {
    next(err)
  }
})

app.get('/api/telemetry/latest', async (_req, res, next) => {
  try {
    const latest = await getLatest()
    if (!latest) return res.status(404).json({ error: 'No readings yet' })
    res.json(latest)
  } catch (err) {
    next(err)
  }
})

app.get('/api/telemetry/history', async (req, res, next) => {
  try {
    const raw = parseInt(req.query.limit, 10)
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 1000) : 24
    res.json(await getHistory(limit))
  } catch (err) {
    next(err)
  }
})

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Body is not valid JSON' })
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Body too large' })
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

// ── Sockets ─────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[socket] dashboard connected (${io.engine.clientsCount} online)`)
  socket.on('disconnect', () => console.log(`[socket] dashboard disconnected (${io.engine.clientsCount} online)`))
})

// ── Start ───────────────────────────────────────────────────
function lanAddresses() {
  const out = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if ((i.family === 'IPv4' || i.family === 4) && !i.internal) out.push(i.address)
    }
  }
  return out
}

try {
  const file = await initDb()
  console.log(`[db] ready: ${file}`)
} catch (err) {
  console.error('[db] could not open the database:', err)
  process.exit(1)
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] GrainGuard API running on http://localhost:${PORT}`)
  lanAddresses().forEach((ip) => console.log(`[server] ESP32 should POST to http://${ip}:${PORT}/api/telemetry`))
  if (API_KEY) console.log('[server] x-api-key is required for POST /api/telemetry')
})

function shutdown() {
  console.log('\n[server] shutting down...')
  setTimeout(() => process.exit(0), 3000).unref()
  io.close(() => closeDb().finally(() => process.exit(0)))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)