import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Robot } from '../types'
import { ARRIVAL_KEPT_MS, BAR_MAX, bot, buildJourney, buildRoom, buildScene, CAPACITY, chartBars, cloudSize, deskProp, directJourneys, exitSlot, failClick, fit, floorsFor, GAUGE_ROWS, gaugeInRed, gaugeLevel, girthOf, isOverheated, hasStoodUp, JOURNEY_LEAD_MS, KIT, layClick, layPicture, LEAK_MS, mendWait, noLayers, openCard, phaseOf, positionOf, printSlot, Px, roleOf, seatFor, SHED_MIN_MS, SHED_MAX_MS, PILE_MS, shedSpan, skyKey, stayOf, transitionsOf } from '../hooks/scene'
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

test('the cellar is dark: what is down there shows only in the light of the open hatch, or by the metal itself', async () => {
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
  const rays = 'data-what="rays"'
  // the ladle, the pipe and the wall behind them: with the hatch shut they are nowhere in the picture
  const metal = 'data-what="cellar"'
  expect(scene([main], 0)).not.toContain(rays)
  expect(scene([main], 0)).not.toContain(metal)
  // the hatch opens for the robot that is leaving, and the light shows the ladle and its metal
  expect(scene([main, leaver], p.jumpAt! - 100)).toContain(rays)
  expect(scene([main, leaver], p.jumpAt! - 100)).toContain(metal)
  // some seconds after the splash it is dark again
  expect(scene([main, leaver], p.splashAt! + 5000)).not.toContain(rays)
  expect(scene([main, leaver], p.splashAt! + 5000)).not.toContain(metal)
  // the robot going under shakes the joint between the pipe and the ladle: it weeps while the hatch is still open
  const leak = 'data-what="leak"'
  expect(scene([main], 0)).not.toContain(leak)
  expect(scene([main, leaver], p.splashAt! + 1000)).toContain(leak)
  expect(scene([main, leaver], p.splashAt! + LEAK_MS + 100)).not.toContain(leak)
  // and the light is still there when the last drop has fallen
  expect(scene([main, leaver], p.splashAt! + LEAK_MS - 150)).toContain(rays)
  // the metal for a new robot travels the pipe by its own glow, and is gone from the picture once it is in the printer
  const born: Robot = { ...leaver, id: 'a2', status: 'working', endedAt: undefined, spawnedAt: 50_000, seat: 0 }
  const feed = 'data-what="feed"'
  expect(scene([main, born], 50_100)).toContain(feed)
  expect(scene([main, born], phaseOf(born, 1)!.feedEnd + 100)).not.toContain(feed)
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

test('the KPI plate charts tokens per day across every chat', () => {
  const today = new Date(2026, 10, 11, 9).getTime()
  const days = lastDays(today, 3)
  expect(days).toEqual(['2026-11-9', '2026-11-10', '2026-11-11'])
  expect(lastDays(new Date(2026, 2, 1, 9).getTime(), 2)).toEqual(['2026-2-28', '2026-3-1'])
  // the other chats' totals, plus this chat's own today
  const mine = addTokens(undefined, { id: 'main', role: 'main', name: 'Main agent' }, 300, today)
  const daily = dailyTotals(mine, { [days[0]!]: 800, [days[1]!]: 400, [days[2]!]: 100 }, today, 3)
  expect(daily).toEqual([800, 400, 400])
  // the busiest day's bar stands tallest, at full height, and equal days level
  const bars = chartBars(daily)
  expect(bars[0]).toBe(BAR_MAX)
  expect(bars[1]!).toBeLessThan(bars[0]!)
  expect(bars[1]).toBe(bars[2])
  // a day with nothing in it has no bar, and a day with next to nothing still has a row
  expect(chartBars([0, 0, 0])).toEqual([0, 0, 0])
  expect(chartBars([1_000_000, 1, 0])).toEqual([BAR_MAX, 1, 0])
  // both plates on the wall are of one make, each with its name on its head
  const main = helper('main', -1, -99_999, { type: 'main' })
  const wall = buildRoom({ home: 'Office', floors: 0, robots: [main], steps: {}, tokens: mine, history: { [days[0]!]: 800 } }, today)
  expect(wall.split('data-what="plate"').length - 1).toBe(2)
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

test('a new picture of the room is never laid in the layer that is on show', () => {
  // A frame given a new picture is empty until it has loaded, so the picture on show stays until then.
  let now = 0
  let l = layPicture(noLayers, 'p1', 'pic1', 184, now, true)
  expect(l.lower).toBe('pic1')
  expect(l.covered).toBe(false)
  for (let n = 2; n <= 7; n++) {
    now += 700
    const before = layPicture(l, l.key, '', 184, now, true)
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
  expect(layPicture(under, 'c', 'C', 184, 1500, true).covered).toBe(false)
  // a building that has grown a floor is laid like any other picture: each layer keeps its own height
  const grown = layPicture(under, 'd', 'D', 240, 1500, true)
  expect(grown.lower).toBe('C')
  expect(grown.lowerHeight).toBe(184)
  expect(grown.upper).toBe('D')
  expect(grown.upperHeight).toBe(240)
  expect(grown.covered).toBe(true)
  // a surface with one layer is laid plainly
  const single = layPicture(layPicture(noLayers, 'a', 'A', 184, 0, false), 'b', 'B', 184, 400, false)
  expect(single.lower).toBe('B')
  expect(single.covered).toBe(false)
})

/* ---------- journeys: each is laid once and plays to its end ---------- */
test('each journey is laid once, in a layer of its own, and is left alone until it is over', () => {
  const now = 100_000
  let robots: Robot[] = [helper('main', -1, 0, { type: 'main' })]
  for (const id of ['a1', 'a2', 'a3']) {
    const slot = printSlot(robots, 1, now)
    robots = [...robots, helper(id, robots.length - 1, slot.at, { rush: slot.rush, role: 'coder' })]
  }
  const who = (acts: ReturnType<typeof directJourneys>) => acts.map((a) => a.key.split(':').slice(0, 2).join(':'))
  // ordered together, they are not laid together: a journey is laid shortly before it starts
  let acts = directJourneys([], robots, 1, now, 14)
  expect(who(acts)).toEqual(['in:a1'])
  const first = acts[0]!
  // with nothing new the very same list comes back, so nothing is drawn again
  expect(directJourneys(acts, robots, 1, now + 200, 14)).toBe(acts)
  // the next one is laid when its turn at the printer is near, in the next free layer
  const near = robots[2]!.spawnedAt - JOURNEY_LEAD_MS + 10
  acts = directJourneys(acts, robots, 1, near, 14)
  expect(who(acts)).toEqual(['in:a1', 'in:a2'])
  expect(acts.map((a) => a.slot)).toEqual([0, 1])
  // whatever happens to a robot meanwhile, its journey stays as it was laid
  const busy = robots.map((r): Robot => (r.id === 'a1' ? { ...r, context: 90_000, activity: { kind: 'write', label: 'a.ts', since: near } } : r))
  expect(directJourneys(acts, busy, 1, near + 100, 14)[0]).toBe(first)
  // over, it is taken away for good: it is not laid a second time
  const over = phaseOf(robots[1]!, 1)!.arriveAt + ARRIVAL_KEPT_MS + 10
  const later = directJourneys(acts, robots, 1, over, 14)
  expect(later.some((a) => a.key === first.key)).toBe(false)
  expect(directJourneys(later, robots, 1, over + 5000, 14).some((a) => a.key === first.key)).toBe(false)
  // with every layer taken a journey waits for one
  expect(directJourneys([], robots, 1, near, 1).length).toBe(1)
})

test('a finished robot keeps still at its desk until the picture of its leaving has it, and stays if given more work', () => {
  const done = helper('a1', 0, 0, { status: 'done', endedAt: 60_000, role: 'coder' })
  const p = phaseOf(done, 0)!
  // it does not stand up the moment it is done: its leaving is laid first
  expect(p.workEnd!).toBeGreaterThan(60_000 + JOURNEY_LEAD_MS)
  const acts = directJourneys([], [done], 0, 60_500, 14)
  expect(acts.map((a) => a.kind)).toEqual(['out'])
  // the room draws it still, then lets go of it, before it cheers in its own picture
  const stay = stayOf(p)
  expect(stay.still!).toBeLessThan(stay.until!)
  expect(stay.until!).toBeLessThan(p.workEnd!)
  // given more work before it stood up, it stays, and its leaving is taken away
  const back: Robot = { ...done, status: 'working', endedAt: undefined }
  expect(directJourneys(acts, [back], 0, 60_800, 14)[0]!.until).toBeLessThan(62_000)
  // once it is on its way out, the journey plays to its end whatever comes
  expect(directJourneys(acts, [back], 0, p.leaveAt! + 500, 14)[0]).toBe(acts[0])
})

test('no picture is longer than the app will draw, however many helpers are ordered at once', () => {
  const now = 200_000
  const robots: Robot[] = [helper('main', -1, 0, { type: 'main' })]
  let floors = 0
  for (let i = 0; i < CAPACITY; i++) {
    const slot = printSlot(robots, floors, now)
    floors = Math.max(floors, floorsFor(i))
    robots.push(helper(`a${i}`, i, slot.at, { rush: slot.rush, role: ROLE_IDS[1 + (i % 8)], activity: { kind: 'read', label: 'scene.ts', since: now } }))
  }
  const world = { home: 'Office', floors, robots, steps: {} }
  // a picture too long is not drawn at all, and whatever it refers to must be in it
  const whole = (svg: string) => {
    expect(svg.length).toBeLessThanOrEqual(131_072)
    for (const m of svg.matchAll(/href="#([^"]+)"/g)) expect(svg).toContain(`id="${m[1]}"`)
  }
  for (const t of [now, now + 20_000, now + 120_000]) whole(buildRoom(world, t))
  for (const r of robots.slice(1, 9)) whole(buildJourney({ kind: 'in', robot: r, floors, plateFrom: r.spawnedAt }, r.spawnedAt))
  const leaver: Robot = { ...robots[9]!, status: 'done', endedAt: now + 130_000 }
  whole(buildJourney({ kind: 'out', robot: leaver, floors, plateFrom: 0 }, now + 130_000))
  // the room holds nobody who is on the way: a robot's walk is in the picture of its journey alone
  const walking = phaseOf(robots[1]!, floors)!.briefEnd + 300
  expect(buildRoom(world, walking)).not.toContain('animateTransform')
  expect(buildJourney({ kind: 'in', robot: robots[1]!, floors, plateFrom: 0 }, walking)).toContain('animateTransform')
  // and one picture of everything still tells the whole story, for a still
  expect(buildScene({ ...world, robots: robots.slice(0, 3) }, walking)).toContain('data-what="arrival"')
})

test("a robot's journey is a picture of its own in the pane, and redrawing the pane does not touch it", async ($, on) => {
  engine(on)
  on('turn.complete', (() => ({ text: '' })) as never)
  await $.session.start({ cwd: 'C:/work/acme-api', surface: 'desktop', isInteractive: true })
  await spawnExplorer($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  type Drawn = { type?: string; props?: Record<string, unknown> }
  const pictureIn = async (key: string) => ((await ui.find({ key }))?.children ?? []).map((c) => c as Drawn).find((c) => c?.type === 'Svg')?.props
  const journey = await pictureIn('journey-0')
  // a frame: the app keeps it playing for as long as its source stays the same
  expect(journey?.isInteractive).toBe(true)
  expect(String(journey?.source)).toContain('data-what="arrival"')
  const room = await pictureIn('under')
  expect(room?.isInteractive).toBe(true)
  expect(String(room?.source)).not.toContain('data-what="arrival"')
  // the cellar's light is a layer of its own: there is none until a robot is leaving
  expect(await pictureIn('cellar-under')).toBeUndefined()
  // every tool call redraws the pane: the journey's picture is the very same afterwards
  await $.tool.call({ tool: 'Grep', pattern: 'router', agentId: 'a1' })
  await $.tool.call({ tool: 'Read', file_path: 'C:/work/acme-api/auth.ts' })
  await ui.redraw()
  expect((await pictureIn('journey-0'))?.source).toBe(journey?.source)
  // when its work is done the hatch is laid for it, and the room's own picture knows nothing of the cellar
  await $.turn.complete({ agentId: 'a1', reason: 'answer', answer: 'done', durationMs: 1000, isAborted: false, turnId: 't-a1' } as unknown as Parameters<typeof $.turn.complete>[0])
  await ui.redraw()
  const hatch = await pictureIn('cellar-under')
  expect(hatch?.isInteractive).toBe(true)
  expect(String(hatch?.source)).toContain('data-what="rays"')
  expect(String((await pictureIn('under'))?.source)).not.toContain('data-what="cellar"')
  // and it is the very same picture from one redraw to the next
  await $.tool.call({ tool: 'Read', file_path: 'C:/work/acme-api/auth.ts' })
  await ui.redraw()
  expect((await pictureIn('cellar-under'))?.source).toBe(hatch?.source)
  await ui.unmount()
})

/* ---------- trouble, fullness and what was changed ---------- */
test('a robot whose tool calls keep failing overheats, and cools with the first one that works', async ($, on) => {
  expect(isOverheated(helper('a1', 0, 0, { streak: 2 }))).toBe(false)
  expect(isOverheated(helper('a1', 0, 0, { streak: 3 }))).toBe(true)
  // one that has finished is not stuck, whatever it left behind
  expect(isOverheated(helper('a1', 0, 0, { streak: 5, status: 'done' }))).toBe(false)

  mock.clock(on)
  on('command.register', () => ({ value: { command: 'office' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: [] }))
  let failing = true
  on('tool.call', () => (failing ? { result: {}, text: 'exit code 1', isError: true } : { result: {}, text: 'ok' }))
  await $.session.start({ cwd: 'C:/work/acme-api', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (let n = 0; n < 2; n++) await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /failures in a row/ })).toBeUndefined()
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /3 failures in a row/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Stuck/ })).toBeDefined()
  failing = false
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /failures in a row/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Stuck/ })).toBeUndefined()
  await ui.unmount()
})

test("the main agent's gauge shows how near its context is to being compacted", () => {
  // nothing to show before anything is known
  expect(gaugeLevel(undefined, 160_000)).toBe(0)
  expect(gaugeLevel(80_000, undefined)).toBe(0)
  // the column rises with the context, and stops at the top of the scale
  expect(gaugeLevel(10_000, 160_000)).toBe(1)
  expect(gaugeLevel(80_000, 160_000)).toBe(Math.round(GAUGE_ROWS / 2))
  expect(gaugeLevel(160_000, 160_000)).toBe(GAUGE_ROWS)
  expect(gaugeLevel(400_000, 160_000)).toBe(GAUGE_ROWS)
  // the top of the scale is the red zone
  expect(gaugeInRed(gaugeLevel(80_000, 160_000))).toBe(false)
  expect(gaugeInRed(gaugeLevel(150_000, 160_000))).toBe(true)
  const main = helper('main', -1, -99_999, { type: 'main', context: 150_000 })
  const room = (limit: number | undefined) => buildRoom({ home: 'Office', floors: 0, robots: [main], steps: {}, limit }, 0)
  expect(room(160_000)).toContain('data-what="gauge"')
  // in the red the column blinks; lower down it stands still
  const moving = (svg: string) => svg.split('<animate').length
  expect(moving(room(160_000))).toBeGreaterThan(moving(room(1_000_000)))
})

test('the files the agents change are listed with who changed them, and a click shows the latest change', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: 'C:/work/acme-api', surface: 'desktop', isInteractive: true })
  await spawnExplorer($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Changes/ })).toBeUndefined()
  await $.tool.call({ tool: 'Edit', file_path: 'C:/work/acme-api/src/auth.ts', old_string: 'let a', new_string: 'const a' })
  await $.tool.call({ tool: 'Write', file_path: 'C:/work/acme-api/README.md', content: '# Acme' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:/work/acme-api/src/auth.ts', old_string: 'const a', new_string: 'const b', agentId: 'a1' })
  // reading a file changes nothing
  await $.tool.call({ tool: 'Read', file_path: 'C:/work/acme-api/src/routes.ts' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^Changes · 2 files/ })).toBeDefined()
  // the latest first, each with everyone who changed it
  const rows = (await ui.findAll({ type: 'Text', text: /auth\.ts|README\.md/ })).map((r) => r.text).filter((t) => /^[▸▾]/.test(t))
  expect(rows[0]).toMatch(/auth\.ts\s+Main agent, Explorer · 2 edits/)
  expect(rows[1]).toMatch(/README\.md\s+Main agent/)
  // a click on the first row opens its latest change; another closes it
  expect(await ui.find({ type: 'Text', text: /Latest change/ })).toBeUndefined()
  await ui.resize({ columns: 40, rows: 2, in: 'changes' })
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: 'changes' })
  await ui.pointer({ type: 'up', x: 3, y: 0, button: 'left', in: 'changes' })
  expect(await ui.find({ type: 'Text', text: /Latest change · .*auth\.ts/ })).toBeDefined()
  expect((await ui.find({ type: 'Code' }))?.props.source).toMatch(/\+const b/)
  // a moment later: two presses in quick succession count as one
  for (const until = Date.now() + 400; Date.now() < until; );
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: 'changes' })
  expect(await ui.find({ type: 'Text', text: /Latest change/ })).toBeUndefined()
  // each robot has a sheet beside its desk for every file it changed
  const main = helper('main', -1, -99_999, { type: 'main', papers: 2 })
  expect(buildRoom({ home: 'Office', floors: 0, robots: [main], steps: {} }, 0)).toContain('data-what="papers"')
  expect(buildRoom({ home: 'Office', floors: 0, robots: [{ ...main, papers: 0 }], steps: {} }, 0)).not.toContain('data-what="papers"')
  await ui.unmount()
})

test('a label too long for its bubble is cut on a whole word and says so', () => {
  expect(fit('README.md', 60)).toBe('README.MD')
  expect(fit('palette check', 48)).toBe('PALETTE..')
  expect(fit('docs.python.org', 66)).toBe('DOCS.PYTHON.ORG')
  // one long word is cut where it must be
  expect(fit('office.test.tsx', 40)).toBe('OFFICE.TE..')
})

const ROLE_IDS = ['main', 'coder', 'designer', 'architect', 'tester', 'reviewer', 'explorer', 'writer', 'helper']
const GREY = { l: '#dddddd', m: '#aaaaaa', d: '#777777' }
/** A robot drawn on a small canvas: the picture, and the topmost row it paints. */
const drawn = (role: string, more: Parameters<typeof bot>[3] = {}) => {
  const g = new Px(30, 36)
  bot(g, 15, 34, { role, small: true, paint: GREY, ...more })
  const svg = g.svg()
  const top = Math.min(...[...svg.matchAll(/M\d+ (\d+)h/g)].map((m) => Number(m[1])))
  return { svg, top }
}

test('a role is told apart by what it wears and keeps on its desk, not by its paint alone', () => {
  // every robot in the same grey: the headgear and the clothes still make nine different robots
  for (const view of ['side', 'front'] as const) expect(new Set(ROLE_IDS.map((r) => drawn(r, { view }).svg)).size).toBe(ROLE_IDS.length)
  const kits = ROLE_IDS.slice(1).map((r) => {
    const g = new Px(KIT.w, KIT.h)
    deskProp(g, r)
    return g.svg()
  })
  expect(new Set(kits).size).toBe(kits.length)
})

test("no headgear is taller than the room under a helper's cloud", () => {
  // seated, the head's top row is 23 on this canvas; seven rows over it are free
  for (const r of ROLE_IDS.slice(1)) expect(drawn(r, { seated: true, pose: 'type' }).top).toBeGreaterThanOrEqual(16)
})

test('on its way with a hand free a robot holds what its job is known for', () => {
  const SMOOTHIE = '#ff8fc0'
  expect(drawn('coder', { pose: 'walk', tool: true }).svg).toContain(SMOOTHIE)
  // with a blueprint in its arms, and at its desk, it does not
  expect(drawn('coder', { pose: 'carry', item: 'blueprint', tool: true }).svg).not.toContain(SMOOTHIE)
  expect(drawn('coder', { pose: 'type', seated: true, tool: true }).svg).not.toContain(SMOOTHIE)
  // every role has something of its own to hold
  const held = ROLE_IDS.slice(1).map((r) => drawn(r, { pose: 'walk', tool: true }).svg)
  const empty = ROLE_IDS.slice(1).map((r) => drawn(r, { pose: 'walk' }).svg)
  held.forEach((svg, i) => expect(svg).not.toBe(empty[i]))
})

test('the coder rides a monowheel: it glides where the others step', () => {
  const stride = (role: string) => [0, 0.12].map((t) => drawn(role, { pose: 'walk', t }).top)
  const [c0, c1] = stride('coder')
  const [d0, d1] = stride('designer')
  expect(c0).toBe(c1)
  expect(d0).not.toBe(d1)
})

test("the main agent's cloud is as big as what it has to say", () => {
  const [full, tall] = cloudSize('read', 'register.tsx')
  expect([full, tall]).toEqual([80, 34])
  const [thinkW, thinkH] = cloudSize('think', '')
  expect(thinkW).toBeLessThan(full)
  expect(thinkH).toBeLessThan(tall)
  // a tick alone needs the least; a long label never makes a cloud wider than the full one
  expect(cloudSize('done', '')[0]).toBeLessThan(thinkW)
  for (const kind of ['think', 'done', 'error', 'ask', 'talk'] as const) expect(cloudSize(kind, 'a very long label that goes on and on and on')[0]).toBeLessThanOrEqual(full)
})


test('a robot hops for as long as its compaction runs, and its bolts lie in a pile for a while after', () => {
  // nothing to show without a compaction
  expect(shedSpan({}, 0)).toBeNull()
  // one still running keeps the robot hopping, however long it takes
  const running = shedSpan({ compactingAt: 1000 }, 61_000)!
  expect(running.from).toBe(1000)
  expect(running.until).toBeGreaterThan(61_000)
  // and one that never reports its end is not shown for ever
  expect(shedSpan({ compactingAt: 1000 }, 1000 + SHED_MAX_MS + PILE_MS + 1000)).toBeNull()
  // one over in a moment is still on show long enough to be seen
  const quick = shedSpan({ compactingAt: 1000, compactedAt: 1005 }, 1010)!
  expect(quick.until - quick.from).toBeGreaterThanOrEqual(SHED_MIN_MS)
  // a long one ends on a whole hop soon after it is over
  const long = shedSpan({ compactingAt: 1000, compactedAt: 41_300 }, 41_310)!
  expect(long.until).toBeGreaterThanOrEqual(41_300)
  expect(long.until - 41_300).toBeLessThan(1000)
  // the pile lies there a while after the robot has sat down, and then it is gone
  expect(long.gone - long.until).toBe(PILE_MS)
  expect(shedSpan({ compactingAt: 1000, compactedAt: 41_300 }, long.gone - 1)).not.toBeNull()
  expect(shedSpan({ compactingAt: 1000, compactedAt: 41_300 }, long.gone)).toBeNull()
  // a compaction that began after the last one ended is running again
  expect(shedSpan({ compactingAt: 50_000, compactedAt: 41_300 }, 80_000)!.until).toBeGreaterThan(80_000)
})

test('at a compaction a robot gets up, hops and sheds bolts with no cloud over it, and so does the main agent', () => {
  const main: Robot = { id: 'main', type: 'main', description: 'Main', status: 'working', spawnedAt: -99_999, seat: -1, activity: { kind: 'write', label: 'a.ts', since: 0 }, calls: 0, errors: 0 }
  const sitter = helper('a1', 2, -60_000)
  const scene = (robots: Robot[], now: number) => buildScene({ home: 'Office', floors: 1, robots, steps: {} }, now)
  const shed = 'data-what="shed"'
  const hops = (svg: string) => (svg.split(shed)[1] ?? '').includes('animateTransform')
  expect(scene([main, sitter], 0)).not.toContain(shed)
  // while it runs, a minute in as much as at the start, the robot is up and hopping
  for (const now of [100, 60_000]) {
    expect(hops(scene([main, { ...sitter, compactingAt: 0 }], now))).toBe(true)
    expect(hops(scene([{ ...main, compactingAt: 0 }, sitter], now))).toBe(true)
  }
  // the main agent's cloud is put away until it sits down again
  const putAway = /<g display="none"><set [^>]*\/><g data-what="main-says">/
  expect(scene([main, sitter], 100)).toContain('data-what="main-says"')
  expect(putAway.test(scene([main, sitter], 100))).toBe(false)
  expect(putAway.test(scene([{ ...main, compactingAt: 0 }, sitter], 100))).toBe(true)
  // over: it sits again, and only the pile is left
  const after = SHED_MIN_MS + 500
  expect(scene([main, { ...sitter, compactingAt: 0, compactedAt: 900 }], after)).toContain(shed)
  expect(hops(scene([main, { ...sitter, compactingAt: 0, compactedAt: 900 }], after))).toBe(false)
  expect(hops(scene([{ ...main, compactingAt: 0, compactedAt: 900 }, sitter], after))).toBe(false)
  // once the pile is cleared the room is as it was
  const cleared = SHED_MIN_MS + PILE_MS + 100
  expect(scene([main, { ...sitter, compactingAt: 0, compactedAt: 900 }], cleared)).not.toContain(shed)
  expect(scene([{ ...main, compactingAt: 0, compactedAt: 900 }, sitter], cleared)).not.toContain(shed)
})

test('a click layer the app gave up on is left out, then laid afresh under a new name', () => {
  // a layer nothing has happened to keeps its name
  expect(layClick(undefined, 'card-a1', 0, false).key).toBe('card-a1')
  // failed, it is left out: the card shows a plain button instead of the app's notice
  const failed = failClick(undefined, 1000)
  expect(layClick(failed, 'card-a1', 1200, false).key).toBeNull()
  expect(layClick(failed, 'card-a1', 1200, true).key).toBeNull()
  // it comes back under a new name, so the app starts it anew
  const back = layClick(failed, 'card-a1', 1000 + mendWait(1, false), false)
  expect(back.key).toBe('card-a1~1')
  expect(layClick(back.next, 'card-a1', 99_000, false).key).toBe('card-a1~1')
  // each failure waits longer, but never when the person is at the pane
  const again = failClick(back.next, 10_000)
  expect(mendWait(again.fails, false)).toBeGreaterThan(mendWait(1, false))
  expect(layClick(again, 'card-a1', 10_000 + mendWait(1, false), false).key).toBeNull()
  expect(layClick(again, 'card-a1', 10_000 + mendWait(1, false), true).key).toBe('card-a1~2')
})

test('a click on the open card closes it, however it was opened', async ($, on) => {
  // opened from the tasks list, then picked here: the pick wins, and an empty pick means closed
  expect(openCard('', 0, { id: 'a1', at: 10 })).toBe('a1')
  expect(openCard('', 20, { id: 'a1', at: 10 })).toBe('')
  expect(openCard('main', 20, { id: 'a1', at: 10 })).toBe('main')
  expect(openCard('main', 20, { id: 'a2', at: 30 })).toBe('a2')

  engine(on)
  await $.session.start({ cwd: 'C:/work/acme-api', surface: 'terminal', isInteractive: true })
  await spawnExplorer($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, view: { agentId: 'a1' } } })
  expect(await ui.find({ type: 'Text', text: /started/ })).toBeDefined()
  await ui.press({ key: 'card-a1' })
  expect(await ui.find({ type: 'Text', text: /started/ })).toBeUndefined()
  await ui.press({ key: 'card-a1' })
  expect(await ui.find({ type: 'Text', text: /started/ })).toBeDefined()
  await ui.unmount()
})

test("while Claude compacts an agent's context its card says so, and afterwards it is as light as its context", async ($, on) => {
  engine(on)
  const kept = [{ role: 'user', text: 'Summary of the work so far', toolUses: [] }]
  // the card as it reads in the middle of the compaction
  let during: unknown
  let look: () => Promise<unknown> = async () => undefined
  on('session.compact', async () => {
    during = await look()
    return { messages: kept, tokensBefore: 180_000, tokensAfter: 20_000 } as never
  })
  await $.session.start({ cwd: 'C:/work/acme-api', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  look = () => ui.find({ type: 'Text', text: /compacting its context/i })
  expect(await ui.find({ type: 'Text', text: /context/ })).toBeUndefined()
  await $.session.compact({ trigger: 'manual', messages: kept } as unknown as Parameters<typeof $.session.compact>[0])
  expect(during).toBeDefined()
  // no message is left behind, and it sits down as light as its context now is
  expect(await ui.find({ type: 'Text', text: /compacting/i })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^20k context$/i })).toBeDefined()
  // one worked out ahead of time changes nothing
  await $.session.compact({ trigger: 'precompute', messages: kept } as unknown as Parameters<typeof $.session.compact>[0])
  expect(await ui.find({ type: 'Text', text: /compacting/i })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^20k context$/i })).toBeDefined()
  await ui.unmount()
})
