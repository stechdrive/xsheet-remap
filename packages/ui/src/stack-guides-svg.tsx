import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { type CutProject, type SheetPage, type SheetTemplate, type SheetTimingRole, type StackGuideLabel, resolveSheetTemplateGridLayout, resolveSheetTemplatePageSize, resolveSheetTemplateRegionRect, stackGuideStackBand, logicalSheetDisplayDurationFrames } from '@xsheet-remap/core'
import { uiText } from './i18n'
import { SheetSvgText } from './SheetSvgText'
import { StackGuideDropPreviewState, StackGuideLabelUpdates } from './app-foundation'
import { stackGuideAnchorRegions, stackGuideLabelsForPreview, stackGuidePlacementsByGap, stackGuideSvgGeometry } from './stack-guides-geometry'
import { stackGuidePlacementUpdateFromPointer } from './stack-guides-interaction'

export function StackGuideSvgLayer({
  project,
  template,
  page,
  dropPreview,
  onUpdateLabel,
  onPreviewPlacement,
  onClearPreview,
}: {
  project: CutProject
  template: SheetTemplate
  page: SheetPage
  dropPreview?: StackGuideDropPreviewState | null
  onUpdateLabel?: (labelId: string, updates: StackGuideLabelUpdates) => void
  onPreviewPlacement?: (labelId: string, clientX: number, clientY: number) => void
  onClearPreview?: () => void
}) {
  type LabelDragState = {
    pointerId: number
    labelId: string
    startX: number
    startY: number
    moved: boolean
  }
  const [dragState, setDragState] = useState<LabelDragState | null>(null)
  const dragStateRef = useRef<LabelDragState | null>(null)
  const dragSvgRef = useRef<SVGSVGElement | null>(null)
  const dragCaptureTargetRef = useRef<SVGGElement | null>(null)
  const anchorRegions = stackGuideAnchorRegions(template, page, project.logicalSheet.frameOrigin)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const pageSize = resolveSheetTemplatePageSize(template, displayDurationFrames, {
    paperTracks: project.logicalSheet.paperTracks.map(track => track.paperTrack),
    layoutOverrides: project.sheetView.layoutOverrides,
  })
  const previewLabels = stackGuideLabelsForPreview(project, dropPreview)
  const displayProject = previewLabels === project.stackGuideLabels
    ? project
    : { ...project, stackGuideLabels: previewLabels }

  const setCurrentDragState = useCallback((next: LabelDragState | null) => {
    dragStateRef.current = next
    setDragState(next)
  }, [])

  const updateLabelDragFromPoint = useCallback((pointerId: number, clientX: number, clientY: number) => {
    const current = dragStateRef.current
    if (!current || current.pointerId !== pointerId) return
    const moved = current.moved || Math.hypot(clientX - current.startX, clientY - current.startY) > 4
    if (moved) onPreviewPlacement?.(current.labelId, clientX, clientY)
    if (moved !== current.moved) setCurrentDragState({ ...current, moved })
  }, [onPreviewPlacement, setCurrentDragState])

  const finishLabelDragFromPoint = useCallback((pointerId: number, clientX: number, clientY: number, svg: SVGSVGElement | null) => {
    const current = dragStateRef.current
    if (!current || current.pointerId !== pointerId) return false
    const label = project.stackGuideLabels.find(item => item.labelId === current.labelId)
    const captureTarget = dragCaptureTargetRef.current
    if (captureTarget?.hasPointerCapture(pointerId)) {
      captureTarget.releasePointerCapture(pointerId)
    }
    dragCaptureTargetRef.current = null
    dragSvgRef.current = null
    setCurrentDragState(null)
    onClearPreview?.()
    const moved = current.moved || Math.hypot(clientX - current.startX, clientY - current.startY) > 4
    if (!moved || !onUpdateLabel || !label) return false
    const update = stackGuidePlacementUpdateFromPointer(svg, clientX, clientY, project, template, page, label)
    if (update) onUpdateLabel(label.labelId, update)
    return true
  }, [onClearPreview, onUpdateLabel, page, project, setCurrentDragState, template])

  useEffect(() => {
    if (!dragState) return
    const currentDragState = dragState
    function handlePointerMove(event: globalThis.PointerEvent) {
      updateLabelDragFromPoint(event.pointerId, event.clientX, event.clientY)
    }
    function handlePointerUp(event: globalThis.PointerEvent) {
      finishLabelDragFromPoint(event.pointerId, event.clientX, event.clientY, dragSvgRef.current)
    }
    function handlePointerCancel(event: globalThis.PointerEvent) {
      if (currentDragState.pointerId !== event.pointerId) return
      dragCaptureTargetRef.current = null
      dragSvgRef.current = null
      setCurrentDragState(null)
      onClearPreview?.()
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [dragState, finishLabelDragFromPoint, onClearPreview, setCurrentDragState, updateLabelDragFromPoint])

  if (anchorRegions.length === 0) return null

  function startLabelDrag(event: PointerEvent<SVGGElement>, label: StackGuideLabel) {
    if (!onUpdateLabel) {
      event.stopPropagation()
      return
    }
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragSvgRef.current = event.currentTarget.ownerSVGElement
    dragCaptureTargetRef.current = event.currentTarget
    setCurrentDragState({
      pointerId: event.pointerId,
      labelId: label.labelId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    })
  }

  function updateLabelDrag(event: PointerEvent<SVGGElement>) {
    updateLabelDragFromPoint(event.pointerId, event.clientX, event.clientY)
  }

  function endLabelDrag(event: PointerEvent<SVGGElement>, label: StackGuideLabel) {
    if (dragStateRef.current?.labelId !== label.labelId) return false
    event.preventDefault()
    event.stopPropagation()
    return finishLabelDragFromPoint(event.pointerId, event.clientX, event.clientY, event.currentTarget.ownerSVGElement)
  }

  const renderItems = anchorRegions.flatMap(region => {
    const displayRole = region.grid?.role as SheetTimingRole
    const layout = resolveSheetTemplateGridLayout(template, region, {
      paperTracks: project.logicalSheet.paperTracks.map(track => track.paperTrack),
      durationFrames: displayDurationFrames,
      layoutOverrides: project.sheetView.layoutOverrides,
    })
    const columns = layout?.columns ?? []
    const rect = layout?.rect ?? resolveSheetTemplateRegionRect(template, region, displayDurationFrames)
    const labelsForRegion = displayProject.stackGuideLabels.filter(label => (label.displayRole ?? 'action') === displayRole && stackGuideStackBand(label) === 'cell-interleave')
    const placementsByGap = stackGuidePlacementsByGap(template, displayProject, labelsForRegion, rect, pageSize, columns)

    return Array.from(placementsByGap.values()).flatMap(placements => placements.map(({ label, lane }) => ({
      key: `${region.regionId}-${label.labelId}`,
      regionId: region.regionId,
      displayRole,
      label,
      geometry: stackGuideSvgGeometry(template, rect, pageSize, label, lane, columns),
      className: [
        'stackGuideLabel',
        'stackGuideSvgLabel',
        onUpdateLabel ? 'draggable' : '',
        dragState?.labelId === label.labelId ? 'dragging' : '',
        label.assetIds.length > 0 ? 'assigned' : '',
      ].filter(Boolean).join(' '),
    })))
  })

  return (
    <g className="stackGuideSvgLayer">
      <g className="stackGuideSvgConnectorLayer" aria-hidden="true">
        {renderItems.map(({ key, label, geometry }) => (
          <path
            key={`${key}-connector`}
            className="stackGuideSvgConnector"
            data-stack-guide-label-id={label.labelId}
            d={`M ${geometry.anchorX} ${geometry.anchorY} V ${geometry.labelBottomY} H ${geometry.labelAttachX}`}
            strokeWidth={geometry.connectorStrokeWidth}
          />
        ))}
      </g>
      <g className="stackGuideSvgLabelLayer">
        {renderItems.map(({ key, regionId, displayRole, label, geometry, className }) => (
          <g
            key={key}
            className={className}
            data-stack-guide-role={displayRole}
            data-stack-guide-label-id={label.labelId}
            data-region-id={regionId}
            aria-label={uiText.stackGuides.labelTitle(label.label, label.assetIds.length)}
            onPointerDown={event => startLabelDrag(event, label)}
            onPointerMove={updateLabelDrag}
            onPointerUp={event => {
              endLabelDrag(event, label)
            }}
            onPointerCancel={event => {
              if (dragStateRef.current?.pointerId === event.pointerId) {
                setCurrentDragState(null)
                onClearPreview?.()
              }
            }}
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            {geometry.truncated && <title>{geometry.fullText}</title>}
            <rect
              className="stackGuideSvgLabelBox"
              x={geometry.labelX}
              y={geometry.labelY}
              width={geometry.labelWidth}
              height={geometry.labelHeight}
              rx={geometry.radiusX}
              ry={geometry.radiusY}
            />
            <SheetSvgText
              className="stackGuideSvgLabelText"
              x={geometry.labelTextX}
              y={geometry.labelY + geometry.labelHeight / 2}
              dy="0.08em"
              textAnchor="start"
              dominantBaseline="middle"
              fontSizePx={geometry.fontSizePx}
              pageSize={pageSize}
              style={{ fontFamily: geometry.fontFamily, fontWeight: geometry.fontWeight }}
            >
              {geometry.displayText}
            </SheetSvgText>
          </g>
        ))}
      </g>
    </g>
  )
}
