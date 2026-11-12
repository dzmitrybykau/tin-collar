// An invisible layer over the picture or a task card: it reports where a click
// landed, as fractions of its own size, so the hooks module can act on it.
import type { ClientModule, ClientPointerEvent } from 'claude-code'

type Props = { version: number }

// Which layers have a press under way. Kept here and not in a layer's own state:
// setting state asks the app for one more drawing, and this layer never changes
// what it draws, so it should never be waited on for one.
const pressed = new WeakSet<object>()

const Hit: ClientModule<Props> = (_props, surface) => {
  const { Box } = surface.elements
  const send = (ev: ClientPointerEvent) => {
    const cols = Math.max(1, surface.columns)
    const rows = Math.max(1, surface.rows)
    surface.post({
      fx: (ev.fine?.x ?? ev.x + 0.5) / cols,
      fy: (ev.fine?.y ?? ev.y + 0.5) / rows,
      x: ev.x,
      y: ev.y,
      cols,
      rows,
    })
  }
  // A press counts once, on whichever half of it arrives first: the first
  // click into a region can reach it as the release alone. Set on every call:
  // a layer has one listener, and a later one replaces the earlier.
  surface.onPointer((ev) => {
    if (ev.button === 'right') return
    if (ev.type === 'down') {
      pressed.add(surface)
      send(ev)
    } else if (ev.type === 'up') {
      if (!pressed.has(surface)) send(ev)
      pressed.delete(surface)
    }
  })

  return <Box width="100%" height="100%" />
}

export default Hit
