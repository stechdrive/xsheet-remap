import { useEffect, type PointerEvent } from 'react'
import type { AnnotationStroke, SheetPage, SheetPageMemoTarget } from '@xsheet-remap/core'
import type { EditMode } from './appTypes'
import { strokePath } from './app-sheet-layers'
import { SHEET_INTERACTION_ACTIVE_CLASS } from './app-foundation'
import { usePointerDragSession } from './usePointerDragSession'

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
  const strokeDrag = usePointerDragSession<PageAnnotationStrokeSession>({
    previewMode: 'animation-frame',
    onUpdate: (current, point) => {
      current.stroke.points.push({
        x: (point.clientX - current.svgRect.left) / Math.max(1, current.svgRect.width),
        y: (point.clientY - current.svgRect.top) / Math.max(1, current.svgRect.height),
        pressure: point.pressure || 1,
      })
      return { ...current }
    },
    onFinish: (current, finish) => {
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
  const draftStroke = strokeDrag.active?.stroke ?? null
  const isDrawing = draftStroke !== null

  useEffect(() => {
    if (!isDrawing) return
    document.body.classList.add(SHEET_INTERACTION_ACTIVE_CLASS)
    document.getSelection()?.removeAllRanges()
    return () => {
      document.body.classList.remove(SHEET_INTERACTION_ACTIVE_CLASS)
    }
  }, [isDrawing])

  return (
    <svg
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      className="pageAnnotationInputSurface"
      data-page-id={page.pageId}
      data-annotation-tool={editMode}
      style={{ width: `${width}px`, height: `${height}px` }}
      onPointerDown={event => {
        const start = onPointerDown(event, page)
        if (start) strokeDrag.begin(start, event.currentTarget)
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
      {draftStroke?.pageId === page.pageId && (
        <path
          className={draftStroke.tool === 'eraser'
            ? 'annotationStroke annotationDraftStroke annotationEraserPreview'
            : 'annotationStroke annotationDraftStroke'}
          d={strokePath(draftStroke)}
          stroke={draftStroke.color}
          strokeWidth={draftStroke.width}
          data-annotation-region-id={draftStroke.anchor?.kind === 'view-surface' ? draftStroke.anchor.regionId : undefined}
          data-annotation-target-id={draftStroke.anchor?.kind === 'view-surface' ? draftStroke.anchor.targetId : undefined}
        />
      )}
    </svg>
  )
}
