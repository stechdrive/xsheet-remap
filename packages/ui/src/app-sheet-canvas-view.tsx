import { type AnnotationStroke, type AnnotationText, type SheetHit } from '@xsheet-remap/core';
import { uiText } from './i18n';
import { clampTextFontSizePx } from './sheetTextLayout';
import { getSheetPageImage } from './sheetImages';
import { rangeRectsForPage } from './sheetInteraction';
import { rangePaperTracks, sameSheetHitCell } from './timingEditing';
import { SheetSvgText } from './SheetSvgText';
import { SheetImageLayer } from './SheetTemplateLayers';
import { AutoCalibrationGuideOverlay, CalibrationQuadEditor, CellAssetPreview, GridOverlay, MetadataTextLayer, OverlayPaperTrackInteractionLayer, OverlayPaperTrackLayer, TemplateChrome, WorkRangeOverlay, assetAssignedEventMarkerPoints, calibrationGuideMetrics, eventRectsForPage, isAnnotationStroke, overlayColumnRectForPage, overlayRangeRectForPage, rectForHit, shouldSuppressRectUnderActiveOverlay, strokePath } from './app-sheet-layers';
import { AnnotationTextLayer } from './sheet-panel-annotation';
import { HoverCellOverlay, PaperTrackEditorPopover, StackGuideOverlay, StackGuideSvgLayer } from './app-stack-guides';
import { sheetContextMenuStyle } from './app-registered-cells';
import type { SheetCanvasController } from './app-sheet-canvas-controller'

export function SheetCanvasView({ controller }: { controller: SheetCanvasController }) {
  const {
    props, draftStroke, setDraftStroke, draftRange, setDraftRange, hoveredHit,
    textCursorBadge, contextMenu, paperTrackHeaderMenu, overlayPaperTrackMenu, stackGuideHeaderMenu, stackGuideInsertRequest,
    setStackGuideInsertRequest, stackGuideDropPreview, setStackGuideDropPreview, paperTrackEditor, setPaperTrackEditor, overlayTrackDrag,
    setOverlayTrackDrag, timelineEventDrag, setTimelineEventDrag, pendingTimelineEventDrag, activeOverlayPaperTrack, setActiveOverlayPaperTrack,
    draftCalibration, viewportRef, sheetSvgRefs, zoom, isContinuousCanvas,
    displayDurationFrames, officialFrameEnd, templateTrackNames, sheetPageSize, sheetPageWidth, sheetPageHeight,
    overlayTracks, sheetRenderModelContext, visiblePages, isCalibratingSheet, updateStackGuideDropPreview, clearHover,
    selectPaperTrackColumn, handlePointerDown, timelineEventHitForPage, handleTimelineEventPointerDown, handleTimelineEventPointerMove, handleTimelineEventPointerUp,
    handleTimelineEventPointerCancel, calibrationPointsForPage, handleCalibrationHandlePointerDown, handlePointerMove, handleContextMenu, runContextMenuAction,
    runPaperTrackHeaderMenuAction, runOverlayPaperTrackMenuAction, runStackGuideHeaderMenuAction, requestStackGuideInsert, openPaperTrackRenameEditor, openAddOverlayPaperTrackEditor,
    openOverlayPaperTrackEditor, openOverlayPaperTrackMenu, submitPaperTrackEditor, handlePointerUp, handleDrop, handleDragOver,
    handleViewportDragOver, handleViewportDrop, handleViewportPointerDown, contextProcessMove, contextProcessMoveOptions, canCopyContextRange,
    canPasteContextOverwrite, canPasteContextInsert, canPasteContextRepeatRange, canPasteContextRepeatToEnd, hasSheetContextMenuItems, sheetContextMenuItemCount,
    overlayPaperTrackMenuTrack, hoverPreviewItems, hoverPreviewPosition, activeRange, viewportClassName,
  } = controller

  return (
    <div
      ref={viewportRef}
      className={viewportClassName}
      onPointerDown={handleViewportPointerDown}
      onDragOver={handleViewportDragOver}
      onDrop={event => void handleViewportDrop(event)}
    >
      <div className={`sheetPageStack ${props.sheetView.viewMode}`}>
        {visiblePages.map(page => {
          const isCalibrating = isCalibratingSheet
          const pageImage = getSheetPageImage(props.sheetView, props.runtimeSourceImageUrls, page.pageId, props.template)
          const strokes = !isCalibrating && props.showAnnotations
            ? [
                ...props.project.annotations.filter((annotation): annotation is AnnotationStroke => isAnnotationStroke(annotation) && annotation.pageId === page.pageId && annotation.tool === 'pen'),
                ...(draftStroke?.pageId === page.pageId ? [draftStroke] : []),
              ]
            : []
          const textAnnotations = !isCalibrating && props.showAnnotations
            ? props.project.annotations.filter((annotation): annotation is AnnotationText => annotation.kind === 'text' && annotation.pageId === page.pageId)
            : []
          const activeOverlayTrack = !isCalibrating && activeOverlayPaperTrack
            ? props.project.logicalSheet.paperTracks.find(track => track.paperTrack === activeOverlayPaperTrack && track.source === 'overlay')
            : undefined
          const activeOverlayColumn = activeOverlayTrack ? overlayColumnRectForPage(props.template, props.project, activeOverlayTrack, page) : null
          const eventRects = isCalibrating ? [] : eventRectsForPage(props.project, props.template, page, { activeOverlayPaperTrack })
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
          const showTemplateGuides = props.showTemplateGuides && !isCalibrating
          const displayImageSettings = { ...pageImage.settings, calibration: { ...(pageImage.settings.calibration ?? { enabled: false }), points: calibrationPoints } }
          const rawHoverRect = !isCalibrating && hoveredHit?.pageId === page.pageId ? rectForHit(props.project, props.template, hoveredHit) : null
          const hoverTrack = hoveredHit?.paperTrack ? props.project.logicalSheet.paperTracks.find(track => track.paperTrack === hoveredHit.paperTrack) : undefined
          const hoverRect = rawHoverRect && !shouldSuppressRectUnderActiveOverlay(hoverTrack, rawHoverRect, activeOverlayColumn) ? rawHoverRect : null
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

          const pageAccessibleLabel = isContinuousCanvas
            ? uiText.sheet.surfaceCaption(page.frameStart, page.frameEnd)
            : uiText.sheet.pageCaption(page.pageIndex + 1, page.frameStart, page.frameEnd)

          return (
            <figure
              key={page.pageId}
              className={page.pageIndex === props.activePageIndex ? 'sheetPage active' : 'sheetPage'}
              aria-label={pageAccessibleLabel}
            >
              <div
                className="sheetPageSurface"
                style={{ width: `${sheetPageWidth}px`, height: `${sheetPageHeight}px` }}
              >
                <svg
                  viewBox="0 0 1 1"
                  preserveAspectRatio="none"
                  className={[
                    'sheetSvg',
                    draftCalibration?.pageId === page.pageId ? 'calibrationDragging' : '',
                    props.editMode === 'text' ? 'textAnnotationMode' : '',
                    props.editMode === 'text' && !props.editingTextAnnotationId ? 'textAnnotationPlacementMode' : '',
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
                  {showTemplateGuides && <TemplateChrome template={props.template} paperTracks={templateTrackNames} durationFrames={displayDurationFrames} layoutOverrides={props.project.sheetView.layoutOverrides} />}
                  {showTemplateGuides && props.template.regions.filter(region => region.type === 'exposure-grid').map(region => (
                    <GridOverlay key={region.regionId} template={props.template} region={region} paperTracks={templateTrackNames} durationFrames={page.frameEnd - page.frameStart + 1} frameOrigin={isContinuousCanvas ? page.frameStart : props.template.defaults.frameOrigin} pageFrameStart={page.frameStart} layoutOverrides={props.project.sheetView.layoutOverrides} />
                  ))}
                  {showTemplateGuides && <MetadataTextLayer context={sheetRenderModelContext} page={page} />}
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
                  {!isCalibrating && (
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
                    <rect
                      key={`${index}-${rect.x}-${rect.y}`}
                      className={draftRange ? 'draftRangeRect' : 'selectedRangeRect'}
                      x={rect.x}
                      y={rect.y}
                      width={rect.w}
                      height={rect.h}
                    />
                  ))}
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
                  {eventRects.map(({ event, displayLabel, rect, hasAssetBinding, fontSizePx }) => {
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
                        {hasAssetBinding && <polygon className="assetAssignedEventMarker" points={assetAssignedEventMarkerPoints(rect)} />}
                        {displayLabel.trim()
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
                      </g>
                    )
                  })}
                  {!isCalibrating && (
                    <StackGuideSvgLayer
                      project={props.project}
                      template={props.template}
                      page={page}
                      onUpdateLabel={props.onUpdateStackGuideLabel}
                      onPreviewPlacement={(labelId, clientX, clientY) => {
                        updateStackGuideDropPreview(labelId, clientX, clientY)
                      }}
                      onClearPreview={() => setStackGuideDropPreview(null)}
                    />
                  )}
                  {strokes.map(stroke => (
                    <path
                      key={stroke.annotationId}
                      className={stroke.tool === 'eraser' ? 'annotationStroke annotationEraserPreview' : 'annotationStroke'}
                      d={strokePath(stroke)}
                      stroke={stroke.color}
                      strokeWidth={stroke.width}
                    />
                  ))}
                  {selectedRect && (
                    <g className="selectedCellOverlay">
                      <rect className="selectedCellRect" x={selectedRect.x} y={selectedRect.y} width={selectedRect.w} height={selectedRect.h} />
                    </g>
                  )}
                </svg>
                {!isCalibrating && textAnnotations.length > 0 && (
                  <AnnotationTextLayer
                    annotations={textAnnotations}
                    selectedAnnotationId={props.selectedTextAnnotationId}
                    editingAnnotationId={props.editingTextAnnotationId}
                    pageSize={sheetPageSize}
                    zoom={zoom}
                    onSelect={props.onSelectTextAnnotation}
                    onEdit={props.onEditTextAnnotation}
                    onUpdate={props.onUpdateTextAnnotation}
                    onCommit={props.onCommitTextAnnotation}
                    onCancel={props.onCancelTextAnnotation}
                  />
                )}
                {props.editMode === 'text' && !props.editingTextAnnotationId && textCursorBadge?.pageId === page.pageId && (
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
              </div>
            </figure>
          )
        })}
      </div>
      {hoverPreviewPosition && <CellAssetPreview position={hoverPreviewPosition} items={hoverPreviewItems} />}
      {contextMenu && hasSheetContextMenuItems && (
        <div
          className="sheetContextMenu"
          style={sheetContextMenuStyle(contextMenu.x, contextMenu.y, sheetContextMenuItemCount)}
          role="menu"
          onPointerDown={event => event.stopPropagation()}
          onContextMenu={event => event.preventDefault()}
        >
          <button role="menuitem" disabled={!canCopyContextRange} onClick={() => runContextMenuAction(props.onCopyRange)}>{uiText.actions.copyRange}</button>
          <button role="menuitem" disabled={!canCopyContextRange} onClick={() => runContextMenuAction(props.onCutRange)}>{uiText.actions.cutRange}</button>
          <button role="menuitem" disabled={!canCopyContextRange} onClick={() => runContextMenuAction(props.onCutRangeRipple)}>{uiText.actions.cutRangeRipple}</button>
          <button role="menuitem" disabled={!canPasteContextOverwrite} onClick={() => runContextMenuAction(() => props.onPasteTiming('overwrite'))}>{uiText.actions.pasteOverwrite}</button>
          <button role="menuitem" disabled={!canPasteContextInsert} onClick={() => runContextMenuAction(() => props.onPasteTiming('insert'))}>{uiText.actions.pasteInsert}</button>
          <button role="menuitem" disabled={!canPasteContextRepeatRange} onClick={() => runContextMenuAction(() => props.onPasteTiming('repeat-range'))}>{uiText.actions.repeatPaste}</button>
          <button role="menuitem" disabled={!canPasteContextRepeatToEnd} onClick={() => runContextMenuAction(() => props.onPasteTiming('repeat-to-end'))}>{uiText.actions.repeatPasteToEnd}</button>
          <button role="menuitem" onClick={() => runContextMenuAction(() => props.onSetNullAtHit(contextMenu.hit as SheetHit))}>{uiText.actions.setNullCell}</button>
          <button role="menuitem" onClick={() => runContextMenuAction(() => props.onDeleteEventAtHit(contextMenu.hit as SheetHit))}>{uiText.actions.deleteEvent}</button>
          <div className="sheetContextMenuTitle">{uiText.frameOperation.title}</div>
          <button role="menuitem" onClick={() => runContextMenuAction(() => props.onOpenFrameOperation('insert', contextMenu.hit as SheetHit))}>{uiText.frameOperation.insert}</button>
          <button role="menuitem" onClick={() => runContextMenuAction(() => props.onOpenFrameOperation('delete', contextMenu.hit as SheetHit))}>{uiText.frameOperation.delete}</button>
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
      {paperTrackEditor && (
        <PaperTrackEditorPopover
          state={paperTrackEditor}
          paperTracks={props.project.logicalSheet.paperTracks}
          onSubmit={submitPaperTrackEditor}
          onCancel={() => setPaperTrackEditor(null)}
        />
      )}
    </div>
  )
}
