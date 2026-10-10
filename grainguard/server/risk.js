// Same maths as the dashboard (App.jsx), so server and UI always agree.
export const HIGH_RISK_THRESHOLD = 70

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v))

export function computeScore({ t, h, g, p }) {
  return Math.round(
    0.2 * clamp(((t - 30) / 8) * 100) +
      0.3 * clamp(((h - 70) / 20) * 100) +
      0.25 * clamp(g) +
      0.25 * clamp(p)
  )
}

export function statusFor(score) {
  return score < 35 ? 'Safe' : score < 70 ? 'Moderate risk' : 'High risk'
}