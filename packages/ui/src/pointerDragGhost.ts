export type PointerDragGhost = {
  move: (clientX: number, clientY: number) => void
  dispose: () => void
}

const POINTER_DRAG_GHOST_OFFSET_X = 0
const POINTER_DRAG_GHOST_OFFSET_Y = 0
const POINTER_DRAG_GHOST_VIEWPORT_MARGIN = 8

export function createPointerDragGhost(element: HTMLElement, clientX: number, clientY: number): PointerDragGhost {
  let frameId = 0
  let disposed = false
  let nextX = clientX
  let nextY = clientY

  element.classList.add('pointerDragGhost')
  document.body.append(element)

  function applyPosition() {
    frameId = 0
    if (disposed) return
    const width = element.offsetWidth || element.getBoundingClientRect().width
    const height = element.offsetHeight || element.getBoundingClientRect().height
    const maxX = Math.max(POINTER_DRAG_GHOST_VIEWPORT_MARGIN, window.innerWidth - width - POINTER_DRAG_GHOST_VIEWPORT_MARGIN)
    const maxY = Math.max(POINTER_DRAG_GHOST_VIEWPORT_MARGIN, window.innerHeight - height - POINTER_DRAG_GHOST_VIEWPORT_MARGIN)
    const preferredX = nextX + POINTER_DRAG_GHOST_OFFSET_X
    const preferredY = nextY + POINTER_DRAG_GHOST_OFFSET_Y
    const flippedX = nextX - width - POINTER_DRAG_GHOST_OFFSET_X
    const flippedY = nextY - height - POINTER_DRAG_GHOST_OFFSET_Y
    const x = clampNumber(preferredX > maxX ? flippedX : preferredX, POINTER_DRAG_GHOST_VIEWPORT_MARGIN, maxX)
    const y = clampNumber(preferredY > maxY ? flippedY : preferredY, POINTER_DRAG_GHOST_VIEWPORT_MARGIN, maxY)
    element.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
  }

  function move(clientMoveX: number, clientMoveY: number) {
    nextX = clientMoveX
    nextY = clientMoveY
    if (frameId === 0) frameId = window.requestAnimationFrame(applyPosition)
  }

  function dispose() {
    disposed = true
    if (frameId !== 0) window.cancelAnimationFrame(frameId)
    element.remove()
  }

  move(clientX, clientY)
  return { move, dispose }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
