// Fake ESP32 for testing without hardware.
//   npm run simulate             normal readings every 4 s
//   npm run simulate -- --high   starts in the High-risk zone (to test alerts)
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) })

const URL_ = process.env.TELEMETRY_URL || `http://localhost:${process.env.PORT || 4000}/api/telemetry`
const KEY = process.env.API_KEY || ''
const high = process.argv.includes('--high')

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const jitter = (amt) => (Math.random() - 0.5) * amt

let r = high ? { t: 36, h: 90, g: 85, p: 80 } : { t: 27, h: 66, g: 35, p: 15 }

async function send() {
  r = {
    t: +clamp(r.t + jitter(0.8), 20, 38).toFixed(1),
    h: Math.round(clamp(r.h + jitter(2.4), 55, 95)),
    g: Math.round(clamp(r.g + jitter(7), 5, 100)),
    p: Math.round(clamp(r.p + jitter(8), 0, 100)),
  }
  try {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(KEY ? { 'x-api-key': KEY } : {}) },
      body: JSON.stringify(r),
    })
    const body = await res.json()
    console.log(res.status, JSON.stringify(r), body.reading ? `score ${body.reading.score} (${body.reading.status})` : body)
  } catch (err) {
    console.error('Could not reach the server:', err.message)
  }
}

console.log(`Sending to ${URL_} every 4 s (Ctrl+C to stop)`)
send()
setInterval(send, 4000)