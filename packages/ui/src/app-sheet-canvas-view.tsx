import { isRenderableSheetTemplateGridRegion, resolveCameraInstructionPoints, sheetAnnotationStrokes, sheetAnnotationTexts, timelineMemos, type SheetHit } from '@xsheet-remap/core';
import { useState, type ReactNode } from 'react'
import { uiText } from './i18n';
import { clampTextFontSizePx } from './sheetTextLayout';
import { getSheetPageImage } from './sheetImages';
import { rangeRectsForPage } from './sheetInteraction';
import { rangePaperTracks, sameSheetHitCell } from './timingEditing';
import { SheetSvgText } from './SheetSvgText';
import { SheetImageLayer } from './SheetTemplateLayers';
import { AutoCalibrationGuideOverlay, CalibrationQuadEditor, CellAssetPreview, GridOverlay, MetadataTextLayer, OverlayPaperTrackInteractionLayer, OverlayPaperTrackLayer, TemplateChrome, WorkRangeOverlay, calibrationGuideMetrics, eventRectsForPage, overlayColumnRectForPage, overlayRangeRectForPage, rectForHit, shouldSuppressRectUnderActiveOverlay, strokePath } from './app-sheet-layers';
import { AnnotationTextLayer } from './sheet-panel-annotation';
import { HoverCellOverlay, PaperTrackEditorPopover, StackGuideOverlay, StackGuideSvgLayer } from './app-stack-guides';
import { sheetContextMenuStyle } from './app-registered-cells';
import type { SheetCanvasController } from './app-sheet-canvas-controller'
import { AssetAssignedFrameCue, SelectedCellCue, SheetDropTargetCue, SheetRangeBoundaryCue, SheetRangeFillCue, mergeAdjacentRangeRects } from './sheet-selection-visuals'
import { SheetMetadataEditor } from './SheetMetadataEditor'
import { SoundCueLayer } from './SoundCueLayer'
import { CameraCueLayer } from './CameraCueLayer'
import { TimelineMemoLayer } from './TimelineMemoLayer'
import { SheetRevisionReferenceLayer } from './SheetRevisionReferenceLayer'
import { TimingEventSymbol } from './TimingEventSymbol'
import { continuationRenderItemsForPage, sheetContinuationPathData } from './sheetRenderModel'
import { isDirectAnnotationMode, resolveSheetInteractionOwner } from './sheetInteractionOwnership'
import { TimelineLaneEditorPopover } from './TimelineLaneEditorPopover'

function SheetPageSurface({
  interactionOwner,
  width,
  height,
  children,
}: {
  interactionOwner: string
  width: number
  height: number
  children: (host: HTMLDivElement | null) => ReactNode
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  return <div
    className="sheetPageSurface"
    data-sheet-interaction-owner={interactionOwner}
    style={{ width: `${width}px`, height: `${height}px` }}
    ref={setHost}
  >
    {children(host)}
  </div>
}

export function SheetCanvasView({ controller }: { controller: SheetCanvasController }) {
  const {
    props, draftStroke, setDraftStroke, draftRange, setDraftRange, hoveredHit, dropTargetPreview,
    textCursorBadge, contextMenu, paperTrackHeaderMenu, overlayPaperTrackMenu, stackGuideHeaderMenu, timedRangeLaneHeaderMenu, stackGuideInsertRequest,
    setStackGuideInsertRequest, stackGuideDropPreview, setStackGuideDropPreview, paperTrackEditor, setPaperTrackEditor, timelineLaneEditor, setTimelineLaneEditor, overlayTrackDrag,
    setOverlayTrackDrag, timelineEventDrag, setTimelineEventDrag, pendingTimelineEventDrag, soundCueDrag, hoveredSoundCueId, soundCueHoverAnchor,
    cameraCueDrag, hoveredCameraCueId, cameraCueHoverAnchor,
    activeOverlayPaperTrack, setActiveOverlayPaperTrack,
    draftCalibration, viewportRef, sheetSvgRefs, zoom, isContinuousCanvas,
    displayDurationFrames, officialFrameEnd, templateTrackNames, timelineLanes, sheetPageSize, sheetPageWidth, sheetPageHeight, frameOperationContext,
    overlayTracks, sheetRenderModelContext, referenceRenderModelContext, visiblePages, isCalibratingSheet, updateStackGuideDropPreview, clearHover,
    selectPaperTrackColumn, handlePointerDown, handleTimedRangeDoubleClick, timelineEventHitForPage, handleTimelineEventPointerDown, handleTimelineEventPointerMove, handleTimelineEventPointerUp,
    handleTimelineEventPointerCancel, calibrationPointsForPage, handleCalibrationHandlePointerDown, handlePointerMove, handleContextMenu, runContextMenuAction,
    handleSoundCuePointerDown, handleSoundCuePointerMove, finishSoundCuePointer, handleSoundCuePointerEnter, handleSoundCuePointerLeave,
    handleCameraCuePointerDown, handleCameraCuePointerMove, finishCameraCuePointer, handleCameraCuePointerEnter, handleCameraCuePointerLeave,
    runPaperTrackHeaderMenuAction, runOverlayPaperTrackMenuAction, runStackGuideHeaderMenuAction, runTimedRangeLaneHeaderMenuAction, requestStackGuideInsert, openPaperTrackRenameEditor, openAddOverlayPaperTrackEditor,
    openTimelineLaneEditor, submitTimelineLaneEditor,
    openOverlayPaperTrackEditor, openOverlayPaperTrackMenu, submitPaperTrackEditor, handlePointerUp, handleDrop, handleDragOver,
    handleViewportDragOver, handleViewportDragLeave, handleViewportDrop, handleViewportPointerDown, contextProcessMove, contextProcessMoveOptions, canCopyContextRange,
    canPasteContextOverwrite, canPasteContextInsert, canPasteContextRepeatRange, canPasteContextRepeatToEnd, hasSheetContextMenuItems, sheetContextMenuItemCount,
    overlayPaperTrackMenuTrack, hoverPreviewItems, hoverPreviewPosition, activeRange, soundContext, cameraContext, timelineMemoContext, viewportClassName,
  } = controller
  const hoveredSoundCue = props.project.timedRangeCues.find(cue => cue.cueId === hoveredSoundCueId) ?? null
  const soundCueHoverStyle = soundCueHoverAnchor ? {
    left: `${Math.max(8, Math.min(soundCueHoverAnchor.x + 14, (typeof window === 'undefined' ? 1024 : window.innerWidth) - 268))}px`,
    top: `${Math.max(8, Math.min(soundCueHoverAnchor.y + 14, (typeof window === 'undefined' ? 768 : window.innerHeight) - 180))}px`,
  } : undefined
  const hoveredCameraCue = props.project.timedRangeCues.find(cue => cue.cueId === hoveredCameraCueId) ?? null
  const hoveredCameraPoints = hoveredCameraCue
    ? resolveCameraInstructionPoints(hoveredCameraCue.camera, hoveredCameraCue.frameStart, hoveredCameraCue.frameEnd)
    : []
  const cameraCueHoverStyle = cameraCueHoverAnchor ? {
    left: `${Math.max(8, Math.min(cameraCueHoverAnchor.x + 14, (typeof window === 'undefined' ? 1024 : window.innerWidth) - 268))}px`,
    top: `${Math.max(8, Math.min(cameraCueHoverAnchor.y + 14, (typeof window === 'undefined' ? 768 : window.innerHeight) - 180))}px`,
  } : undefined
  const contextTimelineMemoIds = contextMenu?.timelineMemoIds ?? []
  const interactionOwner = resolveSheetInteractionOwner({
    editMode: props.editMode,
    selectedTimelineMemoId: props.selectedTimelineMemoId,
    editingTextAnnotationId: props.editingTextAnnotationId,
  })
  const pageAnnotationCaptureActive = interactionOwner === 'page-annotation'
  const semanticHotspotsBlocked = isDirectAnnotationMode(props.editMode)

  return (
    <div
      ref={viewportRef}
      className={viewportClassName}
      onPointerDown={handleViewportPointerDown}
      onDragOver={handleViewportDragOver}
      onDragLeave={handleViewportDragLeave}
      onDrop={event => void handleViewportDrop(event)}
    >
      <div className={`sheetPageStack ${props.sheetView.viewMode}`}>
        {visiblePages.map(page => {
          const isCalibrating = isCalibratingSheet
          const pageImage = getSheetPageImage(props.sheetView, props.runtimeSourceImageUrls, page.pageId, props.template)
          const strokes = !isCalibrating && props.showAnnotations
            ? sheetAnnotationStrokes(props.project).filter(annotation => annotation.pageId === page.pageId && annotation.tool === 'pen')
            : []
          const textAnnotations = !isCalibrating && props.showAnnotations
            ? sheetAnnotationTexts(props.project).filter(annotation => annotation.pageId === page.pageId)
            : []
          const activeOverlayTrack = !isCalibrating && activeOverlayPaperTrack
            ? props.project.logicalSheet.paperTracks.find(track => track.paperTrack === activeOverlayPaperTrack && track.source === 'overlay')
            : undefined
          const activeOverlayColumn = activeOverlayTrack ? overlayColumnRectForPage(props.template, props.project, activeOverlayTrack, page) : null
          const eventRects = isCalibrating ? [] : eventRectsForPage(props.project, props.template, page, { activeOverlayPaperTrack })
          const continuationItems = isCalibrating ? [] : continuationRenderItemsForPage(sheetRenderModelContext, page)
          const candidateRects = isCalibrating
            ? []
            : props.recognitionCandidates.filter(candidate => {
                if (candidate.pageId !== page.pageId) return false
                const candidateTrack = props.project.logicalSheet.paperTracks.find(track => track.paperTrack === candidate.paperTrack)
                return !shouldSuppressRectUnderActiveOverlay(candidateTrack, candidate.bbox, activeOverlayColumn)
              })
          const calibrationPoints = calibrationPointsForPage(page, pageImage.settings)
          const calibrationMetrics = calibrationGuideMetrics(props.template, sheetPageSize)
          const calibrationDebugOverlay = isCalibrating && props.autoCalibrationOverlay?.pageId === page.pageId
            ? props.autoCalibrationOverlay
            : null
          const showTemplateLines = props.showTemplateGuides && !isCalibrating
          const showTemplateLabels = props.showTemplateLabels && !isCalibrating
          const showInputContent = props.showInputContent && !isCalibrating
          const displayImageSettings = { ...pageImage.settings, calibration: { ...(pageImage.settings.calibration ?? { enabled: false }), points: calibrationPoints } }
          const hoverMatchesSelection = Boolean(hoveredHit && props.selectedHit && sameSheetHitCell(hoveredHit, props.selectedHit))
          const rawHoverRect = !isCalibrating && !hoverMatchesSelection && hoveredHit?.pageId === page.pageId ? rectForHit(props.project, props.template, hoveredHit) : null
          const hoverTrack = hoveredHit?.paperTrack ? props.project.logicalSheet.paperTracks.find(track => track.paperTrack === hoveredHit.paperTrack) : undefined
          const hoverRect = rawHoverRect && !shouldSuppressRectUnderActiveOverlay(hoverTrack, rawHoverRect, activeOverlayColumn) ? rawHoverRect : null
          const rawDropTargetRect = !isCalibrating && dropTargetPreview?.hit.pageId === page.pageId
            ? rectForHit(props.project, props.template, dropTargetPreview.hit)
            : null
          const dropTargetTrack = dropTargetPreview?.hit.paperTrack
            ? props.project.logicalSheet.paperTracks.find(track => track.paperTrack === dropTargetPreview.hit.paperTrack)
            : undefined
          const dropTargetRect = rawDropTargetRect && !shouldSuppressRectUnderActiveOverlay(dropTargetTrack, rawDropTargetRect, activeOverlayColumn)
            ? rawDropTargetRect
            : null
          const rawSelectedRect = !isCalibrating && props.selectedHit?.pageId === page.pageId ? rectForHit(props.project, props.template, props.selectedHit) : null
          const selectedTrack = props.selectedHit?.paperTrack ? props.project.logicalSheet.paperTracks.find(track => track.paperTrack === props.selectedHit?.paperTrack) : undefined
          const selectedRect = rawSelectedRect && !shouldSuppressRectUnderActiveOverlay(selectedTrack, rawSelectedRect, activeOverlayColumn) ? rawSelectedRect : null
          const normalRangeRects = !isCalibrating && activeRange
            ? rangeRectsForPage(props.template, activeRange, page, templateTrackNames)
                .filter(rect => !shouldSuppressRectUnderActiveOverlay(undefined, rect, activeOverlayColumn))
            : []
          const overlayRangeRects = !isCalibrating && activeRange
            ? rangePaperTracks(activeRange).flatMap(paperTrack => {
                const track = props.project.logicalSheet.paperTracks.find(item => item.paperTrack === paperTrack)
                return track?.source === 'overlay'
                  ? overlayRangeRectForPage(props.template, props.project, track, activeRange.frameStart, activeRange.frameEnd, page) ?? []
                  : []
              })
            : []
          const rangeRects = [...normalRangeRects, ...overlayRangeRects]
          const rangeBoundaryRects = mergeAdjacentRangeRects(rangeRects)
          const selectionSurface = { widthPx: sheetPageWidth, heightPx: sheetPageHeight }
          const soundCues = props.project.timedRangeCues
            .filter(cue => cue.role === 'sound')
            .map(cue => soundCueDrag?.origin.cueId === cue.cueId ? soundCueDrag.preview : cue)
          const cameraCues = props.project.timedRangeCues
            .filter(cue => cue.role === 'camera')
            .map(cue => cameraCueDrag?.origin.cueId === cue.cueId ? cameraCueDrag.preview : cue)

          const pageAccessibleLabel = isContinuousCanvas
            ? uiText.sheet.surfaceCaption(page.frameStart, page.frameEnd)
            : uiText.sheet.pageCaption(page.pageIndex + 1, page.frameStart, page.frameEnd)

          return (
            <figure
              key={page.pageId}
              className={page.pageIndex === props.activePageIndex ? 'sheetPage active' : 'sheetPage'}
              aria-label={pageAccessibleLabel}
            >
              <SheetPageSurface interactionOwner={interactionOwner} width={sheetPageWidth} height={sheetPageHeight}>
                {editorHost => <>
                <svg
                  viewBox="0 0 1 1"
                  preserveAspectRatio="none"
                  className={[
                    'sheetSvg',
                    draftCalibration?.pageId === page.pageId ? 'calibrationDragging' : '',
                    props.editMode === 'text' && interactionOwner !== 'timeline-memo' ? 'textAnnotationMode' : '',
                    props.editMode === 'text' && pageAnnotationCaptureActive && !props.editingTextAnnotationId ? 'textAnnotationPlacementMode' : '',
                  ].filter(Boolean).join(' ')}
                  data-page-id={page.pageId}
                  ref={element => {
                    if (element) {
                      sheetSvgRefs.current[page.pageId] = element
                    } else {
                      delete sheetSvgRefs.current[page.pageId]
                    }
                  }}
                  style={{ width: `${sheetPageWidth}px`, height: `${sheetPageHeight}px` }}
                  onPointerDown={event => handlePointerDown(event, page)}
                  onDoubleClick={event => handleTimedRangeDoubleClick(event, page)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={() => {
                    setDraftStroke(null)
                    setDraftRange(null)
                    setTimelineEventDrag(null)
                    props.onStatusHint('sheet-drag', null)
                    clearHover()
                  }}
                  onPointerLeave={clearHover}
                  onDragOver={event => handleDragOver(event, page)}
                  onDrop={event => void handleDrop(event, page)}
                  onDragStart={event => event.preventDefault()}
                  onContextMenu={event => handleContextMenu(event, page)}
                  aria-label={isContinuousCanvas ? uiText.sheet.canvasSurfaceLabel : page.pageIndex === 0 ? uiText.sheet.canvasLabel : uiText.sheet.canvasPageLabel(page.pageIndex + 1)}
                >
                  <rect x="0" y="0" width="1" height="1" fill="#f7f7f4" />
                  {props.showTemplate && pageImage.imageUrl && (
                    <SheetImageLayer
                      imageUrl={pageImage.imageUrl}
                      imageSettings={displayImageSettings}
                      template={props.template}
                      forceRaw={isCalibrating}
                      preview
                    />
                  )}
                  {(showTemplateLines || showTemplateLabels) && <TemplateChrome template={props.template} paperTracks={templateTrackNames} timelineLanes={timelineLanes} durationFrames={displayDurationFrames} layoutOverrides={props.project.sheetView.layoutOverrides} showLines={showTemplateLines} showLabels={showTemplateLabels} />}
                  {(showTemplateLines || showTemplateLabels) && props.template.regions.filter(isRenderableSheetTemplateGridRegion).map(region => (
                    <GridOverlay key={region.regionId} template={props.template} region={region} paperTracks={templateTrackNames} timelineLanes={timelineLanes} durationFrames={page.frameEnd - page.frameStart + 1} frameOrigin={isContinuousCanvas ? page.frameStart : props.template.defaults.frameOrigin} pageFrameStart={page.frameStart} layoutOverrides={props.project.sheetView.layoutOverrides} showLines={showTemplateLines} showLabels={showTemplateLabels} />
                  ))}
                  {showInputContent && props.referenceProject && referenceRenderModelContext && (
                    <SheetRevisionReferenceLayer
                      project={props.referenceProject}
                      template={props.template}
                      page={page}
                      paperTracks={templateTrackNames}
                      pageSize={sheetPageSize}
                      surface={selectionSurface}
                      context={referenceRenderModelContext}
                      opacity={props.referenceOpacity}
                    />
                  )}
                  {showInputContent && <MetadataTextLayer context={sheetRenderModelContext} page={page} />}
                  {showInputContent && continuationItems.map(item => (
                    <path
                      key={`${item.eventId}:${item.paperTrack}:${item.path[0]?.x}:${item.path[0]?.y}`}
                      className={`timingContinuationLine timingContinuation${item.kind === 'wave' ? 'Wave' : 'Straight'}`}
                      d={sheetContinuationPathData(item.path)}
                      strokeWidth={item.strokeWidth}
                    />
                  ))}
                  {candidateRects.map(candidate => (
                    <rect
                      key={candidate.candidateId}
                      className="candidateRect"
                      x={candidate.bbox.x}
                      y={candidate.bbox.y}
                      width={candidate.bbox.w}
                      height={candidate.bbox.h}
                    />
                  ))}
                  {showTemplateLines && (
                    <WorkRangeOverlay
                      template={props.template}
                      page={page}
                      displayDurationFrames={displayDurationFrames}
                      officialFrameStart={props.project.logicalSheet.frameOrigin}
                      officialFrameEnd={officialFrameEnd}
                    />
                  )}
                  {!isCalibrating && overlayTracks.length > 0 && (
                    <OverlayPaperTrackLayer
                      project={props.project}
                      template={props.template}
                      page={page}
                      tracks={overlayTracks}
                      activePaperTrack={activeOverlayPaperTrack}
                      drag={overlayTrackDrag?.pageId === page.pageId ? overlayTrackDrag : null}
                    />
                  )}
                  {rangeRects.map((rect, index) => (
                    <SheetRangeFillCue
                      key={`${index}-${rect.x}-${rect.y}`}
                      rect={rect}
                      draft={Boolean(draftRange)}
                    />
                  ))}
                  {rangeBoundaryRects.map((rect, index) => (
                    <SheetRangeBoundaryCue
                      key={`boundary-${index}-${rect.x}-${rect.y}`}
                      rect={rect}
                      draft={Boolean(draftRange)}
                      surface={selectionSurface}
                    />
                  ))}
                  {showInputContent && (
                    <SoundCueLayer
                      cues={soundCues}
                      template={props.template}
                      page={page}
                      paperTracks={templateTrackNames}
                      timelineLanes={timelineLanes}
                      layoutOverrides={props.project.sheetView.layoutOverrides}
                      pageSize={sheetPageSize}
                      surface={selectionSurface}
                      selectedCueId={props.selectedSoundCueId}
                      onPointerDown={handleSoundCuePointerDown}
                      onPointerMove={handleSoundCuePointerMove}
                      onPointerUp={event => finishSoundCuePointer(event)}
                      onPointerCancel={event => finishSoundCuePointer(event, true)}
                      onDoubleClick={props.onSoundCueEdit}
                      onPointerEnter={handleSoundCuePointerEnter}
                      onPointerLeave={handleSoundCuePointerLeave}
                    />
                  )}
                  {showInputContent && (
                    <CameraCueLayer
                      cues={cameraCues}
                      template={props.template}
                      page={page}
                      paperTracks={templateTrackNames}
                      timelineLanes={timelineLanes}
                      layoutOverrides={props.project.sheetView.layoutOverrides}
                      pageSize={sheetPageSize}
                      surface={selectionSurface}
                      selectedCueId={props.selectedCameraCueId}
                      draggingCueId={cameraCueDrag?.origin.cueId ?? null}
                      onPointerDown={handleCameraCuePointerDown}
                      onPointerMove={handleCameraCuePointerMove}
                      onPointerUp={event => finishCameraCuePointer(event)}
                      onPointerCancel={event => finishCameraCuePointer(event, true)}
                      onDoubleClick={props.onCameraCueEdit}
                      onPointerEnter={handleCameraCuePointerEnter}
                      onPointerLeave={handleCameraCuePointerLeave}
                    />
                  )}
                  {calibrationDebugOverlay && (
                    <AutoCalibrationGuideOverlay
                      overlay={calibrationDebugOverlay}
                      imageSettings={pageImage.settings}
                    />
                  )}
                  {isCalibrating && (
                    <CalibrationQuadEditor
                      points={calibrationPoints}
                      imageSettings={pageImage.settings}
                      metrics={calibrationMetrics}
                      onHandlePointerDown={(event, index, kind) => handleCalibrationHandlePointerDown(event, page, pageImage.settings, index, kind)}
                    />
                  )}
                  {showInputContent && eventRects.map(({ event, eventKind, displayLabel, rect, hasAssetBinding, fontSizePx }) => {
                    const eventHit = timelineEventHitForPage(event, page)
                    const isDraggingEvent = Boolean(timelineEventDrag && sameSheetHitCell(timelineEventDrag.sourceHit, eventHit))
                    const pendingEventDrag = pendingTimelineEventDrag && sameSheetHitCell(pendingTimelineEventDrag.sourceHit, eventHit)
                      ? pendingTimelineEventDrag
                      : null
                    const timelineEventClassName = [
                      isDraggingEvent ? 'timelineEventDragSource' : 'timelineEventHandle',
                      pendingEventDrag ? 'timelineEventDragPending' : '',
                      pendingEventDrag?.ready ? 'timelineEventDragReady' : '',
                    ].filter(Boolean).join(' ')
                    return (
                      <g
                        key={event.eventId}
                        className={timelineEventClassName}
                        onPointerDown={eventHit ? pointerEvent => handleTimelineEventPointerDown(pointerEvent, event, page) : undefined}
                        onPointerMove={handleTimelineEventPointerMove}
                        onPointerUp={handleTimelineEventPointerUp}
                        onPointerCancel={handleTimelineEventPointerCancel}
                      >
                        <rect className={hasAssetBinding ? 'eventRect assetAssignedEventRect' : 'eventRect'} x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx="0.002" />
                        {hasAssetBinding && <AssetAssignedFrameCue rect={rect} surface={selectionSurface} />}
                        {eventKind === 'cell' && displayLabel.trim()
                          && (
                            <SheetSvgText
                              className="eventText"
                              x={rect.x + rect.w / 2}
                              y={rect.y + rect.h / 2}
                              textAnchor="middle"
                              dominantBaseline="central"
                              alignmentBaseline="central"
                              fontSizePx={clampTextFontSizePx(fontSizePx)}
                              pageSize={sheetPageSize}
                            >
                              {displayLabel}
                            </SheetSvgText>
                        )}
                        {eventKind !== 'cell' && <TimingEventSymbol kind={eventKind} rect={rect} />}
                      </g>
                    )
                  })}
                  {!isCalibrating && (
                    <StackGuideSvgLayer
                      project={props.project}
                      template={props.template}
                      page={page}
                      dropPreview={stackGuideDropPreview?.pageId === page.pageId ? stackGuideDropPreview : null}
                      onUpdateLabel={props.onUpdateStackGuideLabel}
                      onPreviewPlacement={(labelId, clientX, clientY) => {
                        updateStackGuideDropPreview(labelId, clientX, clientY)
                      }}
                      onClearPreview={() => setStackGuideDropPreview(null)}
                    />
                  )}
                  {!isCalibrating && props.showAnnotations && (
                    <TimelineMemoLayer
                      memos={timelineMemos(props.project)}
                      template={props.template}
                      page={page}
                      paperTracks={templateTrackNames}
                      layoutOverrides={props.project.sheetView.layoutOverrides}
                      pageSize={sheetPageSize}
                      surface={selectionSurface}
                      selectedMemoId={props.selectedTimelineMemoId}
                      editMode={props.editMode}
                      penColor={props.penColor}
                      penWidth={props.penWidth}
                      eraserWidth={props.eraserWidth}
                      textFontSizePx={props.textFontSizePx}
                      zoom={props.zoom}
                      editorHost={editorHost}
                      onAppendStroke={props.onAppendTimelineMemoStroke}
                      onEraseStroke={props.onEraseTimelineMemoStroke}
                      onUpsertText={props.onUpsertTimelineMemoText}
                      onUpdatePlacement={props.onUpdateTimelineMemoPlacement}
                    />
                  )}
                  {strokes.map(stroke => (
                    <path
                      key={stroke.annotationId}
                      className={stroke.tool === 'eraser' ? 'annotationStroke annotationEraserPreview' : 'annotationStroke'}
                      d={strokePath(stroke)}
                      stroke={stroke.color}
                      strokeWidth={stroke.width}
                      data-annotation-region-id={stroke.anchor?.kind === 'view-surface' ? stroke.anchor.regionId : undefined}
                      data-annotation-target-id={stroke.anchor?.kind === 'view-surface' ? stroke.anchor.targetId : undefined}
                    />
                  ))}
                  {selectedRect && props.timingDraftActive && (
                    <g className="timingDraftOverlay" aria-label={`入力中: ${props.timingDraftValue}`}>
                      <rect className="timingDraftRect" x={selectedRect.x} y={selectedRect.y} width={selectedRect.w} height={selectedRect.h} />
                      {props.timingDraftValue && (
                        <SheetSvgText
                          className="timingDraftText"
                          x={selectedRect.x + selectedRect.w / 2}
                          y={selectedRect.y + selectedRect.h / 2}
                          textAnchor="middle"
                          dominantBaseline="central"
                          alignmentBaseline="central"
                          fontSizePx={clampTextFontSizePx(props.textFontSizePx)}
                          pageSize={sheetPageSize}
                        >
                          {props.timingDraftValue}
                        </SheetSvgText>
                      )}
                    </g>
                  )}
                  {selectedRect && <SelectedCellCue rect={selectedRect} surface={selectionSurface} />}
                  {dropTargetRect && dropTargetPreview && (
                    <SheetDropTargetCue rect={dropTargetRect} surface={selectionSurface} validity={dropTargetPreview.validity} />
                  )}
                </svg>
                {!isCalibrating && textAnnotations.length > 0 && (
                  <AnnotationTextLayer
                    annotations={textAnnotations}
                    selectedAnnotationId={props.selectedTextAnnotationId}
                    editingAnnotationId={props.editingTextAnnotationId}
                    inputBlocked={semanticHotspotsBlocked && interactionOwner !== 'page-text-editor'}
                    pageSize={sheetPageSize}
                    zoom={zoom}
                    onSelect={props.onSelectTextAnnotation}
                    onEdit={props.onEditTextAnnotation}
                    onUpdate={props.onUpdateTextAnnotation}
                    onCommit={props.onCommitTextAnnotation}
                    onCancel={props.onCancelTextAnnotation}
                  />
                )}
                {!isCalibrating && (
                  <SheetMetadataEditor
                    project={props.project}
                    template={props.template}
                    page={page}
                    pageWidth={sheetPageWidth}
                    pageHeight={sheetPageHeight}
                    displayDurationFrames={displayDurationFrames}
                    paperTracks={templateTrackNames}
                    interactionBlocked={semanticHotspotsBlocked}
                    selectedAnnotationTarget={props.pageAnnotationTarget.kind === 'template-region'
                      && props.pageAnnotationTarget.pageId === page.pageId
                      && props.pageAnnotationTarget.regionId
                      ? { regionId: props.pageAnnotationTarget.regionId, targetId: props.pageAnnotationTarget.targetId }
                      : null}
                    onMetadataChange={props.onMetadataChange}
                    onDurationChange={props.onDurationChange}
                    onFormFieldChange={props.onFormFieldChange}
                    onAnnotationRegionSelect={props.onSelectTemplateRegionAnnotationTarget}
                  />
                )}
                {!isCalibrating && pageAnnotationCaptureActive && (
                  <svg
                    viewBox="0 0 1 1"
                    preserveAspectRatio="none"
                    className="pageAnnotationInputSurface"
                    data-page-id={page.pageId}
                    data-annotation-tool={props.editMode}
                    style={{ width: `${sheetPageWidth}px`, height: `${sheetPageHeight}px` }}
                    onPointerDown={event => handlePointerDown(event, page)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={() => {
                      setDraftStroke(null)
                      setDraftRange(null)
                      setTimelineEventDrag(null)
                      props.onStatusHint('sheet-drag', null)
                      clearHover()
                    }}
                    onPointerLeave={clearHover}
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
                )}
                {props.editMode === 'text' && pageAnnotationCaptureActive && !props.editingTextAnnotationId && textCursorBadge?.pageId === page.pageId && (
                  <div
                    className="textCursorBadge"
                    style={{ left: `${textCursorBadge.x}px`, top: `${textCursorBadge.y}px` }}
                    aria-hidden="true"
                  >
                    T+
                  </div>
                )}
                {!isCalibrating && (
                    <StackGuideOverlay
                      project={props.project}
                      template={props.template}
                      page={page}
                      pageWidth={sheetPageWidth}
                      pageHeight={sheetPageHeight}
                      insertRequest={stackGuideInsertRequest?.pageId === page.pageId ? stackGuideInsertRequest : null}
                      insertTool={page.pageIndex === props.activePageIndex ? props.stackGuideInsertTool : null}
                      dropPreview={stackGuideDropPreview?.pageId === page.pageId ? stackGuideDropPreview : null}
                      onInsertRequestConsumed={() => setStackGuideInsertRequest(null)}
                      onInsertToolConsumed={props.onStackGuideInsertToolConsumed}
                      onCreate={props.onCreateStackGuideLabel}
                      onCreateOverlayPaperTrack={openAddOverlayPaperTrackEditor}
                      onUpdateLabel={props.onUpdateStackGuideLabel}
                      onPreviewPlacement={(labelId, clientX, clientY) => {
                        updateStackGuideDropPreview(labelId, clientX, clientY)
                      }}
                      onClearPreview={() => setStackGuideDropPreview(null)}
                    />
                )}
                {!isCalibrating && overlayTracks.length > 0 && (
                  <OverlayPaperTrackInteractionLayer
                    project={props.project}
                    template={props.template}
                    page={page}
                    tracks={overlayTracks}
                    pageWidth={sheetPageWidth}
                    pageHeight={sheetPageHeight}
                    activePaperTrack={activeOverlayPaperTrack}
                    drag={overlayTrackDrag}
                    onActivePaperTrackChange={nextTrack => {
                      setActiveOverlayPaperTrack(nextTrack)
                      if (!nextTrack || props.selectedHit?.paperTrack !== nextTrack) props.onClearSelection()
                    }}
                    onOpenPaperTrackMenu={(track, position) => openOverlayPaperTrackMenu(track, position)}
                    onDragChange={setOverlayTrackDrag}
                    onStatusHint={props.onStatusHint}
                    onUpdatePaperTrack={props.onUpdatePaperTrack}
                  />
                )}
                {hoverRect && <HoverCellOverlay rect={hoverRect} />}
                </>}
              </SheetPageSurface>
            </figure>
          )
        })}
      </div>
      {hoveredSoundCue && soundCueHoverStyle && !soundCueDrag && (
        <div className="soundCueHoverCard" style={soundCueHoverStyle} role="tooltip">
          <strong>{hoveredSoundCue.label}</strong>
          <span>{hoveredSoundCue.frameStart}–{hoveredSoundCue.frameEnd}F</span>
          {hoveredSoundCue.text && <p>{hoveredSoundCue.text}</p>}
        </div>
      )}
      {hoveredCameraCue && cameraCueHoverStyle && !cameraCueDrag && (
        <div className="soundCueHoverCard" style={cameraCueHoverStyle} role="tooltip">
          <strong>{hoveredCameraCue.label}</strong>
          <span>{hoveredCameraCue.frameStart}–{hoveredCameraCue.frameEnd}F / {hoveredCameraCue.camera?.shape ?? 'range'}</span>
          {hoveredCameraPoints.length > 0 && <span>{hoveredCameraPoints.map(point => point.label).join(' → ')}</span>}
        </div>
      )}
      {hoverPreviewPosition && <CellAssetPreview position={hoverPreviewPosition} items={hoverPreviewItems} />}
      {contextMenu && hasSheetContextMenuItems && (
        <div
          className="sheetContextMenu"
          style={sheetContextMenuStyle(contextMenu.x, contextMenu.y, sheetContextMenuItemCount)}
          role="menu"
          onPointerDown={event => event.stopPropagation()}
          onContextMenu={event => event.preventDefault()}
        >
          {timelineMemoContext && (
            <>
              <div className="sheetContextMenuTitle">メモ</div>
              {contextTimelineMemoIds.flatMap((memoId, index) => {
                const suffix = contextTimelineMemoIds.length > 1 ? ` ${index + 1}` : ''
                return [
                  <button key={`${memoId}:edit`} role="menuitem" onClick={() => runContextMenuAction(() => props.onSelectTimelineMemo(memoId))}>メモ{suffix}を編集</button>,
                  <button key={`${memoId}:delete`} role="menuitem" onClick={() => runContextMenuAction(() => props.onDeleteTimelineMemo(memoId))}>メモ{suffix}を削除</button>,
                ]
              })}
            </>
          )}
          {timelineMemoContext && <div className="sheetContextMenuTitle">背面のシート操作</div>}
          {soundContext ? (
            <>
              <button role="menuitem" disabled={!canCopyContextRange} onClick={() => runContextMenuAction(props.onCopySoundCues)}>{uiText.actions.copyRange}</button>
              <button role="menuitem" disabled={!canCopyContextRange} onClick={() => runContextMenuAction(props.onCutSoundCues)}>{uiText.actions.cutRange}</button>
              <button role="menuitem" disabled={!props.soundCueClipboard} onClick={() => runContextMenuAction(() => props.onPasteSoundCues('overwrite'))}>{uiText.actions.pasteOverwrite}</button>
              <button role="menuitem" disabled={!props.soundCueClipboard} onClick={() => runContextMenuAction(() => props.onPasteSoundCues('insert'))}>{uiText.actions.pasteInsert}</button>
              <button role="menuitem" onClick={() => runContextMenuAction(() => props.selectedSoundCueId
                ? props.onSoundCueEdit(props.selectedSoundCueId)
                : props.rangeSelection?.role === 'sound' ? props.onSoundRangeEdit(props.rangeSelection) : undefined)}>区間を編集</button>
              <button role="menuitem" onClick={() => runContextMenuAction(props.onDeleteSoundCues)}>区間を削除</button>
            </>
          ) : cameraContext ? (
            <>
              <button role="menuitem" disabled={!canCopyContextRange} onClick={() => runContextMenuAction(props.onCopyCameraCues)}>{uiText.actions.copyRange}</button>
              <button role="menuitem" disabled={!canCopyContextRange} onClick={() => runContextMenuAction(props.onCutCameraCues)}>{uiText.actions.cutRange}</button>
              <button role="menuitem" disabled={!props.cameraCueClipboard} onClick={() => runContextMenuAction(() => props.onPasteCameraCues('overwrite'))}>{uiText.actions.pasteOverwrite}</button>
              <button role="menuitem" disabled={!props.cameraCueClipboard} onClick={() => runContextMenuAction(() => props.onPasteCameraCues('insert'))}>{uiText.actions.pasteInsert}</button>
              <button role="menuitem" onClick={() => runContextMenuAction(() => props.selectedCameraCueId
                ? props.onCameraCueEdit(props.selectedCameraCueId)
                : props.rangeSelection?.role === 'camera' ? props.onCameraRangeEdit(props.rangeSelection) : undefined)}>撮影指示を編集</button>
              <button role="menuitem" onClick={() => runContextMenuAction(props.onDeleteCameraCues)}>撮影指示を削除</button>
            </>
          ) : (
            <>
              <button role="menuitem" disabled={!canCopyContextRange} onClick={() => runContextMenuAction(props.onCopyRange)}>{uiText.actions.copyRange}</button>
              <button role="menuitem" disabled={!canCopyContextRange} onClick={() => runContextMenuAction(props.onCutRange)}>{uiText.actions.cutRange}</button>
              <button role="menuitem" disabled={!canCopyContextRange} onClick={() => runContextMenuAction(props.onCutRangeRipple)}>{uiText.actions.cutRangeRipple}</button>
              <button role="menuitem" disabled={!canPasteContextOverwrite} onClick={() => runContextMenuAction(() => props.onPasteTiming('overwrite'))}>{uiText.actions.pasteOverwrite}</button>
              <button role="menuitem" disabled={!canPasteContextInsert} onClick={() => runContextMenuAction(() => props.onPasteTiming('insert'))}>{uiText.actions.pasteInsert}</button>
              <button role="menuitem" disabled={!canPasteContextRepeatRange} onClick={() => runContextMenuAction(() => props.onPasteTiming('repeat-range'))}>{uiText.actions.repeatPaste}</button>
              <button role="menuitem" disabled={!canPasteContextRepeatToEnd} onClick={() => runContextMenuAction(() => props.onPasteTiming('repeat-to-end'))}>{uiText.actions.repeatPasteToEnd}</button>
              <button role="menuitem" onClick={() => runContextMenuAction(() => props.onSetNullAtHit(contextMenu.hit as SheetHit))}>{uiText.actions.setNullCell}</button>
              <button role="menuitem" onClick={() => runContextMenuAction(() => props.onSetTimingSpecialAtHit(contextMenu.hit as SheetHit, 'inbetween'))}>{uiText.actions.setInbetween}</button>
              <button role="menuitem" onClick={() => runContextMenuAction(() => props.onSetTimingSpecialAtHit(contextMenu.hit as SheetHit, 'reverse'))}>{uiText.actions.setReverseSheet}</button>
              <button role="menuitem" onClick={() => runContextMenuAction(() => props.onDeleteEventAtHit(contextMenu.hit as SheetHit))}>{uiText.actions.deleteEvent}</button>
            </>
          )}
          {!timelineMemoContext && contextMenu.hit && (
            <>
              <div className="sheetContextMenuTitle">メモ</div>
              <button role="menuitem" onClick={() => runContextMenuAction(() => props.onCreateTimelineMemo(contextMenu.hit as SheetHit))}>メモを追加</button>
            </>
          )}
          {frameOperationContext && (
            <>
              <div className="sheetContextMenuTitle">{uiText.frameOperation.title}</div>
              <button role="menuitem" onClick={() => runContextMenuAction(() => props.onOpenFrameOperation('insert', contextMenu.hit as SheetHit))}>{uiText.frameOperation.insert}</button>
              <button role="menuitem" onClick={() => runContextMenuAction(() => props.onOpenFrameOperation('delete', contextMenu.hit as SheetHit))}>{uiText.frameOperation.delete}</button>
            </>
          )}
          {contextProcessMove && contextProcessMoveOptions.length > 0 && (
            <>
              <div className="sheetContextMenuTitle">{uiText.processMove.title}</div>
              {contextProcessMoveOptions.map(({ layer, existingTargetBinding }) => (
                <button
                  key={layer.layerId}
                  role="menuitem"
                  onClick={() => runContextMenuAction(() => props.onMoveKeyBindingProcess(contextProcessMove.binding.keyId, contextProcessMove.binding.slotId, layer.layerId))}
                >
                  {existingTargetBinding ? uiText.processMove.moveToOccupied(layer.label) : uiText.processMove.moveTo(layer.label)}
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {paperTrackHeaderMenu && (
        <div
          className="sheetContextMenu"
          style={sheetContextMenuStyle(paperTrackHeaderMenu.x, paperTrackHeaderMenu.y, 2)}
          role="menu"
          onPointerDown={event => event.stopPropagation()}
          onContextMenu={event => event.preventDefault()}
        >
          <button
            role="menuitem"
            onClick={() => runPaperTrackHeaderMenuAction(() => selectPaperTrackColumn(paperTrackHeaderMenu.hit))}
          >
            {uiText.actions.selectPaperTrackColumn}
          </button>
          <button
            role="menuitem"
            onClick={() => runPaperTrackHeaderMenuAction(() => openPaperTrackRenameEditor(paperTrackHeaderMenu.hit.paperTrack ?? '', {
              x: paperTrackHeaderMenu.x,
              y: paperTrackHeaderMenu.y,
              sheetRole: paperTrackHeaderMenu.sheetRole,
              snapIndex: paperTrackHeaderMenu.snapIndex,
            }))}
          >
            {uiText.actions.renamePaperTrack}
          </button>
        </div>
      )}
      {overlayPaperTrackMenu && overlayPaperTrackMenuTrack && (
        <div
          className="sheetContextMenu"
          style={sheetContextMenuStyle(overlayPaperTrackMenu.x, overlayPaperTrackMenu.y, 2)}
          role="menu"
          onPointerDown={event => event.stopPropagation()}
          onContextMenu={event => event.preventDefault()}
        >
          <button
            role="menuitem"
            onClick={() => runOverlayPaperTrackMenuAction(() => openOverlayPaperTrackEditor(overlayPaperTrackMenuTrack, {
              x: overlayPaperTrackMenu.x,
              y: overlayPaperTrackMenu.y,
            }))}
          >
            {uiText.actions.renamePaperTrack}
          </button>
          <button
            role="menuitem"
            onClick={() => runOverlayPaperTrackMenuAction(() => props.onDeleteOverlayPaperTrack(overlayPaperTrackMenu.paperTrack))}
          >
            {uiText.actions.deleteOverlayPaperTrack}
          </button>
        </div>
      )}
      {stackGuideHeaderMenu && (
        <div
          className="sheetContextMenu"
          style={sheetContextMenuStyle(stackGuideHeaderMenu.x, stackGuideHeaderMenu.y, 2)}
          role="menu"
          aria-label={uiText.stackGuides.insertMenuLabel}
          onPointerDown={event => event.stopPropagation()}
          onContextMenu={event => event.preventDefault()}
        >
          <button
            role="menuitem"
            onClick={() => runStackGuideHeaderMenuAction(() => requestStackGuideInsert(stackGuideHeaderMenu, 'label-editor'))}
          >
            {uiText.stackGuides.add}
          </button>
          <button
            role="menuitem"
            onClick={() => runStackGuideHeaderMenuAction(() => requestStackGuideInsert(stackGuideHeaderMenu, 'overlay-track'))}
          >
            {uiText.stackGuides.addOverlayTrack}
          </button>
        </div>
      )}
      {timedRangeLaneHeaderMenu && (
        <div
          className="sheetContextMenu"
          style={sheetContextMenuStyle(timedRangeLaneHeaderMenu.x, timedRangeLaneHeaderMenu.y, 3)}
          role="menu"
          aria-label={`${timedRangeLaneHeaderMenu.role === 'sound' ? 'SOUND' : 'CAMERA'}列の操作`}
          onPointerDown={event => event.stopPropagation()}
          onContextMenu={event => event.preventDefault()}
        >
          <div className="sheetContextMenuTitle">{timedRangeLaneHeaderMenu.label}</div>
          <button
            role="menuitem"
            onClick={() => runTimedRangeLaneHeaderMenuAction(() => openTimelineLaneEditor(timedRangeLaneHeaderMenu, 'add'))}
          >
            {timedRangeLaneHeaderMenu.role === 'sound' ? 'SOUND列を追加' : 'CAMERA列を追加'}
          </button>
          <button
            role="menuitem"
            onClick={() => runTimedRangeLaneHeaderMenuAction(() => openTimelineLaneEditor(timedRangeLaneHeaderMenu, 'rename'))}
          >
            列名を変更
          </button>
          <button
            role="menuitem"
            disabled={(timelineLanes[timedRangeLaneHeaderMenu.role]?.length ?? 0) <= 1}
            onClick={() => runTimedRangeLaneHeaderMenuAction(() => props.onDeleteTimelineLane(timedRangeLaneHeaderMenu.role, timedRangeLaneHeaderMenu.laneId))}
          >
            列を削除
          </button>
        </div>
      )}
      {paperTrackEditor && (
        <PaperTrackEditorPopover
          state={paperTrackEditor}
          paperTracks={props.project.logicalSheet.paperTracks}
          onSubmit={submitPaperTrackEditor}
          onCancel={() => setPaperTrackEditor(null)}
        />
      )}
      {timelineLaneEditor && (
        <TimelineLaneEditorPopover
          state={timelineLaneEditor}
          onSubmit={submitTimelineLaneEditor}
          onCancel={() => setTimelineLaneEditor(null)}
        />
      )}
    </div>
  )
}
