import type { PointerEvent } from 'react'
import type { AnnotationStroke, SheetPage, SheetPageMemoTarget } from '@xsheet-remap/core'
import type { EditMode } from './appTypes'
import { SHEET_INTERACTION_ACTIVE_CLASS } from './app-foundation'
import { LowLatencyInkCanvas, useLowLatencyInkCanvas } from './LowLatencyInkCanvas'
import { useInkStrokeSession } from './useInkStrokeSession'
import { pageMemoTargetOffset } from './pageMemoInputCoordinates'

export type PageAnnotationStrokeStart = {
  pointerId: number
  stroke: AnnotationStroke
  target: SheetPageMemoTarget
  svgRect: { left: number; top: number; width: number; height: number }
}

type PageAnnotationStrokeSession = PageAnnotationStrokeStart

export function PageAnnotationInputSurface({
  page,
  editMode,
  width,
  height,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onCancelOtherInteractions,
  onPointerLeave,
  onAnnotation,
  onEraseAnnotation,
}: {
  page: SheetPage
  editMode: EditMode
  width: number
  height: number
  onPointerDown: (event: PointerEvent<SVGSVGElement>, page: SheetPage) => PageAnnotationStrokeStart | null
  onPointerMove: (event: PointerEvent<SVGSVGElement>) => void
  onPointerUp: (event: PointerEvent<SVGSVGElement>) => void
  onCancelOtherInteractions: () => void
  onPointerLeave: () => void
  onAnnotation: (stroke: AnnotationStroke) => void
  onEraseAnnotation: (pageId: string, points: AnnotationStroke['points'], width: number, target: SheetPageMemoTarget) => void
}) {
  const inkCanvas = useLowLatencyInkCanvas()
  const strokeDrag = useInkStrokeSession<PageAnnotationStrokeSession>({
    onPointerEvent: inkCanvas.updateDelegatedInk,
    onActualPoints: (current, points) => {
      const offset = pageMemoTargetOffset(current.target)
      current.stroke.points.push(...points.map(point => ({
        x: (point.clientX - current.svgRect.left) / Math.max(1, current.svgRect.width) - offset.x,
        y: (point.clientY - current.svgRect.top) / Math.max(1, current.svgRect.height) - offset.y,
        pressure: point.pressure || 1,
      })))
      inkCanvas.append(points.map(point => ({
        x: point.clientX - current.svgRect.left,
        y: point.clientY - current.svgRect.top,
      })))
      return { ...current }
    },
    onPredictedPoints: (current, points) => {
      inkCanvas.replacePredicted(points.map(point => ({
        x: point.clientX - current.svgRect.left,
        y: point.clientY - current.svgRect.top,
      })))
    },
    onActiveChange: active => {
      document.body.classList.toggle(SHEET_INTERACTION_ACTIVE_CLASS, active)
      if (active) document.getSelection()?.removeAllRanges()
    },
    onFinish: (current, finish) => {
      inkCanvas.clear()
      if (finish.cancelled) return
      const stroke = {
        ...current.stroke,
        points: current.stroke.points.slice(),
      }
      if (stroke.tool === 'eraser') {
        onEraseAnnotation(stroke.pageId, stroke.points, stroke.width, current.target)
      } else {
        onAnnotation(stroke)
      }
    },
  })

  return (
    <div
      className="pageAnnotationInteractionLayer"
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        className="pageAnnotationInputSurface"
        data-page-id={page.pageId}
        data-annotation-tool={editMode}
        style={{ width: `${width}px`, height: `${height}px` }}
        onPointerDown={event => {
          const start = onPointerDown(event, page)
          if (!start) return
          strokeDrag.cancel()
          const lineWidth = start.stroke.width * Math.min(start.svgRect.width, start.svgRect.height)
          const inputMode = strokeDrag.begin(start, event.currentTarget, event.nativeEvent)
          inkCanvas.begin({
            width: start.svgRect.width,
            height: start.svgRect.height,
            color: start.stroke.color,
            lineWidth,
            opacity: start.stroke.tool === 'eraser' ? 0.78 : 1,
            lineDash: start.stroke.tool === 'eraser' ? [lineWidth * 3, lineWidth * 2] : undefined,
            point: {
              x: event.clientX - start.svgRect.left,
              y: event.clientY - start.svgRect.top,
            },
            pointerEvent: start.stroke.tool === 'pen' ? event.nativeEvent : undefined,
            inputMode,
          })
        }}
        onPointerMove={editMode === 'text' ? onPointerMove : undefined}
        onPointerUp={editMode === 'text' ? onPointerUp : undefined}
        onPointerCancel={() => {
          strokeDrag.cancel()
          onCancelOtherInteractions()
        }}
        onPointerLeave={onPointerLeave}
        onDragStart={event => event.preventDefault()}
        onContextMenu={event => event.preventDefault()}
        aria-label={`${page.pageIndex + 1}ページの注釈入力`}
      >
        <rect x="0" y="0" width="1" height="1" fill="transparent" />
      </svg>
      <LowLatencyInkCanvas
        canvasRef={inkCanvas.canvasRef}
        predictionLayerRef={inkCanvas.predictionLayerRef}
        className="pageAnnotationInkCanvas"
        predictionClassName="pageAnnotationInkPredictionLayer"
        label={`${page.pageIndex + 1}ページの手描きプレビュー`}
      />
    </div>
  )
}
