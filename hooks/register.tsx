// Tin Collar: a pixel office building beside the chat. Every agent is a robot dressed
// for its role, every tool call moves it, and clicking a robot opens its trace.
import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { Activity, ActivityKind, Display, PlanItem, PlanStatus, Robot, Step, World } from '../types'
import { addTokens, champion, dailyTotals, dayOf, dayOfKey, formatTokens, lastDays, tokensKey } from './tally'
import { avatarSvg, buildScene, CAPACITY, CHART_DAYS, chartRows, floorsFor, girthOf, hitTest, MAX_FLOORS, phaseOf, progressSvg, roleInfo, roleOf, sceneHeight, skyKey, transitionsOf, W } from './scene'
import type { Progress, TaskState } from './scene'

const PANE = 'office'
const STEPS_KEPT = 60
// The picture reloads whenever its drawing changes, so changes are held and batched.
const HOLD_MS = 1800
const GAP_MS = 1500
const PUBLISH_EVERY_MS = 500
// the whiteboard's chart re-reads every chat's totals once a minute, and keeps two weeks of them
const HISTORY_EVERY_MS = 60_000
const HISTORY_DAYS = 14
const LIST_KEEP_MS = 120_000

// Change a shape tag when its type changes: it declines what an older version stored.
const world = atom({ plugin: 'tin-collar', key: 'world' } as const, { home: '', floors: 0, robots: [], steps: {} }, { shape: 'world-4' })
const display = atom({ plugin: 'tin-collar', key: 'display' } as const, { at: 0, home: '', floors: 0, robots: [], selected: '' }, { shape: 'display-3' })
const selected = atom({ plugin: 'tin-collar', key: 'selected' } as const, '')

/* The last card press, so a press that reaches the module twice opens it once. */
let lastPress = { element: '', at: 0 }

/* Which robot started which Agent call, so a printed robot knows its parent. */
const spawnParent = new Map<string, string>()

/* ---------- reading a tool call ---------- */
type Args = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

function diffOf(before: string, after: string): string {
  const a = before.split('\n').slice(0, 40)
  const b = after.split('\n').slice(0, 40)
  return [`@@ -1,${a.length} +1,${b.length} @@`, ...a.map((l) => `-${l}`), ...b.map((l) => `+${l}`)].join('\n')
}

type Described = { kind: ActivityKind; label: string; diff?: string }
function describe(tool: string, a: Args): Described {
  const d = (kind: ActivityKind, label: string, diff?: string): Described => ({ kind, label: clip(label, 40), diff })
  switch (tool) {
    case 'Read':
      return d('read', base(str(a.file_path)))
    case 'Edit':
      return d('write', base(str(a.file_path)), diffOf(str(a.old_string), str(a.new_string)))
    case 'Write':
      return d('write', base(str(a.file_path)), diffOf('', str(a.content)))
    case 'NotebookEdit':
      return d('write', base(str(a.notebook_path)))
    case 'Grep':
    case 'Glob':
      return d('search', str(a.pattern))
    case 'ToolSearch':
      return d('search', str(a.query))
    case 'WebSearch':
      return d('web', str(a.query))
    case 'WebFetch': {
      let host = str(a.url)
      try {
        host = new URL(host).hostname
      } catch {}
      return d('web', host)
    }
    case 'Bash':
    case 'PowerShell':
      return d('run', str(a.description) || str(a.command).trim().split(/\s+/)[0] || tool)
    case 'Agent':
      return d('spawn', str(a.description) || 'a helper')
    case 'Workflow':
      return d('spawn', 'a workflow')
    case 'AskUserQuestion': {
      const q = Array.isArray(a.questions) ? (a.questions[0] as Args | undefined) : undefined
      return d('ask', str(q?.header) || 'a question')
    }
    case 'SendMessage':
      return d('talk', str(a.to) || 'another agent')
    case 'Skill':
      return d('read', str(a.skill))
  }
  if (PLAN_TOOLS.has(tool) || tool === WRAP_UP) return d('think', 'its plan')
  if (tool.startsWith('mcp__')) {
    const parts = tool.split('__')
    return d('mcp', (parts[parts.length - 1] ?? tool).replace(/_/g, ' '))
  }
  return d('tool', tool)
}

/* ---------- the plan each agent keeps ---------- */
const UPDATE_PLAN = 'mcp__ccd_turn__update_plan'
const WRAP_UP = 'mcp__ccd_turn__wrap_up'
const PLAN_TOOLS = new Set([UPDATE_PLAN, 'TodoWrite', 'TaskCreate', 'TaskUpdate'])

const statusOf = (v: unknown): PlanStatus => (v === 'completed' || v === 'done' ? 'completed' : v === 'in_progress' ? 'in_progress' : 'pending')

/** Follows the planning tools the way they change a plan, so progress is the agent's own. */
function applyPlan(plan: PlanItem[] | undefined, tool: string, a: Args): PlanItem[] | undefined {
  if (tool === UPDATE_PLAN) {
    let items: PlanItem[] = (plan ?? []).map((i) => ({ ...i }))
    if (Array.isArray(a.items)) items = a.items.map((it) => ({ text: str((it as Args).content), status: statusOf((it as Args).status) }))
    if (a.advance === true) {
      const now = items.find((i) => i.status === 'in_progress')
      if (now) now.status = 'completed'
      const next = items.find((i) => i.status === 'pending')
      if (next) next.status = 'in_progress'
    }
    if (Array.isArray(a.done)) for (const n of a.done) if (typeof n === 'number' && items[n - 1]) items[n - 1]!.status = 'completed'
    if (typeof a.start === 'number' && items[a.start - 1]) items[a.start - 1]!.status = 'in_progress'
    return items
  }
  if (tool === WRAP_UP) return plan?.map((i) => ({ ...i, status: 'completed' as const }))
  if (tool === 'TodoWrite' && Array.isArray(a.todos))
    return a.todos.map((t) => ({ text: str((t as Args).content) || str((t as Args).activeForm), status: statusOf((t as Args).status) }))
  if (tool === 'TaskCreate') return [...(plan ?? []), { text: str(a.subject) || str(a.description), status: 'pending' }]
  if (tool === 'TaskUpdate') {
    const n = Number(a.taskId)
    if (!plan || !Number.isInteger(n) || !plan[n - 1]) return plan
    return plan.map((i, k) => (k === n - 1 ? { ...i, status: a.status ? statusOf(a.status) : i.status } : i))
  }
  return plan
}

/** One step as a sentence a person would write. */
function phrase(s: Step): string {
  const l = s.label
  if (PLAN_TOOLS.has(s.tool)) return 'Updated its plan'
  if (s.tool === WRAP_UP) return 'Wrapped up'
  switch (s.kind) {
    case 'read':
      return s.tool === 'Skill' ? `Loaded the ${l} skill` : `Read ${l}`
    case 'search':
      return `Searched for “${l}”`
    case 'web':
      return `Looked up ${l}`
    case 'write':
      return s.tool === 'Write' ? `Wrote ${l}` : `Edited ${l}`
    case 'run':
      return `Ran: ${l}`
    case 'spawn':
      return `Printed a helper: ${l}`
    case 'ask':
      return `Asked you about ${l}`
    case 'talk':
      return `Messaged ${l}`
    case 'mcp':
      return `Used ${l}`
    case 'done':
    case 'error':
      return l
    default:
      return `Used ${l || s.tool}`
  }
}

/* ---------- changing the world ---------- */
const mainRobot = (now: number): Robot => ({
  id: 'main',
  type: 'main',
  role: 'main',
  description: 'Main agent',
  status: 'idle',
  spawnedAt: now,
  seat: -1,
  activity: { kind: 'idle', label: '', since: now },
  calls: 0,
  errors: 0,
})

/* A robot keeps its desk until it has walked out of the room. */
function holdsSeat(r: Robot, floors: number, now: number): boolean {
  if (r.type === 'main') return false
  if (r.endedAt === undefined) return true
  const p = phaseOf(r, floors)
  return p !== null && p.leaveAt !== null && now < p.leaveAt + 300
}

function freeSeat(w: World, now: number): number {
  const taken = new Set(w.robots.filter((r) => r.seat < CAPACITY && holdsSeat(r, w.floors, now)).map((r) => r.seat))
  let s = 0
  while (taken.has(s)) s++
  return s
}

const withFloors = (w: World, seat: number): World => ({ ...w, floors: Math.max(w.floors, Math.min(MAX_FLOORS, floorsFor(seat))) })

/* Old robots leave the list; robots queued for lack of desks get one as desks free up. */
function tidy(w: World, now: number): World {
  let v: World = { ...w, robots: w.robots.filter((r) => r.endedAt === undefined || now - r.endedAt < LIST_KEEP_MS) }
  for (const r of v.robots) {
    if (r.type === 'main' || r.seat < CAPACITY || r.endedAt !== undefined) continue
    const seat = freeSeat(v, now)
    if (seat >= CAPACITY) break
    v = withFloors({ ...v, robots: v.robots.map((o) => (o.id === r.id ? { ...o, seat, spawnedAt: now } : o)) }, seat)
  }
  return v
}

function ensure(w: World, id: string, now: number): World {
  if (w.robots.some((r) => r.id === id)) return w
  if (id === 'main') return { ...w, robots: [mainRobot(now), ...w.robots] }
  const seat = freeSeat(w, now)
  const r: Robot = {
    id,
    type: 'agent',
    description: 'Helper',
    status: 'working',
    spawnedAt: now,
    seat,
    activity: { kind: 'think', label: '', since: now },
    calls: 0,
    errors: 0,
  }
  return withFloors({ ...w, robots: [...w.robots, r] }, seat)
}

function patch(w: World, id: string, now: number, fn: (r: Robot) => Robot): World {
  const v = ensure(tidy(w, now), id, now)
  return { ...v, robots: v.robots.map((r) => (r.id === id ? fn(r) : r)) }
}

function addStep(w: World, id: string, step: Step): World {
  return { ...w, steps: { ...w.steps, [id]: [...(w.steps[id] ?? []), step].slice(-STEPS_KEPT) } }
}

function startStep(w: World, id: string, stepId: string, tool: string, d: Described, args: Args, now: number): World {
  const v = patch(w, id, now, (r) => ({
    ...r,
    status: 'working',
    calls: r.calls + 1,
    plan: applyPlan(r.plan, tool, args),
    activity: d.kind === 'think' ? r.activity : { kind: d.kind, label: d.label, since: now },
  }))
  return addStep(v, id, { id: stepId, tool, kind: d.kind, label: d.label, startedAt: now, diff: d.diff })
}

function endStep(w: World, id: string, stepId: string, ran: ToolCallResult, now: number): World {
  const r = ran as { deny?: string; isError?: boolean }
  const isError = !!r.deny || !!r.isError
  const list = (w.steps[id] ?? []).map((s) => (s.id === stepId ? { ...s, endedAt: now, isError } : s))
  const stillOpen = list.some((s) => s.endedAt === undefined)
  return patch({ ...w, steps: { ...w.steps, [id]: list } }, id, now, (rb) => ({
    ...rb,
    errors: rb.errors + (isError ? 1 : 0),
    activity: stillOpen || rb.status !== 'working' ? rb.activity : { kind: 'think', label: '', since: now },
  }))
}

const roleIdOf = (r: Robot) => r.role ?? roleOf(r.type, r.description)

/* ---------- the picture: held and batched ---------- */
function shown(d: Display, now: number): Robot[] {
  return d.robots.filter((r) => {
    if (r.type === 'main') return true
    if (r.seat >= CAPACITY) return r.endedAt === undefined
    const p = phaseOf(r, d.floors)
    return p !== null && (p.goneAt === null || p.goneAt > now)
  })
}
const visualKey = (d: Display, now: number) =>
  JSON.stringify([
    d.home,
    d.floors,
    d.selected,
    frameKey(d, now),
    chartRows(dailyTotals(d.tokens, d.history, now, CHART_DAYS)),
    // the window follows the hour of the picture's own moment
    skyKey(d.at),
    shown(d, now).map((r) => [r.id, roleIdOf(r), r.seat, r.status, r.activity.kind, r.activity.label, r.spawnedAt, r.endedAt ?? 0, girthOf(r.context)]),
  ])
const structureKey = (d: Display, now: number) =>
  JSON.stringify([d.home, d.floors, d.selected, shown(d, now).map((r) => [r.id, roleIdOf(r), r.seat, r.status, r.spawnedAt])])

function nextDisplay(w: World, prev: Display, sel: string, now: number): Display {
  const robots = w.robots.map((r): Robot => {
    const old = prev.robots.find((o) => o.id === r.id)
    if (old && old.status === r.status && r.status === 'working' && now - old.activity.since < HOLD_MS) return { ...r, activity: old.activity }
    const same = old && old.activity.kind === r.activity.kind && old.activity.label === r.activity.label
    return { ...r, activity: same ? old.activity : { ...r.activity, since: now } }
  })
  return { at: now, home: w.home, floors: w.floors, robots, selected: sel, tokens: w.tokens, history: w.history }
}

/** What the Employee of the Day frame shows, as it is drawn: changes below this go unseen. */
function frameKey(d: Display, now: number): string {
  const best = champion(d.tokens, now)
  return best ? `${best.id}:${best.role}:${formatTokens(best.tokens)}/${formatTokens(d.tokens?.total ?? 0)}` : ''
}

/** Adds one model request's tokens to the robot that made it. */
function tallyTokens(w: World, id: string, used: number, now: number): World {
  const r = w.robots.find((x) => x.id === id)
  const who = { id, role: r ? roleIdOf(r) : id === 'main' ? 'main' : 'helper', name: r ? robotName(r) : 'Helper' }
  return { ...w, tokens: addTokens(w.tokens, who, used, now) }
}

/** Records how full a robot's context window is, from its latest model request. */
function withContext(w: World, id: string, context: number): World {
  return { ...w, robots: w.robots.map((r) => (r.id === id ? { ...r, context } : r)) }
}

/** Keeps this chat's total for today in the plugin's store, where every chat's chart reads it. */
async function saveTokens($: EngineInterface) {
  const t = (await read($, world)).tokens
  if (t) await $.store.set(tokensKey(t.day, await $.session.id()), t.total)
}

/** Reads every chat's daily totals from the store for the chart, and forgets days past two weeks. */
async function loadHistory($: EngineInterface) {
  const now = Date.now()
  const kept = new Set(lastDays(now, HISTORY_DAYS))
  const mine = tokensKey(dayOf(now), await $.session.id())
  const totals: Record<string, number> = {}
  for (const key of await $.store.keys()) {
    const day = dayOfKey(key)
    if (day === null) continue
    if (!kept.has(day)) {
      await $.store.delete(key)
      continue
    }
    if (key === mine) continue
    const v = Number(await $.store.get(key))
    if (Number.isFinite(v) && v > 0) totals[day] = (totals[day] ?? 0) + v
  }
  const w = await read($, world)
  if (JSON.stringify(w.history ?? {}) !== JSON.stringify(totals)) await update($, world, (x) => ({ ...x, history: totals }))
}

/**
 * The picture plays each robot's one-off moves (printing, the walk, the jump into the vat) from
 * the moment it was drawn, so a reopened or resized pane would play them again. Once every move
 * drawn into the picture has played, a fresh picture holds the scene still instead.
 */
function hasPlayedOut(d: Display, now: number): boolean {
  if (!d.at) return false
  let played = false
  for (const r of d.robots) {
    if (r.type === 'main') continue
    for (const t of transitionsOf(r, d.floors)) {
      if (t <= d.at) continue
      if (t > now - 300) return false
      played = true
    }
  }
  return played
}

async function publish($: EngineInterface, fresh = false) {
  const now = Date.now()
  const w = await read($, world)
  const prev = await read($, display)
  const sel = await read($, selected)
  const next = nextDisplay(w, prev, sel, now)
  const settle = fresh || hasPlayedOut(prev, now)
  if (!settle && visualKey(next, now) === visualKey(prev, now)) return
  const structural = settle || structureKey(next, now) !== structureKey(prev, now)
  if (!structural && now - prev.at < GAP_MS) return
  await update($, display, () => next)
}

/* When the picture's clock starts: when its display was taken, or when the pane was resized. */
let pictureClock = { displayAt: -1, drawnAt: 0, columns: -1 }
let lastPicture = { key: '', svg: '' }
function pictureOf(d: Display, columns: number, now: number): string {
  if (pictureClock.displayAt !== d.at) pictureClock = { ...pictureClock, displayAt: d.at, drawnAt: d.at || now }
  if (pictureClock.columns !== columns) pictureClock = { ...pictureClock, columns, drawnAt: now }
  const key = `${d.at}|${pictureClock.drawnAt}|${d.selected}`
  if (lastPicture.key !== key) {
    const robots = d.robots.map((r) => ({ ...r, role: roleIdOf(r) }))
    lastPicture = { key, svg: buildScene({ home: d.home, floors: d.floors, robots, steps: {}, tokens: d.tokens, history: d.history }, pictureClock.drawnAt, d.selected) }
  }
  return lastPicture.svg
}

/* ---------- the pane's words ---------- */
const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const fmtDur = (s: Step) => (s.endedAt === undefined ? 'now' : `${((s.endedAt - s.startedAt) / 1000).toFixed(1)}s`)
const fmtAge = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}
const sentence = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s)
/** 850, 8.4k, 48.2k, 152k, 1.2M: as Claude Code writes token counts. */
const fmtContext = (n: number) => {
  const one = (v: number) => v.toFixed(1).replace(/\.0$/, '')
  return n >= 1e6 ? `${one(n / 1e6)}M` : n >= 1e5 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${one(n / 1e3)}k` : String(n)
}
const robotName = (r: Robot) => (r.type === 'main' ? 'Main agent' : sentence(clip(r.description, 40)))
const ACTIVITY_WORD: Record<ActivityKind, string> = {
  idle: 'resting', think: 'thinking', read: 'reading', search: 'searching', web: 'looking it up', write: 'writing code',
  run: 'running a command', spawn: 'printing a helper', ask: 'waiting on you', talk: 'messaging', mcp: 'using a connector',
  tool: 'using a tool', done: 'finished', error: 'hit a problem',
}
const stateWord = (r: Robot) => {
  if (r.status === 'done') return 'finished'
  if (r.status === 'failed') return 'stopped early'
  if (r.seat >= CAPACITY && r.type !== 'main') return 'waiting for a desk'
  const label = r.activity.label ? ` ${clip(r.activity.label, 28)}` : ''
  return `${ACTIVITY_WORD[r.activity.kind]}${label}`
}
/** Real progress: the agent's own plan when it keeps one, else the steps it has taken this turn. */
function progressOf(r: Robot, steps: Step[]): { bar: Progress; label: string } {
  const plan = r.plan
  if (plan && plan.length) {
    const done = plan.filter((i) => i.status === 'completed').length
    const cur = plan.findIndex((i) => i.status === 'in_progress')
    const label =
      done === plan.length
        ? `All ${plan.length} steps done`
        : cur >= 0
          ? `Step ${cur + 1} of ${plan.length} · ${clip(plan[cur]!.text, 40)}`
          : `${done} of ${plan.length} steps done`
    return { bar: { mode: 'plan', statuses: plan.map((i) => i.status) }, label }
  }
  const since = r.turnStartedAt ?? r.spawnedAt
  const taken = steps.filter((s) => s.startedAt >= since && s.tool !== 'Report')
  const kinds = taken.map((s): ActivityKind => (s.isError ? 'error' : s.kind))
  const resting = r.type === 'main' && r.status === 'idle'
  const state = r.status === 'done' || resting ? 'done' : r.status === 'failed' ? 'failed' : 'running'
  const count = `${taken.length} ${taken.length === 1 ? 'step' : 'steps'}`
  const label = resting
    ? taken.length
      ? `Resting · last turn took ${count}`
      : 'Resting'
    : state === 'done'
      ? `Done · ${count}`
      : state === 'failed'
        ? `Stopped · ${count}`
        : taken.length
          ? `${count} · ${stateWord(r)}`
          : stateWord(r)
  return { bar: { mode: 'trail', kinds, state }, label }
}

/** Where a task stands, as Claude Code's tasks list says it. */
function taskState(r: Robot): TaskState {
  if (r.status === 'done') return 'done'
  if (r.status === 'failed') return 'failed'
  if (r.type === 'main' && r.status === 'idle') return 'idle'
  return r.activity.kind === 'ask' ? 'waiting' : 'running'
}
function statusText(r: Robot, now: number): string {
  const age = fmtAge((r.endedAt ?? now) - r.spawnedAt)
  switch (taskState(r)) {
    case 'done':
      return `Done · ${age}`
    case 'failed':
      return 'Stopped'
    case 'waiting':
      return 'Needs you'
    case 'idle':
      return 'Idle'
    default:
      return r.type === 'main' ? 'Working' : `Running · ${age}`
  }
}
const STATE_COLOR: Record<TaskState, string> = { running: 'suggestion', waiting: 'warning', done: 'success', failed: 'error', idle: 'inactive' }
const STEP_ICON = (s: Step): [string, string] =>
  s.isError ? ['✕', '#ff6b6b'] : s.endedAt === undefined ? ['●', '#6aa5ff'] : ['✓', '#4fd17f']

const portraitKind = (r: Robot): ActivityKind => (r.status === 'done' ? 'done' : r.status === 'failed' ? 'error' : r.activity.kind)

async function openTranscript($: EngineInterface, id: string) {
  const res = await $.ui.view(id === 'main' ? {} : { agentId: id })
  if ('deny' in res && res.deny) $.ui.toast('That transcript is no longer available.')
}

async function lastWords($: EngineInterface, id: string): Promise<string> {
  try {
    const rows = await $.session.messages(id === 'main' ? {} : { agentId: id })
    if (!Array.isArray(rows)) return ''
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i]
      if (row?.role === 'assistant' && row.text.trim()) return clip(row.text.trim(), 1500)
    }
  } catch {}
  return ''
}

async function choose($: EngineInterface, id: string) {
  await update($, selected, (cur) => (cur === id ? '' : id))
  await publish($)
}

/* Every hook below only watches: if one fails, the work it watched goes on untouched. */
export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    try {
      const now = Date.now()
      const home = base(e.cwd ?? '') || 'Office'
      await update($, world, (w) => ensure({ ...w, home }, 'main', now))
      await $.command.register({ name: 'office', description: 'Open the Tin Collar office pane' })
      await $.ui.open({ id: PANE, title: 'Office' })
      $.clock.every(PUBLISH_EVERY_MS, () => void publish($).catch(() => {}))
      $.clock.every(HISTORY_EVERY_MS, () => void loadHistory($).catch(() => {}))
      void loadHistory($).catch(() => {})
    } catch {}
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    const res = await next(e)
    try {
      await publish($, true)
    } catch {}
    return res
  })

  on('command.run', { command: 'office' }, async ($) => {
    const opened = await $.ui.open({ id: PANE, title: 'Office' })
    return { text: opened.isPlaced ? 'Office pane opened.' : 'The office pane opens when there is room for it.' }
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? 'main'
    const stepId = e.tool_use_id ?? `${e.tool}-${Date.now()}`
    let started = false
    try {
      const args = e as unknown as Args
      const d = describe(String(e.tool), args)
      if (e.tool === 'Agent' && e.tool_use_id) spawnParent.set(e.tool_use_id, id)
      await update($, world, (w) => startStep(w, id, stepId, String(e.tool), d, args, Date.now()))
      started = true
    } catch {}
    const ran = await next(e)
    if (started) {
      try {
        await update($, world, (w) => endStep(w, id, stepId, ran, Date.now()))
      } catch {}
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const res = await next(e)
    try {
      const agentId = 'agentId' in res ? res.agentId : undefined
      if (agentId) {
        const now = Date.now()
        const parentId = spawnParent.get(e.tool_use_id) ?? 'main'
        const type = e.subagentType || 'agent'
        const role = roleOf(type, e.description ?? '', (e.prompt ?? '').slice(0, 400))
        await update($, world, (w) =>
          patch(w, agentId, now, (r) => ({
            ...r,
            type,
            role,
            description: e.description || r.description,
            model: 'model' in res ? res.model : r.model,
            parentId,
            toolUseId: e.tool_use_id || r.toolUseId,
          })),
        )
        await publish($)
      }
    } catch {}
    return res
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const res = await next(e)
    try {
      const id = e.agentId ?? 'main'
      const now = Date.now()
      await update($, world, (w) =>
        patch(w, id, now, (r) => ({
          ...r,
          status: 'working',
          endedAt: undefined,
          plan: id === 'main' ? undefined : r.plan,
          turnStartedAt: now,
          activity: r.activity.kind === 'idle' || r.activity.kind === 'done' ? { kind: 'think', label: '', since: now } : r.activity,
        })),
      )
    } catch {}
    return res
  })

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    try {
      const id = e.agentId ?? 'main'
      const now = Date.now()
      await update($, world, (w) => {
        if (id === 'main') {
          const a: Activity =
            e.reason === 'error'
              ? { kind: 'error', label: 'API ERROR', since: now }
              : e.reason === 'refusal'
                ? { kind: 'error', label: 'REFUSED', since: now }
                : { kind: 'idle', label: '', since: now }
          return patch(w, id, now, (r) => ({ ...r, status: 'idle', activity: a }))
        }
        const failed = e.reason === 'error' || e.reason === 'aborted'
        const v = patch(w, id, now, (r) => ({
          ...r,
          status: failed ? 'failed' : 'done',
          endedAt: now,
          activity: { kind: failed ? 'error' : 'done', label: failed ? 'FAILED' : 'REPORT', since: now },
        }))
        return addStep(v, id, {
          id: `${e.turnId}-report`,
          tool: 'Report',
          kind: failed ? 'error' : 'done',
          label: failed ? 'Stopped before finishing' : 'Handed back its report',
          startedAt: now,
          endedAt: now,
          isError: failed,
        })
      })
    } catch {}
    return res
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    try {
      const now = Date.now()
      await update($, world, (w) => patch(w, e.agent_id ?? 'main', now, (r) => ({ ...r, activity: { kind: 'ask', label: e.tool_name, since: now } })))
    } catch {}
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    let used = 0
    // what the request carried in, plus what came back: the context window as it now stands
    let context = 0
    for await (const c of next(e)) {
      if (c.kind === 'stop' && c.usage) {
        const u = c.usage
        context = u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
        used += context
      }
      yield c
    }
    if (used > 0) {
      const id = e.agentId ?? 'main'
      void update($, world, (w) => withContext(tallyTokens(w, id, used, Date.now()), id, context))
        .then(() => saveTokens($))
        .catch(() => {})
    }
  })

  on('ui.message', async ($, e) => {
    if (e.element.startsWith('card-')) {
      const now = Date.now()
      if (lastPress.element === e.element && now - lastPress.at < 350) return {}
      lastPress = { element: e.element, at: now }
      try {
        await choose($, e.element.slice(5))
      } catch {}
      return {}
    }
    if (e.element !== 'hit') return {}
    try {
      const d = e.data as { fx?: number; fy?: number }
      const held = await read($, display)
      const shownNow = held.at ? held : nextDisplay(await read($, world), held, await read($, selected), Date.now())
      const sx = (d.fx ?? 0) * W
      const sy = (d.fy ?? 0) * sceneHeight(shownNow.floors)
      const id = hitTest({ home: shownNow.home, floors: shownNow.floors, robots: shownNow.robots, steps: {} }, Date.now(), sx, sy)
      if (id) await choose($, id)
    } catch {}
    return {}
  })

  // Each helper's row in the chat carries the same robot that works in the office.
  on('ui.render', { component: 'ToolUse', props: { tool: 'Agent' } }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface === 'terminal' || e.props.isExpanded) return row
    try {
      const w = await read($, world)
      const r = w.robots.find((x) => x.toolUseId === e.props.tool_use_id)
      if (!r) return row
      const { Box, Svg } = $.ui.resolve(e) as ElementTable<'vscode'>
      return (
        <Box flexDirection="row" gap={1} alignItems="flex-start">
          <Svg source={avatarSvg(roleIdOf(r), portraitKind(r), taskState(r))} alt={`${roleInfo(roleIdOf(r)).title}: ${robotName(r)}`} width={32} height={32} />
          <Box flexDirection="column" flexGrow={1}>
            {row}
          </Box>
        </Box>
      )
    } catch {
      return row
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code, Markdown } = $.ui.resolve(e) as ElementTable<'vscode'>
    const w = await read($, world)
    const shownNow = await read($, display)
    const picked = await read($, selected)
    const now = Date.now()
    // Opening an agent from Claude Code's own tasks list opens its task here too.
    const sel = picked || e.props.view.agentId || ''
    const Svg = e.surface !== 'terminal' ? ($.ui.resolve(e) as ElementTable<'vscode'>).Svg : null
    const Client = e.surface === 'desktop' ? ($.ui.resolve(e) as ElementTable<'desktop'>).Client : null

    const robots = w.robots
      .filter((r) => r.type === 'main' || r.endedAt === undefined || now - r.endedAt < LIST_KEEP_MS)
      .sort((a, b) => Number(a.type !== 'main') - Number(b.type !== 'main') || Number(a.endedAt !== undefined) - Number(b.endedAt !== undefined) || a.spawnedAt - b.spawnedAt)

    // A task's details, opened under its row: plan, recent steps, latest change, last message.
    const details = async (r: Robot) => {
      const steps = w.steps[r.id] ?? []
      const recent = steps.slice(-8)
      const change = [...steps].reverse().find((s) => s.diff)
      const said = await lastWords($, r.id)
      const role = roleInfo(roleIdOf(r))
      const meta = [role.title, r.model ?? '', `started ${fmtTime(r.spawnedAt)}`, `${r.calls} ${r.calls === 1 ? 'step' : 'steps'}`].filter(Boolean).join(' · ')
      return (
        <Box flexDirection="column" gap="xs" paddingTop="xs">
          <Text dimColor size="caption">
            {meta}
          </Text>
          {r.plan && r.plan.length ? (
            <Box flexDirection="column">
              {r.plan.map((i) => (
                <Text dimColor={i.status === 'completed'} bold={i.status === 'in_progress'} wrap="truncate-end">
                  <Text color={i.status === 'completed' ? '#4fd17f' : i.status === 'in_progress' ? '#ffc35c' : '#8f98b3'}>
                    {i.status === 'completed' ? '✓' : i.status === 'in_progress' ? '●' : '○'}
                  </Text>{' '}
                  {i.text}
                </Text>
              ))}
            </Box>
          ) : null}
          <Box flexDirection="column">
            {recent.length === 0 && <Text dimColor>Nothing yet.</Text>}
            {recent.map((s) => {
              const [icon, color] = STEP_ICON(s)
              return (
                <Text wrap="truncate-end">
                  <Text color={color}>{icon}</Text> {phrase(s)}
                  <Text dimColor>{s.tool === 'Report' ? '' : `  ${fmtDur(s)}`}</Text>
                </Text>
              )
            })}
          </Box>
          {change?.diff ? (
            <Box flexDirection="column">
              <Text dimColor size="caption">
                Latest change · {change.label}
              </Text>
              <Code source={change.diff} format="diff" />
            </Box>
          ) : null}
          {said ? (
            <Box flexDirection="column">
              <Text dimColor size="caption">
                Last message
              </Text>
              <Markdown text={said} />
            </Box>
          ) : null}
          {r.type === 'main' ? null : (
            <Box flexDirection="row">
              <Button key={`open-${r.id}`} onPress={() => void openTranscript($, r.id)}>
                Open transcript
              </Button>
            </Box>
          )}
        </Box>
      )
    }

    // Each task is a card: portrait, title and role, a status chip, then its progress.
    // A click anywhere on the card's face opens or closes its details.
    const cards = []
    for (const r of robots) {
      const held = shownNow.robots.find((o) => o.id === r.id) ?? r
      const role = roleInfo(roleIdOf(r))
      const progress = progressOf(r, w.steps[r.id] ?? [])
      const open = r.id === sel
      const state = taskState(r)
      const detailLine = [r.type === 'main' ? '' : role.title, r.model ?? '', progress.label].filter(Boolean).join(' · ')
      const face = (
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" gap="sm" alignItems="center">
            {Svg ? <Svg source={avatarSvg(role.id, portraitKind(held), state)} alt={`${role.title}: ${robotName(r)}`} width={30} height={30} /> : null}
            <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
              <Text bold wrap="truncate-end">
                {robotName(r)}
              </Text>
              <Text dimColor size="caption" wrap="truncate-end">
                {detailLine}
              </Text>
            </Box>
            <Box flexDirection="column" alignItems="flex-end" flexShrink={0}>
              <Text color={STATE_COLOR[state]} size="caption" wrap="truncate-end">
                ● {statusText(r, now)}
              </Text>
              {r.context ? (
                <Text dimColor size="caption" wrap="truncate-end">
                  {fmtContext(r.context)} context
                </Text>
              ) : null}
            </Box>
          </Box>
          {Svg ? <Svg source={progressSvg(progress.bar, role.id, 320)} alt={progress.label} /> : null}
        </Box>
      )
      const clickable = Client ? (
        <Box position="relative" flexDirection="column">
          {face}
          <Box position="absolute" top={0} left={0} width="100%" height="100%">
            <Client key={`card-${r.id}`} module="./hit.tsx" width="100%" height="100%" props={{ version: 1 }} />
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" gap="xs">
          {face}
          <Box flexDirection="row">
            <Button key={`card-${r.id}`} onPress={() => void choose($, r.id)}>
              {open ? 'Hide details' : 'Details'}
            </Button>
          </Box>
        </Box>
      )
      cards.push(
        <Box
          key={`task-${r.id}`}
          flexDirection="column"
          gap="xs"
          paddingX="sm"
          paddingY="xs"
          borderStyle="round"
          borderColor={open ? 'promptBorder' : 'subtle'}
          backgroundColor="#ffffff08"
          hover={{ backgroundColor: '#ffffff12', borderColor: 'promptBorder' }}
        >
          {clickable}
          {open ? await details(r) : null}
        </Box>,
      )
    }
    const list = (
      <Box flexDirection="column" gap="xs">
        {cards}
      </Box>
    )

    if (!Svg) return list

    // A plain image, not a frame: swapping an image does not reload a page.
    const svg = pictureOf(shownNow.at ? shownNow : nextDisplay(w, shownNow, picked, now), e.props.bodyColumns, now)
    const picture = <Svg source={svg} alt={`Tin Collar office: ${robots.map((r) => `${robotName(r)} ${stateWord(r)}`).join(', ')}`} />
    const room = Client ? (
      <Box position="relative">
        {picture}
        <Box position="absolute" top={0} left={0} width="100%" height="100%">
          <Client key="hit" module="./hit.tsx" width="100%" height="100%" props={{ version: 1 }} />
        </Box>
      </Box>
    ) : (
      picture
    )

    return (
      <Box flexDirection="column" gap={1}>
        {room}
        {list}
      </Box>
    )
  })
}
