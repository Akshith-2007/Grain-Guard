import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sqlite3 from 'sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let db = null

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err)
      else resolve({ lastID: this.lastID, changes: this.changes })
    })
  })

const get = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))))

const all = (sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))))

const exec = (sql) =>
  new Promise((resolve, reject) => db.exec(sql, (err) => (err ? reject(err) : resolve())))

// Open (or create) the database and make sure the table exists.
export function initDb() {
  const file = path.resolve(__dirname, process.env.DB_PATH || './data/grainguard.db')
  fs.mkdirSync(path.dirname(file), { recursive: true })

  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(file, async (err) => {
      if (err) return reject(err)
      try {
        await exec('PRAGMA journal_mode = WAL;')
        await exec(`
          CREATE TABLE IF NOT EXISTS logs (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp     TEXT    NOT NULL,
            temperature   REAL    NOT NULL,
            humidity      REAL    NOT NULL,
            gas_index     REAL    NOT NULL,
            pest_activity REAL    NOT NULL,
            risk_score    INTEGER NOT NULL,
            status        TEXT    NOT NULL
          );
        `)
        resolve(file)
      } catch (e) {
        reject(e)
      }
    })
  })
}

// DB row -> the shape the dashboard uses ({ t, h, g, p, at } + score/status)
const toReading = (r) => ({
  id: r.id,
  at: r.timestamp,
  t: r.temperature,
  h: r.humidity,
  g: r.gas_index,
  p: r.pest_activity,
  score: r.risk_score,
  status: r.status,
})

export async function insertReading({ at, t, h, g, p, score, status }) {
  const { lastID } = await run(
    `INSERT INTO logs (timestamp, temperature, humidity, gas_index, pest_activity, risk_score, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [at, t, h, g, p, score, status]
  )
  return { id: lastID, at, t, h, g, p, score, status }
}

export async function getLatest() {
  const row = await get('SELECT * FROM logs ORDER BY id DESC LIMIT 1')
  return row ? toReading(row) : null
}

// Last `limit` readings, oldest first (so the newest is the last item, like the dashboard expects)
export async function getHistory(limit) {
  const rows = await all('SELECT * FROM logs ORDER BY id DESC LIMIT ?', [limit])
  return rows.reverse().map(toReading)
}

export function closeDb() {
  return new Promise((resolve) => (db ? db.close(() => resolve()) : resolve()))
}