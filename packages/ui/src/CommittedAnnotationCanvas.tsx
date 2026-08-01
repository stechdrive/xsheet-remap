import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { lowLatencyCanvasPixelRatio } from './LowLatencyInkCanvas'
import type {
  PageMemoCanvasStrokeRenderItem,
  TemplateMemoTargetGeometry,
} from './pageMemoProjection'

type DrawState = {
  canvas: HTMLCanvasElement
  width: number
  height: number
  pixelRatio: number
  items: PageMemoCanvasStrokeRenderItem[]
}

const VIEWPORT_OVERSCAN_PX = 192
const VIEWPORT_OVERSCAN = `${VIEWPORT_OVERSCAN_PX}px`
const devicePixelRatioListeners = new Set<() => void>()
let stopDevicePixelRatioMonitoring: (() => void) | null = null

export function CommittedAnnotationCanvas({
  width,
  height,
  strokes,
  className,
}: {
  width: number
  height: number
  strokes: readonly PageMemoCanvasStrokeRenderItem[]
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawStateRef = useRef<DrawState | null>(null)
  const isNearViewportRef = useRef<boolean | null>(null)
  const [reportedIsNearViewport, setReportedIsNearViewport] = useState<boolean | null>(() => (
    typeof window !== 'undefined' && window.IntersectionObserver ? null : true
  ))
  const devicePixelRatio = useSyncExternalStore(
    subscribeDevicePixelRatio,
    currentDevicePixelRatio,
    serverDevicePixelRatio,
  )
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const pixelRatio = lowLatencyCanvasPixelRatio(
    safeWidth,
    safeHeight,
    devicePixelRatio,
  )

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const Observer = typeof window === 'undefined' ? undefined : window.IntersectionObserver
    if (!canvas) return
    if (!Observer) {
      isNearViewportRef.current = true
      return
    }
    isNearViewportRef.current = isElementNearViewport(canvas)
    const observer = new Observer(entries => {
      const entry = entries.find(candidate => candidate.target === canvas) ?? entries[0]
      if (!entry) return
      isNearViewportRef.current = entry.isIntersecting
      setReportedIsNearViewport(current => current === entry.isIntersecting ? current : entry.isIntersecting)
    }, {
      root: null,
      rootMargin: VIEWPORT_OVERSCAN,
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    updateCanvasMetadata(canvas, strokes)
    const isNearViewport = isNearViewportRef.current ?? reportedIsNearViewport === true
    canvas.dataset.annotationBackingState = isNearViewport ? 'active' : 'released'
    if (isNearViewport !== true) {
      if (canvas.width !== 1) canvas.width = 1
      if (canvas.height !== 1) canvas.height = 1
      drawStateRef.current = null
      return
    }
    const backingWidth = Math.max(1, Math.round(safeWidth * pixelRatio))
    const backingHeight = Math.max(1, Math.round(safeHeight * pixelRatio))
    const backingChanged = canvas.width !== backingWidth || canvas.height !== backingHeight
    const previous = drawStateRef.current
    const canAppend = Boolean(
      previous
      && !backingChanged
      && previous.canvas === canvas
      && previous.width === safeWidth
      && previous.height === safeHeight
      && previous.pixelRatio === pixelRatio
      && previous.items.length <= strokes.length
      && previous.items.every((item, index) => sameStrokeProjection(item, strokes[index]!)),
    )
    if (canvas.width !== backingWidth) canvas.width = backingWidth
    if (canvas.height !== backingHeight) canvas.height = backingHeight
    let context: CanvasRenderingContext2D | null = null
    try {
      context = canvas.getContext('2d', { alpha: true })
    } catch {
      // jsdom and older WebViews may expose canvas without a 2D implementation.
    }
    if (context) {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      if (!canAppend) context.clearRect(0, 0, safeWidth, safeHeight)
      const start = canAppend ? previous?.items.length ?? 0 : 0
      for (let index = start; index < strokes.length; index += 1) {
        drawStroke(context, strokes[index]!, safeWidth, safeHeight)
      }
    }
    drawStateRef.current = {
      canvas,
      width: safeWidth,
      height: safeHeight,
      pixelRatio,
      items: [...strokes],
    }
  }, [pixelRatio, reportedIsNearViewport, safeHeight, safeWidth, strokes])

  return <canvas
    ref={canvasRef}
    className={['committedAnnotationCanvas', className].filter(Boolean).join(' ')}
    data-ink-render-mode="committed-canvas"
    data-annotation-backing-state={reportedIsNearViewport === true ? 'active' : 'released'}
    style={{ width: `${width}px`, height: `${height}px` }}
    aria-hidden="true"
  />
}

function isElementNearViewport(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight
  return rect.bottom >= -VIEWPORT_OVERSCAN_PX
    && rect.top <= viewportHeight + VIEWPORT_OVERSCAN_PX
    && rect.right >= -VIEWPORT_OVERSCAN_PX
    && rect.left <= viewportWidth + VIEWPORT_OVERSCAN_PX
}

function drawStroke(
  context: CanvasRenderingContext2D,
  item: PageMemoCanvasStrokeRenderItem,
  width: number,
  height: number,
) {
  const first = item.points[0]
  if (!first) return
  const { x: offsetX, y: offsetY } = item.projectionOffset
  context.beginPath()
  context.moveTo((first.x + offsetX) * width, (first.y + offsetY) * height)
  for (let index = 1; index < item.points.length; index += 1) {
    const point = item.points[index]!
    context.lineTo((point.x + offsetX) * width, (point.y + offsetY) * height)
  }
  context.strokeStyle = item.stroke.color
  context.lineWidth = Math.max(0.5, item.stroke.width * Math.min(width, height))
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.stroke()
}

function sameStrokeProjection(
  left: PageMemoCanvasStrokeRenderItem,
  right: PageMemoCanvasStrokeRenderItem,
): boolean {
  return left.memoId === right.memoId
    && left.stroke === right.stroke
    && left.points === right.points
    && left.projectionOffset.x === right.projectionOffset.x
    && left.projectionOffset.y === right.projectionOffset.y
    && sameTargetGeometry(left.target, right.target)
}

function sameTargetGeometry(
  left: TemplateMemoTargetGeometry | null,
  right: TemplateMemoTargetGeometry | null,
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return left.regionId === right.regionId
    && left.targetId === right.targetId
    && left.logicalTargetId === right.logicalTargetId
    && left.rect.x === right.rect.x
    && left.rect.y === right.rect.y
    && left.rect.w === right.rect.w
    && left.rect.h === right.rect.h
}

function updateCanvasMetadata(
  canvas: HTMLCanvasElement,
  strokes: readonly PageMemoCanvasStrokeRenderItem[],
) {
  canvas.dataset.annotationStrokeCount = String(strokes.length)
  canvas.dataset.annotationRegionIds = uniqueValues(strokes.map(item => item.target?.regionId)).join(' ')
  canvas.dataset.annotationTargetIds = uniqueValues(strokes.map(item => item.target?.targetId)).join(' ')
  canvas.dataset.annotationLogicalTargetIds = uniqueValues(strokes.map(item => item.target?.logicalTargetId)).join(' ')
}

function uniqueValues(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function subscribeDevicePixelRatio(listener: () => void): () => void {
  devicePixelRatioListeners.add(listener)
  if (!stopDevicePixelRatioMonitoring && typeof window !== 'undefined') {
    stopDevicePixelRatioMonitoring = monitorDevicePixelRatio()
  }
  return () => {
    devicePixelRatioListeners.delete(listener)
    if (devicePixelRatioListeners.size > 0) return
    stopDevicePixelRatioMonitoring?.()
    stopDevicePixelRatioMonitoring = null
  }
}

function currentDevicePixelRatio(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio
}

function serverDevicePixelRatio(): number {
  return 1
}

function monitorDevicePixelRatio(): () => void {
  let previous = currentDevicePixelRatio()
  const publishIfChanged = () => {
    const current = currentDevicePixelRatio()
    if (current === previous) return
    previous = current
    for (const listener of devicePixelRatioListeners) listener()
  }
  window.addEventListener('resize', publishIfChanged)
  window.visualViewport?.addEventListener('resize', publishIfChanged)
  return () => {
    window.removeEventListener('resize', publishIfChanged)
    window.visualViewport?.removeEventListener('resize', publishIfChanged)
  }
}
