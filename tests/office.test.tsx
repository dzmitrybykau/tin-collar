import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Robot } from '../types'
import { buildScene, CAPACITY, chartRows, exitSlot, fit, floorsFor, girthOf, hasStoodUp, layPicture, noLayers, phaseOf, positionOf, printSlot, roleOf, seatFor, skyKey, transitionsOf } from '../hooks/scene'
import { addTokens, champion, dailyTotals, dayOfKey, formatTokens, lastDays, tokensKey } from '../hooks/tally'

const PANE = {
  plugin: 'tin-collar',
  component: 'Pane',
  requestId: 'office',
  props: {
    title: 'Office',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

// Nothing sits beneath the plugin: each hook here stands for the engine.
function engine(on: On) {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'office' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: [] }))
  on('tool.call', () => ({ result: {}, text: 'export function login() {}' }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'a1' }))
}

async function spawnExplorer($: Engine) {
  // The kit's spawn takes the engine's whole input; the fields the mod reads are these.
  const spawn = { prompt: 'Find every route', description: 'Map routes', subagentType: 'Explore', tool_use_id: 'toolu_1' }
  await $.agent.spawn(spawn as unknown as Parameters<typeof $.agent.spawn>[0])
}

test('clicking the main robot in the room opens its trace', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: 'C:/work/acme-api', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: 'C:/work/acme-api/auth.ts' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Main agent$/ })).toBeDefined()

  // The main robot's head is at about x 110, y 114 of the 256 x 184 picture.
  await ui.resize({ columns: 50, rows: 20, in: 'hit' })
  await ui.pointer({ type: 'down', x: 21, y: 12, button: 'left', in: 'hit' })

  expect(await ui.find({ type: 'Text', text: /Read auth\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /started/ })).toBeDefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /redraws|chars/ })).toBeUndefined()
  await ui.unmount()
})

test('a printed subagent gets its own robot, portrait and trace', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: 'C:/work/acme-api', surface: 'desktop', isInteractive: true })
  await spawnExplorer($)
  await $.tool.call({ tool: 'Grep', pattern: 'router', agentId: 'a1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Map routes$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Explorer · haiku · 1 step/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Svg' })).length).toBeGreaterThanOrEqual(3)
  expect(await ui.find({ type: 'Text', text: /Searched for .router./ })).toBeUndefined()
  // one click, its press and its release, opens the card once
  await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'card-a1' })
  await ui.pointer({ type: 'up', x: 2, y: 0, button: 'left', in: 'card-a1' })
  expect(await ui.find({ type: 'Text', text: /Searched for .router./ })).toBeDefined()
  expect(await ui.find({ key: 'open-a1' })).toBeDefined()
  await ui.unmount()
})

test("a subagent's card shows how much context it carries", async ($, on) => {
  engine(on)
  const usage = { input_tokens: 200, output_tokens: 800, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 7_200, model: 'haiku' }
  on('turn.step', async function* (_, e) {
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  await $.session.start({ cwd: 'C:/work/acme-api', surface: 'desktop', isInteractive: true })
  await spawnExplorer($)
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'haiku', messageCount: 3, agentId: 'a1' })) void _

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^48\.2k context$/ })).toBeDefined()
  await ui.unmount()
})

test("a subagent's row in the chat carries its robot", async ($, on) => {
  engine(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  await $.session.start({ cwd: 'C:/work/acme-api', surface: 'desktop', isInteractive: true })
  await spawnExplorer($)

  const ui = await $.ui.mount({
    plugin: 'tin-collar',
    component: 'ToolUse',
    requestId: 'toolu_1',
    surface: 'desktop',
    props: { tool_use_id: 'toolu_1', tool: 'Agent', input: {}, isRunning: true, isErrored: false, isInterrupted: false },
  })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /engine row/ })).toBeDefined()
  await ui.unmount()
})

test('the terminal gets the list and trace without pictures', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: 'C:/work/acme-api', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.press({ key: 'card-main' })
  expect(await ui.find({ type: 'Text', text: /Ran: Run the tests/ })).toBeDefined()
  await ui.unmount()
})

test('a fast subagent still reaches its desk and works before it leaves', async () => {
  const robot: Robot = {
    id: 'a1', type: 'Explore', description: 'Quick', status: 'done', spawnedAt: 0, endedAt: 1000, seat: 0,
    activity: { kind: 'done', label: '', since: 1000 }, calls: 1, errors: 0,
  }
  const p = phaseOf(robot, 0)
  expect(p).not.toBeNull()
  expect(p!.workEnd!).toBeGreaterThanOrEqual(p!.arriveAt + 2500)
  expect(p!.goneAt!).toBeGreaterThan(p!.workEnd!)
})

test('more robots get more floors, five desks each', async () => {
  expect(floorsFor(1)).toBe(0)
  expect(floorsFor(2)).toBe(1)
  expect(floorsFor(7)).toBe(2)
  expect(CAPACITY).toBe(22)
  const top = seatFor(CAPACITY - 1, 4)
  expect(top?.floor).toBe(4)
  expect(seatFor(CAPACITY, 4)).toBeNull()
})

test('robots dress for the role their task names', async () => {
  expect(roleOf('claude', 'Designer picks a robot colour')).toBe('designer')
  expect(roleOf('Plan', 'Architect maps the mod files')).toBe('architect')
  expect(roleOf('general-purpose', 'Coder reads the click layer')).toBe('coder')
  expect(roleOf('Explore', 'Look around')).toBe('explorer')
  expect(roleOf('general-purpose', 'Do the thing')).toBe('helper')
  expect(roleOf('main')).toBe('main')
})

test("a robot's bar follows the plan it keeps", async ($, on) => {
  engine(on)
  await $.session.start({ cwd: 'C:/work/acme-api', surface: 'desktop', isInteractive: true })
  const plan = {
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'Draw the roof', status: 'in_progress' },
      { content: 'Test it', status: 'pending' },
    ],
  }
  await $.tool.call(plan as unknown as Parameters<typeof $.tool.call>[0])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Step 1 of 2 · Draw the roof/ })).toBeDefined()
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true } as unknown as Parameters<typeof $.tool.call>[0])
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Step 2 of 2 · Test it/ })).toBeDefined()
  await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'card-main' })
  expect(await ui.find({ type: 'Text', text: /Draw the roof/ })).toBeDefined()
  await ui.unmount()
})

test('a finished robot hands in its report, then drops into the vat', async () => {
  const robot: Robot = {
    id: 'a1', type: 'Explore', description: 'Quick', status: 'done', spawnedAt: 0, endedAt: 1000, seat: 1,
    activity: { kind: 'done', label: '', since: 1000 }, calls: 1, errors: 0,
  }
  const p = phaseOf(robot, 0)!
  expect(p.leaveAt!).toBeGreaterThan(p.workEnd!)
  expect(p.handAt!).toBeGreaterThan(p.leaveAt!)
  expect(p.jumpAt!).toBeGreaterThan(p.handAt!)
  expect(p.splashAt!).toBeGreaterThan(p.jumpAt!)
  expect(p.goneAt!).toBeGreaterThan(p.splashAt!)
  expect(positionOf(robot, 0, p.handAt! + 10)?.x).toBe(162)
  expect(positionOf(robot, 0, p.goneAt! + 10)).toBeNull()
})

test('the pit is dark, and the vat shows only for a drop through the hatch', async () => {
  const main: Robot = {
    id: 'main', type: 'main', description: 'Main', status: 'working', spawnedAt: -99_999, seat: -1,
    activity: { kind: 'think', label: '', since: 0 }, calls: 0, errors: 0,
  }
  const leaver: Robot = {
    id: 'a1', type: 'Explore', description: 'Quick', status: 'done', spawnedAt: 0, endedAt: 1000, seat: 1,
    activity: { kind: 'done', label: '', since: 1000 }, calls: 1, errors: 0,
  }
  const p = phaseOf(leaver, 1)!
  const scene = (robots: Robot[], now: number) => buildScene({ home: 'Office', floors: 1, robots, steps: {} }, now)
  const vatGlow = 'id="melt"'
  expect(scene([main], 0)).not.toContain(vatGlow)
  expect(scene([main, leaver], p.jumpAt! - 500)).toContain(vatGlow)
  expect(scene([main, leaver], p.goneAt! + 500)).not.toContain(vatGlow)
})

test('a new robot collects its blueprint from the main agent before it sits down', async () => {
  const robot: Robot = {
    id: 'a1', type: 'Plan', description: 'Architect plans it', status: 'working', spawnedAt: 0, seat: 3,
    activity: { kind: 'think', label: '', since: 0 }, calls: 0, errors: 0,
  }
  const p = phaseOf(robot, 1)!
  expect(p.briefAt).toBeGreaterThan(p.printEnd)
  expect(p.briefEnd).toBeGreaterThan(p.briefAt)
  expect(p.arriveAt).toBeGreaterThan(p.briefEnd)
  expect(positionOf(robot, 1, p.briefAt + 100)?.x).toBe(92)
  const times = transitionsOf(robot, 1)
  expect([...times].sort((a, b) => a - b)).toEqual(times)
})

test('the employee of the day is whoever used the most tokens today', async () => {
  const morning = new Date(2026, 10, 11, 9).getTime()
  let tally = addTokens(undefined, { id: 'main', role: 'main', name: 'Main agent' }, 900_000, morning)
  tally = addTokens(tally, { id: 'a1', role: 'coder', name: 'Fix the parser' }, 1_200_000, morning + 1000)
  tally = addTokens(tally, { id: 'main', role: 'main', name: 'Main agent' }, 100_000, morning + 2000)
  expect(tally.total).toBe(2_200_000)
  expect(champion(tally, morning + 3000)?.id).toBe('a1')
  expect(formatTokens(tally.total)).toBe('2.2M')
  expect(formatTokens(12_400)).toBe('12K')
  expect(formatTokens(950)).toBe('950')
  // a new day starts a new tally
  const tomorrow = new Date(2026, 10, 12, 9).getTime()
  expect(champion(tally, tomorrow)).toBeNull()
  expect(addTokens(tally, { id: 'main', role: 'main', name: 'Main agent' }, 5, tomorrow).total).toBe(5)
})

test('the whiteboard charts tokens per day across every chat', () => {
  const today = new Date(2026, 10, 11, 9).getTime()
  const days = lastDays(today, 3)
  expect(days).toEqual(['2026-11-9', '2026-11-10', '2026-11-11'])
  expect(lastDays(new Date(2026, 2, 1, 9).getTime(), 2)).toEqual(['2026-2-28', '2026-3-1'])
  // the other chats' totals, plus this chat's own today
  const mine = addTokens(undefined, { id: 'main', role: 'main', name: 'Main agent' }, 300, today)
  const daily = dailyTotals(mine, { [days[0]!]: 800, [days[1]!]: 400, [days[2]!]: 100 }, today, 3)
  expect(daily).toEqual([800, 400, 400])
  // the busiest day is drawn highest, and equal days level
  const rows = chartRows(daily)
  expect(rows[0]!).toBeLessThan(rows[1]!)
  expect(rows[1]).toBe(rows[2])
  expect(chartRows([0, 0, 0])).toEqual([16, 16, 16])
  // each chat's key in the store names its day
  expect(dayOfKey(tokensKey('2026-11-11', 'abc'))).toBe('2026-11-11')
  expect(dayOfKey('other')).toBeNull()
})

test('a robot fills out as its context grows', () => {
  expect(girthOf(undefined)).toBe(0)
  expect(girthOf(20_000)).toBe(0)
  expect(girthOf(50_000)).toBe(1)
  expect(girthOf(100_000)).toBe(2)
  expect(girthOf(400_000)).toBe(3)
})

test('the window follows the hour on the computer clock', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 12, h, m).getTime()
  expect(skyKey(at(9, 5))).toBe(skyKey(at(9, 55)))
  expect(skyKey(at(9, 55))).not.toBe(skyKey(at(10, 5)))
})

/* ---------- moving about: no robot jumps, and no two stand in one spot ---------- */
const helper = (id: string, seat: number, spawnedAt: number, more: Partial<Robot> = {}): Robot => ({
  id, type: 'general-purpose', description: 'Helper', status: 'working', spawnedAt, seat,
  activity: { kind: 'think', label: '', since: spawnedAt }, calls: 0, errors: 0, ...more,
})

test('a robot walks every step of its way: it never jumps across the room', () => {
  for (const [seat, floors] of [[0, 0], [1, 1], [4, 1], [8, 2]] as const) {
    const robot = helper('a1', seat, 0, { status: 'done', endedAt: 1000 })
    const p = phaseOf(robot, floors)!
    let last = positionOf(robot, floors, 0)!
    for (let t = 20; t < p.jumpAt!; t += 20) {
      const at = positionOf(robot, floors, t)!
      // twenty milliseconds of walking or of the lift is under three pixels; sitting down is six
      expect(Math.abs(at.x - last.x) + Math.abs(at.y - last.y)).toBeLessThanOrEqual(8)
      last = at
    }
  }
})

test('robots started at the same moment are printed one after another', () => {
  const now = 50_000
  let robots: Robot[] = []
  for (const id of ['a1', 'a2', 'a3', 'a4']) {
    const slot = printSlot(robots, 1, now)
    robots = [...robots, helper(id, robots.length, slot.at, { rush: slot.rush })]
  }
  const phases = robots.map((r) => phaseOf(r, 1)!)
  expect(robots[0]!.spawnedAt).toBe(now)
  for (let i = 1; i < phases.length; i++) {
    // the plate is free before the next robot rises on it
    expect(phases[i]!.feedEnd).toBeGreaterThan(phases[i - 1]!.printEnd)
    // and each has left the briefing spot before the next one reaches it
    expect(phases[i]!.briefAt).toBeGreaterThan(phases[i - 1]!.briefEnd)
  }
  // a queue is worked off quickly: four robots are out within twelve seconds
  expect(phases[3]!.printEnd - now).toBeLessThan(12_000)
  // with the printer free again, the next order starts at once
  expect(printSlot(robots, 1, phases[3]!.printEnd + 5000).at).toBe(phases[3]!.printEnd + 5000)
})

test('robots that finish together hand in their reports one at a time', () => {
  const ended = 60_000
  let robots: Robot[] = []
  for (const [id, seat] of [['a1', 0], ['a2', 1], ['a3', 2], ['a4', 3]] as const) {
    const done = helper(id, seat, 0, { status: 'done', endedAt: ended })
    robots = [...robots, { ...done, exitAt: exitSlot(done, robots, 1) }]
  }
  const hands = robots.map((r) => phaseOf(r, 1)!.handAt!).sort((a, b) => a - b)
  for (let i = 1; i < hands.length; i++) expect(hands[i]! - hands[i - 1]!).toBeGreaterThanOrEqual(1500)
  // nobody leaves before its work is over
  for (const r of robots) expect(phaseOf(r, 1)!.workEnd!).toBeGreaterThanOrEqual(ended)
})

test('a robot that has dropped into the vat does not flash back at the hatch', () => {
  const main = helper('main', -1, -99_999, { type: 'main' })
  const leaver = helper('a1', 1, 0, { status: 'done', endedAt: 1000 })
  const p = phaseOf(leaver, 1)!
  const scene = (now: number) => buildScene({ home: 'Office', floors: 1, robots: [main, leaver], steps: {} }, now)
  expect(scene(p.jumpAt! + 50)).toContain('id="melt-a1"')
  expect(scene(p.splashAt! + 20)).not.toContain('id="melt-a1"')
})

test('the lights stay on while helpers are at work, and go down only in an empty office', () => {
  const main = helper('main', -1, -99_999, { type: 'main', status: 'idle', activity: { kind: 'idle', label: '', since: 0 } })
  const busy = helper('a1', 0, -60_000)
  const scene = (robots: Robot[]) => buildScene({ home: 'Office', floors: 0, robots, steps: {} }, 0)
  const lightsDown = 'fill="#0a061e" opacity="0.32"'
  expect(scene([main])).toContain(lightsDown)
  expect(scene([main, busy])).not.toContain(lightsDown)
})

test('a finished robot given more work carries on at its desk, or is printed again once it has left', () => {
  const done = helper('a1', 0, 0, { status: 'done', endedAt: 20_000 })
  const p = phaseOf(done, 0)!
  expect(hasStoodUp(done, 0, p.leaveAt! - 100)).toBe(false)
  expect(hasStoodUp(done, 0, p.leaveAt! + 100)).toBe(true)
  expect(hasStoodUp(helper('a2', 0, 0), 0, 99_999)).toBe(false)
})

test('a new picture is never laid in the layer that is on show', () => {
  // An image given a new picture shows the old one from its start until the new one loads,
  // which throws every robot back to where it stood when that picture was drawn.
  let now = 0
  let l = layPicture(noLayers, 'p1', 'pic1', 184, now, true)
  expect(l.lower).toBe('pic1')
  expect(l.covered).toBe(false)
  for (let n = 2; n <= 7; n++) {
    now += 400
    const before = layPicture(l, l.key, '', l.height, now, true)
    const onShow = before.covered ? 'upper' : 'lower'
    const after = layPicture(before, `p${n}`, `pic${n}`, 184, now, true)
    expect(after[onShow]).toBe(before[onShow])
    expect(after[onShow === 'upper' ? 'lower' : 'upper']).toBe(`pic${n}`)
    l = after
  }
  // a picture laid underneath is uncovered once it has had time to load
  const under = layPicture(layPicture(layPicture(noLayers, 'a', 'A', 184, 0, true), 'b', 'B', 184, 400, true), 'c', 'C', 184, 800, true)
  expect(under.covered).toBe(true)
  expect(under.lower).toBe('C')
  expect(layPicture(under, 'c', 'C', 184, 900, true).covered).toBe(true)
  expect(layPicture(under, 'c', 'C', 184, 1200, true).covered).toBe(false)
  // a building that has grown a floor, and a surface with one layer, are laid plainly
  const grown = layPicture(under, 'd', 'D', 240, 1300, true)
  expect(grown.lower).toBe('D')
  expect(grown.covered).toBe(false)
  const single = layPicture(layPicture(noLayers, 'a', 'A', 184, 0, false), 'b', 'B', 184, 400, false)
  expect(single.lower).toBe('B')
  expect(single.covered).toBe(false)
})

test('a label too long for its bubble is cut on a whole word and says so', () => {
  expect(fit('README.md', 60)).toBe('README.MD')
  expect(fit('palette check', 48)).toBe('PALETTE..')
  expect(fit('docs.python.org', 66)).toBe('DOCS.PYTHON.ORG')
  // one long word is cut where it must be
  expect(fit('office.test.tsx', 40)).toBe('OFFICE.TE..')
})
