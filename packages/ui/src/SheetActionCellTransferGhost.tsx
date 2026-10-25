import { memo, useContext, useMemo } from 'react'
import type { CutProject, SheetPage } from '@xsheet-remap/core'
import { eventRectsForPages } from './sheet-layers-hit-geometry'
import { continuationRenderItemsForPages, referenceOnlyRenderItemsForPage, sheetContinuationPathData, type SheetRenderModelContext } from './sheetRenderModel'
import { SheetRenderWindowContext } from './useSheetRenderWindow'
import { sheetFrameRangeForWindow } from './sheetRenderWindowGeometry'
import { useSheetTextMetricsRevision } from './useSheetTextMetricsRevision'
import { TimingCellText } from './TimingCellText'
import { TimingEventSymbol } from './TimingEventSymbol'
import { TimingReferenceSymbol } from './TimingReferenceSymbol'

// Preview notation is separate from the real project, registration and export.
export const SheetActionCellTransferGhost = memo(function SheetActionCellTransferGhost({ project, context, page, activeOverlayPaperTrack }: {
  project: CutProject; context: SheetRenderModelContext; page: SheetPage; activeOverlayPaperTrack: string | null
}) {
  const renderWindow = useContext(SheetRenderWindowContext)
  const metrics = useSheetTextMetricsRevision()
  const previewContext = useMemo(() => ({ ...context, project, visibleKeyIds: undefined }), [context, project])
  const model = useMemo(() => {
    const frameRange = sheetFrameRangeForWindow(previewContext, renderWindow)
    return {
      events: eventRectsForPages(project, context.template, [page], { frameRange, activeOverlayPaperTrack }).get(page.pageId) ?? [],
      references: referenceOnlyRenderItemsForPage(previewContext, page, frameRange),
      continuations: continuationRenderItemsForPages(previewContext, [page], renderWindow).get(page.pageId) ?? [],
    }
    // Font loading changes fitted text without changing the project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, context.template, previewContext, page, renderWindow, activeOverlayPaperTrack, metrics])
  return <g className="actionCellTransferGhost" pointerEvents="none">
    {model.continuations.map((item, index) => <path key={`${item.eventId}:${index}`} className="timingContinuationLine"
      d={sheetContinuationPathData(item.path)} strokeWidth={item.strokeWidth} />)}
    {model.references.map(item => item.textLayout.reference && <TimingReferenceSymbol key={item.eventId} geometry={item.textLayout.reference} pageSize={context.pageSize} />)}
    {model.events.map(({ event, eventKind, displayLabel, rect, textLayout }) => <g key={event.eventId}
      data-transfer-track={event.paperTrack} data-transfer-frame={event.frame}>
      <rect className="actionCellTransferGhostFill" x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
      {textLayout.reference && <TimingReferenceSymbol geometry={textLayout.reference} pageSize={context.pageSize} />}
      {eventKind === 'cell' && displayLabel.trim() && <TimingCellText layout={textLayout} rect={rect} pageSize={context.pageSize} />}
      {eventKind !== 'cell' && <TimingEventSymbol kind={eventKind} rect={rect} pageSize={context.pageSize} />}
    </g>)}
  </g>
})
