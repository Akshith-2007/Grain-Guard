import nodemailer from 'nodemailer'
import { HIGH_RISK_THRESHOLD } from './risk.js'

let lastAlertAt = 0
let transporter = null

function cooldownMs() {
  const min = Number(process.env.ALERT_COOLDOWN_MIN)
  return (Number.isFinite(min) && min > 0 ? min : 5) * 60_000
}

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env
  if (!SMTP_HOST) return null
  if (!transporter) {
    const port = Number(SMTP_PORT) || 587
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: port === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    })
  }
  return transporter
}

function buildMessage(r) {
  const subject = `[GrainGuard] HIGH RISK - score ${r.score}/100`
  const text = [
    'GrainGuard HIGH RISK alert',
    '',
    `Risk score:     ${r.score} / 100 (${r.status})`,
    `Temperature:    ${r.t} °C   (optimal 20-30 °C)`,
    `Humidity:       ${r.h} %    (target below 70 %)`,
    `Gas index:      ${r.g} ppm`,
    `Pest activity:  ${r.p} events`,
    `Time:           ${new Date(r.at).toLocaleString()}`,
    '',
    'Check the grain storage unit as soon as possible.',
  ].join('\n')
  return { subject, text }
}

async function deliver(reading) {
  const { subject, text } = buildMessage(reading)
  const tasks = []

  const tx = getTransporter()
  if (tx && process.env.ALERT_TO) {
    tasks.push({
      name: 'email',
      run: () =>
        tx.sendMail({
          from: process.env.ALERT_FROM || process.env.SMTP_USER || 'grainguard@localhost',
          to: process.env.ALERT_TO,
          subject,
          text,
          priority: 'high',
        }),
    })
  }

  const hook = process.env.ALERT_WEBHOOK_URL
  if (hook) {
    tasks.push({
      name: 'webhook',
      run: async () => {
        const res = await fetch(hook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `${subject}\n${text}`, content: `${subject}\n${text}` }),
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      },
    })
  }

  // Nothing configured: mock mode, print the alert so the flow can be tested
  if (tasks.length === 0) {
    console.warn(`[alert] MOCK (no SMTP/webhook configured)\n${subject}\n${text}\n`)
    return ['console']
  }

  const settled = await Promise.allSettled(tasks.map((t) => t.run()))
  const ok = []
  const failed = []
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') ok.push(tasks[i].name)
    else failed.push(`${tasks[i].name}: ${s.reason?.message || s.reason}`)
  })
  failed.forEach((f) => console.error('[alert] channel failed -', f))
  if (ok.length === 0) throw new Error(failed.join('; '))
  return ok
}

// Call this for every new reading. Sends at most one alert per cooldown window (default 5 min).
export async function maybeSendAlert(reading) {
  if (reading.score < HIGH_RISK_THRESHOLD) return { sent: false, reason: 'below-threshold' }

  const now = Date.now()
  if (now - lastAlertAt < cooldownMs()) return { sent: false, reason: 'cooldown' }

  const previous = lastAlertAt
  lastAlertAt = now // claim the slot first so two quick readings can't both send
  try {
    const channels = await deliver(reading)
    return { sent: true, channels }
  } catch (err) {
    lastAlertAt = previous // nothing was delivered, allow a retry on the next reading
    throw err
  }
}