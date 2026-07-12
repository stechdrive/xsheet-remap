import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { cspTopToBottomFromXdtsBottomToTop, type CutProject, type AnnotationStroke, type AnnotationText, type CutGroupProjectDocument, type SheetPage, type SheetTemplate, type SheetViewState, getSheetViewLayout, resolveSheetTemplatePageSize, sheetTimingRoleForKey, updateSlot, upsertBinding, logicalSheetDisplayDurationFrames, logicalSheetOfficialFrameEnd, xdtsBottomToTopFromCspTopToBottom } from '@xsheet-remap/core'
import { materialStateLabels, uiText } from './i18n'
import { clampTextFontSizePx } from './sheetTextLayout'
import { createSheetRenderModelContext } from './sheetRenderModel'
import { getSheetPageImage } from './sheetImages'
import { sheetRoleLabel } from './sheetInteraction'
import { SheetSvgText } from './SheetSvgText'
import { SheetImageLayer } from './SheetTemplateLayers'
import { StackGuideSvgLayer } from './app-stack-guides'
import { GridOverlay, MetadataTextLayer, OverlayPaperTrackLayer, TemplateChrome, WorkRangeOverlay, assetAssignedEventMarkerPoints, eventRectsForPage, isAnnotationStroke, strokePath } from './app-sheet-layers'
import { overlayPaperTracks, templatePaperTracks } from './app-sheet-geometry'
import { AnnotationSvgText } from './sheet-panel-annotation'
import { StackPointerDrag, applyCellStackOrder, cellStackOrderItems, reorderVisibleIdsForDrop, reorderVisibleStackItemsForDropPreview } from './registered-cells-stack-order'

export function BindingPanel({ project, commitProject, selectedKeyId }: { project: CutProject; commitProject: (project: CutProject) => void; selectedKeyId: string | null }) {
  const keys = selectedKeyId ? project.logicalSheet.keys.filter(key => key.keyId === selectedKeyId) : project.logicalSheet.keys
  return (
    <section className="panel">
      <div className="bindingTableWrap">
        <table className="bindingTable">
          <thead>
            <tr>
              <th>{uiText.bindings.key}</th>
              {project.cspTrackSlots.map(slot => <th key={slot.slotId}>{slot.displayPath}</th>)}
            </tr>
          </thead>
          <tbody>
            {keys.map(key => (
              <tr key={key.keyId}>
                <th>{sheetRoleLabel(sheetTimingRoleForKey(key))} {key.paperTrack}-{key.displayLabel}</th>
                {project.cspTrackSlots.map(slot => {
                  const binding = project.bindings.find(item => item.keyId === key.keyId && item.slotId === slot.slotId)
                  return (
                    <td key={slot.slotId}>
                      <input
                        value={binding?.cspCellName ?? ''}
                        placeholder={`${slot.paperTrack}${key.displayLabel}`}
                        onChange={event => commitProject(upsertBinding(project, { slotId: slot.slotId, keyId: key.keyId, cspCellName: event.target.value, materialState: binding?.materialState ?? 'unassigned' }))}
                      />
                      <select
                        value={binding?.materialState ?? 'unassigned'}
                        onChange={event => commitProject(upsertBinding(project, { slotId: slot.slotId, keyId: key.keyId, materialState: event.target.value as 'assigned' | 'unassigned' | 'missing-ok' }))}
                      >
                        <option value="unassigned">{materialStateLabels.unassigned}</option>
                        <option value="assigned">{materialStateLabels.assigned}</option>
                        <option value="missing-ok">{materialStateLabels['missing-ok']}</option>
                      </select>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function SlotPanel({
  project,
  commitProject,
  template,
  sheetPages,
  activePageIndex,
  sheetView,
  runtimeSourceImageUrls,
  showTemplate,
  showAnnotations,
  projectCuts,
  activeCutId,
}: {
  project: CutProject
  commitProject: (project: CutProject) => void
  template: SheetTemplate
  sheetPages: SheetPage[]
  activePageIndex: number
  sheetView: SheetViewState
  runtimeSourceImageUrls: Record<string, string>
  showTemplate: boolean
  showAnnotations: boolean
  projectCuts: CutGroupProjectDocument['cuts']
  activeCutId: string
}) {
  const [syncViewOrder, setSyncViewOrder] = useState(true)
  const [selectedStackItemIds, setSelectedStackItemIds] = useState<Set<string>>(() => new Set())
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const [draggingStackItemIds, setDraggingStackItemIds] = useState<string[]>([])
  const [dropVisualIndex, setDropVisualIndex] = useState<number | null>(null)
  const [pointerStackDrag, setPointerStackDrag] = useState<StackPointerDrag | null>(null)
  const slotOrderListRef = useRef<HTMLDivElement | null>(null)
  const pointerStackDragRef = useRef<StackPointerDrag | null>(null)
  const suppressStackClickRef = useRef(false)
  const stackItems = useMemo(() => cellStackOrderItems(project), [project])
  const visibleStackItems = useMemo(
    () => cspTopToBottomFromXdtsBottomToTop(stackItems.map((item, stackIndex) => ({ item, stackIndex }))),
    [stackItems],
  )
  const visibleStackItemIds = useMemo(() => visibleStackItems.map(({ item }) => item.id), [visibleStackItems])
  const validSelectedStackItemIds = useMemo(
    () => new Set([...selectedStackItemIds].filter(id => visibleStackItemIds.includes(id))),
    [selectedStackItemIds, visibleStackItemIds],
  )
  const previewStackItems = useMemo(
    () => reorderVisibleStackItemsForDropPreview(visibleStackItems, draggingStackItemIds, dropVisualIndex),
    [draggingStackItemIds, dropVisualIndex, visibleStackItems],
  )
  const previewStackItemIds = useMemo(() => previewStackItems.map(({ item }) => item.id), [previewStackItems])
  const sheetPreviewProject = useMemo(
    () => draggingStackItemIds.length > 0 && dropVisualIndex !== null
      ? applyCellStackOrder(project, xdtsBottomToTopFromCspTopToBottom(previewStackItemIds), syncViewOrder)
      : project,
    [draggingStackItemIds.length, dropVisualIndex, previewStackItemIds, project, syncViewOrder],
  )

  const visualDropIndexFromClientY = useCallback((clientY: number): number => {
    const list = slotOrderListRef.current
    if (!list) return visibleStackItems.length
    const rows = Array.from(list.querySelectorAll<HTMLElement>('.slotOrderItem'))
    for (let index = 0; index < rows.length; index += 1) {
      const rect = rows[index]?.getBoundingClientRect()
      if (rect && clientY < rect.top + rect.height / 2) return index
    }
    return rows.length
  }, [visibleStackItems.length])

  const clearStackDragState = useCallback(() => {
    setDraggingStackItemIds([])
    setDropVisualIndex(null)
    setPointerStackDrag(null)
    pointerStackDragRef.current = null
  }, [])

  useEffect(() => {
    pointerStackDragRef.current = pointerStackDrag
  }, [pointerStackDrag])

  useEffect(() => {
    if (!pointerStackDrag) return

    function handlePointerMove(event: globalThis.PointerEvent) {
      const current = pointerStackDragRef.current
      if (!current || event.pointerId !== current.pointerId) return
      const moved = current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 4
      if (!moved) return
      event.preventDefault()
      setDraggingStackItemIds(current.itemIds)
      setDropVisualIndex(visualDropIndexFromClientY(event.clientY))
      if (!current.moved) {
        const next = { ...current, moved: true }
        pointerStackDragRef.current = next
        setPointerStackDrag(next)
      }
    }

    function handlePointerUp(event: globalThis.PointerEvent) {
      const current = pointerStackDragRef.current
      if (!current || event.pointerId !== current.pointerId) return
      if (current.moved) {
        const nextDropIndex = visualDropIndexFromClientY(event.clientY)
        const nextVisibleIds = reorderVisibleIdsForDrop(visibleStackItemIds, current.itemIds, nextDropIndex)
        commitProject(applyCellStackOrder(project, xdtsBottomToTopFromCspTopToBottom(nextVisibleIds), syncViewOrder))
        setSelectedStackItemIds(new Set(current.itemIds))
        setSelectionAnchorId(current.itemIds[0] ?? null)
        suppressStackClickRef.current = true
      }
      clearStackDragState()
    }

    function handlePointerCancel(event: globalThis.PointerEvent) {
      const current = pointerStackDragRef.current
      if (!current || event.pointerId !== current.pointerId) return
      clearStackDragState()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [clearStackDragState, commitProject, pointerStackDrag, project, syncViewOrder, visualDropIndexFromClientY, visibleStackItemIds])

  function moveStackItem(itemId: string, visualDirection: -1 | 1) {
    const currentIndex = stackItems.findIndex(item => item.id === itemId)
    const outputDirection = visualDirection === -1 ? 1 : -1
    const targetIndex = currentIndex + outputDirection
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= stackItems.length) return
    const nextIds = stackItems.map(item => item.id)
    const [moved] = nextIds.splice(currentIndex, 1)
    nextIds.splice(targetIndex, 0, moved)
    commitProject(applyCellStackOrder(project, nextIds, syncViewOrder))
  }

  function handleStackItemSelect(event: MouseEvent, itemId: string) {
    if (suppressStackClickRef.current) {
      suppressStackClickRef.current = false
      return
    }
    if (event.shiftKey && selectionAnchorId) {
      const anchorIndex = visibleStackItemIds.indexOf(selectionAnchorId)
      const targetIndex = visibleStackItemIds.indexOf(itemId)
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
        setSelectedStackItemIds(new Set(visibleStackItemIds.slice(start, end + 1)))
        return
      }
    }
    if (event.ctrlKey || event.metaKey) {
      setSelectedStackItemIds(current => {
        const next = new Set(current)
        if (next.has(itemId)) next.delete(itemId)
        else next.add(itemId)
        return next
      })
      setSelectionAnchorId(itemId)
      return
    }
    setSelectedStackItemIds(new Set([itemId]))
    setSelectionAnchorId(itemId)
  }

  function handleStackItemPointerDown(event: PointerEvent<HTMLDivElement>, itemId: string) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (event.ctrlKey || event.metaKey || event.shiftKey) return
    const movingIds = validSelectedStackItemIds.has(itemId)
      ? visibleStackItemIds.filter(id => validSelectedStackItemIds.has(id))
      : [itemId]
    if (!validSelectedStackItemIds.has(itemId)) {
      setSelectedStackItemIds(new Set(movingIds))
      setSelectionAnchorId(itemId)
    }
    setPointerStackDrag({
      pointerId: event.pointerId,
      itemIds: movingIds,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    })
  }

  return (
    <section className="panel">
      <section className="slotOrderSection">
        <div className="slotSectionHeader">
          <div>
            <h3>{uiText.slots.cellStackOrder}</h3>
            <p className="muted">{uiText.slots.cellStackOrderHint}</p>
          </div>
          <label className="slotSyncToggle">
            <input type="checkbox" checked={syncViewOrder} onChange={event => setSyncViewOrder(event.currentTarget.checked)} />
            {uiText.slots.syncViewOrder}
          </label>
        </div>
        <div className="slotOrderWorkspace">
          <div
            ref={slotOrderListRef}
            className="slotOrderList"
            role="listbox"
            aria-multiselectable="true"
          >
          {visibleStackItems.map(({ item, stackIndex }, visualIndex) => {
            const canMoveUp = stackIndex < stackItems.length - 1
            const canMoveDown = stackIndex > 0
            const isSelected = validSelectedStackItemIds.has(item.id)
            const isDragging = draggingStackItemIds.includes(item.id)
            const dropBefore = dropVisualIndex === visualIndex
            const dropAfter = dropVisualIndex === visualIndex + 1
            return (
              <div
                key={item.id}
                className={[
                  'slotOrderItem',
                  item.kind,
                  isSelected ? 'selected' : '',
                  isDragging ? 'dragging' : '',
                  dropBefore ? 'drop-before' : '',
                  dropAfter ? 'drop-after' : '',
                ].filter(Boolean).join(' ')}
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
                onClick={event => handleStackItemSelect(event, item.id)}
                onPointerDown={event => handleStackItemPointerDown(event, item.id)}
              >
                <div className="slotOrderControls" onClick={event => event.stopPropagation()}>
                  <button type="button" aria-label={`${item.label} ${uiText.slots.moveUp}`} disabled={!canMoveUp} onClick={() => moveStackItem(item.id, -1)}>▲</button>
                  <button type="button" aria-label={`${item.label} ${uiText.slots.moveDown}`} disabled={!canMoveDown} onClick={() => moveStackItem(item.id, 1)}>▼</button>
                </div>
                <span className="slotOrderIndex">{stackIndex + 1}</span>
                <span className="slotOrderName">{item.label}</span>
                <span className="slotOrderBadge">{item.kindLabel}</span>
              </div>
            )
          })}
          </div>
          <aside className="slotStackPreview" aria-label={uiText.slots.sheetPreview}>
            <div className="slotStackPreviewHeader">{uiText.slots.sheetPreview}</div>
            <SlotSheetPreview
              project={sheetPreviewProject}
              template={template}
              sheetPages={sheetPages}
              activePageIndex={activePageIndex}
              sheetView={sheetView}
              runtimeSourceImageUrls={runtimeSourceImageUrls}
              showTemplate={showTemplate}
              showAnnotations={showAnnotations}
              projectCuts={projectCuts}
              activeCutId={activeCutId}
            />
          </aside>
        </div>
      </section>
      <details className="slotOrderSection slotDetailSection">
        <summary className="slotDetailSummary">{uiText.slots.detailSlots}</summary>
        <div className="bindingTableWrap">
          <table className="bindingTable">
            <thead>
              <tr>
                <th>{uiText.slots.trackNo}</th>
                <th>{uiText.slots.paper}</th>
                <th>{uiText.slots.xdtsName}</th>
                <th>{uiText.slots.displayPath}</th>
                <th>{uiText.slots.occurrence}</th>
              </tr>
            </thead>
            <tbody>
              {project.cspTrackSlots.map(slot => (
                <tr key={slot.slotId}>
                  <td>
                    <input
                      className="numberInput"
                      type="number"
                      value={slot.trackNo}
                      onChange={event => commitProject(updateSlot(project, slot.slotId, { trackNo: Number(event.currentTarget.value) }))}
                    />
                  </td>
                  <td>{slot.paperTrack}</td>
                  <td>
                    <input value={slot.xdtsName} onChange={event => commitProject(updateSlot(project, slot.slotId, { xdtsName: event.currentTarget.value }))} />
                  </td>
                  <td>
                    <input value={slot.displayPath} onChange={event => commitProject(updateSlot(project, slot.slotId, { displayPath: event.currentTarget.value }))} />
                  </td>
                  <td>
                    <input
                      className="numberInput"
                      type="number"
                      value={slot.occurrenceIndex}
                      onChange={event => commitProject(updateSlot(project, slot.slotId, { occurrenceIndex: Number(event.currentTarget.value) }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

function SlotSheetPreview({
  project,
  template,
  sheetPages,
  activePageIndex,
  sheetView,
  runtimeSourceImageUrls,
  showTemplate,
  showAnnotations,
  projectCuts,
  activeCutId,
}: {
  project: CutProject
  template: SheetTemplate
  sheetPages: SheetPage[]
  activePageIndex: number
  sheetView: SheetViewState
  runtimeSourceImageUrls: Record<string, string>
  showTemplate: boolean
  showAnnotations: boolean
  projectCuts: CutGroupProjectDocument['cuts']
  activeCutId: string
}) {
  const page = sheetPages[activePageIndex] ?? sheetPages[0]
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const templateTrackNames = templatePaperTracks(project).map(track => track.paperTrack)
  const pageSize = resolveSheetTemplatePageSize(template, displayDurationFrames, {
    paperTracks: templateTrackNames,
    layoutOverrides: sheetView.layoutOverrides,
  })
  const sheetRenderModelContext = createSheetRenderModelContext(project, template, {
    cutGroup: { activeCutId, cuts: projectCuts },
  })
  const overlayTracks = overlayPaperTracks(project)
  if (!page) return <p className="muted">{uiText.slots.noSheetPreview}</p>

  const pageImage = getSheetPageImage(sheetView, runtimeSourceImageUrls, page.pageId, template)
  const displayImageSettings = { ...pageImage.settings }
  const eventRects = eventRectsForPage(project, template, page)
  const strokes = showAnnotations ? project.annotations.filter((annotation): annotation is AnnotationStroke => isAnnotationStroke(annotation) && annotation.pageId === page.pageId && annotation.tool === 'pen') : []
  const textAnnotations = showAnnotations ? project.annotations.filter((annotation): annotation is AnnotationText => annotation.kind === 'text' && annotation.pageId === page.pageId) : []

  return (
    <div className="slotSheetPreviewViewport">
      <figure className="slotSheetPreviewPage">
        <figcaption>
          {uiText.slots.sheetPreviewPage(page.pageIndex + 1, page.frameStart, page.frameEnd)}
        </figcaption>
        <div
          className="slotSheetPreviewSurface"
          style={{ aspectRatio: `${pageSize.widthPx} / ${pageSize.heightPx}` }}
        >
          <svg
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            className="slotSheetPreviewSvg"
            aria-label={uiText.slots.sheetPreview}
          >
            <rect x="0" y="0" width="1" height="1" fill="#f7f7f4" />
            {showTemplate && pageImage.imageUrl && (
              <SheetImageLayer
                imageUrl={pageImage.imageUrl}
                imageSettings={displayImageSettings}
                template={template}
                preview
              />
            )}
            <TemplateChrome template={template} paperTracks={templateTrackNames} durationFrames={displayDurationFrames} layoutOverrides={project.sheetView.layoutOverrides} />
            {template.regions.filter(region => region.type === 'exposure-grid').map(region => (
              <GridOverlay key={region.regionId} template={template} region={region} paperTracks={templateTrackNames} durationFrames={page.frameEnd - page.frameStart + 1} frameOrigin={getSheetViewLayout(template).surface?.type === 'continuous-canvas' ? page.frameStart : template.defaults.frameOrigin} pageFrameStart={page.frameStart} layoutOverrides={project.sheetView.layoutOverrides} />
            ))}
            <MetadataTextLayer context={sheetRenderModelContext} page={page} />
            <WorkRangeOverlay
              template={template}
              page={page}
              displayDurationFrames={displayDurationFrames}
              officialFrameStart={project.logicalSheet.frameOrigin}
              officialFrameEnd={logicalSheetOfficialFrameEnd(project.logicalSheet)}
            />
            {overlayTracks.length > 0 && (
              <OverlayPaperTrackLayer
                project={project}
                template={template}
                page={page}
                tracks={overlayTracks}
                activePaperTrack={null}
                drag={null}
              />
            )}
            {eventRects.map(({ event, displayLabel, rect, hasAssetBinding, fontSizePx }) => {
              return (
                <g key={event.eventId}>
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
                        pageSize={pageSize}
                      >
                        {displayLabel}
                      </SheetSvgText>
                  )}
                </g>
              )
            })}
            <StackGuideSvgLayer
              project={project}
              template={template}
              page={page}
            />
            {strokes.map(stroke => (
              <path key={stroke.annotationId} className="annotationStroke" d={strokePath(stroke)} stroke={stroke.color} strokeWidth={stroke.width} />
            ))}
            {textAnnotations.map(annotation => (
              <AnnotationSvgText key={annotation.annotationId} annotation={annotation} pageSize={pageSize} />
            ))}
          </svg>
        </div>
      </figure>
    </div>
  )
}
