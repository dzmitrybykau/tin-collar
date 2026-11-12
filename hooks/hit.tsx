// An invisible layer over the picture or a task card: it reports where a click
// landed, as fractions of its own size, so the hooks module can act on it.
import type { ClientModule, ClientPointerEvent } from 'claude-code'

type Props = { version: number }
type State = { listening: true }

const Hit: ClientModule<Props, State> = (_props, surface) => {
  const { Box } = surface.elements
  if (!surface.state) {
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
    // click into a region can reach it as the release alone.
    let pressed = false
    surface.onPointer((ev) => {
      if (ev.button === 'right') return
      if (ev.type === 'down') {
        pressed = true
        send(ev)
      } else if (ev.type === 'up') {
        if (!pressed) send(ev)
        pressed = false
      }
    })
    surface.setState({ listening: true })
  }

  return <Box width="100%" height="100%" />
}

export default Hit
