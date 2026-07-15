import { useEffect, useRef } from 'react'
import { type CutProject, type NormalizedRect, type PaperTrack, type SheetPage, type SheetTemplate, type SheetTimingRole, resolveSheetTemplateGridLayout, resolveSheetTemplatePageSize, stackGuideStackBand, updatePaperTrack, logicalSheetDisplayDurationFrames } from '@xsheet-remap/core'
import { uiText } from './i18n'
import { gridRowLineClassName } from './templateEditorGeometry'
import { TooltipTarget } from './Tooltip'
import { SheetSvgText } from './SheetSvgText'
import { StatusHintSource } from './app-foundation'
import { OVERLAY_PAPER_TRACK_TOOLTIP_DELAY_MS, STACK_GUIDE_MAX_LANE, stackGuideAnchorRegions, stackGuideGapWidthPx, stackGuidePlacements, stackGuideSvgGeometry } from './app-stack-guides'
import { overlaySnapIndexFromPoint, templatePaperTracks, type OverlayBandSegment } from './app-sheet-geometry'
import { overlayColumnRectForPage } from './sheet-layers-hit-geometry'
import { auxiliaryLabelRangePx, auxiliaryLabelRangesOverlap, overlayAuxiliaryLabelBandKey, overlayAuxiliaryLabelGeometry, type OverlayAuxiliaryLabelGeometry } from './auxiliary-label-layout'

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
  project,
  template,
  page,
  tracks,
  activePaperTrack,
  drag,
}: {
  project: CutProject
  template: SheetTemplate
  page: SheetPage
  tracks: PaperTrack[]
  activePaperTrack: string | null
  drag: OverlayPaperTrackDrag | null
}) {
  return (
    <g className="overlayPaperTrackLayer">
      {overlayPaperTrackRenderItems(template, project, page, tracks, drag).map(({ track, column, label }) => {
        const isInputTarget = activePaperTrack === track.paperTrack
        const frames = column.frames
          const lines = []
          for (let row = 0; row <= frames.rowCount; row += 1) {
            const y = column.rect.y + (column.rect.h * row) / frames.rowCount
            lines.push(<line key={`r${row}`} className={`overlayPaperTrackLine ${gridRowLineClassName(column, row)}`} x1={column.rect.x} x2={column.rect.x + column.rect.w} y1={y} y2={y} />)
          }
        return (
          <g key={track.paperTrack} className={isInputTarget ? 'overlayPaperTrack inputActive' : 'overlayPaperTrack inputInactive'}>
            <rect className="overlayPaperTrackColumn" x={column.rect.x} y={column.rect.y} width={column.rect.w} height={column.rect.h} />
            <line className="overlayPaperTrackBorder" x1={column.rect.x} x2={column.rect.x} y1={column.rect.y} y2={column.rect.y + column.rect.h} />
            <line className="overlayPaperTrackBorder" x1={column.rect.x + column.rect.w} x2={column.rect.x + column.rect.w} y1={column.rect.y} y2={column.rect.y + column.rect.h} />
            {lines}
            <g className="overlayPaperTrackLabel">
              {label.truncated && <title>{label.fullText}</title>}
              <path className="overlayPaperTrackStem" d={`M ${label.stemX} ${column.rect.y} V ${label.labelBottomY} H ${label.labelAttachX}`} />
              <rect className="overlayPaperTrackLabelBox" x={label.labelX} y={label.labelY} width={label.labelWidth} height={label.labelHeight} rx={label.radiusX} ry={label.radiusY} />
              <SheetSvgText
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
              </SheetSvgText>
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
  tracks,
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
  tracks: PaperTrack[]
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
        onUpdatePaperTrack(current.paperTrack, { viewPlacement: { snapIndex: current.snapIndex, expanded: true } })
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
      {overlayPaperTrackRenderItems(template, project, page, tracks, activeDrag).map(({ track, renderedTrack, label }) => {
        const isInputTarget = activePaperTrack === track.paperTrack
        const inputStateLabel = isInputTarget
          ? uiText.actions.overlayPaperTrackInputActive(track.label)
          : uiText.actions.overlayPaperTrackInputInactive(track.label)
        const title = `${inputStateLabel}\n${uiText.actions.overlayPaperTrackEdit}`
        const statusHint = uiText.statusHints.overlayPaperTrack(track.label, isInputTarget)
        return (
          <TooltipTarget key={track.paperTrack} label={title} delayMs={OVERLAY_PAPER_TRACK_TOOLTIP_DELAY_MS}>
            {tooltipProps => (
              <button
                {...tooltipProps}
                type="button"
                className={isInputTarget ? 'overlayPaperTrackDragHandle inputActive' : 'overlayPaperTrackDragHandle inputInactive'}
                aria-pressed={isInputTarget}
                aria-label={inputStateLabel}
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
                  const sheetRole = track.viewPlacement?.sheetRole ?? 'cell'
                  const nextDrag = {
                    paperTrack: track.paperTrack,
                    snapIndex: renderedTrack.viewPlacement?.snapIndex ?? 0,
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

interface OverlayPaperTrackRenderItem {
  track: PaperTrack
  renderedTrack: PaperTrack
  column: OverlayBandSegment & { rect: NormalizedRect }
  label: OverlayAuxiliaryLabelGeometry
}

interface LabelLaneOccupancy {
  leftPx: number
  rightPx: number
  lane: number
  source: 'stack-guide' | 'overlay-track'
}

function overlayPaperTrackRenderItems(
  template: SheetTemplate,
  project: CutProject,
  page: SheetPage,
  tracks: PaperTrack[],
  drag: OverlayPaperTrackDrag | null,
): OverlayPaperTrackRenderItem[] {
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const templateTracks = templatePaperTracks(project).map(track => track.paperTrack)
  const pageSize = resolveSheetTemplatePageSize(template, displayDurationFrames, {
    paperTracks: templateTracks,
    layoutOverrides: project.sheetView.layoutOverrides,
  })
  const occupiedByRegion = new Map<string, LabelLaneOccupancy[]>()

  function occupiedLanesForRegion(region: SheetTemplate['regions'][number]) {
    const bandKey = overlayAuxiliaryLabelBandKey(template, region)
    const existing = occupiedByRegion.get(bandKey)
    if (existing) return existing
    const occupied = stackGuideAnchorRegions(template, page, project.logicalSheet.frameOrigin)
      .filter(anchorRegion => overlayAuxiliaryLabelBandKey(template, anchorRegion) === bandKey)
      .flatMap(anchorRegion => {
        const layout = resolveSheetTemplateGridLayout(template, anchorRegion, {
          paperTracks: templateTracks,
          durationFrames: displayDurationFrames,
          layoutOverrides: project.sheetView.layoutOverrides,
        })
        if (!layout || layout.columns.length === 0) return []
        const rect = layout.rect
        const columns = layout.columns
        const gapWidthPx = stackGuideGapWidthPx(template, rect, columns, pageSize.widthPx)
        const labelsForRegion = project.stackGuideLabels.filter(label => (label.displayRole ?? 'action') === anchorRegion.grid?.role && stackGuideStackBand(label) === 'cell-interleave')
        return stackGuidePlacements(template, project, labelsForRegion, gapWidthPx, columns).map(({ label, lane }) => {
          const geometry = stackGuideSvgGeometry(template, rect, pageSize, label, lane, columns)
          return {
            leftPx: geometry.labelX * pageSize.widthPx,
            rightPx: (geometry.labelX + geometry.labelWidth) * pageSize.widthPx,
            lane,
            source: 'stack-guide' as const,
          }
        })
      })
    occupiedByRegion.set(bandKey, occupied)
    return occupied
  }

  return tracks.flatMap(track => {
    const renderedTrack = drag?.paperTrack === track.paperTrack
      ? { ...track, viewPlacement: { ...track.viewPlacement, snapIndex: drag.snapIndex } }
      : track
    const column = overlayColumnRectForPage(template, project, renderedTrack, page)
    if (!column) return []
    const region = template.regions.find(item => item.regionId === column.regionId)
    if (!region?.grid) return []
    const layout = resolveSheetTemplateGridLayout(template, region, {
      paperTracks: templateTracks,
      durationFrames: displayDurationFrames,
      layoutOverrides: project.sheetView.layoutOverrides,
    })
    if (!layout || layout.columns.length === 0) return []
    const rect = layout.rect
    const occupied = occupiedLanesForRegion(region)
    const highestStackGuideLane = occupied.reduce((highest, candidate) => candidate.source === 'stack-guide' ? Math.max(highest, candidate.lane) : highest, -1)
    let lane = highestStackGuideLane >= 0 ? Math.min(highestStackGuideLane + 1, STACK_GUIDE_MAX_LANE) : 0
    let label = overlayAuxiliaryLabelGeometry(template, rect, pageSize, renderedTrack, column, lane, STACK_GUIDE_MAX_LANE)
    while (
      lane < STACK_GUIDE_MAX_LANE
      && occupied.some(candidate => candidate.lane === lane && auxiliaryLabelRangesOverlap(auxiliaryLabelRangePx(label, pageSize.widthPx), candidate))
    ) {
      lane += 1
      label = overlayAuxiliaryLabelGeometry(template, rect, pageSize, renderedTrack, column, lane, STACK_GUIDE_MAX_LANE)
    }
    occupied.push({ ...auxiliaryLabelRangePx(label, pageSize.widthPx), lane, source: 'overlay-track' })
    return [{
      track,
      renderedTrack,
      column,
      label,
    }]
  })
}
