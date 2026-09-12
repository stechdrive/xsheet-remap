import { getSheetViewLayout, resolveSheetTemplateGridColumns, resolveSheetTemplateGridFrames, type NormalizedRect, type SheetTemplate } from '@xsheet-remap/core'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { useCanvasKitPaper } from './useCanvasKitPaper'
import { useTemplateZoomPreview } from './useTemplateZoomPreview'
import { startTemplatePointerDrag } from './templatePointerDrag'
import { buildTemplateRegionsPreview } from './templatePreviewModel'
import type { SheetImageSettings } from './appTypes'
import { uiText } from './i18n'
import { SHEET_ZOOM_WHEEL_FACTOR, TEMPLATE_ZOOM_MAX, TEMPLATE_ZOOM_MIN } from './sheetConstants'
import { clampNumber, handleNativeHorizontalWheelScroll, nativeVerticalWheelDelta, nativeWheelUsesApplicationZoom } from './sheetInteraction'
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
  mode: 'geometry' | 'translate'
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
  toolbar,
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
  toolbar?: ReactNode
}) {
  const view = useSyncExternalStore(viewStore.subscribe, viewStore.getSnapshot, viewStore.getSnapshot)
  const { zoom, referenceOpacity } = view
  const [dragPreview, setDragPreview] = useState<TemplateEditorDragPreview | null>(null)
  const isPixelQuantizedTemplate = template.templateKind !== 'digital-native'
  const previewDurationFrames = template.defaults.durationFrames
  const editorSvgRef = useRef<SVGSVGElement | null>(null)
  const editorClientRectRef = useRef<DOMRect | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  useCanvasKitPaper(viewportRef)
  useTemplateZoomPreview(viewportRef, zoom)
  const cancelDragRef = useRef<(() => void) | null>(null)
  const [hoverState, setHoverState] = useState<{ id: string | null; selection: string | null; zoom: number } | null>(null)
  const hoveredTargetId = hoverState?.selection === selectedRegionId && hoverState.zoom === zoom ? hoverState.id : null
  function setHoveredTargetId(id: string | null) {
    setHoverState(current => current?.id === id && current.selection === selectedRegionId && current.zoom === zoom
      ? current : { id, selection: selectedRegionId, zoom })
  }
  const [touchControls, setTouchControls] = useState(false)
  useEffect(() => () => { cancelDragRef.current?.() }, [template, selectedRegionId])
  const pendingWheelZoomRef = useRef<PendingTemplateWheelZoom | null>(null)
  const wheelZoomFrameRef = useRef<number | null>(null)
  const hoveredOverlayRef = useRef<HTMLDivElement | null>(null)
  const hoveredTargetIdRef = useRef<string | null>(null)
  const basePaperTimeline = useMemo(() => editablePaperTimelineStructure(template), [template])
  const isTranslationPreview = !!dragPreview && dragPreview.mode === 'translate'
  const previewTargetId = dragPreview?.targetId
  const moveSourceRect = previewTargetId === PAPER_TIMELINE_TARGET_ID
    ? basePaperTimeline?.rect
    : template.regions.find(region => region.regionId === previewTargetId)?.rect
  const hasDynamicLayout = !!template.horizontalFlow || getSheetViewLayout(template).surface?.type === 'continuous-canvas'
  const fullLayoutPreview = !!dragPreview && hasDynamicLayout
  const timelineGeometryPreview = previewTargetId === PAPER_TIMELINE_TARGET_ID && !isTranslationPreview
  const editorTemplate = useMemo(() => {
    if (!dragPreview) return template
    if (isTranslationPreview) return template
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
  }, [basePaperTimeline, dragPreview, isTranslationPreview, template])
  const paperTimeline = useMemo(() => editablePaperTimelineStructure(editorTemplate), [editorTemplate])
  const baseRenderTemplate = fullLayoutPreview ? editorTemplate : template
  const unfilteredBaseRenderModel = useMemo(
    () => buildTemplateEditorRenderModel(baseRenderTemplate, previewDurationFrames),
    [baseRenderTemplate, previewDurationFrames],
  )
  const previewRegionIds = useMemo(() => {
    if ((!isTranslationPreview && !timelineGeometryPreview) || !previewTargetId) return null
    const visibleIds = new Set(previewTargetId === PAPER_TIMELINE_TARGET_ID ? basePaperTimeline?.managedRegionIds : [previewTargetId])
    for (const regionId of hiddenRegionIds ?? []) visibleIds.delete(regionId)
    return visibleIds
  }, [basePaperTimeline, hiddenRegionIds, isTranslationPreview, timelineGeometryPreview, previewTargetId])
  const translationRenderModel = useMemo(
    () => previewRegionIds
      ? onlyTemplateRegions(unfilteredBaseRenderModel, previewRegionIds)
      : null,
    [previewRegionIds, unfilteredBaseRenderModel],
  )
  const timelineGeometryRenderModel = useMemo(() => timelineGeometryPreview && previewRegionIds
    ? buildTemplateRegionsPreview(editorTemplate, previewRegionIds, unfilteredBaseRenderModel)
    : null, [timelineGeometryPreview, previewRegionIds, editorTemplate, unfilteredBaseRenderModel])
  const baseHiddenRegionIds = useMemo(() => {
    if (!previewRegionIds) return hiddenRegionIds
    return new Set([...hiddenRegionIds ?? [], ...previewRegionIds])
  }, [previewRegionIds, hiddenRegionIds])
  const baseRenderModel = useMemo(
    () => withoutTemplateRegions(unfilteredBaseRenderModel, baseHiddenRegionIds),
    [baseHiddenRegionIds, unfilteredBaseRenderModel],
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
    () => dragPreview && !isTranslationPreview && !fullLayoutPreview
      && dragPreview.targetId !== TEMPLATE_CALIBRATION_TARGET_ID
      && dragPreview.targetId !== PAPER_TIMELINE_TARGET_ID
      && !hiddenRegionIds?.has(dragPreview.targetId)
      ? buildTemplateEditorRegionRenderModel(editorTemplate, dragPreview.targetId, previewDurationFrames)
      : null,
    [dragPreview, editorTemplate, hiddenRegionIds, previewDurationFrames, isTranslationPreview, fullLayoutPreview],
  )
  const calibrationSourceRect = dragPreview?.targetId === TEMPLATE_CALIBRATION_TARGET_ID
    ? dragPreview.rect
    : baseRenderModel.calibrationTargetRect
  const calibrationTargetRect = editorSurface.calibrationTargetRect
  const paperTimelineMoveDelta = isTranslationPreview && previewTargetId === PAPER_TIMELINE_TARGET_ID && basePaperTimeline && dragPreview
    ? { x: dragPreview.rect.x - basePaperTimeline.rect.x, y: dragPreview.rect.y - basePaperTimeline.rect.y }
    : null
  const movesCalibrationWithPaperTimeline = Boolean(
    paperTimelineMoveDelta
    && basePaperTimeline
    && template.calibration?.targetRect
    && sameNormalizedRect(template.calibration.targetRect, basePaperTimeline.rect),
  )
  const calibrationOutlineRect = movesCalibrationWithPaperTimeline && calibrationTargetRect && paperTimelineMoveDelta
      ? { ...calibrationTargetRect, x: calibrationTargetRect.x + paperTimelineMoveDelta.x, y: calibrationTargetRect.y + paperTimelineMoveDelta.y }
      : calibrationTargetRect
  const isCalibrationTargetSelected = selectedRegionId === TEMPLATE_CALIBRATION_TARGET_ID
  const isPaperTimelineSelected = selectedRegionId === PAPER_TIMELINE_TARGET_ID
  const selectedRegion = selectedRegionId && !isCalibrationTargetSelected && !isPaperTimelineSelected && !hiddenRegionIds?.has(selectedRegionId)
    ? editorTemplate.regions.find(region => region.regionId === selectedRegionId) ?? null
    : null
  const selectedSurfaceRect = selectedRegion
    ? isTranslationPreview && previewTargetId === selectedRegion.regionId ? dragPreview!.rect
      : editorSurface.regionRects.get(selectedRegion.regionId) ?? selectedRegion.rect
    : null
  const paperTimelineSurfaceRect = isTranslationPreview && previewTargetId === PAPER_TIMELINE_TARGET_ID && dragPreview ? dragPreview.rect : paperTimeline?.rect ?? null
  const selectedRegionPositionLocked = Boolean(selectedRegion && positionLockedRegionIds?.has(selectedRegion.regionId))
  const selectedGridSummary = useMemo(() => selectedRegion?.grid
    ? {
        columns: resolveSheetTemplateGridColumns(editorTemplate, selectedRegion.grid, editorTemplate.defaults.paperTracks).length,
        rows: resolveSheetTemplateGridFrames(editorTemplate, selectedRegion.grid, previewDurationFrames).rowCount,
      }
    : null, [selectedRegion, editorTemplate, previewDurationFrames])
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
    const updateClientRect = () => { editorClientRectRef.current = null }
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
    setHoveredTargetId(nextTargetId)
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
    if (event.pointerType === 'mouse') setTouchControls(false)
    updateHoverOverlay(targetFromEvent(event), event.currentTarget)
  }

  function handleHitSurfacePointerLeave(event: PointerEvent<SVGElement>) {
    if (event.relatedTarget instanceof Element && event.relatedTarget.closest('.templateEditAffordances')) return
    updateHoverOverlay(null)
  }

  function handleHitSurfacePointerDown(event: PointerEvent<SVGElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    setTouchControls(event.pointerType !== 'mouse')
    const target = targetFromEvent(event, true)
    if (!target) { setTouchControls(false); return }
    event.preventDefault()
    event.stopPropagation()
    updateHoverOverlay(target, event.currentTarget)
    const nextTargetId = targetId(target)
    if (nextTargetId === selectedRegionId && event.pointerType === 'mouse') {
      handleMovePointerDown(event)
      return
    }
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

  function beginDrag(event: PointerEvent<Element>, targetId: string, startRect: NormalizedRect,
    mode: TemplateEditorDragPreview['mode'], rectAt: (x: number, y: number) => NormalizedRect) {
    event.preventDefault()
    event.stopPropagation()
    cancelDragRef.current?.()
    setTouchControls(event.pointerType !== 'mouse')
    cancelDragRef.current = startTemplatePointerDrag(event, rectAt,
      rect => setDragPreview(current => !rect ? null : current?.targetId === targetId && sameNormalizedRect(current.rect, rect)
        ? current : { targetId, rect, mode }),
      rect => { if (!sameNormalizedRect(startRect, rect)) commitDragRect(targetId, rect) })
  }

  function handleEdgePointerDown(edge: TemplateRegionEdge, event: PointerEvent<Element>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const targetId = isCalibrationTargetSelected ? TEMPLATE_CALIBRATION_TARGET_ID : isPaperTimelineSelected ? PAPER_TIMELINE_TARGET_ID : selectedRegionId
    const startRect = isCalibrationTargetSelected ? calibrationSourceRect : isPaperTimelineSelected ? basePaperTimeline?.rect : selectedRegion?.rect
    const startSurfaceRect = isCalibrationTargetSelected ? calibrationTargetRect : isPaperTimelineSelected ? paperTimelineSurfaceRect : selectedSurfaceRect
    if (!targetId || !startRect || !startSurfaceRect || (!isCalibrationTargetSelected && !isPaperTimelineSelected && !editableEdges.has(edge))) return
    if (positionLockedRegionIds?.has(targetId)) return
    const svg = editorSvgRef.current
    if (!svg) return
    const dragClientRect = editorClientRect(svg, true)
    const dragSurfacePage = editorSurface.pageSize
    const sourcePage = template.page
    beginDrag(event, targetId, startRect, 'geometry', (x, y) => quantizeNormalizedRectToPagePixels(
      updateTemplateEditorRectEdgeFromSurface(startRect, startSurfaceRect, edge,
        snapTemplateEditorPointToPagePixels(templateEditorPointFromClientRect(dragClientRect, x, y), dragSurfacePage),
        sourcePage, dragSurfacePage), sourcePage))
  }

  function handleMovePointerDown(event: PointerEvent<Element>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const targetId = isCalibrationTargetSelected ? TEMPLATE_CALIBRATION_TARGET_ID : isPaperTimelineSelected ? PAPER_TIMELINE_TARGET_ID : selectedRegionId
    const startRect = isCalibrationTargetSelected ? calibrationSourceRect : isPaperTimelineSelected ? basePaperTimeline?.rect : selectedRegion?.rect
    const svg = editorSvgRef.current
    if (!targetId || !startRect || !svg || positionLockedRegionIds?.has(targetId)) return
    const bounds = editorClientRect(svg, true)
    const sourcePage = template.page, surfacePage = editorSurface.pageSize
    const startX = event.clientX, startY = event.clientY
    const freeX = !selectedRegion || templateRegionPlacementMode(template, selectedRegion) === 'free'
    const mode = !hasDynamicLayout && targetId !== TEMPLATE_CALIBRATION_TARGET_ID ? 'translate' : 'geometry'
    beginDrag(event, targetId, startRect, mode, (x, y) => {
      if (x === startX && y === startY) return startRect
      const position = quantizeNormalizedRectToPagePixels({ ...startRect,
        x: freeX ? clampNumber(startRect.x + (x - startX) / bounds.width * surfacePage.widthPx / sourcePage.widthPx, 0, 1 - startRect.w) : startRect.x,
        y: clampNumber(startRect.y + (y - startY) / bounds.height * surfacePage.heightPx / sourcePage.heightPx, 0, 1 - startRect.h),
      }, sourcePage)
      // Moving must not round or resize authored widths, including imported fractional geometry.
      return { ...startRect, x: freeX ? clampNumber(position.x, 0, 1 - startRect.w) : startRect.x,
        y: clampNumber(position.y, 0, 1 - startRect.h) }
    })
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
      if (!nativeWheelUsesApplicationZoom(event)) {
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
  const activeEditorRectResizable = !positionLockedRegionIds?.has(selectedRegionId ?? '')
    && (isCalibrationTargetSelected || isPaperTimelineSelected || editableEdges.size > 0)
  const activeEditorRectReadout = activeEditorRect
    ? (() => {
        const edges = normalizedRectToPixelEdges(activeEditorRect, editorSurface.pageSize)
        return `X ${edges.left} / Y ${edges.top} / W ${edges.right - edges.left} / H ${edges.bottom - edges.top} / R ${edges.right} / B ${edges.bottom}`
      })()
    : null

  return (
    <div className="templateEditor">
      {toolbar && <div className="templateCanvasToolbar">{toolbar}</div>}
      <div ref={viewportRef} className="templateEditorViewport" onPointerLeave={() => updateHoverOverlay(null)}>
        <div
          className="templateEditorZoomSurface"
          style={{
            width: `${editorSurface.pageSize.widthPx * zoom}px`,
            height: `${editorSurface.pageSize.heightPx * zoom}px`,
          }}
        >
        <div
          data-controls-visible={!!dragPreview || touchControls || (!!selectedRegionId && hoveredTargetId === selectedRegionId)}
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
            hiddenRegionId={fullLayoutPreview || isTranslationPreview || dragPreview?.targetId === TEMPLATE_CALIBRATION_TARGET_ID || dragPreview?.targetId === PAPER_TIMELINE_TARGET_ID ? null : dragPreview?.targetId ?? null}
          />
          {isTranslationPreview && translationRenderModel && moveSourceRect && dragPreview && (
            <TemplateRegionTransformPreview
              renderModel={translationRenderModel}
              sourceRect={moveSourceRect}
              targetRect={dragPreview.rect}
              page={editorSurface.pageSize}
            />
          )}
          {timelineGeometryRenderModel && dragPreview && (
            <TemplateRegionTransformPreview renderModel={timelineGeometryRenderModel} sourceRect={dragPreview.rect} targetRect={dragPreview.rect} page={editorSurface.pageSize} />
          )}
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
          <div className="templateEditAffordances" onPointerEnter={() => setHoveredTargetId(selectedRegionId)}>
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
              zoom={zoom}
              editableEdges={editableEdges}
              onEdgePointerDown={handleEdgePointerDown}
            />
          )}
          {isCalibrationTargetSelected && calibrationTargetRect && (
            <TemplateHandleOverlay rect={calibrationTargetRect} page={editorSurface.pageSize} variant="calibrationTarget" zoom={zoom} editableEdges={ALL_TEMPLATE_REGION_EDGES} onEdgePointerDown={handleEdgePointerDown} />
          )}
          {isPaperTimelineSelected && paperTimelineSurfaceRect && (
            <TemplateHandleOverlay rect={paperTimelineSurfaceRect} page={editorSurface.pageSize} variant="paperTimeline" zoom={zoom}
              positionLocked={!!positionLockedRegionIds?.has(PAPER_TIMELINE_TARGET_ID)}
              editableEdges={ALL_TEMPLATE_REGION_EDGES} onEdgePointerDown={handleEdgePointerDown} />
          )}
          {activeEditorRect && !positionLockedRegionIds?.has(selectedRegionId ?? '') && (
            <button type="button" className="templateMoveHandle" aria-label="選択要素を移動"
              style={{ left: `${(activeEditorRect.x + activeEditorRect.w / 2) * editorSurface.pageSize.widthPx}px`,
                top: `${(activeEditorRect.y + activeEditorRect.h / 2) * editorSurface.pageSize.heightPx}px`,
                transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
              onPointerDown={handleMovePointerDown}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4" /></svg>
            </button>
          )}
          </div>
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

function TemplateRegionTransformPreview({
  renderModel,
  sourceRect,
  targetRect,
  page,
}: {
  renderModel: TemplateEditorRenderModel
  sourceRect: NormalizedRect
  targetRect: NormalizedRect
  page: { widthPx: number; heightPx: number }
}) {
  const deltaXPx = Math.round((targetRect.x - sourceRect.x) * page.widthPx * 1e6) / 1e6
  const deltaYPx = Math.round((targetRect.y - sourceRect.y) * page.heightPx * 1e6) / 1e6
  return (
    <div
      className="templateRegionTransformPreview"
      aria-hidden="true"
      style={{
        left: `${sourceRect.x * page.widthPx}px`,
        top: `${sourceRect.y * page.heightPx}px`,
        width: `${sourceRect.w * page.widthPx}px`,
        height: `${sourceRect.h * page.heightPx}px`,
        transform: `translate3d(${deltaXPx}px, ${deltaYPx}px, 0)`,
      }}
    >
      <TemplateRegionSnapshot renderModel={renderModel} sourceRect={sourceRect} />
    </div>
  )
}

const TemplateRegionSnapshot = memo(function TemplateRegionSnapshot({
  renderModel,
  sourceRect,
}: {
  renderModel: TemplateEditorRenderModel
  sourceRect: NormalizedRect
}) {
  return (
    <svg
      viewBox={`${sourceRect.x} ${sourceRect.y} ${sourceRect.w} ${sourceRect.h}`}
      preserveAspectRatio="none"
      className="templateRegionSnapshotSvg"
      aria-hidden="true"
    >
      <TemplateChromeLayer model={renderModel.chrome} />
      {renderModel.gridOverlays.map(model => <GridOverlayLayer key={model.regionId} model={model} />)}
    </svg>
  )
})

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
  zoom,
  variant,
  positionLocked = false,
  editableEdges,
  onEdgePointerDown,
}: {
  rect: NormalizedRect
  page: Pick<SheetTemplate['page'], 'widthPx' | 'heightPx'>
  zoom: number
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
      <TemplateEditHandles rect={rect} page={page} zoom={zoom} variant={variant} positionLocked={positionLocked} editableEdges={editableEdges} onEdgePointerDown={onEdgePointerDown} />
    </svg>
  )
}

function TemplateEditHandles({
  rect,
  page,
  zoom,
  variant,
  positionLocked = false,
  editableEdges,
  onEdgePointerDown,
}: {
  rect: NormalizedRect
  page: Pick<SheetTemplate['page'], 'widthPx' | 'heightPx'>
  zoom: number
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
  const knobRadiusX = 5 / (page.widthPx * zoom)
  const knobRadiusY = 5 / (page.heightPx * zoom)
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
          {editableEdges.has('left') && <ellipse className="templateHandleKnob vertical" cx={left} cy={midY} rx={knobRadiusX} ry={knobRadiusY} onPointerDown={event => onEdgePointerDown('left', event)} />}
          {editableEdges.has('right') && <ellipse className="templateHandleKnob vertical" cx={right} cy={midY} rx={knobRadiusX} ry={knobRadiusY} onPointerDown={event => onEdgePointerDown('right', event)} />}
          {editableEdges.has('top') && <ellipse className="templateHandleKnob horizontal" cx={midX} cy={top} rx={knobRadiusX} ry={knobRadiusY} onPointerDown={event => onEdgePointerDown('top', event)} />}
          {editableEdges.has('bottom') && <ellipse className="templateHandleKnob horizontal" cx={midX} cy={bottom} rx={knobRadiusX} ry={knobRadiusY} onPointerDown={event => onEdgePointerDown('bottom', event)} />}
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

function onlyTemplateRegions(
  renderModel: TemplateEditorRenderModel,
  visibleRegionIds: ReadonlySet<string>,
): TemplateEditorRenderModel {
  const visibleModelKey = (key: string) => {
    for (const regionId of visibleRegionIds) {
      if (key.startsWith(`${regionId}:`)) return true
    }
    return false
  }
  return {
    ...renderModel,
    calibrationTargetRect: null,
    chrome: {
      ...renderModel.chrome,
      showOuterFrame: false,
      referenceRegions: renderModel.chrome.referenceRegions.filter(region => visibleRegionIds.has(region.regionId)),
      headers: renderModel.chrome.headers.filter(header => visibleRegionIds.has(header.regionId)),
      formBoxes: renderModel.chrome.formBoxes.filter(box => visibleModelKey(box.key)),
      formLabels: renderModel.chrome.formLabels.filter(label => visibleModelKey(label.key)),
      formFields: renderModel.chrome.formFields.filter(field => visibleRegionIds.has(field.regionId)),
      formAnnotationTargets: renderModel.chrome.formAnnotationTargets.filter(target => visibleModelKey(target.key)),
    },
    gridOverlays: renderModel.gridOverlays.filter(model => visibleRegionIds.has(model.regionId)),
  }
}
