import { paperTrackDisplayRole } from '@xsheet-remap/core'
import { useEffect, useMemo, useRef } from 'react'
import { type CutProject, type PaperTrack, type SheetPage, type SheetTemplate, type SheetTimingRole, updatePaperTrack } from '@xsheet-remap/core'
import { uiText } from './i18n'
import { gridRowLineClassName } from './templateEditorGeometry'
import { TooltipTarget } from './Tooltip'
import { SheetSvgText } from './SheetSvgText'
import { StatusHintSource } from './app-foundation'
import { OVERLAY_PAPER_TRACK_TOOLTIP_DELAY_MS } from './app-stack-guides'
import { overlaySnapIndexFromPoint, overlaySnapIndexFromSegment } from './app-sheet-geometry'
import { overlayPaperTrackRenderItems, type SheetRenderModelContext } from './sheetRenderModel'
import { VerticalSvgLabel } from './VerticalSvgGlyph'

export type OverlayPaperTrackDrag = {
  paperTrack: string
  snapIndex: number
  sheetRole: SheetTimingRole
  pageId: string
  startClientX: number
  startClientY: number
  moved: boolean
}

export function OverlayPaperTrackLayer({
  context,
  page,
  activePaperTrack,
  drag,
}: {
  context: SheetRenderModelContext
  page: SheetPage
  activePaperTrack: string | null
  drag: OverlayPaperTrackDrag | null
}) {
  const items = useOverlayPaperTrackItems(context, page, drag)
  return (
    <g className="overlayPaperTrackLayer">
      {items.map(({ track, column, label }) => {
        const isInputTarget = activePaperTrack === track.paperTrack
        const frames = column.frames
          const lines = []
          for (let row = 0; row <= frames.rowCount; row += 1) {
            const y = column.rect.y + (column.rect.h * row) / frames.rowCount
            lines.push(<line key={`r${row}`} className={`overlayPaperTrackLine ${gridRowLineClassName(column, row)}`} x1={column.rect.x} x2={column.rect.x + column.rect.w} y1={y} y2={y} />)
          }
        return (
          <g key={`${track.paperTrack}:${column.regionId}`} className={isInputTarget ? 'overlayPaperTrack inputActive' : 'overlayPaperTrack inputInactive'}>
            <rect className="overlayPaperTrackColumn" x={column.rect.x} y={column.rect.y} width={column.rect.w} height={column.rect.h} />
            <line className="overlayPaperTrackBorder" x1={column.rect.x} x2={column.rect.x} y1={column.rect.y} y2={column.rect.y + column.rect.h} />
            <line className="overlayPaperTrackBorder" x1={column.rect.x + column.rect.w} x2={column.rect.x + column.rect.w} y1={column.rect.y} y2={column.rect.y + column.rect.h} />
            {lines}
            <g className="overlayPaperTrackLabel">
              {label.truncated && <title>{label.fullText}</title>}
              <path className="overlayPaperTrackStem" d={`M ${label.stemX} ${column.rect.y} V ${label.labelBottomY} H ${label.labelAttachX}`} />
              <rect className="overlayPaperTrackLabelBox" x={label.labelX} y={label.labelY} width={label.labelWidth} height={label.labelHeight} rx={label.radiusX} ry={label.radiusY} />
              {label.glyphs ? <VerticalSvgLabel className="overlayPaperTrackLabelText" glyphs={label.glyphs} size={label.fontSizePx} pageSize={label.pageSize} weight={label.fontWeight} aria-label={label.fullText} style={{ fontFamily: label.fontFamily, fontWeight: label.fontWeight }} /> : <SheetSvgText
                className="overlayPaperTrackLabelText"
                x={label.labelX + label.labelWidth / 2}
                y={label.labelY + label.labelHeight / 2}
                dy="0.08em"
                dominantBaseline="middle"
                textAnchor="middle"
                fontSizePx={label.fontSizePx}
                pageSize={label.pageSize}
                style={{ fontFamily: label.fontFamily, fontWeight: label.fontWeight }}
              >
                {label.displayText}
              </SheetSvgText>}
            </g>
          </g>
        )
      })}
    </g>
  )
}

export function OverlayPaperTrackInteractionLayer({
  project,
  template,
  page,
  context,
  pageWidth,
  pageHeight,
  activePaperTrack,
  drag,
  onActivePaperTrackChange,
  onOpenPaperTrackMenu,
  onDragChange,
  onStatusHint,
  onUpdatePaperTrack,
}: {
  project: CutProject
  template: SheetTemplate
  page: SheetPage
  context: SheetRenderModelContext
  pageWidth: number
  pageHeight: number
  activePaperTrack: string | null
  drag: OverlayPaperTrackDrag | null
  onActivePaperTrackChange: (paperTrack: string | null) => void
  onOpenPaperTrackMenu: (track: PaperTrack, position: { x: number; y: number }) => void
  onDragChange: (drag: OverlayPaperTrackDrag | null) => void
  onStatusHint: (source: StatusHintSource, text: string | null) => void
  onUpdatePaperTrack: (paperTrack: string, updates: Parameters<typeof updatePaperTrack>[2]) => void
}) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<OverlayPaperTrackDrag | null>(drag)
  const activeDrag = drag?.pageId === page.pageId ? drag : null

  const items = useOverlayPaperTrackItems(context, page, activeDrag)

  useEffect(() => {
    dragRef.current = drag
  }, [drag])

  useEffect(() => {
    function snapIndexFromClientPoint(clientX: number, clientY: number, sheetRole: SheetTimingRole): number | null {
      const layer = layerRef.current
      if (!layer) return null
      const box = layer.getBoundingClientRect()
      if (box.width <= 0 || box.height <= 0) return null
      const point = {
        x: (clientX - box.left) / box.width,
        y: (clientY - box.top) / box.height,
      }
      return overlaySnapIndexFromPoint(template, project, point, sheetRole)
    }

    function updateDragFromPointer(event: globalThis.PointerEvent) {
      const current = dragRef.current
      if (!current || current.pageId !== page.pageId) return null
      const snapIndex = snapIndexFromClientPoint(event.clientX, event.clientY, current.sheetRole)
      if (snapIndex === null) return current
      const moved = current.moved || Math.hypot(event.clientX - current.startClientX, event.clientY - current.startClientY) > 3
      const next = { ...current, snapIndex, moved }
      dragRef.current = next
      onDragChange(next)
      return next
    }

    function handlePointerMove(event: globalThis.PointerEvent) {
      if (dragRef.current?.pageId !== page.pageId) return
      event.preventDefault()
      updateDragFromPointer(event)
    }

    function handlePointerUp(event: globalThis.PointerEvent) {
      if (dragRef.current?.pageId !== page.pageId) return
      const current = updateDragFromPointer(event) ?? dragRef.current
      if (current?.moved) {
        onUpdatePaperTrack(current.paperTrack, { viewPlacement: { templateId: template.templateId, snapIndex: current.snapIndex, expanded: true } })
      } else if (current) {
        onActivePaperTrackChange(activePaperTrack === current.paperTrack ? null : current.paperTrack)
      }
      dragRef.current = null
      onDragChange(null)
      onStatusHint('sheet-drag', null)
    }

    function handlePointerCancel() {
      if (dragRef.current?.pageId !== page.pageId) return
      dragRef.current = null
      onDragChange(null)
      onStatusHint('sheet-drag', null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [activePaperTrack, onActivePaperTrackChange, onDragChange, onStatusHint, onUpdatePaperTrack, page.pageId, project, template])

  return (
    <div ref={layerRef} className="overlayPaperTrackInteractionLayer">
      {items.map(({ track, column, label }) => {
        const isInputTarget = activePaperTrack === track.paperTrack
        const inputStateLabel = isInputTarget
          ? uiText.actions.overlayPaperTrackInputActive(track.label)
          : uiText.actions.overlayPaperTrackInputInactive(track.label)
        const title = `${inputStateLabel}\n${uiText.actions.overlayPaperTrackEdit}`
        const statusHint = uiText.statusHints.overlayPaperTrack(track.label, isInputTarget)
        return (
          <TooltipTarget key={`${track.paperTrack}:${column.regionId}`} label={title} delayMs={OVERLAY_PAPER_TRACK_TOOLTIP_DELAY_MS}>
            {tooltipProps => (
              <button
                {...tooltipProps}
                type="button"
                className={isInputTarget ? 'overlayPaperTrackDragHandle inputActive' : 'overlayPaperTrackDragHandle inputInactive'}
                data-sheet-touch-interaction={isInputTarget ? 'direct' : undefined}
                aria-pressed={isInputTarget}
                aria-label={column.globalFrameStart > context.displayFrameStart ? `${inputStateLabel}（${column.globalFrameStart}コマ目から）` : inputStateLabel}
                style={{
                  left: `${label.labelX * pageWidth}px`,
                  top: `${label.labelY * pageHeight}px`,
                  width: `${label.labelWidth * pageWidth}px`,
                  height: `${label.labelHeight * pageHeight}px`,
                }}
                onPointerDown={event => {
                  tooltipProps.onPointerDown()
                  if (event.pointerType === 'mouse' && event.button !== 0) return
                  event.preventDefault()
                  event.stopPropagation()
                  event.currentTarget.setPointerCapture?.(event.pointerId)
                  const sheetRole = paperTrackDisplayRole(track)
                  const nextDrag = {
                    paperTrack: track.paperTrack,
                    snapIndex: overlaySnapIndexFromSegment(column.rect.x, column),
                    sheetRole,
                    pageId: page.pageId,
                    startClientX: event.clientX,
                    startClientY: event.clientY,
                    moved: false,
                  }
                  dragRef.current = nextDrag
                  onDragChange(nextDrag)
                  onStatusHint('sheet-drag', uiText.statusHints.overlayPaperTrackDragging(track.label))
                }}
                onPointerEnter={event => {
                  tooltipProps.onPointerEnter(event)
                  onStatusHint('overlay-paper-track', statusHint)
                }}
                onPointerLeave={() => {
                  tooltipProps.onPointerLeave()
                  onStatusHint('overlay-paper-track', null)
                }}
                onFocus={event => {
                  tooltipProps.onFocus(event)
                  onStatusHint('overlay-paper-track', statusHint)
                }}
                onBlur={() => {
                  tooltipProps.onBlur()
                  onStatusHint('overlay-paper-track', null)
                }}
                onContextMenu={event => {
                  event.preventDefault()
                  event.stopPropagation()
                  onOpenPaperTrackMenu(track, { x: event.clientX, y: event.clientY })
                }}
                onPointerCancel={() => {
                  dragRef.current = null
                  onDragChange(null)
                  onStatusHint('sheet-drag', null)
                }}
              />
            )}
          </TooltipTarget>
        )
      })}
    </div>
  )
}

function useOverlayPaperTrackItems(context: SheetRenderModelContext, page: SheetPage, drag: OverlayPaperTrackDrag | null) {
  return useMemo(() => {
    const tracks = drag ? context.overlayTracks.map(track => track.paperTrack === drag.paperTrack
      ? { ...track, viewPlacement: { ...track.viewPlacement, templateId: context.template.templateId, snapIndex: drag.snapIndex } }
      : track) : context.overlayTracks
    return overlayPaperTrackRenderItems(context, page, tracks)
  }, [context, page, drag])
}
