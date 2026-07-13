import { type NormalizedRect, type SheetTemplate } from '@xsheet-remap/core'
import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type WheelEvent } from 'react'
import type { SheetImageSettings } from './appTypes'
import { uiText } from './i18n'
import { SHEET_ZOOM_MIN, SHEET_ZOOM_WHEEL_FACTOR, TEMPLATE_ZOOM_MAX } from './sheetConstants'
import { clampNumber, handleHorizontalWheelScroll, verticalWheelDelta } from './sheetInteraction'
import { GridOverlayLayer, SheetImageLayer, TemplateChromeLayer } from './SheetTemplateLayers'
import { buildTemplateEditorRegionRenderModel, buildTemplateEditorRenderModel, hitTestTemplateEditorTarget, normalizedRectToPixelEdges, quantizeNormalizedRectToPagePixels, snapTemplateEditorPointToPagePixels, templateEditorHitRadius, templateEditorPointFromClientRect, type TemplateEditorRegionRenderModel, type TemplateEditorTarget } from './templateEditorGeometry'
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
  const isPixelQuantizedTemplate = template.templateKind !== 'digital-native'
  const previewDurationFrames = template.templateKind === 'digital-native'
    ? Math.min(template.defaults.durationFrames, 480)
    : template.defaults.durationFrames
  const editorSvgRef = useRef<SVGSVGElement | null>(null)
  const editorClientRectRef = useRef<DOMRect | null>(null)
  const hoveredOverlayRef = useRef<HTMLDivElement | null>(null)
  const hoveredTargetIdRef = useRef<string | null>(null)
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
  const baseRenderModel = useMemo(() => buildTemplateEditorRenderModel(template, previewDurationFrames), [previewDurationFrames, template])
  const activeRegionRenderModel = useMemo(
    () => dragPreview && dragPreview.targetId !== TEMPLATE_CALIBRATION_TARGET_ID
      ? buildTemplateEditorRegionRenderModel(editorTemplate, dragPreview.targetId, previewDurationFrames)
      : null,
    [dragPreview, editorTemplate, previewDurationFrames],
  )
  const calibrationTargetRect = dragPreview?.targetId === TEMPLATE_CALIBRATION_TARGET_ID
    ? dragPreview.rect
    : baseRenderModel.calibrationTargetRect
  const calibrationOutlineRect = dragPreview?.targetId === TEMPLATE_CALIBRATION_TARGET_ID
    ? baseRenderModel.calibrationTargetRect
    : calibrationTargetRect
  const isCalibrationTargetSelected = selectedRegionId === TEMPLATE_CALIBRATION_TARGET_ID
  const selectedRegion = selectedRegionId && !isCalibrationTargetSelected ? editorTemplate.regions.find(region => region.regionId === selectedRegionId) ?? null : null
  const regionHitRadius = useMemo(() => templateEditorHitRadius(editorTemplate, zoom, 6), [editorTemplate, zoom])
  const calibrationHitRadius = useMemo(() => templateEditorHitRadius(editorTemplate, zoom, 9), [editorTemplate, zoom])

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

  useLayoutEffect(() => {
    hoveredTargetIdRef.current = null
    if (hoveredOverlayRef.current) hoveredOverlayRef.current.style.opacity = '0'
  }, [selectedRegionId, template.page.heightPx, template.page.widthPx, zoom])

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

  function updateHoverOverlay(target: TemplateEditorTarget | null, hitSurface?: SVGElement) {
    const nextTargetId = targetId(target)
    if (hoveredTargetIdRef.current === nextTargetId) return
    hoveredTargetIdRef.current = nextTargetId
    if (hitSurface) hitSurface.style.cursor = nextTargetId ? 'pointer' : 'default'
    const overlay = hoveredOverlayRef.current
    if (!overlay) return
    const rect = !target || nextTargetId === selectedRegionId
      ? null
      : target.kind === 'calibration-target'
        ? calibrationTargetRect
        : editorTemplate.regions.find(region => region.regionId === target.regionId)?.rect ?? null
    if (!rect) {
      overlay.style.opacity = '0'
      return
    }
    overlay.style.width = `${rect.w * editorTemplate.page.widthPx}px`
    overlay.style.height = `${rect.h * editorTemplate.page.heightPx}px`
    overlay.style.transform = `translate3d(${rect.x * editorTemplate.page.widthPx}px, ${rect.y * editorTemplate.page.heightPx}px, 0)`
    overlay.style.opacity = '1'
    overlay.dataset.kind = target?.kind ?? ''
  }

  function handleHitSurfacePointerMove(event: PointerEvent<SVGElement>) {
    updateHoverOverlay(targetFromEvent(event), event.currentTarget)
  }

  function handleHitSurfacePointerLeave() {
    updateHoverOverlay(null)
  }

  function handleHitSurfacePointerDown(event: PointerEvent<SVGElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const target = targetFromEvent(event, true)
    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    updateHoverOverlay(null, event.currentTarget)
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

  function handleEdgePointerDown(edge: TemplateRegionEdge, event: PointerEvent<Element>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const pointerId = event.pointerId
    const target = event.currentTarget
    const targetId = isCalibrationTargetSelected ? TEMPLATE_CALIBRATION_TARGET_ID : selectedRegionId
    const startRect = isCalibrationTargetSelected ? calibrationTargetRect : selectedRegion?.rect
    if (!targetId || !startRect) return
    const svg = editorSvgRef.current
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
      const rect = updateTemplateRectEdge(startRect, edge, latestPoint, editorTemplate.page)
      setDragPreview({ targetId, rect: quantizeNormalizedRectToPagePixels(rect, editorTemplate.page) })
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
      const finalRect = quantizeNormalizedRectToPagePixels(
        updateTemplateRectEdge(startRect, edge, latestPoint, editorTemplate.page),
        editorTemplate.page,
      )
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
    const nextZoom = clampNumber(zoom * factor, SHEET_ZOOM_MIN, TEMPLATE_ZOOM_MAX)
    const ratio = nextZoom / zoom
    setZoom(nextZoom)
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = contentX * ratio - localX
      viewport.scrollTop = contentY * ratio - localY
    })
  }

  const activeEditorRect = isCalibrationTargetSelected ? calibrationTargetRect : selectedRegion?.rect ?? null
  const activeEditorRectReadout = activeEditorRect
    ? (() => {
        const edges = normalizedRectToPixelEdges(activeEditorRect, editorTemplate.page)
        return `X ${edges.left} / Y ${edges.top} / W ${edges.right - edges.left} / H ${edges.bottom - edges.top} / R ${edges.right} / B ${edges.bottom}`
      })()
    : null

  return (
    <div className="templateEditor">
      <div className="templateEditorViewport" onWheel={handleWheelZoom}>
        <div
          className="templateEditorZoomSurface"
          style={{
            width: `${editorTemplate.page.widthPx * zoom}px`,
            height: `${editorTemplate.page.heightPx * zoom}px`,
          }}
        >
        <div
          className={`templateEditorCanvas ${zoom < 1 ? 'smoothZoom' : 'pixelZoom'} ${isPixelQuantizedTemplate && zoom >= 4 ? 'preciseZoom' : ''} ${isPixelQuantizedTemplate && zoom >= 8 ? 'showPixelGrid' : ''}`}
          style={{
            width: `${editorTemplate.page.widthPx}px`,
            height: `${editorTemplate.page.heightPx}px`,
            aspectRatio: `${editorTemplate.page.widthPx} / ${editorTemplate.page.heightPx}`,
            transform: `scale(${zoom})`,
            '--template-pixel-size': '1px',
            '--template-grid-line': `${1 / zoom}px`,
          } as CSSProperties}
        >
          <TemplateStaticPreview
            template={template}
            renderModel={baseRenderModel}
            imageUrl={imageUrl}
            imageSettings={imageSettings}
            hiddenRegionId={dragPreview?.targetId === TEMPLATE_CALIBRATION_TARGET_ID ? null : dragPreview?.targetId ?? null}
          />
          {activeRegionRenderModel && (
            <TemplateActiveRegionPreview renderModel={activeRegionRenderModel} rect={dragPreview!.rect} />
          )}
          <div ref={hoveredOverlayRef} className="templateRegionHighlightOverlay" aria-hidden="true" />
          <svg
            ref={editorSvgRef}
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            className="templateEditorSvg templateInteractionSvg"
            aria-label={uiText.template.editorLabel}
          >
            <g className="templateInteractionOverlay">
            {calibrationOutlineRect && (
              <g className="templateCalibrationTarget">
                <rect
                  className={[
                    'templateCalibrationTargetOutline',
                    isCalibrationTargetSelected ? 'selected' : '',
                  ].filter(Boolean).join(' ')}
                  x={calibrationOutlineRect.x}
                  y={calibrationOutlineRect.y}
                  width={calibrationOutlineRect.w}
                  height={calibrationOutlineRect.h}
                />
              </g>
            )}
            <rect
              className="templateEditorHitSurface"
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
            </g>
          </svg>
          {activeEditorRect && (
            <TemplateEdgeGuides
              rect={activeEditorRect}
              page={editorTemplate.page}
              zoom={zoom}
              variant={isCalibrationTargetSelected ? 'calibrationTarget' : undefined}
              onEdgePointerDown={handleEdgePointerDown}
            />
          )}
          {selectedRegion && (
            <TemplateHandleOverlay rect={selectedRegion.rect} page={editorTemplate.page} onEdgePointerDown={handleEdgePointerDown} />
          )}
          {isCalibrationTargetSelected && calibrationTargetRect && (
            <TemplateHandleOverlay rect={calibrationTargetRect} page={editorTemplate.page} variant="calibrationTarget" onEdgePointerDown={handleEdgePointerDown} />
          )}
        </div>
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
        {imageUrl && <SheetImageLayer imageUrl={imageUrl} imageSettings={imageSettings} template={template} placement={template.defaultUnderlay?.placement} forceRaw preview />}
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
  rect,
}: {
  renderModel: TemplateEditorRegionRenderModel
  rect: NormalizedRect
}) {
  return (
    <svg
      viewBox={`${rect.x} ${rect.y} ${rect.w} ${rect.h}`}
      preserveAspectRatio="none"
      className="templatePreviewSvg templateActiveRegionSvg"
      aria-hidden="true"
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.w * 100}%`,
        height: `${rect.h * 100}%`,
      }}
    >
      <g className="templateActiveRegionLayer">
        <TemplateChromeLayer model={renderModel.chrome} />
        {renderModel.gridOverlay && <GridOverlayLayer model={renderModel.gridOverlay} />}
      </g>
    </svg>
  )
}

function TemplateEdgeGuides({
  rect,
  page,
  zoom,
  variant,
  onEdgePointerDown,
}: {
  rect: NormalizedRect
  page: Pick<SheetTemplate['page'], 'widthPx' | 'heightPx'>
  zoom: number
  variant?: 'calibrationTarget'
  onEdgePointerDown: (edge: TemplateRegionEdge, event: PointerEvent<Element>) => void
}) {
  const hitWidth = 18 / zoom
  const lineWidth = 1.25 / zoom
  const left = rect.x * page.widthPx
  const right = (rect.x + rect.w) * page.widthPx
  const top = rect.y * page.heightPx
  const bottom = (rect.y + rect.h) * page.heightPx
  const guideStyle = { '--template-guide-line-width': `${lineWidth}px` } as CSSProperties
  return (
    <div className={`templateEdgeGuides ${variant === 'calibrationTarget' ? 'calibrationTarget' : ''}`} style={guideStyle}>
      <div className="templateDomEdgeGuide vertical" style={{ width: `${hitWidth}px`, height: `${page.heightPx}px`, transform: `translate3d(${left - hitWidth / 2}px, 0, 0)` }} onPointerDown={event => onEdgePointerDown('left', event)} />
      <div className="templateDomEdgeGuide vertical" style={{ width: `${hitWidth}px`, height: `${page.heightPx}px`, transform: `translate3d(${right - hitWidth / 2}px, 0, 0)` }} onPointerDown={event => onEdgePointerDown('right', event)} />
      <div className="templateDomEdgeGuide horizontal" style={{ width: `${page.widthPx}px`, height: `${hitWidth}px`, transform: `translate3d(0, ${top - hitWidth / 2}px, 0)` }} onPointerDown={event => onEdgePointerDown('top', event)} />
      <div className="templateDomEdgeGuide horizontal" style={{ width: `${page.widthPx}px`, height: `${hitWidth}px`, transform: `translate3d(0, ${bottom - hitWidth / 2}px, 0)` }} onPointerDown={event => onEdgePointerDown('bottom', event)} />
    </div>
  )
}

function TemplateHandleOverlay({
  rect,
  page,
  variant,
  onEdgePointerDown,
}: {
  rect: NormalizedRect
  page: Pick<SheetTemplate['page'], 'widthPx' | 'heightPx'>
  variant?: 'calibrationTarget'
  onEdgePointerDown: (edge: TemplateRegionEdge, event: PointerEvent<Element>) => void
}) {
  return (
    <svg
      viewBox={`${rect.x} ${rect.y} ${rect.w} ${rect.h}`}
      preserveAspectRatio="none"
      className="templateHandleSvg"
      aria-hidden="true"
      style={{
        left: `${rect.x * page.widthPx}px`,
        top: `${rect.y * page.heightPx}px`,
        width: `${rect.w * page.widthPx}px`,
        height: `${rect.h * page.heightPx}px`,
      }}
    >
      <TemplateEditHandles rect={rect} page={page} variant={variant} onEdgePointerDown={onEdgePointerDown} />
    </svg>
  )
}

function TemplateEditHandles({
  rect,
  page,
  variant,
  onEdgePointerDown,
}: {
  rect: NormalizedRect
  page: Pick<SheetTemplate['page'], 'widthPx' | 'heightPx'>
  variant?: 'calibrationTarget'
  onEdgePointerDown: (edge: TemplateRegionEdge, event: PointerEvent<Element>) => void
}) {
  const left = rect.x
  const right = rect.x + rect.w
  const top = rect.y
  const bottom = rect.y + rect.h
  const midX = rect.x + rect.w / 2
  const midY = rect.y + rect.h / 2
  const knobRadius = 0.005
  const pixelWidth = 1 / Math.max(1, page.widthPx)
  const pixelHeight = 1 / Math.max(1, page.heightPx)

  return (
    <g className={variant === 'calibrationTarget' ? 'templateEditHandles calibrationTarget' : 'templateEditHandles'}>
      <rect className="templateSelectedRegion" x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
      <g className="templatePixelEdgeBands" aria-hidden="true">
        <rect x={left} y={top} width={pixelWidth} height={rect.h} />
        <rect x={Math.max(left, right - pixelWidth)} y={top} width={pixelWidth} height={rect.h} />
        <rect x={left} y={top} width={rect.w} height={pixelHeight} />
        <rect x={left} y={Math.max(top, bottom - pixelHeight)} width={rect.w} height={pixelHeight} />
      </g>
      <circle className="templateHandleKnob vertical" cx={left} cy={midY} r={knobRadius} onPointerDown={event => onEdgePointerDown('left', event)} />
      <circle className="templateHandleKnob vertical" cx={right} cy={midY} r={knobRadius} onPointerDown={event => onEdgePointerDown('right', event)} />
      <circle className="templateHandleKnob horizontal" cx={midX} cy={top} r={knobRadius} onPointerDown={event => onEdgePointerDown('top', event)} />
      <circle className="templateHandleKnob horizontal" cx={midX} cy={bottom} r={knobRadius} onPointerDown={event => onEdgePointerDown('bottom', event)} />
    </g>
  )
}
