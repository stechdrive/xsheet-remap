export type PointerDragGhost = {
  move: (clientX: number, clientY: number) => void
  avoid: (rect: DragPreviewRect | null) => void
  dispose: () => void
}

export type DragPreviewRect = { left: number; top: number; right: number; bottom: number }

const POINTER_DRAG_GHOST_OFFSET_X = 20
const POINTER_DRAG_GHOST_OFFSET_Y = 16
const POINTER_DRAG_GHOST_VIEWPORT_MARGIN = 8

export function createPointerDragGhost(element: HTMLElement, clientX: number, clientY: number): PointerDragGhost {
  let frameId = 0
  let disposed = false
  let nextX = clientX
  let nextY = clientY
  let avoidRect: DragPreviewRect | null = null

  element.classList.add('pointerDragGhost')
  document.body.append(element)

  function applyPosition() {
    frameId = 0
    if (disposed) return
    const width = element.offsetWidth || element.getBoundingClientRect().width
    const height = element.offsetHeight || element.getBoundingClientRect().height
    const position = positionDragPreview({ x: nextX, y: nextY }, { width, height }, { width: window.innerWidth, height: window.innerHeight }, avoidRect)
    element.style.visibility = position ? '' : 'hidden'
    if (position) element.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`
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
  return { move, dispose, avoid: rect => { avoidRect = rect; move(nextX, nextY) } }
}

/** Keep both the pointer and the highlighted destination readable, including at viewport edges. */
export function positionDragPreview(
  pointer: { x: number; y: number }, size: { width: number; height: number },
  viewport: { width: number; height: number }, avoid: DragPreviewRect | null = null,
): { x: number; y: number } | null {
  const margin = POINTER_DRAG_GHOST_VIEWPORT_MARGIN
  const maxX = viewport.width - size.width - margin, maxY = viewport.height - size.height - margin
  const protectedRect = {
    left: Math.min(pointer.x - POINTER_DRAG_GHOST_OFFSET_X, avoid ? avoid.left - margin : Infinity),
    right: Math.max(pointer.x + POINTER_DRAG_GHOST_OFFSET_X, avoid ? avoid.right + margin : -Infinity),
    top: Math.min(pointer.y - POINTER_DRAG_GHOST_OFFSET_Y, avoid ? avoid.top - margin : Infinity),
    bottom: Math.max(pointer.y + POINTER_DRAG_GHOST_OFFSET_Y, avoid ? avoid.bottom + margin : -Infinity),
  }
  const right = Math.ceil(protectedRect.right), left = Math.floor(protectedRect.left - size.width)
  const below = Math.ceil(protectedRect.bottom), above = Math.floor(protectedRect.top - size.height)
  const nearX = clampNumber(right <= maxX ? right : left, margin, maxX)
  const nearY = clampNumber(below <= maxY ? below : above, margin, maxY)
  const candidates = [
    { x: nearX, y: nearY }, { x: nearX, y: below }, { x: nearX, y: above },
    { x: right, y: nearY }, { x: left, y: nearY },
  ]
  // If no readable placement fits, the target outline takes priority over the floating card.
  return candidates.find(({ x, y }) => x >= margin && x <= maxX && y >= margin && y <= maxY
    && (x + size.width <= protectedRect.left || x >= protectedRect.right
      || y + size.height <= protectedRect.top || y >= protectedRect.bottom)) ?? null
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
