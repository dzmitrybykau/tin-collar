// An invisible layer over the picture or a task card: it reports where a click
// landed, as fractions of its own size, so the hooks module can act on it.
import type { ClientModule, ClientPointerEvent } from 'claude-code'

type Props = { version: number }

// What each layer knows of the pointer. Kept here and not in a layer's own
// state: setting state asks the app for one more drawing, and this layer never
// changes what it draws, so it should never be waited on for one.
//  - pressed: a press that began here is under way.
//  - hovered: the pointer has moved over the layer with no button held since
//    it last came in, so a press that follows began here.
const pressed = new WeakSet<object>()
const hovered = new WeakSet<object>()

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
  // A press counts once, when the button goes down. A layer only just laid can
  // miss that and hear the release alone; then the release counts, but only
  // if the pointer was seen at rest over the layer first. A button held down
  // elsewhere and let go here (text being selected, a scroll bar dragged) is
  // not a click on this layer. Set on every call: a layer has one listener,
  // and a later one replaces the earlier.
  surface.onPointer((ev) => {
    if (ev.type === 'enter' || ev.type === 'leave') {
      hovered.delete(surface)
      return
    }
    if (ev.type === 'move') {
      if (ev.button === undefined) hovered.add(surface)
      return
    }
    if (ev.button === 'right') return
    if (ev.type === 'down') {
      pressed.add(surface)
      send(ev)
    } else if (ev.type === 'up') {
      if (!pressed.has(surface) && hovered.has(surface)) send(ev)
      pressed.delete(surface)
    }
  })

  return <Box width="100%" height="100%" />
}

export default Hit
