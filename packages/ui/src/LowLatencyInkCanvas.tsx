import { useCallback, useEffect, useRef } from 'react'
import type { InkPointerInputMode } from './useInkStrokeSession'

export type LowLatencyInkPoint = {
  x: number
  y: number
}

export type LowLatencyInkCanvasStart = {
  width: number
  height: number
  color: string
  lineWidth: number
  opacity?: number
  lineDash?: readonly number[]
  clip?: { x: number; y: number; width: number; height: number }
  point: LowLatencyInkPoint
  pointerEvent?: globalThis.PointerEvent
  inputMode?: InkPointerInputMode
}

type DelegatedInkTrailStyle = {
  color: string
  diameter: number
}

type DelegatedInkTrailPresenter = {
  updateInkTrailStartPoint: (
    event: globalThis.PointerEvent,
    style: DelegatedInkTrailStyle,
  ) => void
}

type InkEnhancedNavigator = Navigator & {
  ink?: {
    requestPresenter: (options: {
      presentationArea: HTMLCanvasElement
    }) => Promise<DelegatedInkTrailPresenter>
  }
}

type ActiveInkCanvas = {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D | null
  predictionLayer: SVGSVGElement | null
  predictionPath: SVGPathElement | null
  lastPoint: LowLatencyInkPoint
  sampleCount: number
  delegatedInkEnabled: boolean
  delegatedStyle: DelegatedInkTrailStyle
}

const MAX_CANVAS_PIXEL_RATIO = 2
const MAX_CANVAS_BACKING_PIXELS = 4_000_000

function updateInkCanvasDataset(
  canvas: HTMLCanvasElement,
  active: boolean,
  sampleCount: number,
  pixelRatio?: number,
) {
  canvas.dataset.inkActive = String(active)
  canvas.dataset.inkSampleCount = String(sampleCount)
  if (pixelRatio !== undefined) canvas.dataset.inkPixelRatio = pixelRatio.toFixed(3)
}

function updateInkCanvasVisibility(canvas: HTMLCanvasElement, hidden: boolean) {
  canvas.hidden = hidden
}

function updatePredictionLayerVisibility(layer: SVGSVGElement | null, hidden: boolean) {
  layer?.toggleAttribute('hidden', hidden)
}

function clearPredictionLayer(
  layer: SVGSVGElement | null,
  path: SVGPathElement | null,
) {
  updatePredictionLayerVisibility(layer, true)
  if (layer) layer.dataset.inkPredictedSampleCount = '0'
  path?.removeAttribute('d')
}

function resizeInkCanvasBackingStore(canvas: HTMLCanvasElement, width: number, height: number) {
  canvas.width = width
  canvas.height = height
}

export function lowLatencyCanvasPixelRatio(
  width: number,
  height: number,
  devicePixelRatio = 1,
) {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const areaLimitedRatio = Math.sqrt(MAX_CANVAS_BACKING_PIXELS / (safeWidth * safeHeight))
  return Math.max(0.5, Math.min(
    MAX_CANVAS_PIXEL_RATIO,
    Math.max(1, devicePixelRatio),
    areaLimitedRatio,
  ))
}

export function useLowLatencyInkCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const predictionLayerRef = useRef<SVGSVGElement | null>(null)
  const activeRef = useRef<ActiveInkCanvas | null>(null)
  const presenterRef = useRef<DelegatedInkTrailPresenter | null>(null)
  const presenterRequestRef = useRef<Promise<DelegatedInkTrailPresenter> | null>(null)

  const requestDelegatedInkPresenter = useCallback((canvas: HTMLCanvasElement) => {
    const ink = typeof navigator === 'undefined'
      ? undefined
      : (navigator as InkEnhancedNavigator).ink
    if (!ink?.requestPresenter) return
    if (presenterRef.current || presenterRequestRef.current) return
    try {
      const request = ink.requestPresenter({ presentationArea: canvas })
      presenterRequestRef.current = request
      void request.then(presenter => {
        if (canvasRef.current !== canvas || presenterRequestRef.current !== request) return
        presenterRef.current = presenter
      }).catch(() => {
        if (presenterRequestRef.current === request) presenterRequestRef.current = null
      })
    } catch {
      // Delegated ink is an optional enhancement. Canvas remains the fallback.
    }
  }, [])

  const setCanvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    if (canvasRef.current !== canvas) {
      presenterRef.current = null
      presenterRequestRef.current = null
    }
    canvasRef.current = canvas
    activeRef.current = null
    if (!canvas) return
    updateInkCanvasVisibility(canvas, true)
    resizeInkCanvasBackingStore(canvas, 1, 1)
    updateInkCanvasDataset(canvas, false, 0)
  }, [])

  const setPredictionLayerRef = useCallback((layer: SVGSVGElement | null) => {
    predictionLayerRef.current = layer
    if (!layer) return
    clearPredictionLayer(layer, layer.querySelector<SVGPathElement>('path'))
  }, [])

  const clear = useCallback(() => {
    const active = activeRef.current
    activeRef.current = null
    const canvas = active?.canvas ?? canvasRef.current
    const context = active?.context
    if (canvas) {
      updateInkCanvasVisibility(canvas, true)
      updateInkCanvasDataset(canvas, false, 0)
    }
    if (canvas && context) {
      context.save()
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.restore()
    }
    if (canvas) {
      resizeInkCanvasBackingStore(canvas, 1, 1)
    }
    clearPredictionLayer(
      active?.predictionLayer ?? predictionLayerRef.current,
      active?.predictionPath ?? predictionLayerRef.current?.querySelector('path') ?? null,
    )
  }, [])

  const updateDelegatedInk = useCallback((event?: globalThis.PointerEvent) => {
    const active = activeRef.current
    const presenter = presenterRef.current
    if (
      !active?.delegatedInkEnabled
      || !presenter
      || !event?.isTrusted
      || event.pointerType !== 'pen'
    ) return
    try {
      presenter.updateInkTrailStartPoint(event, active.delegatedStyle)
    } catch {
      // Some WebViews expose the draft API without supporting the current surface.
    }
  }, [])

  const begin = useCallback((start: LowLatencyInkCanvasStart) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const predictionLayer = predictionLayerRef.current
    const predictionPath = predictionLayer?.querySelector<SVGPathElement>('path') ?? null
    const width = Math.max(1, start.width)
    const height = Math.max(1, start.height)
    const pixelRatio = lowLatencyCanvasPixelRatio(
      width,
      height,
      typeof window === 'undefined' ? 1 : window.devicePixelRatio,
    )
    updateInkCanvasVisibility(canvas, true)
    updateInkCanvasDataset(canvas, false, 0)
    canvas.dataset.inkInputMode = start.inputMode ?? 'pointermove'
    resizeInkCanvasBackingStore(
      canvas,
      Math.max(1, Math.round(width * pixelRatio)),
      Math.max(1, Math.round(height * pixelRatio)),
    )

    let context: CanvasRenderingContext2D | null = null
    try {
      context = canvas.getContext('2d', {
        alpha: true,
      })
    } catch {
      // jsdom and older WebViews may expose canvas without a 2D implementation.
    }

    if (context) {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.clearRect(0, 0, width, height)
      if (start.clip) {
        context.beginPath()
        context.rect(start.clip.x, start.clip.y, start.clip.width, start.clip.height)
        context.clip()
      }
      context.globalAlpha = start.opacity ?? 1
      context.globalCompositeOperation = 'source-over'
      context.strokeStyle = start.color
      context.lineWidth = Math.max(0.5, start.lineWidth)
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.setLineDash(start.lineDash ? [...start.lineDash] : [])
      context.beginPath()
      context.moveTo(start.point.x, start.point.y)
      context.lineTo(start.point.x + 0.01, start.point.y)
      context.stroke()
    }

    if (predictionLayer) {
      predictionLayer.setAttribute('viewBox', `0 0 ${width} ${height}`)
      predictionLayer.dataset.inkInputMode = start.inputMode ?? 'pointermove'
      predictionLayer.dataset.inkPredictedSampleCount = '0'
      if (start.clip) {
        const right = Math.max(0, width - start.clip.x - start.clip.width)
        const bottom = Math.max(0, height - start.clip.y - start.clip.height)
        predictionLayer.style.clipPath = `inset(${start.clip.y}px ${right}px ${bottom}px ${start.clip.x}px)`
      } else {
        predictionLayer.style.removeProperty('clip-path')
      }
    }
    if (predictionPath) {
      predictionPath.removeAttribute('d')
      predictionPath.setAttribute('fill', 'none')
      predictionPath.setAttribute('stroke', start.color)
      predictionPath.setAttribute('stroke-width', String(Math.max(0.5, start.lineWidth)))
      predictionPath.setAttribute('stroke-linecap', 'round')
      predictionPath.setAttribute('stroke-linejoin', 'round')
      predictionPath.setAttribute('opacity', String(start.opacity ?? 1))
      if (start.lineDash?.length) {
        predictionPath.setAttribute('stroke-dasharray', start.lineDash.join(' '))
      } else {
        predictionPath.removeAttribute('stroke-dasharray')
      }
    }

    activeRef.current = {
      canvas,
      context,
      predictionLayer,
      predictionPath,
      lastPoint: start.point,
      sampleCount: 1,
      delegatedInkEnabled: start.pointerEvent?.pointerType === 'pen',
      delegatedStyle: {
        color: start.color,
        diameter: Math.max(0.5, start.lineWidth),
      },
    }
    updateInkCanvasVisibility(canvas, false)
    updatePredictionLayerVisibility(predictionLayer, true)
    updateInkCanvasDataset(canvas, true, 1, pixelRatio)
    if (start.pointerEvent?.pointerType === 'pen') requestDelegatedInkPresenter(canvas)
    updateDelegatedInk(start.pointerEvent)
  }, [requestDelegatedInkPresenter, updateDelegatedInk])

  const append = useCallback((points: readonly LowLatencyInkPoint[]) => {
    const active = activeRef.current
    if (!active || points.length === 0) return
    clearPredictionLayer(active.predictionLayer, active.predictionPath)
    const context = active.context
    if (context) {
      context.beginPath()
      context.moveTo(active.lastPoint.x, active.lastPoint.y)
      for (const point of points) context.lineTo(point.x, point.y)
      context.stroke()
    }
    active.lastPoint = points[points.length - 1]!
    active.sampleCount += points.length
    updateInkCanvasDataset(active.canvas, true, active.sampleCount)
  }, [])

  const replacePredicted = useCallback((points: readonly LowLatencyInkPoint[]) => {
    const active = activeRef.current
    if (!active?.predictionLayer || !active.predictionPath) return
    if (points.length === 0) {
      clearPredictionLayer(active.predictionLayer, active.predictionPath)
      return
    }
    const pathData = [
      `M ${active.lastPoint.x} ${active.lastPoint.y}`,
      ...points.map(point => `L ${point.x} ${point.y}`),
    ].join(' ')
    active.predictionPath.setAttribute('d', pathData)
    active.predictionLayer.dataset.inkPredictedSampleCount = String(points.length)
    updatePredictionLayerVisibility(active.predictionLayer, false)
  }, [])

  useEffect(() => clear, [clear])

  return {
    canvasRef: setCanvasRef,
    predictionLayerRef: setPredictionLayerRef,
    begin,
    append,
    replacePredicted,
    clear,
    updateDelegatedInk,
  }
}

export function LowLatencyInkCanvas({
  canvasRef,
  predictionLayerRef,
  className,
  predictionClassName,
  label,
}: {
  canvasRef: (canvas: HTMLCanvasElement | null) => void
  predictionLayerRef: (layer: SVGSVGElement | null) => void
  className?: string
  predictionClassName?: string
  label: string
}) {
  return <>
    <canvas
      ref={canvasRef}
      className={['lowLatencyInkCanvas', className].filter(Boolean).join(' ')}
      data-ink-render-mode="incremental-canvas"
      data-ink-label={label}
      aria-hidden="true"
    />
    <svg
      ref={predictionLayerRef}
      className={['lowLatencyInkPredictionLayer', predictionClassName].filter(Boolean).join(' ')}
      data-ink-render-mode="predicted-svg"
      data-ink-label={`${label}の予測線`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path />
    </svg>
  </>
}
