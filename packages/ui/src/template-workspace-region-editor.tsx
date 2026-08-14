import { resolveSheetTemplateGridColumns, resolveSheetTemplateGridFrames, type NormalizedRect, type SheetTemplate } from '@xsheet-remap/core'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent } from 'react'
import type { SheetImageSettings } from './appTypes'
import { uiText } from './i18n'
import { SHEET_ZOOM_WHEEL_FACTOR, TEMPLATE_ZOOM_MAX, TEMPLATE_ZOOM_MIN } from './sheetConstants'
import { clampNumber, handleNativeHorizontalWheelScroll, nativeVerticalWheelDelta } from './sheetInteraction'
import { GridOverlayLayer, TemplateChromeLayer } from './SheetTemplateLayers'
import { buildTemplateEditorRegionRenderModel, buildTemplateEditorRenderModel, buildTemplateEditorSurfaceModel, hitTestTemplateEditorTarget, normalizedRectToPixelEdges, quantizeNormalizedRectToPagePixels, snapTemplateEditorPointToPagePixels, templateEditorHitRadius, templateEditorPointFromClientRect, updateTemplateEditorRectEdgeFromSurface, type TemplateEditorRegionRenderModel, type TemplateEditorRenderModel, type TemplateEditorTarget } from './templateEditorGeometry'
import { gridRoleLabel, setTemplateCalibrationTargetRect, type TemplateRegionEdge } from './templateEditing'
import { templateRegionPlacementMode } from './templateRegionAuthoring'
import { TEMPLATE_CALIBRATION_TARGET_ID, sameNormalizedRect } from './template-workspace-model'
import { PAPER_TIMELINE_TARGET_ID, detectPaperTimelineStructure, transformPaperTimelineRect } from './paperTimelineAuthoring'
import { TemplateReferenceImageLayer } from './TemplateReferenceImageLayer'
import type { TemplateEditorViewStore } from './templateEditorViewStore'

type TemplateEditorDragPreview = {
  targetId: string
  rect: NormalizedRect
}

type PendingTemplateWheelZoom = {
  baseZoom: number
  targetZoom: number
  contentX: number
  contentY: number
  localX: number
  localY: number
}

function applyTemplateEditorZoomStyles(
  surface: HTMLElement,
  canvas: HTMLElement,
  page: { widthPx: number; heightPx: number },
  zoom: number,
  pixelQuantized: boolean,
) {
  surface.style.width = `${page.widthPx * zoom}px`
  surface.style.height = `${page.heightPx * zoom}px`
  canvas.style.transform = `scale(${zoom})`
  canvas.style.setProperty('--template-grid-line', `${1 / zoom}px`)
  canvas.classList.toggle('smoothZoom', zoom < 1)
  canvas.classList.toggle('pixelZoom', zoom >= 1)
  canvas.classList.toggle('preciseZoom', pixelQuantized && zoom >= 4)
  canvas.classList.toggle('showPixelGrid', pixelQuantized && zoom >= 8)
}

export function TemplateRegionEditor({
  template,
  setTemplate,
  imageUrl,
  imageSettings,
  viewStore,
  selectedRegionId,
  onSelectRegion,
  hiddenRegionIds,
  positionLockedRegionIds,
}: {
  template: SheetTemplate
  setTemplate: (updater: (currentTemplate: SheetTemplate) => SheetTemplate) => void
  imageUrl: string | null
  imageSettings: SheetImageSettings
  viewStore: TemplateEditorViewStore
  selectedRegionId: string | null
  onSelectRegion: (regionId: string) => void
  hiddenRegionIds?: ReadonlySet<string>
  positionLockedRegionIds?: ReadonlySet<string>
}) {
  const view = useSyncExternalStore(viewStore.subscribe, viewStore.getSnapshot, viewStore.getSnapshot)
  const { zoom, referenceOpacity } = view
  const [dragPreview, setDragPreview] = useState<TemplateEditorDragPreview | null>(null)
  const isPixelQuantizedTemplate = template.templateKind !== 'digital-native'
  const previewDurationFrames = template.defaults.durationFrames
  const editorSvgRef = useRef<SVGSVGElement | null>(null)
  const editorClientRectRef = useRef<DOMRect | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const pendingWheelZoomRef = useRef<PendingTemplateWheelZoom | null>(null)
  const wheelZoomFrameRef = useRef<number | null>(null)
  const hoveredOverlayRef = useRef<HTMLDivElement | null>(null)
  const hoveredTargetIdRef = useRef<string | null>(null)
  const basePaperTimeline = useMemo(() => editablePaperTimelineStructure(template), [template])
  const editorTemplate = useMemo(() => {
    if (!dragPreview) return template
    if (dragPreview.targetId === TEMPLATE_CALIBRATION_TARGET_ID) {
      return setTemplateCalibrationTargetRect(template, dragPreview.rect)
    }
    if (dragPreview.targetId === PAPER_TIMELINE_TARGET_ID && basePaperTimeline) {
      return transformPaperTimelineRect(template, basePaperTimeline, dragPreview.rect)
    }
    return {
      ...template,
      regions: template.regions.map(region => region.regionId === dragPreview.targetId
        ? { ...region, rect: dragPreview.rect }
        : region),
    }
  }, [basePaperTimeline, dragPreview, template])
  const paperTimeline = useMemo(() => editablePaperTimelineStructure(editorTemplate), [editorTemplate])
  const baseRenderTemplate = dragPreview?.targetId === PAPER_TIMELINE_TARGET_ID ? editorTemplate : template
  const unfilteredBaseRenderModel = useMemo(
    () => buildTemplateEditorRenderModel(baseRenderTemplate, previewDurationFrames),
    [baseRenderTemplate, previewDurationFrames],
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
      && dragPreview.targetId !== PAPER_TIMELINE_TARGET_ID
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
  const isPaperTimelineSelected = selectedRegionId === PAPER_TIMELINE_TARGET_ID
  const selectedRegion = selectedRegionId && !isCalibrationTargetSelected && !isPaperTimelineSelected && !hiddenRegionIds?.has(selectedRegionId)
    ? editorTemplate.regions.find(region => region.regionId === selectedRegionId) ?? null
    : null
  const selectedSurfaceRect = selectedRegion
    ? editorSurface.regionRects.get(selectedRegion.regionId) ?? selectedRegion.rect
    : null
  const paperTimelineSurfaceRect = paperTimeline?.rect ?? null
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
  }, [editorSurface.pageSize.heightPx, editorSurface.pageSize.widthPx])

  useLayoutEffect(() => {
    editorClientRectRef.current = null
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
    if (target.kind === 'calibration-target') return TEMPLATE_CALIBRATION_TARGET_ID
    return paperTimeline?.managedRegionIds.has(target.regionId) ? PAPER_TIMELINE_TARGET_ID : target.regionId
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
        : nextTargetId === PAPER_TIMELINE_TARGET_ID
          ? paperTimelineSurfaceRect
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
    const nextTargetId = targetId(target)
    if (nextTargetId) onSelectRegion(nextTargetId)
  }

  function commitDragRect(targetId: string, rect: NormalizedRect) {
    setTemplate(currentTemplate => {
      if (targetId === TEMPLATE_CALIBRATION_TARGET_ID) {
        return setTemplateCalibrationTargetRect(currentTemplate, rect)
      }
      if (targetId === PAPER_TIMELINE_TARGET_ID) {
        const currentStructure = detectPaperTimelineStructure(currentTemplate)
        return currentStructure ? transformPaperTimelineRect(currentTemplate, currentStructure, rect) : currentTemplate
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
    const targetId = isCalibrationTargetSelected ? TEMPLATE_CALIBRATION_TARGET_ID : isPaperTimelineSelected ? PAPER_TIMELINE_TARGET_ID : selectedRegionId
    const startRect = isCalibrationTargetSelected ? calibrationSourceRect : isPaperTimelineSelected ? basePaperTimeline?.rect : selectedRegion?.rect
    const startSurfaceRect = isCalibrationTargetSelected ? calibrationTargetRect : isPaperTimelineSelected ? paperTimelineSurfaceRect : selectedSurfaceRect
    if (!targetId || !startRect || !startSurfaceRect || (!isCalibrationTargetSelected && !isPaperTimelineSelected && !editableEdges.has(edge))) return
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

  function handlePaperTimelineMovePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (!isPaperTimelineSelected || !basePaperTimeline || !paperTimelineSurfaceRect) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const pointerId = event.pointerId
    const target = event.currentTarget
    const svg = editorSvgRef.current
    if (!svg) return
    event.preventDefault()
    event.stopPropagation()
    const dragClientRect = editorClientRect(svg, true)
    const dragSurfacePage = editorSurface.pageSize
    const startPoint = snapTemplateEditorPointToPagePixels(
      templateEditorPointFromClientRect(dragClientRect, event.clientX, event.clientY),
      dragSurfacePage,
    )
    const startRect = basePaperTimeline.rect
    let latestPoint = startPoint
    let previewFrameId = 0
    const nextRect = () => ({
      ...startRect,
      x: startRect.x + latestPoint.x - startPoint.x,
      y: startRect.y + latestPoint.y - startPoint.y,
    })
    const updatePreview = () => {
      previewFrameId = 0
      setDragPreview({ targetId: PAPER_TIMELINE_TARGET_ID, rect: nextRect() })
    }
    const updateFromEvent = (nextEvent: globalThis.PointerEvent) => {
      if (nextEvent.pointerId !== pointerId) return
      latestPoint = snapTemplateEditorPointToPagePixels(
        templateEditorPointFromClientRect(dragClientRect, nextEvent.clientX, nextEvent.clientY),
        dragSurfacePage,
      )
      if (previewFrameId === 0) previewFrameId = window.requestAnimationFrame(updatePreview)
    }
    const finish = (nextEvent: globalThis.PointerEvent, useEventPoint: boolean) => {
      if (nextEvent.pointerId !== pointerId) return
      if (useEventPoint) updateFromEvent(nextEvent)
      if (previewFrameId !== 0) window.cancelAnimationFrame(previewFrameId)
      window.removeEventListener('pointermove', updateFromEvent)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      commitDragRect(PAPER_TIMELINE_TARGET_ID, nextRect())
      setDragPreview(null)
      if (typeof target.releasePointerCapture === 'function'
        && (typeof target.hasPointerCapture !== 'function' || target.hasPointerCapture(pointerId))) {
        target.releasePointerCapture(pointerId)
      }
    }
    const handlePointerUp = (nextEvent: globalThis.PointerEvent) => finish(nextEvent, true)
    const handlePointerCancel = (nextEvent: globalThis.PointerEvent) => finish(nextEvent, false)
    target.setPointerCapture(pointerId)
    window.addEventListener('pointermove', updateFromEvent)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    function flushWheelZoom() {
      wheelZoomFrameRef.current = null
      const pending = pendingWheelZoomRef.current
      pendingWheelZoomRef.current = null
      if (!pending) return
      const surface = viewport!.querySelector<HTMLElement>('.templateEditorZoomSurface')
      const canvas = viewport!.querySelector<HTMLElement>('.templateEditorCanvas')
      if (!surface || !canvas) return
      applyTemplateEditorZoomStyles(surface, canvas, editorSurface.pageSize, pending.targetZoom, isPixelQuantizedTemplate)
      const ratio = pending.targetZoom / pending.baseZoom
      viewport!.scrollLeft = pending.contentX * ratio - pending.localX
      viewport!.scrollTop = pending.contentY * ratio - pending.localY
      editorClientRectRef.current = null
      viewStore.setZoom(pending.targetZoom)
    }

    function handleWheel(event: globalThis.WheelEvent) {
      const modifierZoom = event.ctrlKey || event.metaKey
      const horizontalInput = !modifierZoom
        && (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))
      if (horizontalInput) {
        handleNativeHorizontalWheelScroll(event, viewport!)
        return
      }

      const rawVerticalDelta = nativeVerticalWheelDelta(event)
      if (rawVerticalDelta === 0) return
      event.preventDefault()
      const rect = viewport!.getBoundingClientRect()
      const localX = event.clientX - rect.left
      const localY = event.clientY - rect.top
      const contentX = viewport!.scrollLeft + localX
      const contentY = viewport!.scrollTop + localY
      const factor = rawVerticalDelta < 0 ? SHEET_ZOOM_WHEEL_FACTOR : 1 / SHEET_ZOOM_WHEEL_FACTOR
      const committedZoom = viewStore.getSnapshot().zoom
      const pendingZoom = pendingWheelZoomRef.current
      const baseForStep = pendingZoom?.baseZoom === committedZoom ? pendingZoom.targetZoom : committedZoom
      const nextZoom = clampNumber(baseForStep * factor, TEMPLATE_ZOOM_MIN, TEMPLATE_ZOOM_MAX)
      pendingWheelZoomRef.current = {
        baseZoom: committedZoom,
        targetZoom: nextZoom,
        contentX,
        contentY,
        localX,
        localY,
      }
      if (wheelZoomFrameRef.current === null) {
        wheelZoomFrameRef.current = window.requestAnimationFrame(flushWheelZoom)
      }
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      viewport.removeEventListener('wheel', handleWheel)
      if (wheelZoomFrameRef.current !== null) window.cancelAnimationFrame(wheelZoomFrameRef.current)
      wheelZoomFrameRef.current = null
      pendingWheelZoomRef.current = null
    }
  }, [editorSurface.pageSize, isPixelQuantizedTemplate, viewStore])

  const activeEditorRect = isCalibrationTargetSelected ? calibrationTargetRect : isPaperTimelineSelected ? paperTimelineSurfaceRect : selectedSurfaceRect
  const activeEditorRectResizable = isCalibrationTargetSelected || isPaperTimelineSelected || editableEdges.size > 0
  const activeEditorRectReadout = activeEditorRect
    ? (() => {
        const edges = normalizedRectToPixelEdges(activeEditorRect, editorSurface.pageSize)
        return `X ${edges.left} / Y ${edges.top} / W ${edges.right - edges.left} / H ${edges.bottom - edges.top} / R ${edges.right} / B ${edges.bottom}`
      })()
    : null

  return (
    <div className="templateEditor">
      <div ref={viewportRef} className="templateEditorViewport">
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
            referenceOpacity={referenceOpacity}
            hiddenRegionId={dragPreview?.targetId === TEMPLATE_CALIBRATION_TARGET_ID || dragPreview?.targetId === PAPER_TIMELINE_TARGET_ID ? null : dragPreview?.targetId ?? null}
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
              editableEdges={isCalibrationTargetSelected || isPaperTimelineSelected ? ALL_TEMPLATE_REGION_EDGES : editableEdges}
              variant={isCalibrationTargetSelected ? 'calibrationTarget' : isPaperTimelineSelected ? 'paperTimeline' : undefined}
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
          {isPaperTimelineSelected && paperTimelineSurfaceRect && (
            <>
              <TemplateHandleOverlay rect={paperTimelineSurfaceRect} page={editorSurface.pageSize} variant="paperTimeline" editableEdges={ALL_TEMPLATE_REGION_EDGES} onEdgePointerDown={handleEdgePointerDown} />
              <button
                type="button"
                className="paperTimelineMoveHandle"
                style={{
                  left: `${(paperTimelineSurfaceRect.x + paperTimelineSurfaceRect.w / 2) * editorSurface.pageSize.widthPx}px`,
                  top: `${paperTimelineSurfaceRect.y * editorSurface.pageSize.heightPx}px`,
                }}
                onPointerDown={handlePaperTimelineMovePointerDown}
              >6秒表を移動</button>
            </>
          )}
        </div>
        </div>
      </div>
      <div className="templateEditorCaption">
        <strong>{isCalibrationTargetSelected ? uiText.template.calibrationTarget : isPaperTimelineSelected ? '6秒タイムライン表' : selectedRegion?.label ?? '-'}</strong>
        <span className="muted">
          {isCalibrationTargetSelected
            ? uiText.template.calibrationTargetCaption
            : isPaperTimelineSelected
              ? '左3秒 1–72F / 右3秒 73–144F / 横罫線を共有'
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
  referenceOpacity,
  hiddenRegionId,
}: {
  template: SheetTemplate
  renderModel: ReturnType<typeof buildTemplateEditorRenderModel>
  imageUrl: string | null
  imageSettings: SheetImageSettings
  referenceOpacity: number
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
        {imageUrl && (
          <TemplateReferenceImageLayer
            imageUrl={imageUrl}
            imageSettings={imageSettings}
            template={template}
            placement={template.defaultUnderlay?.placement}
            opacity={referenceOpacity}
          />
        )}
        <TemplateChromeLayer model={visibleRenderModel.chrome} />
        {visibleRenderModel.gridOverlays.map(model => <GridOverlayLayer key={model.regionId} model={model} />)}
      </g>
    </svg>
  )
})

function editablePaperTimelineStructure(template: SheetTemplate) {
  const structure = detectPaperTimelineStructure(template)
  return structure?.status === 'incomplete' ? null : structure
}

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
  variant?: 'calibrationTarget' | 'paperTimeline'
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
    <div className={`templateEdgeGuides ${variant ?? ''}`.trim()} style={guideStyle}>
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
  variant?: 'calibrationTarget' | 'paperTimeline'
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
  variant?: 'calibrationTarget' | 'paperTimeline'
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
    <g className={`templateEditHandles ${variant ?? ''}`.trim()}>
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
