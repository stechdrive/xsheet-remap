import { type NormalizedRect, type SheetTemplate } from '@xsheet-remap/core'
import { memo, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import type { SheetImageSettings } from './appTypes'
import { uiText } from './i18n'
import { SHEET_ZOOM_WHEEL_FACTOR } from './sheetConstants'
import { clampSheetZoom, handleHorizontalWheelScroll, verticalWheelDelta } from './sheetInteraction'
import { GridOverlayLayer, SheetImageLayer, TemplateChromeLayer } from './SheetTemplateLayers'
import { buildTemplateEditorRegionRenderModel, buildTemplateEditorRenderModel, hitTestTemplateEditorTarget, snapTemplateEditorPointToPagePixels, templateEditorHitRadius, templateEditorPointFromClientRect, templateEditorRectPixelValue, type TemplateEditorRegionRenderModel, type TemplateEditorTarget } from './templateEditorGeometry'
import { gridRoleLabel, setTemplateCalibrationTargetRect, updateTemplateRectEdge, type TemplateRegionEdge } from './templateEditing'
import { TEMPLATE_CALIBRATION_TARGET_ID, sameNormalizedRect } from './template-workspace-model'

type TemplateEditorDragPreview = {
  targetId: string
  rect: NormalizedRect
}

export function TemplateRegionEditor({
  template,
  setTemplate,
  imageUrl,
  imageSettings,
  zoom,
  setZoom,
  selectedRegionId,
  onSelectRegion,
}: {
  template: SheetTemplate
  setTemplate: (updater: (currentTemplate: SheetTemplate) => SheetTemplate) => void
  imageUrl: string | null
  imageSettings: SheetImageSettings
  zoom: number
  setZoom: (zoom: number) => void
  selectedRegionId: string | null
  onSelectRegion: (regionId: string) => void
}) {
  const [dragPreview, setDragPreview] = useState<TemplateEditorDragPreview | null>(null)
  const editorSvgRef = useRef<SVGSVGElement | null>(null)
  const editorClientRectRef = useRef<DOMRect | null>(null)
  const editorTemplate = useMemo(() => {
    if (!dragPreview) return template
    if (dragPreview.targetId === TEMPLATE_CALIBRATION_TARGET_ID) {
      return setTemplateCalibrationTargetRect(template, dragPreview.rect)
    }
    return {
      ...template,
      regions: template.regions.map(region => region.regionId === dragPreview.targetId
        ? { ...region, rect: dragPreview.rect }
        : region),
    }
  }, [dragPreview, template])
  const baseRenderModel = useMemo(() => buildTemplateEditorRenderModel(template), [template])
  const activeRegionRenderModel = useMemo(
    () => dragPreview && dragPreview.targetId !== TEMPLATE_CALIBRATION_TARGET_ID
      ? buildTemplateEditorRegionRenderModel(editorTemplate, dragPreview.targetId)
      : null,
    [dragPreview, editorTemplate],
  )
  const calibrationTargetRect = dragPreview?.targetId === TEMPLATE_CALIBRATION_TARGET_ID
    ? dragPreview.rect
    : baseRenderModel.calibrationTargetRect
  const isCalibrationTargetSelected = selectedRegionId === TEMPLATE_CALIBRATION_TARGET_ID
  const selectedRegion = selectedRegionId && !isCalibrationTargetSelected ? editorTemplate.regions.find(region => region.regionId === selectedRegionId) ?? null : null
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null)
  const regionHitRadius = useMemo(() => templateEditorHitRadius(editorTemplate, zoom, 6), [editorTemplate, zoom])
  const calibrationHitRadius = useMemo(() => templateEditorHitRadius(editorTemplate, zoom, 9), [editorTemplate, zoom])
  const effectiveHoveredTargetId = hoveredTargetId === TEMPLATE_CALIBRATION_TARGET_ID
    ? calibrationTargetRect ? hoveredTargetId : null
    : hoveredTargetId && editorTemplate.regions.some(region => region.regionId === hoveredTargetId)
      ? hoveredTargetId
      : null
  const hoveredRegion = effectiveHoveredTargetId && effectiveHoveredTargetId !== selectedRegionId && effectiveHoveredTargetId !== TEMPLATE_CALIBRATION_TARGET_ID
    ? editorTemplate.regions.find(region => region.regionId === effectiveHoveredTargetId) ?? null
    : null
  const isCalibrationTargetHovered = effectiveHoveredTargetId === TEMPLATE_CALIBRATION_TARGET_ID && !isCalibrationTargetSelected

  useLayoutEffect(() => {
    const svg = editorSvgRef.current
    if (!svg) return undefined
    const viewport = svg.closest<HTMLElement>('.templateEditorViewport')
    const updateClientRect = () => {
      editorClientRectRef.current = svg.getBoundingClientRect()
    }
    updateClientRect()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateClientRect)
    resizeObserver?.observe(svg)
    viewport?.addEventListener('scroll', updateClientRect, { passive: true })
    window.addEventListener('resize', updateClientRect)
    return () => {
      resizeObserver?.disconnect()
      viewport?.removeEventListener('scroll', updateClientRect)
      window.removeEventListener('resize', updateClientRect)
    }
  }, [template.page.heightPx, template.page.widthPx, zoom])

  function editorClientRect(svg: SVGSVGElement, refresh = false): DOMRect {
    if (refresh || !editorClientRectRef.current) editorClientRectRef.current = svg.getBoundingClientRect()
    return editorClientRectRef.current
  }

  function pointFromEvent(event: PointerEvent<SVGSVGElement> | PointerEvent<SVGElement>, refresh = false) {
    const svg = (event.currentTarget.ownerSVGElement ?? event.currentTarget) as SVGSVGElement
    return templateEditorPointFromSvg(svg, event.clientX, event.clientY, refresh)
  }

  function templateEditorPointFromSvg(svg: SVGSVGElement, clientX: number, clientY: number, refresh = false) {
    return snapTemplateEditorPointToPagePixels(
      templateEditorPointFromClientRect(editorClientRect(svg, refresh), clientX, clientY),
      editorTemplate.page,
    )
  }

  function targetFromEvent(event: PointerEvent<SVGElement>, refresh = false): TemplateEditorTarget | null {
    return hitTestTemplateEditorTarget(editorTemplate, pointFromEvent(event, refresh), {
      calibrationTargetRect,
      calibrationHitRadius,
      regionHitRadius,
    })
  }

  function targetId(target: TemplateEditorTarget | null): string | null {
    if (!target) return null
    return target.kind === 'calibration-target' ? TEMPLATE_CALIBRATION_TARGET_ID : target.regionId
  }

  function handleHitSurfacePointerMove(event: PointerEvent<SVGElement>) {
    const nextTargetId = targetId(targetFromEvent(event))
    setHoveredTargetId(current => current === nextTargetId ? current : nextTargetId)
  }

  function handleHitSurfacePointerLeave() {
    setHoveredTargetId(null)
  }

  function handleHitSurfacePointerDown(event: PointerEvent<SVGElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const target = targetFromEvent(event, true)
    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    onSelectRegion(target.kind === 'calibration-target' ? TEMPLATE_CALIBRATION_TARGET_ID : target.regionId)
  }

  function commitDragRect(targetId: string, rect: NormalizedRect) {
    setTemplate(currentTemplate => {
      if (targetId === TEMPLATE_CALIBRATION_TARGET_ID) {
        return setTemplateCalibrationTargetRect(currentTemplate, rect)
      }
      return {
        ...currentTemplate,
        regions: currentTemplate.regions.map(region => region.regionId === targetId ? { ...region, rect } : region),
      }
    })
  }

  function handleEdgePointerDown(edge: TemplateRegionEdge, event: PointerEvent<SVGElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const pointerId = event.pointerId
    const target = event.currentTarget
    const targetId = isCalibrationTargetSelected ? TEMPLATE_CALIBRATION_TARGET_ID : selectedRegionId
    const startRect = isCalibrationTargetSelected ? calibrationTargetRect : selectedRegion?.rect
    if (!targetId || !startRect) return
    const svg = target.ownerSVGElement
    if (!svg) return
    const dragClientRect = editorClientRect(svg, true)
    const pointFromDragEvent = (clientX: number, clientY: number) => snapTemplateEditorPointToPagePixels(
      templateEditorPointFromClientRect(dragClientRect, clientX, clientY),
      editorTemplate.page,
    )
    let latestPoint = pointFromDragEvent(event.clientX, event.clientY)
    let previewFrameId = 0
    const updatePreview = () => {
      previewFrameId = 0
      setDragPreview({ targetId, rect: updateTemplateRectEdge(startRect, edge, latestPoint) })
    }
    const updateFromEvent = (nextEvent: globalThis.PointerEvent) => {
      if (nextEvent.pointerId !== pointerId) return
      latestPoint = pointFromDragEvent(nextEvent.clientX, nextEvent.clientY)
      if (previewFrameId === 0) previewFrameId = window.requestAnimationFrame(updatePreview)
    }
    const finishDrag = (nextEvent: globalThis.PointerEvent, useEventPoint: boolean) => {
      if (nextEvent.pointerId !== pointerId) return
      if (useEventPoint) {
        latestPoint = pointFromDragEvent(nextEvent.clientX, nextEvent.clientY)
      }
      if (previewFrameId !== 0) window.cancelAnimationFrame(previewFrameId)
      window.removeEventListener('pointermove', updateFromEvent)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      const finalRect = updateTemplateRectEdge(startRect, edge, latestPoint)
      if (!sameNormalizedRect(startRect, finalRect)) commitDragRect(targetId, finalRect)
      setDragPreview(null)
      if (
        typeof target.releasePointerCapture === 'function'
        && (typeof target.hasPointerCapture !== 'function' || target.hasPointerCapture(pointerId))
      ) {
        target.releasePointerCapture(pointerId)
      }
    }
    const handlePointerUp = (nextEvent: globalThis.PointerEvent) => finishDrag(nextEvent, true)
    const handlePointerCancel = (nextEvent: globalThis.PointerEvent) => finishDrag(nextEvent, false)
    target.setPointerCapture(pointerId)
    updatePreview()
    window.addEventListener('pointermove', updateFromEvent)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
  }

  function handleWheelZoom(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey) {
      handleHorizontalWheelScroll(event)
      return
    }
    const rawVerticalDelta = verticalWheelDelta(event)
    if (rawVerticalDelta === 0) return
    event.preventDefault()
    const viewport = event.currentTarget
    const rect = viewport.getBoundingClientRect()
    const localX = event.clientX - rect.left
    const localY = event.clientY - rect.top
    const contentX = viewport.scrollLeft + localX
    const contentY = viewport.scrollTop + localY
    const factor = rawVerticalDelta < 0 ? SHEET_ZOOM_WHEEL_FACTOR : 1 / SHEET_ZOOM_WHEEL_FACTOR
    const nextZoom = clampSheetZoom(zoom * factor)
    const ratio = nextZoom / zoom
    setZoom(nextZoom)
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = contentX * ratio - localX
      viewport.scrollTop = contentY * ratio - localY
    })
  }

  const activeEditorRect = isCalibrationTargetSelected ? calibrationTargetRect : selectedRegion?.rect ?? null
  const activeEditorRectReadout = activeEditorRect
    ? (['x', 'y', 'w', 'h'] as const)
        .map(key => `${key.toUpperCase()} ${templateEditorRectPixelValue(activeEditorRect, key, editorTemplate.page)}`)
        .join(' / ')
    : null

  return (
    <div className="templateEditor">
      <div className="templateEditorViewport" onWheel={handleWheelZoom}>
        <div
          className="templateEditorCanvas"
          style={{ width: `${editorTemplate.page.widthPx * zoom}px`, aspectRatio: `${editorTemplate.page.widthPx} / ${editorTemplate.page.heightPx}` }}
        >
          <TemplateStaticPreview
            template={template}
            renderModel={baseRenderModel}
            imageUrl={imageUrl}
            imageSettings={imageSettings}
            hiddenRegionId={dragPreview?.targetId === TEMPLATE_CALIBRATION_TARGET_ID ? null : dragPreview?.targetId ?? null}
          />
          {activeRegionRenderModel && (
            <TemplateActiveRegionPreview renderModel={activeRegionRenderModel} />
          )}
          <svg
            ref={editorSvgRef}
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            className="templateEditorSvg templateInteractionSvg"
            aria-label={uiText.template.editorLabel}
          >
            <g className="templateInteractionOverlay">
            {hoveredRegion && (
              <rect
                className="templateRegionHighlight hovered"
                x={hoveredRegion.rect.x}
                y={hoveredRegion.rect.y}
                width={hoveredRegion.rect.w}
                height={hoveredRegion.rect.h}
              />
            )}
            {calibrationTargetRect && (
              <g className="templateCalibrationTarget">
                <rect
                  className={[
                    'templateCalibrationTargetOutline',
                    isCalibrationTargetSelected ? 'selected' : '',
                    isCalibrationTargetHovered ? 'hovered' : '',
                  ].filter(Boolean).join(' ')}
                  x={calibrationTargetRect.x}
                  y={calibrationTargetRect.y}
                  width={calibrationTargetRect.w}
                  height={calibrationTargetRect.h}
                />
              </g>
            )}
            <rect
              className={effectiveHoveredTargetId ? 'templateEditorHitSurface interactive' : 'templateEditorHitSurface'}
              x="0"
              y="0"
              width="1"
              height="1"
              onPointerMove={handleHitSurfacePointerMove}
              onPointerEnter={() => {
                const svg = editorSvgRef.current
                if (svg) editorClientRect(svg, true)
              }}
              onPointerLeave={handleHitSurfacePointerLeave}
              onPointerDown={handleHitSurfacePointerDown}
            />
            {selectedRegion && (
              <TemplateEditHandles rect={selectedRegion.rect} onEdgePointerDown={handleEdgePointerDown} />
            )}
            {isCalibrationTargetSelected && calibrationTargetRect && (
              <TemplateEditHandles rect={calibrationTargetRect} variant="calibrationTarget" onEdgePointerDown={handleEdgePointerDown} />
            )}
            </g>
          </svg>
        </div>
      </div>
      <div className="templateEditorCaption">
        <strong>{isCalibrationTargetSelected ? uiText.template.calibrationTarget : selectedRegion?.label ?? '-'}</strong>
        <span className="muted">
          {isCalibrationTargetSelected
            ? uiText.template.calibrationTargetCaption
            : selectedRegion?.grid ? `${gridRoleLabel(selectedRegion.grid.role)} / ${selectedRegion.grid.columns.length}列 / ${selectedRegion.grid.rowCount}行` : uiText.template.noGridRegion}
        </span>
        {activeEditorRectReadout && <span className="templateEditorRectReadout">{activeEditorRectReadout} px</span>}
      </div>
    </div>
  )
}

const TemplateStaticPreview = memo(function TemplateStaticPreview({
  template,
  renderModel,
  imageUrl,
  imageSettings,
  hiddenRegionId,
}: {
  template: SheetTemplate
  renderModel: ReturnType<typeof buildTemplateEditorRenderModel>
  imageUrl: string | null
  imageSettings: SheetImageSettings
  hiddenRegionId: string | null
}) {
  const chrome = hiddenRegionId
    ? {
        ...renderModel.chrome,
        referenceRegions: renderModel.chrome.referenceRegions.filter(region => region.regionId !== hiddenRegionId),
        headers: renderModel.chrome.headers.filter(header => header.regionId !== hiddenRegionId),
      }
    : renderModel.chrome
  return (
    <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="templatePreviewSvg templateStaticPreviewSvg" aria-hidden="true">
      <g className="templateStaticLayer">
        <rect x="0" y="0" width="1" height="1" fill="#f7f7f4" />
        {imageUrl && <SheetImageLayer imageUrl={imageUrl} imageSettings={imageSettings} template={template} forceRaw preview />}
        <TemplateChromeLayer model={chrome} />
        {renderModel.gridOverlays
          .filter(model => model.regionId !== hiddenRegionId)
          .map(model => <GridOverlayLayer key={model.regionId} model={model} />)}
      </g>
    </svg>
  )
})

function TemplateActiveRegionPreview({
  renderModel,
}: {
  renderModel: TemplateEditorRegionRenderModel
}) {
  return (
    <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="templatePreviewSvg templateActiveRegionSvg" aria-hidden="true">
      <g className="templateActiveRegionLayer">
        <TemplateChromeLayer model={renderModel.chrome} />
        {renderModel.gridOverlay && <GridOverlayLayer model={renderModel.gridOverlay} />}
      </g>
    </svg>
  )
}

function TemplateEditHandles({
  rect,
  variant,
  onEdgePointerDown,
}: {
  rect: NormalizedRect
  variant?: 'calibrationTarget'
  onEdgePointerDown: (edge: TemplateRegionEdge, event: PointerEvent<SVGElement>) => void
}) {
  const left = rect.x
  const right = rect.x + rect.w
  const top = rect.y
  const bottom = rect.y + rect.h
  const midX = rect.x + rect.w / 2
  const midY = rect.y + rect.h / 2
  const knobRadius = 0.005

  return (
    <g className={variant === 'calibrationTarget' ? 'templateEditHandles calibrationTarget' : 'templateEditHandles'}>
      <rect className="templateSelectedRegion" x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
      <line className="templateEdgeGuide vertical" x1={left} x2={left} y1={0} y2={1} />
      <line className="templateEdgeGuide vertical" x1={right} x2={right} y1={0} y2={1} />
      <line className="templateEdgeGuide horizontal" x1={0} x2={1} y1={top} y2={top} />
      <line className="templateEdgeGuide horizontal" x1={0} x2={1} y1={bottom} y2={bottom} />
      <line className="templateEdgeHit vertical" x1={left} x2={left} y1={0} y2={1} onPointerDown={event => onEdgePointerDown('left', event)} />
      <line className="templateEdgeHit vertical" x1={right} x2={right} y1={0} y2={1} onPointerDown={event => onEdgePointerDown('right', event)} />
      <line className="templateEdgeHit horizontal" x1={0} x2={1} y1={top} y2={top} onPointerDown={event => onEdgePointerDown('top', event)} />
      <line className="templateEdgeHit horizontal" x1={0} x2={1} y1={bottom} y2={bottom} onPointerDown={event => onEdgePointerDown('bottom', event)} />
      <circle className="templateHandleKnob vertical" cx={left} cy={midY} r={knobRadius} onPointerDown={event => onEdgePointerDown('left', event)} />
      <circle className="templateHandleKnob vertical" cx={right} cy={midY} r={knobRadius} onPointerDown={event => onEdgePointerDown('right', event)} />
      <circle className="templateHandleKnob horizontal" cx={midX} cy={top} r={knobRadius} onPointerDown={event => onEdgePointerDown('top', event)} />
      <circle className="templateHandleKnob horizontal" cx={midX} cy={bottom} r={knobRadius} onPointerDown={event => onEdgePointerDown('bottom', event)} />
    </g>
  )
}
