import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent } from 'react';
import { type NormalizedPoint, type PaperTrack, type SheetCalibrationPointPair, type SheetHit, type SheetPage, type SheetTimingRole, type TimedRangeCue, clampCameraOverlapPivotAnchorFrame, getSheetViewLayout, resolveCameraInstructionPoints, resolveCameraInstructionSegments, resolveSheetTemplateGridLayout, sheetTimingRoleForEvent, timingHitForFrame, transformCameraInstructionRange, hitTestSheetTemplate, isInteractiveSheetTemplateGridRegion, logicalSheetDisplayDurationFrames, logicalSheetDisplayFrameEnd, logicalSheetDisplayFrameStart, sheetAnnotations } from '@xsheet-remap/core';
import { uiText } from './i18n';
import { type SheetRangeSelection, type SheetImageSettings } from './appTypes';
import { assetIdFromAssetTextDragData, collectAssetFilesFromDrop, hasFileTransferPayload, parseAssetIdsFromDragData } from './assetFiles';
import { setInternalDragDropValidity, subscribeInternalDrag } from './internalDrag';
import { cellAssetPreviewItemsForHit, cellAssetPreviewPosition } from './sheetAssets';
import { ASSET_MULTI_DRAG_MIME, ASSET_DRAG_MIME, REGISTERED_CELL_DRAG_MIME, STACK_GUIDE_DRAG_MIME, SHEET_ZOOM_WHEEL_FACTOR } from './sheetConstants';
import { createSheetRenderModelContext } from './sheetRenderModel';
import { calibrationPointsForSettings } from './sheetImages';
import { clampNumber, clampSheetZoom, handleNativeHorizontalWheelScroll, rangeSelectionFromHits, sheetRoleForHit, sheetRoleLabel, nativeVerticalWheelDelta } from './sheetInteraction';
import { canPasteTimingClipboardMode, isPointEventRangeForUi, rangeContainsHit, rangePaperTracks, sameSheetHitCell } from './timingEditing';
import { CalibrationPointKind, OverlayPaperTrackMenuState, PaperTrackEditorState, PaperTrackHeaderMenuState, SHEET_INTERACTION_ACTIVE_CLASS, SheetContextMenuState, StackGuideDropPreviewState, StackGuideHeaderMenuState, StackGuideInsertRequest, StackGuideInsertTarget, StackGuideInsertTool, TimedRangeLaneHeaderMenuState, TimelineLaneEditorState, TIMELINE_EVENT_DRAG_THRESHOLD_PX, TIMELINE_EVENT_LONG_PRESS_MS, keyIdFromRegisteredCellTextDragData, sheetHitStatusHint, sheetHitTargetLabel } from './app-foundation';
import { OverlayPaperTrackDrag, frameOriginForPageHit, materializePageHit, nextAnnotationId, nextOverlayTrackNameForUi, overlayHitForFrame, overlayHitFromPoint, processMoveOptionsForSlot } from './app-sheet-layers';
import { overlayPaperTracks, overlaySnapIndexFromPoint, paperTrackOrderForRole } from './app-sheet-geometry';
import { autoScrollViewportForDrag, scrollSheetHitIntoView } from './sheet-panel-viewport';
import { defaultExportAfterTrackForInsertAfter, exportPreviousPaperTrackName, overlayExportPlacementAfterTrack, stackGuideInsertTargetFromPoint, stackGuidePlacementTargetFromPointer, stackGuidePlacementUpdateFromPointer } from './app-stack-guides';
import { singleMovableBindingForHit } from './app-registered-cells';
import type { SoundCueDragMode } from './SoundCueLayer';
import type { CameraCueDragGeometry, CameraCueDragMode } from './CameraCueLayer';
import { timedRangeLaneIdForHit, type EditableTimedRangeRole } from './timedRangeCueEditing';
import { resolveTimelineMemoContextTargets } from './timelineMemoEditing';
import { frameOperationRangeContainsHit } from './frameOperations'
import { releasePointerCaptureForElements, type DraftRangeInteraction, type PendingTimelineEventInteraction, type TimelineEventDragInteraction } from './sheet-pointer-session';
import type { SheetCanvasProps, SheetDropTargetPreview } from './app-sheet-canvas-types';
import { gridColumnHeaderHitFromPoint } from './sheetGridHeaderHit';
import { createTimelineLaneEditorActions } from './timelineLaneEditorActions';
import { useGlobalPointerDragLifecycle } from './useGlobalPointerDragLifecycle';
import { useAnimationFramePointerUpdate } from './useAnimationFramePointerUpdate';
import { useSheetCanvasRenderCaches } from './useSheetCanvasRenderCaches';
import { useSheetRenderCutGroupContext, useSheetRenderModelContext } from './useSheetRenderModelProject';
import { useSheetCalibrationDrag } from './useSheetCalibrationDrag';
import { useSheetTouchNavigation } from './useSheetTouchNavigation';
import { runSheetTouchTap } from './sheetTouchTap';
import type { SheetTouchLongPressAction, SheetTouchTap } from './sheetTouchNavigation';
import { createCameraCuePointerDrag, createSoundCuePointerDrag, type CameraCuePointerDrag, type SoundCuePointerDrag } from './timedCuePointerDrag';
import { beginSheetViewportPan } from './sheetViewportPan';
import { advancePrimaryPointerActivation, isInteractiveKeyboardTarget, primaryPointerActivation, resolveSheetViewportPointerIntent, sheetViewportPointerTarget, type PrimaryPointerActivation } from './workspaceInteractionPolicy';
import type { PageAnnotationStrokeStart } from './PageAnnotationInputSurface';
import { pageMemoInputPosition } from './pageMemoInputCoordinates';

export function useSheetCanvasController(props: SheetCanvasProps) {
  const [draftRange, setDraftRangeState] = useState<DraftRangeInteraction | null>(null)
  const [hoveredHit, setHoveredHit] = useState<SheetHit | null>(null)
  const [dropTargetPreview, setDropTargetPreview] = useState<SheetDropTargetPreview | null>(null)
  const [hoverPreviewAnchor, setHoverPreviewAnchor] = useState<{ x: number; y: number } | null>(null)
  const [textCursorBadge, setTextCursorBadge] = useState<{ pageId: string; x: number; y: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<SheetContextMenuState | null>(null)
  const [paperTrackHeaderMenu, setPaperTrackHeaderMenu] = useState<PaperTrackHeaderMenuState | null>(null)
  const [overlayPaperTrackMenu, setOverlayPaperTrackMenu] = useState<OverlayPaperTrackMenuState | null>(null)
  const [stackGuideHeaderMenu, setStackGuideHeaderMenu] = useState<StackGuideHeaderMenuState | null>(null)
  const [timedRangeLaneHeaderMenu, setTimedRangeLaneHeaderMenu] = useState<TimedRangeLaneHeaderMenuState | null>(null)
  const [stackGuideInsertRequest, setStackGuideInsertRequest] = useState<StackGuideInsertRequest | null>(null)
  const [stackGuideDropPreview, setStackGuideDropPreview] = useState<StackGuideDropPreviewState | null>(null)
  const [paperTrackEditor, setPaperTrackEditor] = useState<PaperTrackEditorState | null>(null)
  const [timelineLaneEditor, setTimelineLaneEditor] = useState<TimelineLaneEditorState | null>(null)
  const [overlayTrackDrag, setOverlayTrackDrag] = useState<OverlayPaperTrackDrag | null>(null)
  const [timelineEventDrag, setTimelineEventDragState] = useState<TimelineEventDragInteraction | null>(null)
  const [soundCueDrag, setSoundCueDrag] = useState<SoundCuePointerDrag | null>(null)
  const [hoveredSoundCueId, setHoveredSoundCueId] = useState<string | null>(null)
  const [soundCueHoverAnchor, setSoundCueHoverAnchor] = useState<{ x: number; y: number } | null>(null)
  const lastSoundCueActivationRef = useRef<PrimaryPointerActivation | null>(null)
  const [cameraCueDrag, setCameraCueDrag] = useState<CameraCuePointerDrag | null>(null)
  const lastCameraCueActivationRef = useRef<PrimaryPointerActivation | null>(null)
  const [hoveredCameraCueId, setHoveredCameraCueId] = useState<string | null>(null)
  const [cameraCueHoverAnchor, setCameraCueHoverAnchor] = useState<{ x: number; y: number } | null>(null)
  const [pendingTimelineEventDrag, setPendingTimelineEventDragState] = useState<PendingTimelineEventInteraction | null>(null)
  const [activeOverlayPaperTrack, setActiveOverlayPaperTrack] = useState<string | null>(null)
  const [draftCalibration, setDraftCalibration] = useState<{ pageId: string; points: SheetCalibrationPointPair[] } | null>(null)
  const [spacePanReady, setSpacePanReady] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const spacePanReadyRef = useRef(false)
  const panningRef = useRef(false)
  const draftRangeRef = useRef<DraftRangeInteraction | null>(null)
  const pendingTimelineEventDragRef = useRef<PendingTimelineEventInteraction | null>(null)
  const timelineEventDragRef = useRef<TimelineEventDragInteraction | null>(null)
  const updateTimelineEventPointerRef = useRef<(pointerId: number, clientX: number, clientY: number) => void>(() => undefined)
  const finishTimelineEventPointerRef = useRef<(pointerId: number, cancelled?: boolean, clientX?: number, clientY?: number) => void>(() => undefined)
  const commitDraftRangeFromPointerRef = useRef<(pointerId: number, clientX: number, clientY: number) => boolean>(() => false)
  const cancelDraftRangeInteractionRef = useRef<() => void>(() => undefined)
  const viewportRef = useRef<HTMLDivElement>(null)
  const pageStackRef = useRef<HTMLDivElement>(null)
  const sheetSvgRefs = useRef<Record<string, SVGSVGElement | null>>({})
  const activePageIndexRef = useRef(props.activePageIndex)
  const hoveredHitSignatureRef = useRef<string | null>(null)
  const hoveredHitHasPreviewRef = useRef(false)
  const dropTargetPreviewRef = useRef<SheetDropTargetPreview | null>(null)
  const dropTargetPreviewSignatureRef = useRef<string | null>(null)
  const hoverPreviewFrameRef = useRef<number | null>(null)
  const pendingHoverPreviewAnchorRef = useRef<{ x: number; y: number } | null>(null)
  const handledScrollRequestIdRef = useRef<number | null>(null)
  const previousOverlayTrackNamesRef = useRef<Set<string>>(new Set())
  const timelineEventLongPressTimerRef = useRef<number | null>(null)
  const stackGuideInsertRequestIdRef = useRef(0)
  const soundCueDragRef = useRef<typeof soundCueDrag>(null)
  const cameraCueDragRef = useRef<typeof cameraCueDrag>(null)
  const updateSoundCuePointerRef = useRef<(pointerId: number, clientX: number, clientY: number) => void>(() => undefined)
  const finishSoundCuePointerRef = useRef<(pointerId: number, cancelled?: boolean, clientX?: number, clientY?: number) => void>(() => undefined)
  const updateCameraCuePointerRef = useRef<(pointerId: number, clientX: number, clientY: number) => void>(() => undefined)
  const finishCameraCuePointerRef = useRef<(pointerId: number, cancelled?: boolean, clientX?: number, clientY?: number) => void>(() => undefined)
  const onStatusHint = props.onStatusHint
  const soundCuePointerUpdates = useAnimationFramePointerUpdate(updateSoundCuePointer)
  const cameraCuePointerUpdates = useAnimationFramePointerUpdate(updateCameraCuePointer)

  useGlobalPointerDragLifecycle({ active: soundCueDrag !== null, activeRef: soundCueDragRef, updateRef: updateSoundCuePointerRef, finishRef: finishSoundCuePointerRef })
  useGlobalPointerDragLifecycle({ active: cameraCueDrag !== null, activeRef: cameraCueDragRef, updateRef: updateCameraCuePointerRef, finishRef: finishCameraCuePointerRef })
  useGlobalPointerDragLifecycle({ active: timelineEventDrag !== null, activeRef: timelineEventDragRef, updateRef: updateTimelineEventPointerRef, finishRef: finishTimelineEventPointerRef })
  const calibrationDrag = useSheetCalibrationDrag({
    onPreview: (pageId, points) => setDraftCalibration({ pageId, points }),
    onCommit: (page, points) => props.onCalibrationPoints(page, points, false),
    onClear: () => setDraftCalibration(null),
  })
  function setDraftRange(next: DraftRangeInteraction | null | ((current: DraftRangeInteraction | null) => DraftRangeInteraction | null)) {
    const resolved = typeof next === 'function' ? next(draftRangeRef.current) : next
    draftRangeRef.current = resolved
    setDraftRangeState(resolved)
  }

  function setPendingTimelineEventDrag(next: PendingTimelineEventInteraction | null | ((current: PendingTimelineEventInteraction | null) => PendingTimelineEventInteraction | null)) {
    const resolved = typeof next === 'function' ? next(pendingTimelineEventDragRef.current) : next
    pendingTimelineEventDragRef.current = resolved
    setPendingTimelineEventDragState(resolved)
  }

  function setTimelineEventDrag(next: TimelineEventDragInteraction | null | ((current: TimelineEventDragInteraction | null) => TimelineEventDragInteraction | null)) {
    const resolved = typeof next === 'function' ? next(timelineEventDragRef.current) : next
    timelineEventDragRef.current = resolved
    setTimelineEventDragState(resolved)
  }

  function releaseDraftRangePointerCapture(interaction: DraftRangeInteraction | null) {
    if (!interaction) return
    releasePointerCaptureForElements(interaction.pointerId, Object.values(sheetSvgRefs.current))
  }

  function cancelDraftRangeInteraction() {
    releaseDraftRangePointerCapture(draftRangeRef.current)
    setDraftRange(null)
    props.onStatusHint('sheet-drag', null)
  }

  commitDraftRangeFromPointerRef.current = commitDraftRangeFromPointer
  cancelDraftRangeInteractionRef.current = cancelDraftRangeInteraction

  useEffect(() => {
    hoveredHitSignatureRef.current = null
    hoveredHitHasPreviewRef.current = false
  }, [props.project])
  useEffect(() => {
    const cancelTimelineInteraction = () => {
      if (!pendingTimelineEventDragRef.current && !timelineEventDragRef.current) return
      clearTimelineEventLongPressTimer()
      setPendingTimelineEventDrag(null)
      setTimelineEventDrag(null)
      onStatusHint('sheet-drag', null)
    }
    const finishDraftRange = (event: globalThis.PointerEvent) => {
      const activeDraftRange = draftRangeRef.current
      if (!activeDraftRange || activeDraftRange.pointerId !== event.pointerId) return
      commitDraftRangeFromPointerRef.current(event.pointerId, event.clientX, event.clientY)
    }
    const cancelDraftRange = (event: globalThis.PointerEvent) => {
      const activeDraftRange = draftRangeRef.current
      if (activeDraftRange && activeDraftRange.pointerId === event.pointerId) cancelDraftRangeInteractionRef.current()
      const activeTimelinePointerId = pendingTimelineEventDragRef.current?.pointerId ?? timelineEventDragRef.current?.pointerId
      if (activeTimelinePointerId === event.pointerId) cancelTimelineInteraction()
    }
    const cancelDraftRangeOnBlur = () => {
      if (draftRangeRef.current) cancelDraftRangeInteractionRef.current()
      cancelTimelineInteraction()
    }
    const finishDraftRangeWithoutButtons = (event: globalThis.PointerEvent) => {
      const activeDraftRange = draftRangeRef.current
      if (!activeDraftRange || event.buttons !== 0) return
      commitDraftRangeFromPointerRef.current(activeDraftRange.pointerId, event.clientX, event.clientY)
    }
    const cancelStaleDraftRangeBeforeNextPointer = () => {
      if (draftRangeRef.current) cancelDraftRangeInteractionRef.current()
      cancelTimelineInteraction()
    }
    const cancelDraftRangeBeforeKeyboardInput = () => {
      if (draftRangeRef.current) cancelDraftRangeInteractionRef.current()
      cancelTimelineInteraction()
    }
    const cancelDraftRangeWhenHidden = () => {
      if (!document.hidden) return
      if (draftRangeRef.current) cancelDraftRangeInteractionRef.current()
      cancelTimelineInteraction()
    }
    window.addEventListener('pointerup', finishDraftRange, true)
    window.addEventListener('pointercancel', cancelDraftRange, true)
    window.addEventListener('blur', cancelDraftRangeOnBlur)
    window.addEventListener('pointermove', finishDraftRangeWithoutButtons, true)
    window.addEventListener('pointerdown', cancelStaleDraftRangeBeforeNextPointer, true)
    window.addEventListener('keydown', cancelDraftRangeBeforeKeyboardInput, true)
    document.addEventListener('visibilitychange', cancelDraftRangeWhenHidden)
    return () => {
      window.removeEventListener('pointerup', finishDraftRange, true)
      window.removeEventListener('pointercancel', cancelDraftRange, true)
      window.removeEventListener('blur', cancelDraftRangeOnBlur)
      window.removeEventListener('pointermove', finishDraftRangeWithoutButtons, true)
      window.removeEventListener('pointerdown', cancelStaleDraftRangeBeforeNextPointer, true)
      window.removeEventListener('keydown', cancelDraftRangeBeforeKeyboardInput, true)
      document.removeEventListener('visibilitychange', cancelDraftRangeWhenHidden)
    }
  }, [onStatusHint])
  useEffect(() => () => {
    onStatusHint('sheet-hover', null)
    onStatusHint('sheet-drop', null)
    onStatusHint('sheet-drag', null)
    onStatusHint('overlay-paper-track', null)
  }, [onStatusHint])
  useEffect(() => {
    const clearDropStatus = () => {
      onStatusHint('sheet-drop', null)
      dropTargetPreviewRef.current = null
      dropTargetPreviewSignatureRef.current = null
      setDropTargetPreview(null)
    }
    window.addEventListener('dragend', clearDropStatus)
    window.addEventListener('drop', clearDropStatus)
    return () => {
      window.removeEventListener('dragend', clearDropStatus)
      window.removeEventListener('drop', clearDropStatus)
    }
  }, [onStatusHint])
  const hasActiveSheetInteraction = Boolean(draftRange || timelineEventDrag || pendingTimelineEventDrag || soundCueDrag || cameraCueDrag || isPanning)
  const zoom = props.zoom
  const setZoom = props.setZoom
  const sheetViewLayout = getSheetViewLayout(props.template)
  const isContinuousCanvas = sheetViewLayout.surface?.type === 'continuous-canvas'
  const displayFrameStart = logicalSheetDisplayFrameStart(props.project.logicalSheet)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(props.project.logicalSheet)
  const displayFrameEnd = logicalSheetDisplayFrameEnd(props.project.logicalSheet)
  const sheetRenderCutGroup = useSheetRenderCutGroupContext(props.activeCutId, props.projectCuts)
  const sheetRenderModelContext = useSheetRenderModelContext(props.project, props.template, sheetRenderCutGroup)
  const templateTrackNames = sheetRenderModelContext.paperTracks
  const timelineLanes = sheetRenderModelContext.timelineLanes
  const timelineLaneEditorActions = createTimelineLaneEditorActions({
    timelineLanes, editor: timelineLaneEditor, setEditor: setTimelineLaneEditor,
    setHeaderMenu: setTimedRangeLaneHeaderMenu, onAdd: props.onAddTimelineLane, onUpdate: props.onUpdateTimelineLane,
  })
  const sheetPageSize = sheetRenderModelContext.pageSize
  const sheetPageWidth = Math.round(sheetPageSize.widthPx * zoom)
  const sheetPageHeight = Math.round(sheetPageSize.heightPx * zoom)
  const overlayTracks = sheetRenderModelContext.overlayTracks
  const referenceRenderModelContext = useMemo(
    () => props.referenceProject
      ? createSheetRenderModelContext(props.referenceProject, props.template, {
          cutGroup: sheetRenderCutGroup,
        })
      : null,
    [props.referenceProject, props.template, sheetRenderCutGroup],
  )
  const rangeTrackOrder = (role: SheetTimingRole) => paperTrackOrderForRole(props.project, role)
  const rangeFromHits = (anchorHit: SheetHit, focusHit: SheetHit): SheetRangeSelection | null => {
    const usesOverlayTrack = [anchorHit.paperTrack, focusHit.paperTrack].some(paperTrack =>
      overlayPaperTracks(props.project, props.template).some(track => track.paperTrack === paperTrack),
    )
    return rangeSelectionFromHits(props.template, anchorHit, focusHit, usesOverlayTrack ? rangeTrackOrder(sheetRoleForHit(anchorHit)) : templateTrackNames)
  }
  const selectedTimedRangeContainingHit = (hit: SheetHit, role: EditableTimedRangeRole): SheetRangeSelection | null => {
    const range = props.rangeSelection
    if (range?.role !== role || hit.role !== role) return null
    if (hit.frame < range.frameStart || hit.frame > range.frameEnd) return null
    return rangeFromHits(range.anchorHit, hit) ? range : null
  }
  const selectedSoundRangeContainingHit = (hit: SheetHit) => selectedTimedRangeContainingHit(hit, 'sound')
  const selectedCameraRangeContainingHit = (hit: SheetHit) => selectedTimedRangeContainingHit(hit, 'camera')
  const renderCaches = useSheetCanvasRenderCaches({
    project: props.project, template: props.template, sheetPages: props.sheetPages,
    activePageIndex: props.activePageIndex, viewMode: props.sheetView.viewMode, activeOverlayPaperTrack,
    renderContext: sheetRenderModelContext, pageSize: sheetPageSize, paperTracks: templateTrackNames,
    soundCuePreview: soundCueDrag?.preview, cameraCuePreview: cameraCueDrag?.preview,
    referenceProject: props.referenceProject, referenceRenderContext: referenceRenderModelContext,
  })
  const { visiblePages } = renderCaches
  const isCalibratingSheet = props.editMode === 'calibrate'
  const touchNavigation = useSheetTouchNavigation({
    enabled: !isCalibratingSheet,
    rangeSelectionMode: props.touchRangeSelectionMode,
    zoom,
    setZoom,
    viewportRef,
    pageStackRef,
    onTap: tap => runSheetTouchTap(tap, {
      props, pageHitUnderClientPoint, svgForPage, setActivePageIndexIfNeeded, pageAnnotationAnchor,
      paperTrackHeaderHitFromPoint, selectPaperTrackColumn, rangeFromHits,
      beforeTap: () => {
        lastSoundCueActivationRef.current = null; lastCameraCueActivationRef.current = null
        setContextMenu(null); setPaperTrackHeaderMenu(null); setOverlayPaperTrackMenu(null)
        setStackGuideHeaderMenu(null); setTimedRangeLaneHeaderMenu(null); clearHover()
      },
    }),
    onLongPress: tap => {
      const directAction = touchDirectActionForLongPress(tap)
      if (directAction) return directAction
      const pointed = pageHitUnderClientPoint(tap.clientX, tap.clientY)
      const svg = pointed ? svgForPage(pointed.page) : null
      if (!pointed || !svg) return false
      return openContextMenuAt(tap.clientX, tap.clientY, tap.target, pointed.page, svg)
    },
    onInputModalityChange: props.onInputModalityChange,
    onBegin: () => {
      setContextMenu(null)
      setPaperTrackHeaderMenu(null)
      setOverlayPaperTrackMenu(null)
      setStackGuideHeaderMenu(null)
      setStackGuideDropPreview(null)
      clearHover()
      setIsPanning(true)
      props.onStatusHint('sheet-drag', uiText.statusHints.touchPanning)
    },
    onEnd: () => {
      setIsPanning(false)
      props.onStatusHint('sheet-drag', null)
    },
  })
  const commitZoomAtClientPoint = touchNavigation.commitZoomAtClientPoint

  useEffect(() => {
    activePageIndexRef.current = props.activePageIndex
  }, [props.activePageIndex])

  useEffect(() => {
    const previousNames = previousOverlayTrackNamesRef.current
    const currentNames = new Set(overlayTracks.map(track => track.paperTrack))
    const addedTrack = overlayTracks.find(track => !previousNames.has(track.paperTrack))
    if (addedTrack) {
      setActiveOverlayPaperTrack(addedTrack.paperTrack)
    } else if (activeOverlayPaperTrack && !currentNames.has(activeOverlayPaperTrack)) {
      setActiveOverlayPaperTrack(null)
    }
    previousOverlayTrackNamesRef.current = currentNames
  }, [activeOverlayPaperTrack, overlayTracks])

  useEffect(() => () => {
    if (hoverPreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverPreviewFrameRef.current)
    }
  }, [])

  useEffect(() => {
    if (!hasActiveSheetInteraction) return
    document.body.classList.add(SHEET_INTERACTION_ACTIVE_CLASS)
    document.getSelection()?.removeAllRanges()
    return () => {
      document.body.classList.remove(SHEET_INTERACTION_ACTIVE_CLASS)
    }
  }, [hasActiveSheetInteraction])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const wheelViewport = viewport

    function handleViewportWheel(event: globalThis.WheelEvent) {
      if (!props.zoomMode && !event.ctrlKey && !event.metaKey) {
        handleNativeHorizontalWheelScroll(event, wheelViewport)
        return
      }
      const rawVerticalDelta = nativeVerticalWheelDelta(event)
      if (rawVerticalDelta === 0) return
      event.preventDefault()

      const factor = rawVerticalDelta < 0 ? SHEET_ZOOM_WHEEL_FACTOR : 1 / SHEET_ZOOM_WHEEL_FACTOR
      const nextZoom = clampSheetZoom(zoom * factor)

      commitZoomAtClientPoint(nextZoom, event.clientX, event.clientY)
    }

    viewport.addEventListener('wheel', handleViewportWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleViewportWheel)
  }, [commitZoomAtClientPoint, props.zoomMode, zoom])

  useLayoutEffect(() => {
    const request = props.scrollRequest
    if (!request || handledScrollRequestIdRef.current === request.requestId) return undefined
    const frameId = window.requestAnimationFrame(() => {
      const viewport = viewportRef.current
      if (!viewport) return
      const page = visiblePages.find(item => item.pageId === request.hit.pageId)
      if (!page) return
      const svg = svgForPage(page)
      if (!svg) return
      scrollSheetHitIntoView(viewport, svg, props.project, props.template, request.hit)
      handledScrollRequestIdRef.current = request.requestId
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [props.project, props.scrollRequest, props.template, visiblePages, zoom])

  useEffect(() => {
    function setSpaceReady(nextReady: boolean) {
      spacePanReadyRef.current = nextReady
      setSpacePanReady(nextReady)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== 'Space' || isInteractiveKeyboardTarget(event.target)) return
      event.preventDefault()
      setSpaceReady(true)
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.code === 'Space') setSpaceReady(false)
    }

    function handleBlur() {
      setSpaceReady(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  useEffect(() => {
    if (!contextMenu && !paperTrackHeaderMenu && !overlayPaperTrackMenu && !stackGuideHeaderMenu && !timedRangeLaneHeaderMenu) return
    const close = (event?: globalThis.PointerEvent) => {
      const target = event?.target
      if (target instanceof Element && target.closest('.sheetContextMenu')) return
      setContextMenu(null)
      setPaperTrackHeaderMenu(null)
      setOverlayPaperTrackMenu(null)
      setStackGuideHeaderMenu(null)
      setTimedRangeLaneHeaderMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [contextMenu, paperTrackHeaderMenu, overlayPaperTrackMenu, stackGuideHeaderMenu, timedRangeLaneHeaderMenu])

  useEffect(() => () => {
    if (timelineEventLongPressTimerRef.current !== null) {
      window.clearTimeout(timelineEventLongPressTimerRef.current)
      timelineEventLongPressTimerRef.current = null
    }
  }, [])

  function pointFromClient(svg: SVGSVGElement, clientX: number, clientY: number) {
    const box = svg.getBoundingClientRect()
    return {
      x: (clientX - box.left) / box.width,
      y: (clientY - box.top) / box.height,
    }
  }

  function pointFromEvent(event: PointerEvent<SVGSVGElement> | DragEvent<SVGSVGElement> | MouseEvent<SVGSVGElement>) {
    return pointFromClient(event.currentTarget, event.clientX, event.clientY)
  }

  function closeContextMenus() {
    setContextMenu(null); setPaperTrackHeaderMenu(null); setOverlayPaperTrackMenu(null)
    setStackGuideHeaderMenu(null); setTimedRangeLaneHeaderMenu(null)
  }

  function setActivePageIndexIfNeeded(pageIndex: number) {
    if (activePageIndexRef.current === pageIndex) return
    activePageIndexRef.current = pageIndex
    props.setActivePageIndex(pageIndex)
  }

  function svgForPage(page: SheetPage): SVGSVGElement | null {
    return sheetSvgRefs.current[page.pageId] ?? null
  }

  function pageHitFromClientPoint(clientX: number, clientY: number): { page: SheetPage; hit: SheetHit | null } | null {
    let fallback: { page: SheetPage; hit: SheetHit | null } | null = null
    for (const page of visiblePages) {
      const svg = svgForPage(page)
      if (!svg) continue
      const box = svg.getBoundingClientRect()
      const point = {
        x: (clientX - box.left) / box.width,
        y: (clientY - box.top) / box.height,
      }
      const clampedPoint = { x: clampNumber(point.x, 0, 1), y: clampNumber(point.y, 0, 1) }
      fallback ??= { page, hit: hitFromPoint(clampedPoint, page) }
      if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) continue
      return { page, hit: hitFromPoint(point, page) }
    }
    return fallback
  }

  function pageHitUnderClientPoint(clientX: number, clientY: number): { page: SheetPage; hit: SheetHit | null } | null {
    for (const page of visiblePages) {
      const svg = svgForPage(page)
      if (!svg) continue
      const box = svg.getBoundingClientRect()
      if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) continue
      const point = {
        x: (clientX - box.left) / box.width,
        y: (clientY - box.top) / box.height,
      }
      return { page, hit: hitFromPoint(point, page) }
    }
    return null
  }

  function dropTargetFromClientPoint(clientX: number, clientY: number): { page: SheetPage; hit: SheetHit | null } | null {
    const target = pageHitFromClientPoint(clientX, clientY)
    if (!target || target.hit?.paperTrack) return target
    if (hoveredHitSignatureRef.current && hoveredHit?.paperTrack && hoveredHit.pageId === target.page.pageId) {
      return { page: target.page, hit: hoveredHit }
    }
    return target
  }

  function dropHitForActiveRange(hit: SheetHit | null): SheetHit | null {
    if (!rangeContainsHit(props.rangeSelection, hit)) return hit
    return rangeStartHit(props.rangeSelection) ?? hit
  }

  useEffect(() => subscribeInternalDrag(detail => {
    const { payload, clientX, clientY, phase } = detail
    if (phase === 'cancel') {
      clearHover()
      clearDropTargetPreview()
      setStackGuideDropPreview(null)
      setInternalDragDropValidity(null)
      props.onStatusHint('sheet-drop', null)
      return
    }
    const draggedStackGuideLabelId = payload.kind === 'stack-guide' ? payload.labelId : payload.kind === 'csp-pane-node' ? payload.stackGuideLabelId : undefined
    if (draggedStackGuideLabelId) {
      clearDropTargetPreview()
      if (phase === 'start' || phase === 'move') updateStackGuideDropPreview(draggedStackGuideLabelId, clientX, clientY, payload.kind === 'csp-pane-node')
      if (phase === 'drop') { moveStackGuideLabelFromPoint(draggedStackGuideLabelId, clientX, clientY, payload.kind === 'csp-pane-node'); setInternalDragDropValidity(null) }
      return
    }
    if (payload.kind === 'stack-guide' || payload.kind === 'csp-pane-node') return
    const pointedElement = document.elementFromPoint?.(clientX, clientY)
    const stackGuideElement = pointedElement?.closest<HTMLElement>('.stackGuideLabelDragHandle[data-stack-guide-label-id], .stackGuideSvgLabel[data-stack-guide-label-id]')
    if (stackGuideElement && payload.kind === 'asset') {
      const valid = payload.assetIds.length === 1
      setInternalDragDropValidity(valid ? 'valid' : 'invalid')
      props.onStatusHint('sheet-drop', valid ? uiText.statusHints.dropStackGuide : uiText.statusHints.dropMultipleAssetsUnavailable)
      if (phase === 'drop' && payload.assetIds.length === 1) {
        props.onAssignAssetToStackGuideLabel(stackGuideElement.dataset.stackGuideLabelId!, payload.assetIds[0]!)
      }
      clearHover()
      clearDropTargetPreview()
      if (phase === 'drop') {
        setInternalDragDropValidity(null)
        props.onStatusHint('sheet-drop', null)
      }
      return
    }

    const target = pageHitUnderClientPoint(clientX, clientY)
    const hit = dropHitForActiveRange(target?.hit ?? null)
    if (phase === 'start' || phase === 'move') {
      clearHover()
      if (target && hit?.paperTrack) {
        props.setActivePageIndex(target.page.pageIndex)
        const valid = payload.kind === 'registered-cell' || payload.assetIds.length === 1
        updateDropTargetPreview(hit, valid ? 'valid' : 'invalid')
        setInternalDragDropValidity(valid ? 'valid' : 'invalid')
        const targetLabel = sheetHitTargetLabel(props.project, hit)
        props.onStatusHint('sheet-drop', valid
          ? payload.kind === 'registered-cell'
            ? uiText.statusHints.dropRegisteredCell(targetLabel)
            : uiText.statusHints.dropAsset(targetLabel)
          : uiText.statusHints.dropMultipleAssetsUnavailable)
      } else {
        clearDropTargetPreview()
        setInternalDragDropValidity(target ? 'invalid' : null)
        props.onStatusHint('sheet-drop', target ? uiText.statusHints.dropUnavailable : null)
      }
      return
    }
    if (phase !== 'drop' || !target || !hit?.paperTrack) {
      clearHover()
      clearDropTargetPreview()
      setInternalDragDropValidity(null)
      props.onStatusHint('sheet-drop', null)
      return
    }
    props.setActivePageIndex(target.page.pageIndex)
    clearHover()
    clearDropTargetPreview()
    setInternalDragDropValidity(null)
    props.onStatusHint('sheet-drop', null)
    if (payload.kind === 'asset') {
      props.onDropDiagnostic({
        source: 'asset-pointer',
        type: 'drop',
        target: hit ? `${sheetRoleLabel(sheetRoleForHit(hit))} ${hit.paperTrack ?? '-'}` : 'sheet/no-hit',
        fileCount: payload.assetIds.length,
        position: { x: clientX, y: clientY },
        details: `assetIds ${payload.assetIds.join(', ')}`,
      })
      if (hit && payload.assetIds.length === 1) props.onAssetAssign(payload.assetIds[0]!, hit, { x: clientX, y: clientY })
    } else {
      props.onRegisteredCellAssign(payload.keyId, hit)
    }
  }))

  function rangeStartHit(range: SheetRangeSelection | null): SheetHit | null {
    if (!isPointEventRangeForUi(range)) return null
    if (range.anchorHit.frame === range.frameStart && range.anchorHit.paperTrack) return range.anchorHit
    if (range.focusHit.frame === range.frameStart && range.focusHit.paperTrack) return range.focusHit
    const tracks = rangePaperTracks(range)
    const paperTrack = tracks[0] ?? range.paperTrack
    return paperTrack
      ? timingHitForFrame(props.template, range.role, paperTrack, range.frameStart, displayDurationFrames, displayFrameStart, rangeTrackOrder(range.role))
      : null
  }

  function lockedRangeHitFromClientPoint(clientX: number, clientY: number, anchorHit: SheetHit): { page: SheetPage; hit: SheetHit | null } | null {
    for (const page of visiblePages) {
      const svg = svgForPage(page)
      if (!svg) continue
      const box = svg.getBoundingClientRect()
      if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) continue
      const point = {
        x: (clientX - box.left) / box.width,
        y: (clientY - box.top) / box.height,
      }
      const directHit = rangeHitFromPoint(point, page)
      if (directHit && rangeFromHits(anchorHit, directHit)) {
        return { page, hit: directHit }
      }
      return { page, hit: lockedRangeHitFromPoint(point, page, anchorHit) }
    }
    return null
  }

  function lockedRangeHitFromPoint(point: NormalizedPoint, page: SheetPage, anchorHit: SheetHit): SheetHit | null {
    const anchorRegion = props.template.regions.find(region => region.regionId === anchorHit.regionId)
    if (!anchorRegion?.grid) return null
    const flowGroupId = anchorRegion.flowGroupId ?? anchorRegion.regionId

    for (const region of props.template.regions) {
      if (!isInteractiveSheetTemplateGridRegion(region)) continue
      if (region.grid.role !== anchorHit.role) continue
      if ((region.flowGroupId ?? region.regionId) !== flowGroupId) continue
      const layout = resolveSheetTemplateGridLayout(props.template, region, {
        paperTracks: templateTrackNames,
        timelineLanes,
        durationFrames: displayDurationFrames,
        frameOrigin: frameOriginForPageHit(props.template, page),
        layoutOverrides: props.project.sheetView.layoutOverrides,
      })
      if (!layout) continue
      const rect = layout.rect
      if (point.x < rect.x || point.x > rect.x + rect.w) continue
      if (point.y < rect.y || point.y > rect.y + rect.h) continue

      const columns = layout.columns
      const columnIndex = anchorHit.paperTrack
        ? columns.findIndex(column => column.paperTrack === anchorHit.paperTrack)
        : columns.findIndex(column => column.columnId === anchorHit.columnId)
      const column = columnIndex >= 0 ? columns[columnIndex] : null
      if (!column) continue

      const frames = layout.frames
      const localY = (point.y - rect.y) / frames.rowHeight
      const rowIndex = clampNumber(Math.floor(localY), 0, frames.rowCount - 1)
      const hit = materializePageHit(props.template, {
        regionId: region.regionId,
        role: region.grid.role,
        frame: frames.frameStart + rowIndex,
        rowIndex,
        columnIndex,
        columnId: column.columnId,
        label: column.label,
        paperTrack: column.paperTrack,
      }, page)
      if (hit.frame <= page.frameEnd && rangeFromHits(anchorHit, hit)) return hit
    }
    return null
  }

  function hasSheetDropPayload(dataTransfer: DataTransfer) {
    const types = Array.from(dataTransfer.types ?? [])
    return types.length === 0
      || types.includes(ASSET_DRAG_MIME)
      || types.includes(ASSET_MULTI_DRAG_MIME)
      || types.includes(REGISTERED_CELL_DRAG_MIME)
      || types.includes(STACK_GUIDE_DRAG_MIME)
      || Boolean(dataTransfer.getData(STACK_GUIDE_DRAG_MIME))
      || types.includes('text/plain')
      || types.includes('Files')
  }

  function dragDataTypes(dataTransfer: DataTransfer): string[] {
    return Array.from(dataTransfer.types ?? [])
  }

  function canReadDragDataType(types: string[], type: string): boolean {
    return types.length === 0 || types.includes(type)
  }

  function hasExternalFileDragPayload(dataTransfer: DataTransfer, types = dragDataTypes(dataTransfer)): boolean {
    return hasFileTransferPayload(dataTransfer)
      || types.includes('Files')
      || types.includes('text/uri-list')
      || types.includes('application/x-moz-file')
  }

  function keyIdFromDragData(dataTransfer: DataTransfer): string {
    const types = dragDataTypes(dataTransfer)
    if (hasExternalFileDragPayload(dataTransfer, types)) return ''
    const explicitKeyId = canReadDragDataType(types, REGISTERED_CELL_DRAG_MIME)
      ? dataTransfer.getData(REGISTERED_CELL_DRAG_MIME)
      : ''
    if (explicitKeyId) return explicitKeyId
    return canReadDragDataType(types, 'text/plain')
      ? keyIdFromRegisteredCellTextDragData(dataTransfer.getData('text/plain'))
      : ''
  }

  function stackGuideLabelIdFromDragData(dataTransfer: DataTransfer): string {
    return dataTransfer.getData(STACK_GUIDE_DRAG_MIME)
  }

  function hasStackGuideDragPayload(dataTransfer: DataTransfer): boolean {
    const types = dragDataTypes(dataTransfer)
    return types.includes(STACK_GUIDE_DRAG_MIME)
      || (types.length === 0 && Boolean(dataTransfer.getData(STACK_GUIDE_DRAG_MIME)))
  }

  function setDropStatusForHit(dataTransfer: DataTransfer, hit: SheetHit | null, assetIds = assetIdsFromDragData(dataTransfer)) {
    if (!hit?.paperTrack) {
      props.onStatusHint('sheet-drop', uiText.statusHints.dropUnavailable)
      return
    }
    if (assetIds.length > 1) {
      props.onStatusHint('sheet-drop', uiText.statusHints.dropMultipleAssetsUnavailable)
      return
    }
    const target = sheetHitTargetLabel(props.project, hit)
    if (keyIdFromDragData(dataTransfer)) {
      props.onStatusHint('sheet-drop', uiText.statusHints.dropRegisteredCell(target))
    } else if (assetIds.length === 1) {
      props.onStatusHint('sheet-drop', uiText.statusHints.dropAsset(target))
    } else {
      props.onStatusHint('sheet-drop', uiText.statusHints.dropFiles(target))
    }
  }

  function assetIdsFromDragData(dataTransfer: DataTransfer): string[] {
    const types = dragDataTypes(dataTransfer)
    if (hasExternalFileDragPayload(dataTransfer, types)) return []
    if (keyIdFromDragData(dataTransfer)) return []
    const multiAssetIds = canReadDragDataType(types, ASSET_MULTI_DRAG_MIME)
      ? parseAssetIdsFromDragData(dataTransfer.getData(ASSET_MULTI_DRAG_MIME))
      : []
    if (multiAssetIds.length > 0) return multiAssetIds
    const explicitAssetId = canReadDragDataType(types, ASSET_DRAG_MIME)
      ? dataTransfer.getData(ASSET_DRAG_MIME)
      : ''
    if (explicitAssetId) return [explicitAssetId]
    const textAssetId = canReadDragDataType(types, 'text/plain')
      ? assetIdFromAssetTextDragData(dataTransfer.getData('text/plain'))
      : ''
    if (textAssetId) return [textAssetId]
    return []
  }

  function hitFromPoint(point: NormalizedPoint, page: SheetPage): SheetHit | null {
    const frameOrigin = frameOriginForPageHit(props.template, page)
    const hitOptions = { paperTracks: templateTrackNames, timelineLanes, durationFrames: page.frameEnd - page.frameStart + 1, frameOrigin, layoutOverrides: props.project.sheetView.layoutOverrides }
    const localHit = overlayHitFromPoint(props.template, props.project, page, point, activeOverlayPaperTrack)
      ?? hitTestSheetTemplate(props.template, point, { ...hitOptions, role: 'cell' })
      ?? hitTestSheetTemplate(props.template, point, { ...hitOptions, role: 'action' })
    if (!localHit?.paperTrack) return null
    const hit = materializePageHit(props.template, localHit, page)
    return hit.frame <= page.frameEnd ? hit : null
  }

  function rangeHitFromPoint(point: NormalizedPoint, page: SheetPage): SheetHit | null {
    const frameOrigin = frameOriginForPageHit(props.template, page)
    const hitOptions = { paperTracks: templateTrackNames, timelineLanes, durationFrames: page.frameEnd - page.frameStart + 1, frameOrigin, layoutOverrides: props.project.sheetView.layoutOverrides }
    const localHit = overlayHitFromPoint(props.template, props.project, page, point, activeOverlayPaperTrack)
      ?? hitTestSheetTemplate(props.template, point, { ...hitOptions, role: 'cell' })
      ?? hitTestSheetTemplate(props.template, point, { ...hitOptions, role: 'action' })
      ?? hitTestSheetTemplate(props.template, point, { ...hitOptions, role: 'sound' })
      ?? hitTestSheetTemplate(props.template, point, { ...hitOptions, role: 'camera' })
    if (!localHit) return null
    const hit = materializePageHit(props.template, localHit, page)
    return hit.frame <= page.frameEnd ? hit : null
  }

  function paperTrackHeaderHitFromPoint(point: NormalizedPoint, page: SheetPage, viewportHeightPx?: number): SheetHit | null {
    const result = gridColumnHeaderHitFromPoint({
      template: props.template, point, roles: ['action', 'cell'], paperTracks: templateTrackNames,
      timelineLanes, durationFrames: displayDurationFrames, frameOrigin: frameOriginForPageHit(props.template, page),
      layoutOverrides: props.project.sheetView.layoutOverrides, viewportHeightPx,
    })
    return result?.hit.paperTrack ? materializePageHit(props.template, result.hit, page) : null
  }

  function timedRangeLaneHeaderHitFromPoint(
    point: NormalizedPoint,
    page: SheetPage,
    viewportHeightPx?: number,
  ): Pick<TimedRangeLaneHeaderMenuState, 'role' | 'laneId' | 'label'> | null {
    const result = gridColumnHeaderHitFromPoint({
      template: props.template, point, roles: ['sound', 'camera'], paperTracks: templateTrackNames,
      timelineLanes, durationFrames: displayDurationFrames, frameOrigin: frameOriginForPageHit(props.template, page),
      layoutOverrides: props.project.sheetView.layoutOverrides, viewportHeightPx,
    })
    if (!result?.timelineLaneId || (result.hit.role !== 'sound' && result.hit.role !== 'camera')) return null
    return { role: result.hit.role, laneId: result.timelineLaneId, label: result.hit.label }
  }

  function stackGuideHeaderInsertTargetFromPoint(point: NormalizedPoint, page: SheetPage): StackGuideInsertTarget | null {
    return stackGuideInsertTargetFromPoint(props.template, props.project, page, point)
  }

  function stackGuideDropTargetFromClientPoint(clientX: number, clientY: number, requireInsidePage = false): StackGuideDropPreviewState | null {
    let fallback: StackGuideDropPreviewState | null = null
    for (const page of visiblePages) {
      const svg = svgForPage(page)
      if (!svg) continue
      const box = svg.getBoundingClientRect()
      const target = stackGuidePlacementTargetFromPointer(svg, clientX, clientY, props.project, props.template, page)
      if (!target) continue
      const preview: StackGuideDropPreviewState = {
        pageId: target.pageId,
        regionId: target.regionId,
        gapIndex: target.gapIndex,
        insertAfterPaperTrack: target.insertAfterPaperTrack,
        displayRole: target.displayRole,
        snapIndex: target.snapIndex,
      }
      fallback ??= preview
      if (clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom) {
        return preview
      }
    }
    return requireInsidePage ? null : fallback
  }

  function updateStackGuideDropPreview(labelId: string | undefined, clientX: number, clientY: number, requireInsidePage = false) {
    const target = stackGuideDropTargetFromClientPoint(clientX, clientY, requireInsidePage)
    setStackGuideDropPreview(target ? { ...target, labelId } : null)
    if (target) setActivePageIndexIfNeeded(visiblePages.find(page => page.pageId === target.pageId)?.pageIndex ?? props.activePageIndex)
    return target
  }

  function moveStackGuideLabelFromPoint(labelId: string, clientX: number, clientY: number, requireInsidePage = false): boolean {
    if (!labelId) return false
    const label = props.project.stackGuideLabels.find(item => item.labelId === labelId)
    if (!label) return true
    const target = stackGuideDropTargetFromClientPoint(clientX, clientY, requireInsidePage)
    if (!target) return true
    const page = visiblePages.find(item => item.pageId === target.pageId)
    if (!page) return true
    const update = stackGuidePlacementUpdateFromPointer(svgForPage(page), clientX, clientY, props.project, props.template, page, label)
    if (update) {
      props.onUpdateStackGuideLabel(label.labelId, update)
    }
    setStackGuideDropPreview(null)
    return true
  }

  function moveStackGuideLabelFromDragData(dataTransfer: DataTransfer, clientX: number, clientY: number): boolean {
    return moveStackGuideLabelFromPoint(stackGuideLabelIdFromDragData(dataTransfer), clientX, clientY)
  }

  function updateHover(hit: SheetHit | null, anchor?: { x: number; y: number }) {
    const signature = hoverHitSignature(hit)
    if (hoveredHitSignatureRef.current !== signature) {
      hoveredHitSignatureRef.current = signature
      const hasPreview = Boolean(hit && cellAssetPreviewItemsForHit(props.project, hit).length > 0)
      hoveredHitHasPreviewRef.current = hasPreview
      setHoveredHit(hit)
      props.onStatusHint('sheet-hover', hit ? sheetHitStatusHint(props.project, hit) : null)
    }
    scheduleHoverPreviewAnchor(hoveredHitHasPreviewRef.current, anchor)
  }

  function scheduleHoverPreviewAnchor(hasPreview: boolean, anchor?: { x: number; y: number }) {
    if (!hasPreview || !anchor) {
      pendingHoverPreviewAnchorRef.current = null
      if (hoverPreviewFrameRef.current !== null) {
        window.cancelAnimationFrame(hoverPreviewFrameRef.current)
        hoverPreviewFrameRef.current = null
      }
      setHoverPreviewAnchor(null)
      return
    }

    pendingHoverPreviewAnchorRef.current = anchor
    if (hoverPreviewFrameRef.current !== null) return
    hoverPreviewFrameRef.current = window.requestAnimationFrame(() => {
      hoverPreviewFrameRef.current = null
      setHoverPreviewAnchor(pendingHoverPreviewAnchorRef.current)
    })
  }

  function hoverHitSignature(hit: SheetHit | null): string | null {
    if (!hit) return null
    return [
      hit.pageId,
      hit.regionId,
      hit.role,
      hit.frame,
      hit.paperTrack ?? '',
      hit.columnId ?? '',
    ].join('|')
  }

  function clearHover() {
    updateHover(null)
    setTextCursorBadge(null)
  }

  function updateDropTargetPreview(hit: SheetHit | null, validity: SheetDropTargetPreview['validity']) {
    const next = hit?.paperTrack ? { hit, validity } : null
    const signature = next ? `${hoverHitSignature(next.hit)}|${next.validity}` : null
    if (dropTargetPreviewSignatureRef.current === signature) return
    dropTargetPreviewSignatureRef.current = signature
    dropTargetPreviewRef.current = next
    setDropTargetPreview(next)
  }

  function clearDropTargetPreview() {
    updateDropTargetPreview(null, 'valid')
  }

  function clearTimelineEventLongPressTimer() {
    if (timelineEventLongPressTimerRef.current === null) return
    window.clearTimeout(timelineEventLongPressTimerRef.current)
    timelineEventLongPressTimerRef.current = null
  }

  function clearPendingTimelineEventDrag() {
    clearTimelineEventLongPressTimer()
    setPendingTimelineEventDrag(null)
  }

  function selectPaperTrackColumn(hit: SheetHit) {
    if (!hit.paperTrack || (hit.role !== 'action' && hit.role !== 'cell')) return
    const startHit = timingHitForFrame(props.template, hit.role, hit.paperTrack, displayFrameStart, displayDurationFrames, displayFrameStart, templateTrackNames)
    const endHit = timingHitForFrame(props.template, hit.role, hit.paperTrack, displayFrameEnd, displayDurationFrames, displayFrameStart, templateTrackNames)
    const range = startHit && endHit ? rangeFromHits(startHit, endHit) : null
    if (range) {
      props.onRangeSelect(range)
    } else {
      props.onCellClick(hit)
    }
  }

  function timelineMoveTargetFromClientPoint(clientX: number, clientY: number, sourceHit: SheetHit): { page: SheetPage; hit: SheetHit | null } | null {
    const target = dropTargetFromClientPoint(clientX, clientY)
    if (target) setActivePageIndexIfNeeded(target.page.pageIndex)
    const targetHit = target?.hit?.paperTrack && sheetRoleForHit(target.hit) === sheetRoleForHit(sourceHit)
      ? target.hit
      : null
    return target ? { page: target.page, hit: targetHit } : null
  }

  function beginTimelineEventDrag(pointerId: number, sourceHit: SheetHit, startX: number, startY: number, sourceRange?: SheetRangeSelection) {
    clearPendingTimelineEventDrag()
    clearHover()
    setContextMenu(null)
    setPaperTrackHeaderMenu(null)
    setOverlayPaperTrackMenu(null)
    setStackGuideHeaderMenu(null)
    setTimelineEventDrag({
      pointerId,
      sourceHit,
      sourceRange,
      currentHit: sourceHit,
      startX,
      startY,
      moved: false,
    })
    props.onStatusHint('sheet-drag', uiText.statusHints.eventDragging)
  }

  function updateTimelineEventDragFromClient(pointerId: number, clientX: number, clientY: number, viewport: HTMLElement | null) {
    const currentTimelineEventDrag = timelineEventDragRef.current
    if (!currentTimelineEventDrag || currentTimelineEventDrag.pointerId !== pointerId) return false
    autoScrollViewportForDrag({ clientX, clientY }, viewport)
    const target = timelineMoveTargetFromClientPoint(clientX, clientY, currentTimelineEventDrag.sourceHit)
    const targetHit = target?.hit ?? null
    updateHover(targetHit, targetHit ? { x: clientX, y: clientY } : undefined)
    const movedByPointer = Math.abs(clientX - currentTimelineEventDrag.startX) >= 3 || Math.abs(clientY - currentTimelineEventDrag.startY) >= 3
    setTimelineEventDrag(current => current && current.pointerId === pointerId
      ? {
          ...current,
          currentHit: targetHit,
          moved: current.moved || movedByPointer || Boolean(targetHit && !sameSheetHitCell(targetHit, current.sourceHit)),
        }
      : current)
    return true
  }

  function finishTimelineEventPointerById(pointerId: number, cancelled = false, clientX?: number, clientY?: number) {
    const current = timelineEventDragRef.current
    if (!current || current.pointerId !== pointerId) return
    setTimelineEventDrag(null)
    clearPendingTimelineEventDrag()
    releasePointerCaptureForElements(pointerId, Object.values(sheetSvgRefs.current))
    props.onStatusHint('sheet-drag', null)
    clearHover()
    if (cancelled) return
    const target = typeof clientX === 'number' && typeof clientY === 'number'
      ? dropTargetFromClientPoint(clientX, clientY)
      : null
    const releaseHit = target?.hit?.paperTrack && sheetRoleForHit(target.hit) === sheetRoleForHit(current.sourceHit)
      ? target.hit
      : current.currentHit
    if ((current.moved || Boolean(releaseHit && !sameSheetHitCell(releaseHit, current.sourceHit))) && releaseHit?.paperTrack) {
      props.onMoveTimelineEvent(current.sourceHit, releaseHit, current.sourceRange)
    }
  }

  updateTimelineEventPointerRef.current = (pointerId, clientX, clientY) => {
    updateTimelineEventDragFromClient(pointerId, clientX, clientY, viewportRef.current)
  }
  finishTimelineEventPointerRef.current = finishTimelineEventPointerById

  function updateDraftRangeFromClientPoint(pointerId: number, clientX: number, clientY: number, fallbackPage?: SheetPage) {
    const currentDraftRange = draftRangeRef.current
    if (!currentDraftRange || currentDraftRange.pointerId !== pointerId) return false
    const target = lockedRangeHitFromClientPoint(clientX, clientY, currentDraftRange.anchor)
    if (target) setActivePageIndexIfNeeded(target.page.pageIndex)
    let hit = target?.hit ?? null
    if (!hit && fallbackPage) {
      const svg = svgForPage(fallbackPage)
      if (svg) {
        const box = svg.getBoundingClientRect()
        hit = rangeHitFromPoint({
          x: (clientX - box.left) / box.width,
          y: (clientY - box.top) / box.height,
        }, fallbackPage)
      }
    }
    const range = hit ? rangeFromHits(currentDraftRange.anchor, hit) : null
    if (hit && range) {
      const focusHit = hit
      const moved = currentDraftRange.moved
        || focusHit.frame !== currentDraftRange.anchor.frame
        || focusHit.paperTrack !== currentDraftRange.anchor.paperTrack
        || focusHit.role !== currentDraftRange.anchor.role
      setDraftRange(current => current
        ? {
            ...current,
            focus: focusHit,
            moved,
          }
        : current)
      if (moved) props.onRangeSelect(range)
    }
    return true
  }

  function beginDraftRangeFromTimelineEvent(pointerId: number, sourceHit: SheetHit, clientX: number, clientY: number) {
    const target = lockedRangeHitFromClientPoint(clientX, clientY, sourceHit)
    if (target) setActivePageIndexIfNeeded(target.page.pageIndex)
    const focusHit = target?.hit && rangeFromHits(sourceHit, target.hit)
      ? target.hit
      : sourceHit
    setDraftRange({
      pointerId,
      anchor: sourceHit,
      focus: focusHit,
      moved: !sameSheetHitCell(sourceHit, focusHit),
    })
    const range = rangeFromHits(sourceHit, focusHit)
    if (range && !sameSheetHitCell(sourceHit, focusHit)) props.onRangeSelect(range)
    props.onStatusHint('sheet-drag', uiText.statusHints.rangeDragging)
    clearPendingTimelineEventDrag()
  }

  function commitDraftRangeFromPointer(pointerId: number, clientX: number, clientY: number) {
    const currentDraftRange = draftRangeRef.current
    if (!currentDraftRange || currentDraftRange.pointerId !== pointerId) return false
    const target = lockedRangeHitFromClientPoint(clientX, clientY, currentDraftRange.anchor)
    const focusHit = target?.hit && rangeFromHits(currentDraftRange.anchor, target.hit)
      ? target.hit
      : currentDraftRange.focus
    const range = rangeFromHits(currentDraftRange.anchor, focusHit)
    const moved = currentDraftRange.moved
      || focusHit.frame !== currentDraftRange.anchor.frame
      || focusHit.paperTrack !== currentDraftRange.anchor.paperTrack
      || focusHit.role !== currentDraftRange.anchor.role
    if (range && moved) {
      props.onRangeSelect(range)
    }
    releaseDraftRangePointerCapture(currentDraftRange)
    setDraftRange(null)
    props.onStatusHint('sheet-drag', null)
    return true
  }

  function timedRangeHitFromClientPoint(clientX: number, clientY: number, role: EditableTimedRangeRole): {
    page: SheetPage
    hit: SheetHit
    laneId: string
    point: NormalizedPoint
    regionRect: { x: number; y: number; w: number; h: number }
    rowHeight: number
  } | null {
    for (const page of visiblePages) {
      const svg = svgForPage(page)
      if (!svg) continue
      const box = svg.getBoundingClientRect()
      if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) continue
      const point = { x: (clientX - box.left) / box.width, y: (clientY - box.top) / box.height }
      const localHit = hitTestSheetTemplate(props.template, point, {
        paperTracks: templateTrackNames,
        durationFrames: page.frameEnd - page.frameStart + 1,
        frameOrigin: frameOriginForPageHit(props.template, page),
        layoutOverrides: props.project.sheetView.layoutOverrides,
        role,
      })
      if (!localHit) return null
      const hit = materializePageHit(props.template, localHit, page)
      const laneId = timedRangeLaneIdForHit(props.template, role, hit)
      if (!laneId || hit.frame > page.frameEnd) return null
      const region = props.template.regions.find(item => item.regionId === hit.regionId)
      const layout = region ? resolveSheetTemplateGridLayout(props.template, region, {
        paperTracks: templateTrackNames,
        timelineLanes,
        durationFrames: page.frameEnd - page.frameStart + 1,
        frameOrigin: frameOriginForPageHit(props.template, page),
        layoutOverrides: props.project.sheetView.layoutOverrides,
      }) : null
      if (!layout) return null
      return { page, hit, laneId, point, regionRect: layout.rect, rowHeight: layout.frames.rowHeight }
    }
    return null
  }

  const soundHitFromClientPoint = (clientX: number, clientY: number) => timedRangeHitFromClientPoint(clientX, clientY, 'sound')
  const cameraHitFromClientPoint = (clientX: number, clientY: number) => timedRangeHitFromClientPoint(clientX, clientY, 'camera')

  function pageAnnotationAnchor(page: SheetPage) {
    const regionTarget = props.pageAnnotationTarget.kind === 'template-region' && props.pageAnnotationTarget.pageId === page.pageId
      ? props.pageAnnotationTarget
      : undefined
    return {
      kind: 'view-surface' as const,
      templateId: props.template.templateId,
      pageId: page.pageId,
      surfaceSize: sheetPageSize,
      regionId: regionTarget?.regionId,
      targetId: regionTarget?.targetId,
      logicalTargetId: regionTarget?.logicalTargetId,
    }
  }

  function handleSoundCuePointerDown(event: PointerEvent<SVGElement>, cue: TimedRangeCue, mode: SoundCueDragMode) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (event.pointerType === 'touch' && props.touchRangeSelectionMode) return
    if (props.editMode === 'pen' || props.editMode === 'eraser' || props.editMode === 'text' || props.editMode === 'calibrate') return
    if (event.pointerType !== 'mouse') event.preventDefault()
    event.stopPropagation()
    beginSoundCuePointer(event.pointerId, event.clientX, event.clientY, cue, mode)
  }

  function beginSoundCuePointer(pointerId: number, clientX: number, clientY: number, cue: TimedRangeCue, mode: SoundCueDragMode) {
    clearHover()
    soundCuePointerUpdates.cancel()
    setHoveredSoundCueId(null)
    setSoundCueHoverAnchor(null)
    props.onSoundCueSelect(cue.cueId)
    const pointed = soundHitFromClientPoint(clientX, clientY)
    const nextDrag = createSoundCuePointerDrag({ pointerId, clientX, clientY, cue, mode, pointedFrame: pointed?.hit.frame })
    soundCueDragRef.current = nextDrag
    setSoundCueDrag(nextDrag)
    props.onStatusHint('sheet-drag', mode === 'move' ? 'SOUND区間を移動中' : 'SOUND区間の長さを変更中')
  }

  function updateSoundCuePointer(pointerId: number, clientX: number, clientY: number) {
    const currentDrag = soundCueDragRef.current
    if (!currentDrag || currentDrag.pointerId !== pointerId) return
    autoScrollViewportForDrag({ clientX, clientY }, viewportRef.current)
    const pointed = soundHitFromClientPoint(clientX, clientY)
    if (!pointed) return
    setActivePageIndexIfNeeded(pointed.page.pageIndex)
    const moved = currentDrag.moved
      || Math.abs(clientX - currentDrag.startX) >= 3
      || Math.abs(clientY - currentDrag.startY) >= 3
    const origin = currentDrag.origin
    const duration = origin.frameEnd - origin.frameStart + 1
    let frameStart = origin.frameStart
    let frameEnd = origin.frameEnd
    let laneId = origin.laneId
    if (currentDrag.mode === 'move') {
      frameStart = clampNumber(pointed.hit.frame - currentDrag.grabOffsetFrames, displayFrameStart, displayFrameEnd - duration + 1)
      frameEnd = frameStart + duration - 1
      laneId = pointed.laneId
    } else if (currentDrag.mode === 'resize-start') {
      frameStart = clampNumber(pointed.hit.frame, displayFrameStart, origin.frameEnd)
    } else {
      frameEnd = clampNumber(pointed.hit.frame, origin.frameStart, displayFrameEnd)
    }
    const nextDrag = { ...currentDrag, moved, preview: { ...currentDrag.origin, laneId, frameStart, frameEnd } }
    soundCueDragRef.current = nextDrag
    setSoundCueDrag(nextDrag)
  }

  function finishSoundCuePointerById(pointerId: number, cancelled = false, clientX?: number, clientY?: number) {
    if (cancelled) {
      soundCuePointerUpdates.cancel()
    } else if (clientX !== undefined && clientY !== undefined) {
      soundCuePointerUpdates.flush({ pointerId, clientX, clientY })
    } else {
      soundCuePointerUpdates.flush()
    }
    const current = soundCueDragRef.current
    if (!current || current.pointerId !== pointerId) return
    soundCueDragRef.current = null
    setSoundCueDrag(null)
    props.onStatusHint('sheet-drag', null)
    releasePointerCaptureForElements(pointerId, Object.values(sheetSvgRefs.current))
    if (!cancelled && current.moved) {
      lastSoundCueActivationRef.current = null
      props.onSoundCueTransform(current.origin.cueId, {
        laneId: current.preview.laneId,
        frameStart: current.preview.frameStart,
        frameEnd: current.preview.frameEnd,
      }, current.mode === 'move' ? 'move-binding' : 'resize-cue')
    } else if (!cancelled) {
      const activation = primaryPointerActivation(current.origin.cueId, performance.now(), clientX ?? current.startX, clientY ?? current.startY)
      const transition = advancePrimaryPointerActivation(lastSoundCueActivationRef.current, activation)
      lastSoundCueActivationRef.current = transition.next
      if (transition.repeated) props.onSoundCueEdit(current.origin.cueId)
      else props.onSoundCueSelect(current.origin.cueId)
    } else {
      lastSoundCueActivationRef.current = null
    }
  }

  updateSoundCuePointerRef.current = soundCuePointerUpdates.schedule
  finishSoundCuePointerRef.current = finishSoundCuePointerById
  function handleSoundCuePointerMove(event: PointerEvent<SVGGElement>) {
    soundCuePointerUpdates.schedule(event.pointerId, event.clientX, event.clientY)
  }
  function finishSoundCuePointer(event: PointerEvent<SVGGElement>, cancelled = false) {
    finishSoundCuePointerById(event.pointerId, cancelled, event.clientX, event.clientY)
  }

  function handleSoundCueDoubleClick(cueId: string) {
    lastSoundCueActivationRef.current = null
    props.onSoundCueEdit(cueId)
  }

  function handleSoundCuePointerEnter(event: PointerEvent<SVGGElement>, cueId: string) {
    if (soundCueDragRef.current) return
    setHoveredSoundCueId(cueId)
    setSoundCueHoverAnchor({ x: event.clientX, y: event.clientY })
  }

  function handleSoundCuePointerLeave() {
    if (soundCueDragRef.current) return
    setHoveredSoundCueId(null)
    setSoundCueHoverAnchor(null)
  }

  function handleCameraCuePointerDown(event: PointerEvent<SVGElement>, cue: TimedRangeCue, mode: CameraCueDragMode, geometry?: CameraCueDragGeometry) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (event.pointerType === 'touch' && props.touchRangeSelectionMode) return
    if (props.editMode === 'pen' || props.editMode === 'eraser' || props.editMode === 'text' || props.editMode === 'calibrate') return
    if (event.pointerType !== 'mouse') event.preventDefault()
    event.stopPropagation()
    beginCameraCuePointer(event.pointerId, event.clientX, event.clientY, cue, mode, geometry)
  }

  function beginCameraCuePointer(pointerId: number, clientX: number, clientY: number, cue: TimedRangeCue, mode: CameraCueDragMode, geometry?: CameraCueDragGeometry) {
    clearHover()
    cameraCuePointerUpdates.cancel()
    setHoveredCameraCueId(null)
    setCameraCueHoverAnchor(null)
    props.onCameraCueSelect(cue.cueId)
    const pointed = cameraHitFromClientPoint(clientX, clientY)
    const nextDrag = createCameraCuePointerDrag({
      pointerId, clientX, clientY, cue, mode, geometry,
      pointed: pointed ? { frame: pointed.hit.frame, x: pointed.point.x, y: pointed.point.y } : undefined,
    })
    cameraCueDragRef.current = nextDrag
    setCameraCueDrag(nextDrag)
    const action = mode === 'move' ? 'CAMERA区間を移動中'
      : mode === 'resize-start' || mode === 'resize-end' ? 'CAMERA区間の長さを変更中'
        : mode === 'pivot' ? 'CAMERA交差位置を変更中'
          : mode === 'point' ? 'CAMERA中間点を移動中'
            : mode === 'move-label' ? 'CAMERAラベルを移動中'
              : 'CAMERAラベルの大きさを変更中'
    props.onStatusHint('sheet-drag', `${action}：離すと確定 / Escで取消`)
  }

  function updateCameraCuePointer(pointerId: number, clientX: number, clientY: number) {
    const currentDrag = cameraCueDragRef.current
    if (!currentDrag || currentDrag.pointerId !== pointerId) return
    autoScrollViewportForDrag({ clientX, clientY }, viewportRef.current)
    const pointed = cameraHitFromClientPoint(clientX, clientY)
    if (!pointed) return
    setActivePageIndexIfNeeded(pointed.page.pageIndex)
    const moved = currentDrag.moved || Math.abs(clientX - currentDrag.startX) >= 3 || Math.abs(clientY - currentDrag.startY) >= 3
    const origin = currentDrag.origin
    const duration = origin.frameEnd - origin.frameStart + 1
    let laneId = origin.laneId
    let frameStart = origin.frameStart
    let frameEnd = origin.frameEnd
    let camera = origin.camera ?? { shape: 'range' as const, points: [] }

    if (currentDrag.mode === 'move') {
      frameStart = clampNumber(pointed.hit.frame - currentDrag.grabOffsetFrames, displayFrameStart, displayFrameEnd - duration + 1)
      frameEnd = frameStart + duration - 1
      laneId = pointed.laneId
      camera = transformCameraInstructionRange(camera, origin.frameStart, origin.frameEnd, frameStart, frameEnd)
    } else if (currentDrag.mode === 'resize-start') {
      frameStart = clampNumber(pointed.hit.frame, displayFrameStart, origin.frameEnd)
      camera = transformCameraInstructionRange(camera, origin.frameStart, origin.frameEnd, frameStart, frameEnd)
    } else if (currentDrag.mode === 'resize-end') {
      frameEnd = clampNumber(pointed.hit.frame, origin.frameStart, displayFrameEnd)
      camera = transformCameraInstructionRange(camera, origin.frameStart, origin.frameEnd, frameStart, frameEnd)
    } else if (currentDrag.mode === 'pivot' && currentDrag.labelGeometry?.segmentEndPointId) {
      const points = resolveCameraInstructionPoints(camera, origin.frameStart, origin.frameEnd)
      const targets = [...points.filter(point => point.role === 'intermediate'), { pointId: 'cue-end', frameOffset: duration }]
      const targetIndex = targets.findIndex(target => target.pointId === currentDrag.labelGeometry?.segmentEndPointId)
      const segmentStart = targetIndex <= 0 ? origin.frameStart : origin.frameStart + targets[targetIndex - 1]!.frameOffset
      const segmentEnd = targetIndex < 0 ? origin.frameEnd : origin.frameStart + targets[targetIndex]!.frameOffset - 1
      camera = {
        ...camera,
        segments: resolveCameraInstructionSegments(camera, origin.frameStart, origin.frameEnd, points).map(segment => segment.endPointId === currentDrag.labelGeometry?.segmentEndPointId
          ? { ...segment, pivotAnchorFrame: clampCameraOverlapPivotAnchorFrame(pointed.hit.frame, segmentStart, segmentEnd) }
          : segment),
      }
    } else if (currentDrag.mode === 'point' && currentDrag.labelGeometry?.pointId) {
      const points = resolveCameraInstructionPoints(camera, origin.frameStart, origin.frameEnd)
      const pointIndex = points.findIndex(point => point.pointId === currentDrag.labelGeometry?.pointId)
      const point = points[pointIndex]
      if (point?.role === 'intermediate') {
        const previousOffset = points.slice(0, pointIndex).reverse().find(item => item.frameOffset < point.frameOffset)?.frameOffset ?? 0
        const nextOffset = points.slice(pointIndex + 1).find(item => item.frameOffset > point.frameOffset)?.frameOffset ?? duration - 1
        const frameOffset = clampNumber(pointed.hit.frame - origin.frameStart, previousOffset + 1, nextOffset - 1)
        camera = { ...camera, points: points.map(item => item.pointId === point.pointId ? { ...item, frameOffset } : item) }
      }
    } else if (currentDrag.labelOriginPlacement && currentDrag.labelGeometry?.labelLayout) {
      const placement = currentDrag.labelOriginPlacement
      if (currentDrag.mode === 'move-label') {
        const widthRatio = clampNumber(placement.widthRatio, 0.05, 1)
        const pointerOffset = currentDrag.labelPointerOffset ?? { x: 0, frames: 0 }
        const xRatio = clampNumber((pointed.point.x - pointerOffset.x - pointed.regionRect.x) / Math.max(0.000001, pointed.regionRect.w), 0, 1 - widthRatio)
        const boxFrameStart = Math.round(pointed.hit.frame - pointerOffset.frames)
        camera = { ...camera, labelPlacement: { ...placement, frameOffset: clampNumber(boxFrameStart - origin.frameStart, 0, origin.frameEnd - origin.frameStart), xRatio, widthRatio } }
      } else {
        const boxFrameStart = origin.frameStart + placement.frameOffset
        const widthRatio = clampNumber((pointed.point.x - pointed.regionRect.x) / Math.max(0.000001, pointed.regionRect.w) - placement.xRatio, 0.05, 1 - placement.xRatio)
        const heightFrames = Math.max(1, pointed.hit.frame - boxFrameStart + 1)
        camera = { ...camera, labelPlacement: { ...placement, widthRatio, heightFrames } }
      }
    }
    const nextDrag = { ...currentDrag, moved, preview: { ...origin, laneId, frameStart, frameEnd, camera } }
    cameraCueDragRef.current = nextDrag
    setCameraCueDrag(nextDrag)
  }

  function finishCameraCuePointerById(pointerId: number, cancelled = false, clientX?: number, clientY?: number) {
    if (cancelled) {
      cameraCuePointerUpdates.cancel()
    } else if (clientX !== undefined && clientY !== undefined) {
      cameraCuePointerUpdates.flush({ pointerId, clientX, clientY })
    } else {
      cameraCuePointerUpdates.flush()
    }
    const current = cameraCueDragRef.current
    if (!current || current.pointerId !== pointerId) return
    cameraCueDragRef.current = null
    setCameraCueDrag(null)
    props.onStatusHint('sheet-drag', null)
    releasePointerCaptureForElements(pointerId, Object.values(sheetSvgRefs.current))
    if (!cancelled && current.moved) {
      lastCameraCueActivationRef.current = null
      props.onCameraCueTransform(current.origin.cueId, {
        laneId: current.preview.laneId,
        frameStart: current.preview.frameStart,
        frameEnd: current.preview.frameEnd,
        camera: current.preview.camera,
      })
    } else if (!cancelled) {
      const activation = primaryPointerActivation(current.origin.cueId, performance.now(), clientX ?? current.startX, clientY ?? current.startY)
      const transition = advancePrimaryPointerActivation(lastCameraCueActivationRef.current, activation)
      lastCameraCueActivationRef.current = transition.next
      if (transition.repeated) props.onCameraCueEdit(current.origin.cueId)
      else props.onCameraCueSelect(current.origin.cueId)
    } else {
      lastCameraCueActivationRef.current = null
    }
  }

  updateCameraCuePointerRef.current = cameraCuePointerUpdates.schedule
  finishCameraCuePointerRef.current = finishCameraCuePointerById
  function handleCameraCuePointerMove(event: PointerEvent<SVGGElement>) {
    cameraCuePointerUpdates.schedule(event.pointerId, event.clientX, event.clientY)
  }
  function finishCameraCuePointer(event: PointerEvent<SVGGElement>, cancelled = false) { finishCameraCuePointerById(event.pointerId, cancelled, event.clientX, event.clientY) }

  function handleCameraCueDoubleClick(cueId: string) {
    lastCameraCueActivationRef.current = null
    props.onCameraCueEdit(cueId)
  }

  function handleCameraCuePointerEnter(event: PointerEvent<SVGGElement>, cueId: string) {
    if (cameraCueDragRef.current) return
    setHoveredCameraCueId(cueId)
    setCameraCueHoverAnchor({ x: event.clientX, y: event.clientY })
    if (props.selectedCameraCueId === cueId) props.onStatusHint('sheet-hover', 'ドラッグで移動 / ダブルクリックで編集 / Escで選択解除')
  }

  function handleCameraCuePointerLeave() {
    if (cameraCueDragRef.current) return
    setHoveredCameraCueId(null)
    setCameraCueHoverAnchor(null)
    props.onStatusHint('sheet-hover', null)
  }

  function handleTimedRangeDoubleClick(event: MouseEvent<SVGSVGElement>, page: SheetPage) {
    if (props.editMode !== 'new') return
    const hit = rangeHitFromPoint(pointFromEvent(event), page)
    if (hit?.role !== 'sound' && hit?.role !== 'camera') return
    const range = hit.role === 'sound'
      ? selectedSoundRangeContainingHit(hit) ?? rangeFromHits(hit, hit)
      : selectedCameraRangeContainingHit(hit) ?? rangeFromHits(hit, hit)
    if (!range) return
    event.preventDefault()
    event.stopPropagation()
    cancelDraftRangeInteraction()
    if (hit.role === 'sound') props.onSoundRangeEdit(range)
    else props.onCameraRangeEdit(range)
  }

  function touchDirectActionForLongPress(tap: SheetTouchTap): SheetTouchLongPressAction | null {
    if (props.editMode !== 'new' || !tap.target) return null
    const soundTarget = tap.target.closest<SVGElement>('[data-sound-cue-id]')
    const soundCue = soundTarget?.getAttribute('data-sound-cue-id')
      ? props.project.timedRangeCues.find(cue => cue.cueId === soundTarget.getAttribute('data-sound-cue-id') && cue.role === 'sound')
      : undefined
    if (soundCue) {
      beginSoundCuePointer(tap.pointerId, tap.clientX, tap.clientY, soundCue, 'move')
      return {
        move: (clientX, clientY) => soundCuePointerUpdates.schedule(tap.pointerId, clientX, clientY),
        finish: (cancelled, clientX, clientY) => finishSoundCuePointerById(tap.pointerId, cancelled, clientX, clientY),
      }
    }

    const cameraTarget = tap.target.closest<SVGElement>('[data-camera-cue-id]')
    const cameraCue = cameraTarget?.getAttribute('data-camera-cue-id')
      ? props.project.timedRangeCues.find(cue => cue.cueId === cameraTarget.getAttribute('data-camera-cue-id') && cue.role === 'camera')
      : undefined
    if (cameraCue) {
      beginCameraCuePointer(tap.pointerId, tap.clientX, tap.clientY, cameraCue, 'move')
      return {
        move: (clientX, clientY) => cameraCuePointerUpdates.schedule(tap.pointerId, clientX, clientY),
        finish: (cancelled, clientX, clientY) => finishCameraCuePointerById(tap.pointerId, cancelled, clientX, clientY),
      }
    }

    const timelineTarget = tap.target.closest<SVGElement>('[data-timeline-event-track][data-timeline-event-frame]')
    const pointed = timelineTarget ? pageHitUnderClientPoint(tap.clientX, tap.clientY) : null
    if (!pointed?.hit?.paperTrack || !timelineTarget) return null
    const paperTrack = timelineTarget.getAttribute('data-timeline-event-track')
    const frame = Number(timelineTarget.getAttribute('data-timeline-event-frame'))
    if (!paperTrack || !Number.isFinite(frame) || pointed.hit.paperTrack !== paperTrack || pointed.hit.frame !== frame) return null
    const selectedRange = isPointEventRangeForUi(props.rangeSelection)
      && rangeContainsHit(props.rangeSelection, pointed.hit)
      && (props.rangeSelection.frameStart !== props.rangeSelection.frameEnd || rangePaperTracks(props.rangeSelection).length > 1)
      ? props.rangeSelection
      : undefined
    if (!selectedRange) props.onCellClick(pointed.hit)
    beginTimelineEventDrag(tap.pointerId, pointed.hit, tap.clientX, tap.clientY, selectedRange)
    return {
      move: (clientX, clientY) => updateTimelineEventDragFromClient(tap.pointerId, clientX, clientY, viewportRef.current),
      finish: (cancelled, clientX, clientY) => finishTimelineEventPointerById(tap.pointerId, cancelled, clientX, clientY),
    }
  }

  function handlePointerDown(event: PointerEvent<SVGSVGElement>, page: SheetPage): PageAnnotationStrokeStart | null {
    lastSoundCueActivationRef.current = null
    lastCameraCueActivationRef.current = null
    if (beginViewportPan(event, event.currentTarget.closest<HTMLElement>('.sheetViewport'))) return null
    if (event.pointerType === 'mouse' && event.button !== 0) return null
    event.preventDefault(); if (props.selectedTimelineMemoId) { props.onSelectTimelineMemo(null); return null }
    setContextMenu(null)
    setPaperTrackHeaderMenu(null)
    setOverlayPaperTrackMenu(null)
    setStackGuideHeaderMenu(null)
    props.setActivePageIndex(page.pageIndex)
    const point = pointFromEvent(event)
    const { point: annotationPoint, coordinateSpace: annotationCoordinateSpace } =
      pageMemoInputPosition(point, props.pageAnnotationTarget)
    if (props.editMode === 'calibrate') return null
    if (props.editMode === 'text') {
      if (props.editingTextAnnotationId) {
        props.onCommitFocusedTextAnnotationDraft()
        return null
      }
      props.onTextAnnotation({
        annotationId: nextAnnotationId(sheetAnnotations(props.project)),
        pageId: page.pageId,
        kind: 'text',
        text: '',
        x: annotationPoint.x,
        y: annotationPoint.y,
        color: props.penColor,
        fontSizePx: props.textFontSizePx,
        coordinateSpace: annotationCoordinateSpace,
        anchor: pageAnnotationAnchor(page),
      })
      return null
    }
    if (props.editMode === 'pen' || props.editMode === 'eraser') {
      const tool = props.editMode
      const box = event.currentTarget.getBoundingClientRect()
      return {
        pointerId: event.pointerId,
        svgRect: { left: box.left, top: box.top, width: box.width, height: box.height },
        target: props.pageAnnotationTarget,
        stroke: {
          annotationId: nextAnnotationId(sheetAnnotations(props.project)),
          pageId: page.pageId,
          tool,
          color: tool === 'pen' ? props.penColor : '#2f7f6a',
          width: tool === 'pen' ? props.penWidth : props.eraserWidth,
          coordinateSpace: annotationCoordinateSpace,
          anchor: pageAnnotationAnchor(page),
          points: [{ ...annotationPoint, pressure: event.pressure || 1 }],
        },
      }
    }
    const headerHit = paperTrackHeaderHitFromPoint(point, page, event.currentTarget.getBoundingClientRect().height)
    if (headerHit?.paperTrack) {
      clearHover()
      selectPaperTrackColumn(headerHit)
      return null
    }
    const hit = rangeHitFromPoint(point, page)
    if (hit) {
      event.currentTarget.setPointerCapture?.(event.pointerId)
      const preserveRangeOnClick = hit.role === 'sound'
        ? selectedSoundRangeContainingHit(hit) ?? undefined
        : hit.role === 'camera'
          ? selectedCameraRangeContainingHit(hit) ?? undefined
          : undefined
      if (preserveRangeOnClick) {
        props.onRangeSelect(preserveRangeOnClick)
      } else if (hit.paperTrack && (hit.role === 'action' || hit.role === 'cell')) {
        props.onCellClick(hit)
      } else {
        const initialRange = rangeFromHits(hit, hit)
        if (initialRange) props.onRangeSelect(initialRange)
      }
      setDraftRange({
        pointerId: event.pointerId,
        anchor: hit,
        focus: hit,
        moved: false,
        preserveRangeOnClick,
      })
      props.onStatusHint('sheet-drag', uiText.statusHints.rangeDragging)
      return null
    }
    props.onClearSelection()
    return null
  }

  function timelineEventHitForPage(
    timelineEvent: { paperTrack: string; frame: number; sheetRole?: SheetTimingRole },
    page: SheetPage,
  ): SheetHit | null {
    const role = sheetTimingRoleForEvent(timelineEvent)
    const track = props.project.logicalSheet.paperTracks.find(item => item.paperTrack === timelineEvent.paperTrack)
    if (track && overlayPaperTracks(props.project, props.template).some(candidate => candidate.paperTrack === track.paperTrack)) return overlayHitForFrame(props.template, props.project, track, timelineEvent.frame, page, role)
    const hit = timingHitForFrame(props.template, role, timelineEvent.paperTrack, timelineEvent.frame, displayDurationFrames, displayFrameStart, templateTrackNames)
    return hit?.pageId === page.pageId ? hit : null
  }

  function handleTimelineEventPointerDown(
    event: PointerEvent<SVGGElement>,
    timelineEvent: { paperTrack: string; frame: number; sheetRole?: SheetTimingRole },
    page: SheetPage,
  ) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (event.pointerType === 'touch' && props.touchRangeSelectionMode) return
    if (props.editMode === 'pen' || props.editMode === 'eraser' || props.editMode === 'text' || props.editMode === 'calibrate') return
    if (spacePanReadyRef.current) return
    const sourceHit = timelineEventHitForPage(timelineEvent, page)
    if (!sourceHit?.paperTrack) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    clearHover()
    setContextMenu(null)
    setPaperTrackHeaderMenu(null)
    setStackGuideHeaderMenu(null)
    props.setActivePageIndex(page.pageIndex)
    const selectedRange = isPointEventRangeForUi(props.rangeSelection)
      && rangeContainsHit(props.rangeSelection, sourceHit)
      && (props.rangeSelection.frameStart !== props.rangeSelection.frameEnd || rangePaperTracks(props.rangeSelection).length > 1)
      ? props.rangeSelection
      : undefined
    if (selectedRange) {
      beginTimelineEventDrag(event.pointerId, sourceHit, event.clientX, event.clientY, selectedRange)
      return
    }
    props.onCellClick(sourceHit)
    if (event.altKey) {
      beginTimelineEventDrag(event.pointerId, sourceHit, event.clientX, event.clientY)
      return
    }
    clearTimelineEventLongPressTimer()
    setPendingTimelineEventDrag({
      pointerId: event.pointerId,
      sourceHit,
      startX: event.clientX,
      startY: event.clientY,
      ready: false,
    })
    timelineEventLongPressTimerRef.current = window.setTimeout(() => {
      timelineEventLongPressTimerRef.current = null
      setPendingTimelineEventDrag(current => current && current.pointerId === event.pointerId
        ? { ...current, ready: true }
        : current)
    }, TIMELINE_EVENT_LONG_PRESS_MS)
  }

  function handleTimelineEventPointerMove(event: PointerEvent<SVGGElement>) {
    const activeDraftRange = draftRangeRef.current
    const activePendingTimelineEventDrag = pendingTimelineEventDragRef.current
    const activeTimelineEventDrag = timelineEventDragRef.current
    const handlesThisPointer = (activeDraftRange && activeDraftRange.pointerId === event.pointerId)
      || (activePendingTimelineEventDrag && activePendingTimelineEventDrag.pointerId === event.pointerId)
      || (activeTimelineEventDrag && activeTimelineEventDrag.pointerId === event.pointerId)
    if (!handlesThisPointer) return
    event.preventDefault()
    event.stopPropagation()
    const viewport = event.currentTarget.closest<HTMLElement>('.sheetViewport')
    if (activeDraftRange && activeDraftRange.pointerId === event.pointerId) {
      autoScrollViewportForDrag(event, viewport)
      updateDraftRangeFromClientPoint(event.pointerId, event.clientX, event.clientY)
      return
    }
    if (activePendingTimelineEventDrag && activePendingTimelineEventDrag.pointerId === event.pointerId) {
      const movedByPointer = Math.abs(event.clientX - activePendingTimelineEventDrag.startX) >= TIMELINE_EVENT_DRAG_THRESHOLD_PX
        || Math.abs(event.clientY - activePendingTimelineEventDrag.startY) >= TIMELINE_EVENT_DRAG_THRESHOLD_PX
      if (!activePendingTimelineEventDrag.ready && movedByPointer) {
        autoScrollViewportForDrag(event, viewport)
        beginDraftRangeFromTimelineEvent(event.pointerId, activePendingTimelineEventDrag.sourceHit, event.clientX, event.clientY)
        return
      }
      if (activePendingTimelineEventDrag.ready) {
        autoScrollViewportForDrag(event, viewport)
        const target = timelineMoveTargetFromClientPoint(event.clientX, event.clientY, activePendingTimelineEventDrag.sourceHit)
        const targetHit = target?.hit ?? null
        updateHover(targetHit, targetHit ? { x: event.clientX, y: event.clientY } : undefined)
        const moved = movedByPointer || Boolean(targetHit && !sameSheetHitCell(targetHit, activePendingTimelineEventDrag.sourceHit))
        const nextDrag = {
          pointerId: event.pointerId,
          sourceHit: activePendingTimelineEventDrag.sourceHit,
          currentHit: targetHit,
          startX: activePendingTimelineEventDrag.startX,
          startY: activePendingTimelineEventDrag.startY,
          moved,
        }
        clearPendingTimelineEventDrag()
        setTimelineEventDrag(nextDrag)
        props.onStatusHint('sheet-drag', uiText.statusHints.eventDragging)
        return
      }
      return
    }
    updateTimelineEventDragFromClient(event.pointerId, event.clientX, event.clientY, viewport)
  }

  function handleTimelineEventPointerUp(event: PointerEvent<SVGGElement>) {
    const activeDraftRange = draftRangeRef.current
    if (activeDraftRange && activeDraftRange.pointerId === event.pointerId) {
      event.preventDefault()
      event.stopPropagation()
      commitDraftRangeFromPointer(event.pointerId, event.clientX, event.clientY)
      return
    }
    const activePendingTimelineEventDrag = pendingTimelineEventDragRef.current
    if (activePendingTimelineEventDrag && activePendingTimelineEventDrag.pointerId === event.pointerId) {
      event.preventDefault()
      event.stopPropagation()
      clearPendingTimelineEventDrag()
      return
    }
    const activeTimelineEventDrag = timelineEventDragRef.current
    if (!activeTimelineEventDrag || activeTimelineEventDrag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    finishTimelineEventPointerById(event.pointerId, false, event.clientX, event.clientY)
  }

  function handleTimelineEventPointerCancel(event: PointerEvent<SVGGElement>) {
    const activeDraftRange = draftRangeRef.current
    if (activeDraftRange && activeDraftRange.pointerId === event.pointerId) {
      event.preventDefault()
      event.stopPropagation()
      cancelDraftRangeInteraction()
      return
    }
    const activePendingTimelineEventDrag = pendingTimelineEventDragRef.current
    if (activePendingTimelineEventDrag && activePendingTimelineEventDrag.pointerId === event.pointerId) {
      event.preventDefault()
      event.stopPropagation()
      clearPendingTimelineEventDrag()
      return
    }
    const activeTimelineEventDrag = timelineEventDragRef.current
    if (!activeTimelineEventDrag || activeTimelineEventDrag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    finishTimelineEventPointerById(event.pointerId, true, event.clientX, event.clientY)
  }

  function calibrationPointsForPage(page: SheetPage, settings: SheetImageSettings): SheetCalibrationPointPair[] {
    return draftCalibration?.pageId === page.pageId ? draftCalibration.points : calibrationPointsForSettings(settings, props.template)
  }

  function handleCalibrationHandlePointerDown(
    event: PointerEvent<SVGElement>,
    page: SheetPage,
    settings: SheetImageSettings,
    pointIndex: number,
    pointKind: CalibrationPointKind,
  ) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    props.setActivePageIndex(page.pageIndex)
    calibrationDrag.begin(event, page, settings, pointIndex, pointKind, calibrationPointsForPage(page, settings))
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (panningRef.current) return
    const page = props.sheetPages.find(page => page.pageId === event.currentTarget.dataset.pageId)
    const viewport = event.currentTarget.closest<HTMLElement>('.sheetViewport')
    if (props.editMode === 'text' && page && !props.selectedTimelineMemoId && !props.editingTextAnnotationId) {
      const box = event.currentTarget.getBoundingClientRect()
      setTextCursorBadge({
        pageId: page.pageId,
        x: clampNumber(event.clientX - box.left, 0, box.width),
        y: clampNumber(event.clientY - box.top, 0, box.height),
      })
    } else if (textCursorBadge) {
      setTextCursorBadge(null)
    }
    const activeDraftRange = draftRangeRef.current
    if (activeDraftRange && activeDraftRange.pointerId === event.pointerId) {
      updateDraftRangeFromClientPoint(event.pointerId, event.clientX, event.clientY, page)
      return
    }
    const activePendingTimelineEventDrag = pendingTimelineEventDragRef.current
    if (activePendingTimelineEventDrag && activePendingTimelineEventDrag.pointerId === event.pointerId) {
      event.preventDefault()
      const movedByPointer = Math.abs(event.clientX - activePendingTimelineEventDrag.startX) >= TIMELINE_EVENT_DRAG_THRESHOLD_PX
        || Math.abs(event.clientY - activePendingTimelineEventDrag.startY) >= TIMELINE_EVENT_DRAG_THRESHOLD_PX
      if (!activePendingTimelineEventDrag.ready && movedByPointer) {
        autoScrollViewportForDrag(event, viewport)
        beginDraftRangeFromTimelineEvent(event.pointerId, activePendingTimelineEventDrag.sourceHit, event.clientX, event.clientY)
        return
      }
      if (activePendingTimelineEventDrag.ready) {
        autoScrollViewportForDrag(event, viewport)
        const target = timelineMoveTargetFromClientPoint(event.clientX, event.clientY, activePendingTimelineEventDrag.sourceHit)
        const targetHit = target?.hit ?? null
        updateHover(targetHit, targetHit ? { x: event.clientX, y: event.clientY } : undefined)
        const moved = movedByPointer || Boolean(targetHit && !sameSheetHitCell(targetHit, activePendingTimelineEventDrag.sourceHit))
        setTimelineEventDrag({
          pointerId: event.pointerId,
          sourceHit: activePendingTimelineEventDrag.sourceHit,
          currentHit: targetHit,
          startX: activePendingTimelineEventDrag.startX,
          startY: activePendingTimelineEventDrag.startY,
          moved,
        })
        clearPendingTimelineEventDrag()
        return
      }
      return
    }
    const activeTimelineEventDrag = timelineEventDragRef.current
    if (activeTimelineEventDrag && activeTimelineEventDrag.pointerId === event.pointerId) {
      event.preventDefault()
      updateTimelineEventDragFromClient(event.pointerId, event.clientX, event.clientY, viewport)
      return
    }
    if (event.pointerType !== 'touch' && page && props.editMode !== 'pen' && props.editMode !== 'eraser' && props.editMode !== 'calibrate') {
      const hit = hitFromPoint(pointFromEvent(event), page)
      updateHover(hit, { x: event.clientX, y: event.clientY })
    }
  }

  function openContextMenuAt(clientX: number, clientY: number, target: Element | null, page: SheetPage, svg: SVGSVGElement): boolean {
    props.setActivePageIndex(page.pageIndex)
    const point = pointFromClient(svg, clientX, clientY)
    const stackGuideTarget = stackGuideHeaderInsertTargetFromPoint(point, page)
    if (stackGuideTarget) {
      clearHover()
      closeContextMenus()
      setStackGuideHeaderMenu({ ...stackGuideTarget, x: clientX, y: clientY })
      return true
    }
    const headerHit = paperTrackHeaderHitFromPoint(point, page, svg.getBoundingClientRect().height)
    if (headerHit?.paperTrack) {
      clearHover()
      const sheetRole = sheetRoleForHit(headerHit)
      closeContextMenus()
      setPaperTrackHeaderMenu({ x: clientX, y: clientY, hit: headerHit, sheetRole, snapIndex: overlaySnapIndexFromPoint(props.template, props.project, point, sheetRole) })
      return true
    }
    const laneHeader = timedRangeLaneHeaderHitFromPoint(point, page, svg.getBoundingClientRect().height)
    if (laneHeader) {
      clearHover()
      closeContextMenus()
      setTimedRangeLaneHeaderMenu({ ...laneHeader, x: clientX, y: clientY })
      return true
    }
    const hit = rangeHitFromPoint(point, page)
    const { timelineMemoIds, soundCueId, cameraCueId } = resolveTimelineMemoContextTargets(target, props.project, props.template, hit)
    if (!hit && !timelineMemoIds?.length && !soundCueId && !cameraCueId) return false
    if (soundCueId && !(hit && frameOperationRangeContainsHit(props.rangeSelection, hit))) {
      props.onSoundCueSelect(soundCueId)
    } else if (cameraCueId && !(hit && frameOperationRangeContainsHit(props.rangeSelection, hit))) {
      props.onCameraCueSelect(cameraCueId)
    } else if (hit?.role === 'sound' || hit?.role === 'camera') {
      if (!frameOperationRangeContainsHit(props.rangeSelection, hit)) {
        const range = rangeFromHits(hit, hit)
        if (range) props.onRangeSelect(range)
      }
    } else if (hit?.paperTrack && !rangeContainsHit(props.rangeSelection, hit)) {
      props.onCellSelect(hit)
    }
    clearHover()
    const sheetRole = hit?.role === 'action' || hit?.role === 'cell' ? sheetRoleForHit(hit) : undefined
    const snapIndex = sheetRole === undefined ? undefined : overlaySnapIndexFromPoint(props.template, props.project, point, sheetRole)
    closeContextMenus()
    setContextMenu({ x: clientX, y: clientY, hit, timelineMemoIds, snapIndex, sheetRole, insertAfterPaperTrack: hit?.paperTrack })
    return true
  }

  function handleContextMenu(event: MouseEvent<SVGSVGElement>, page: SheetPage) {
    event.preventDefault(); event.stopPropagation()
    openContextMenuAt(event.clientX, event.clientY, event.target instanceof Element ? event.target : null, page, event.currentTarget)
  }

  function openSelectionContextMenu(clientX: number, clientY: number): boolean {
    const hit = props.selectedHit ?? props.rangeSelection?.anchorHit ?? null
    const timelineMemoIds = props.selectedTimelineMemoId ? [props.selectedTimelineMemoId] : undefined
    if (!hit && !timelineMemoIds?.length && !props.selectedSoundCueId && !props.selectedCameraCueId) return false
    const sheetRole = hit?.role === 'action' || hit?.role === 'cell' ? sheetRoleForHit(hit) : undefined
    clearHover()
    closeContextMenus()
    setContextMenu({ x: clientX, y: clientY, hit, timelineMemoIds, sheetRole, insertAfterPaperTrack: hit?.paperTrack })
    return true
  }

  function runContextMenuAction(action: () => void) {
    action()
    setContextMenu(null)
  }

  function runPaperTrackHeaderMenuAction(action: () => void) {
    action()
    setPaperTrackHeaderMenu(null)
  }

  function runOverlayPaperTrackMenuAction(action: () => void | Promise<void>) {
    void action()
    setOverlayPaperTrackMenu(null)
  }

  function runStackGuideHeaderMenuAction(action: () => void) {
    action()
    setStackGuideHeaderMenu(null)
  }

  function requestStackGuideInsert(target: StackGuideInsertTarget, mode: StackGuideInsertTool) {
    stackGuideInsertRequestIdRef.current += 1
    setStackGuideInsertRequest({
      ...target,
      requestId: stackGuideInsertRequestIdRef.current,
      mode,
    })
  }

  function openPaperTrackRenameEditor(
    paperTrack: string,
    input: { x: number; y: number; sheetRole: SheetTimingRole; snapIndex?: number },
  ) {
    const track = props.project.logicalSheet.paperTracks.find(item => item.paperTrack === paperTrack)
    if (!track) return
    const isOverlay = track.source === 'overlay'
    setPaperTrackEditor({
      x: input.x,
      y: input.y,
      mode: 'rename',
      initialName: track.paperTrack,
      isOverlay,
      paperTrack: track.paperTrack,
      snapIndex: input.snapIndex,
      sheetRole: input.sheetRole,
      exportAfterPaperTrack: isOverlay
        ? exportPreviousPaperTrackName(props.project.logicalSheet.paperTracks, track.paperTrack)
        : undefined,
    })
    setContextMenu(null)
    setPaperTrackHeaderMenu(null)
    setOverlayPaperTrackMenu(null)
    setStackGuideHeaderMenu(null)
    setTimedRangeLaneHeaderMenu(null)
  }

  function openAddOverlayPaperTrackEditor(input: { x: number; y: number; insertAfterPaperTrack?: string; snapIndex: number; sheetRole: SheetTimingRole }) {
    setPaperTrackEditor({
      x: input.x,
      y: input.y,
      mode: 'add',
      initialName: nextOverlayTrackNameForUi(props.project),
      isOverlay: true,
      snapIndex: input.snapIndex,
      sheetRole: input.sheetRole,
      exportAfterPaperTrack: defaultExportAfterTrackForInsertAfter(props.project.logicalSheet.paperTracks, input.insertAfterPaperTrack),
    })
    setContextMenu(null)
    setPaperTrackHeaderMenu(null)
    setOverlayPaperTrackMenu(null)
    setStackGuideHeaderMenu(null)
    setTimedRangeLaneHeaderMenu(null)
  }

  function openOverlayPaperTrackEditor(track: PaperTrack, position: { x: number; y: number }) {
    setPaperTrackEditor({
      x: position.x,
      y: position.y,
      mode: 'rename',
      initialName: track.paperTrack,
      isOverlay: true,
      paperTrack: track.paperTrack,
      snapIndex: track.viewPlacement?.snapIndex ?? 0,
      sheetRole: track.viewPlacement?.sheetRole ?? 'cell',
      exportAfterPaperTrack: exportPreviousPaperTrackName(props.project.logicalSheet.paperTracks, track.paperTrack),
    })
    setContextMenu(null)
    setPaperTrackHeaderMenu(null)
    setOverlayPaperTrackMenu(null)
    setStackGuideHeaderMenu(null)
    setTimedRangeLaneHeaderMenu(null)
  }

  function openOverlayPaperTrackMenu(track: PaperTrack, position: { x: number; y: number }) {
    setOverlayPaperTrackMenu({
      x: position.x,
      y: position.y,
      paperTrack: track.paperTrack,
    })
    setContextMenu(null)
    setPaperTrackHeaderMenu(null)
    setStackGuideHeaderMenu(null)
  }

  function submitPaperTrackEditor(name: string, exportAfterPaperTrack?: string) {
    if (!paperTrackEditor) return
    const trimmedName = name.trim()
    if (!trimmedName) return
    const exportPlacement = paperTrackEditor.isOverlay
      ? overlayExportPlacementAfterTrack(props.project.logicalSheet.paperTracks, exportAfterPaperTrack, paperTrackEditor.paperTrack)
      : null
    if (paperTrackEditor.mode === 'add') {
      props.onAddOverlayPaperTrack({
        paperTrack: trimmedName,
        insertAfterPaperTrack: exportPlacement?.insertAfterPaperTrack,
        orderInGap: exportPlacement?.orderInGap,
        snapIndex: paperTrackEditor.snapIndex,
        sheetRole: paperTrackEditor.sheetRole,
      })
    } else if (paperTrackEditor.paperTrack) {
      props.onUpdatePaperTrack(paperTrackEditor.paperTrack, {
        paperTrack: trimmedName,
        label: trimmedName,
        ...(paperTrackEditor.isOverlay && exportPlacement ? { exportPlacement } : {}),
      })
    }
    setPaperTrackEditor(null)
  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    if (panningRef.current) return
    const activeDraftRange = draftRangeRef.current
    if (activeDraftRange && activeDraftRange.pointerId === event.pointerId) {
      commitDraftRangeFromPointer(event.pointerId, event.clientX, event.clientY)
      return
    }
    const activePendingTimelineEventDrag = pendingTimelineEventDragRef.current
    if (activePendingTimelineEventDrag && activePendingTimelineEventDrag.pointerId === event.pointerId) {
      clearPendingTimelineEventDrag()
      return
    }
    const activeTimelineEventDrag = timelineEventDragRef.current
    if (activeTimelineEventDrag && activeTimelineEventDrag.pointerId === event.pointerId) {
      finishTimelineEventPointerById(event.pointerId, false, event.clientX, event.clientY)
      return
    }
  }

  async function handleDrop(event: DragEvent<SVGSVGElement>, page: SheetPage) {
    event.preventDefault()
    event.stopPropagation()
    props.onStatusHint('sheet-drop', null)
    const dataTransfer = event.dataTransfer
    const previewHit = dropTargetPreviewRef.current?.hit ?? null
    clearDropTargetPreview()
    props.setActivePageIndex(page.pageIndex)
    if (moveStackGuideLabelFromDragData(dataTransfer, event.clientX, event.clientY)) {
      clearHover()
      return
    }
    const point = pointFromEvent(event)
    const fallbackHit = previewHit?.pageId === page.pageId
      ? previewHit
      : hoveredHit?.pageId === page.pageId ? hoveredHit : null
    const rawHit = hitFromPoint(point, page) ?? fallbackHit
    const hit = dropHitForActiveRange(rawHit)
    props.onDropDiagnostic({
      source: 'sheet-dom',
      type: 'drop',
      target: hit ? `${sheetRoleLabel(sheetRoleForHit(hit))} ${hit.paperTrack ?? '-'}` : 'sheet/no-hit',
      fileCount: dataTransfer.files?.length ?? 0,
      position: { x: event.clientX, y: event.clientY },
      details: `types ${Array.from(dataTransfer.types ?? []).join(', ') || '-'}`,
    })
    const keyId = keyIdFromDragData(dataTransfer)
    if (keyId) {
      clearHover()
      props.onRegisteredCellAssign(keyId, hit)
      return
    }
    const assetIds = assetIdsFromDragData(dataTransfer)
    if (assetIds.length > 0) {
      clearHover()
      if (hit && assetIds.length === 1) {
        props.onAssetAssign(assetIds[0], hit, { x: event.clientX, y: event.clientY })
      }
      return
    }
    props.onAssetDrop(await collectAssetFilesFromDrop(dataTransfer), hit, { x: event.clientX, y: event.clientY })
  }

  function handleDragOver(event: DragEvent<SVGSVGElement>, page: SheetPage) {
    event.preventDefault()
    event.stopPropagation()
    autoScrollViewportForDrag(event, event.currentTarget.closest<HTMLElement>('.sheetViewport'))
    clearHover()
    if (hasStackGuideDragPayload(event.dataTransfer)) {
      event.dataTransfer.dropEffect = 'move'
      const target = updateStackGuideDropPreview(stackGuideLabelIdFromDragData(event.dataTransfer) || undefined, event.clientX, event.clientY)
      props.onStatusHint('sheet-drop', target ? uiText.statusHints.dropStackGuide : uiText.statusHints.dropUnavailable)
      clearDropTargetPreview()
      return
    }
    setStackGuideDropPreview(null)
    const hit = dropHitForActiveRange(hitFromPoint(pointFromEvent(event), page))
    const assetIds = assetIdsFromDragData(event.dataTransfer)
    props.onDropDiagnostic({
      source: 'sheet-dom',
      type: 'dragover',
      target: hit ? `${sheetRoleLabel(sheetRoleForHit(hit))} ${hit.paperTrack ?? '-'}` : 'sheet/no-hit',
      fileCount: assetIds.length,
      position: { x: event.clientX, y: event.clientY },
      details: `assetIds ${assetIds.length}`,
    })
    if (assetIds.length > 1 && hit) {
      event.dataTransfer.dropEffect = 'none'
      setDropStatusForHit(event.dataTransfer, hit, assetIds)
      updateDropTargetPreview(hit, 'invalid')
      return
    }
    event.dataTransfer.dropEffect = 'copy'
    setDropStatusForHit(event.dataTransfer, hit, assetIds)
    updateDropTargetPreview(hit, 'valid')
  }

  function handleViewportDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasSheetDropPayload(event.dataTransfer)) return
    event.preventDefault()
    autoScrollViewportForDrag(event, event.currentTarget)
    clearHover()
    if (hasStackGuideDragPayload(event.dataTransfer)) {
      event.dataTransfer.dropEffect = 'move'
      const target = updateStackGuideDropPreview(stackGuideLabelIdFromDragData(event.dataTransfer) || undefined, event.clientX, event.clientY)
      props.onStatusHint('sheet-drop', target ? uiText.statusHints.dropStackGuide : uiText.statusHints.dropUnavailable)
      clearDropTargetPreview()
      return
    }
    setStackGuideDropPreview(null)
    event.dataTransfer.dropEffect = 'copy'
    const target = dropTargetFromClientPoint(event.clientX, event.clientY)
    const hit = dropHitForActiveRange(target?.hit ?? null)
    const assetIds = assetIdsFromDragData(event.dataTransfer)
    props.onDropDiagnostic({
      source: 'sheet-viewport-dom',
      type: 'dragover',
      target: hit ? `${sheetRoleLabel(sheetRoleForHit(hit))} ${hit.paperTrack ?? '-'}` : 'sheet/no-hit',
      fileCount: assetIds.length,
      position: { x: event.clientX, y: event.clientY },
      details: `assetIds ${assetIds.length}`,
    })
    if (assetIds.length > 1 && hit) {
      event.dataTransfer.dropEffect = 'none'
      setDropStatusForHit(event.dataTransfer, hit, assetIds)
      updateDropTargetPreview(hit, 'invalid')
      return
    }
    if (target) {
      props.setActivePageIndex(target.page.pageIndex)
      setDropStatusForHit(event.dataTransfer, hit, assetIds)
      updateDropTargetPreview(hit, 'valid')
    } else {
      props.onStatusHint('sheet-drop', uiText.statusHints.dropUnavailable)
      clearDropTargetPreview()
    }
  }

  function handleViewportDragLeave(event: DragEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget as Node | null
    if (nextTarget && event.currentTarget.contains(nextTarget)) return
    props.onStatusHint('sheet-drop', null)
    clearDropTargetPreview()
  }

  async function handleViewportDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasSheetDropPayload(event.dataTransfer)) return
    event.preventDefault()
    props.onStatusHint('sheet-drop', null)
    const dataTransfer = event.dataTransfer
    clearDropTargetPreview()
    if (moveStackGuideLabelFromDragData(dataTransfer, event.clientX, event.clientY)) {
      clearHover()
      return
    }
    const target = dropTargetFromClientPoint(event.clientX, event.clientY)
    if (target) props.setActivePageIndex(target.page.pageIndex)
    const hit = dropHitForActiveRange(target?.hit ?? null)
    props.onDropDiagnostic({
      source: 'sheet-viewport-dom',
      type: 'drop',
      target: hit ? `${sheetRoleLabel(sheetRoleForHit(hit))} ${hit.paperTrack ?? '-'}` : 'sheet/no-hit',
      fileCount: dataTransfer.files?.length ?? 0,
      position: { x: event.clientX, y: event.clientY },
      details: `types ${Array.from(dataTransfer.types ?? []).join(', ') || '-'}`,
    })
    const keyId = keyIdFromDragData(dataTransfer)
    if (keyId) {
      clearHover()
      props.onRegisteredCellAssign(keyId, hit)
      return
    }
    const assetIds = assetIdsFromDragData(dataTransfer)
    if (assetIds.length > 0) {
      clearHover()
      if (hit && assetIds.length === 1) {
        props.onAssetAssign(assetIds[0], hit, { x: event.clientX, y: event.clientY })
      }
      return
    }
    props.onAssetDrop(await collectAssetFilesFromDrop(dataTransfer), hit, { x: event.clientX, y: event.clientY })
  }

  function handleViewportPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget || (event.target instanceof HTMLElement && event.target.classList.contains('sheetPageStack'))) {
      lastSoundCueActivationRef.current = null
      lastCameraCueActivationRef.current = null
    }
    const intent = resolveSheetViewportPointerIntent({
      pointerType: event.pointerType,
      button: event.button,
      spacePanReady: spacePanReadyRef.current,
      target: sheetViewportPointerTarget(event.target, event.currentTarget),
    })
    if (intent === 'begin-pan') {
      beginViewportPan(event, event.currentTarget)
      return
    }
    if (!isInteractiveKeyboardTarget(event.target)) {
      event.currentTarget.focus({ preventScroll: true })
    }
    if (intent === 'clear-primary-selection') {
      setContextMenu(null)
      setPaperTrackHeaderMenu(null)
      setStackGuideHeaderMenu(null)
      props.onClearSelection()
    }
  }

  function beginViewportPan(event: PointerEvent<HTMLElement> | PointerEvent<SVGSVGElement>, viewport: HTMLElement | null) {
    return beginSheetViewportPan(event, viewport, {
      spacePanReady: spacePanReadyRef.current,
      panningRef,
      onBegin: () => {
        setContextMenu(null)
        setPaperTrackHeaderMenu(null)
        setStackGuideHeaderMenu(null)
        setStackGuideDropPreview(null)
        clearHover()
        setIsPanning(true)
        props.onStatusHint('sheet-drag', uiText.statusHints.panning)
      },
      onEnd: () => {
        setIsPanning(false)
        props.onStatusHint('sheet-drag', null)
      },
    })
  }

  const contextProcessMove = contextMenu?.hit ? singleMovableBindingForHit(props.project, contextMenu.hit) : null
  const contextProcessMoveOptions = contextProcessMove ? processMoveOptionsForSlot(props.project, contextProcessMove.slot, contextProcessMove.binding.keyId) : []
  const soundContext = contextMenu?.hit?.role === 'sound' || Boolean(props.selectedSoundCueId)
  const cameraContext = contextMenu?.hit?.role === 'camera' || Boolean(props.selectedCameraCueId)
  const timedRangeContext = soundContext || cameraContext
  const timelineMemoContext = Boolean(contextMenu?.timelineMemoIds?.length)
  const frameOperationContext = contextMenu?.hit?.role === 'action' || contextMenu?.hit?.role === 'cell' || contextMenu?.hit?.role === 'sound' || contextMenu?.hit?.role === 'camera'
  const canCopyContextRange = soundContext
    ? Boolean(props.selectedSoundCueId || props.rangeSelection?.role === 'sound')
    : cameraContext
      ? Boolean(props.selectedCameraCueId || props.rangeSelection?.role === 'camera')
      : isPointEventRangeForUi(props.rangeSelection)
  const contextPasteRole = props.rangeSelection?.role === 'action' || props.rangeSelection?.role === 'cell'
    ? props.rangeSelection.role
    : props.selectedHit ? sheetRoleForHit(props.selectedHit) : 'cell'
  const contextPaperTrackOrder = rangeTrackOrder(contextPasteRole)
  const canPasteContextOverwrite = canPasteTimingClipboardMode(props.timingClipboard, props.selectedHit, props.rangeSelection, 'overwrite', contextPaperTrackOrder)
  const canPasteContextInsert = canPasteTimingClipboardMode(props.timingClipboard, props.selectedHit, props.rangeSelection, 'insert', contextPaperTrackOrder)
  const canPasteContextRepeatRange = canPasteTimingClipboardMode(props.timingClipboard, props.selectedHit, props.rangeSelection, 'repeat-range', contextPaperTrackOrder)
  const canPasteContextRepeatToEnd = canPasteTimingClipboardMode(props.timingClipboard, props.selectedHit, props.rangeSelection, 'repeat-to-end', contextPaperTrackOrder)
  const hasSheetContextMenuItems = Boolean(contextMenu?.hit?.paperTrack || contextMenu?.hit?.role === 'sound' || contextMenu?.hit?.role === 'camera' || timelineMemoContext || soundContext || cameraContext)
  const contextProcessMoveItemCount = contextProcessMove && contextProcessMoveOptions.length > 0 ? 1 + contextProcessMoveOptions.length : 0
  const timelineMemoItemCount = (contextMenu?.timelineMemoIds?.length ?? 0) * 2
  const sheetContextMenuItemCount = (timedRangeContext ? 10 : 15) + timelineMemoItemCount + contextProcessMoveItemCount
  const overlayPaperTrackMenuTrack = overlayPaperTrackMenu
    ? overlayTracks.find(track => track.paperTrack === overlayPaperTrackMenu.paperTrack) ?? null
    : null
  const hoverPreviewItems = !isCalibratingSheet && !props.suppressAssetPreview && hoveredHit ? cellAssetPreviewItemsForHit(props.project, hoveredHit) : []
  const hoverPreviewPosition = hoverPreviewAnchor && hoverPreviewItems.length > 0
    ? cellAssetPreviewPosition(hoverPreviewAnchor, hoverPreviewItems.length)
    : null
  const activeRange = draftRange
    ? rangeFromHits(draftRange.anchor, draftRange.focus)
    : props.rangeSelection
  const viewportClassName = [
    'sheetViewport',
    spacePanReady ? 'spacePanReady' : '',
    isPanning ? 'panning' : '',
    props.zoomMode ? 'zoomMode' : '',
  ].filter(Boolean).join(' ')

    return {
    props, draftRange, setDraftRange, hoveredHit, dropTargetPreview,
    textCursorBadge, contextMenu, paperTrackHeaderMenu, overlayPaperTrackMenu, stackGuideHeaderMenu, timedRangeLaneHeaderMenu, stackGuideInsertRequest,
    setStackGuideInsertRequest, stackGuideDropPreview, setStackGuideDropPreview, paperTrackEditor, setPaperTrackEditor, timelineLaneEditor, setTimelineLaneEditor, overlayTrackDrag,
    setOverlayTrackDrag, timelineEventDrag, setTimelineEventDrag, pendingTimelineEventDrag, soundCueDrag, hoveredSoundCueId, soundCueHoverAnchor,
    cameraCueDrag, hoveredCameraCueId, cameraCueHoverAnchor,
    activeOverlayPaperTrack, setActiveOverlayPaperTrack,
    draftCalibration, viewportRef, pageStackRef, sheetSvgRefs, zoom, isContinuousCanvas,
    displayDurationFrames, templateTrackNames, timelineLanes, sheetPageSize, sheetPageWidth, sheetPageHeight, frameOperationContext,
    overlayTracks, sheetRenderModelContext, referenceRenderModelContext, ...renderCaches,
    isCalibratingSheet, updateStackGuideDropPreview, clearHover,
    selectPaperTrackColumn, handlePointerDown, handleTimedRangeDoubleClick, timelineEventHitForPage, handleTimelineEventPointerDown, handleTimelineEventPointerMove, handleTimelineEventPointerUp,
    handleTimelineEventPointerCancel, calibrationPointsForPage, handleCalibrationHandlePointerDown, handlePointerMove, handleContextMenu, openSelectionContextMenu, runContextMenuAction,
    handleSoundCuePointerDown, handleSoundCuePointerMove, finishSoundCuePointer, handleSoundCueDoubleClick, handleSoundCuePointerEnter, handleSoundCuePointerLeave,
    handleCameraCuePointerDown, handleCameraCuePointerMove, finishCameraCuePointer, handleCameraCueDoubleClick, handleCameraCuePointerEnter, handleCameraCuePointerLeave,
    runPaperTrackHeaderMenuAction, runOverlayPaperTrackMenuAction, runStackGuideHeaderMenuAction, requestStackGuideInsert, openPaperTrackRenameEditor, openAddOverlayPaperTrackEditor,
    ...timelineLaneEditorActions,
    openOverlayPaperTrackEditor, openOverlayPaperTrackMenu, submitPaperTrackEditor, handlePointerUp, handleDrop, handleDragOver,
    handleViewportDragOver, handleViewportDragLeave, handleViewportDrop, handleViewportPointerDown, ...touchNavigation, contextProcessMove, contextProcessMoveOptions, canCopyContextRange,
    canPasteContextOverwrite, canPasteContextInsert, canPasteContextRepeatRange, canPasteContextRepeatToEnd, hasSheetContextMenuItems, sheetContextMenuItemCount,
    overlayPaperTrackMenuTrack, hoverPreviewItems, hoverPreviewPosition, activeRange, soundContext, cameraContext, timelineMemoContext, viewportClassName,
  }
}

export type SheetCanvasController = ReturnType<typeof useSheetCanvasController>
