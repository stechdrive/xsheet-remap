import { useLayoutEffect, useRef } from 'react'
import { lowLatencyCanvasPixelRatio } from './LowLatencyInkCanvas'
import type { PageMemoStrokeRenderItem } from './pageMemoProjection'

type DrawState = {
  canvas: HTMLCanvasElement
  width: number
  height: number
  pixelRatio: number
  signatures: string[]
}

export function CommittedAnnotationCanvas({
  width,
  height,
  strokes,
  className,
}: {
  width: number
  height: number
  strokes: readonly PageMemoStrokeRenderItem[]
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawStateRef = useRef<DrawState | null>(null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const safeWidth = Math.max(1, width)
    const safeHeight = Math.max(1, height)
    const pixelRatio = lowLatencyCanvasPixelRatio(
      safeWidth,
      safeHeight,
      typeof window === 'undefined' ? 1 : window.devicePixelRatio,
    )
    const backingWidth = Math.max(1, Math.round(safeWidth * pixelRatio))
    const backingHeight = Math.max(1, Math.round(safeHeight * pixelRatio))
    const backingChanged = canvas.width !== backingWidth || canvas.height !== backingHeight
    const signatures = strokes.map(strokeSignature)
    const previous = drawStateRef.current
    const canAppend = Boolean(
      previous
      && !backingChanged
      && previous.canvas === canvas
      && previous.width === safeWidth
      && previous.height === safeHeight
      && previous.pixelRatio === pixelRatio
      && previous.signatures.length <= signatures.length
      && previous.signatures.every((signature, index) => signature === signatures[index]),
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
      const start = canAppend ? previous?.signatures.length ?? 0 : 0
      for (let index = start; index < strokes.length; index += 1) {
        drawStroke(context, strokes[index]!, safeWidth, safeHeight)
      }
    }
    canvas.dataset.annotationStrokeCount = String(strokes.length)
    canvas.dataset.annotationRegionIds = uniqueValues(strokes.map(item => item.target?.regionId)).join(' ')
    canvas.dataset.annotationTargetIds = uniqueValues(strokes.map(item => item.target?.targetId)).join(' ')
    canvas.dataset.annotationLogicalTargetIds = uniqueValues(strokes.map(item => item.target?.logicalTargetId)).join(' ')
    drawStateRef.current = {
      canvas,
      width: safeWidth,
      height: safeHeight,
      pixelRatio,
      signatures,
    }
  }, [height, strokes, width])

  return <canvas
    ref={canvasRef}
    className={['committedAnnotationCanvas', className].filter(Boolean).join(' ')}
    data-ink-render-mode="committed-canvas"
    style={{ width: `${width}px`, height: `${height}px` }}
    aria-hidden="true"
  />
}

function drawStroke(
  context: CanvasRenderingContext2D,
  item: PageMemoStrokeRenderItem,
  width: number,
  height: number,
) {
  const [first, ...rest] = item.points
  if (!first) return
  context.beginPath()
  context.moveTo(first.x * width, first.y * height)
  for (const point of rest) context.lineTo(point.x * width, point.y * height)
  context.strokeStyle = item.stroke.color
  context.lineWidth = Math.max(0.5, item.stroke.width * Math.min(width, height))
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.stroke()
}

function strokeSignature(item: PageMemoStrokeRenderItem): string {
  return [
    item.stroke.annotationId,
    item.stroke.color,
    item.stroke.width,
    item.points.map(point => `${point.x},${point.y},${point.pressure ?? ''}`).join(';'),
    item.target?.regionId,
    item.target?.targetId,
    item.target?.rect.x,
    item.target?.rect.y,
  ].join(':')
}

function uniqueValues(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}
