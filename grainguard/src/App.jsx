import React, { useState, useEffect, useRef, lazy, Suspense, Component } from 'react';
import { io } from 'socket.io-client';

// Lazy-loaded 3D background component (unchanged)
const HeroScene = lazy(() => import('./HeroScene'));

// Backend address (override with VITE_API_URL in a .env file at the project root)
const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';
// Server reading -> the row shape the dashboard uses (at must be a Date)
const toRow = r => ({ id: r.id, t: r.t, h: r.h, g: r.g, p: r.p, at: new Date(r.at) });

class Safe extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.error('3D scene failed:', err); }
  render() { return this.state.failed ? null : this.props.children; }
}
const NAV = [
  ["Home", "top"],
  ["Overview", "overview"],
  ["Analytics", "analytics"],
  ["History", "history"]
];

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const score = r => Math.round(.2 * clamp((r.t - 30) / 8 * 100) + .3 * clamp((r.h - 70) / 20 * 100) + .25 * clamp(r.g) + .25 * clamp(r.p));
const level = s => s < 35 ? { k: "Safe", cls: "ok" } : s < 70 ? { k: "Moderate risk", cls: "mid" } : { k: "High risk", cls: "hi" };
const rowTag = s => s < 35 ? ["Safe", ""] : s < 70 ? ["Review", "dash"] : ["High risk", "solid"];
const fmt = d => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }).toLowerCase();
const next = (p) => ({ t: +clamp(p.t + (Math.random() - .5) * .8, 30, 38).toFixed(1), h: Math.round(clamp(p.h + (Math.random() - .5) * 2.4, 55, 95)), g: Math.round(clamp(p.g + (Math.random() - .5) * 7, 15, 100)), p: Math.round(clamp(p.p + (Math.random() - .5) * 8, 0, 100)) });

function seed() {
  let r = { t: 34, h: 85, g: 78, p: 89 }, o = [], now = Date.now();
  for (let i = 23; i >= 0; i--) { r = i === 0 ? r : next(r); o.push({ ...r, at: new Date(now - i * 5000) }); }
  o[23] = { ...o[23], t: 34, h: 85, g: 78, p: 89 }; return o;
}

const Mark = () => <span>gg</span>;

const I = {
  t: <path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0z" />,
  h: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
  o: <path d="M3 8h10a2.5 2.5 0 1 0-2.5-2.5M3 12h15a2.5 2.5 0 1 1-2.5 2.5M3 16h8a2.5 2.5 0 1 1-2.5 2.5" />,
  p: <path d="M8 8a4 4 0 0 1 8 0v7a4 4 0 0 1-8 0zM3 9l3 2M21 9l-3 2M3 17l3-2M21 17l-3-2M12 8v10" />,
  s: <path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6zM9 12l2 2 4-4" />
};

// Line-art icon, drawn in the current text colour (black on the white panels)
const Ico = ({ k, sw = 1.2 }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {I[k]}
  </svg>
);

// Sensor tile: framed illustration on top, bold title + reading underneath
function Card({ k, label, value, unit, note }) {
  return (
    <div className="pcard">
      <div className="pic">
        <div className="a">
          <div className="img">
            <span className="tag mono">Live</span>
            <Ico k={k} />
          </div>
        </div>
      </div>
      <h3>{label}</h3>
      <div className="v">{value}<small>{unit}</small></div>
      <div className="n">{note}</div>
    </div>
  );
}

const X0 = 48, X1 = 588, Y0 = 250, Y1 = 16;
const yy = v => Y0 - (v / 100) * (Y0 - Y1);

function Axes({ rows }) {
  const n = rows.length, xs = i => X0 + (i + .5) * ((X1 - X0) / n);
  return (
    <>
      {[0, 25, 50, 75, 100].map(v => (
        <g key={v}>
          <line x1={X0} x2={X1} y1={yy(v)} y2={yy(v)} stroke="var(--grid)" />
          <text x={X0 - 10} y={yy(v) + 4} textAnchor="end">{v}</text>
        </g>
      ))}
      {rows.map((r, i) => i % 2 === 0 && <text key={i} x={xs(i)} y={272} textAnchor="middle">{fmt(r.at).replace(/ (am|pm)/, " ")}</text>)}
    </>
  );
}

function LineChart({ rows }) {
  const n = rows.length, xs = i => X0 + (i + .5) * ((X1 - X0) / n);
  const path = k => rows.map((r, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)} ${yy(r[k]).toFixed(1)}`).join(" ");
  const area = k => `${path(k)} L${xs(n - 1)} ${Y0} L${xs(0)} ${Y0}Z`;
  return (
    <svg className="chart" viewBox="0 0 600 284" role="img" aria-label="Temperature and humidity over the last 12 readings">
      <Axes rows={rows} />
      <path d={area("h")} fill="#000" opacity=".06" />
      <path d={path("h")} fill="none" stroke="#000" strokeWidth="3" strokeDasharray="7 7" strokeLinecap="round" />
      <path d={path("t")} fill="none" stroke="#000" strokeWidth="3.5" strokeLinejoin="round" />
    </svg>
  );
}

function BarChart({ rows }) {
  const n = rows.length, step = (X1 - X0) / n, xs = i => X0 + i * step;
  return (
    <svg className="chart" viewBox="0 0 600 284" role="img" aria-label="Gas index and pest events over the last 12 readings">
      <Axes rows={rows} />
      {rows.map((r, i) => (
        <g key={i}>
          <rect x={xs(i) + step * .14} y={yy(r.g)} width={step * .34} height={Y0 - yy(r.g)} rx="2" fill="#000" />
          <rect x={xs(i) + step * .5} y={yy(r.p)} width={step * .34} height={Y0 - yy(r.p)} rx="2" fill="#fff" stroke="#000" strokeWidth="2.5" />
        </g>
      ))}
    </svg>
  );
}

const Leg = ({ items }) => (
  <div className="leg mono">
    {items.map(([c, t]) => <span key={t}><i style={{ background: c, outline: c === "#fff" ? "2px solid #000" : "none", outlineOffset: -2 }} />{t}</span>)}
  </div>
);

const SOLID = "#000";
const DASHED = "repeating-linear-gradient(90deg,#000 0 6px,transparent 6px 11px)";

// Chart tile: framed white chart on top, title + caption underneath
function ChartCard({ id, title, sub, legend, children }) {
  return (
    <div className="chartcard" id={id}>
      <div className="pic">
        <div className="a">
          <div className="img">
            <Leg items={legend} />
            {children}
          </div>
        </div>
      </div>
      <div className="ph">
        <div><h3>{title}</h3><p className="s">{sub}</p></div>
        <span className="chip mono">Updating</span>
      </div>
    </div>
  );
}

export default function App() {
  const [rows, setRows] = useState(seed);      // demo data until the backend answers
  const [real, setReal] = useState(false);         // true once rows hold real ESP32 readings
  const [conn, setConn] = useState("offline");     // "live" | "offline"
  const [menu, setMenu] = useState(false);
  const [on, setOn] = useState("Home");
  const [all, setAll] = useState(false);
  const hasLive = useRef(false);

  useEffect(() => {
    let alive = true;

    // 1) load the latest readings once
    fetch(`${API}/api/telemetry/history?limit=24`)
      .then(res => (res.ok ? res.json() : []))
      .then(list => {
        if (!alive || !Array.isArray(list) || list.length === 0) return;
        hasLive.current = true;
        setReal(true);
        const hist = list.map(toRow);
        const lastId = hist[hist.length - 1].id;
        // keep anything the socket delivered while this request was in flight
        setRows(prev => [...hist, ...prev.filter(r => r.id != null && r.id > lastId)].slice(-24));
      })
      .catch(() => {});

    // 2) then stream every new reading
    const socket = io(API);
    socket.on("connect", () => setConn("live"));
    socket.on("disconnect", () => setConn("offline"));
    socket.on("connect_error", () => setConn("offline"));
    socket.on("telemetry_update", msg => {
      const row = toRow(msg);
      const wasLive = hasLive.current;
      hasLive.current = true;
      setReal(true);
      // first real reading replaces the demo rows; later ones are appended
      setRows(prev => (wasLive ? [...prev.filter(r => r.id !== row.id).slice(-23), row] : [row]));
    });

    return () => { alive = false; socket.disconnect(); };
  }, []);

  const cur = rows[rows.length - 1], sc = score(cur), lv = level(sc), last12 = rows.slice(-12);
  const hr = new Date().getHours(), greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const go = n => { setOn(n); setMenu(false); };
  const list = (all ? rows.slice().reverse() : rows.slice(-5).reverse());

  return (
    <>
      {/* One fixed 3D scene behind the whole page: hero, dashboard and footer */}
      <Safe>
        <Suspense fallback={null}>
          <HeroScene />
        </Suspense>
      </Safe>
      <div className="page" id="top">
        <header className="hero">
          <div className="shade" />
          <nav className="nav">
            <a className="logo" href="#top"><i><Mark /></i>GrainGuard</a>
            <div className="pill">
              {NAV.map(([n, id]) => <a key={n} href={"#" + id} className={on === n ? "on" : ""} onClick={() => go(n)}>{n}</a>)}
            </div>
            <a className="btn w" href="#team">Contact us</a>
            <button className="btn menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? "Close" : "Menu"}</button>
            {menu && (
              <div className="drop">
                {NAV.map(([n, id]) => <a key={n} href={"#" + id} onClick={() => go(n)}>{n}</a>)}
                <a href="#team" onClick={() => setMenu(false)}>Contact us</a>
              </div>
            )}
          </nav>
          <div className="hero-body">
            <h1>Smart Grain Storage, <span className="serif">Watched Continuously</span></h1>
            <p>Moisture, pest and odour sensing on a single ESP32, with a graded risk verdict, on-site alerts and a local log.</p>
            <div className="cta">
              <a className="btn l" href="#overview">View live status</a>
              <a className="btn o" href="#history">Sensor history</a>
            </div>
            <div className="hero-foot">
              <span>SCROLL ↓</span>
              <span><b style={{ fontWeight: 700 }}>Rs 1,980</b> &nbsp;approx. build cost of one complete unit</span>
            </div>
          </div>
        </header>
      </div>

      <main className="dash">
        <div className="in">
          <div className="top" id="overview">
            <div>
              <div className="eyebrow mono">Storage unit 01 / ESP32 node</div>
              <h2>{greet}, <b>Akshith.</b></h2>
              <p className="sub">Here's the latest health report from your grain storage unit.</p>
            </div>
            <div className="live mono">{real ? "Live telemetry" : "Demo data"}<span>{conn === "live" ? "● Connected" : "○ Offline"} · Updated {fmt(cur.at)}</span></div>
          </div>

          <div className="cards">
            <Card k="t" label="Temperature" value={cur.t} unit="°C" note="Optimal range 20–30°C" />
            <Card k="h" label="Relative humidity" value={cur.h} unit="%" note="Target below 70%" />
            <Card k="o" label="Odour & volatiles" value={cur.g} unit="ppm" note="MQ-135 air quality index" />
            <Card k="p" label="Pest activity" value={cur.p} unit="events" note="IR movement sensor" />
          </div>

          <div className="pic assess">
            <div className="a">
              <div className="l">
                <span className="sh"><Ico k="s" sw={1.4} /></span>
                <div>
                  <div className="mono" style={{ color: "var(--mute)", fontSize: 13 }}>Fused storage assessment</div>
                  <h3>Overall condition: <span className={"stat " + lv.cls}>{lv.k}</span></h3>
                  <p>Weighted from temperature, humidity, volatile gases, and pest movement.</p>
                </div>
              </div>
              <div className="score">
                <div className="mono">Risk score</div>
                <div>{sc}<small>/ 100</small></div>
                <div className="bar"><i style={{ width: sc + "%" }} /></div>
              </div>
            </div>
          </div>

          <div className="charts" id="analytics">
            <ChartCard
              title="Environmental conditions"
              sub="Temperature & humidity · Last 12 readings"
              legend={[[SOLID, "temperature °C"], [DASHED, "humidity %"]]}
            >
              <LineChart rows={last12} />
            </ChartCard>
            <ChartCard
              title="Air quality & pest movement"
              sub="Volatile gases and detected movement"
              legend={[[SOLID, "gas index"], ["#fff", "pest events"]]}
            >
              <BarChart rows={last12} />
            </ChartCard>
          </div>

          <div className="pic log" id="history">
            <div className="a">
              <div className="ph">
                <div>
                  <div className="mono" style={{ color: "var(--mute)", marginBottom: 6, fontSize: 13 }}>Local microSD log</div>
                  <h3>Recent sensor readings</h3>
                </div>
                <button onClick={() => setAll(!all)}>{all ? "Show recent only" : "View full history →"}</button>
              </div>
              <div className={"tw " + (all ? "scroll" : "")}>
                <table>
                  <thead>
                    <tr><th>Timestamp</th><th>Temperature</th><th>Humidity</th><th>Gas index</th><th>Pest activity</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {list.map((r, i) => {
                      const tg = rowTag(score(r));
                      return (
                        <tr key={r.at.getTime() + "-" + i}>
                          <td>{fmt(r.at)}</td>
                          <td>{r.t}°C</td>
                          <td>{r.h}%</td>
                          <td>{r.g} ppm</td>
                          <td>{r.p} events</td>
                          <td><span className={"badge " + tg[1]}>{tg[0]}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <p className="note">{real ? "Readings on this page are streamed live from the ESP32 node through the GrainGuard server." : "Showing simulated demo readings. Start the GrainGuard server and connect the ESP32 node to see live values."}</p>
        </div>
        <footer className="foot" id="team">
          <span><b>GrainGuard</b> · Smart Grain Storage Pest & Moisture Monitoring System</span>
          <span>M. Akshith · Prem Kumar · Yashwanth · Supervisor: Dr. P. Narsaiah · Vasavi College of Engineering (Autonomous), CSE · Batch C8</span>
        </footer>
      </main>
    </>
  );
}