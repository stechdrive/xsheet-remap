import { resolveSheetTemplateGridColumns, resolveSheetTemplateGridFrames, type NormalizedRect, type SheetTemplate } from '@xsheet-remap/core'
import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type WheelEvent } from 'react'
import type { SheetImageSettings } from './appTypes'
import { uiText } from './i18n'
import { SHEET_ZOOM_WHEEL_FACTOR, TEMPLATE_ZOOM_MAX, TEMPLATE_ZOOM_MIN } from './sheetConstants'
import { clampNumber, handleHorizontalWheelScroll, verticalWheelDelta } from './sheetInteraction'
import { GridOverlayLayer, SheetImageLayer, TemplateChromeLayer } from './SheetTemplateLayers'
import { buildTemplateEditorRegionRenderModel, buildTemplateEditorRenderModel, buildTemplateEditorSurfaceModel, hitTestTemplateEditorTarget, normalizedRectToPixelEdges, quantizeNormalizedRectToPagePixels, snapTemplateEditorPointToPagePixels, templateEditorHitRadius, templateEditorPointFromClientRect, updateTemplateEditorRectEdgeFromSurface, type TemplateEditorRegionRenderModel, type TemplateEditorRenderModel, type TemplateEditorTarget } from './templateEditorGeometry'
import { gridRoleLabel, setTemplateCalibrationTargetRect, type TemplateRegionEdge } from './templateEditing'
import { templateRegionPlacementMode } from './templateRegionAuthoring'
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
  hiddenRegionIds,
  positionLockedRegionIds,
}: {
  template: SheetTemplate
  setTemplate: (updater: (currentTemplate: SheetTemplate) => SheetTemplate) => void
  imageUrl: string | null
  imageSettings: SheetImageSettings
  zoom: number
  setZoom: (zoom: number) => void
  selectedRegionId: string | null
  onSelectRegion: (regionId: string) => void
  hiddenRegionIds?: ReadonlySet<string>
  positionLockedRegionIds?: ReadonlySet<string>
}) {
  const [dragPreview, setDragPreview] = useState<TemplateEditorDragPreview | null>(null)
  const isPixelQuantizedTemplate = template.templateKind !== 'digital-native'
  const previewDurationFrames = template.defaults.durationFrames
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
  const unfilteredBaseRenderModel = useMemo(
    () => buildTemplateEditorRenderModel(template, previewDurationFrames),
    [template, previewDurationFrames],
  )
  const baseRenderModel = useMemo(
    () => withoutTemplateRegions(unfilteredBaseRenderModel, hiddenRegionIds),
    [hiddenRegionIds, unfilteredBaseRenderModel],
  )
  const interactiveTemplate = useMemo(() => hiddenRegionIds?.size
    ? { ...editorTemplate, regions: editorTemplate.regions.filter(region => !hiddenRegionIds.has(region.regionId)) }
    : editorTemplate,
  [editorTemplate, hiddenRegionIds])
  const editorSurface = useMemo(
    () => buildTemplateEditorSurfaceModel(editorTemplate, previewDurationFrames),
    [editorTemplate, previewDurationFrames],
  )
  const interactionTemplate = useMemo(() => ({
    ...interactiveTemplate,
    page: { ...interactiveTemplate.page, ...editorSurface.pageSize },
    regions: interactiveTemplate.regions.map(region => ({
      ...region,
      rect: editorSurface.regionRects.get(region.regionId) ?? region.rect,
    })),
  }), [editorSurface, interactiveTemplate])
  const activeRegionRenderModel = useMemo(
    () => dragPreview
      && dragPreview.targetId !== TEMPLATE_CALIBRATION_TARGET_ID
      && !hiddenRegionIds?.has(dragPreview.targetId)
      ? buildTemplateEditorRegionRenderModel(editorTemplate, dragPreview.targetId, previewDurationFrames)
      : null,
    [dragPreview, editorTemplate, hiddenRegionIds, previewDurationFrames],
  )
  const baseSurface = useMemo(
    () => dragPreview ? buildTemplateEditorSurfaceModel(template, previewDurationFrames) : editorSurface,
    [dragPreview, editorSurface, template, previewDurationFrames],
  )
  const calibrationSourceRect = dragPreview?.targetId === TEMPLATE_CALIBRATION_TARGET_ID
    ? dragPreview.rect
    : baseRenderModel.calibrationTargetRect
  const calibrationTargetRect = editorSurface.calibrationTargetRect
  const calibrationOutlineRect = dragPreview?.targetId === TEMPLATE_CALIBRATION_TARGET_ID
    ? baseSurface.calibrationTargetRect
    : calibrationTargetRect
  const isCalibrationTargetSelected = selectedRegionId === TEMPLATE_CALIBRATION_TARGET_ID
  const selectedRegion = selectedRegionId && !isCalibrationTargetSelected && !hiddenRegionIds?.has(selectedRegionId)
    ? editorTemplate.regions.find(region => region.regionId === selectedRegionId) ?? null
    : null
  const selectedSurfaceRect = selectedRegion
    ? editorSurface.regionRects.get(selectedRegion.regionId) ?? selectedRegion.rect
    : null
  const selectedRegionPositionLocked = Boolean(selectedRegion && positionLockedRegionIds?.has(selectedRegion.regionId))
  const selectedGridSummary = selectedRegion?.grid
    ? {
        columns: resolveSheetTemplateGridColumns(editorTemplate, selectedRegion.grid, editorTemplate.defaults.paperTracks).length,
        rows: resolveSheetTemplateGridFrames(editorTemplate, selectedRegion.grid, previewDurationFrames).rowCount,
      }
    : null
  const editableEdges = useMemo(
    () => templateEditorEditableEdges(editorTemplate, selectedRegion, selectedRegionPositionLocked),
    [editorTemplate, selectedRegion, selectedRegionPositionLocked],
  )
  const regionHitRadius = useMemo(() => templateEditorHitRadius(interactionTemplate, zoom, 6), [interactionTemplate, zoom])
  const calibrationHitRadius = useMemo(() => templateEditorHitRadius(interactionTemplate, zoom, 9), [interactionTemplate, zoom])

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
  }, [editorSurface.pageSize.heightPx, editorSurface.pageSize.widthPx, zoom])

  useLayoutEffect(() => {
    hoveredTargetIdRef.current = null
    if (hoveredOverlayRef.current) hoveredOverlayRef.current.style.opacity = '0'
  }, [editorSurface.pageSize.heightPx, editorSurface.pageSize.widthPx, selectedRegionId, zoom])

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
      interactionTemplate.page,
    )
  }

  function targetFromEvent(event: PointerEvent<SVGElement>, refresh = false): TemplateEditorTarget | null {
    return hitTestTemplateEditorTarget(interactionTemplate, pointFromEvent(event, refresh), {
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
        : interactionTemplate.regions.find(region => region.regionId === target.regionId)?.rect ?? null
    if (!rect) {
      overlay.style.opacity = '0'
      return
    }
    overlay.style.width = `${rect.w * interactionTemplate.page.widthPx}px`
    overlay.style.height = `${rect.h * interactionTemplate.page.heightPx}px`
    overlay.style.transform = `translate3d(${rect.x * interactionTemplate.page.widthPx}px, ${rect.y * interactionTemplate.page.heightPx}px, 0)`
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
    const pointerId = event.pointerId
    const target = event.currentTarget
    const targetId = isCalibrationTargetSelected ? TEMPLATE_CALIBRATION_TARGET_ID : selectedRegionId
    const startRect = isCalibrationTargetSelected ? calibrationSourceRect : selectedRegion?.rect
    const startSurfaceRect = isCalibrationTargetSelected ? calibrationTargetRect : selectedSurfaceRect
    if (!targetId || !startRect || !startSurfaceRect || (!isCalibrationTargetSelected && !editableEdges.has(edge))) return
    if (targetId !== TEMPLATE_CALIBRATION_TARGET_ID && positionLockedRegionIds?.has(targetId)) return
    event.preventDefault()
    event.stopPropagation()
    const svg = editorSvgRef.current
    if (!svg) return
    const dragClientRect = editorClientRect(svg, true)
    const dragSurfacePage = editorSurface.pageSize
    const sourcePage = editorTemplate.page
    const pointFromDragEvent = (clientX: number, clientY: number) => snapTemplateEditorPointToPagePixels(
      templateEditorPointFromClientRect(dragClientRect, clientX, clientY),
      dragSurfacePage,
    )
    let latestPoint = pointFromDragEvent(event.clientX, event.clientY)
    let previewFrameId = 0
    const updatePreview = () => {
      previewFrameId = 0
      const rect = updateTemplateEditorRectEdgeFromSurface(startRect, startSurfaceRect, edge, latestPoint, sourcePage, dragSurfacePage)
      setDragPreview({ targetId, rect: quantizeNormalizedRectToPagePixels(rect, sourcePage) })
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
        updateTemplateEditorRectEdgeFromSurface(startRect, startSurfaceRect, edge, latestPoint, sourcePage, dragSurfacePage),
        sourcePage,
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
    const nextZoom = clampNumber(zoom * factor, TEMPLATE_ZOOM_MIN, TEMPLATE_ZOOM_MAX)
    const ratio = nextZoom / zoom
    setZoom(nextZoom)
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = contentX * ratio - localX
      viewport.scrollTop = contentY * ratio - localY
    })
  }

  const activeEditorRect = isCalibrationTargetSelected ? calibrationTargetRect : selectedSurfaceRect
  const activeEditorRectResizable = isCalibrationTargetSelected || editableEdges.size > 0
  const activeEditorRectReadout = activeEditorRect
    ? (() => {
        const edges = normalizedRectToPixelEdges(activeEditorRect, editorSurface.pageSize)
        return `X ${edges.left} / Y ${edges.top} / W ${edges.right - edges.left} / H ${edges.bottom - edges.top} / R ${edges.right} / B ${edges.bottom}`
      })()
    : null

  return (
    <div className="templateEditor">
      <div className="templateEditorViewport" onWheel={handleWheelZoom}>
        <div
          className="templateEditorZoomSurface"
          style={{
            width: `${editorSurface.pageSize.widthPx * zoom}px`,
            height: `${editorSurface.pageSize.heightPx * zoom}px`,
          }}
        >
        <div
          className={`templateEditorCanvas ${zoom < 1 ? 'smoothZoom' : 'pixelZoom'} ${isPixelQuantizedTemplate && zoom >= 4 ? 'preciseZoom' : ''} ${isPixelQuantizedTemplate && zoom >= 8 ? 'showPixelGrid' : ''}`}
          style={{
            width: `${editorSurface.pageSize.widthPx}px`,
            height: `${editorSurface.pageSize.heightPx}px`,
            aspectRatio: `${editorSurface.pageSize.widthPx} / ${editorSurface.pageSize.heightPx}`,
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
          {activeEditorRect && activeEditorRectResizable && (
            <TemplateEdgeGuides
              rect={activeEditorRect}
              page={editorSurface.pageSize}
              zoom={zoom}
              editableEdges={isCalibrationTargetSelected ? ALL_TEMPLATE_REGION_EDGES : editableEdges}
              variant={isCalibrationTargetSelected ? 'calibrationTarget' : undefined}
              onEdgePointerDown={handleEdgePointerDown}
            />
          )}
          {selectedRegion && (
            <TemplateHandleOverlay
              rect={selectedSurfaceRect!}
              page={editorSurface.pageSize}
              positionLocked={selectedRegionPositionLocked}
              editableEdges={editableEdges}
              onEdgePointerDown={handleEdgePointerDown}
            />
          )}
          {isCalibrationTargetSelected && calibrationTargetRect && (
            <TemplateHandleOverlay rect={calibrationTargetRect} page={editorSurface.pageSize} variant="calibrationTarget" editableEdges={ALL_TEMPLATE_REGION_EDGES} onEdgePointerDown={handleEdgePointerDown} />
          )}
        </div>
        </div>
      </div>
      <div className="templateEditorCaption">
        <strong>{isCalibrationTargetSelected ? uiText.template.calibrationTarget : selectedRegion?.label ?? '-'}</strong>
        <span className="muted">
          {isCalibrationTargetSelected
            ? uiText.template.calibrationTargetCaption
            : selectedRegion?.grid && selectedGridSummary ? `${gridRoleLabel(selectedRegion.grid.role)} / ${selectedGridSummary.columns}列 / ${selectedGridSummary.rows}行` : uiText.template.noGridRegion}
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
  const visibleRenderModel = useMemo(
    () => hiddenRegionId ? withoutTemplateRegions(renderModel, new Set([hiddenRegionId])) : renderModel,
    [hiddenRegionId, renderModel],
  )
  return (
    <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="templatePreviewSvg templateStaticPreviewSvg" aria-hidden="true">
      <g className="templateStaticLayer">
        <rect className="sheetPaperBackground" x="0" y="0" width="1" height="1" fill={template.theme.paper.color} />
        {imageUrl && <SheetImageLayer imageUrl={imageUrl} imageSettings={imageSettings} template={template} placement={template.defaultUnderlay?.placement} forceRaw preview />}
        <TemplateChromeLayer model={visibleRenderModel.chrome} />
        {visibleRenderModel.gridOverlays.map(model => <GridOverlayLayer key={model.regionId} model={model} />)}
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
  editableEdges,
  variant,
  onEdgePointerDown,
}: {
  rect: NormalizedRect
  page: Pick<SheetTemplate['page'], 'widthPx' | 'heightPx'>
  zoom: number
  editableEdges: ReadonlySet<TemplateRegionEdge>
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
      {editableEdges.has('left') && <div className="templateDomEdgeGuide vertical" style={{ width: `${hitWidth}px`, height: `${page.heightPx}px`, transform: `translate3d(${left - hitWidth / 2}px, 0, 0)` }} onPointerDown={event => onEdgePointerDown('left', event)} />}
      {editableEdges.has('right') && <div className="templateDomEdgeGuide vertical" style={{ width: `${hitWidth}px`, height: `${page.heightPx}px`, transform: `translate3d(${right - hitWidth / 2}px, 0, 0)` }} onPointerDown={event => onEdgePointerDown('right', event)} />}
      {editableEdges.has('top') && <div className="templateDomEdgeGuide horizontal" style={{ width: `${page.widthPx}px`, height: `${hitWidth}px`, transform: `translate3d(0, ${top - hitWidth / 2}px, 0)` }} onPointerDown={event => onEdgePointerDown('top', event)} />}
      {editableEdges.has('bottom') && <div className="templateDomEdgeGuide horizontal" style={{ width: `${page.widthPx}px`, height: `${hitWidth}px`, transform: `translate3d(0, ${bottom - hitWidth / 2}px, 0)` }} onPointerDown={event => onEdgePointerDown('bottom', event)} />}
    </div>
  )
}

function TemplateHandleOverlay({
  rect,
  page,
  variant,
  positionLocked = false,
  editableEdges,
  onEdgePointerDown,
}: {
  rect: NormalizedRect
  page: Pick<SheetTemplate['page'], 'widthPx' | 'heightPx'>
  variant?: 'calibrationTarget'
  positionLocked?: boolean
  editableEdges: ReadonlySet<TemplateRegionEdge>
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
      <TemplateEditHandles rect={rect} page={page} variant={variant} positionLocked={positionLocked} editableEdges={editableEdges} onEdgePointerDown={onEdgePointerDown} />
    </svg>
  )
}

function TemplateEditHandles({
  rect,
  page,
  variant,
  positionLocked = false,
  editableEdges,
  onEdgePointerDown,
}: {
  rect: NormalizedRect
  page: Pick<SheetTemplate['page'], 'widthPx' | 'heightPx'>
  variant?: 'calibrationTarget'
  positionLocked?: boolean
  editableEdges: ReadonlySet<TemplateRegionEdge>
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
      {!positionLocked && (
        <>
          <g className="templatePixelEdgeBands" aria-hidden="true">
            <rect x={left} y={top} width={pixelWidth} height={rect.h} />
            <rect x={Math.max(left, right - pixelWidth)} y={top} width={pixelWidth} height={rect.h} />
            <rect x={left} y={top} width={rect.w} height={pixelHeight} />
            <rect x={left} y={Math.max(top, bottom - pixelHeight)} width={rect.w} height={pixelHeight} />
          </g>
          {editableEdges.has('left') && <circle className="templateHandleKnob vertical" cx={left} cy={midY} r={knobRadius} onPointerDown={event => onEdgePointerDown('left', event)} />}
          {editableEdges.has('right') && <circle className="templateHandleKnob vertical" cx={right} cy={midY} r={knobRadius} onPointerDown={event => onEdgePointerDown('right', event)} />}
          {editableEdges.has('top') && <circle className="templateHandleKnob horizontal" cx={midX} cy={top} r={knobRadius} onPointerDown={event => onEdgePointerDown('top', event)} />}
          {editableEdges.has('bottom') && <circle className="templateHandleKnob horizontal" cx={midX} cy={bottom} r={knobRadius} onPointerDown={event => onEdgePointerDown('bottom', event)} />}
        </>
      )}
    </g>
  )
}

const ALL_TEMPLATE_REGION_EDGES = new Set<TemplateRegionEdge>(['left', 'right', 'top', 'bottom'])

function templateEditorEditableEdges(
  template: SheetTemplate,
  region: SheetTemplate['regions'][number] | null,
  positionLocked: boolean,
): ReadonlySet<TemplateRegionEdge> {
  if (!region || positionLocked) return new Set()
  const placement = templateRegionPlacementMode(template, region)
  if (placement === 'horizontal-flow') return new Set<TemplateRegionEdge>(['top', 'bottom'])
  if (placement === 'horizontal-span') return new Set<TemplateRegionEdge>(['left', 'top', 'bottom'])
  return ALL_TEMPLATE_REGION_EDGES
}

function withoutTemplateRegions(
  renderModel: TemplateEditorRenderModel,
  hiddenRegionIds: ReadonlySet<string> | undefined,
): TemplateEditorRenderModel {
  if (!hiddenRegionIds?.size) return renderModel
  const visibleModelKey = (key: string) => {
    for (const regionId of hiddenRegionIds) {
      if (key.startsWith(`${regionId}:`)) return false
    }
    return true
  }
  return {
    ...renderModel,
    chrome: {
      ...renderModel.chrome,
      referenceRegions: renderModel.chrome.referenceRegions.filter(region => !hiddenRegionIds.has(region.regionId)),
      headers: renderModel.chrome.headers.filter(header => !hiddenRegionIds.has(header.regionId)),
      formBoxes: renderModel.chrome.formBoxes.filter(box => visibleModelKey(box.key)),
      formLabels: renderModel.chrome.formLabels.filter(label => visibleModelKey(label.key)),
      formFields: renderModel.chrome.formFields.filter(field => !hiddenRegionIds.has(field.regionId)),
      formAnnotationTargets: renderModel.chrome.formAnnotationTargets.filter(target => visibleModelKey(target.key)),
    },
    gridOverlays: renderModel.gridOverlays.filter(model => !hiddenRegionIds.has(model.regionId)),
  }
}
