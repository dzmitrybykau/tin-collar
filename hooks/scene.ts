// The building: pixel art drawn into small framebuffers, written out as SVG with
// SMIL loops. Nothing here touches `$`, so it also runs under plain Node.
import type { Act, ActivityKind, PlanStatus, Robot, TokenTally, World } from '../types'
import { champion, dailyTotals, formatTokens } from './tally'

export const W = 256
const GROUND_H = 170
export const FLOOR_H = 56
const FY = 116
const SEAT_Y = FY - 6
const MAIN_X = 110
const FEED_MS = 1500
const PRINT_MS = 2400
// with robots waiting for it, the printer works at the double
const RUSH_FEED_MS = 700
const RUSH_PRINT_MS = 1000
// the plate is free once the printed robot has stepped off it
const PLATE_CLEAR_MS = 350
// one robot at a time at the main desk: the handover, the hatch and the hop
const REPORT_SLOT_MS = 1600
const WALK_PX_PER_S = 90
const LIFT_PX_PER_S = 120
const MIN_WORK_MS = 2500
// a finished robot stays at its desk a moment longer: the picture of its leaving is laid before it stands up
const REPORT_READY_MS = 2200
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
type Headgear = 'antenna' | 'beret' | 'hardhat' | 'goggles' | 'mortar' | 'fedora' | 'quill' | 'phones' | 'cap'

/* Each role has its own paint, headgear and clothes, so you can tell who is who across the room. */
export type Role = { id: string; title: string; headgear: Headgear; paint: Paint; words?: RegExp }
const ROLES: Role[] = [
  { id: 'designer', title: 'Designer', headgear: 'beret', paint: { l: '#ffb8d4', m: '#e86aa6', d: '#a8436f' }, words: /\b(design(er|ing)?|ui|ux|artist|visual|palette|colou?rs?|style|css|icons?)\b/i },
  { id: 'architect', title: 'Architect', headgear: 'hardhat', paint: { l: '#a9ccff', m: C.blue, d: C.blueD }, words: /\b(architect(ure)?|plan(ner|ning)?|structure|blueprint|system design)\b/i },
  { id: 'tester', title: 'Tester', headgear: 'goggles', paint: { l: '#dcf59a', m: '#a8cc3c', d: '#6f8f22' }, words: /\b(test(er|s|ing)?|qa|verif(y|ier|ication))\b/i },
  { id: 'reviewer', title: 'Reviewer', headgear: 'mortar', paint: { l: C.violetL, m: C.violet, d: C.violetD }, words: /\b(review(er|ing)?|audit(or)?|critic|inspect(or)?)\b/i },
  { id: 'explorer', title: 'Explorer', headgear: 'fedora', paint: { l: C.tealL, m: C.teal, d: C.tealD }, words: /\b(explor(e|er|ing)|research(er|ing)?|search(ing)?|find|investigat\w*|scout|survey)\b/i },
  { id: 'writer', title: 'Writer', headgear: 'quill', paint: { l: '#f3dcb5', m: '#d2a86e', d: '#9c7444' }, words: /\b(writ(e|er|ing)|docs?|documentation|copy|author|readme)\b/i },
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
  s = s.toUpperCase().replace(/[^A-Z0-9.,:/\-_'"()?!<>=+*$% ]/g, ' ').replace(/ +/g, ' ').trim()
  if (tw(s) <= max) return s
  // cut to fit with two dots after it, on a whole word where that loses little
  let cut = s
  while (cut.length > 1 && tw(cut + '..') > max) cut = cut.slice(0, -1)
  const space = cut.lastIndexOf(' ')
  if (space >= cut.length * 0.6) cut = cut.slice(0, space)
  return cut.replace(/[ .,:/\-_]+$/, '') + '..'
}

/* ---------- the robot ---------- */
type Eyes = 'open' | 'up' | 'happy' | 'x' | 'off'
type Pose = 'stand' | 'walk' | 'type' | 'sit' | 'raise' | 'carry' | 'read' | 'lever' | 'cheer' | 'err' | 'sleep'
type BotOpts = {
  /** The role it plays: its paint, what is on its head and what it wears. The main agent's when left out. */
  role?: string
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
  /** With a hand free, it holds what its role is known for: a smoothie, a fly swatter, the boss's stick. */
  tool?: boolean
}

/**
 * What a robot wears on its head, drawn after the head and before the visor. A robot is some twenty
 * pixels tall on the screen, so each of these is big enough to name the job from across the room.
 */
function headgear(g: Px, gear: Headgear, x: number, hy: number, hw: number, hh: number, side: boolean, f: number, bulb: string) {
  const I = C.ink
  const hl = x - (hw >> 1)
  const half = hw >> 1
  // dx runs from the back of the head to the face in a side view and from left to right in a front
  // view; dy counts down from the head's top row
  const P = (c: string, dx: number, dy: number, w: number, h: number) => R(g, c, side && f < 0 ? hl + hw - dx - w : hl + dx, hy + dy, w, h)
  switch (gear) {
    case 'beret': {
      // a painter's beret, slumped to one side, with its little stalk
      const back = side ? -3 : -2
      P(I, back + 2, -6, hw - 2, 1)
      P(I, back, -5, hw + 3, 5)
      P(I, back - 1, -3, 3, 5)
      P(BERET, back + 1, -5, hw + 1, 4)
      P(BERET, back, -3, 2, 4)
      P(BERET_L, back + 2, -5, hw - 3, 1)
      P(I, half - 1, -7, 1, 1)
      return
    }
    case 'hardhat': {
      // a builder's yellow hard hat: a dome, a ridge and a brim
      P(I, 1, -7, hw - 2, 1)
      P(I, 0, -6, hw, 5)
      P(C.yellow, 1, -6, hw - 2, 4)
      P('#fff3a8', 2, -6, hw - 5, 1)
      P('#c9a227', 1, -3, hw - 2, 1)
      if (!side) P('#c9a227', half - 1, -6, 2, 3)
      P(I, side ? -1 : -2, -2, hw + 4, 2)
      P(C.yellow, side ? 0 : -1, -2, hw + 2, 1)
      return
    }
    case 'goggles': {
      // lab goggles pushed up on the forehead, their strap round the head
      if (side) {
        P(I, 0, -2, hw, 3)
        P('#4a5170', 0, -1, hw - 6, 1)
        P(I, hw - 7, -4, 8, 5)
        P(C.tealL, hw - 6, -3, 6, 1)
        P(C.teal, hw - 6, -2, 6, 2)
        P(C.white, hw - 5, -3, 2, 1)
      } else {
        P('#3b4262', 0, 0, hw, 1)
        P(I, 0, -5, hw, 6)
        for (const lx of [1, half + 1]) {
          P(C.tealL, lx, -4, half - 2, 2)
          P(C.teal, lx, -2, half - 2, 2)
          P(C.white, lx + 1, -4, 1, 1)
        }
      }
      return
    }
    case 'mortar': {
      // a square academic cap: a wide board on a skullcap, the tassel hanging off its edge
      P(I, side ? 0 : 1, -3, side ? hw : hw - 2, 2)
      P('#2b2f45', side ? 1 : 2, -3, side ? hw - 2 : hw - 4, 2)
      P(I, -3, -6, hw + 6, 3)
      P('#8d96bd', -2, -6, hw + 4, 1)
      P('#4a5170', -2, -5, hw + 4, 1)
      P(C.amber, half - 1, -7, 2, 1)
      P(C.amber, hw + 1, -4, 1, 4)
      P(C.amber, hw + 1, 0, 2, 3)
      return
    }
    case 'fedora': {
      // an adventurer's fedora: a pinched crown, a dark band and a wide brim
      P(I, 1, -7, hw - 2, 1)
      P(I, 0, -6, hw, 4)
      P(FEDORA, 1, -6, hw - 2, 2)
      P(FEDORA_L, 1, -6, hw - 4, 1)
      P(I, half - 1, -6, 2, 1)
      P('#4a2e1f', 1, -4, hw - 2, 1)
      P(I, -3, -3, hw + 6, 3)
      P(FEDORA, -2, -2, hw + 4, 1)
      return
    }
    case 'quill': {
      // a feather quill tucked behind the ear; seen from the front it leans out past the side of the head
      const vane: Array<[dy: number, dx: number, w: number]> = [[-1, 1, 2], [-2, 0, 3], [-3, -1, 4], [-4, -2, 4], [-5, -3, 4], [-6, -3, 2]]
      const Q = (c: string, dx: number, dy: number, w: number) => P(c, side ? dx : hw - dx - w, dy, w, 1)
      for (const [dy, dx, w] of vane) Q(I, dx - 1, dy, w + 2)
      Q(I, -3, -7, 2)
      for (const [dy, dx, w] of vane) {
        Q(C.white, dx, dy, w)
        if (w > 2 && dy % 2) Q(C.steelL, dx, dy, 1)
      }
      P('#c9a227', side ? 2 : hw - 3, 0, 1, 2)
      return
    }
    case 'phones': {
      // a headset: a band over the head, a big cup on the ear and a microphone on its boom
      if (side) {
        P(I, 0, -4, 5, 4)
        P('#4a5170', 1, -3, 3, 3)
        P(C.steelL, 1, -3, 3, 1)
        P(I, -2, 0, 5, 7)
        P(C.steelL, -1, 1, 3, 5)
        P(C.glow, 0, 2, 1, 3)
        P(I, 3, hh - 2, hw - 3, 1)
        P(I, hw, hh - 3, 2, 3)
        P(C.steelL, hw, hh - 2, 1, 1)
      } else {
        P(I, 1, -4, hw - 2, 1)
        P(I, 0, -3, hw, 2)
        P('#4a5170', 1, -3, hw - 2, 2)
        P(C.steelL, 1, -3, hw - 2, 1)
        for (const cx of [-3, hw - 1]) {
          P(I, cx, 0, 4, 7)
          P(C.steelL, cx + 1, 1, 2, 5)
          P(C.glow, cx + (cx < 0 ? 1 : 2), 2, 1, 3)
        }
        P(I, hw - 5, hh - 1, 5, 1)
        P(I, hw - 6, hh - 2, 2, 2)
        P(C.steelL, hw - 6, hh - 2, 1, 1)
      }
      return
    }
    case 'cap': {
      // a workman's red cap with a white front and a long peak
      P(I, 1, -6, hw - 2, 1)
      P(I, 0, -5, hw, 4)
      P(C.red, 1, -5, hw - 2, 4)
      P('#ff8a80', 1, -5, hw - 4, 1)
      if (side) {
        P(C.white, hw - 4, -4, 3, 2)
        P(I, hw - 1, -3, 6, 3)
        P(C.redD, hw, -2, 4, 1)
      } else {
        P(C.white, half - 2, -5, 4, 2)
        P(I, 0, -3, hw, 1)
        P(C.redD, 1, -2, hw - 2, 1)
      }
      return
    }
    default: {
      // the main agent's antenna and its lamp
      const ax = side ? half - 2 : half
      P(I, ax, -3, 1, 2)
      P(I, ax - 1, -6, 4, 3)
      P(bulb, ax, -5, 2, 2)
    }
  }
}
const BERET = '#c43c5c'
const BERET_L = '#f07c96'
const FEDORA = '#a8713f'
const FEDORA_L = '#d19a5f'

/** What a role wears. It is drawn over the body and under the arms. */
function outfit(g: Px, id: string, bl: number, by: number, bw: number, bh: number, side: boolean, f: number, p: Paint) {
  const I = C.ink
  const mid = bw >> 1
  // dx runs from the back to the chest in a side view and from left to right in a front view
  const P = (c: string, dx: number, dy: number, w: number, h: number) => R(g, c, side && f < 0 ? bl + bw - dx - w : bl + dx, by + dy, w, h)
  switch (id) {
    case 'main': // a collar and tie
      if (side) {
        P(C.white, bw - 2, 0, 2, 1)
        P(TIE, bw - 1, 1, 1, bh - 2)
      } else {
        P(C.white, mid - 2, 0, 4, 1)
        P(TIE, mid - 1, 1, 2, bh - 2)
      }
      return
    case 'coder': // a dark hoodie with its drawstrings
      P('#3b4262', 0, 0, bw, bh)
      P('#4a5170', 0, 0, bw, 1)
      if (side) P(C.steelL, bw - 1, 1, 1, 2)
      else {
        P(C.steelL, mid - 2, 1, 1, 2)
        P(C.steelL, mid + 1, 1, 1, 2)
      }
      return
    case 'designer': // a sailor's striped shirt
      for (let j = 0; j < bh; j++) P(j % 2 ? '#2f4f9c' : C.paper, 0, j, bw, 1)
      return
    case 'architect': // a hi-vis vest with its reflective band
      P('#ff8a2a', 0, 0, bw, bh)
      P('#ffb066', 0, 0, bw, 1)
      P('#fff3a8', 0, bh >> 1, bw, 1)
      return
    case 'tester': // a white lab coat, open at the front, a pen in its pocket
      P(C.page, 0, 0, bw, bh)
      P(C.steelL, 0, bh - 1, bw, 1)
      if (side) P(p.m, bw - 1, 0, 1, bh)
      else {
        P(p.m, mid - 1, 0, 2, bh)
        P(C.red, 1, 1, 1, 2)
      }
      return
    case 'reviewer': // a black gown with white bands at the collar
      P('#2b2f45', 0, 0, bw, bh)
      P('#4a5170', 0, 0, bw, 1)
      if (side) P(C.white, bw - 2, 0, 2, 2)
      else P(C.white, mid - 1, 0, 2, 3)
      return
    case 'explorer': // a khaki shirt, the straps of a pack, and the pack on its back
      P('#d9c58a', 0, 0, bw, bh)
      P('#efe0ae', 0, 0, bw, 1)
      P(C.woodD, 1, 0, 1, bh)
      if (side) {
        P(I, -4, 0, 4, bh + 1)
        P('#7a8a3f', -3, 1, 2, bh - 1)
        P('#a3b35c', -3, 1, 2, 1)
      } else P(C.woodD, bw - 2, 0, 1, bh)
      return
    case 'writer': // a long blue scarf, its end over the shoulder
      P(SCARF, 0, 0, bw, 1)
      if (side) {
        P(I, -3, 0, 3, bh + 1)
        P(SCARF, -2, 1, 2, bh - 1)
        P(C.cream, -2, 2, 2, 1)
      } else {
        P(SCARF, 1, 1, 2, bh - 2)
        P(C.cream, 1, 2, 2, 1)
      }
      return
    case 'helper': // a tool belt
      P(C.woodD, 0, bh - 2, bw, 1)
      P(C.amber, side ? bw - 2 : mid - 1, bh - 2, side ? 1 : 2, 1)
      return
  }
}
const TIE = '#2f4f9c'
const SCARF = '#5b8def'

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

/** How a role gets about when it is not sitting: on two feet, on a monowheel, on tracks, or under a gown that reaches the floor. */
type Ride = 'feet' | 'wheel' | 'tracks' | 'gown'
const RIDE: Record<string, Ride> = { coder: 'wheel', architect: 'tracks', reviewer: 'gown' }
const GOWN = '#2b2f45'

/** What is under a robot that does not walk on two feet. `foot` is the row under its body; `step` turns the wheel or the tracks. */
function undercarriage(g: Px, ride: Ride, x: number, y: number, bl: number, bw: number, foot: number, step: number) {
  const I = C.ink
  if (ride === 'wheel') {
    // a monowheel: the tyre, the hub, and a spoke that turns
    R(g, I, x - 1, y - 5, 3, 5)
    R(g, I, x - 2, y - 4, 5, 3)
    R(g, C.steelD, x - 1, y - 4, 3, 3)
    R(g, C.steelL, x, y - 3, 1, 1)
    R(g, C.steelL, step ? x - 1 : x, step ? y - 3 : y - 4, 1, 1)
    R(g, C.steelL, step ? x + 1 : x, step ? y - 3 : y - 2, 1, 1)
  } else if (ride === 'tracks') {
    // caterpillar tracks, their links going round
    const w = Math.max(10, bw + 2)
    const x0 = x - (w >> 1)
    R(g, I, x0 + 1, y - 3, w - 2, 3)
    R(g, I, x0, y - 2, w, 1)
    R(g, C.steelD, x0 + 1, y - 2, w - 2, 1)
    for (let i = step; i < w - 2; i += 2) R(g, C.steelL, x0 + 1 + i, y - 2, 1, 1)
  } else if (ride === 'gown') {
    // the gown flares and reaches the floor
    R(g, I, bl - 2, foot, bw + 4, y - foot)
    R(g, GOWN, bl - 1, foot, bw + 2, y - foot - 1)
  }
}

/**
 * What a role has in its free hand, held up in front of it. `T` draws from the robot's middle
 * toward its face and down from the top of its body; the hand is at (6, 1).
 */
const TOOLS: Record<string, (T: (c: string, dx: number, dy: number, w: number, h: number) => void, t: number) => void> = {
  coder(T) {
    // a smoothie with a straw
    T(C.ink, 5, -3, 5, 5)
    T('#ff8fc0', 6, -2, 3, 3)
    T(C.white, 6, -2, 3, 1)
    T(C.yellow, 8, -6, 1, 3)
  },
  designer(T) {
    // a palette and a brush loaded with red
    T(C.ink, 5, -3, 6, 5)
    T(C.cream, 6, -2, 4, 3)
    T(C.red, 6, -2, 1, 1)
    T(C.yellow, 8, -2, 1, 1)
    T(C.teal, 9, -1, 1, 1)
    T(C.blue, 7, 0, 1, 1)
    T(C.woodL, 10, -6, 1, 3)
    T(C.red, 10, -8, 1, 2)
  },
  architect(T) {
    // a folding rule, held upright
    T(C.ink, 6, -9, 3, 11)
    T(C.yellow, 7, -8, 1, 9)
    for (let j = -7; j < 1; j += 2) T(C.ink, 7, j, 1, 1)
  },
  tester(T, t) {
    // a fly swatter for the bugs
    const swat = Math.floor(t * 9) % 2
    T(C.steelL, 7, -4 + swat, 1, 5 - swat)
    T(C.ink, 5, -10 + swat, 5, 6)
    T('#a8cc3c', 6, -9 + swat, 3, 4)
    T(C.ink, 6, -8 + swat, 1, 1)
    T(C.ink, 8, -8 + swat, 1, 1)
    T(C.ink, 7, -7 + swat, 1, 1)
  },
  reviewer(T) {
    // a magnifying glass, held up to the eye
    T(C.woodL, 7, -2, 1, 3)
    T(C.ink, 6, -7, 3, 5)
    T(C.ink, 5, -6, 5, 3)
    T(C.tealL, 6, -6, 3, 3)
    T(C.white, 6, -6, 1, 1)
  },
  explorer(T, t) {
    // a burning torch
    const flick = Math.floor(t * 9) % 2
    T(C.woodL, 7, -3, 1, 4)
    T(C.ink, 6, -4, 3, 1)
    T('#e8501f', 6, -7, 3, 3)
    T(C.amber, 6 + flick, -6, 2, 2)
    T(C.lamp, 7, -5, 1, 1)
    T('#e8501f', flick ? 6 : 8, -8, 1, 1)
  },
  helper(T) {
    // a wrench
    T(C.steelL, 7, -4, 1, 5)
    T(C.ink, 5, -9, 5, 5)
    T(C.steelL, 6, -8, 1, 3)
    T(C.steelL, 8, -8, 1, 3)
    T(C.steelL, 6, -6, 3, 1)
  },
}

export function bot(g: Px, x: number, y: number, o: BotOpts) {
  x = Math.trunc(x)
  y = Math.trunc(y)
  const info = roleInfo(o.role ?? 'main')
  const p = o.paint ?? info.paint
  const small = !!o.small
  const f = o.face ?? 1
  const view = o.view ?? 'side'
  const pose = o.pose ?? 'stand'
  const t = o.t ?? 0
  const I = C.ink
  const hw = small ? 10 : 12, hh = small ? 8 : 9, bw = (small ? 6 : 8) + 2 * (o.girth ?? 0), bh = small ? 4 : 5
  const walk = pose === 'walk' || pose === 'carry'
  const sit = !!o.seated || pose === 'type' || pose === 'sit'
  const ride: Ride = view === 'side' ? (RIDE[info.id] ?? 'feet') : 'feet'
  const fr = Math.floor(t * 9) % 2
  const slow = Math.floor(t * 1.6) % 2
  if (pose === 'err') x += Math.floor(t * 22) % 2 ? 1 : -1
  // a seated robot keeps still on its stool; standing, it bobs; on a wheel or on tracks it glides
  const glides = ride === 'wheel' || ride === 'tracks'
  const lift = walk ? (glides ? 0 : fr) : pose === 'sleep' || sit ? 0 : slow
  const X = (dx: number, w: number) => (f > 0 ? x + dx : x - dx - w)
  // what it stands on is as tall as two feet, or as its tracks, or as its wheel
  const base = sit ? y : y - (ride === 'wheel' ? 4 : ride === 'tracks' ? 3 : 2)
  if (!sit && ride === 'feet') {
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
  // An arm held up: it comes out from behind the head and goes up beside it, never across the
  // face. `dir` is 1 for the arm on the face's side, -1 for the one at the back.
  const armUp = (dir: 1 | -1, wave = 0) => {
    const e = hw >> 1
    const col = (d: number) => (dir > 0 ? X(e + d, 2) : X(-e - d - 2, 2))
    R(g, S, col(1), by - 3, 2, 4)
    R(g, S, col(2), by - 6, 2, 3)
    R(g, p.l, col(2 + wave), by - 8, 2, 2)
  }
  if (view === 'side' && pose === 'cheer') armUp(-1)
  R(g, I, bl - 1, by, bw + 2, bh + 1)
  R(g, I, bl, by - 1, bw, bh + 2)
  R(g, p.m, bl, by, bw, bh)
  R(g, p.d, f > 0 || view !== 'side' ? bl : bl + bw - 2, by, 2, bh)
  R(g, p.l, bl, by, bw, 1)
  if (view !== 'back') {
    R(g, o.chest ?? C.glow, view === 'side' ? X(1, 2) : x - 1, by + 2, 2, 1)
    outfit(g, info.id, bl, by, bw, bh, view === 'side', f, p)
  }
  if (!sit) undercarriage(g, ride, x, y, bl, bw, by + bh, walk ? fr : 0)
  const hl = x - (hw >> 1)
  const hy = by - hh + 1
  R(g, I, hl, hy - 1, hw, hh + 2)
  R(g, I, hl - 1, hy, hw + 2, hh)
  R(g, p.m, hl, hy, hw, hh)
  R(g, p.l, hl, hy, hw, 1)
  R(g, p.l, hl, hy, 1, 3)
  R(g, p.d, hl, hy + hh - 1, hw, 1)
  headgear(g, o.gear ?? info.headgear, x, hy, hw, hh, view === 'side', f, o.bulb ?? (Math.floor(t * 2) % 2 ? C.amber : C.lamp))
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
    const T = (c: string, dx: number, dy: number, w: number, h: number) => R(g, c, X(dx, w), by + dy, w, h)
    // a hand is free on the way somewhere and while it waits
    const free = !!o.tool && (pose === 'walk' || pose === 'stand')
    const tool = free ? TOOLS[info.id] : undefined
    if (pose === 'type') {
      const tf = Math.floor(t * 10) % 2
      R(g, S, X(2, half + 3), by, half + 3, 1)
      R(g, I, X(half + 4, 2), by + tf, 2, 1)
    } else if (pose === 'raise') {
      armUp(1, Math.floor(t * 4) % 2)
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
    } else if (pose === 'read' || (free && info.id === 'writer')) {
      // the writer walks with its nose in a book
      R(g, S, X(2, 4), by + 2, 4, 1)
      R(g, C.blue, X(4, 5), by - 2, 5, 4)
      R(g, C.paper, X(5, 3), by - 1, 3, 2)
    } else if (pose === 'cheer') armUp(1)
    else if (tool) {
      R(g, S, X(2, 5), by + 1, 5, 1)
      tool(T, t)
    } else if (o.tool && pose === 'sit' && info.id === 'main') {
      // the boss's stick: up, then down on the desk
      R(g, S, X(2, 5), by + 1, 5, 1)
      if (slow) {
        T(C.woodL, 6, 1, 7, 1)
        T(C.amber, 12, -1, 1, 1)
      } else for (let i = 0; i < 9; i++) T(C.woodL, 6 + ((i + 1) >> 1), 1 - i, 2, 1)
    } else {
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
  if (ty0 - by < 6) {
    // the cloud sits right over the head: one small bubble under it
    R(g, C.ink, cx - 2, by - 1, 4, 4)
    R(g, C.paper, cx - 1, by, 2, 2)
    return
  }
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
function cross(g: Px, x: number, y: number, c: string, n = 10) {
  for (let i = 0; i < n; i++) {
    R(g, c, x + i, y + i, 2, 2)
    R(g, c, x + n - 1 - i, y + i, 2, 2)
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
    tx(g, fit(label || 'THINKING', w - 22), cx + 11, y + 6, C.ink)
    for (let i = 0; i < 3; i++) R(g, i < n ? C.coralD : C.steel, cx + 11 + i * 5, y + 15, 3, 3)
  },
  search(g, x, y, w, h, a, label, sm) {
    if (!sm) tx(g, fit(label, w - 2), x, y, C.violetD)
    const top = sm ? y : y + 8
    const rows = sm ? 3 : 6
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
    if (!sm) tx(g, fit(label, w - 8), x + 3, ab + 1, C.ink)
    const rtop = sm ? y + 7 : y + 14
    const n = sm ? 1 : 3
    // the page loads a line at a time
    const shown = sm ? 2 : 1 + (Math.floor(a * 2.2) % 3)
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
      // an open book
      R(g, C.blueD, x + 2, y, 22, h)
      R(g, C.paper, x + 3, y + 1, 9, h - 2)
      R(g, C.paper, x + 14, y + 1, 9, h - 2)
      const sc = Math.floor(a * 3)
      for (let i = 0; i < 3; i++) {
        R(g, C.steelD, x + 4, y + 3 + i * 3, 7 - ((i + sc) % 3), 1)
        R(g, C.steelD, x + 15, y + 3 + i * 3, 7 - ((i + sc + 1) % 3), 1)
      }
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
      R(g, C.amber, x, y, w, h)
      tx(g, '?', x + (w >> 1) - 1, y + 3 - b, C.ink)
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
    // "Designer: palette check" names the helper, then its task
    const colon = label.indexOf(':')
    const who = colon > 0 ? label.slice(0, colon) : 'PRINT'
    const what = colon > 0 ? label.slice(colon + 1) : label
    R(g, C.blueD, x + 22, y + 2, w - 23, 19)
    tx(g, fit(who, w - 26), x + 24, y + 4, C.paper)
    tx(g, fit(what, w - 26), x + 24, y + 13, C.tealL)
  },
  talk(g, x, y, w, h, a, label, sm) {
    const n = 1 + (Math.floor(a * 3) % 3)
    for (let i = 0; i < n; i++) R(g, C.steelD, x + 2, y + (sm ? 1 + i * 3 : 9 + i * 4), w - 8 - ((i * 9) % 16), 2)
    if (!sm) tx(g, fit(label, w - 4), x + 2, y, C.violetD)
  },
  done(g, x, y, w, h, a, label, sm) {
    check(g, sm ? x + ((w - 12) >> 1) : x + 4, sm ? y : y + ((h - 11) >> 1), C.greenD)
    if (!sm) tx(g, fit(label, w - 22), x + 21, y + ((h - 5) >> 1), C.ink)
  },
  error(g, x, y, w, h, a, label, sm) {
    cross(g, sm ? x + ((w - 9) >> 1) : x + 4, sm ? y : y + ((h - 11) >> 1), C.red, sm ? 8 : 10)
    if (!sm) tx(g, fit(label, w - 22), x + 21, y + ((h - 5) >> 1), C.redD)
  },
}
BUB.mcp = BUB.web
BUB.spawn = BUB.blue
BUB.tool = BUB.run
/** The main agent with nothing to do while its helpers work: a mug of coffee, and how many are at it. */
const coffeeBreak: Bub = (g, x, y, _w, _h, a, label) => {
  const mx = x + 5
  const my = y + 12
  R(g, C.ink, mx, my, 10, 12)
  R(g, C.white, mx + 1, my + 1, 8, 10)
  R(g, '#6b4423', mx + 1, my + 1, 8, 2)
  R(g, C.steelL, mx + 7, my + 4, 2, 7)
  R(g, C.ink, mx + 10, my + 3, 3, 1)
  R(g, C.ink, mx + 12, my + 4, 1, 4)
  R(g, C.ink, mx + 10, my + 8, 3, 1)
  // the steam drifts
  const drift = Math.floor(a * 2.2) % 2
  for (let i = 0; i < 2; i++) {
    R(g, C.steel, mx + 2 + i * 4 + drift, my - 3, 1, 2)
    R(g, C.steel, mx + 3 + i * 4 - drift, my - 6, 1, 2)
    R(g, C.steelL, mx + 2 + i * 4 + drift, my - 9, 1, 2)
  }
  tx(g, 'COFFEE BREAK', x + 22, y + 7, C.ink)
  tx(g, label, x + 22, y + 16, C.coralD)
}

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
const PRINT_RISE = 23
const PARK_TIP = PLATE_Y - 1 - PRINT_RISE
const PARK_X = PRINTER.x + 11
const LCD = { x: PRINTER.x + 5, y: PLATE_Y + 6, w: 11, h: 3 }
const SHAFT_X = 245
export const ROOF_H = 14
const GROUND_DESKS = [
  { robot: 58, bubble: { x: 22, y: 48 } },
  { robot: 196, bubble: { x: 187, y: 54 } },
]
const UPPER_X = [20, 64, 108, 152, 196]
// The wall: the chat's sign up top, and under it a row of two plates of one make: the Employee
// of the Day right under the sign, and the tokens of the last week to its right.
const SIGN_CX = 128
const SIGN_Y = 9
const SIGN_H = 11
const PLATE_GAP = 6
const FRAME = { x: SIGN_CX - 42, y: 24, w: 84, h: 25 }
const BOARD = { x: FRAME.x + FRAME.w + PLATE_GAP, y: FRAME.y, w: 50, h: FRAME.h }
const WALL_SHADOW = '#2a4656'
// The recycling corner: a hatch in the floor drops onto a ladle of molten metal,
// which a pipe carries back to the printer.
const HOLE_X0 = 173
const HOLE_W = 12
const HOLE_X = HOLE_X0 + (HOLE_W >> 1)
const DELIVER_X = 162
const BRIEF_X = 92
const LADLE_TOP = 132 // the far edge of the ladle's rim
const MELT_Y = LADLE_TOP + 2 // the metal's surface, where a robot goes under
const JOINT_X = 157 // where the pipe is bolted to the ladle
// The cellar is dark from wall to wall. What shows in it is what the metal lights; daylight comes
// in only through the hatch, while it stands open.
const CELLAR = '#0b0812'
const HATCH_LEAD_MS = 400
// after a splash the hatch stays open until the joint has stopped weeping
const HATCH_HOLD_MS = 2100
// shut, the metal's glow takes this long to go
const AFTERGLOW_MS = 700
// the joint starts to weep this long before the splash: the robot is half under by then
const LEAK_LEAD_MS = 100
/** How long the joint weeps after a splash. */
export const LEAK_MS = 2000
/* ---------- a compaction ---------- */
/** One hop: a breath on the floor, up, down, and a breath again. */
export const HOP_CYCLE_MS = 800
/** A compaction is on show at least this long, however fast it went. */
export const SHED_MIN_MS = 4 * HOP_CYCLE_MS
/** One that never reports its end stops being shown after this. */
export const SHED_MAX_MS = 5 * 60_000
/** The bolts lie in their pile this long after the robot has sat back down. */
export const PILE_MS = 6000
/** A compaction as the picture shows it: the robot hops from `from` until `until`, and its pile is cleared by `gone`. */
export type Shed = { from: number; until: number; gone: number }
/**
 * When a robot is up and hopping for a compaction, and when its pile of bolts is cleared away;
 * null when there is nothing left of it to show. It hops for as long as the compaction runs.
 */
export function shedSpan(r: { compactingAt?: number; compactedAt?: number }, now: number): Shed | null {
  const from = r.compactingAt
  if (from === undefined) return null
  const over = r.compactedAt !== undefined && r.compactedAt >= from ? r.compactedAt : null
  const length = over === null ? SHED_MAX_MS : Math.min(Math.max(over - from, SHED_MIN_MS), SHED_MAX_MS)
  // it lands before it sits: the show ends on a whole hop
  const until = from + Math.ceil(length / HOP_CYCLE_MS) * HOP_CYCLE_MS
  const gone = until + PILE_MS
  return gone > now ? { from, until, gone } : null
}
// The recycling pipe: a riser under the printer, a rounded elbow, and a run to the vat.
const PIPE_X = 18 // the riser's left outline
const PIPE_Y = 153 // the run's top outline
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
  // the main agent has no desk of this kind
  if (seat < 0) return null
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
  return { x, y: fy - 6, floorY: fy, floor, monX: x + 10, monY: fy - 17, bubble: { x: Math.max(2, Math.min(W - 34, x - 20)), y: fy - 43 } }
}

/* ---------- the workplaces ---------- */
/*
 * Every workplace is put together from the same few parts, whoever sits at it: a seat on a steel
 * pedestal, a desk of a lit wooden top on one leg and a chest of two drawers, and a monitor in a
 * dark case. The main agent's are the same parts made larger, with a back to its chair. Brass is
 * kept for what a hand takes hold of.
 */
const BRASS = '#f3d57a'
const LEATHER = '#8a3340'
const LEATHER_L = '#b85562'

/** What a seat stands on: a steel pedestal on a foot. `top` is the seat's upper row; the foot rests on the floor two rows under the seat. */
function pedestal(g: Px, x: number, top: number, reach: number) {
  R(g, C.ink, x - 1, top + 3, 2, 1)
  R(g, C.ink, x - reach, top + 4, reach * 2, 1)
  R(g, C.steelD, x - reach, top + 4, 1, 1)
  R(g, C.steelD, x + reach - 1, top + 4, 1, 1)
}

/**
 * A helper's chair, seen from the side: a wooden seat with a low back. The seat's top is the row
 * under a seated robot (fy - 5), so the robot's body rests right on it; `w` matches the robot's width.
 */
function chair(g: Px, x: number, fy: number, w: number) {
  const x0 = x - (w >> 1)
  const top = fy - 5
  // the back, as high as a seated robot's shoulders
  R(g, C.ink, x0 - 2, top - 7, 3, 8)
  R(g, C.wood, x0 - 1, top - 6, 1, 6)
  R(g, C.woodL, x0 - 1, top - 6, 1, 1)
  R(g, C.ink, x0, top, w, 3)
  R(g, C.woodL, x0 + 1, top, w - 2, 1)
  R(g, C.wood, x0 + 1, top + 1, w - 2, 1)
  pedestal(g, x, top, 4)
}

/** The main agent's chair: the same seat in leather, with a high buttoned back. */
function bossChair(g: Px, x: number, fy: number) {
  const top = fy - 5
  // the back, up to the top of the head
  R(g, C.ink, x - 9, top - 14, 3, 1)
  R(g, C.ink, x - 10, top - 13, 5, 14)
  R(g, LEATHER, x - 9, top - 13, 3, 13)
  R(g, LEATHER_L, x - 9, top - 13, 1, 13)
  for (let j = top - 11; j < top - 1; j += 4) R(g, BRASS, x - 8, j, 1, 1)
  R(g, C.ink, x - 7, top, 13, 3)
  R(g, LEATHER_L, x - 6, top, 11, 1)
  R(g, LEATHER, x - 6, top + 1, 11, 1)
  pedestal(g, x, top, 5)
}

/** A desk from x0 to x1 on a floor at fy: a lit top, a leg at its near end, and a chest of two drawers `chest` wide at the far one. */
function desk(g: Px, x0: number, x1: number, fy: number, chest: number) {
  const w = x1 - x0 + 1
  R(g, C.ink, x0, fy - 9, w, 3)
  R(g, C.woodL, x0 + 1, fy - 9, w - 2, 1)
  R(g, C.wood, x0 + 1, fy - 8, w - 2, 1)
  R(g, C.ink, x0 + 2, fy - 6, 2, 6)
  // the chest: each drawer has a lit upper edge and a brass pull
  const cx = x1 - 1 - chest
  R(g, C.ink, cx, fy - 6, chest + 1, 6)
  for (const y of [fy - 6, fy - 3]) {
    R(g, C.wood, cx + 1, y, chest - 1, 1)
    R(g, C.woodD, cx + 1, y + 1, chest - 1, 1)
    const pull = chest > 8 ? 4 : 2
    R(g, BRASS, cx + 1 + ((chest - 1 - pull) >> 1), y + 1, pull, 1)
  }
}

/** A monitor's case w by h with its neck, standing on a desk; the screen inside it is drawn live. */
function monitor(g: Px, x: number, y: number, w: number, h: number) {
  R(g, C.ink, x, y, w, h)
  R(g, C.panel, x + 1, y + 1, w - 2, h - 2)
  R(g, C.panel2, x + 1, y + 1, w - 2, 1)
  R(g, C.scr, x + 2, y + 2, w - 4, h - 4)
  const neck = w > 16 ? 5 : 3
  R(g, C.ink, x + ((w - neck) >> 1), y + h, neck, w > 16 ? 2 : 1)
}

/** A keyboard w wide, lying on a desk whose lit top is the row under it. */
function keyboard(g: Px, x: number, y: number, w: number) {
  R(g, C.ink, x, y, w, 2)
  R(g, C.steelL, x + 1, y, w - 2, 1)
}

// The main agent's desk and the monitor on it, in ground coordinates.
const MAIN_DESK = { x0: 115, x1: 159 }
const MAIN_MON = { x: 131, y: 86, w: 28, h: 19 }
const MAIN_SCREEN = { x: MAIN_MON.x + 2, y: MAIN_MON.y + 2, w: 19, h: MAIN_MON.h - 4 }
// The context gauge's column, in a bay of the monitor's case beside the screen: a row for each row of the screen.
const GAUGE = { x: MAIN_SCREEN.x + MAIN_SCREEN.w + 1, y: MAIN_SCREEN.y, w: 4 }
export const GAUGE_ROWS = MAIN_SCREEN.h

/** A workstation for a robot sitting at x: chair, desk, monitor, keyboard. */
function workstation(g: Px, x: number, fy: number) {
  chair(g, x, fy, 10)
  desk(g, x + 3, x + 22, fy, 7)
  monitor(g, x + 8, fy - 19, 11, 9)
  keyboard(g, x + 3, fy - 11, 5)
}

/**
 * The kit each role keeps on top of its monitor while it sits there. It stands on the bottom row
 * of a canvas twelve pixels wide.
 */
export const KIT = { w: 12, h: 9 }
export function deskProp(g: Px, roleId: string) {
  const I = C.ink
  const b = KIT.h - 1
  switch (roleId) {
    case 'designer': // a painter's palette with dabs of paint and a thumb hole
      R(g, I, 1, b - 5, 9, 6)
      R(g, I, 0, b - 4, 11, 4)
      R(g, C.cream, 1, b - 4, 9, 4)
      R(g, C.red, 2, b - 4, 2, 1)
      R(g, C.yellow, 5, b - 4, 2, 1)
      R(g, C.teal, 8, b - 3, 1, 2)
      R(g, C.blue, 2, b - 2, 2, 1)
      R(g, I, 5, b - 2, 2, 1)
      return
    case 'architect': // a scale model of a house
      R(g, I, 4, b - 6, 3, 1)
      R(g, I, 3, b - 5, 5, 1)
      R(g, C.blue, 4, b - 5, 3, 1)
      R(g, I, 2, b - 4, 7, 1)
      R(g, C.blue, 3, b - 4, 5, 1)
      R(g, I, 1, b - 3, 9, 1)
      R(g, I, 2, b - 2, 7, 3)
      R(g, C.paper, 3, b - 2, 5, 2)
      R(g, C.woodD, 5, b - 2, 1, 2)
      return
    case 'coder': // a rubber duck to explain the bug to
      R(g, I, 4, b - 6, 5, 4)
      R(g, I, 1, b - 4, 8, 5)
      R(g, C.yellow, 5, b - 5, 3, 2)
      R(g, C.yellow, 2, b - 3, 6, 3)
      R(g, '#fff3a8', 2, b - 3, 3, 1)
      R(g, '#ff8a2a', 8, b - 4, 2, 1)
      R(g, I, 6, b - 5, 1, 1)
      return
    case 'tester': // a flask of something green
      R(g, I, 4, b - 6, 4, 3)
      R(g, C.page, 5, b - 5, 2, 2)
      R(g, I, 3, b - 3, 6, 1)
      R(g, C.page, 4, b - 3, 4, 1)
      R(g, I, 2, b - 2, 8, 3)
      R(g, '#a8cc3c', 3, b - 2, 6, 2)
      R(g, '#dcf59a', 3, b - 2, 6, 1)
      R(g, C.white, 5, b - 1, 1, 1)
      return
    case 'reviewer': // a clipboard with a red tick on it
      R(g, I, 2, b - 6, 8, 7)
      R(g, C.paper, 3, b - 5, 6, 5)
      R(g, C.steelL, 5, b - 7, 2, 2)
      R(g, C.red, 4, b - 3, 1, 1)
      R(g, C.red, 5, b - 2, 1, 1)
      R(g, C.red, 6, b - 3, 1, 1)
      R(g, C.red, 7, b - 4, 1, 1)
      return
    case 'explorer': // a desk globe
      disc(g, I, 5, b - 4, 3)
      disc(g, '#3f8fc4', 5, b - 4, 2)
      R(g, C.green, 4, b - 5, 2, 1)
      R(g, C.green, 4, b - 4, 1, 1)
      R(g, C.green, 6, b - 3, 1, 1)
      R(g, I, 3, b, 5, 1)
      return
    case 'writer': // a typewriter with a page in it
      R(g, I, 0, b - 5, 11, 3)
      R(g, C.steelL, 1, b - 4, 9, 1)
      R(g, I, 2, b - 8, 7, 5)
      R(g, C.paper, 3, b - 7, 5, 4)
      R(g, C.steelD, 4, b - 6, 3, 1)
      R(g, C.steelD, 4, b - 4, 2, 1)
      R(g, I, 1, b - 2, 9, 3)
      R(g, '#4a5170', 2, b - 2, 7, 2)
      R(g, C.cream, 3, b - 1, 5, 1)
      return
    default: // a toolbox
      R(g, I, 4, b - 6, 4, 1)
      R(g, I, 4, b - 5, 1, 1)
      R(g, I, 7, b - 5, 1, 1)
      R(g, I, 1, b - 4, 10, 5)
      R(g, C.red, 2, b - 3, 8, 3)
      R(g, C.redD, 2, b - 1, 8, 1)
      R(g, C.amber, 5, b - 3, 2, 2)
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

/* ---------- the way out ---------- */
/** Lettering turned on its side, to be read downward: each letter's head is to the right. What comes back is the row after the last. */
function txDown(g: Px, s: string, x: number, y: number, c: string) {
  for (const ch of s.toUpperCase()) {
    const r = glyph(ch)
    for (let j = 0; j < 5; j++) {
      const row = r[j]!
      for (let i = 0; i < row.length; i++) if (row[i] === '1') R(g, c, x + 4 - j, y + i, 1, 1)
    }
    y += r[0]!.length + 1
  }
  return y - 1
}

/**
 * Over the recycling hatch hangs the sign of what it is for: an amber arrow pointing straight
 * down at it, lettered OFFBOARDING down its length. The head is as wide as the hatch.
 */
function wayOut(g: Px) {
  const name = 'OFFBOARDING'
  const cx = HOLE_X
  const head = HOLE_W >> 1
  const tip = FY - 4
  const neck = tip - head // the row where the head is widest
  const top = neck - 3 - tw(name) - 2
  const shape = (c: string, fill: string, dx: number, dy: number) => {
    R(g, c, cx - 4 + dx, top + dy, 9, neck - top)
    R(g, fill, cx - 3 + dx, top + 1 + dy, 7, neck - top - 1)
    R(g, c, cx - head + dx, neck - 1 + dy, head * 2 + 1, 1)
    R(g, fill, cx - 3 + dx, neck - 1 + dy, 7, 1)
    for (let k = 0; k <= head; k++) {
      R(g, c, cx - head + k + dx, neck + k + dy, (head - k) * 2 + 1, 1)
      if (k < head) R(g, fill, cx - head + k + 1 + dx, neck + k + dy, (head - k) * 2 - 1, 1)
    }
  }
  shape(WALL_SHADOW, WALL_SHADOW, 1, 1)
  shape(C.ink, C.amber, 0, 0)
  txDown(g, name, cx - 2, top + 2, C.ink)
}

/* ---------- the plates on the wall ---------- */
/*
 * What the office shows of itself is all made one way. A plate is a board of the sign's own wood
 * with its name across the head in the sign's own lettering, and a dark face let into it, the
 * same glass as every monitor's. On a face cream is what is read first, steel is what goes with
 * it, teal is a quantity, amber is today's, and red is what must be minded.
 */
type Rect = { x: number; y: number; w: number; h: number }
const HEAD_H = 8 // a lit row, a row clear, five of lettering, a row clear

/** A plate w by h with its name on its head; what comes back is its face, to be drawn on. */
function plate(g: Px, x: number, y: number, w: number, h: number, name: string): Rect {
  R(g, WALL_SHADOW, x + 1, y + 1, w, h)
  R(g, C.ink, x, y, w, h)
  R(g, C.woodD, x + 1, y + 1, w - 2, h - 2)
  R(g, C.wood, x + 1, y + 1, w - 2, 1)
  tx(g, name, x + ((w - tw(name)) >> 1), y + 3, C.cream)
  // a brass pin at each end of the head
  R(g, BRASS, x + 2, y + 5, 1, 1)
  R(g, BRASS, x + w - 3, y + 5, 1, 1)
  const face = { x: x + 2, y: y + 1 + HEAD_H, w: w - 4, h: h - HEAD_H - 3 }
  R(g, C.scr, face.x, face.y, face.w, face.h)
  return face
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
  R(g, C.slate, 0, 6, W, 98)
  for (let x = 4; x < W; x += 8) R(g, C.slateL, x, 8, 1, 94)
  R(g, '#243a4a', 0, 6, W, 2)
  R(g, C.slateD, 0, 104, W, 12)
  R(g, C.ink, 0, 103, W, 1)
  R(g, C.woodD, 0, 0, W, 5)
  R(g, C.wood, 0, 4, W, 1)
  R(g, C.ink, 0, 5, W, 1)
  // the chat's sign; the plates under it are drawn live
  sign(g, fit(home || 'OFFICE', 96), C.woodD, C.cream, C.wood)
  // the main agent's workplace: the helpers' own parts, made larger
  desk(g, MAIN_DESK.x0, MAIN_DESK.x1, FY, 17)
  monitor(g, MAIN_MON.x, MAIN_MON.y, MAIN_MON.w, MAIN_MON.h)
  // the gauge's bay: a bar of the case between the screen and it, and the marks of its scale on the case beside it
  R(g, C.panel, GAUGE.x - 1, MAIN_SCREEN.y, 1, MAIN_SCREEN.h)
  for (let k = 0; k < GAUGE_ROWS; k++) {
    const z = gaugeZone(k)
    if (z > 0) R(g, GAUGE_LIT[z]!, GAUGE.x + GAUGE.w, GAUGE.y + GAUGE_ROWS - 1 - k, 1, 1)
    else if (k % 4 === 3) R(g, C.steelD, GAUGE.x + GAUGE.w, GAUGE.y + GAUGE_ROWS - 1 - k, 1, 1)
  }
  keyboard(g, 117, FY - 11, 13)
  bossChair(g, MAIN_X, FY)
  wayOut(g)
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
  basement(g)
  shaft(g, 0, FY, FY, 1)
  return g
}

/**
 * Employee of the Day: the plate under the chat's sign, with the portrait of whichever robot has
 * used the most tokens today, what it is, and how many it has used.
 */
function employeePlate(tally: TokenTally | undefined, now: number, detail: Detail): string {
  const { w, h } = FRAME
  const g = new Px(w + 1, h + 1)
  const f = plate(g, 0, 0, w, h, 'EMPLOYEE OF THE DAY')
  // the portrait, in a well of its own
  const well = { x: f.x + 1, y: f.y + 1, s: f.h - 2 }
  R(g, C.panel, well.x, well.y, well.s, well.s)
  const best = champion(tally, now)
  const face = new Px(well.s, well.s)
  if (best) bot(face, well.s >> 1, 19, { role: roleInfo(best.role).id, small: true, view: 'front', pose: 'stand', eyes: 'happy' })
  else tx(face, '?', (well.s >> 1) - 1, (well.s >> 1) - 2, C.steelD)
  // who it is, then its tokens; before anyone has earned it, the plate says so
  const x0 = well.x + well.s + 3
  if (best) {
    tx(g, fit(roleInfo(best.role).title, f.x + f.w - x0 - 10), x0, f.y + 1, C.cream)
    const end = tx(g, formatTokens(best.tokens), x0, f.y + 8, C.amber)
    tx(g, 'TOKENS', end + 2, f.y + 8, C.steelD)
  } else {
    tx(g, 'NO ONE YET', x0, f.y + 1, C.steel)
    tx(g, '0 TOKENS', x0, f.y + 8, C.steelD)
  }
  // a medal at the end of the plate, with a glint that crosses it now and then
  const medal = sprite(5, 9, [0, 1.6], [1.6, 0.3], detail, (sg, t) => {
    R(sg, C.red, 1, 0, 1, 3)
    R(sg, C.blue, 3, 0, 1, 3)
    R(sg, C.amber, 1, 3, 3, 1)
    R(sg, C.amber, 0, 4, 5, 3)
    R(sg, C.amber, 1, 7, 3, 1)
    R(sg, t > 0 ? C.white : BRASS, 1, 4, 2, 2)
  })
  return `<g data-what="plate">${at(FRAME.x, FRAME.y, g.svg() + at(well.x, well.y, face.svg()) + (best ? at(f.x + f.w - 8, f.y + 2, medal) : ''))}</g>`
}

/* ---------- the cellar ---------- */
/*
 * Under the floor it is dark: with the hatch shut, nothing down there can be seen. What there is
 * (a back wall of stone, the ladle of molten metal slung between its posts, and the pipe that
 * takes the metal back to the printer) is drawn in three lights and shown only where that light
 * falls: in the light that drops through the open hatch, in the spill beside it, and by the glow
 * of the metal itself. Each light is flat: a thing is in it or it is not.
 */
type CellarLight = { wall: string; joint: string; floor: string; out: string; body: string; lit: string; shade: string; pipe: string; pipeLit: string }
const IN_LIGHT: CellarLight = { wall: '#5b5876', joint: '#474461', floor: '#3f3c56', out: C.ink, body: '#7d83a8', lit: '#c5cae3', shade: '#4d5173', pipe: C.steelD, pipeLit: C.steelL }
const IN_SPILL: CellarLight = { wall: '#2a2740', joint: '#201d34', floor: '#1b1929', out: '#05040a', body: '#3a3c5c', lit: '#5a5d84', shade: '#25263c', pipe: '#2b2c46', pipeLit: '#474a6c' }
const IN_GLOW: CellarLight = { wall: '#3d2420', joint: '#2c1917', floor: '#26130f', out: '#0d0605', body: '#5e3526', lit: '#bd6a3c', shade: '#341a10', pipe: '#4f2c1f', pipeLit: '#b05f33' }

/** A solid shape from a half-width per row, with a one-pixel outline round it. */
function solid(g: Px, cx: number, y0: number, hws: number[], fill: string, out: string) {
  hws.forEach((hw, i) => {
    R(g, out, cx - hw, y0 + i - 1, hw * 2 + 1, 1)
    R(g, out, cx - hw, y0 + i + 1, hw * 2 + 1, 1)
    R(g, out, cx - hw - 1, y0 + i, hw * 2 + 3, 1)
  })
  hws.forEach((hw, i) => R(g, fill, cx - hw, y0 + i, hw * 2 + 1, 1))
}

/** The metal's surface in the ladle's mouth, seen a little from above; `k` moves the light on it. */
function meltSurface(g: Px, cx: number, y: number, rx: number, k = 0) {
  const far = Math.round(rx * 0.86)
  R(g, '#ffb347', cx - far, y - 1, far * 2 + 1, 1)
  R(g, '#fff1a8', cx - rx, y, rx * 2 + 1, 1)
  R(g, '#ff8a2a', cx - far, y + 1, far * 2 + 1, 1)
  R(g, '#ffd166', cx - 11 + k * 4, y - 1, 3, 1)
  R(g, '#ffd166', cx + 6 - k * 3, y + 1, 4, 1)
}

/** The ladle: a tapered, hooped bucket slung between two posts, brim-full of molten metal. */
function ladle(g: Px, l: CellarLight) {
  const cx = HOLE_X
  const { out, body, lit, shade } = l
  const top = LADLE_TOP + 5
  // the cradle's posts, behind it
  for (const px of [cx - 27, cx + 25]) {
    R(g, out, px - 1, 146, 5, 21)
    R(g, shade, px, 147, 3, 19)
    R(g, out, px - 4, 164, 11, 4)
    R(g, body, px - 3, 165, 9, 2)
  }
  const hws: number[] = []
  for (let y = top; y <= 163; y++) hws.push(Math.round(23 - (y - top) * 0.24) - (y === 163 ? 3 : y === 162 ? 1 : 0))
  solid(g, cx, top, hws, body, out)
  hws.forEach((hw, i) => {
    R(g, lit, cx - hw, top + i, 2, 1)
    R(g, shade, cx + hw - 3, top + i, 4, 1)
  })
  // two hoops, riveted
  for (const hy of [143, 154]) {
    const hw = hws[hy - top]!
    R(g, lit, cx - hw, hy, hw * 2 + 1, 1)
    R(g, out, cx - hw, hy + 1, hw * 2 + 1, 1)
    for (let x = cx - hw + 3; x < cx + hw; x += 6) R(g, shade, x, hy, 1, 1)
  }
  // the rim, the pouring lip and the metal
  solid(g, cx, LADLE_TOP, [23, 24, 24, 24, 24], body, out)
  R(g, lit, cx - 23, LADLE_TOP, 47, 1)
  R(g, out, cx + 24, LADLE_TOP - 2, 6, 5)
  R(g, lit, cx + 25, LADLE_TOP - 1, 4, 2)
  meltSurface(g, cx, MELT_Y, 21)
  R(g, lit, cx - 24, LADLE_TOP + 4, 49, 1)
  // the trunnions it hangs by
  for (const tx0 of [cx - 26, cx + 26]) {
    disc(g, out, tx0, 148, 4)
    disc(g, lit, tx0, 148, 3)
    R(g, out, tx0, 148, 1, 1)
  }
}

/**
 * The elbow where the pipe turns from the run up into the riser: a quarter ring with outlines on
 * both edges. Its highlight slides from the riser's lit left wall to the run's lit top wall, so
 * light and bore stay continuous through the turn.
 */
function elbow(g: Px, l: CellarLight) {
  const inner = BEND_R - PIPE_W
  for (let y = BEND_CY; y < PIPE_Y + PIPE_W; y++) {
    for (let x = PIPE_X; x < BEND_CX; x++) {
      const dx = BEND_CX - (x + 0.5)
      const dy = y + 0.5 - BEND_CY
      const d = Math.hypot(dx, dy)
      if (d < inner || d >= BEND_R) continue
      const lit = (BEND_R - 1.5) + ((inner + 1.5) - (BEND_R - 1.5)) * (Math.atan2(dy, dx) / (Math.PI / 2))
      const c = d >= BEND_R - 1 || d < inner + 1 ? l.out : Math.abs(d - lit) < 0.6 ? l.pipeLit : l.pipe
      R(g, c, x, y, 1, 1)
    }
  }
  // collars where the bend meets the straight runs
  R(g, l.out, PIPE_X - 1, BEND_CY - 2, PIPE_W + 2, 2)
  R(g, l.pipeLit, PIPE_X, BEND_CY - 2, PIPE_W, 1)
  R(g, l.out, BEND_CX, PIPE_Y - 1, 2, PIPE_W + 2)
  R(g, l.pipeLit, BEND_CX, PIPE_Y, 1, PIPE_W)
}

/** Everything in the cellar as one of its lights shows it, in ground coordinates; shown through a clip, never whole. */
function cellarSvg(light: 'light' | 'spill' | 'glow'): string {
  return cached(`cellar:${light}`, () => {
    const l = light === 'light' ? IN_LIGHT : light === 'spill' ? IN_SPILL : IN_GLOW
    const g = new Px(W, GROUND_H)
    const top = FY + 7
    const floor = GROUND_H - 4
    // the back wall, in courses of stone
    const joints = new Px(W, GROUND_H)
    for (let k = 0; top + k * 7 < floor; k++) {
      const y0 = top + k * 7
      const y1 = Math.min(y0 + 6, floor)
      if (y1 < floor) R(joints, l.joint, 0, y1, W, 1)
      for (let x = k % 2 ? 17 : 4; x < W; x += 26) R(joints, l.joint, x, y0, 1, y1 - y0)
    }
    const wall = `<rect x="0" y="${top}" width="${W}" height="${floor - top}" fill="${l.wall}"/>${joints.svg()}`
    R(g, l.floor, 0, floor, W, 2)
    R(g, l.out, 0, floor + 2, W, 2)
    // the pipe that carries the metal back to the printer: riser, elbow, run, with seams that glow
    R(g, l.out, PIPE_X, top, PIPE_W, BEND_CY - top)
    R(g, l.pipe, PIPE_X + 1, top, PIPE_W - 2, BEND_CY - top)
    R(g, l.pipeLit, PIPE_X + 1, top, 1, BEND_CY - top)
    R(g, l.out, BEND_CX, PIPE_Y, JOINT_X - BEND_CX, PIPE_W)
    R(g, l.pipe, BEND_CX, PIPE_Y + 1, JOINT_X - BEND_CX, PIPE_W - 2)
    R(g, l.pipeLit, BEND_CX, PIPE_Y + 1, JOINT_X - BEND_CX, 1)
    elbow(g, l)
    for (let x = 46; x < JOINT_X - 20; x += 28) {
      R(g, l.out, x, PIPE_Y - 1, 3, PIPE_W + 2)
      R(g, '#ff9a3c', x + 1, PIPE_Y + 1, 1, 4)
    }
    ladle(g, l)
    // the joint that bolts the pipe to the ladle
    R(g, l.out, JOINT_X, PIPE_Y - 3, 4, PIPE_W + 6)
    R(g, l.pipe, JOINT_X + 1, PIPE_Y - 2, 3, PIPE_W + 4)
    R(g, l.pipeLit, JOINT_X + 1, PIPE_Y - 2, 1, PIPE_W + 4)
    return `<g data-what="cellar">${wall}${g.svg()}</g>`
  })
}

/** Under the ground floor with the hatch shut: darkness. */
function basement(g: Px) {
  const top = FY + 7
  const bottom = GROUND_H
  R(g, CELLAR, 0, top, W, bottom - top)
  // the hatch in the floor, closed
  R(g, C.ink, HOLE_X0 - 1, FY, HOLE_W + 2, 3)
  R(g, '#4a4f70', HOLE_X0, FY + 1, HOLE_W, 1)
  R(g, C.amber, HOLE_X0, FY, 2, 1)
  R(g, C.amber, HOLE_X0 + HOLE_W - 2, FY, 2, 1)
}

/** The metal is never still: light runs across it, and now and then a bubble comes up. */
function meltLife(detail: Detail): string {
  return sprite(47, 6, [0, 0.5, 1, 1.5], [0.5, 0.5, 0.5, 0.5], detail, (g, t) => {
    const k = Math.round(t / 0.5)
    meltSurface(g, 23, 4, 21, k)
    if (k === 2) R(g, '#fff1a8', 31, 3, 2, 1)
    if (k === 3) R(g, '#ffd166', 31, 1, 2, 2)
  })
}

const points = (list: Array<[number, number]>) => list.map(([x, y]) => `${x},${y}`).join(' ')

/**
 * The hatch, from the moment it opens for a robot until the cellar is dark again, in ground
 * coordinates. Its two leaves swing down in three steps and a shaft of light drops with them:
 * a sliver, then half, then the whole of it. In the shaft the wall, the ladle and the metal stand
 * in full light with dust turning in it; beside the shaft is the spill, where the rest of the
 * ladle and the first of the pipe can be made out; beyond that nothing. The splash throws a glow
 * of its own much wider for an instant, far enough to show the pipe leading away. Shut again, the
 * metal's glow is the last thing to go.
 */
function hatchSvg(tag: string, open: number, shut: number, splashes: number[], sec: (t: number) => number, detail: Detail): string {
  if (sec(shut + AFTERGLOW_MS) <= 0) return ''
  const cellarTop = FY + 7
  const floor = GROUND_H - 2
  const light = once(cellarSvg('light'))
  const spill = once(cellarSvg('spill'))
  const glow = once(cellarSvg('glow'))
  const melt = detail >= 2 ? '' : at(HOLE_X - 23, MELT_Y - 4, meltLife(detail))
  // dust turning in the shaft
  const motes = sprite(W, GROUND_H, [0, 0.35, 0.7], [0.35, 0.35, 0.35], detail, (g, t) => {
    const k = Math.round(t / 0.35)
    for (const [mx, my] of [[176, 127], [183, 139], [172, 148], [186, 156], [179, 161], [181, 131]] as const) R(g, '#fff6df', mx + ((my + k) % 3) - 1, my + k, 1, 1)
  })
  // how far the leaves have swung: the gap between them, the shaft, and the spill beside it
  const steps = [
    { gap: 1, beam: [1, 1], spill: null },
    { gap: 3, beam: [3, 7], spill: [5, 17, 24] },
    { gap: 6, beam: [6, 14], spill: [9, 34, 46] },
  ] as const
  const stage = (k: 0 | 1 | 2): string => {
    const s = steps[k]
    const id = `${tag}${k}`
    const beam = points([[HOLE_X - s.beam[0], cellarTop], [HOLE_X + s.beam[0], cellarTop], [HOLE_X + s.beam[1], floor], [HOLE_X - s.beam[1], floor]])
    let out = `<clipPath id="beam-${id}"><polygon points="${beam}"/></clipPath>`
    if (s.spill) {
      const [st, sm, sb] = s.spill
      const pool = points([[HOLE_X - st, cellarTop], [HOLE_X + st, cellarTop], [HOLE_X + sm, 138], [HOLE_X + sb, floor], [HOLE_X - sb, floor], [HOLE_X - sm, 138]])
      out += `<clipPath id="spill-${id}"><polygon points="${pool}"/></clipPath><g clip-path="url(#spill-${id})">${spill}${melt}</g>`
      // round its mouth the ladle is lit by its own metal
      out += `<clipPath id="halo-${id}"><ellipse cx="${HOLE_X}" cy="${MELT_Y + 1}" rx="${k === 2 ? 29 : 20}" ry="${k === 2 ? 7 : 5}"/></clipPath><g clip-path="url(#halo-${id})">${glow}${melt}</g>`
    }
    out += `<g data-what="rays" clip-path="url(#beam-${id})">${light}${melt}${k === 2 ? motes : ''}</g>`
    // the floor, cut through: the light in the gap, and the leaves
    const g = new Px(W, GROUND_H)
    if (k === 0) {
      R(g, IN_LIGHT.wall, HOLE_X - 1, FY, 2, 7)
    } else {
      R(g, C.ink, HOLE_X0 - 1, FY, HOLE_W + 2, 7)
      R(g, '#141021', HOLE_X0, FY, HOLE_W, 7)
      R(g, IN_LIGHT.wall, HOLE_X - s.gap, FY, s.gap * 2, 7)
      const leaf = '#4a4f70'
      if (k === 1) {
        thick(g, C.ink, HOLE_X0, FY + 1, HOLE_X0 + 3, FY + 6, 2)
        thick(g, leaf, HOLE_X0, FY + 1, HOLE_X0 + 3, FY + 6, 1)
        thick(g, C.ink, HOLE_X0 + HOLE_W - 1, FY + 1, HOLE_X0 + HOLE_W - 4, FY + 6, 2)
        thick(g, leaf, HOLE_X0 + HOLE_W - 1, FY + 1, HOLE_X0 + HOLE_W - 4, FY + 6, 1)
      } else {
        for (const lx of [HOLE_X0 - 1, HOLE_X0 + HOLE_W - 1]) {
          R(g, C.ink, lx - 1, FY + 6, 3, 9)
          R(g, leaf, lx, FY + 7, 1, 7)
          R(g, C.amber, lx, FY + 12, 1, 2)
        }
      }
    }
    return out + g.svg()
  }
  const SWING = 80
  let out = ''
  // the splash: for an instant the metal lights the cellar far and wide
  const flash = (name: string, rx: number, ry: number, from: number, until: number) => {
    const id = `flash-${tag}${name}`
    out += during(sec(from), sec(until), `<clipPath id="${id}"><ellipse cx="${HOLE_X}" cy="146" rx="${rx}" ry="${ry}"/></clipPath><g clip-path="url(#${id})">${glow}</g>`)
  }
  splashes.forEach((splash, n) => {
    flash(`a${n}`, 90, 62, splash, splash + 110)
    flash(`b${n}`, 60, 44, splash + 110, splash + 240)
  })
  out += during(sec(open), sec(open + SWING), stage(0))
  out += during(sec(open + SWING), sec(open + 2 * SWING), stage(1))
  out += during(sec(open + 2 * SWING), sec(shut - 2 * SWING), stage(2))
  out += during(sec(shut - 2 * SWING), sec(shut - SWING), stage(1))
  out += during(sec(shut - SWING), sec(shut), stage(0))
  // each robot that goes under shakes the joint where the pipe meets the ladle: it weeps while there is light to see it by
  for (const splash of splashes) out += leakSvg(splash - LEAK_LEAD_MS, sec, detail)
  // shut: a puff of dust at the floor, and the metal's glow, which goes last
  const dust = sprite(W, GROUND_H, [0, 0.15], [0.15, 0.15], detail, (g, t) => {
    const k = t > 0 ? 1 : 0
    for (const [dx, dir] of [[HOLE_X0 - 3, -1], [HOLE_X0 + HOLE_W + 1, 1]] as const) {
      R(g, C.steelL, dx + dir * k * 2, FY - 2 - k, 2, 1)
      R(g, C.steel, dx + dir * (2 + k * 2), FY - 1 - k * 2, 1, 1)
    }
  })
  out += during(sec(shut), sec(shut + 300), dust)
  const after = `after-${tag}`
  out += during(sec(shut), sec(shut + 320), `<clipPath id="${after}"><ellipse cx="${HOLE_X}" cy="${MELT_Y + 2}" rx="30" ry="9"/></clipPath><g clip-path="url(#${after})">${glow}${melt}</g>`)
  const ember = new Px(W, GROUND_H)
  R(ember, '#7a2f12', HOLE_X - 19, MELT_Y, 39, 1)
  R(ember, '#c2571d', HOLE_X - 14, MELT_Y, 29, 1)
  out += during(sec(shut + 320), sec(shut + AFTERGLOW_MS), ember.svg())
  return out
}

/** The pipe's centre line, from inside the ladle through the joint, round the elbow and up into the printer. */
function feedPath(): Pt[] {
  const mid = PIPE_Y + PIPE_W / 2
  const midR = BEND_R - PIPE_W / 2
  const pts: Pt[] = [[JOINT_X + 6, mid], [JOINT_X, mid]]
  for (let i = 0; i <= 6; i++) {
    const a = (Math.PI / 2) * (1 - i / 6)
    pts.push([BEND_CX - Math.cos(a) * midR, BEND_CY + Math.sin(a) * midR])
  }
  pts.push([PIPE_X + PIPE_W / 2, FY + 2])
  return pts
}

/**
 * A slug of molten metal drawn out of the ladle and along the pipe to the printer, in ground
 * coordinates. It travels in the dark, and it is its own light: the pipe and the wall show by its
 * glow in a small round patch that moves along with it, and the pipe swells where it passes.
 */
function feedSvg(tag: string, spawnedAt: number, feedEnd: number, sec: (t: number) => number, detail: Detail): string {
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
  const begin = s2(sec(spawnedAt))
  const dur = s2((feedEnd - spawnedAt) / 1000)
  const along = (dx: number, dy: number, sign = 1) =>
    `<animateTransform attributeName="transform" type="translate" values="${pts.map(([x, y]) => `${s2(sign * (x + dx))} ${s2(sign * (y + dy))}`).join(';')}" keyTimes="${keys}" calcMode="linear" begin="${begin}s" dur="${dur}s" fill="freeze"/>`
  const [x0, y0] = pts[0]!
  const id = `glow-${tag}`
  // what its glow shows goes with it: a round window that travels, over a cellar that stays where it is
  const patch =
    `<clipPath id="${id}"><circle r="11"/></clipPath>` +
    `<g clip-path="url(#${id})" transform="translate(${s2(x0)} ${s2(y0)})">${along(0, 0)}<g transform="translate(${s2(-x0)} ${s2(-y0)})">${along(0, 0, -1)}${once(cellarSvg('glow'))}</g></g>`
  const moving = `<g transform="translate(${s2(x0 - 5)} ${s2(y0 - 5)})">${along(-5, -5)}${bubble.svg()}</g>`
  // it goes up through the cellar's ceiling into the printer: above the ceiling it is out of sight
  const under = `<clipPath id="under-${tag}"><rect x="0" y="${FY + 7}" width="${W}" height="${GROUND_H - FY - 7}"/></clipPath>`
  return `<g data-what="feed">${during(sec(spawnedAt), sec(feedEnd), `${patch}${under}<g clip-path="url(#under-${tag})">${moving}</g>`)}</g>`
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

/** How much the drawing may animate: 0 full, 1 single frames, 2 also no subagent clouds, 3 also bare desks. */
type Detail = 0 | 1 | 2 | 3

/* The moment the picture being drawn starts at. Loops are timed from the clock, not from the picture, so a new picture carries them on where the old one was. */
let loopAt = 0

/** Frames that take turns, each shown for its own number of seconds, looping. */
function cycle(frames: string[], durs: number[]): string {
  if (frames.length === 1) return frames[0]!
  const total = durs.reduce((a, b) => a + b, 0)
  const begin = s2(-(loopAt % Math.max(1, Math.round(total * 1000))) / 1000)
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
    out += `<g visibility="${i === 0 ? 'visible' : 'hidden'}"><animate attributeName="visibility" values="${values}" keyTimes="${keys}" dur="${s2(total)}s" begin="${begin}s" calcMode="discrete" repeatCount="indefinite"/>${f}</g>`
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

/*
 * A picture has a limit on its length, and robots of one role are drawn alike, so a drawing that
 * comes up again in the picture being built is written once and referred to after that.
 */
let drawnOnce: Map<string, string> | null = null
function once(svg: string): string {
  if (!drawnOnce || svg.length < 120) return svg
  let id = drawnOnce.get(svg)
  if (!id) {
    id = `u${drawnOnce.size}`
    drawnOnce.set(svg, id)
  }
  return `<use href="#${id}"/>`
}
/** What `once` wrote down, to head the picture: kept apart from where it is used, since a use may be dropped. */
function drawnOnceSvg(): string {
  if (!drawnOnce || !drawnOnce.size) return ''
  let out = ''
  for (const [svg, id] of drawnOnce) out += `<g id="${id}">${svg}</g>`
  return `<defs>${out}</defs>`
}

/** A sprite as several frames, drawn by `draw` at each time in `times`. */
function sprite(w: number, h: number, times: number[], durs: number[], detail: Detail, draw: (g: Px, t: number) => void): string {
  const ts = detail > 0 ? times.slice(0, 1) : times
  return cycle(
    ts.map((t) => {
      const g = new Px(w, h)
      draw(g, t)
      return once(g.svg())
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

function robotFrames(roleId: string, look: BotLook, small: boolean, detail: Detail, seated = false, girth = 0, tool = false, hot = false): string {
  const fast = look.pose === 'type' || look.pose === 'raise' || look.pose === 'err'
  const times = fast ? [0, 0.11] : [0, 0.65]
  const durs = fast ? [0.12, 0.12] : [0.6, 0.6]
  const paint = hot ? hotPaint(roleInfo(roleId).paint) : undefined
  return sprite(26, 34, times, durs, detail, (g, t) => bot(g, 13, 32, { role: roleId, small, pose: look.pose, eyes: look.eyes, t, seated, girth, tool, ...(paint ? { paint } : {}) }))
}

/* ---------- overheating ---------- */
/** How many tool calls in a row have to fail before a robot overheats. */
export const OVERHEAT_AT = 3
/** A robot whose last few tool calls all failed is stuck: it runs hot until one works. */
export const isOverheated = (r: Robot) => r.status === 'working' && (r.streak ?? 0) >= OVERHEAT_AT

const mix = (a: string, b: string, t: number) => {
  const n = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return '#' + [0, 1, 2].map((i) => Math.round(n(a, i) * (1 - t) + n(b, i) * t).toString(16).padStart(2, '0')).join('')
}
/** A role's paint as it looks red-hot. */
const hotPaint = (p: Paint): Paint => ({ l: mix(p.l, '#ffb09c', 0.85), m: mix(p.m, '#e8504f', 0.85), d: mix(p.d, '#9c2f38', 0.85) })

/** Steam let off at both sides of a hot robot's head, on the robot's own canvas. */
function steamSvg(small: boolean, detail: Detail): string {
  // a canvas wider than the robot's own, its middle over the robot's; the jets leave at ear height
  const cx = 20
  const ear = small ? 23 : 21
  const side = small ? 6 : 7
  const puffs = sprite(40, 34, [0, 0.16, 0.32, 0.48], [0.16, 0.16, 0.16, 0.16], detail, (g, t) => {
    const k = Math.round(t / 0.16)
    // a block `dx` out from the middle on both sides, `dy` up from the ears
    const both = (c: string, dx: number, dy: number, w: number, h: number) => {
      R(g, c, cx - dx - w + 1, ear - dy, w, h)
      R(g, c, cx + dx, ear - dy, w, h)
    }
    // each jet shoots out sideways, swells into a puff as it rises, and thins to a wisp
    if (k === 0) both(C.white, side, 0, 2, 1)
    if (k === 1) {
      both(C.white, side, 0, 3, 1)
      both(C.steelL, side + 3, 2, 3, 3)
      both(C.white, side + 3, 2, 2, 2)
    }
    if (k === 2) {
      both(C.white, side, 0, 1, 1)
      both(C.steelL, side + 5, 6, 3, 3)
      both(C.white, side + 6, 6, 2, 2)
    }
    if (k === 3) {
      both(C.steelL, side + 7, 9, 2, 2)
      both(C.steel, side + 6, 6, 1, 1)
    }
  })
  return at(13 - cx, 0, puffs)
}

/* ---------- the context gauge ---------- */
/** How high the gauge stands, 0 to GAUGE_ROWS: how full the context is, measured against the point where it is compacted. */
export const gaugeLevel = (context: number | undefined, limit: number | undefined) => (limit && context ? Math.max(0, Math.min(GAUGE_ROWS, Math.round((context / limit) * GAUGE_ROWS))) : 0)

/** Where a row of the gauge stands on its scale, counted from the bottom: the top two are the red zone, the two under them a warning. */
function gaugeZone(row: number) {
  return row >= GAUGE_ROWS - 2 ? 2 : row >= GAUGE_ROWS - 4 ? 1 : 0
}
const GAUGE_LIT = [C.teal, C.amber, C.red]
const GAUGE_SHINE = [C.tealL, C.lamp, '#ff9b8f']
const GAUGE_DARK = ['#16303a', '#3b3120', '#4a1f2a']
/** The gauge is in the red once its column stands in the red zone. */
export const gaugeInRed = (level: number) => level > 0 && gaugeZone(level - 1) === 2

/**
 * The main agent's context gauge, in a bay of its monitor's case: a column that rises as the
 * context fills toward the point where it is compacted. Each row is lit in the colour of its
 * place on the scale, so the column is teal, then tipped with amber, then with red. The red zone
 * at the top is marked even while it is dark, and once the column stands in it, it blinks.
 */
function gaugeSvg(level: number, detail: Detail): string {
  const column = (blink: boolean) => {
    const g = new Px(GAUGE.w, GAUGE_ROWS)
    for (let k = 0; k < GAUGE_ROWS; k++) {
      const z = gaugeZone(k)
      const y = GAUGE_ROWS - 1 - k
      if (k >= level || (blink && z === 2)) R(g, GAUGE_DARK[z]!, 0, y, GAUGE.w, 1)
      else {
        // glass: a line of light down its near side, and along the top of what is in it
        R(g, k === level - 1 ? GAUGE_SHINE[z]! : GAUGE_LIT[z]!, 0, y, GAUGE.w, 1)
        R(g, GAUGE_SHINE[z]!, 0, y, 1, 1)
      }
    }
    return g.svg()
  }
  const out = gaugeInRed(level) && detail === 0 ? cycle([column(false), column(true)], [0.45, 0.35]) : once(column(false))
  return `<g data-what="gauge">${at(GAUGE.x, GAUGE.y, out)}</g>`
}

/* ---------- what an agent has changed ---------- */
/** The papers beside a desk: a sheet for each file its robot has changed, in a stack that stops growing at a dozen. */
function papersSvg(files: number): string {
  if (files <= 0) return ''
  const sheets = Math.min(12, files)
  const g = new Px(7, sheets + 2)
  R(g, C.ink, 0, 0, 7, sheets + 2)
  R(g, C.paper, 1, 1, 5, sheets)
  // the edges of the sheets show as a faint line here and there down the stack
  for (let i = 2; i < sheets; i += 3) R(g, '#dccfae', 1, 1 + i, 5, 1)
  return `<g data-what="papers" transform="translate(0 ${-(sheets + 2)})">${g.svg()}</g>`
}

const CLOUD_W = 32
const CLOUD_H = 14
const MAIN_CLOUD = { w: 80, h: 34 }
/** The main agent's cloud is as big as what it has to say: a word or a tick gets a small one, a page a full one. */
export function cloudSize(kind: ActivityKind | 'break', label: string): [w: number, h: number] {
  const text = (s: string) => tw(fit(s, 50))
  switch (kind) {
    case 'think':
      return [28 + text(label || 'THINKING'), 24]
    case 'done':
    case 'error':
      return [label ? 30 + text(label) : 24, 22]
    case 'ask':
      return [26 + Math.max(tw('CAN I?'), text(label)), 30]
    case 'talk':
      return [Math.max(40, 10 + text(label)), 26]
    default:
      return [MAIN_CLOUD.w, MAIN_CLOUD.h]
  }
}
function bubbleSvg(kind: ActivityKind | 'break', label: string, sm: boolean, x: number, y: number, tailX: number, tailY: number, detail: Detail): string {
  const f = kind === 'break' ? coffeeBreak : BUB[kind]
  if (!f) return ''
  const [w, h] = sm ? [CLOUD_W, CLOUD_H] : cloudSize(kind, label)
  if (!sm) {
    // a smaller cloud stays over the robot's head, with its foot where the full one's is
    x = Math.min(x + MAIN_CLOUD.w - w, Math.max(x, tailX - (w >> 1)))
    y += MAIN_CLOUD.h - h
  }
  const shell = new Px(w + 40, h + 40)
  cloud(shell, 1, 1, w, h, tailX - x + 1, tailY - y + 1)
  const times = [0, 0.45, 0.9, 1.35]
  const inner = sprite(w - 6, h - 4, times, [0.45, 0.45, 0.45, 0.45], detail, (g, a) => f(g, 0, 0, w - 6, h - 4, a + 0.6, label, sm))
  return at(x - 1, y - 1, once(shell.svg())) + at(x + 3, y + 2, inner)
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
  // off the plate with a step down to the floor, then across to the main agent
  const briefPts: Pt[] = [[PRINTER.x + (PRINTER.w >> 1), gy + PLATE_Y], [EXIT_X, groundY], [BRIEF_X, groundY]]
  const briefCum = timings(briefPts)
  const pts: Pt[] =
    seat.floor === 0
      ? [[BRIEF_X, groundY], [seat.x, groundY]]
      : [[BRIEF_X, groundY], [SHAFT_X, groundY], [SHAFT_X, seat.floorY], [seat.x, seat.floorY]]
  const cum = timings(pts)
  const feedEnd = r.spawnedAt + (r.rush ? RUSH_FEED_MS : FEED_MS)
  const printEnd = feedEnd + (r.rush ? RUSH_PRINT_MS : PRINT_MS)
  const briefAt = printEnd + briefCum[briefCum.length - 1]!
  const briefEnd = briefAt + BRIEF_MS
  const arriveAt = briefEnd + cum[cum.length - 1]!
  const leavePts: Pt[] =
    seat.floor === 0
      ? [[seat.x, seat.y], [seat.x, groundY], [DELIVER_X, groundY]]
      : [[seat.x, seat.y], [seat.x, seat.floorY], [SHAFT_X, seat.floorY], [SHAFT_X, groundY], [DELIVER_X, groundY]]
  const leaveCum = timings(leavePts)
  // A fast subagent still reaches its desk and works a moment before it reports.
  const workEnd = r.endedAt === undefined ? null : Math.max(r.endedAt + REPORT_READY_MS, arriveAt + MIN_WORK_MS, r.exitAt ?? 0)
  if (workEnd === null)
    return { seat, feedEnd, briefPts, briefCum, briefAt, briefEnd, pts, cum, printEnd, arriveAt, workEnd, leaveAt: null, leavePts, leaveCum, handAt: null, toHoleAt: null, jumpAt: null, splashAt: null, goneAt: null }
  const leaveAt = workEnd + CHEER_MS
  const handAt = leaveAt + leaveCum[leaveCum.length - 1]!
  const toHoleAt = handAt + HANDOFF_MS
  const jumpAt = toHoleAt + (Math.abs(HOLE_X - DELIVER_X) / WALK_PX_PER_S) * 1000
  const splashAt = jumpAt + HOP_MS + FALL_MS
  return { seat, feedEnd, briefPts, briefCum, briefAt, briefEnd, pts, cum, printEnd, arriveAt, workEnd, leaveAt, leavePts, leaveCum, handAt, toHoleAt, jumpAt, splashAt, goneAt: splashAt + SPLASH_MS }
}

/**
 * When the printer can start on a new robot. It builds one at a time, and the robot before must
 * have stepped off the plate; a robot that has to wait is printed at the double.
 */
export function printSlot(robots: Robot[], floors: number, now: number): { at: number; rush: boolean } {
  let clear = 0
  for (const r of robots) {
    if (r.type === 'main') continue
    const p = phaseOf(r, floors)
    if (p) clear = Math.max(clear, p.printEnd + PLATE_CLEAR_MS)
  }
  // the plate is clear by the time this robot's metal arrives: start at once
  if (clear <= now + FEED_MS) return { at: now, rush: false }
  return { at: clear - RUSH_FEED_MS, rush: true }
}

/**
 * The earliest a finished robot may stand up, so that robots finishing together hand in their
 * reports one at a time; `undefined` when nobody is in its way.
 */
export function exitSlot(r: Robot, others: Robot[], floors: number): number | undefined {
  const p = phaseOf({ ...r, exitAt: undefined }, floors)
  if (!p || p.handAt === null || p.workEnd === null) return undefined
  const taken = others
    .filter((o) => o.id !== r.id && o.type !== 'main')
    .map((o) => phaseOf(o, floors)?.handAt ?? null)
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b)
  let hand = p.handAt
  for (const t of taken) if (Math.abs(hand - t) < REPORT_SLOT_MS) hand = t + REPORT_SLOT_MS
  return hand === p.handAt ? undefined : p.workEnd + (hand - p.handAt)
}

/** Whether a finished robot has already left its desk with its report. */
export function hasStoodUp(r: Robot, floors: number, now: number): boolean {
  if (r.endedAt === undefined) return false
  const p = phaseOf(r, floors)
  return !!p && p.leaveAt !== null && now >= p.leaveAt
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
    // kept from one picture to the next, it refers to nothing in the picture it was first drawn for
    const held = drawnOnce
    drawnOnce = null
    svg = make()
    drawnOnce = held
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

/**
 * A robot going under shakes the joint where the pipe meets the ladle: the seam glows and two
 * drops fall from it, one after the other, into a small pool. It starts when the robot is half
 * under and is over before the hatch shuts, so there is light to see it by.
 */
function leakSvg(from: number, sec: (t: number) => number, detail: Detail): string {
  if (detail >= 2) return ''
  const y0 = PIPE_Y + PIPE_W + 2
  const pool = GROUND_H - 3 - y0
  // a drop gathers at the seam, falls, and lands in a small pool
  const frame = (k: number, pooled: boolean) => {
    const g = new Px(9, pool + 1)
    R(g, '#ffd166', 3, 0, 2, 1)
    if (k === 0) R(g, '#ffd166', 4, 1, 1, 1)
    else if (k === 1) R(g, '#ffd166', 4, 2, 1, 2)
    else if (k === 2) R(g, '#ffb347', 4, 4, 1, 2)
    if (pooled) {
      R(g, '#ff8a2a', 1, pool, 7, 1)
      R(g, k === 3 ? '#fff1a8' : '#ffd166', 3, pool, 3, 1)
    }
    return at(JOINT_X - 2, y0, g.svg())
  }
  const step = LEAK_MS / 8
  let out = ''
  for (let n = 0; n < 8; n++) out += during(sec(from + n * step), sec(from + (n + 1) * step), frame(n % 4, n >= 3))
  return out ? `<g data-what="leak">${out}</g>` : ''
}

/* The bolts of a pile in the order they land: where each lies in the pile's own box, and which kind it is. */
const PILE: Array<[x: number, y: number, kind: 'steel' | 'brass' | 'nut']> = [
  [3, 4, 'steel'], [0, 5, 'brass'], [5, 4, 'steel'], [7, 4, 'steel'], [1, 3, 'steel'], [4, 3, 'brass'], [7, 2, 'steel'], [4, 1, 'steel'], [9, 5, 'nut'],
]
const PILE_W = 10
/* When in a hop each of its two bolts leaves the robot, as a share of the hop. */
const FLIGHTS = [0.3, 0.45]
function boltSvg(kind: 'steel' | 'brass' | 'nut'): string {
  const g = new Px(3, 2)
  if (kind === 'steel') {
    R(g, C.steel, 0, 0, 2, 2)
    R(g, C.steelL, 0, 0, 1, 1)
    R(g, C.steelD, 1, 1, 1, 1)
  } else if (kind === 'brass') {
    R(g, C.amber, 0, 0, 2, 1)
    R(g, C.steelL, 2, 0, 1, 1)
  } else R(g, C.steelL, 0, 0, 1, 1)
  return g.svg()
}

/**
 * A compaction: the robot is up from its seat and hops for as long as it runs, and with every hop
 * two bolts fly out of it, the context it no longer carries, into a small pile at its side. The
 * pile lies there a while after it has sat down, then is cleared bolt by bolt.
 * It stands at `x` on the floor `fy`, on its feet from `up` to `down`; the pile's left edge is `pile`.
 */
function shedSvg(role: string, small: boolean, girth: number, x: number, fy: number, pile: number, shed: Shed, up: number, down: number, sec: (t: number) => number): string {
  // every loop counts from the compaction's start, so a picture drawn part-way through is in step
  const loop = (offset: number) => `dur="${s2(HOP_CYCLE_MS / 1000)}s" begin="${s2(sec(shed.from + offset))}s" repeatCount="indefinite"`
  let out = ''
  if (down > up) {
    const frame = (pose: Pose, eyes: Eyes) => {
      const g = new Px(26, 34)
      bot(g, 13, 32, { role, small, pose, eyes, girth })
      return g.svg()
    }
    const a = `${x - 13} ${fy - 32}`
    const top = `${x - 13} ${fy - 39}`
    const body =
      `<g><animate attributeName="visibility" values="visible;hidden;visible" keyTimes="0;0.25;0.75" calcMode="discrete" ${loop(0)}/>${frame('stand', 'open')}</g>` +
      `<g visibility="hidden"><animate attributeName="visibility" values="hidden;visible;hidden" keyTimes="0;0.25;0.75" calcMode="discrete" ${loop(0)}/>${frame('cheer', 'happy')}</g>`
    const hopper = `<g transform="translate(${a})"><animateTransform attributeName="transform" type="translate" values="${a};${a};${top};${a};${a}" keyTimes="0;0.25;0.5;0.75;1" calcMode="spline" keySplines="0 0 1 1;0 0 0.58 1;0.42 0 1 1;0 0 1 1" ${loop(0)}/>${body}</g>`
    // a bolt is in the air for half a hop, then out of sight until its turn comes round again
    let flights = ''
    for (const [k, leaves] of FLIGHTS.entries()) {
      const x0 = x - 5
      const y0 = fy - 13
      const x1 = pile + 3 + k * 3
      const y1 = fy - 6
      const pts: string[] = []
      for (let i = 0; i <= 4; i++) {
        const u = i / 4
        pts.push(`${Math.round(x0 + (x1 - x0) * u)} ${Math.round(y0 + (y1 - y0) * u - 4 * (7 + k * 4) * u * (1 - u))}`)
      }
      const when = loop(leaves * HOP_CYCLE_MS)
      flights +=
        `<g visibility="hidden" transform="translate(${pts[4]})"><animate attributeName="visibility" values="visible;hidden" keyTimes="0;0.5" calcMode="discrete" ${when}/>` +
        `<animateTransform attributeName="transform" type="translate" values="${pts.join(';')};${pts[4]}" keyTimes="0;0.125;0.25;0.375;0.5;1" ${when}/>${boltSvg(k ? 'brass' : 'steel')}</g>`
    }
    out += during(sec(up), sec(down), flights + hopper)
  }
  // the pile grows by the bolts that have landed, and is cleared from the top once its time is up
  PILE.forEach(([px, py, kind], i) => {
    const hop = Math.min(i >> 1, SHED_MIN_MS / HOP_CYCLE_MS - 1)
    const lands = shed.from + (hop + FLIGHTS[i & 1]! + 0.5) * HOP_CYCLE_MS
    out += during(sec(lands), sec(shed.gone - i * 150), at(pile + px, fy - 6 + py, boltSvg(kind)))
  })
  return `<g data-what="shed">${out}</g>`
}

/* ---------- the room and the journeys ---------- */
/*
 * The desktop app redraws the pane by building it anew. A picture drawn as an image starts over
 * each time that happens; one drawn in a frame is kept, and goes on playing, for as long as its
 * source stays the same. So each journey a robot makes is a picture of its own, drawn once and
 * left alone until the journey is over, and everything that stays in its place is the room's
 * picture, which can change at any moment without moving anybody. Where a robot passes from one
 * picture to the other it sits still in both for a moment, drawn the same in each, so the change
 * does not show.
 */
/** After a robot sits down, how long until the room draws it too. */
export const SIT_IN_ROOM_MS = 600
/** How long the picture of its arrival is kept after it has sat down. */
export const ARRIVAL_KEPT_MS = 2000
/** When it starts work in the room: it moves again and its cloud comes up. */
export const LIVE_IN_MS = 2600
/** Before it cheers it goes still in the room... */
export const STILL_OUT_MS = 1500
/** ...the picture of its leaving shows it from here... */
export const LEAVING_LEAD_MS = 1000
/** ...and the room lets go of it here. */
export const ROOM_OUT_MS = 300

/** When a leaving is quite over: the robot is gone, the hatch is shut and the cellar is dark again. */
const leavingOver = (p: Phase) => Math.max(p.goneAt ?? 0, (p.splashAt ?? 0) + HATCH_HOLD_MS + AFTERGLOW_MS)

/** When the room draws a robot at its desk: still at first, then at work, then still again before it leaves. */
export type Stay = { from: number; live: number; still: number | null; until: number | null }
export function stayOf(p: Phase): Stay {
  const from = p.arriveAt + SIT_IN_ROOM_MS
  const live = p.arriveAt + LIVE_IN_MS
  if (p.workEnd === null) return { from, live, still: null, until: null }
  return { from, live, still: Math.max(from, p.workEnd - STILL_OUT_MS), until: Math.max(from, p.workEnd - ROOM_OUT_MS) }
}

/**
 * Where a robot is in the room's picture, as a number that only goes up: 0 waiting for the printer,
 * 1 being printed, 2 on its way, 3 sat down and still, 4 at work, 5 still again, 6 on its way out
 * and until the hatch has shut behind it, 8 gone. The room is drawn afresh after each step.
 */
export function stageOf(r: Robot, floors: number, now: number): number {
  // the main agent is always at its desk
  if (r.type === 'main') return 4
  const p = phaseOf(r, floors)
  if (!p) return 0
  const s = stayOf(p)
  if (now < r.spawnedAt) return 0
  if (now < p.printEnd) return 1
  if (now < s.from) return 2
  if (s.until !== null && now >= s.until) return p.goneAt !== null && now >= leavingOver(p) ? 8 : 6
  if (s.still !== null && now >= s.still) return 5
  return now < s.live ? 3 : 4
}

/** A robot sitting quite still: how it is drawn while it passes from one picture to another. */
function stillBot(role: string, girth: number, detail: Detail): string {
  return sprite(26, 34, [0], [1], detail, (g) => bot(g, 13, 32, { role, small: true, pose: 'sit', eyes: 'up', t: 0, seated: true, girth }))
}

/** What stands on a robot's desk while it is there: the kit of its trade, and code on the screen. */
function deskSvg(r: Robot, role: string, p: Phase, detail: Detail): string {
  if (detail >= 3) return ''
  const kit = new Px(KIT.w, KIT.h)
  deskProp(kit, role)
  // a robot that is stuck has a screen full of red
  const screenOn = isOverheated(r)
    ? sprite(7, 5, [0, 0.4], [0.4, 0.4], detail, (g, a) => {
        R(g, a > 0 ? C.redD : C.red, 0, 0, 7, 5)
        R(g, C.paper, 3, 1, 1, 2)
        R(g, C.paper, 3, 4, 1, 1)
      })
    : sprite(7, 5, [0, 0.6, 1.2], [0.6, 0.6, 0.6], detail, (g, a) => screen(g, 0, 0, 7, 5, 'code', a + r.seat))
  return at(p.seat.x + 8, p.seat.floorY - 19 - KIT.h, once(kit.svg())) + at(p.seat.monX, p.seat.monY, screenOn) + at(p.seat.x + 24, p.seat.floorY, papersSvg(r.papers ?? 0))
}

const roleIdOf = (r: Robot) => r.role ?? roleOf(r.type, r.description)

/** A robot walking: riding the lift it stands still, and a carrying robot keeps its arms full. */
function walkerOf(role: string, girth: number, detail: Detail) {
  return (pose: Pose, eyes: Eyes, item?: 'report' | 'blueprint') => (face: number, riding: boolean) =>
    sprite(26, 34, riding ? [0] : [0, 0.11], [0.12, 0.12], detail, (g, t) =>
      bot(g, 13, 32, { role, small: true, pose: riding && pose !== 'carry' ? 'stand' : pose, eyes, face, t, item, girth, tool: true }),
    )
}

/**
 * A robot's arrival, in building coordinates: the metal comes up the pipe, the printer builds it,
 * it collects its blueprint from the main agent, walks to its desk and sits down. `plateFrom` is
 * when the plate is its own: the robot printed before it has stepped off.
 */
function arrivalSvg(r: Robot, floors: number, now: number, plateFrom: number, detail: Detail): string {
  const p = phaseOf(r, floors)
  if (!p || p.arriveAt + ARRIVAL_KEPT_MS <= now) return ''
  const sec = (t: number) => (t - now) / 1000
  const gy = floors * FLOOR_H
  const groundY = gy + FY
  const role = roleIdOf(r)
  const girth = girthOf(r.context)
  let out = ''
  const tag = r.id.replace(/[^a-zA-Z0-9]/g, '')
  if (p.feedEnd > now) out += at(0, gy, feedSvg(tag, r.spawnedAt, p.feedEnd, sec, detail))
  if (p.printEnd > now) {
    const cx = PRINTER.x + (PRINTER.w >> 1)
    const id = `clip-${r.id.replace(/[^a-zA-Z0-9]/g, '')}`
    const room = `chamber-${r.id.replace(/[^a-zA-Z0-9]/g, '')}`
    const g = new Px(26, 34)
    bot(g, 13, 32, { role, small: true, pose: 'stand', eyes: 'off', bulb: C.steelD, girth })
    const b = s2(sec(p.feedEnd))
    const d = s2((p.printEnd - p.feedEnd) / 1000)
    const reveal = `<clipPath id="${id}"><rect x="${PRINTER.x + 3}" y="${PLATE_Y}" width="${PRINTER.w - 6}" height="0"><animate attributeName="y" from="${PLATE_Y}" to="${PLATE_Y - PRINT_RISE}" begin="${b}s" dur="${d}s" fill="freeze"/><animate attributeName="height" from="0" to="${PRINT_RISE}" begin="${b}s" dur="${d}s" fill="freeze"/></rect></clipPath>`
    const chamber = `<clipPath id="${room}"><rect x="${PRINTER.x + 4}" y="${PRINTER.y + 4}" width="${PRINTER.w - 8}" height="${PLATE_Y - PRINTER.y - 4}"/></clipPath>`
    // the gantry comes down to the bed while the metal comes up the pipe, then rises a layer at a time
    const head = sprite(W, GROUND_H, [0, 0.15, 0.3, 0.45], [0.15, 0.15, 0.15, 0.15], detail, (hg, t) =>
      printerGantry(hg, cx + Math.round(Math.sin(t * 7) * 6), PLATE_Y - 1, true, PRINTER.y - PRINT_RISE),
    )
    const span = p.printEnd - r.spawnedAt
    const key = (t: number) => (Math.max(0, t - r.spawnedAt) / span).toFixed(4)
    const z = `<animateTransform attributeName="transform" type="translate" values="0 ${-PRINT_RISE};0 ${-PRINT_RISE};0 0;0 ${-PRINT_RISE}" keyTimes="0;${key(p.feedEnd - 500)};${key(p.feedEnd)};1" begin="${s2(sec(r.spawnedAt))}s" dur="${s2(span / 1000)}s" fill="freeze"/>`
    const gantry = `<g clip-path="url(#${room})"><g transform="translate(0 ${-PRINT_RISE})">${z}${head}</g></g>`
    // the control box's screen fills as the robot prints
    const bar = `<rect x="${LCD.x}" y="${LCD.y + 1}" width="0" height="1" fill="${C.green}"><animate attributeName="width" from="0" to="${LCD.w}" begin="${b}s" dur="${d}s" fill="freeze"/></rect>`
    // the furnace in the control box is lit while there is metal in it: its vents glow
    const vents = new Px(W, GROUND_H)
    for (let vx = PRINTER.x + 19; vx < PRINTER.x + PRINTER.w - 12; vx += 2) R(vents, '#ff9a3c', vx, PLATE_Y + 6, 1, 4)
    out += at(0, gy, during(sec(p.feedEnd - 80), sec(p.printEnd), vents.svg()))
    // the printer builds one robot at a time: this one's turn starts when the one before is off the plate
    out += at(0, gy, during(plateFrom > now ? sec(plateFrom) : null, sec(p.printEnd), `${reveal}${chamber}<g clip-path="url(#${id})">${at(cx - 13, PLATE_Y - 32, g.svg())}</g>${gantry}${bar}`))
  }
  const walker = walkerOf(role, girth, detail)
  if (p.briefAt > now) out += walkLegs(p.briefPts, p.briefCum, p.printEnd, now, walker('walk', 'open'))
  if (p.briefEnd > now) {
    // the main agent hands over the task's blueprint
    const waiting = sprite(26, 34, [0], [1], detail, (g) => bot(g, 13, 32, { role, small: true, pose: 'stand', eyes: 'up', face: 1, girth, tool: true }))
    const holding = sprite(26, 34, [0], [1], detail, (g) => bot(g, 13, 32, { role, small: true, pose: 'carry', eyes: 'happy', face: 1, item: 'blueprint', girth }))
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
  // sat down, it keeps still here until the room has it
  out += during(sec(p.arriveAt), sec(p.arriveAt + ARRIVAL_KEPT_MS), deskSvg(r, role, p, detail) + at(p.seat.x - 13, p.seat.y - 32, stillBot(role, girth, detail)))
  return out ? `<g data-what="arrival">${out}</g>` : ''
}

/**
 * A robot's leaving, in building coordinates: a cheer at its desk, the report carried to the main
 * agent and handed over, a few steps to the hatch, and the jump into the molten metal.
 */
function leavingSvg(r: Robot, floors: number, now: number, selected: string, detail: Detail): string {
  const p = phaseOf(r, floors)
  if (!p || p.workEnd === null || p.leaveAt === null || p.handAt === null || p.toHoleAt === null || p.jumpAt === null || p.splashAt === null || p.goneAt === null) return ''
  if (leavingOver(p) <= now) return ''
  const sec = (t: number) => (t - now) / 1000
  const gy = floors * FLOOR_H
  const groundY = gy + FY
  const role = roleIdOf(r)
  const girth = girthOf(r.context)
  const seated = p.seat.y
  const walker = walkerOf(role, girth, detail)
  const desk = deskSvg(r, role, p, detail)
  const mark = r.id === selected ? selectMark(p.seat.x, seated - 20) : ''
  let out = ''
  // still at its desk, as the room last drew it
  out += during(sec(p.workEnd - LEAVING_LEAD_MS), sec(p.workEnd), desk + at(p.seat.x - 13, seated - 32, stillBot(role, girth, detail)) + mark)
  const endKind: ActivityKind = r.status === 'failed' ? 'error' : 'done'
  // a cheer at the desk
  const kit = new Px(KIT.w, KIT.h)
  deskProp(kit, role)
  const cloud = detail >= 2 ? '' : bubbleSvg(endKind, '', true, p.seat.bubble.x, p.seat.bubble.y, p.seat.x, seated - 18, detail)
  const cheering = at(p.seat.x + 8, p.seat.floorY - 19 - KIT.h, once(kit.svg())) + at(p.seat.x - 13, seated - 32, robotFrames(role, lookFor(endKind, true), true, detail, true, girth)) + mark + cloud
  out += during(sec(p.workEnd), sec(p.leaveAt), cheering)
  // carrying the report down to the main desk
  out += walkLegs(p.leavePts, p.leaveCum, p.leaveAt, now, walker('carry', 'happy', 'report'))
  // handing it over: the robot faces the main agent and the report flies across
  const standing = sprite(26, 34, [0], [1], detail, (g) => bot(g, 13, 32, { role, small: true, pose: 'stand', eyes: 'happy', face: -1, girth, tool: true }))
  out += during(sec(p.handAt), sec(p.toHoleAt), at(DELIVER_X - 13, groundY - 32, standing))
  const paper = new Px(6, 5)
  R(paper, C.ink, 0, 0, 6, 5)
  R(paper, C.paper, 1, 1, 4, 3)
  R(paper, C.amber, 1, 1, 4, 1)
  const fromP = `${DELIVER_X - 8} ${groundY - 13}`
  const toP = `${MAIN_X + 4} ${gy + SEAT_Y - 14}`
  const flight = `<g transform="translate(${fromP})"><animateTransform attributeName="transform" type="translate" values="${fromP};${DELIVER_X - 30} ${groundY - 24};${toP}" keyTimes="0;0.5;1" begin="${s2(sec(p.handAt))}s" dur="0.6s" fill="freeze"/>${paper.svg()}</g>`
  out += during(sec(p.handAt), sec(p.handAt + 600), flight)
  const thanks = new Px(11, 9)
  R(thanks, C.ink, 0, 0, 11, 9)
  R(thanks, C.paper, 1, 1, 9, 7)
  check(thanks, 0, 0, C.greenD)
  // the tick for it comes up beside the main agent's cloud: this picture lies over the room, cloud and all
  out += during(sec(p.handAt + 600), sec(p.handAt + 1500), at(MAIN_X + 36, gy + SEAT_Y - 47, thanks.svg()))
  // a few steps to the hatch, which opens and lets the light into the pit; a hop, and down into the vat
  const toHole: Pt[] = [[DELIVER_X, groundY], [HOLE_X, groundY]]
  out += walkLegs(toHole, timings(toHole), p.toHoleAt, now, walker('walk', 'happy'))
  const leaping = sprite(26, 34, [0], [1], detail, (g) => bot(g, 13, 32, { role, small: true, pose: 'cheer', eyes: 'happy', girth }))
  const a = `${HOLE_X - 13} ${groundY - 32}`
  const values = `${a};${HOLE_X - 13} ${groundY - 41};${HOLE_X - 13} ${gy + MELT_Y + 12 - 32}`
  const hop = (HOP_MS / (HOP_MS + FALL_MS)).toFixed(3)
  const id = `melt-${r.id.replace(/[^a-zA-Z0-9]/g, '')}`
  const fall = `<g transform="translate(${a})"><animateTransform attributeName="transform" type="translate" values="${values}" keyTimes="0;${hop};1" calcMode="spline" keySplines="0 0 0.58 1;0.42 0 1 1" begin="${s2(sec(p.jumpAt))}s" dur="${s2((HOP_MS + FALL_MS) / 1000)}s" fill="freeze"/>${leaping}</g>`
  out += during(sec(p.jumpAt), sec(p.splashAt), `<clipPath id="${id}"><rect x="0" y="0" width="${W}" height="${gy + MELT_Y}"/></clipPath><g clip-path="url(#${id})">${fall}</g>`)
  // the splash
  const splash = sprite(30, 14, [0, 0.25, 0.5], [0.25, 0.25, 0.3], detail, (g, t) => {
    const k = Math.round(t / 0.25)
    const drops: Array<[number, number, string]> = [[-6, 3, '#ffd166'], [5, 4, '#ff9a3c'], [-2, 6, '#ffb347'], [8, 2, '#e8501f'], [-9, 2, '#ff9a3c']]
    for (const [dx, up, c] of drops) R(g, c, 15 + dx * (1 + k * 0.4), 11 - up * (k === 1 ? 2 : k === 0 ? 1 : 1.4) + k * 2, 1 + (k === 0 ? 1 : 0), 1)
    R(g, k === 0 ? C.lamp : '#ffd166', 9 - k * 2, 12, 12 + k * 4, 1)
  })
  out += during(sec(p.splashAt), sec(p.goneAt), at(HOLE_X - 15, gy + MELT_Y - 12, splash))
  return `<g data-what="leaving">${out}</g>`
}

/** When the plate is a robot's own: once every robot printed before it has stepped off. */
export function plateFromOf(r: Robot, others: Robot[], floors: number): number {
  const mine = phaseOf(r, floors)?.printEnd ?? 0
  let from = r.spawnedAt
  for (const o of others) {
    if (o.type === 'main' || o.id === r.id) continue
    const end = phaseOf(o, floors)?.printEnd ?? 0
    if (end < mine) from = Math.max(from, end)
  }
  return from
}

/** Everything that stays in its place, in building coordinates: the building, its machines, the robots at their desks, the main agent. */
function roomSvg(world: World, now: number, selected: string, detail: Detail): string {
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
  // robots ordered while the printer is busy: how many wait is counted down on its control box
  const waiting = subs.filter((r) => phaseOf(r, floors) !== null && r.spawnedAt > now).map((r) => r.spawnedAt).sort((a, b) => a - b)
  waiting.forEach((t, i) => {
    const plate = new Px(11, 7)
    R(plate, C.amber, 0, 0, 11, 7)
    tx(plate, `+${Math.min(9, waiting.length - i)}`, 2, 1, C.ink)
    ground += during(i === 0 ? null : sec(waiting[i - 1]!), sec(t), at(PRINTER.x + 18, PLATE_Y + 4, plate.svg()))
  })
  ground += at(BOARD.x, BOARD.y, tokensPlate(dailyTotals(world.tokens, world.history, now, CHART_DAYS)))
  ground += employeePlate(world.tokens, now, detail)
  const mainKind = main?.activity.kind ?? 'idle'
  ground += screenSvg(MAIN_SCREEN.x, MAIN_SCREEN.y, MAIN_SCREEN.w, MAIN_SCREEN.h, screenFor(mainKind), detail)
  // in the head of its monitor is its gauge: how near its context is to being compacted
  if (main) ground += gaugeSvg(gaugeLevel(main.context, world.limit), detail) + at(MAIN_DESK.x1 + 2, FY, papersSvg(main.papers ?? 0))
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

  // the robots at their desks: still as they come and before they go, at work in between
  for (const r of subs) {
    const p = phaseOf(r, floors)
    if (!p) continue
    const stay = stayOf(p)
    if (stay.until !== null && stay.until <= now) continue
    const role = roleIdOf(r)
    const girth = girthOf(r.context)
    const seated = p.seat.y
    const until = stay.until === null ? null : sec(stay.until)
    out += during(sec(stay.from), until, deskSvg(r, role, p, detail))
    const sits = at(p.seat.x - 13, seated - 32, stillBot(role, girth, detail))
    // at work from `a0` until `a1`
    const a0 = stay.live
    const a1 = stay.still
    if (a1 !== null && a1 <= a0) {
      out += during(sec(stay.from), until, sits)
      continue
    }
    out += during(sec(stay.from), sec(a0), sits)
    if (a1 !== null) out += during(sec(a1), until, sits)
    const end = a1 === null ? null : sec(a1)
    const workKind: ActivityKind = r.status === 'working' ? r.activity.kind : 'think'
    const mark = r.id === selected ? selectMark(p.seat.x, seated - 20) : ''
    const cloud = detail >= 2 ? '' : bubbleSvg(workKind, r.status === 'working' ? r.activity.label : '', true, p.seat.bubble.x, p.seat.bubble.y, p.seat.x, seated - 18, detail)
    const hot = isOverheated(r)
    const sitter = at(p.seat.x - 13, seated - 32, robotFrames(role, lookFor(workKind, true), true, detail, true, girth, false, hot) + (hot ? steamSvg(true, detail) : '')) + mark + cloud
    // a compaction at its desk: it is up and hopping, shedding bolts, for as long as it runs, then sits down again
    const shed = shedSpan(r, now)
    const up = shed ? Math.max(shed.from, a0) : 0
    const down = shed ? (a1 === null ? shed.until : Math.min(shed.until, a1)) : 0
    if (!shed || down <= up) out += during(sec(a0), end, sitter)
    else out += (up > a0 ? during(sec(a0), sec(up), sitter) : '') + (a1 === null || down < a1 ? during(sec(down), end, sitter) : '')
    if (shed) {
      // the pile lies at its feet, clear of the hatch in the floor
      const beside = p.seat.x - 15
      const pile = p.seat.floor === 0 && beside < HOLE_X0 + HOLE_W + 2 && beside + PILE_W > HOLE_X0 - 2 ? HOLE_X0 + HOLE_W + 2 : beside
      out += shedSvg(role, true, girthOf(r.compactedFrom ?? r.context), p.seat.x, p.seat.floorY, pile, shed, up, down, sec)
    }
  }

  // the main robot and its cloud
  if (main) {
    const kind = main.activity.kind
    // with helpers still about, an idle main agent stays awake and the lights stay on
    const helpers = subs.some((r) => {
      const p = phaseOf(r, floors)
      return !!p && (p.goneAt === null || leavingOver(p) > now)
    })
    // a compaction: the main agent is up from its chair, hopping and shedding bolts like anyone else, for as long as it runs
    const shed = shedSpan(main, now)
    const hopping = shed !== null && shed.until > now
    const asleep = kind === 'idle' && !helpers
    const look = lookFor(kind === 'idle' && helpers ? 'think' : kind, true)
    // with nothing to type, the boss has its stick in its hand; otherwise the stick leans on the chair
    const inHand = look.pose === 'sit' && !asleep
    const stick = new Px(4, 13)
    for (let i = 0; i < 13; i++) R(stick, C.woodL, i >> 2, 12 - i, 1, 1)
    const leaning = at(MAIN_X - 14, gy + FY - 13, stick.svg())
    if (!inHand) out += leaning
    else if (hopping) out += during(null, sec(shed.until), leaning)
    const hot = isOverheated(main)
    const seatedMain = at(MAIN_X - 13, gy + SEAT_Y - 32, robotFrames('main', look, false, detail, true, girthOf(main.context), inHand, hot) + (hot ? steamSvg(false, detail) : ''))
    // what goes with the main agent in its chair: its cloud, or its sleep
    let seatedWith = ''
    if (kind === 'idle' && helpers) {
      const busy = subs.filter((r) => r.status === 'working').length
      seatedWith = bubbleSvg('break', busy ? `${busy} AT WORK` : 'REPORTS DUE', false, 58, gy + 51, MAIN_X, gy + SEAT_Y - 21, detail)
    } else if (asleep) {
      seatedWith = sprite(W, height, [0, 0.7, 1.4, 2.1], [0.7, 0.7, 0.7, 0.7], detail, (g, t) => zzz(g, MAIN_X + 2, gy + SEAT_Y - 22, t))
      seatedWith += `<rect width="${W}" height="${height}" fill="#0a061e" opacity="0.32"/>`
    } else {
      seatedWith = bubbleSvg(kind, main.activity.label, false, 58, gy + 51, MAIN_X, gy + SEAT_Y - 21, detail)
    }
    out += hopping ? during(sec(shed.until), null, seatedMain) : seatedMain
    if (shed) out += shedSvg('main', false, girthOf(main.compactedFrom ?? main.context), MAIN_X, gy + FY, MAIN_X - 27, shed, shed.from, shed.until, sec)
    if (main.id === selected) out += selectMark(MAIN_X, gy + SEAT_Y - 24)
    // nothing is said over a robot that is hopping
    const says = `<g data-what="main-says">${seatedWith}</g>`
    out += hopping ? during(sec(shed.until), null, says) : says
  }
  return out
}

/** The app takes a picture's source up to 131072 characters; a longer one is not drawn at all. */
const SOURCE_CAP = 126_000

const picture = (height: number, inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W * 6}" height="${height * 6}" preserveAspectRatio="xMinYMax meet" shape-rendering="crispEdges">${inner}</svg>`

function roofSvg(): string {
  const roof = cached('roof', () => paintRoof().svg())
  return `${roof}<rect x="205" y="0" width="3" height="1" fill="${C.red}"><animate attributeName="opacity" values="1;0.15;1" dur="1.6s" repeatCount="indefinite"/></rect>`
}

/** As much of a picture's motion as fits under the cap: full, then single frames, then no helpers' clouds, then bare desks. */
function fitted(height: number, make: (detail: Detail) => string): string {
  let svg = ''
  for (const detail of [0, 1, 2, 3] as const) {
    drawnOnce = new Map()
    const inner = make(detail)
    svg = picture(height, drawnOnceSvg() + inner)
    drawnOnce = null
    if (svg.length <= SOURCE_CAP) break
  }
  return svg
}

/** The room at `now`: what stays in its place, with every change still to come encoded as SMIL timing. */
export function buildRoom(world: World, now: number, selected = ''): string {
  loopAt = now
  return fitted(sceneHeight(world.floors), (detail) => roofSvg() + at(0, ROOF_H, roomSvg(world, now, selected, detail)))
}

/** A stretch for which the hatch stands open: for one robot, or for several that follow close on each other. */
export type Drop = { open: number; shut: number; splashes: number[] }

/**
 * When the hatch opens and shuts for the robots that are leaving, with every stretch that is not
 * yet quite over at `now`. A stretch is the same from the moment its robots are known until the
 * cellar is dark again, so its picture can be laid once and left to play.
 */
export function hatchDrops(robots: Robot[], floors: number, now: number): Drop[] {
  const drops: Drop[] = []
  const leaving = robots
    .filter((r) => r.type !== 'main')
    .map((r) => phaseOf(r, floors))
    .filter((p): p is Phase => !!p && p.jumpAt !== null && p.splashAt !== null)
  for (const p of leaving.sort((a, b) => a.jumpAt! - b.jumpAt!)) {
    const open = p.jumpAt! - HATCH_LEAD_MS
    const shut = p.splashAt! + HATCH_HOLD_MS
    const last = drops[drops.length - 1]
    if (last && open <= last.shut) {
      last.shut = Math.max(last.shut, shut)
      last.splashes.push(p.splashAt!)
    } else drops.push({ open, shut, splashes: [p.splashAt!] })
  }
  return drops.filter((d) => d.shut + AFTERGLOW_MS > now)
}

/** The hatch and what its light shows, in building coordinates. */
function hatchesSvg(drops: Drop[], floors: number, now: number, detail: Detail): string {
  const sec = (t: number) => (t - now) / 1000
  return drops.map((d, i) => at(0, floors * FLOOR_H, hatchSvg(`h${i}`, d.open, d.shut, d.splashes, sec, detail))).join('')
}

/** The cellar's light at `now`, on nothing: a layer of its own over the room, so the room's picture stays as light as it was. */
export function buildCellar(drops: Drop[], floors: number, now: number): string {
  if (!drops.length) return ''
  loopAt = now
  return fitted(sceneHeight(floors), (detail) => at(0, ROOF_H, hatchesSvg(drops, floors, now, detail)))
}

/** What a journey's picture is drawn from: the robot as it was when its journey was laid. */
export type Journey = { kind: 'in' | 'out'; robot: Robot; floors: number; plateFrom: number; selected?: string }

/** One robot's journey at `now`, on nothing: laid over the room, it plays to its end untouched. */
export function buildJourney(j: Journey, now: number): string {
  loopAt = now
  return fitted(sceneHeight(j.floors), (detail) =>
    at(0, ROOF_H, j.kind === 'in' ? arrivalSvg(j.robot, j.floors, now, j.plateFrom, detail) : leavingSvg(j.robot, j.floors, now, j.selected ?? '', detail)),
  )
}

/** When a journey's picture is over and can be taken away. */
export function journeyEnd(j: Journey): number {
  const p = phaseOf(j.robot, j.floors)
  if (!p) return 0
  // a leaving is over when the cellar is dark again
  return j.kind === 'in' ? p.arriveAt + ARRIVAL_KEPT_MS : leavingOver(p) + 100
}

/** The whole building at `now` in one picture, journeys and all: for stills and for surfaces that draw one layer. */
export function buildScene(world: World, now: number, selected = ''): string {
  loopAt = now
  const subs = world.robots.filter((r) => r.type !== 'main')
  return fitted(sceneHeight(world.floors), (detail) => {
    let journeys = ''
    for (const r of subs) journeys += arrivalSvg(r, world.floors, now, plateFromOf(r, subs, world.floors), detail) + leavingSvg(r, world.floors, now, selected, detail)
    return roofSvg() + at(0, ROOF_H, roomSvg(world, now, selected, detail) + hatchesSvg(hatchDrops(world.robots, world.floors, now), world.floors, now, detail) + journeys)
  })
}

/** A picture of nothing as tall as the building: it gives the pane its height, and the layers lie over it. */
export function sizerSvg(floors: number): string {
  const height = sceneHeight(floors)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W * 6}" height="${height * 6}"/>`
}

/* ---------- laying a new picture of the room ---------- */
/**
 * The room's picture is drawn in a frame, and a frame given a new picture is empty until that
 * picture has loaded. So the room is kept in two layers, and a new picture is only ever laid in
 * the layer that is not on show: over the lower layer, or under the upper one, which comes off
 * once the picture beneath it has had time to load. The layers lie on the building's ground, so a
 * picture drawn before the building grew a floor still stands in its place.
 */
export type Layers = { key: string; lower: string; lowerHeight: number; upper: string; upperHeight: number; covered: boolean; uncoverAt: number }
export const noLayers: Layers = { key: '', lower: '', lowerHeight: 0, upper: '', upperHeight: 0, covered: false, uncoverAt: 0 }
const UNCOVER_MS = 600

export function layPicture(l: Layers, key: string, svg: string, height: number, now: number, layered: boolean): Layers {
  // the picture laid underneath has loaded: the upper layer comes off
  if (l.uncoverAt && now >= l.uncoverAt) l = { ...l, upper: '', upperHeight: 0, covered: false, uncoverAt: 0 }
  if (key === l.key) return l
  // the first picture, or a surface that draws one layer: laid plainly
  if (!layered || !l.lower) return { key, lower: svg, lowerHeight: height, upper: '', upperHeight: 0, covered: false, uncoverAt: 0 }
  // the lower layer is on show: the new picture goes over it
  if (!l.covered) return { ...l, key, upper: svg, upperHeight: height, covered: true, uncoverAt: 0 }
  // the upper layer is on show: the new picture goes under it, and is uncovered once it has loaded
  return { ...l, key, lower: svg, lowerHeight: height, uncoverAt: now + UNCOVER_MS }
}

/* ---------- which journeys are on ---------- */
/** A journey's picture is laid this long before the journey starts, so it is in place in time. */
export const JOURNEY_LEAD_MS = 800
/* A helper whose role is not known yet may wait this long for it before its arrival is laid. */
const ROLE_WAIT_MS = 600
/* A leaving cut short, because its robot was given more work, goes a moment after the room has the robot back. */
const CUT_SHORT_MS = 700

const arrivalKey = (r: Robot) => `in:${r.id}:${r.spawnedAt}:${r.seat}`
const leavingKey = (r: Robot) => `out:${r.id}:${r.endedAt ?? 0}:${r.exitAt ?? 0}`

/**
 * The journeys on show at `now`: those laid before and not yet over, and those now due, each in a
 * free layer of the pane. A journey is laid once, from the robot as it then was, and never again,
 * so it plays to its end whatever happens meanwhile: what comes next waits its turn in the room.
 * Returns `acts` itself when nothing changed.
 */
export function directJourneys(acts: Act[], robots: Robot[], floors: number, now: number, slots: number): Act[] {
  const subs = robots.filter((r) => r.type !== 'main')
  const standing = new Set<string>()
  for (const r of subs) if (r.endedAt !== undefined) standing.add(leavingKey(r))
  let changed = false
  const next: Act[] = []
  for (const a of acts) {
    if (a.until <= now) {
      changed = true
      continue
    }
    // given more work before it stood up, the robot stays: its leaving is taken away
    if (a.kind === 'out' && !standing.has(a.key) && !hasStoodUp(a.robot, a.floors, now) && a.until > now + CUT_SHORT_MS) {
      next.push({ ...a, until: now + CUT_SHORT_MS })
      changed = true
      continue
    }
    next.push(a)
  }
  const have = new Set(next.map((a) => a.key))
  const lay = (kind: 'in' | 'out', r: Robot, key: string) => {
    const used = new Set(next.map((a) => a.slot))
    let slot = 0
    while (used.has(slot)) slot++
    // every layer is taken: it waits, and joins its journey where it then is
    if (slot >= slots) return
    const robot = { ...r, role: roleIdOf(r) }
    const plateFrom = kind === 'in' ? plateFromOf(r, subs, floors) : 0
    next.push({ key, slot, kind, at: now, until: journeyEnd({ kind, robot, floors, plateFrom }), floors, plateFrom, robot })
    have.add(key)
    changed = true
  }
  for (const r of subs) {
    const p = phaseOf(r, floors)
    if (!p) continue
    const arrival = arrivalKey(r)
    if (!have.has(arrival) && now >= r.spawnedAt - JOURNEY_LEAD_MS && now < p.arriveAt && (r.role !== undefined || now >= r.spawnedAt + ROLE_WAIT_MS)) lay('in', r, arrival)
    if (p.workEnd === null || p.goneAt === null) continue
    const leaving = leavingKey(r)
    if (!have.has(leaving) && now >= p.workEnd - LEAVING_LEAD_MS - JOURNEY_LEAD_MS && now < p.goneAt) lay('out', r, leaving)
  }
  return changed ? next : acts
}

/* ---------- click layers, and which task is open ---------- */
/**
 * The app gives up on a click layer that does not answer it in time, and shows its own notice in
 * the layer's place. Such a layer is left out of the drawing (its card gets a plain button), then
 * laid afresh under a new name: soon when the person is at the pane, and after a longer wait each
 * time it fails again.
 */
export type ClickLayer = { gen: number; failedAt: number; fails: number }
const MEND_MS = [1500, 5000, 15_000, 60_000]
/** How long a failed click layer is left out before it is tried again. */
export const mendWait = (fails: number, focused: boolean) => (focused ? MEND_MS[0]! : MEND_MS[Math.min(Math.max(fails, 1), MEND_MS.length) - 1]!)
/** The name to lay a click layer under now, or null while it is left out; and its record from here on. */
export function layClick(l: ClickLayer | undefined, name: string, now: number, focused: boolean): { key: string | null; next: ClickLayer | undefined } {
  if (!l) return { key: name, next: l }
  if (l.failedAt) {
    if (now - l.failedAt < mendWait(l.fails, focused)) return { key: null, next: l }
    const next = { ...l, gen: l.gen + 1, failedAt: 0 }
    return { key: `${name}~${next.gen}`, next }
  }
  return { key: l.gen ? `${name}~${l.gen}` : name, next: l }
}
/** A click layer's record once the app has given up on it. */
export const failClick = (l: ClickLayer | undefined, now: number): ClickLayer => ({ gen: l?.gen ?? 0, failedAt: now, fails: (l?.fails ?? 0) + 1 })

/**
 * Which task card is open: the one last picked in the pane, unless an agent has been opened from
 * Claude Code's own tasks list since. A click on the open card always closes it.
 */
export const openCard = (picked: string, pickedAt: number, viewed: { id: string; at: number }) => (viewed.id && viewed.at > pickedAt ? viewed.id : picked)

export type TaskState = 'running' | 'waiting' | 'done' | 'failed' | 'idle'

const BADGE: Record<TaskState, string> = { running: '#4f8fe6', waiting: C.amber, done: '#3fbf6a', failed: C.red, idle: '#6f7893' }

/** The lamp of each state, and the same with the light on it. */
const BADGE_LIT: Record<TaskState, string> = { running: '#a9ccff', waiting: C.lamp, done: '#b5f0bb', failed: '#ff9a96', idle: C.steel }
/** The dark behind a card's instruments: the app's own, near enough, so they sit in the card and not on it. */
const CARD_INK = '#10141f'

/**
 * A robot's portrait for its card: its head and shoulders in a well of its own dark paint, framed
 * in its own mid paint, with a square lamp in the corner that says how its task stands. Every
 * edge is square and every colour flat, as in the office.
 */
export function avatarSvg(roleId: string, kind: ActivityKind, state: TaskState = 'running'): string {
  const role = roleInfo(roleId)
  const g = new Px(20, 20)
  R(g, role.paint.m, 0, 0, 20, 20)
  R(g, mix(role.paint.d, CARD_INK, 0.62), 1, 1, 18, 18)
  const face = new Px(18, 18)
  bot(face, 9, 22, { role: role.id, small: false, view: 'front', pose: 'stand', eyes: lookFor(kind, false).eyes })
  let badge = ''
  if (state !== 'idle') {
    const b = new Px(20, 20)
    R(b, CARD_INK, 12, 12, 8, 8)
    R(b, BADGE[state], 13, 13, 6, 6)
    R(b, BADGE_LIT[state], 13, 13, 6, 1)
    const dot = (c: string, cells: Array<[number, number]>) => cells.forEach(([x, y]) => R(b, c, 13 + x, 13 + y, 1, 1))
    if (state === 'done') dot(C.white, [[1, 3], [2, 4], [3, 3], [4, 2]])
    else if (state === 'failed') dot(C.white, [[1, 1], [4, 1], [2, 2], [3, 2], [2, 3], [3, 3], [1, 4], [4, 4]])
    else if (state === 'waiting') dot(C.ink, [[2, 1], [3, 1], [2, 2], [3, 2], [2, 4], [3, 4]])
    // at work the lamp goes down and comes up again
    const dim = state === 'running' ? `<rect x="13" y="13" width="6" height="6" fill="${CARD_INK}" opacity="0"><animate attributeName="opacity" values="0;0.6;0" dur="1.6s" repeatCount="indefinite"/></rect>` : ''
    badge = b.svg() + dim
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="40" height="40" shape-rendering="crispEdges">${g.svg()}<g transform="translate(1 1)">${face.svg()}</g>${badge}</svg>`
}

/** How many days the tokens plate charts: the last week, today included. */
export const CHART_DAYS = 7
export const BAR_MAX = 10

/** How tall each day's bar stands: the busiest day at full height, a day with any tokens at all at least a row, a day without none. */
export function chartBars(daily: number[]): number[] {
  const max = Math.max(1, ...daily)
  return daily.map((v) => (v > 0 ? Math.max(1, Math.round((v / max) * BAR_MAX)) : 0))
}

/**
 * The KPI plate: tokens per day over the last week, a bar for each day, oldest first, and today's,
 * still growing, in amber. Its name is the office's joke: here the indicator that counts is how
 * many tokens were got through.
 */
function tokensPlate(daily: number[]): string {
  const g = new Px(BOARD.w + 1, BOARD.h + 1)
  const f = plate(g, 0, 0, BOARD.w, BOARD.h, 'KPI')
  const base = f.y + f.h - 2
  const pitch = 6
  const x0 = f.x + ((f.w - (daily.length * pitch - 2)) >> 1)
  R(g, C.panel2, f.x + 1, base, f.w - 2, 1)
  chartBars(daily).forEach((n, i) => {
    const today = i === daily.length - 1
    const x = x0 + i * pitch
    // a day with nothing in it keeps its place on the line
    R(g, today ? C.amber : C.tealD, x, base, 4, 1)
    if (!n) return
    R(g, today ? C.amber : C.teal, x, base - n, 4, n)
    R(g, today ? C.lamp : C.tealL, x, base - n, 4, 1)
  })
  return `<g data-what="plate">${g.svg()}</g>`
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

/**
 * A card's progress, made as the office's gauge is: a dark glass in a steel case, and in it a
 * cell for each step, lit in its colour with a line of light along its top. The step in flight
 * blinks. The picture stretches to the width it is given, so the case always spans its card.
 */
export function progressSvg(p: Progress, roleId: string, width = 220): string {
  const w = width
  const h = 8
  const paint = roleInfo(roleId).paint
  let segs = ''
  let live = ''
  const rect = (x: number, y: number, sw: number, sh: number, fill: string) => `<rect x="${x.toFixed(2)}" y="${y}" width="${Math.max(1, sw).toFixed(2)}" height="${sh}" fill="${fill}"/>`
  const pill = (x: number, sw: number, fill: string, top = '') => rect(x, 2, sw, 4, fill) + (top ? rect(x, 2, sw, 1, top) : '')
  const shimmer = (x: number, sw: number) =>
    `<rect x="${x.toFixed(2)}" y="2" width="${Math.max(1, sw).toFixed(2)}" height="4" fill="${C.scr}" opacity="0"><animate attributeName="opacity" values="0;0.65;0" dur="1.4s" repeatCount="indefinite"/></rect>`
  const DARK = '#1c2a3d'
  const inner = w - 4
  if (p.mode === 'plan') {
    const n = Math.max(1, p.statuses.length)
    const gap = n > 24 ? 1 : 2
    const sw = (inner - gap * (n - 1)) / n
    p.statuses.forEach((st, i) => {
      const x = 2 + i * (sw + gap)
      if (st === 'completed') segs += pill(x, sw, paint.m, paint.l)
      else if (st === 'in_progress') {
        segs += pill(x, sw, C.amber, C.lamp)
        live = shimmer(x, sw)
      } else segs += pill(x, sw, DARK)
    })
  } else {
    const slots = Math.max(8, Math.floor((inner + 2) / 14))
    const gap = 2
    const sw = (inner - gap * (slots - 1)) / slots
    const kinds = p.kinds.slice(-(p.state === 'running' ? slots : slots - 1))
    for (let i = 0; i < slots; i++) {
      const x = 2 + i * (sw + gap)
      const k = kinds[i]
      const col = k ? (KIND_COL[k] ?? [C.steelD, C.steel]) : null
      if (col) segs += pill(x, sw, col[0], col[1])
      else if (p.state === 'done' && i > kinds.length) segs += pill(x, sw, paint.m, paint.l)
      else if (p.state !== 'running' && i === kinds.length) segs += p.state === 'done' ? pill(x, sw, '#3fbf6a', '#b5f0bb') : pill(x, sw, C.red, '#ff9a96')
      else segs += pill(x, sw, DARK)
    }
    if (p.state === 'running' && kinds.length) live = shimmer(2 + (kinds.length - 1) * (sw + gap), sw)
  }
  const glass = `<rect width="${w}" height="${h}" fill="${C.panel2}"/><rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="${C.scr}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" shape-rendering="crispEdges">${glass}${segs}${live}</svg>`
}
