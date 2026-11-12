// The building: pixel art drawn into small framebuffers, written out as SVG with
// SMIL loops. Nothing here touches `$`, so it also runs under plain Node.
import type { ActivityKind, PlanStatus, Robot, TokenTally, World } from '../types'
import { champion, dailyTotals, formatTokens } from './tally'

export const W = 256
const GROUND_H = 170
export const FLOOR_H = 56
const FY = 116
const SEAT_Y = FY - 6
const MAIN_X = 110
const FEED_MS = 1500
const PRINT_MS = 2400
const WALK_PX_PER_S = 90
const LIFT_PX_PER_S = 120
const MIN_WORK_MS = 2500
const CHEER_MS = 900
const BRIEF_MS = 1100
const HANDOFF_MS = 1000
const HOP_MS = 220
const FALL_MS = 560
const SPLASH_MS = 800
export const GROUND_SEATS = 2
export const PER_FLOOR = 5
export const MAX_FLOORS = 4
export const CAPACITY = GROUND_SEATS + PER_FLOOR * MAX_FLOORS

export const C = {
  ink: '#1a1428', night: '#1b1735', night2: '#241f47', dusk: '#322a5f',
  slate: '#37596c', slateD: '#2b4759', slateL: '#3f6478',
  wood: '#8f5e3f', woodD: '#6a432e', woodL: '#ba8055',
  cream: '#f6e9cf', paper: '#fff6df', amber: '#ffc35c', lamp: '#ffe9a8',
  coral: '#e8825f', coralD: '#b85a40', coralL: '#f9ab88',
  teal: '#46c9b6', tealD: '#2a8d82', tealL: '#93ecdd',
  steel: '#aab3c9', steelD: '#6f7893', steelL: '#dbe1ee',
  red: '#e8504f', redD: '#9c2f38', green: '#62d56e', greenD: '#2f8f4a',
  blue: '#4f8fe6', blueD: '#2f5fb0', violet: '#9c7ee0', violetD: '#6a4fb0', violetL: '#c7b1f5',
  yellow: '#f2d14e', scr: '#0f1c2a', glow: '#7ff5ff', leaf: '#4fae5a', leafD: '#2e7a45',
  white: '#ffffff', page: '#f4f7ff', panel: '#2b3049', panel2: '#3b4262', dark: '#11152a',
}

export type Paint = { l: string; m: string; d: string }
type Headgear = 'antenna' | 'beret' | 'hardhat' | 'goggles' | 'mortar' | 'safari' | 'beanie' | 'phones' | 'cap'

/* Each role has its own paint and headgear, so you can tell who is who across the room. */
export type Role = { id: string; title: string; headgear: Headgear; paint: Paint; words?: RegExp }
const ROLES: Role[] = [
  { id: 'designer', title: 'Designer', headgear: 'beret', paint: { l: '#ffb8d4', m: '#e86aa6', d: '#a8436f' }, words: /\b(design(er|ing)?|ui|ux|artist|visual|palette|colou?rs?|style|css|icons?)\b/i },
  { id: 'architect', title: 'Architect', headgear: 'hardhat', paint: { l: '#a9ccff', m: C.blue, d: C.blueD }, words: /\b(architect(ure)?|plan(ner|ning)?|structure|blueprint|system design)\b/i },
  { id: 'tester', title: 'Tester', headgear: 'goggles', paint: { l: '#dcf59a', m: '#a8cc3c', d: '#6f8f22' }, words: /\b(test(er|s|ing)?|qa|verif(y|ier|ication))\b/i },
  { id: 'reviewer', title: 'Reviewer', headgear: 'mortar', paint: { l: C.violetL, m: C.violet, d: C.violetD }, words: /\b(review(er|ing)?|audit(or)?|critic|inspect(or)?)\b/i },
  { id: 'explorer', title: 'Explorer', headgear: 'safari', paint: { l: C.tealL, m: C.teal, d: C.tealD }, words: /\b(explor(e|er|ing)|research(er|ing)?|search(ing)?|find|investigat\w*|scout|survey)\b/i },
  { id: 'writer', title: 'Writer', headgear: 'beanie', paint: { l: '#f3dcb5', m: '#d2a86e', d: '#9c7444' }, words: /\b(writ(e|er|ing)|docs?|documentation|copy|author|readme)\b/i },
  { id: 'coder', title: 'Coder', headgear: 'phones', paint: { l: '#b5f0bb', m: C.green, d: C.greenD }, words: /\b(cod(e|er|ing)|develop(er)?|engineer|implement\w*|program\w*|refactor\w*|fix|build(er)?)\b/i },
]
const MAIN_ROLE: Role = { id: 'main', title: 'Main agent', headgear: 'antenna', paint: { l: C.coralL, m: C.coral, d: C.coralD } }
const HELPER_ROLE: Role = { id: 'helper', title: 'Helper', headgear: 'cap', paint: { l: C.steelL, m: C.steel, d: C.steelD } }
const BY_TYPE: Record<string, string> = { Explore: 'explorer', Plan: 'architect', 'code-reviewer': 'reviewer', reviewer: 'reviewer' }

export function roleInfo(id: string): Role {
  if (id === 'main') return MAIN_ROLE
  return ROLES.find((r) => r.id === id) ?? HELPER_ROLE
}

/** How round a robot looks, 0 to 3: it fills out as its context grows, and slims after a compaction. */
export function girthOf(context: number | undefined): number {
  const n = context ?? 0
  return n >= 150_000 ? 3 : n >= 80_000 ? 2 : n >= 40_000 ? 1 : 0
}

/** The role a robot plays: the first of its texts that names one, then its agent type. */
export function roleOf(type: string, ...texts: string[]): string {
  if (type === 'main') return 'main'
  for (const text of texts) {
    const hit = ROLES.find((r) => r.words?.test(text))
    if (hit) return hit.id
  }
  const byType = BY_TYPE[type] ?? ROLES.find((r) => r.words?.test(type))?.id
  return byType ?? HELPER_ROLE.id
}

/* ---------- framebuffer ---------- */
export class Px {
  readonly w: number
  readonly h: number
  private readonly buf: Int16Array
  private readonly cols: string[] = []
  private readonly idx = new Map<string, number>()

  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.buf = new Int16Array(w * h).fill(-1)
  }

  R(c: string, x: number, y: number, w: number, h: number): void {
    x = Math.trunc(x)
    y = Math.trunc(y)
    const x0 = Math.max(0, x)
    const y0 = Math.max(0, y)
    const x1 = Math.min(this.w, x + Math.trunc(w))
    const y1 = Math.min(this.h, y + Math.trunc(h))
    if (x1 <= x0 || y1 <= y0) return
    let ci = this.idx.get(c)
    if (ci === undefined) {
      ci = this.cols.length
      this.cols.push(c)
      this.idx.set(c, ci)
    }
    for (let yy = y0; yy < y1; yy++) this.buf.fill(ci, yy * this.w + x0, yy * this.w + x1)
  }

  /** Greedy rectangles per colour: one `<path>` per colour, no overlaps. */
  svg(): string {
    const { w, h, buf } = this
    const used = new Uint8Array(w * h)
    const paths = new Map<number, string[]>()
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const c = buf[i]!
        if (c < 0 || used[i]) continue
        let x1 = x
        while (x1 + 1 < w && buf[i + x1 + 1 - x] === c && !used[i + x1 + 1 - x]) x1++
        let y1 = y
        grow: while (y1 + 1 < h) {
          for (let k = x; k <= x1; k++) {
            const j = (y1 + 1) * w + k
            if (buf[j] !== c || used[j]) break grow
          }
          y1++
        }
        for (let yy = y; yy <= y1; yy++) used.fill(1, yy * w + x, yy * w + x1 + 1)
        const rw = x1 - x + 1
        const list = paths.get(c) ?? []
        list.push(`M${x} ${y}h${rw}v${y1 - y + 1}h-${rw}z`)
        paths.set(c, list)
      }
    }
    let out = ''
    for (const [c, d] of paths) out += `<path fill="${this.cols[c]}" d="${d.join('')}"/>`
    return out
  }
}

const R = (g: Px, c: string, x: number, y: number, w: number, h: number) => g.R(c, x, y, w, h)
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const tri = (u: number) => {
  u = u % 1
  return u < 0.5 ? u * 2 : 2 - u * 2
}
function rng(s: number) {
  let a = s >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function disc(g: Px, c: string, cx: number, cy: number, r: number) {
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(r * r - y * y) + 0.35)
    R(g, c, cx - w, cy + y, w * 2 + 1, 1)
  }
}
function thick(g: Px, c: string, x0: number, y0: number, x1: number, y1: number, w: number) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
  for (let i = 0; i <= n; i++) {
    const u = i / n
    R(g, c, Math.round(x0 + (x1 - x0) * u - w / 2), Math.round(y0 + (y1 - y0) * u - w / 2), w, w)
  }
}

/* ---------- 3x5 pixel font ---------- */
const FONT: Record<string, string> = {
  A: '010|101|111|101|101', B: '110|101|110|101|110', C: '011|100|100|100|011', D: '110|101|101|101|110',
  E: '111|100|110|100|111', F: '111|100|110|100|100', G: '011|100|101|101|011', H: '101|101|111|101|101',
  I: '111|010|010|010|111', J: '001|001|001|101|010', K: '101|101|110|101|101', L: '100|100|100|100|111',
  M: '10001|11011|10101|10001|10001', N: '1001|1101|1011|1001|1001', O: '010|101|101|101|010',
  P: '110|101|110|100|100', Q: '010|101|101|110|011', R: '110|101|110|101|101', S: '011|100|010|001|110',
  T: '111|010|010|010|010', U: '101|101|101|101|011', V: '101|101|101|101|010',
  W: '10001|10001|10101|11011|10001', X: '101|101|010|101|101', Y: '101|101|010|010|010',
  Z: '111|001|010|100|111', 0: '111|101|101|101|111', 1: '010|110|010|010|111', 2: '110|001|010|100|111',
  3: '110|001|010|001|110', 4: '101|101|111|001|001', 5: '111|100|110|001|110', 6: '011|100|111|101|111',
  7: '111|001|010|010|010', 8: '111|101|111|101|111', 9: '111|101|111|001|110', '.': '0|0|0|0|1',
  ',': '0|0|0|1|1', ':': '0|1|0|1|0', '/': '001|001|010|100|100', '-': '000|000|111|000|000',
  _: '000|000|000|000|111', "'": '1|1|0|0|0', '"': '101|101|000|000|000', '(': '01|10|10|10|01',
  ')': '10|01|01|01|10', '?': '110|001|010|000|010', '!': '1|1|1|0|1', '>': '100|010|001|010|100',
  '<': '001|010|100|010|001', '=': '000|111|000|111|000', '+': '000|010|111|010|000',
  '*': '000|101|010|101|000', $: '011|110|010|011|110', '%': '101|001|010|100|101', ' ': '00|00|00|00|00',
}
const GL: Record<string, string[]> = {}
for (const k in FONT) GL[k] = FONT[k]!.split('|')
const glyph = (ch: string) => GL[ch] ?? GL[' ']!
export const tw = (s: string) => {
  let w = 0
  for (const ch of s.toUpperCase()) w += glyph(ch)[0]!.length + 1
  return Math.max(0, w - 1)
}
function tx(g: Px, s: string, x: number, y: number, c: string) {
  x = Math.trunc(x)
  y = Math.trunc(y)
  for (const ch of s.toUpperCase()) {
    const r = glyph(ch)
    for (let j = 0; j < 5; j++) {
      const row = r[j]!
      for (let i = 0; i < row.length; i++) if (row[i] === '1') R(g, c, x + i, y + j, 1, 1)
    }
    x += r[0]!.length + 1
  }
  return x
}
export const fit = (s: string, max: number) => {
  s = s.toUpperCase().replace(/[^A-Z0-9.,:/\-_'"()?!<>=+*$% ]/g, ' ')
  while (tw(s) > max && s.length > 1) s = s.slice(0, -1)
  return s
}

/* ---------- the robot ---------- */
type Eyes = 'open' | 'up' | 'happy' | 'x' | 'off'
type Pose = 'stand' | 'walk' | 'type' | 'sit' | 'raise' | 'carry' | 'read' | 'lever' | 'cheer' | 'err' | 'sleep'
type BotOpts = {
  paint?: Paint
  small?: boolean
  face?: number
  view?: 'side' | 'front' | 'back'
  pose?: Pose
  eyes?: Eyes
  t?: number
  gear?: Headgear
  /** What a carrying robot holds: its report, or the blueprint of its task. */
  item?: 'report' | 'blueprint'
  /** Sitting on a stool: the body rests on the stool's top, whatever the pose. */
  seated?: boolean
  /** How round the body is, 0 to 3: a robot fills out as its context grows. */
  girth?: number
  bulb?: string
  chest?: string
}

/** Hats and kit on top of the head; drawn after the head, before the visor. */
function headgear(g: Px, gear: Headgear, x: number, hy: number, hw: number, side: boolean, f: number, bulb: string) {
  const I = C.ink
  const hl = x - (hw >> 1)
  const half = hw >> 1
  const X = (dx: number, w: number) => (f > 0 || !side ? x + dx : x - dx - w)
  switch (gear) {
    case 'beret': {
      // a painter's beret slumped toward the back, with a little stalk
      R(g, I, X(-half - 2, hw + 3), hy - 4, hw + 3, 4)
      R(g, I, X(-half - 3, 2), hy - 2, 2, 3)
      R(g, '#c43c5c', X(-half - 1, hw + 1), hy - 3, hw + 1, 2)
      R(g, '#c43c5c', X(-half - 2, 1), hy - 1, 1, 1)
      R(g, '#f07c96', X(-half + 1, hw - 4), hy - 3, hw - 4, 1)
      R(g, I, X(0, 1), hy - 6, 1, 2)
      return
    }
    case 'hardhat': {
      // a builder's hard hat with a brim and a ridge
      R(g, I, hl - 1, hy - 5, hw + 2, 5)
      R(g, I, hl - 3, hy - 1, hw + 6, 2)
      R(g, C.yellow, hl, hy - 4, hw, 3)
      R(g, C.yellow, hl - 2, hy - 1, hw + 4, 1)
      R(g, '#fff3a8', hl + 1, hy - 4, hw - 5, 1)
      R(g, '#c9a227', x - 1, hy - 4, 2, 3)
      return
    }
    case 'goggles': {
      // lab goggles pushed up on the forehead, strap round the head
      R(g, I, hl, hy, hw, 1)
      if (side) {
        R(g, I, X(half - 6, 7), hy - 3, 7, 4)
        R(g, C.tealL, X(half - 5, 5), hy - 2, 5, 2)
        R(g, C.white, X(half - 4, 1), hy - 2, 1, 1)
      } else {
        R(g, I, x - 6, hy - 3, 6, 4)
        R(g, I, x, hy - 3, 6, 4)
        R(g, C.tealL, x - 5, hy - 2, 4, 2)
        R(g, C.tealL, x + 1, hy - 2, 4, 2)
      }
      return
    }
    case 'mortar': {
      // a reviewer's square academic cap with a tassel
      R(g, I, hl - 2, hy - 3, hw + 4, 1)
      R(g, '#2b2f45', hl + 1, hy - 2, hw - 2, 2)
      R(g, I, hl + 1, hy - 2, hw - 2, 1)
      R(g, C.amber, X(half - 2, 1), hy - 3, 1, 4)
      return
    }
    case 'safari': {
      // an explorer's pith helmet with a wide brim
      R(g, I, hl - 3, hy - 1, hw + 6, 2)
      R(g, '#d9c58a', hl - 2, hy - 1, hw + 4, 1)
      R(g, I, hl, hy - 5, hw, 4)
      R(g, '#e6d49a', hl + 1, hy - 4, hw - 2, 3)
      R(g, C.woodD, hl + 1, hy - 2, hw - 2, 1)
      return
    }
    case 'beanie': {
      // a writer's striped beanie with a bobble
      R(g, I, hl - 1, hy - 4, hw + 2, 5)
      R(g, '#5b8def', hl, hy - 3, hw, 2)
      R(g, C.cream, hl, hy - 1, hw, 1)
      R(g, I, x - 2, hy - 7, 4, 3)
      R(g, C.paper, x - 1, hy - 6, 2, 1)
      return
    }
    case 'phones': {
      // a coder's headphones: band over the top, a cup over the ear
      R(g, I, hl, hy - 3, hw, 2)
      R(g, C.steelL, hl + 1, hy - 3, hw - 2, 1)
      if (side) {
        R(g, I, X(-half - 1, 5), hy + 1, 5, 6)
        R(g, C.coral, X(-half, 3), hy + 2, 3, 4)
      } else {
        R(g, I, hl - 3, hy + 1, 4, 6)
        R(g, I, hl + hw - 1, hy + 1, 4, 6)
        R(g, C.coral, hl - 2, hy + 2, 2, 4)
        R(g, C.coral, hl + hw, hy + 2, 2, 4)
      }
      return
    }
    case 'cap': {
      // a helper's cap with its peak to the front
      R(g, I, hl, hy - 4, hw, 4)
      R(g, '#4a5170', hl + 1, hy - 3, hw - 2, 2)
      if (side) {
        R(g, I, X(half - 1, 6), hy - 2, 6, 2)
        R(g, '#3b4262', X(half, 4), hy - 2, 4, 1)
      } else R(g, I, hl + 1, hy - 1, hw - 2, 1)
      return
    }
    default: {
      const ax = side ? X(-2, 1) : x
      R(g, I, ax, hy - 3, 1, 2)
      R(g, I, ax - 1, hy - 6, 4, 3)
      R(g, bulb, ax, hy - 5, 2, 2)
    }
  }
}

function eyesOn(g: Px, vx: number, vy: number, vw: number, vh: number, m: Eyes, f: number, view: string, small: boolean) {
  const c = m === 'x' ? C.red : C.glow
  let e1: number, e2: number
  if (view === 'front') {
    e1 = vx + (small ? 1 : 2)
    e2 = vx + vw - (small ? 3 : 4)
  } else if (small) {
    e1 = vx + (f > 0 ? 4 : 1)
    e2 = vx + (f > 0 ? 1 : 4)
  } else {
    e1 = vx + (f > 0 ? 6 : 1)
    e2 = vx + (f > 0 ? 2 : 5)
  }
  const eh = small ? 1 : 2
  for (const e of [e1, e2]) {
    if (m === 'off') R(g, C.steelD, e, vy + vh - 2, 2, 1)
    else if (m === 'happy') {
      R(g, c, e, vy + 1, 1, 1)
      R(g, c, e + 1, vy, 1, 1)
    } else if (m === 'x') {
      R(g, c, e, vy, 1, 1)
      R(g, c, e + 1, vy + 1, 1, 1)
      if (!small) {
        R(g, c, e + 1, vy, 1, 1)
        R(g, c, e, vy + 1, 1, 1)
      }
    } else if (m === 'up') R(g, c, e, vy, 2, 1)
    else R(g, c, e, vy + 1, 2, eh)
  }
}

export function bot(g: Px, x: number, y: number, o: BotOpts) {
  x = Math.trunc(x)
  y = Math.trunc(y)
  const p = o.paint ?? MAIN_ROLE.paint
  const small = !!o.small
  const f = o.face ?? 1
  const view = o.view ?? 'side'
  const pose = o.pose ?? 'stand'
  const t = o.t ?? 0
  const I = C.ink
  const hw = small ? 10 : 12, hh = small ? 8 : 9, bw = (small ? 6 : 8) + 2 * (o.girth ?? 0), bh = small ? 4 : 5
  const walk = pose === 'walk' || pose === 'carry'
  const sit = !!o.seated || pose === 'type' || pose === 'sit'
  const fr = Math.floor(t * 9) % 2
  const slow = Math.floor(t * 1.6) % 2
  if (pose === 'err') x += Math.floor(t * 22) % 2 ? 1 : -1
  // a seated robot keeps still on its stool; standing, it bobs
  const lift = walk ? fr : pose === 'sleep' || sit ? 0 : slow
  const X = (dx: number, w: number) => (f > 0 ? x + dx : x - dx - w)
  const base = sit ? y : y - 2
  if (!sit) {
    if (view === 'side') {
      const a = walk ? (fr ? [-3, 1] : [-1, -1]) : [-3, 1]
      R(g, I, X(a[0]!, 2), y - 2, 2, 2)
      R(g, I, X(a[1]!, 2), y - 2, 2, 2)
    } else {
      const l = walk && fr ? 1 : 0
      const r = walk && !fr ? 1 : 0
      R(g, I, x - 3, y - 2 - l, 2, 2)
      R(g, I, x + 1, y - 2 - r, 2, 2)
    }
  }
  const by = base - bh - lift
  const bl = x - (bw >> 1)
  const S = C.steelD
  if (view === 'side' && pose === 'cheer') R(g, S, X(-3, 2), by - hh - 2, 2, hh + 3)
  R(g, I, bl - 1, by, bw + 2, bh + 1)
  R(g, I, bl, by - 1, bw, bh + 2)
  R(g, p.m, bl, by, bw, bh)
  R(g, p.d, f > 0 || view !== 'side' ? bl : bl + bw - 2, by, 2, bh)
  R(g, p.l, bl, by, bw, 1)
  if (view !== 'back') R(g, o.chest ?? C.glow, view === 'side' ? X(1, 2) : x - 1, by + 2, 2, 1)
  const hl = x - (hw >> 1)
  const hy = by - hh + 1
  R(g, I, hl, hy - 1, hw, hh + 2)
  R(g, I, hl - 1, hy, hw + 2, hh)
  R(g, p.m, hl, hy, hw, hh)
  R(g, p.l, hl, hy, hw, 1)
  R(g, p.l, hl, hy, 1, 3)
  R(g, p.d, hl, hy + hh - 1, hw, 1)
  headgear(g, o.gear ?? 'antenna', x, hy, hw, view === 'side', f, o.bulb ?? (Math.floor(t * 2) % 2 ? C.amber : C.lamp))
  if (view === 'back') {
    R(g, p.d, hl + 2, hy + 3, hw - 4, 1)
    R(g, p.d, hl + 2, hy + 5, hw - 4, 1)
  } else {
    const vh = small ? 3 : 4
    const vw = view === 'front' ? hw - 2 : hw - 3
    const vx = view === 'front' ? hl + 1 : f > 0 ? hl + hw - vw : hl
    const vy = hy + 2
    R(g, C.scr, vx, vy, vw, vh)
    eyesOn(g, vx, vy, vw, vh, pose === 'sleep' ? 'off' : (o.eyes ?? 'open'), f, view, small)
  }
  if (view === 'side') {
    const half = bw >> 1
    if (pose === 'type') {
      const tf = Math.floor(t * 10) % 2
      R(g, S, X(2, half + 3), by, half + 3, 1)
      R(g, I, X(half + 4, 2), by + tf, 2, 1)
    } else if (pose === 'raise') {
      const wv = Math.floor(t * 4) % 2
      R(g, S, X(1, 2), hy - 3, 2, by - hy + 5)
      R(g, p.l, X(1 + wv, 2), hy - 5, 2, 2)
    } else if (pose === 'carry') {
      R(g, S, X(2, 5), by + 1, 5, 1)
      if (o.item === 'blueprint') {
        R(g, I, X(3, 7), by - 3, 7, 4)
        R(g, C.blue, X(4, 5), by - 2, 5, 2)
        R(g, '#a9ccff', X(4, 5), by - 2, 5, 1)
        R(g, C.paper, X(4, 1), by - 2, 1, 2)
      } else {
        R(g, C.paper, X(4, 5), by - 3, 5, 4)
        R(g, C.amber, X(4, 5), by - 3, 5, 1)
      }
    } else if (pose === 'read') {
      R(g, S, X(2, 4), by + 2, 4, 1)
      R(g, C.blue, X(4, 5), by - 2, 5, 4)
      R(g, C.paper, X(5, 3), by - 1, 3, 2)
    } else if (pose === 'cheer') R(g, S, X(1, 2), by - hh - 2, 2, hh + 3)
    else {
      const sw = walk ? (fr ? 1 : -1) : 0
      R(g, S, X(sw, 2), by + 1, 2, bh - 2)
      R(g, I, X(sw, 2), by + bh - 1, 2, 1)
    }
  } else {
    const L = bl - 2
    const Rr = bl + bw
    const sw = walk && fr ? 1 : 0
    R(g, S, L, by + 1 + sw, 2, bh - 2)
    R(g, S, Rr, by + 2 - sw, 2, bh - 2)
  }
}

function zzz(g: Px, x: number, y: number, t: number) {
  for (let i = 0; i < 3; i++) {
    const u = (t * 0.45 + i / 3) % 1
    tx(g, 'Z', x + Math.round(u * 7) + i, y - Math.round(u * 14), u < 0.75 ? C.cream : C.steelD)
  }
}

/* ---------- clouds and what's inside them ---------- */
function cloud(g: Px, x: number, y: number, w: number, h: number, tx0: number, ty0: number) {
  const shape = (o: number, c: string) => {
    R(g, c, x + 3 - o, y - o, w - 6 + 2 * o, h + 2 * o)
    R(g, c, x + 1 - o, y + 1 - o, w - 2 + 2 * o, h - 2 + 2 * o)
    R(g, c, x - o, y + 3 - o, w + 2 * o, h - 6 + 2 * o)
    for (let i = 5; i < w - 9; i += 11) {
      R(g, c, x + i - o, y - 2 - o, 8 + 2 * o, 2 + o)
      R(g, c, x + i + 3 - o, y + h - o, 8 + 2 * o, 2 + o)
    }
  }
  shape(1, C.ink)
  shape(0, C.paper)
  const cx = clamp(tx0, x + 6, x + w - 6)
  const midx = Math.round((cx + tx0) / 2)
  const by = y + h + 3
  R(g, C.ink, midx - 3, by - 1, 6, 5)
  R(g, C.paper, midx - 2, by, 4, 3)
  const ey = Math.round(by + (ty0 - by) * 0.7)
  R(g, C.ink, tx0 - 2, ey - 1, 4, 4)
  R(g, C.paper, tx0 - 1, ey, 2, 2)
}

const CODE: number[][][] = [
  [[0], [3, 1], [6, 2], [3, 4]], [[2], [4, 1], [8, 2], [2, 4], [5, 3]], [[2], [2, 1], [5, 2], [9, 4]],
  [[4], [5, 1], [7, 3], [3, 4]], [[4], [3, 2], [6, 4], [4, 5]], [[2], [1, 4]], [[2], [6, 1], [4, 2], [8, 3]],
  [[4], [4, 2], [3, 4], [7, 2]], [[2], [2, 4]], [[0], [1, 4]], [[0]], [[0], [3, 1], [5, 2], [5, 4]],
  [[2], [6, 1], [9, 3]], [[0], [1, 4]],
]
const lineLen = (l: number[][]) => l.slice(1).reduce((q, t) => q + t[0]!, 0) + 1
const CODE_TOTAL = CODE.reduce((s, l) => s + lineLen(l), 0)

function codeLines(g: Px, x: number, y: number, w: number, h: number, a: number, dark: boolean, sx = 1) {
  const pal = dark
    ? ['', C.violetL, C.glow, C.amber, C.steelL, C.green]
    : ['', C.violetD, C.blueD, C.coralD, C.steelD, C.greenD]
  const rows = Math.max(1, Math.floor(h / 2))
  let typed = Math.floor(a * (sx > 1 ? 30 : 18)) % (CODE_TOTAL * 2)
  if (typed > CODE_TOTAL) typed = CODE_TOTAL
  let cur = 0
  let left = typed
  const prog: number[] = []
  for (let i = 0; i < CODE.length; i++) {
    const len = lineLen(CODE[i]!)
    cur = i
    if (left >= len) {
      prog[i] = len
      left -= len
    } else {
      prog[i] = left
      break
    }
  }
  const start = Math.max(0, cur - rows + 1)
  for (let r = 0; r < rows; r++) {
    const i = start + r
    const l = CODE[i]
    const pr = prog[i]
    if (!l || pr === undefined) break
    let px = x + l[0]![0]! * sx
    let rem = pr
    for (let k = 1; k < l.length && rem > 0; k++) {
      const [len, col] = l[k] as [number, number]
      const n = Math.min(len, rem)
      const ww = Math.min(n * sx, x + w - px)
      if (ww > 0) R(g, pal[col]!, px, y + r * 2, ww, 1)
      px += len * sx + sx
      rem -= n
    }
    if (i === cur) R(g, dark ? C.cream : C.ink, Math.min(px, x + w - sx), y + r * 2, sx, 1)
  }
}

function gear(g: Px, cx: number, cy: number, a: number, r: number, c: string = C.steelD) {
  const ph = Math.floor(a * 5) % 2 ? 0 : Math.PI / 6
  for (let i = 0; i < 6; i++) {
    const an = ph + (i * Math.PI) / 3
    R(g, c, cx + Math.round(Math.cos(an) * r) - 1, cy + Math.round(Math.sin(an) * r) - 1, 2, 2)
  }
  disc(g, c, cx, cy, r - 1)
  R(g, C.paper, cx - 1, cy - 1, 2, 2)
}
function glass(g: Px, x: number, y: number) {
  R(g, C.ink, x + 1, y, 4, 1)
  R(g, C.ink, x, y + 1, 1, 4)
  R(g, C.ink, x + 5, y + 1, 1, 4)
  R(g, C.ink, x + 1, y + 5, 4, 1)
  R(g, C.tealL, x + 1, y + 1, 4, 4)
  R(g, C.paper, x + 1, y + 1, 1, 1)
  R(g, C.ink, x + 5, y + 5, 1, 1)
  R(g, C.ink, x + 6, y + 6, 2, 2)
}
function check(g: Px, x: number, y: number, c: string) {
  const pts: Array<[number, number]> = [[0, 5], [1, 6], [2, 7], [3, 8], [4, 7], [5, 6], [6, 5], [7, 4], [8, 3], [9, 2], [10, 1]]
  for (const [i, j] of pts) R(g, c, x + i, y + j, 2, 2)
}
function cross(g: Px, x: number, y: number, c: string) {
  for (let i = 0; i < 10; i++) {
    R(g, c, x + i, y + i, 2, 2)
    R(g, c, x + 9 - i, y + i, 2, 2)
  }
}

type Bub = (g: Px, x: number, y: number, w: number, h: number, a: number, label: string, sm: boolean) => void
const BUB: Partial<Record<ActivityKind | 'blue', Bub>> = {
  think(g, x, y, w, h, a, label, sm) {
    const cx = x + (sm ? 5 : 9)
    const cy = y + (h >> 1)
    gear(g, cx, cy, a, sm ? 3 : 6)
    const n = Math.floor(a * 2.5) % 4
    if (sm) {
      for (let i = 0; i < 3; i++) R(g, i < n ? C.ink : C.steel, cx + 7 + i * 5, cy - 1, 3, 3)
      return
    }
    tx(g, label || 'THINKING', cx + 11, y + 6, C.ink)
    for (let i = 0; i < 3; i++) R(g, i < n ? C.coralD : C.steel, cx + 11 + i * 5, y + 15, 3, 3)
  },
  search(g, x, y, w, h, a, label, sm) {
    if (!sm) tx(g, fit(label, w - 2), x, y, C.violetD)
    const top = sm ? y : y + 8
    const rows = sm ? 4 : 6
    for (let i = 0; i < rows; i++) {
      const hit = i === (Math.floor(a * 2) % rows)
      R(g, hit ? C.amber : C.steel, x + (i % 3) * 2, top + i * 4, w - 8 - ((i * 5) % 14), hit ? 2 : 1)
    }
    glass(g, x + Math.round(tri(a * 0.5) * (w - 10)), top + Math.round(tri(a * 0.31) * (h - (sm ? 8 : 17))))
  },
  web(g, x, y, w, h, a, label, sm) {
    R(g, C.steelD, x, y, w, h)
    R(g, C.white, x + 1, y + 1, w - 2, h - 2)
    R(g, C.blue, x + 1, y + 1, w - 2, sm ? 2 : 3)
    R(g, C.red, x + 2, y + 1, 1, 1)
    R(g, C.amber, x + 4, y + 1, 1, 1)
    const ab = sm ? y + 4 : y + 5
    R(g, C.steelL, x + 2, ab, w - 4, sm ? 2 : 7)
    const full = fit(label, w - 8)
    if (!sm) {
      const s = full.slice(0, Math.floor(a * 10))
      tx(g, s, x + 3, ab + 1, C.ink)
      if (s.length < full.length) R(g, C.ink, x + 4 + tw(s), ab + 1, 1, 5)
    }
    const rtop = sm ? y + 8 : y + 14
    const n = sm ? 2 : 3
    const shown = sm ? 2 : clamp((a - full.length / 10) * 2, 0, 3)
    for (let i = 0; i < n && i < shown; i++) {
      R(g, C.blue, x + 3, rtop + i * (sm ? 3 : 5), Math.round(w * 0.45), 1)
      R(g, C.steel, x + 3, rtop + 1 + i * (sm ? 3 : 5), w - 9 - ((i * 7) % 10), 1)
    }
  },
  write(g, x, y, w, h, a, label, sm) {
    R(g, C.scr, x, y, w, h)
    if (sm) return codeLines(g, x + 1, y + 1, w - 2, h - 2, a, true)
    tx(g, fit(label, w - 4), x + 2, y + 1, C.coralL)
    codeLines(g, x + 2, y + 8, w - 4, h - 9, a, true, 2)
  },
  read(g, x, y, w, h, a, label, sm) {
    if (sm) {
      R(g, C.ink, x + 2, y, 13, h)
      R(g, C.paper, x + 3, y + 1, 11, h - 2)
      for (let i = 0; i < 3; i++) R(g, C.steelD, x + 4, y + 3 + i * 3, 9, 1)
      R(g, C.blue, x + 20, y + 2, 14, h - 5)
      R(g, C.paper, x + 22, y + 4, 10, h - 9)
      return
    }
    tx(g, fit(label, w - 2), x, y, C.blueD)
    const half = w >> 1
    R(g, C.blueD, x, y + 8, w - 1, h - 8)
    R(g, C.paper, x + 1, y + 8, half - 2, h - 9)
    R(g, C.paper, x + half, y + 8, half - 2, h - 9)
    const sc = Math.floor(a * 5)
    for (let i = 0; i < 5; i++) {
      R(g, C.steelD, x + 3, y + 10 + i * 3, half - 7 - (((i + sc) * 5) % 8), 1)
      R(g, C.steelD, x + half + 2, y + 10 + i * 3, half - 7 - (((i + sc + 2) * 3) % 9), 1)
    }
  },
  run(g, x, y, w, h, a, label, sm) {
    R(g, C.scr, x, y, w, h)
    if (sm) {
      const n = Math.floor(a * 3) % 4
      for (let i = 0; i < n; i++) R(g, C.green, x + 2, y + 2 + i * 3, w - 8 - ((i * 6) % 10), 1)
      return
    }
    tx(g, '$', x + 2, y + 2, C.green)
    tx(g, fit(label, w - 10), x + 7, y + 2, C.cream)
    for (let i = 0; i < 2; i++) R(g, C.greenD, x + 2, y + 10 + i * 3, w - 10 - ((i * 11) % 18), 1)
    const p = (a % 3.2) / 3.2
    R(g, C.steelD, x + 2, y + h - 7, w - 4, 4)
    R(g, C.green, x + 3, y + h - 6, Math.max(1, Math.round((w - 6) * p)), 2)
  },
  ask(g, x, y, w, h, a, label, sm) {
    const b = Math.floor(a * 3) % 2
    if (sm) {
      tx(g, '?', x + 16, y + 4 - b, C.coralD)
      return
    }
    const q = [[0, 1, 1, 0], [1, 0, 0, 1], [0, 0, 1, 0], [0, 0, 0, 0], [0, 0, 1, 0]]
    q.forEach((r, j) => r.forEach((v, i) => v && R(g, C.coralD, x + 2 + i * 3, y + 3 - b + j * 4, 3, 4)))
    tx(g, 'CAN I?', x + 18, y + 5, C.ink)
    tx(g, fit(label, w - 20), x + 18, y + 15, C.coralD)
  },
  blue(g, x, y, w, h, a, label, sm) {
    R(g, C.blueD, x, y, w, h)
    for (let i = x + 3; i < x + w; i += 6) R(g, C.blue, i, y, 1, h)
    for (let j = y + 3; j < y + h; j += 6) R(g, C.blue, x, j, w, 1)
    if (sm) return
    R(g, C.paper, x + 6, y + 4, 12, 8)
    R(g, C.blueD, x + 7, y + 5, 10, 6)
    R(g, C.paper, x + 9, y + 7, 2, 2)
    R(g, C.paper, x + 13, y + 7, 2, 2)
    R(g, C.paper, x + 9, y + 13, 6, 7)
    R(g, C.blueD, x + 10, y + 14, 4, 5)
    R(g, C.paper, x + 11, y + 1, 2, 3)
    tx(g, 'PRINT', x + 24, y + 4, C.paper)
    tx(g, fit(label, w - 26), x + 24, y + 13, C.tealL)
  },
  talk(g, x, y, w, h, a, label, sm) {
    const n = 1 + (Math.floor(a * 3) % 3)
    for (let i = 0; i < n; i++) R(g, C.steelD, x + 2, y + (sm ? 2 : 9) + i * 4, w - 8 - ((i * 9) % 16), 2)
    if (!sm) tx(g, fit(label, w - 4), x + 2, y, C.violetD)
  },
  done(g, x, y, w, h, a, label, sm) {
    check(g, sm ? x + 15 : x + 6, sm ? y + 2 : y + 8, C.greenD)
    if (!sm) tx(g, fit(label, w - 22), x + 21, y + 12, C.ink)
  },
  error(g, x, y, w, h, a, label, sm) {
    cross(g, sm ? x + 15 : x + 6, sm ? y + 1 : y + 7, C.red)
    if (!sm) tx(g, fit(label, w - 22), x + 21, y + 12, C.redD)
  },
}
BUB.mcp = BUB.web
BUB.spawn = BUB.blue
BUB.tool = BUB.run

/* ---------- furniture ---------- */
type ScreenMode = 'off' | 'idle' | 'code' | 'term' | 'web' | 'file' | 'blue' | 'pass' | 'fail'
function screen(g: Px, x: number, y: number, w: number, h: number, mode: ScreenMode, a: number) {
  R(g, C.scr, x, y, w, h)
  if (mode === 'code') codeLines(g, x + 1, y + 1, w - 2, h - 2, a, true)
  else if (mode === 'term') {
    const n = Math.min(Math.floor(a * 5) % 8, Math.floor((h - 2) / 2))
    for (let i = 0; i < n; i++) R(g, C.green, x + 1, y + 1 + i * 2, w - 3 - ((i * 7) % (w >> 1)), 1)
  } else if (mode === 'web') {
    R(g, C.page, x, y, w, h)
    R(g, C.blue, x, y, w, 2)
    R(g, C.steelL, x + 1, y + 3, w - 2, 2)
    for (let i = 0; i < 3; i++) {
      R(g, C.blue, x + 2, y + 7 + i * 3, Math.round(w * 0.4), 1)
      R(g, C.steel, x + 2, y + 8 + i * 3, w - 6 - ((i * 9) % 14), 1)
    }
  } else if (mode === 'file') {
    R(g, C.paper, x + 1, y, w - 2, h)
    const sc = Math.floor(a * 6)
    for (let i = 1; i < h / 2; i++) R(g, C.steelD, x + 2, y + i * 2 - 1, w - 5 - (((i + sc) * 5) % (w >> 1)), 1)
  } else if (mode === 'blue') {
    R(g, C.blueD, x, y, w, h)
    for (let i = x + 2; i < x + w; i += 4) R(g, C.blue, i, y, 1, h)
    for (let j = y + 2; j < y + h; j += 4) R(g, C.blue, x, j, w, 1)
  } else if (mode === 'idle') {
    R(g, C.glow, x + 2, y + 2, 1, 1)
    if (Math.floor(a * 2) % 2) R(g, C.glow, x + 4, y + 2, 1, 1)
  }
}
function plant(g: Px, x: number, y: number) {
  R(g, C.ink, x - 1, y - 6, 8, 7)
  R(g, C.coralD, x, y - 5, 6, 5)
  R(g, C.coral, x, y - 5, 6, 1)
  for (const [dx, dy, w, h] of [[-2, -11, 4, 4], [2, -14, 4, 6], [5, -10, 4, 4], [0, -9, 6, 4]] as const)
    R(g, dy < -12 ? C.leaf : C.leafD, x + dx, y + dy, w, h)
}
function bookshelf(g: Px, x: number, y: number, w: number, h: number, r: () => number) {
  R(g, C.woodD, x, y, w, h)
  R(g, C.wood, x + 1, y + 1, w - 2, h - 2)
  R(g, '#3d2a24', x + 2, y + 2, w - 4, h - 4)
  const cols = [C.coral, C.teal, C.violet, C.amber, C.blue, C.red, C.cream, C.tealD, C.violetD]
  for (let sy = y + 2; sy + 10 < y + h; sy += 12) {
    let bx = x + 3
    while (bx < x + w - 5) {
      const bw = 2 + Math.floor(r() * 2)
      const bh = 7 + Math.floor(r() * 3)
      if (r() < 0.08) {
        bx += 3
        continue
      }
      R(g, cols[Math.floor(r() * cols.length)]!, bx, sy + 10 - bh, bw, bh)
      bx += bw + (r() < 0.2 ? 1 : 0)
    }
    R(g, C.wood, x + 2, sy + 10, w - 4, 2)
    R(g, C.woodL, x + 2, sy + 10, w - 4, 1)
  }
}

/* ---------- the building: a roof, a ground floor, and floors that grow upward ---------- */
const PRINTER = { x: 4, y: 72, w: 38, h: 44 }
const PLATE_Y = PRINTER.y + PRINTER.h - 12
const EXIT_X = PRINTER.x + PRINTER.w + 2
// The gantry rises a layer at a time as it prints, and parks up top, to the left, when idle.
const PRINT_RISE = 20
const PARK_TIP = PLATE_Y - 1 - PRINT_RISE
const PARK_X = PRINTER.x + 11
const LCD = { x: PRINTER.x + 5, y: PLATE_Y + 6, w: 11, h: 3 }
const SHAFT_X = 245
export const ROOF_H = 14
const GROUND_DESKS = [
  { robot: 58, bubble: { x: 8, y: 48 } },
  { robot: 196, bubble: { x: 174, y: 51 } },
]
const UPPER_X = [20, 64, 108, 152, 196]
// The wall: the chat's sign up top, the whiteboard with the token chart on the right, and the
// Employee of the Day frame hung right under the sign, its top level with the whiteboard's.
const SIGN_CX = 128
const SIGN_Y = 9
const SIGN_H = 11
const BOARD = { x: 176, y: 24, w: 46, h: 25 }
const FRAME = { x: SIGN_CX - 35, y: BOARD.y, w: 70, h: BOARD.h }
const WALL_SHADOW = '#2a4656'
// The recycling corner: a hatch in the floor drops onto a vat of molten metal,
// which a pipe carries back to the printer.
const HOLE_X0 = 173
const HOLE_W = 12
const HOLE_X = HOLE_X0 + (HOLE_W >> 1)
const DELIVER_X = 162
const BRIEF_X = 92
const VAT = { x: 154, y: 136, w: 50, h: 32 }
const MELT_Y = VAT.y + 3
// The pit under the hatch: a shaft with a stone wall each side of the vat. Shut, it is pitch dark
// inside; the vat shows only while the hatch stands open and the room's light falls in.
const PIT = { x0: 144, x1: 214, top: FY + 7, bottom: GROUND_H - 2 } // the inside, between the walls
const PIT_WALL = 4
const PIT_DARK = '#07050d'
const HATCH_DIM_MS = 100
const HATCH_LEAD_MS = 250
const HATCH_HOLD_MS = 350
// The recycling pipe: a riser under the printer, a rounded elbow, and a run to the vat.
const PIPE_X = 18 // the riser's left outline
const PIPE_Y = VAT.y + 17 // the run's top outline
const PIPE_W = 6 // outline, four pixels of bore, outline
const BEND_R = 9 // outer radius of the elbow
const BEND_CX = PIPE_X + BEND_R
const BEND_CY = PIPE_Y + PIPE_W - BEND_R

export const sceneHeight = (floors: number) => ROOF_H + GROUND_H + floors * FLOOR_H

/** How many upper floors a seat needs; past MAX_FLOORS the robot waits in the queue. */
export const floorsFor = (seat: number) => (seat < GROUND_SEATS ? 0 : 1 + Math.floor((seat - GROUND_SEATS) / PER_FLOOR))

export type Seat = {
  x: number
  y: number
  floorY: number
  floor: number
  monX: number
  monY: number
  bubble: { x: number; y: number }
}

/** A desk's place, in building coordinates (below the roof). */
export function seatFor(seat: number, floors: number): Seat | null {
  const gy = floors * FLOOR_H
  if (seat < GROUND_SEATS) {
    const d = GROUND_DESKS[seat]!
    const fy = gy + FY
    return { x: d.robot, y: fy - 6, floorY: fy, floor: 0, monX: d.robot + 10, monY: fy - 17, bubble: { x: d.bubble.x, y: gy + d.bubble.y } }
  }
  const k = seat - GROUND_SEATS
  const floor = 1 + Math.floor(k / PER_FLOOR)
  if (floor > floors) return null
  const x = UPPER_X[k % PER_FLOOR]!
  const fy = gy - floor * FLOOR_H + 46
  return { x, y: fy - 6, floorY: fy, floor, monX: x + 10, monY: fy - 17, bubble: { x: Math.max(2, Math.min(W - 46, x - 22)), y: fy - 45 } }
}

/**
 * A wooden stool in the desks' own wood and outline, seen from the side. Its top is the row under
 * a seated robot (fy - 5), so the robot's body rests right on it; `w` matches the robot's width.
 */
function stool(g: Px, x: number, fy: number, w: number) {
  const x0 = x - (w >> 1)
  const top = fy - 5
  R(g, C.ink, x0, top, w, 3)
  R(g, C.woodL, x0 + 1, top, w - 2, 1)
  R(g, C.wood, x0 + 1, top + 1, w - 2, 1)
  // two splayed legs
  for (const [lx, out] of [[x0 + 1, -1], [x0 + w - 3, 1]] as const) {
    R(g, C.ink, lx, top + 3, 2, 1)
    R(g, C.ink, lx + out, top + 4, 2, 1)
    R(g, C.woodD, lx + (out > 0 ? 0 : 1), top + 3, 1, 1)
  }
}

/** A workstation for a robot sitting at x: stool, desk with drawers, PC, monitor, keyboard. */
function workstation(g: Px, x: number, fy: number) {
  const top = fy - 8
  stool(g, x, fy, 10)
  // desk top and frame
  R(g, C.ink, x + 3, top - 1, 19, 3)
  R(g, C.woodL, x + 4, top - 1, 17, 1)
  R(g, C.wood, x + 4, top, 17, 1)
  R(g, C.ink, x + 4, top + 2, 2, fy - top - 2)
  // a slim drawer unit
  R(g, C.ink, x + 15, top + 2, 6, fy - top - 2)
  R(g, C.woodD, x + 16, top + 2, 4, fy - top - 3)
  R(g, C.wood, x + 16, top + 2, 4, 1)
  R(g, C.steelL, x + 17, top + 4, 2, 1)
  // a PC under the desk
  R(g, C.ink, x + 8, fy - 5, 5, 5)
  R(g, '#3b4262', x + 9, fy - 4, 3, 4)
  R(g, C.green, x + 10, fy - 3, 1, 1)
  // monitor; the screen is drawn live
  R(g, C.ink, x + 8, top - 11, 11, 9)
  R(g, '#2b3049', x + 9, top - 10, 9, 7)
  R(g, C.scr, x + 10, top - 9, 7, 5)
  R(g, C.ink, x + 12, top - 2, 3, 1)
  // keyboard
  R(g, C.ink, x + 3, top - 3, 5, 2)
  R(g, C.steelL, x + 4, top - 3, 3, 1)
}

/** The kit each role keeps on its desk, shown while that robot sits there. */
export function deskProp(g: Px, roleId: string, x: number, fy: number) {
  const top = fy - 17
  const I = C.ink
  switch (roleId) {
    case 'designer': // a fan of colour swatches
      R(g, I, x + 29, top - 7, 6, 6)
      R(g, '#e86aa6', x + 30, top - 6, 1, 4)
      R(g, C.yellow, x + 31, top - 6, 1, 4)
      R(g, C.teal, x + 32, top - 6, 1, 4)
      R(g, C.blue, x + 33, top - 6, 1, 4)
      return
    case 'architect': // a rolled blueprint
      R(g, I, x + 28, top - 5, 8, 4)
      R(g, C.blue, x + 29, top - 4, 6, 2)
      R(g, '#a9ccff', x + 29, top - 4, 6, 1)
      R(g, C.paper, x + 29, top - 4, 1, 2)
      return
    case 'coder': // an energy drink
      R(g, I, x + 30, top - 8, 4, 7)
      R(g, C.green, x + 31, top - 7, 2, 5)
      R(g, C.steelL, x + 31, top - 7, 2, 1)
      return
    case 'tester': // test tubes in a rack
      R(g, C.woodD, x + 29, top - 4, 6, 2)
      R(g, I, x + 30, top - 8, 1, 5)
      R(g, '#a8cc3c', x + 30, top - 6, 1, 2)
      R(g, I, x + 33, top - 8, 1, 5)
      R(g, C.red, x + 33, top - 6, 1, 2)
      return
    case 'reviewer': // a stack of papers and a red pen
      R(g, I, x + 28, top - 5, 7, 4)
      R(g, C.paper, x + 29, top - 4, 5, 1)
      R(g, C.cream, x + 29, top - 3, 5, 1)
      R(g, C.red, x + 29, top - 6, 5, 1)
      return
    case 'explorer': // a desk globe
      disc(g, I, x + 31, top - 6, 3)
      disc(g, '#2d6e9a', x + 31, top - 6, 2)
      R(g, C.green, x + 30, top - 7, 2, 1)
      R(g, C.green, x + 32, top - 5, 1, 1)
      R(g, I, x + 29, top - 2, 5, 1)
      return
    case 'writer': // a pile of books
      R(g, I, x + 28, top - 7, 7, 6)
      R(g, C.coral, x + 29, top - 6, 5, 1)
      R(g, C.blue, x + 29, top - 4, 5, 1)
      R(g, C.amber, x + 29, top - 2, 5, 1)
      return
    default: // a mug of coffee
      R(g, I, x + 30, top - 6, 4, 5)
      R(g, C.cream, x + 31, top - 5, 2, 3)
      R(g, I, x + 34, top - 5, 1, 2)
  }
}

function shaft(g: Px, top: number, bottom: number, fy: number, floorNumber: number) {
  R(g, C.ink, SHAFT_X - 10, top, 1, bottom - top)
  R(g, '#20243a', SHAFT_X - 9, top, 18, bottom - top)
  R(g, C.steelD, SHAFT_X - 7, top, 1, bottom - top)
  R(g, C.steelD, SHAFT_X + 6, top, 1, bottom - top)
  R(g, '#3b3f55', SHAFT_X, top, 1, bottom - top)
  R(g, C.woodD, SHAFT_X - 12, fy - 26, 3, 26)
  // the floor indicator above the lift door
  R(g, C.ink, SHAFT_X - 5, fy - 36, 11, 9)
  R(g, '#191430', SHAFT_X - 4, fy - 35, 9, 7)
  tx(g, String(floorNumber), SHAFT_X - 1, fy - 34, C.amber)
}

/** A hanging lamp over a desk, with a warm pool of light on the wall below it. */
function lamp(g: Px, lx: number, fromY: number, toY: number, glow: string) {
  for (let y = fromY + 7, j = 0; y < toY; y++, j++) R(g, glow, lx - 2 - (j >> 2), y, 5 + 2 * (j >> 2), 1)
  R(g, C.ink, lx, fromY, 1, 4)
  R(g, C.ink, lx - 3, fromY + 4, 7, 3)
  R(g, '#c9a227', lx - 2, fromY + 4, 5, 1)
  R(g, C.lamp, lx - 2, fromY + 6, 5, 1)
}

function paintRoof(): Px {
  const g = new Px(W, ROOF_H)
  R(g, C.night, 0, 0, W, 8)
  for (const [a, b] of [[12, 2], [41, 5], [98, 1], [151, 4], [188, 2], [222, 5]] as const) R(g, C.steel, a, b, 1, 1)
  // a rooftop air conditioner, a vent and the lift's machine room
  R(g, C.ink, 70, 2, 15, 7)
  R(g, C.steel, 71, 3, 13, 5)
  R(g, C.steelD, 73, 4, 5, 3)
  R(g, C.steelL, 79, 4, 3, 1)
  R(g, C.steelL, 79, 6, 3, 1)
  R(g, C.ink, 119, 2, 6, 1)
  R(g, C.ink, 120, 3, 4, 6)
  R(g, C.steelD, 121, 4, 2, 4)
  R(g, C.ink, 206, 0, 1, 8)
  R(g, C.ink, 203, 3, 7, 1)
  R(g, C.ink, 234, 1, 22, 8)
  R(g, '#3b3f55', 235, 2, 20, 6)
  R(g, '#4d567c', 235, 2, 20, 1)
  // the parapet
  R(g, C.ink, 0, 8, W, 1)
  R(g, '#5b6185', 0, 9, W, 1)
  R(g, '#4a4f70', 0, 10, W, 3)
  R(g, '#2f3348', 0, 13, W, 1)
  for (let x = 15; x < W; x += 16) R(g, '#3b3f5c', x, 10, 1, 3)
  return g
}

/** The chat's sign on the gallery row's centre line. */
function sign(g: Px, name: string, face: string, ink: string, lit?: string) {
  const nw = tw(name) + 8
  const x = SIGN_CX - (nw >> 1)
  R(g, WALL_SHADOW, x, SIGN_Y + 1, nw + 2, SIGN_H)
  R(g, C.ink, x - 1, SIGN_Y, nw + 2, SIGN_H)
  R(g, face, x, SIGN_Y + 1, nw, SIGN_H - 2)
  if (lit) R(g, lit, x, SIGN_Y + 1, nw, 1)
  tx(g, name, x + 4, SIGN_Y + 3, ink)
}

/** The whiteboard on the wall, with its marker tray; the token chart on it is drawn live. */
function whiteboard(g: Px) {
  const { x, y, w } = BOARD
  const bh = BOARD.h - 3
  R(g, WALL_SHADOW, x + 1, y + 1, w, bh)
  R(g, C.ink, x, y, w, bh)
  R(g, C.steelL, x + 1, y + 1, w - 2, bh - 2)
  R(g, C.steel, x + 1, y + bh - 2, w - 2, 1)
  R(g, C.steel, x + w - 2, y + 1, 1, bh - 2)
  R(g, C.page, x + 2, y + 2, w - 4, bh - 4)
  // the tray, with two markers and an eraser on it
  R(g, WALL_SHADOW, x + 3, y + bh + 3, w - 4, 1)
  R(g, C.ink, x + 1, y + bh, w - 2, 3)
  R(g, C.steelL, x + 2, y + bh, w - 4, 1)
  R(g, C.steel, x + 2, y + bh + 1, w - 4, 1)
  for (const [mx, body] of [[x + 5, C.blue], [x + 15, C.red]] as const) {
    R(g, C.ink, mx, y + bh - 3, 9, 3)
    R(g, body, mx + 1, y + bh - 2, 5, 1)
    R(g, C.steelL, mx + 6, y + bh - 2, 2, 1)
  }
  R(g, C.ink, x + w - 13, y + bh - 3, 9, 3)
  R(g, C.woodL, x + w - 12, y + bh - 2, 7, 1)
}

/* ---------- the window over the printer: the sky as this computer's clock has it ---------- */
const WIN = { x: 10, y: 14, w: 30, h: 28 }
type Sky = 'night' | 'dawn' | 'day' | 'dusk' | 'evening'
const skyOf = (hour: number): Sky => (hour < 5 || hour >= 21 ? 'night' : hour < 7 ? 'dawn' : hour < 17 ? 'day' : hour < 19 ? 'dusk' : 'evening')

/** What the window shows changes with the hour on this computer's clock. */
export const skyKey = (now: number) => String(new Date(now).getHours())

const SKY: Record<Sky, { bands: Array<[string, number]>; town: string; lights: string; lit: number; stars: number }> = {
  night: { bands: [['#120e26', 7], ['#1b1735', 8], ['#221d44', 7], ['#2b2552', 6]], town: '#0b0918', lights: C.amber, lit: 0.4, stars: 9 },
  dawn: { bands: [['#2b2a5c', 5], ['#4d3c78', 5], ['#8c5a8c', 5], ['#d6787a', 5], ['#f2a274', 4], ['#ffd29a', 4]], town: '#2a2142', lights: '#f2c46e', lit: 0.15, stars: 2 },
  day: { bands: [['#3f86d4', 6], ['#5698de', 7], ['#73b0ea', 7], ['#9ccbf2', 8]], town: '#5b7c99', lights: '', lit: 0, stars: 0 },
  dusk: { bands: [['#34408a', 5], ['#6c4f92', 5], ['#c9667c', 6], ['#ec8f5e', 6], ['#ffbf5c', 6]], town: '#2c2246', lights: C.amber, lit: 0.2, stars: 0 },
  evening: { bands: [['#120f30', 7], ['#1d1a48', 7], ['#30275c', 7], ['#4a3268', 7]], town: '#0e0c22', lights: C.amber, lit: 0.55, stars: 5 },
}
const STARS: Array<[number, number]> = [[13, 16], [21, 15], [35, 17], [17, 21], [30, 15], [37, 23], [12, 25], [28, 20], [23, 24]]
// the town across the street: [offset, width, height] from the window's bottom
const TOWN: Array<[number, number, number]> = [[0, 4, 7], [4, 5, 11], [9, 4, 8], [13, 6, 5], [19, 3, 12], [22, 5, 9], [27, 3, 6]]

/** Where the sun or moon stands in the window, `f` of the way across its arc. */
function arc(f: number): [number, number] {
  return [Math.round(WIN.x + 3 + f * (WIN.w - 6)), Math.round(WIN.y + WIN.h - 5 - Math.sin(Math.PI * f) * (WIN.h - 12))]
}
function puff(g: Px, x: number, y: number, w: number, c: string, shade: string) {
  R(g, c, x + 2, y, w - 4, 1)
  R(g, c, x, y + 1, w, 1)
  R(g, shade, x + 1, y + 2, w - 2, 1)
}

function paintWindow(hour: number): Px {
  const g = new Px(46, 46)
  const sky = skyOf(hour)
  const s = SKY[sky]
  R(g, C.ink, WIN.x - 1, WIN.y - 1, WIN.w + 2, WIN.h + 2)
  let y = WIN.y
  for (const [c, n] of s.bands) {
    R(g, c, WIN.x, y, WIN.w, n)
    y += n
  }
  for (const [sx, sy] of STARS.slice(0, s.stars)) R(g, sky === 'night' ? C.cream : '#c9c3e6', sx, sy, 1, 1)
  const hb = hour + 0.5
  if (sky === 'night') {
    const [mx, my] = arc(((hb - 21 + 24) % 24) / 8)
    disc(g, C.cream, mx, my, 3)
    R(g, '#d9c9a6', mx - 1, my, 1, 1)
    R(g, '#d9c9a6', mx + 1, my - 2, 1, 1)
  } else {
    const [sx, sy] = arc((hb - 5) / 16)
    const high = sky === 'day'
    disc(g, high ? C.yellow : '#ff8a2a', sx, sy, 3)
    disc(g, high ? '#fff6c8' : '#ffc35c', sx, sy, 2)
  }
  if (sky === 'day') {
    puff(g, 12, 18, 8, C.white, '#dbe8f6')
    puff(g, 28, 24, 7, C.white, '#dbe8f6')
  }
  if (sky === 'dusk') puff(g, 26, 19, 9, '#f6b9a3', '#d9707a')
  // the town across the street, its windows lit after dark
  const ground = WIN.y + WIN.h
  for (const [dx, w, h] of TOWN) {
    const bx = WIN.x + dx
    R(g, s.town, bx, ground - h, w, h)
    if (!s.lit) continue
    for (let wy = ground - h + 2; wy < ground - 1; wy += 2)
      for (let wx = bx + 1; wx < bx + w - 1; wx += 2) if (((wx * 7 + wy * 13) % 10) / 10 < s.lit) R(g, s.lights, wx, wy, 1, 1)
  }
  // the mullions, the curtains and their rod
  R(g, C.ink, WIN.x + 15, WIN.y, 1, WIN.h)
  R(g, C.ink, WIN.x, WIN.y + 13, WIN.w, 1)
  R(g, C.coralD, 6, 12, 4, 33)
  R(g, C.coralD, 40, 12, 4, 33)
  R(g, C.woodD, 5, 11, 40, 2)
  return g
}

function paintGround(home: string): Px {
  const g = new Px(W, GROUND_H)
  const r = rng(home.length * 97 + 11)
  R(g, C.slate, 0, 6, W, 98)
  for (let x = 4; x < W; x += 8) R(g, C.slateL, x, 8, 1, 94)
  R(g, '#243a4a', 0, 6, W, 2)
  R(g, C.slateD, 0, 104, W, 12)
  R(g, C.ink, 0, 103, W, 1)
  R(g, C.woodD, 0, 0, W, 5)
  R(g, C.wood, 0, 4, W, 1)
  R(g, C.ink, 0, 5, W, 1)
  // the chat's sign, and the whiteboard where the token chart is drawn
  sign(g, fit(home || 'OFFICE', 96), C.woodD, C.cream, C.wood)
  whiteboard(g)
  // main desk, monitor, keyboard, stool
  R(g, C.ink, 115, 107, 44, 3)
  R(g, C.woodL, 116, 107, 42, 1)
  R(g, C.wood, 116, 108, 42, 1)
  R(g, C.ink, 117, 110, 3, 6)
  R(g, C.ink, 141, 110, 17, 6)
  R(g, C.woodD, 142, 110, 15, 5)
  R(g, C.wood, 142, 110, 15, 1)
  R(g, C.steelL, 148, 112, 3, 1)
  R(g, C.ink, 131, 86, 27, 19)
  R(g, C.panel, 132, 87, 25, 17)
  R(g, C.ink, 142, 105, 5, 2)
  R(g, C.ink, 117, 105, 13, 2)
  R(g, C.steelL, 118, 105, 11, 1)
  stool(g, MAIN_X, FY, 12)
  // a warning sign over the recycling hatch
  R(g, C.ink, 175, 86, 9, 8)
  R(g, C.amber, 176, 87, 7, 6)
  R(g, C.ink, 179, 88, 1, 3)
  R(g, C.ink, 179, 92, 1, 1)
  for (const d of GROUND_DESKS) workstation(g, d.robot, FY)
  // floor
  R(g, C.ink, 0, FY, W, 1)
  R(g, C.wood, 0, FY + 1, W, 2)
  R(g, C.woodD, 0, FY + 3, W, 3)
  for (let x = 6; x < W; x += 17) R(g, C.woodD, x, FY + 1, 1, 2)
  R(g, C.ink, 0, FY + 6, W, 1)
  for (let i = 0; i < 40; i += 4) {
    R(g, C.amber, 4 + i, FY - 2, 2, 2)
    R(g, C.ink, 6 + i, FY - 2, 2, 2)
  }
  basement(g, r)
  shaft(g, 0, FY, FY, 1)
  return g
}

/**
 * The elbow where the pipe turns from the run up into the riser: a quarter ring with outlines on
 * both edges. Its highlight slides from the riser's lit left wall to the run's lit top wall, so
 * light and bore stay continuous through the turn.
 */
function elbow(g: Px) {
  const inner = BEND_R - PIPE_W
  for (let y = BEND_CY; y < PIPE_Y + PIPE_W; y++) {
    for (let x = PIPE_X; x < BEND_CX; x++) {
      const dx = BEND_CX - (x + 0.5)
      const dy = y + 0.5 - BEND_CY
      const d = Math.hypot(dx, dy)
      if (d < inner || d >= BEND_R) continue
      const lit = (BEND_R - 1.5) + ((inner + 1.5) - (BEND_R - 1.5)) * (Math.atan2(dy, dx) / (Math.PI / 2))
      const c = d >= BEND_R - 1 || d < inner + 1 ? C.ink : Math.abs(d - lit) < 0.6 ? C.steel : C.steelD
      R(g, c, x, y, 1, 1)
    }
  }
  // collars where the bend meets the straight runs
  R(g, C.ink, PIPE_X - 1, BEND_CY - 2, PIPE_W + 2, 2)
  R(g, C.steel, PIPE_X, BEND_CY - 2, PIPE_W, 1)
  R(g, C.ink, BEND_CX, PIPE_Y - 1, 2, PIPE_W + 2)
  R(g, C.steel, BEND_CX, PIPE_Y, 1, PIPE_W)
}

const GOLD = '#d4a83a'
const GOLD_L = '#f3d57a'
const GOLD_D = '#8f6b1c'
const VELVET = '#1d2238'

/**
 * Employee of the Day: a gilt frame under the chat's sign with the portrait of whichever robot has
 * used the most tokens today, then its count and the day's total.
 */
function employeeFrame(tally: TokenTally | undefined, now: number, detail: Detail): string {
  const { w, h } = FRAME
  const g = new Px(w + 1, h + 1)
  R(g, WALL_SHADOW, 1, 1, w, h)
  R(g, C.ink, 0, 0, w, h)
  R(g, GOLD, 1, 1, w - 2, h - 2)
  R(g, GOLD_L, 1, 1, w - 2, 1)
  R(g, GOLD_L, 1, 1, 1, h - 2)
  R(g, GOLD_D, 1, h - 2, w - 2, 1)
  R(g, GOLD_D, w - 2, 1, 1, h - 2)
  for (const [cx, cy] of [[1, 1], [w - 3, 1], [1, h - 3], [w - 3, h - 3]] as const) R(g, GOLD_L, cx, cy, 2, 2)
  R(g, VELVET, 3, 3, w - 6, h - 6)
  R(g, '#12162a', 3, 3, w - 6, 1)
  R(g, '#12162a', 3, 3, 1, h - 6)
  // the portrait, in its own inner frame
  R(g, GOLD_D, 5, 5, 14, 14)
  R(g, '#2b3352', 6, 6, 12, 12)
  const best = champion(tally, now)
  const role = roleInfo(best?.role ?? 'main')
  const face = new Px(12, 12)
  bot(face, 6, 18, { paint: role.paint, small: true, gear: role.headgear, view: 'front', pose: 'stand', eyes: best ? 'happy' : 'open' })
  // the title, then the employee's tokens and the whole day's
  tx(g, 'EMPLOYEE', 21, 4, GOLD_L)
  tx(g, 'OF THE DAY', 21, 10, GOLD)
  const end = tx(g, best ? formatTokens(best.tokens) : '0', 21, 16, C.white)
  tx(g, `OF ${formatTokens(tally?.total ?? 0)}`, end + 3, 16, GOLD)
  // a star that glints on the corner of the frame
  const star = sprite(7, 7, [0, 1.6], [1.6, 0.3], detail, (sg, t) => {
    const bright = t > 0 ? C.white : GOLD_L
    R(sg, C.ink, 2, 0, 3, 7)
    R(sg, C.ink, 0, 2, 7, 3)
    R(sg, bright, 3, 1, 1, 5)
    R(sg, bright, 1, 3, 5, 1)
    R(sg, GOLD, 2, 2, 3, 3)
    R(sg, bright, 3, 3, 1, 1)
  })
  return at(FRAME.x, FRAME.y, g.svg() + at(6, 6, face.svg()) + at(w - 6, -2, star))
}

/** Under the ground floor: the chute, the vat of molten metal and the pipe back to the printer. */
function basement(g: Px, r: () => number) {
  const top = FY + 7
  const bottom = GROUND_H
  R(g, '#1f1826', 0, top, W, bottom - top)
  for (let y = top + 3, row = 0; y < bottom - 3; y += 6, row++) for (let x = row % 2 ? 8 : 0; x < W; x += 16) R(g, '#291f33', x, y, 15, 1)
  for (let i = 0; i < 14; i++) R(g, '#2c2238', Math.floor(r() * W), top + 2 + Math.floor(r() * (bottom - top - 6)), 2, 1)
  R(g, C.ink, 0, bottom - 2, W, 2)
  // the hatch in the floor, closed, and the chute under it
  R(g, C.ink, HOLE_X0 - 1, FY, HOLE_W + 2, 3)
  R(g, '#4a4f70', HOLE_X0, FY + 1, HOLE_W, 1)
  R(g, C.amber, HOLE_X0, FY, 2, 1)
  R(g, C.amber, HOLE_X0 + HOLE_W - 2, FY, 2, 1)
  R(g, '#15101c', HOLE_X0, top, HOLE_W, VAT.y - top)
  R(g, C.steelD, HOLE_X0 - 1, top, 1, VAT.y - top)
  R(g, C.steelD, HOLE_X0 + HOLE_W, top, 1, VAT.y - top)
  for (let y = top + 2; y < VAT.y - 1; y += 6) {
    R(g, C.amber, HOLE_X0 - 3, y, 2, 2)
    R(g, C.amber, HOLE_X0 + HOLE_W + 1, y, 2, 2)
  }
  // the vat, cut away so its molten load shows
  R(g, C.ink, VAT.x - 1, VAT.y - 1, VAT.w + 2, VAT.h + 1)
  R(g, '#2a1714', VAT.x + 3, VAT.y, VAT.w - 6, MELT_Y - VAT.y)
  const molten: Array<[number, string]> = [[1, '#fff1a8'], [2, '#ffd166'], [3, '#ffb347'], [6, '#ff8a2a'], [8, '#f06a24'], [99, '#c8401c']]
  let y = MELT_Y
  for (const [rows, c] of molten) {
    const n = Math.min(rows, VAT.y + VAT.h - 4 - y)
    if (n <= 0) break
    R(g, c, VAT.x + 3, y, VAT.w - 6, n)
    y += n
  }
  for (const [mx, my, mw] of [[VAT.x + 8, MELT_Y + 9, 7], [VAT.x + 27, MELT_Y + 13, 9], [VAT.x + 16, MELT_Y + 19, 6], [VAT.x + 36, MELT_Y + 7, 5]] as const)
    R(g, '#ffb347', mx, my, mw, 1)
  R(g, '#5b5f7a', VAT.x, VAT.y, 3, VAT.h - 1)
  R(g, '#5b5f7a', VAT.x + VAT.w - 3, VAT.y, 3, VAT.h - 1)
  R(g, '#7a80a0', VAT.x, VAT.y, 1, VAT.h - 2)
  R(g, '#7a80a0', VAT.x + VAT.w - 3, VAT.y, 1, VAT.h - 2)
  R(g, '#3b3f55', VAT.x, VAT.y + VAT.h - 4, VAT.w, 3)
  R(g, '#7a80a0', VAT.x - 2, VAT.y - 1, 6, 1)
  R(g, '#7a80a0', VAT.x + VAT.w - 4, VAT.y - 1, 6, 1)
  for (let ry = VAT.y + 4; ry < VAT.y + VAT.h - 5; ry += 6) {
    R(g, C.steelL, VAT.x + 1, ry, 1, 1)
    R(g, C.steelL, VAT.x + VAT.w - 2, ry, 1, 1)
  }
  // the pipe that carries the metal back to the printer: riser, elbow, run
  R(g, C.ink, PIPE_X, FY + 1, PIPE_W, BEND_CY - FY - 1)
  R(g, C.steelD, PIPE_X + 1, FY + 1, PIPE_W - 2, BEND_CY - FY - 1)
  R(g, C.steel, PIPE_X + 1, FY + 1, 1, BEND_CY - FY - 1)
  R(g, C.ink, BEND_CX, PIPE_Y, VAT.x - BEND_CX, PIPE_W)
  R(g, C.steelD, BEND_CX, PIPE_Y + 1, VAT.x - BEND_CX, PIPE_W - 2)
  R(g, C.steel, BEND_CX, PIPE_Y + 1, VAT.x - BEND_CX, 1)
  elbow(g)
  for (let x = 46; x < PIT.x0 - PIT_WALL - 20; x += 28) {
    R(g, C.ink, x, PIPE_Y - 1, 3, PIPE_W + 2)
    R(g, '#ff9a3c', x + 1, PIPE_Y + 2, 1, 2)
  }
}

function paintUpper(floor: number): Px {
  const g = new Px(W, FLOOR_H)
  const plum = floor % 2 === 1
  const wall = plum ? '#4d3c69' : C.slate
  const wallD = plum ? '#3c2e56' : C.slateD
  const wallHi = plum ? '#5a4778' : C.slateL
  const glow = plum ? '#5d4a7a' : '#46697d'
  const fy = 46
  R(g, wall, 0, 0, W, fy)
  // pilasters between the desks, a chair rail and wainscot
  for (const x of UPPER_X) R(g, wallD, x - 14, 6, 2, fy - 19)
  R(g, C.ink, 0, fy - 13, W, 1)
  R(g, wallHi, 0, fy - 12, W, 1)
  R(g, wallD, 0, fy - 11, W, 11)
  for (let x = 10; x < W; x += 22) R(g, C.ink, x, fy - 9, 1, 8)
  // the ceiling beam under the floor above
  R(g, C.woodD, 0, 0, W, 5)
  R(g, C.wood, 0, 4, W, 1)
  R(g, C.ink, 0, 5, W, 1)
  for (const x of UPPER_X) lamp(g, x + 13, 6, fy - 21, glow)
  for (const x of UPPER_X) workstation(g, x, fy)
  R(g, C.ink, 0, fy, W, 1)
  R(g, C.wood, 0, fy + 1, W, 2)
  R(g, C.woodD, 0, fy + 3, W, 6)
  for (let x = 6 + floor * 5; x < W; x += 17) R(g, C.woodD, x, fy + 1, 1, 2)
  R(g, C.ink, 0, FLOOR_H - 1, W, 1)
  shaft(g, 0, FLOOR_H, fy, floor + 1)
  return g
}

/**
 * The 3D printer, seen from the front: a frame of a top beam on two posts with a lead screw inside
 * each, a heated bed, and a control box with its screen and dial. The gantry is drawn on its own.
 */
function printerBody(g: Px, active: boolean) {
  const { x, y, w, h } = PRINTER
  const I = C.ink
  const frameH = PLATE_Y + 3 - y
  // the frame, and the dark chamber inside it
  R(g, I, x, y, w, frameH)
  R(g, C.dark, x + 4, y + 4, w - 8, PLATE_Y - y - 4)
  R(g, '#171c36', x + 4, y + 4, w - 8, 2)
  R(g, C.steel, x + 1, y + 1, w - 2, 2)
  R(g, C.steelL, x + 1, y + 1, w - 2, 1)
  R(g, C.steel, x + 1, y + 3, 2, frameH - 4)
  R(g, C.steelL, x + 1, y + 1, 1, frameH - 2)
  R(g, C.steel, x + w - 3, y + 3, 2, frameH - 4)
  R(g, C.steelD, x + w - 2, y + 3, 1, frameH - 4)
  // a lead screw inside each post, its thread catching the light
  for (const sx of [x + 5, x + w - 6]) for (let yy = y + 4; yy < PLATE_Y; yy++) R(g, yy % 2 ? C.steelD : C.steel, sx, yy, 1, 1)
  // the heated bed: it glows red while it prints
  R(g, I, x + 3, PLATE_Y, w - 6, 3)
  R(g, C.steel, x + 4, PLATE_Y, w - 8, 1)
  R(g, active ? C.red : C.steelD, x + 4, PLATE_Y + 1, w - 8, 1)
  // the control box: a screen, vents and a dial
  const by = PLATE_Y + 3
  R(g, I, x, by, w, y + h - by)
  R(g, C.panel2, x + 1, by + 1, w - 2, y + h - by - 2)
  R(g, '#4d567c', x + 1, by + 1, w - 2, 1)
  R(g, I, LCD.x - 1, LCD.y - 1, LCD.w + 2, LCD.h + 2)
  R(g, active ? '#10302a' : C.scr, LCD.x, LCD.y, LCD.w, LCD.h)
  if (!active) R(g, '#25495c', LCD.x + 1, LCD.y + 1, 4, 1)
  for (let vx = x + 19; vx < x + w - 12; vx += 2) R(g, '#262b45', vx, by + 3, 1, 4)
  disc(g, I, x + w - 7, by + 4, 2)
  disc(g, C.steel, x + w - 7, by + 4, 1)
  R(g, C.steelL, x + w - 8, by + 3, 1, 1)
}

/**
 * The gantry: a rail across the two lead screws with a carriage on each, and the hotend on it at
 * hx (heatsink, fan, heater, nozzle) with its nozzle tip on row `tip`, fed from above.
 */
function printerGantry(g: Px, hx: number, tip: number, hot: boolean, feedFrom: number) {
  const { x, w } = PRINTER
  const I = C.ink
  const rail = tip - 5
  R(g, hot ? '#ff9a3c' : C.cream, hx, feedFrom, 1, Math.max(0, tip - 7 - feedFrom))
  R(g, I, x + 4, rail - 1, w - 8, 3)
  R(g, C.steelL, x + 4, rail, w - 8, 1)
  for (const cx0 of [x + 4, x + w - 8]) {
    R(g, I, cx0, rail - 2, 4, 5)
    R(g, C.steelD, cx0 + 1, rail - 1, 2, 3)
    R(g, C.steel, cx0 + 1, rail - 1, 2, 1)
  }
  R(g, I, hx - 3, tip - 7, 7, 6)
  for (let i = 0; i < 5; i++) R(g, i % 2 ? C.steelD : C.steelL, hx - 2 + i, tip - 6, 1, 1)
  R(g, '#262b45', hx - 2, tip - 5, 5, 2)
  R(g, C.steel, hx, tip - 5, 1, 2)
  R(g, hot ? C.coral : C.coralD, hx - 2, tip - 3, 5, 1)
  R(g, '#c9922c', hx - 1, tip - 1, 3, 1)
  R(g, hot ? '#ff7a3c' : '#c9922c', hx, tip, 1, 1)
}

/**
 * The beacon, set into the middle of the printer's top beam: an amber lamp with a turning mirror
 * inside. While a robot prints, the mirror spins and the light sweeps along the beam; idle, the
 * lamp is dark.
 */
function printerBeacon(on: boolean, detail: Detail): string {
  // local frame, an even 16 wide so the lamp sits dead centre; the beam's top edge is row 4
  const frame = (glass: string, spot: [x: number, y: number, w: number, h: number] | null, sweep: -1 | 0 | 1 | null, glow: number) => {
    const g = new Px(16, 8)
    R(g, C.ink, 5, 2, 6, 1)
    R(g, C.ink, 4, 3, 8, 4)
    R(g, glass, 6, 3, 4, 1)
    R(g, glass, 5, 4, 6, 3)
    if (spot) R(g, '#fff1a8', spot[0], spot[1], spot[2], spot[3])
    if (!on) R(g, C.amber, 6, 4, 1, 1)
    // the light it throws along the beam, and a spark each side when it faces the room
    if (sweep !== null && sweep <= 0) R(g, C.amber, 1, 5, 3, 1)
    if (sweep !== null && sweep >= 0) R(g, C.amber, 12, 5, 3, 1)
    if (sweep === 0) {
      R(g, C.lamp, 3, 1, 1, 1)
      R(g, C.lamp, 12, 1, 1, 1)
    }
    const halo = glow > 0 ? `<circle cx="8" cy="4.5" r="${sweep === 0 ? 8 : 5}" fill="url(#beaconglow)" opacity="${glow}"/>` : ''
    return halo + g.svg()
  }
  const x = PRINTER.x + (PRINTER.w >> 1) - 8
  const y = PRINTER.y - 4
  if (!on) return at(x, y, frame('#a8641e', null, null, 0))
  const turns = [frame(C.amber, [5, 4, 1, 3], -1, 0.45), frame(C.amber, [7, 3, 2, 4], 0, 1), frame(C.amber, [10, 4, 1, 3], 1, 0.45), frame('#b8742a', null, null, 0)]
  const defs = `<defs><radialGradient id="beaconglow"><stop offset="0" stop-color="${C.amber}" stop-opacity="0.85"/><stop offset="1" stop-color="${C.amber}" stop-opacity="0"/></radialGradient></defs>`
  return defs + at(x, y, detail > 0 ? turns[1]! : cycle(turns, [0.12, 0.12, 0.12, 0.12]))
}

/* ---------- SVG and SMIL ---------- */
const s2 = (n: number) => (Math.round(n * 100) / 100).toString()

/** How much the drawing may animate: 0 full, 1 single frames, 2 also no subagent clouds. */
type Detail = 0 | 1 | 2

/** Frames that take turns, each shown for its own number of seconds, looping. */
function cycle(frames: string[], durs: number[]): string {
  if (frames.length === 1) return frames[0]!
  const total = durs.reduce((a, b) => a + b, 0)
  let acc = 0
  let out = ''
  frames.forEach((f, i) => {
    const k0 = acc / total
    const k1 = (acc + durs[i]!) / total
    acc += durs[i]!
    let values: string
    let keys: string
    if (i === 0) {
      values = 'visible;hidden'
      keys = `0;${k1.toFixed(4)}`
    } else if (i === frames.length - 1) {
      values = 'hidden;visible'
      keys = `0;${k0.toFixed(4)}`
    } else {
      values = 'hidden;visible;hidden'
      keys = `0;${k0.toFixed(4)};${k1.toFixed(4)}`
    }
    out += `<g visibility="${i === 0 ? 'visible' : 'hidden'}"><animate attributeName="visibility" values="${values}" keyTimes="${keys}" dur="${s2(total)}s" calcMode="discrete" repeatCount="indefinite"/>${f}</g>`
  })
  return out
}

/** Shown from `t0` to `t1` seconds after the drawing loads; `null` is unbounded. */
function during(t0: number | null, t1: number | null, inner: string): string {
  if (t1 !== null && t1 <= 0) return ''
  // display, not visibility: a child's own visibility loop would show through a hidden parent
  const shown = t0 === null || t0 <= 0
  let anim = ''
  if (!shown) anim += `<set attributeName="display" to="inline" begin="${s2(t0!)}s"/>`
  if (t1 !== null) anim += `<set attributeName="display" to="none" begin="${s2(t1)}s"/>`
  return `<g display="${shown ? 'inline' : 'none'}">${anim}${inner}</g>`
}
const at = (x: number, y: number, inner: string) => `<g transform="translate(${x} ${y})">${inner}</g>`

/** A sprite as several frames, drawn by `draw` at each time in `times`. */
function sprite(w: number, h: number, times: number[], durs: number[], detail: Detail, draw: (g: Px, t: number) => void): string {
  const ts = detail > 0 ? times.slice(0, 1) : times
  return cycle(
    ts.map((t) => {
      const g = new Px(w, h)
      draw(g, t)
      return g.svg()
    }),
    durs,
  )
}

type BotLook = { pose: Pose; eyes: Eyes }
function lookFor(kind: ActivityKind, seated: boolean): BotLook {
  if (kind === 'idle') return { pose: seated ? 'sit' : 'stand', eyes: 'off' }
  if (kind === 'think') return { pose: seated ? 'sit' : 'stand', eyes: 'up' }
  if (kind === 'ask') return { pose: 'raise', eyes: 'open' }
  if (kind === 'done') return { pose: 'cheer', eyes: 'happy' }
  if (kind === 'error') return { pose: 'err', eyes: 'x' }
  return { pose: seated ? 'type' : 'stand', eyes: 'open' }
}

function robotFrames(roleId: string, look: BotLook, small: boolean, detail: Detail, seated = false, girth = 0): string {
  const { paint, headgear: gear } = roleInfo(roleId)
  const fast = look.pose === 'type' || look.pose === 'raise' || look.pose === 'err'
  const times = fast ? [0, 0.11] : [0, 0.65]
  const durs = fast ? [0.12, 0.12] : [0.6, 0.6]
  return sprite(26, 34, times, durs, detail, (g, t) => bot(g, 13, 32, { paint, small, gear, pose: look.pose, eyes: look.eyes, t, seated, girth }))
}

function bubbleSvg(kind: ActivityKind, label: string, sm: boolean, x: number, y: number, tailX: number, tailY: number, detail: Detail): string {
  const f = BUB[kind]
  if (!f) return ''
  const w = sm ? 44 : 80
  const h = sm ? 19 : 34
  const shell = new Px(w + 40, h + 40)
  cloud(shell, 1, 1, w, h, tailX - x + 1, tailY - y + 1)
  const times = [0, 0.45, 0.9, 1.35]
  const inner = sprite(w - 6, h - 4, times, [0.45, 0.45, 0.45, 0.45], detail, (g, a) => f(g, 0, 0, w - 6, h - 4, a + 0.6, label, sm))
  return at(x - 1, y - 1, shell.svg()) + at(x + 3, y + 2, inner)
}

function screenFor(kind: ActivityKind): ScreenMode {
  if (kind === 'write') return 'code'
  if (kind === 'run' || kind === 'tool') return 'term'
  if (kind === 'web' || kind === 'mcp') return 'web'
  if (kind === 'read' || kind === 'search') return 'file'
  if (kind === 'spawn') return 'blue'
  if (kind === 'done') return 'pass'
  if (kind === 'error') return 'fail'
  if (kind === 'idle') return 'off'
  return 'idle'
}

function screenSvg(x: number, y: number, w: number, h: number, mode: ScreenMode, detail: Detail): string {
  if (mode === 'pass' || mode === 'fail') {
    const g = new Px(w, h)
    R(g, mode === 'pass' ? C.greenD : C.redD, 0, 0, w, h)
    R(g, C.paper, 2, h >> 1, w - 4, 1)
    return at(x, y, g.svg())
  }
  const animated = mode !== 'off' && mode !== 'blue'
  const times = animated ? [0, 0.6, 1.2, 1.8, 2.4, 3] : [0]
  return at(x, y, sprite(w, h, times, times.map(() => 0.6), detail, (g, a) => screen(g, 0, 0, w, h, mode, a)))
}

/** Where a subagent robot is in its life: printed, walking (through the lift), working, then leaving. */
type Pt = [number, number]
export type Phase = {
  seat: Seat
  /** First the printer draws molten metal up the pipe from the vat... */
  feedEnd: number
  /** After printing: a walk to the main agent for the task's blueprint... */
  briefPts: Pt[]
  briefCum: number[]
  briefAt: number
  briefEnd: number
  /** ...then on to its desk, by the lift for the upper floors. */
  pts: Pt[]
  cum: number[]
  printEnd: number
  arriveAt: number
  workEnd: number | null
  /** After work: stands up, carries its report to the main desk, then jumps into the vat. */
  leaveAt: number | null
  leavePts: Pt[]
  leaveCum: number[]
  handAt: number | null
  toHoleAt: number | null
  jumpAt: number | null
  splashAt: number | null
  goneAt: number | null
}

/** Milliseconds along a path of straight legs: walking across, riding the lift up and down. */
function timings(pts: Pt[]): number[] {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!
    const [bx, by] = pts[i]!
    cum.push(cum[i - 1]! + (ax === bx ? (Math.abs(by - ay) / LIFT_PX_PER_S) * 1000 : (Math.abs(bx - ax) / WALK_PX_PER_S) * 1000))
  }
  return cum
}
function along(pts: Pt[], cum: number[], t: number): { x: number; y: number } {
  let i = 1
  while (i < cum.length - 1 && cum[i]! < t) i++
  const [ax, ay] = pts[i - 1]!
  const [bx, by] = pts[Math.min(i, pts.length - 1)]!
  const u = Math.min(1, Math.max(0, (t - cum[i - 1]!) / Math.max(1, cum[i]! - cum[i - 1]!)))
  return { x: ax + (bx - ax) * u, y: ay + (by - ay) * u }
}

export function phaseOf(r: Robot, floors: number): Phase | null {
  const seat = seatFor(r.seat, floors)
  if (!seat) return null
  const gy = floors * FLOOR_H
  const groundY = gy + FY
  const briefPts: Pt[] = [[EXIT_X, groundY], [BRIEF_X, groundY]]
  const briefCum = timings(briefPts)
  const pts: Pt[] =
    seat.floor === 0
      ? [[BRIEF_X, groundY], [seat.x, groundY]]
      : [[BRIEF_X, groundY], [SHAFT_X, groundY], [SHAFT_X, seat.floorY], [seat.x, seat.floorY]]
  const cum = timings(pts)
  const feedEnd = r.spawnedAt + FEED_MS
  const printEnd = feedEnd + PRINT_MS
  const briefAt = printEnd + briefCum[briefCum.length - 1]!
  const briefEnd = briefAt + BRIEF_MS
  const arriveAt = briefEnd + cum[cum.length - 1]!
  const leavePts: Pt[] =
    seat.floor === 0
      ? [[seat.x, seat.y], [seat.x, groundY], [DELIVER_X, groundY]]
      : [[seat.x, seat.y], [seat.x, seat.floorY], [SHAFT_X, seat.floorY], [SHAFT_X, groundY], [DELIVER_X, groundY]]
  const leaveCum = timings(leavePts)
  // A fast subagent still reaches its desk and works a moment before it reports.
  const workEnd = r.endedAt === undefined ? null : Math.max(r.endedAt, arriveAt + MIN_WORK_MS)
  if (workEnd === null)
    return { seat, feedEnd, briefPts, briefCum, briefAt, briefEnd, pts, cum, printEnd, arriveAt, workEnd, leaveAt: null, leavePts, leaveCum, handAt: null, toHoleAt: null, jumpAt: null, splashAt: null, goneAt: null }
  const leaveAt = workEnd + CHEER_MS
  const handAt = leaveAt + leaveCum[leaveCum.length - 1]!
  const toHoleAt = handAt + HANDOFF_MS
  const jumpAt = toHoleAt + (Math.abs(HOLE_X - DELIVER_X) / WALK_PX_PER_S) * 1000
  const splashAt = jumpAt + HOP_MS + FALL_MS
  return { seat, feedEnd, briefPts, briefCum, briefAt, briefEnd, pts, cum, printEnd, arriveAt, workEnd, leaveAt, leavePts, leaveCum, handAt, toHoleAt, jumpAt, splashAt, goneAt: splashAt + SPLASH_MS }
}

/** Every moment a robot's picture changes on its own; once all have passed, a fresh picture holds still. */
export function transitionsOf(r: Robot, floors: number): number[] {
  const p = phaseOf(r, floors)
  if (!p) return []
  return [p.feedEnd, p.printEnd, p.briefAt, p.briefEnd, p.arriveAt, p.workEnd, p.leaveAt, p.handAt, p.toHoleAt, p.jumpAt, p.splashAt, p.goneAt].filter((t): t is number => t !== null)
}

export function positionOf(r: Robot, floors: number, now: number): { x: number; y: number } | null {
  const gy = floors * FLOOR_H
  if (r.type === 'main') return { x: MAIN_X, y: gy + SEAT_Y }
  const p = phaseOf(r, floors)
  if (!p || (p.goneAt !== null && now >= p.goneAt)) return null
  if (now < p.printEnd) return { x: PRINTER.x + (PRINTER.w >> 1), y: gy + PLATE_Y }
  if (now < p.briefAt) return along(p.briefPts, p.briefCum, now - p.printEnd)
  if (now < p.briefEnd) return { x: BRIEF_X, y: gy + FY }
  if (now < p.arriveAt) return along(p.pts, p.cum, now - p.briefEnd)
  if (p.leaveAt === null || now < p.leaveAt) return { x: p.seat.x, y: p.seat.y }
  if (now < p.handAt!) return along(p.leavePts, p.leaveCum, now - p.leaveAt)
  if (now < p.toHoleAt!) return { x: DELIVER_X, y: gy + FY }
  if (now < p.jumpAt!) return { x: DELIVER_X + ((HOLE_X - DELIVER_X) * (now - p.toHoleAt!)) / Math.max(1, p.jumpAt! - p.toHoleAt!), y: gy + FY }
  return null
}

/** Which robot sits under a point of the scene, in scene pixels. */
export function hitTest(world: World, now: number, x: number, y: number): string | null {
  y -= ROOF_H
  let best: string | null = null
  let bestD = Infinity
  for (const r of world.robots) {
    const p = positionOf(r, world.floors, now)
    if (!p) continue
    const small = r.type !== 'main'
    const top = p.y - (small ? 18 : 22)
    const half = small ? 9 : 11
    if (x < p.x - half || x > p.x + half || y < top - 6 || y > p.y + 3) continue
    const d = Math.abs(x - p.x) + Math.abs(y - (top + p.y) / 2)
    if (d < bestD) {
      bestD = d
      best = r.id
    }
  }
  return best
}

const BG_CACHE = new Map<string, string>()
function cached(key: string, make: () => string): string {
  let svg = BG_CACHE.get(key)
  if (!svg) {
    svg = make()
    BG_CACHE.set(key, svg)
  }
  return svg
}

function selectMark(x: number, y: number): string {
  const g = new Px(9, 5)
  R(g, C.ink, 0, 0, 9, 1)
  R(g, C.ink, 1, 1, 7, 1)
  R(g, C.ink, 2, 2, 5, 1)
  R(g, C.ink, 3, 3, 3, 1)
  R(g, C.amber, 1, 0, 7, 1)
  R(g, C.amber, 2, 1, 5, 1)
  R(g, C.amber, 3, 2, 3, 1)
  R(g, C.amber, 4, 3, 1, 1)
  return at(x - 4, y - 14, g.svg())
}

/** A robot moving along straight legs, each with its own facing; riding the lift it stands still. */
function walkLegs(pts: Pt[], cum: number[], startAt: number, now: number, framesFor: (face: number, riding: boolean) => string): string {
  const sec = (t: number) => (t - now) / 1000
  let out = ''
  let face = 1
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!
    const [bx, by] = pts[i]!
    const riding = ax === bx
    if (!riding) face = bx > ax ? 1 : -1
    const t0 = startAt + cum[i - 1]!
    const t1 = startAt + cum[i]!
    if (t1 <= now || t1 <= t0) continue
    const from = `${s2(ax - 13)} ${s2(ay - 32)}`
    const to = `${s2(bx - 13)} ${s2(by - 32)}`
    const move = `<g transform="translate(${from})"><animateTransform attributeName="transform" type="translate" from="${from}" to="${to}" begin="${s2(sec(t0))}s" dur="${s2((t1 - t0) / 1000)}s" fill="freeze"/>${framesFor(face, riding)}</g>`
    out += during(sec(t0), sec(t1), move)
  }
  return out
}

/** The pipe's centre line, from the vat round the elbow and up into the printer. */
function feedPath(): Pt[] {
  const mid = PIPE_Y + PIPE_W / 2
  const midR = BEND_R - PIPE_W / 2
  const pts: Pt[] = [[PIT.x0 - PIT_WALL + 1, mid]]
  for (let i = 0; i <= 6; i++) {
    const a = (Math.PI / 2) * (1 - i / 6)
    pts.push([BEND_CX - Math.cos(a) * midR, BEND_CY + Math.sin(a) * midR])
  }
  pts.push([PIPE_X + PIPE_W / 2, FY + 2])
  return pts
}

/** A slug of molten metal drawn up to the printer: the pipe swells around a glowing bubble. */
function feedSvg(spawnedAt: number, feedEnd: number, sec: (t: number) => number, detail: Detail): string {
  if (detail >= 2 || feedEnd <= spawnedAt) return ''
  const bubble = new Px(10, 10)
  disc(bubble, C.ink, 5, 5, 4)
  disc(bubble, C.steel, 5, 5, 3)
  disc(bubble, '#ff8a2a', 5, 5, 2)
  R(bubble, '#ffd166', 4, 4, 2, 2)
  R(bubble, C.white, 4, 4, 1, 1)
  R(bubble, C.steelL, 2, 3, 1, 2)
  const pts = feedPath()
  const lens = pts.map((p, i) => (i === 0 ? 0 : Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1])))
  const total = lens.reduce((a, b) => a + b, 0)
  let run = 0
  const keys = lens.map((l) => ((run += l) / total).toFixed(4)).join(';')
  const values = pts.map(([x, y]) => `${s2(x - 5)} ${s2(y - 5)}`).join(';')
  const begin = s2(sec(spawnedAt))
  const dur = s2((feedEnd - spawnedAt) / 1000)
  const halo = `<circle cx="5" cy="5" r="9" fill="url(#feedglow)"/>`
  const glowDef = `<defs><radialGradient id="feedglow"><stop offset="0" stop-color="#ff9a3c" stop-opacity="0.55"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></radialGradient></defs>`
  const [x0, y0] = pts[0]!
  const moving = `<g transform="translate(${s2(x0 - 5)} ${s2(y0 - 5)})"><animateTransform attributeName="transform" type="translate" values="${values}" keyTimes="${keys}" calcMode="linear" begin="${begin}s" dur="${dur}s" fill="freeze"/>${halo}${bubble.svg()}</g>`
  return glowDef + during(sec(spawnedAt), sec(feedEnd), moving)
}

/** Bubbles on the molten metal and the glow it throws on the basement walls. */
function vatLife(detail: Detail): string {
  const glow = `<defs><radialGradient id="melt" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ff8a2a" stop-opacity="0.42"/><stop offset="1" stop-color="#ff8a2a" stop-opacity="0"/></radialGradient><clipPath id="pitwalls"><rect x="${PIT.x0}" y="${PIT.top}" width="${PIT.x1 - PIT.x0}" height="${PIT.bottom - PIT.top}"/></clipPath></defs><ellipse cx="${HOLE_X}" cy="${MELT_Y}" rx="48" ry="22" fill="url(#melt)" clip-path="url(#pitwalls)"/>`
  const flow = sprite(VAT.w - 6, VAT.h - 8, [0, 0.5, 1], [0.5, 0.5, 0.5], detail, (g, t) => {
    const k = Math.round(t / 0.5)
    for (const [fx, fy, fw] of [[4, 10, 6], [20, 15, 8], [33, 21, 5], [11, 24, 7]] as const) R(g, '#ffd166', (fx + k * 3) % (VAT.w - 12), fy - k, fw, 1)
  })
  const bubbles = sprite(VAT.w, 4, [0, 0.4, 0.8], [0.4, 0.4, 0.4], detail, (g, t) => {
    const k = Math.round(t / 0.4)
    for (const [bx, phase] of [[6, 0], [17, 1], [29, 2], [38, 1]] as const) {
      const s = (k + phase) % 3
      if (s === 0) R(g, '#ffd166', bx, 2, 2, 1)
      else if (s === 1) R(g, '#ffb347', bx, 1, 3, 2)
    }
  })
  return glow + at(VAT.x + 3, MELT_Y, flow) + at(VAT.x, MELT_Y - 3, bubbles)
}

/** Rectangles of one colour, as a single shape. */
const boxes = (fill: string, list: Array<[x: number, y: number, w: number, h: number]>) =>
  `<path fill="${fill}" d="${list.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h-${w}z`).join('')}"/>`

/** The pit's lining: a stone wall each side of the vat, and the flange that bolts the pipe to the left one. */
function pitFrame(): string {
  const { x0, x1, top, bottom } = PIT
  const h = bottom - top
  const walls = [x0 - PIT_WALL, x1]
  const joints: Array<[number, number, number, number]> = []
  for (const x of walls) for (let y = top + 6; y < bottom; y += 6) joints.push([x, y, PIT_WALL, 1])
  const fx = x0 - PIT_WALL - 4
  return (
    boxes('#3a2e48', walls.map((x) => [x, top, PIT_WALL, h])) +
    boxes('#54446a', [[x0 - PIT_WALL, top, 1, h], [x1 + PIT_WALL - 1, top, 1, h]]) +
    boxes(C.ink, [...joints, [fx, PIPE_Y - 3, 4, PIPE_W + 6]]) +
    boxes(C.steelD, [[fx + 1, PIPE_Y - 2, 3, PIPE_W + 4]]) +
    boxes(C.steel, [[fx + 1, PIPE_Y - 2, 1, PIPE_W + 4]]) +
    boxes(C.steelL, [[fx + 2, PIPE_Y - 1, 1, 1], [fx + 2, PIPE_Y + PIPE_W, 1, 1]])
  )
}

/**
 * The pit, drawn over whatever is inside it: pitch dark between its walls while the hatch is shut.
 * Each drop opens the hatch and the room's light falls in; when the hatch slams shut the dark is
 * back at once, with a puff of dust.
 */
function pitSvg(drops: Array<{ open: number; shut: number }>, sec: (t: number) => number, detail: Detail): string {
  // the spans the hatch stands open; drops that follow close on each other share one
  const spans: Array<{ open: number; shut: number }> = []
  for (const d of [...drops].sort((a, b) => a.open - b.open)) {
    if (sec(d.shut) <= 0) continue
    const last = spans[spans.length - 1]
    if (last && d.open <= last.shut) last.shut = Math.max(last.shut, d.shut)
    else spans.push({ ...d })
  }
  const dark = (opacity: string) => `<rect x="${PIT.x0}" y="${PIT.top}" width="${PIT.x1 - PIT.x0}" height="${PIT.bottom - PIT.top}" fill="${PIT_DARK}"${opacity}/>`
  const lit = spans.length > 0 && sec(spans[0]!.open) <= 0
  let sets = ''
  for (const s of spans) {
    if (sec(s.open) > 0) sets += `<set attributeName="display" to="none" begin="${s2(sec(s.open))}s"/>`
    sets += `<set attributeName="display" to="inline" begin="${s2(sec(s.shut))}s"/>`
  }
  let out = `<g display="${lit ? 'none' : 'inline'}">${sets}${dark('')}</g>`
  // the eye takes a moment to see into the pit
  for (const s of spans) out += during(sec(s.open), sec(s.open + HATCH_DIM_MS), dark(' opacity="0.5"'))
  out += cached('pit', pitFrame)
  if (!spans.length) return out
  const shaft = new Px(W, GROUND_H)
  for (let y = FY + 1; y < MELT_Y; y++) {
    const spread = y < VAT.y ? 0 : y - VAT.y + 1
    R(shaft, C.lamp, HOLE_X0 - spread, y, HOLE_W + spread * 2, 1)
  }
  R(shaft, C.white, HOLE_X0 - 4, MELT_Y, HOLE_W + 8, 1)
  const light = `<g opacity="0.24">${shaft.svg()}</g>`
  const dust = sprite(W, GROUND_H, [0, 0.15], [0.15, 0.15], detail, (g, t) => {
    const k = t > 0 ? 1 : 0
    for (const [dx, dir] of [[HOLE_X0 - 3, -1], [HOLE_X0 + HOLE_W + 1, 1]] as const) {
      R(g, C.steelL, dx + dir * k * 2, FY - 2 - k, 2, 1)
      R(g, C.steel, dx + dir * (2 + k * 2), FY - 1 - k * 2, 1, 1)
    }
  })
  for (const s of spans) out += during(sec(s.open), sec(s.shut), light) + during(sec(s.shut), sec(s.shut + 300), dust)
  return out
}

function compose(world: World, now: number, selected: string, detail: Detail): string {
  const sec = (t: number) => (t - now) / 1000
  const floors = world.floors
  const gy = floors * FLOOR_H
  const height = sceneHeight(floors)
  const main = world.robots.find((r) => r.type === 'main')
  const subs = world.robots.filter((r) => r.type !== 'main')
  let out = at(0, gy, cached(`ground:${world.home}`, () => paintGround(world.home).svg()))
  for (let f = 1; f <= floors; f++) out += at(0, gy - f * FLOOR_H, cached(`floor:${f}`, () => paintUpper(f).svg()))

  // ground-floor machines, drawn in ground coordinates; the window shows the hour outside
  let ground = cached(`window:${skyKey(now)}`, () => paintWindow(new Date(now).getHours()).svg())
  const printing = subs.map((r) => phaseOf(r, floors)).filter((p): p is Phase => !!p && p.printEnd > now)
  const busyUntil = printing.length ? Math.max(...printing.map((p) => p.printEnd)) : 0
  // idle, the gantry parks up top with the beacon dark; printing, each print drives the gantry
  const idleBody = new Px(W, GROUND_H)
  printerBody(idleBody, false)
  printerGantry(idleBody, PARK_X, PARK_TIP, false, PRINTER.y + 4)
  const idle = idleBody.svg() + printerBeacon(false, detail)
  if (busyUntil) {
    const busyBody = new Px(W, GROUND_H)
    printerBody(busyBody, true)
    ground += during(null, sec(busyUntil), busyBody.svg() + printerBeacon(true, detail)) + during(sec(busyUntil), null, idle)
  } else ground += idle
  ground += `<clipPath id="chamber"><rect x="${PRINTER.x + 4}" y="${PRINTER.y + 4}" width="${PRINTER.w - 8}" height="${PLATE_Y - PRINTER.y - 4}"/></clipPath>`
  ground += at(BOARD.x, BOARD.y, tokenChart(dailyTotals(world.tokens, world.history, now, CHART_DAYS)))
  ground += employeeFrame(world.tokens, now, detail)
  // the vat lives in the dark: its glow and bubbles are drawn only when a drop will open the hatch
  const dropping = subs.some((r) => {
    const p = phaseOf(r, floors)
    return !!p && p.splashAt !== null && p.splashAt + HATCH_HOLD_MS > now
  })
  if (dropping) ground += vatLife(detail)
  for (const r of subs) {
    const p = phaseOf(r, floors)
    if (p && p.feedEnd > now) ground += feedSvg(r.spawnedAt, p.feedEnd, sec, detail)
  }
  const mainKind = main?.activity.kind ?? 'idle'
  ground += screenSvg(133, 88, 23, 15, screenFor(mainKind), detail)
  const asking = world.robots.some((r) => r.activity.kind === 'ask' && r.status === 'working')
  if (asking) {
    const on = new Px(W, SIGN_Y + SIGN_H + 2)
    sign(on, 'NEEDS YOU', C.amber, C.ink)
    ground += cycle([on.svg(), ''], [0.4, 0.4])
  }
  const queued = subs.filter((r) => r.seat >= CAPACITY && r.endedAt === undefined).length
  if (queued > 0) {
    const label = `+${queued} WAITING`
    const g = new Px(tw(label) + 8, 9)
    R(g, C.ink, 0, 0, tw(label) + 8, 9)
    R(g, C.amber, 1, 1, tw(label) + 6, 7)
    tx(g, label, 4, 2, C.ink)
    ground += at(4, 58, g.svg())
  }
  out += at(0, gy, ground)

  // subagents: printed, walking, working, then cheering and leaving
  const drops: Array<{ open: number; shut: number }> = []
  for (const r of subs) {
    const p = phaseOf(r, floors)
    if (!p || (p.goneAt !== null && p.goneAt <= now)) continue
    const role = r.role ?? roleOf(r.type, r.description)
    const { paint, headgear: gear } = roleInfo(role)
    const girth = girthOf(r.context)
    if (p.printEnd > now) {
      const cx = PRINTER.x + (PRINTER.w >> 1)
      const id = `clip-${r.id.replace(/[^a-zA-Z0-9]/g, '')}`
      const g = new Px(26, 34)
      bot(g, 13, 32, { paint, small: true, gear, pose: 'stand', eyes: 'off', bulb: C.steelD, girth })
      const b = s2(sec(p.feedEnd))
      const d = s2(PRINT_MS / 1000)
      const reveal = `<clipPath id="${id}"><rect x="${PRINTER.x + 3}" y="${PLATE_Y}" width="${PRINTER.w - 6}" height="0"><animate attributeName="y" from="${PLATE_Y}" to="${PLATE_Y - PRINT_RISE}" begin="${b}s" dur="${d}s" fill="freeze"/><animate attributeName="height" from="0" to="${PRINT_RISE}" begin="${b}s" dur="${d}s" fill="freeze"/></rect></clipPath>`
      // the gantry comes down to the bed while the metal comes up the pipe, then rises a layer at a time
      const head = sprite(W, GROUND_H, [0, 0.15, 0.3, 0.45], [0.15, 0.15, 0.15, 0.15], detail, (hg, t) =>
        printerGantry(hg, cx + Math.round(Math.sin(t * 7) * 6), PLATE_Y - 1, true, PRINTER.y - PRINT_RISE),
      )
      const span = p.printEnd - r.spawnedAt
      const key = (t: number) => (Math.max(0, t - r.spawnedAt) / span).toFixed(4)
      const z = `<animateTransform attributeName="transform" type="translate" values="0 ${-PRINT_RISE};0 ${-PRINT_RISE};0 0;0 ${-PRINT_RISE}" keyTimes="0;${key(p.feedEnd - 500)};${key(p.feedEnd)};1" begin="${s2(sec(r.spawnedAt))}s" dur="${s2(span / 1000)}s" fill="freeze"/>`
      const gantry = `<g clip-path="url(#chamber)"><g transform="translate(0 ${-PRINT_RISE})">${z}${head}</g></g>`
      // the control box's screen fills as the robot prints
      const bar = `<rect x="${LCD.x}" y="${LCD.y + 1}" width="0" height="1" fill="${C.green}"><animate attributeName="width" from="0" to="${LCD.w}" begin="${b}s" dur="${d}s" fill="freeze"/></rect>`
      out += at(0, gy, during(null, sec(p.printEnd), `${reveal}<g clip-path="url(#${id})">${at(cx - 13, PLATE_Y - 32, g.svg())}</g>${gantry}${bar}`))
    }
    // Riding the lift a robot stands still; a carrying robot keeps its arms full.
    const walker = (pose: Pose, eyes: Eyes, item?: 'report' | 'blueprint') => (face: number, riding: boolean) =>
      sprite(26, 34, riding ? [0] : [0, 0.11], [0.12, 0.12], detail, (g, t) =>
        bot(g, 13, 32, { paint, small: true, gear, pose: riding && pose !== 'carry' ? 'stand' : pose, eyes, face, t, item, girth }),
      )
    const groundY = gy + FY
    if (p.briefAt > now) out += walkLegs(p.briefPts, p.briefCum, p.printEnd, now, walker('walk', 'open'))
    if (p.briefEnd > now) {
      // the main agent hands over the task's blueprint
      const waiting = sprite(26, 34, [0], [1], detail, (g) => bot(g, 13, 32, { paint, small: true, gear, pose: 'stand', eyes: 'up', face: 1, girth }))
      const holding = sprite(26, 34, [0], [1], detail, (g) => bot(g, 13, 32, { paint, small: true, gear, pose: 'carry', eyes: 'happy', face: 1, item: 'blueprint', girth }))
      const caught = p.briefAt + 650
      out += during(sec(p.briefAt), sec(caught), at(BRIEF_X - 13, groundY - 32, waiting))
      out += during(sec(caught), sec(p.briefEnd), at(BRIEF_X - 13, groundY - 32, holding))
      const roll = new Px(7, 4)
      R(roll, C.ink, 0, 0, 7, 4)
      R(roll, C.blue, 1, 1, 5, 2)
      R(roll, '#a9ccff', 1, 1, 5, 1)
      R(roll, C.paper, 1, 1, 1, 2)
      const fromB = `${MAIN_X - 8} ${gy + SEAT_Y - 16}`
      const toB = `${BRIEF_X + 2} ${groundY - 14}`
      const toss = `<g transform="translate(${fromB})"><animateTransform attributeName="transform" type="translate" values="${fromB};${Math.round((MAIN_X + BRIEF_X) / 2) - 4} ${gy + SEAT_Y - 30};${toB}" keyTimes="0;0.5;1" begin="${s2(sec(p.briefAt + 150))}s" dur="0.5s" fill="freeze"/>${roll.svg()}</g>`
      out += during(sec(p.briefAt + 150), sec(caught), toss)
    }
    if (p.arriveAt > now) out += walkLegs(p.pts, p.cum, p.briefEnd, now, walker('carry', 'open', 'blueprint'))
    const seated = p.seat.y
    const workKind: ActivityKind = r.status === 'working' ? r.activity.kind : 'think'
    const mark = r.id === selected ? selectMark(p.seat.x, seated - 20) : ''
    const screenOn = sprite(7, 5, [0, 0.6, 1.2], [0.6, 0.6, 0.6], detail, (g, a) => screen(g, 0, 0, 7, 5, 'code', a + r.seat))
    const cloudOf = (kind: ActivityKind, label: string) =>
      detail >= 2 ? '' : bubbleSvg(kind, label, true, p.seat.bubble.x, p.seat.bubble.y, p.seat.x, seated - 18, detail)
    const kit = new Px(10, 10)
    deskProp(kit, role, -28, 26)
    const props = at(p.seat.x + 9, p.seat.floorY - 27, kit.svg())
    const working =
      props +
      at(p.seat.monX, p.seat.monY, screenOn) +
      at(p.seat.x - 13, seated - 32, robotFrames(role, lookFor(workKind, true), true, detail, true, girth)) +
      mark +
      cloudOf(workKind, r.status === 'working' ? r.activity.label : '')
    out += during(sec(p.arriveAt), p.workEnd === null ? null : sec(p.workEnd), working)
    if (p.workEnd !== null && p.leaveAt !== null && p.handAt !== null && p.toHoleAt !== null && p.jumpAt !== null && p.splashAt !== null && p.goneAt !== null) {
      const endKind: ActivityKind = r.status === 'failed' ? 'error' : 'done'
      // a cheer at the desk
      const cheering = props + at(p.seat.x - 13, seated - 32, robotFrames(role, lookFor(endKind, true), true, detail, true, girth)) + mark + cloudOf(endKind, '')
      out += during(sec(p.workEnd), sec(p.leaveAt), cheering)
      // carrying the report down to the main desk
      out += walkLegs(p.leavePts, p.leaveCum, p.leaveAt, now, walker('carry', 'happy', 'report'))
      // handing it over: the robot faces the main agent and the report flies across
      const standing = sprite(26, 34, [0], [1], detail, (g) => bot(g, 13, 32, { paint, small: true, gear, pose: 'stand', eyes: 'happy', face: -1, girth }))
      out += during(sec(p.handAt), sec(p.toHoleAt), at(DELIVER_X - 13, groundY - 32, standing))
      const paper = new Px(6, 5)
      R(paper, C.ink, 0, 0, 6, 5)
      R(paper, C.paper, 1, 1, 4, 3)
      R(paper, C.amber, 1, 1, 4, 1)
      const fromP = `${DELIVER_X - 8} ${groundY - 13}`
      const toP = `${MAIN_X + 4} ${gy + SEAT_Y - 14}`
      const flight = `<g transform="translate(${fromP})"><animateTransform attributeName="transform" type="translate" values="${fromP};${DELIVER_X - 30} ${groundY - 24};${toP}" keyTimes="0;0.5;1" begin="${s2(sec(p.handAt))}s" dur="0.6s" fill="freeze"/>${paper.svg()}</g>`
      out += during(sec(p.handAt), sec(p.handAt + 650), flight)
      const thanks = new Px(11, 9)
      R(thanks, C.ink, 0, 0, 11, 9)
      R(thanks, C.paper, 1, 1, 9, 7)
      check(thanks, 0, 0, C.greenD)
      out += during(sec(p.handAt + 600), sec(p.handAt + 1500), at(MAIN_X - 5, gy + SEAT_Y - 40, thanks.svg()))
      // a few steps to the hatch, which opens and lets the light into the pit; a hop, and down into the vat
      const toHole: Pt[] = [[DELIVER_X, groundY], [HOLE_X, groundY]]
      out += walkLegs(toHole, timings(toHole), p.toHoleAt, now, walker('walk', 'happy'))
      const opened = p.jumpAt - HATCH_LEAD_MS
      const shut = p.splashAt + HATCH_HOLD_MS
      const open = new Px(HOLE_W + 2, 8)
      R(open, '#15101c', 1, 0, HOLE_W, 8)
      R(open, '#4a4f70', 0, 0, 2, 7)
      R(open, '#4a4f70', HOLE_W, 0, 2, 7)
      out += during(sec(opened), sec(shut), at(HOLE_X0 - 1, groundY, open.svg()))
      drops.push({ open: opened, shut })
      const leaping = sprite(26, 34, [0], [1], detail, (g) => bot(g, 13, 32, { paint, small: true, gear, pose: 'cheer', eyes: 'happy', girth }))
      const a = `${HOLE_X - 13} ${groundY - 32}`
      const values = `${a};${HOLE_X - 13} ${groundY - 41};${HOLE_X - 13} ${gy + MELT_Y + 12 - 32}`
      const hop = (HOP_MS / (HOP_MS + FALL_MS)).toFixed(3)
      const id = `melt-${r.id.replace(/[^a-zA-Z0-9]/g, '')}`
      const fall = `<g transform="translate(${a})"><animateTransform attributeName="transform" type="translate" values="${values}" keyTimes="0;${hop};1" calcMode="spline" keySplines="0 0 0.58 1;0.42 0 1 1" begin="${s2(sec(p.jumpAt))}s" dur="${s2((HOP_MS + FALL_MS) / 1000)}s" fill="freeze"/>${leaping}</g>`
      out += during(sec(p.jumpAt), sec(p.splashAt + 120), `<clipPath id="${id}"><rect x="0" y="0" width="${W}" height="${gy + MELT_Y}"/></clipPath><g clip-path="url(#${id})">${fall}</g>`)
      // the splash
      const splash = sprite(30, 14, [0, 0.25, 0.5], [0.25, 0.25, 0.3], detail, (g, t) => {
        const k = Math.round(t / 0.25)
        const drops: Array<[number, number, string]> = [[-6, 3, '#ffd166'], [5, 4, '#ff9a3c'], [-2, 6, '#ffb347'], [8, 2, '#e8501f'], [-9, 2, '#ff9a3c']]
        for (const [dx, up, c] of drops) R(g, c, 15 + dx * (1 + k * 0.4), 11 - up * (k === 1 ? 2 : k === 0 ? 1 : 1.4) + k * 2, 1 + (k === 0 ? 1 : 0), 1)
        R(g, k === 0 ? C.lamp : '#ffd166', 9 - k * 2, 12, 12 + k * 4, 1)
      })
      out += during(sec(p.splashAt), sec(p.goneAt), at(HOLE_X - 15, gy + MELT_Y - 12, splash))
    }
  }

  // the pit stays dark until a hatch lets the light in
  out += at(0, gy, pitSvg(drops, sec, detail))

  // the main robot and its cloud
  if (main) {
    const kind = main.activity.kind
    out += at(MAIN_X - 13, gy + SEAT_Y - 32, robotFrames('main', lookFor(kind, true), false, detail, true, girthOf(main.context)))
    if (main.id === selected) out += selectMark(MAIN_X, gy + SEAT_Y - 24)
    if (kind === 'idle') {
      out += sprite(W, height, [0, 0.7, 1.4, 2.1], [0.7, 0.7, 0.7, 0.7], detail, (g, t) => zzz(g, MAIN_X + 2, gy + SEAT_Y - 22, t))
      out += `<rect width="${W}" height="${height}" fill="#0a061e" opacity="0.32"/>`
    } else {
      out += bubbleSvg(kind, main.activity.label, false, 58, gy + 51, MAIN_X, gy + SEAT_Y - 21, detail)
    }
  }
  const roof = cached('roof', () => paintRoof().svg())
  const beacon = `<rect x="205" y="0" width="3" height="1" fill="${C.red}"><animate attributeName="opacity" values="1;0.15;1" dur="1.6s" repeatCount="indefinite"/></rect>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W * 6}" height="${height * 6}" shape-rendering="crispEdges">${roof}${beacon}${at(0, ROOF_H, out)}</svg>`
}

/** The whole building at `now`, every change still to come encoded as SMIL timing; kept under the Svg cap. */
export function buildScene(world: World, now: number, selected = ''): string {
  let svg = compose(world, now, selected, 0)
  if (svg.length > 120_000) svg = compose(world, now, selected, 1)
  if (svg.length > 128_000) svg = compose(world, now, selected, 2)
  return svg
}

export type TaskState = 'running' | 'waiting' | 'done' | 'failed' | 'idle'

const BADGE: Record<TaskState, string> = { running: '#4f8fe6', waiting: C.amber, done: '#3fbf6a', failed: C.red, idle: '#6f7893' }

/** A robot's portrait: its pixel head and shoulders on a glass tile, with a status badge. */
export function avatarSvg(roleId: string, kind: ActivityKind, state: TaskState = 'running'): string {
  const role = roleInfo(roleId)
  const g = new Px(20, 20)
  bot(g, 10, 26, { paint: role.paint, small: false, gear: role.headgear, view: 'front', pose: 'stand', eyes: lookFor(kind, false).eyes })
  const id = `av${roleId}${state}`.replace(/[^a-zA-Z0-9]/g, '')
  const defs =
    `<defs><linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${role.paint.d}" stop-opacity="0.75"/><stop offset="1" stop-color="#121826"/></linearGradient>` +
    `<linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>` +
    `<clipPath id="${id}c"><rect x="0.5" y="0.5" width="19" height="19" rx="5"/></clipPath></defs>`
  const tile = `<rect x="0.5" y="0.5" width="19" height="19" rx="5" fill="url(#${id}b)"/>`
  const robot = `<g clip-path="url(#${id}c)"><g shape-rendering="crispEdges">${g.svg()}</g><rect x="0.5" y="0.5" width="19" height="9" fill="url(#${id}g)"/></g>`
  const rim = `<rect x="0.5" y="0.5" width="19" height="19" rx="5" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="0.6"/>`
  const c = BADGE[state]
  const pulse = state === 'running' ? `<circle cx="16.6" cy="16.6" r="3.4" fill="${c}" opacity="0"><animate attributeName="opacity" values="0.55;0;0.55" dur="1.6s" repeatCount="indefinite"/><animate attributeName="r" values="2.6;4.2;2.6" dur="1.6s" repeatCount="indefinite"/></circle>` : ''
  const mark =
    state === 'done'
      ? `<path d="M15.2 16.7l1 1 2-2.1" fill="none" stroke="#ffffff" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round"/>`
      : state === 'failed'
        ? `<path d="M15.5 15.5l2.2 2.2M17.7 15.5l-2.2 2.2" stroke="#ffffff" stroke-width="0.8" stroke-linecap="round"/>`
        : state === 'waiting'
          ? `<path d="M16.6 15.2v1.6M16.6 17.9v0.1" stroke="#1a1428" stroke-width="0.8" stroke-linecap="round"/>`
          : ''
  const badge = state === 'idle' ? '' : `${pulse}<circle cx="16.6" cy="16.6" r="2.6" fill="${c}" stroke="#121826" stroke-width="0.8"/>${mark}`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="40" height="40">${defs}${tile}${robot}${rim}${badge}</svg>`
}

/** How many days the whiteboard charts: the last week, today included. */
export const CHART_DAYS = 7
const CHART_TOP = 4
const CHART_BASE = 16
const chartX = (i: number) => 5 + i * 6

/** The row each day's point sits on: the busiest day at the top, a day without tokens on the baseline. */
export function chartRows(daily: number[]): number[] {
  const max = Math.max(1, ...daily)
  return daily.map((v) => CHART_BASE - Math.round((v / max) * (CHART_BASE - CHART_TOP)))
}

/** A line on the whiteboard, one pixel wide, as a marker draws it. */
function stroke(g: Px, c: string, x0: number, y0: number, x1: number, y1: number) {
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    R(g, c, x0, y0, 1, 1)
    if (x0 === x1 && y0 === y1) return
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
}

/** Tokens per day over the last week, drawn on the whiteboard with the markers from its tray. */
function tokenChart(daily: number[]): string {
  const g = new Px(BOARD.w, BOARD.h)
  R(g, C.blueD, 3, CHART_BASE + 1, BOARD.w - 6, 1)
  const rows = chartRows(daily)
  for (let i = 1; i < rows.length; i++) stroke(g, C.red, chartX(i - 1), rows[i - 1]!, chartX(i), rows[i]!)
  rows.forEach((y, i) => {
    const x = chartX(i)
    if (i === rows.length - 1) {
      // today, still counting
      R(g, C.redD, x - 1, y - 1, 3, 3)
      R(g, C.white, x, y, 1, 1)
    } else {
      R(g, C.redD, x - 1, y, 3, 1)
      R(g, C.redD, x, y - 1, 1, 3)
    }
  })
  return g.svg()
}

/** Real progress: the steps of an agent's own plan, or the trail of steps it has taken. */
export type Progress =
  | { mode: 'plan'; statuses: PlanStatus[] }
  | { mode: 'trail'; kinds: ActivityKind[]; state: 'running' | 'done' | 'failed' }

const KIND_COL: Partial<Record<ActivityKind, [string, string]>> = {
  read: [C.blue, '#a9ccff'],
  search: [C.violet, C.violetL],
  web: [C.teal, C.tealL],
  write: [C.green, '#b5f0bb'],
  run: [C.amber, C.lamp],
  spawn: ['#e86aa6', '#ffb8d4'],
  ask: [C.coral, C.coralL],
  talk: [C.steel, C.steelL],
  mcp: [C.tealD, C.teal],
  tool: [C.steelD, C.steel],
  error: [C.red, '#ff9a96'],
}

/** A glass progress track with glossy segments; the step in flight shimmers. */
export function progressSvg(p: Progress, roleId: string, width = 220): string {
  const w = width
  const h = 8
  const paint = roleInfo(roleId).paint
  const id = `pg${roleId}`.replace(/[^a-zA-Z0-9]/g, '')
  const defs =
    `<defs><linearGradient id="${id}t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.03"/></linearGradient>` +
    `<linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${paint.l}"/><stop offset="0.55" stop-color="${paint.m}"/><stop offset="1" stop-color="${paint.d}"/></linearGradient>` +
    `<linearGradient id="${id}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.lamp}"/><stop offset="0.55" stop-color="${C.amber}"/><stop offset="1" stop-color="#c98a2c"/></linearGradient>` +
    `<linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.45"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.7"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs>`
  let segs = ''
  let live = ''
  const pill = (x: number, sw: number, fill: string) =>
    `<rect x="${x.toFixed(2)}" y="2" width="${Math.max(1, sw).toFixed(2)}" height="${h - 4}" rx="${Math.min(3, sw / 2).toFixed(2)}" fill="${fill}"/>`
  const shimmer = (x: number, sw: number) => {
    const span = Math.max(4, sw)
    return `<rect x="${x.toFixed(2)}" y="2" width="${span.toFixed(2)}" height="${h - 4}" rx="${Math.min(3, span / 2).toFixed(2)}" fill="url(#${id}s)"><animate attributeName="opacity" values="0.15;0.95;0.15" dur="1.4s" repeatCount="indefinite"/></rect>`
  }
  const inner = w - 4
  if (p.mode === 'plan') {
    const n = Math.max(1, p.statuses.length)
    const gap = n > 24 ? 1 : 2
    const sw = (inner - gap * (n - 1)) / n
    p.statuses.forEach((st, i) => {
      const x = 2 + i * (sw + gap)
      if (st === 'completed') segs += pill(x, sw, `url(#${id}f)`)
      else if (st === 'in_progress') {
        segs += pill(x, sw, `url(#${id}a)`)
        live = shimmer(x, sw)
      } else segs += pill(x, sw, '#ffffff" fill-opacity="0.07')
    })
  } else {
    const slots = Math.max(8, Math.floor((inner + 2) / 14))
    const gap = 2
    const sw = (inner - gap * (slots - 1)) / slots
    const kinds = p.kinds.slice(-(p.state === 'running' ? slots : slots - 1))
    for (let i = 0; i < slots; i++) {
      const x = 2 + i * (sw + gap)
      const k = kinds[i]
      if (k) segs += pill(x, sw, (KIND_COL[k] ?? [C.steelD, C.steel])[0])
      else if (p.state === 'done' && i > kinds.length) segs += pill(x, sw, `url(#${id}f)`)
      else if (p.state !== 'running' && i === kinds.length) segs += pill(x, sw, p.state === 'done' ? '#3fbf6a' : C.red)
      else segs += pill(x, sw, '#ffffff" fill-opacity="0.07')
    }
    if (p.state === 'running' && kinds.length) live = shimmer(2 + (kinds.length - 1) * (sw + gap), sw)
  }
  const track = `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${(h - 1) / 2}" fill="url(#${id}t)" stroke="#ffffff" stroke-opacity="0.14"/>`
  const gloss = `<rect x="1" y="1" width="${w - 2}" height="${h / 2 - 1}" rx="${h / 2 - 1}" fill="url(#${id}g)"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${defs}${track}${segs}${live}${gloss}</svg>`
}
