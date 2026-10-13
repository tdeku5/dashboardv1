// Colour-math port of docs/palette_check_reference.py — WCAG 2.x contrast,
// CIEDE2000, and Machado 2009 colour-vision-deficiency simulation (severity
// 1.0, applied in linear RGB). Function-for-function with the reference so
// numbers match it; the reference .py stays in docs/ and is never run by tests.

export type Rgb = [number, number, number]
export type Lab = [number, number, number]
type Matrix = [Rgb, Rgb, Rgb]

export function hex2rgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb
}

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

function unlin(c: number): number {
  const x = Math.max(0, Math.min(1, c))
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
}

export function luminance(hex: string): number {
  const [r, g, b] = hex2rgb(hex).map(lin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, ≥ 1. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

export function lab(rgb: Rgb): Lab {
  const [r, g, b] = rgb.map(lin)
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t: number) => (t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116)
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]
}

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

export function de2000(l1: Lab, l2: Lab): number {
  const [L1, a1, b1] = l1
  const [L2, a2, b2] = l2
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cb = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const mod360 = (x: number) => ((x % 360) + 360) % 360
  const h1 = mod360(deg(Math.atan2(b1, a1p)))
  const h2 = mod360(deg(Math.atan2(b2, a2p)))
  const dL = L2 - L1
  const dC = C2p - C1p
  let dh = h2 - h1
  if (C1p * C2p === 0) dh = 0
  else if (dh > 180) dh -= 360
  else if (dh < -180) dh += 360
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dh / 2))
  const Lb = (L1 + L2) / 2
  const Cbp = (C1p + C2p) / 2
  let hb = h1 + h2
  if (C1p * C2p !== 0) {
    hb = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2
      : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2
  }
  const T = 1 - 0.17 * Math.cos(rad(hb - 30)) + 0.24 * Math.cos(rad(2 * hb))
    + 0.32 * Math.cos(rad(3 * hb + 6)) - 0.20 * Math.cos(rad(4 * hb - 63))
  const dth = 30 * Math.exp(-(((hb - 275) / 25) ** 2))
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2)
  const SC = 1 + 0.045 * Cbp
  const SH = 1 + 0.015 * Cbp * T
  const RT = -Math.sin(rad(2 * dth)) * RC
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH))
}

/** Machado 2009, severity 1.0. */
export const DEUT: Matrix = [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]]
export const PROT: Matrix = [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]]

export function simulate(hex: string, M: Matrix): Rgb {
  const r = hex2rgb(hex).map(lin)
  return M.map(row => unlin(row[0] * r[0] + row[1] * r[1] + row[2] * r[2])) as Rgb
}

/** ΔE2000 between two colours, optionally under a CVD simulation. */
export function deltaE(a: string, b: string, M?: Matrix): number {
  const A = M ? simulate(a, M) : hex2rgb(a)
  const B = M ? simulate(b, M) : hex2rgb(b)
  return de2000(lab(A), lab(B))
}

/** sRGB source-over composite of `fg` at `alpha` on an opaque `bg` → hex. */
export function composite(fg: string, alpha: number, bg: string): string {
  const f = hex2rgb(fg)
  const b = hex2rgb(bg)
  return '#' + f.map((x, i) => Math.round((alpha * x + (1 - alpha) * b[i]) * 255).toString(16).padStart(2, '0')).join('')
}
