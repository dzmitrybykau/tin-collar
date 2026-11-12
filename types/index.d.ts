export type ActivityKind =
  | 'idle'
  | 'think'
  | 'read'
  | 'search'
  | 'web'
  | 'write'
  | 'run'
  | 'spawn'
  | 'ask'
  | 'talk'
  | 'mcp'
  | 'tool'
  | 'done'
  | 'error'

export type Activity = { kind: ActivityKind; label: string; since: number }

export type RobotStatus = 'idle' | 'working' | 'done' | 'failed'

export type PlanStatus = 'pending' | 'in_progress' | 'completed'

/** One step of the plan an agent keeps for itself (its task list). */
export type PlanItem = { text: string; status: PlanStatus }

export type Robot = {
  id: string
  type: string
  description: string
  model?: string
  parentId?: string
  /** The Agent call that printed it, so its chat row can show its portrait. */
  toolUseId?: string
  /** What it does (designer, architect, coder, ...), which decides how it looks. */
  role?: string
  /** Its own task list, as its planning tools last left it. */
  plan?: PlanItem[]
  /** When its current turn began, so progress counts this turn's steps. */
  turnStartedAt?: number
  /** Tokens in its context window as of its latest model request. */
  context?: number
  /** When a compaction of its context began: it is up and hopping, shedding bolts, until that ends. */
  compactingAt?: number
  /** When that compaction ended; absent while it runs. */
  compactedAt?: number
  /** What it carried before that compaction, so it hops as heavy as it was. */
  compactedFrom?: number
  status: RobotStatus
  /** When the printer starts on it: robots ordered together are printed one after another. */
  spawnedAt: number
  /** Printed at the double, because others were waiting for the printer. */
  rush?: boolean
  endedAt?: number
  /** The earliest it may stand up, so robots that finish together hand in their reports one at a time. */
  exitAt?: number
  seat: number
  activity: Activity
  calls: number
  errors: number
}

export type Step = {
  id: string
  tool: string
  kind: ActivityKind
  label: string
  startedAt: number
  endedAt?: number
  isError?: boolean
  diff?: string
}

/** Tokens used today, per robot, for the Employee of the Day frame. */
export type TokenTally = {
  day: string
  total: number
  byRobot: Record<string, { tokens: number; role: string; name: string }>
}

/** What happened: every robot and every step, as the hooks saw them. */
export type World = {
  home: string
  floors: number
  robots: Robot[]
  steps: Record<string, Step[]>
  tokens?: TokenTally
  /** Tokens per day from the other chats, read from the plugin's store, for the whiteboard's chart. */
  history?: Record<string, number>
}

/** What the picture shows: the world, held and batched so the picture changes rarely. */
export type Display = {
  at: number
  home: string
  floors: number
  robots: Robot[]
  selected: string
  tokens?: TokenTally
  history?: Record<string, number>
}

declare module 'claude-code' {
  interface PluginState {
    'tin-collar': {
      world: Shaped<World>
      display: Shaped<Display>
      selected: string
      /** Counts up to have the pane drawn again when a picture layer is due to come off. */
      redraw: number
    }
  }
}
