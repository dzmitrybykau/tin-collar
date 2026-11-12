// Tokens used today, per robot: what the Employee of the Day frame shows.
import type { TokenTally } from '../types'

/** The person's calendar day, so the tally starts again at their midnight. */
export const dayOf = (now: number) => {
  const d = new Date(now)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function addTokens(tally: TokenTally | undefined, who: { id: string; role: string; name: string }, used: number, now: number): TokenTally {
  const day = dayOf(now)
  const t: TokenTally = tally && tally.day === day ? tally : { day, total: 0, byRobot: {} }
  const mine = t.byRobot[who.id]
  return {
    day,
    total: t.total + used,
    byRobot: { ...t.byRobot, [who.id]: { tokens: (mine?.tokens ?? 0) + used, role: who.role, name: who.name } },
  }
}

/** Whoever has used the most tokens today, if anyone has used any. */
export function champion(tally: TokenTally | undefined, now: number): { id: string; role: string; name: string; tokens: number } | null {
  if (!tally || tally.day !== dayOf(now)) return null
  let best: { id: string; role: string; name: string; tokens: number } | null = null
  for (const [id, r] of Object.entries(tally.byRobot)) if (!best || r.tokens > best.tokens) best = { id, ...r }
  return best
}

/** Each chat keeps its total for a day in the plugin's store under its own key, so no two write the same one. */
const TOKENS_PREFIX = 'tokens:'
export const tokensKey = (day: string, session: string) => `${TOKENS_PREFIX}${day}:${session}`
export const dayOfKey = (key: string) => (key.startsWith(TOKENS_PREFIX) ? (key.slice(TOKENS_PREFIX.length).split(':')[0] ?? null) : null)

/** The last `n` calendar days, oldest first, ending today. */
export function lastDays(now: number, n: number): string[] {
  const d = new Date(now)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(dayOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - i).getTime()))
  return out
}

/** Tokens per day across every chat, oldest first, today last: the other chats' totals, plus this one's today. */
export function dailyTotals(tally: TokenTally | undefined, others: Record<string, number> | undefined, now: number, n: number): number[] {
  const today = dayOf(now)
  const mine = tally && tally.day === today ? tally.total : 0
  return lastDays(now, n).map((day) => (others?.[day] ?? 0) + (day === today ? mine : 0))
}

/** 950, 12K, 2.4M, 1.1B: two significant figures, short enough for a pixel plaque. */
export function formatTokens(n: number): string {
  const units: Array<[number, string]> = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]
  for (const [size, unit] of units) {
    if (n >= size) {
      const v = n / size
      return `${v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)}${unit}`
    }
  }
  return String(Math.round(n))
}
