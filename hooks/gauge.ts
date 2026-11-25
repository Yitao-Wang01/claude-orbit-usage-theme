// The usage gauge, drawn over the Low Orbit scene on the GPU.
//
// The 5-hour limit is a small ship flying an orbit just above Earth's rim, from
// the left of the horizon toward the sunrise on the right: how far along it is,
// is how much of the window is used. The weekly limit is a satellite on a
// higher, fainter orbit. Each trail turns from cyan to amber to coral as its
// limit nears, and a small readout rides above each craft.
//
// The mod only sends the four numbers below; the app eases the craft to each
// new reading without redrawing the scene.
import {
  abs,
  atan,
  clamp,
  cos,
  exp,
  floor,
  int,
  length,
  max,
  min,
  mix,
  mod,
  picture,
  pow,
  range,
  px,
  scene,
  shader,
  signed,
  sin,
  size,
  smoothstep,
  sqrt,
  step,
  table,
  time,
  values,
  vec2,
  vec3,
  vec4,
} from 'claude-code/shader'

const v = values({
  five: [0, 100],
  week: [0, 100],
  hasFive: [0, 1],
  hasWeek: [0, 1],
})

// Earth in the scene's 1600 x 1000 viewBox, and the two orbits above its rim.
const EARTH_X = 800
const EARTH_Y = 2050
const ORBIT_FIVE = 1470
const ORBIT_WEEK = 1550

// 3 x 5 pixel glyphs, one bit a pixel, row by row from the top left:
// 0-9, then h, d, % and a blank.
const GLYPHS = table(
  [31599, 29850, 29671, 31207, 18925, 14543, 31695, 18727, 31727, 31215, 23497, 31716, 21157, 0],
  'int',
)
const H = 10
const D = 11
const PCT = 12
const BLANK = 13

const CALM = vec3(0.48, 0.85, 1.0)
const WARM = vec3(1.0, 0.82, 0.54)
const HOT = vec3(1.0, 0.42, 0.48)
const HULL = vec3(0.88, 0.92, 1.0)
const PANEL = vec3(0.56, 0.66, 0.92)
const INK = vec3(0.8, 0.86, 1.0)

function level(t: number): vec3 {
  return vec3(mix(mix(CALM, WARM, smoothstep(0.55, 0.75, t)), HOT, smoothstep(0.8, 0.95, t)))
}

// Lays a color at an alpha over what is there, premultiplied.
function over(dst: vec4, c: vec3, a: number): vec4 {
  const k = clamp(a, 0, 1)
  return vec4(vec3(c * k + dst.rgb * (1 - k)), k + dst.a * (1 - k))
}

// Which glyph the readout shows at character k: two label glyphs, a gap,
// then the whole percent and a % sign.
function glyphAt(k: number, labelA: number, labelB: number, pct: number): number {
  const n = floor(clamp(pct, 0, 100) + 0.5)
  const count = 1 + step(10, n) + step(100, n)
  const j = k - 3
  const digit = mod(floor(n / pow(10, max(count - 1 - j, 0))), 10)
  const isDigit = step(j + 0.5, count)
  const isPct = step(abs(j - count), 0.5)
  const number = isDigit * digit + (1 - isDigit) * (isPct * PCT + (1 - isPct) * BLANK)
  const isA = step(abs(k), 0.5)
  const isB = step(abs(k - 1), 0.5)
  const isGap = step(abs(k - 2), 0.5)
  return isA * labelA + isB * labelB + isGap * BLANK + (1 - isA - isB - isGap) * number
}

// 1 where the readout's pixel is lit. (tx, ty) are in glyph pixels from the
// readout's top left.
function lit(tx: number, ty: number, labelA: number, labelB: number, pct: number): number {
  const k = floor(tx / 4)
  const col = floor(tx - k * 4)
  const row = floor(ty)
  const inside = step(0, k) * step(k, 6.5) * step(col, 2.5) * step(0, row) * step(row, 4.5) * step(0, tx) * step(0, ty)
  const code = GLYPHS.at(glyphAt(clamp(k, 0, 6), labelA, labelB, pct))
  const bit = signed(int(int(code >> int(clamp(row, 0, 4) * 3 + clamp(col, 0, 2))) & 1))
  return inside * bit
}

// How bright the scene is along one edge (green and blue, three samples):
// space at the top measures well under Earth at the bottom on every window shape.
function edgeGlow(v: number): number {
  const a = scene.sample(vec2(0.3, v))
  const b = scene.sample(vec2(0.5, v))
  const c = scene.sample(vec2(0.7, v))
  return a.g + a.b + b.g + b.b + c.g + c.b
}

export default shader({
  fps: 30,
  passes: [
    picture(p => {
      // Points, y growing downward, whichever way the target runs: Earth fills
      // the foot of the scene, so its brighter, bluer edge is the bottom.
      const isUp = step(edgeGlow(0.97), edgeGlow(0.03))
      const ptx = p.uv.x * size.x
      const pty = mix(p.uv.y, 1 - p.uv.y, isUp) * size.y

      // The scene's own units, as its `xMidYMid slice` lays it on the window.
      const s = max(size.x / 1600, size.y / 1000)
      const ox = (size.x - 1600 * s) * 0.5
      const oy = (size.y - 1000 * s) * 0.5
      const x = (ptx - ox) / s
      const y = (pty - oy) / s

      // The stretch of horizon that is on screen, with a margin each side.
      const left = -ox / s
      const right = (size.x - ox) / s
      const margin = (right - left) * 0.07
      const xa = left + margin - EARTH_X
      const xb = right - margin - EARTH_X

      const dx = x - EARTH_X
      const dy = EARTH_Y - y
      const angle = atan(dx, dy)
      const radius = length(vec2(dx, dy))

      // Nothing is drawn outside the strip that holds both orbits, the craft
      // and their readouts, so most of the window stops here.
      if (radius < ORBIT_FIVE - 24 / s) {
        return vec4(0)
      }
      if (radius > ORBIT_WEEK + 44 / s) {
        return vec4(0)
      }

      let out = vec4(0)

      // Each orbit in turn: 0 the ship (5 hours), 1 the satellite (week).
      for (const o of range(2)) {
        const isShip = 1 - o
        const r = mix(ORBIT_FIVE, ORBIT_WEEK, o)
        const has = mix(v.hasFive, v.hasWeek, o)
        const t = clamp(mix(v.five, v.week, o) / 100, 0, 1)
        const tint = level(t)
        const fade = mix(1, 0.7, o)

        const a0 = atan(xa, sqrt(max(r * r - xa * xa, 1)))
        const a1 = atan(xb, sqrt(max(r * r - xb * xb, 1)))
        const u = (angle - a0) / (a1 - a0)
        const onArc = step(0, u) * step(u, 1)
        const off = abs(radius - r) * s
        const along = (angle - a0) * r * s

        // The trail flown so far, brightest just behind the craft.
        const flown = step(u, t) * onArc
        const glow = mix(0.06, 0.42, smoothstep(t - 0.3, t, u))
        const shimmer = 0.85 + 0.15 * sin(along * 0.05 - time * 0.8)
        const line = 1 - smoothstep(0.7 - px, 0.7 + px, off)
        out = over(out, tint, flown * line * glow * shimmer * fade * has)

        // The way still ahead, as faint dots.
        const cell = mod(along, 10) - 5
        const dot = 1 - smoothstep(0.75 - px, 0.75 + px, length(vec2(cell, off)))
        out = over(out, INK, (1 - step(u, t)) * onArc * dot * 0.16 * fade * has)

        // Small ticks where the orbit starts and where the limit is.
        const tick = (1 - smoothstep(1.4 - px, 1.4 + px, length(vec2(min(abs(along), abs(along - (a1 - a0) * r * s)), off))))
        out = over(out, INK, tick * 0.3 * fade * has)

        // The craft, facing along the orbit.
        const ca = mix(a0, a1, t)
        const cx = EARTH_X + r * sin(ca)
        const cy = EARTH_Y - r * cos(ca)
        const rx = (x - cx) * s
        const ry = (y - cy) * s
        const lx = rx * cos(ca) + ry * sin(ca)
        const ly = -(rx * sin(ca) - ry * cos(ca))

        const pulse = 0.8 + 0.2 * sin(time * 1.6 + o * 2)
        const engine = exp(-(pow(lx + 10.5 - o * 10.5, 2) + ly * ly) / (2 * 3.4 * 3.4)) * pulse
        const plume = exp(-(pow(lx + 17, 2) / (2 * 81) + (ly * ly) / (2 * 1.7))) * step(lx, -9) * isShip
        out = over(out, tint, (engine * mix(0.7, 0.5, o) + plume * 0.45) * has)

        // The ship: a slim hull with swept wings and a lit canopy.
        const hull = length(vec2(lx / 9.5, ly / 2.8))
        const hullA = 1 - smoothstep(1 - px / 2.8, 1 + px / 2.8, hull)
        const wing = length(vec2((lx + 3) / 2.2, ly / 6.8))
        const wingA = 1 - smoothstep(1 - px / 2.2, 1 + px / 2.2, wing)
        const canopy = 1 - smoothstep(1.2 - px, 1.2 + px, length(vec2(lx - 4, ly)))
        out = over(out, PANEL, wingA * 0.9 * isShip * has)
        out = over(out, HULL, hullA * 0.95 * isShip * has)
        out = over(out, tint, canopy * isShip * has)

        // The satellite: a bright core between two solar panels.
        const core = 1 - smoothstep(2.4 - px, 2.4 + px, length(vec2(lx, ly)))
        const panel = step(abs(lx), 8.5) * step(3.4, abs(lx)) * (1 - smoothstep(1.5 - px, 1.5 + px, abs(ly)))
        out = over(out, PANEL, panel * 0.85 * o * has)
        out = over(out, HULL, core * 0.95 * o * has)

        // The readout above the craft: "5h 42%" or "7d 18%".
        const fp = 1.5
        const textLeft = cx * s + ox - 14 * fp
        const textTop = cy * s + oy - 22 - 5 * fp
        const on = lit((ptx - textLeft) / fp, (pty - textTop) / fp, mix(5, 7, o), mix(H, D, o), t * 100)
        out = over(out, vec3(mix(INK, tint, 0.45)), on * 0.72 * has)
      }

      return out
    }),
  ],
})
