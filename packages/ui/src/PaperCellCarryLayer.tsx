import { memo, useMemo } from 'react'
import { timingReferenceAddress, type SheetPage } from '@xsheet-remap/core'
import { overlayColumnsForPage } from './app-sheet-geometry'
import { shouldSuppressRectUnderActiveOverlay } from './sheet-layers-hit-geometry'
import { paperCellCarryItemsForPage, type SheetRenderModelContext } from './sheetRenderModel'
import { TimingCellText } from './TimingCellText'
import { TimingEventSymbol } from './TimingEventSymbol'
import { useSheetTextMetricsRevision } from './useSheetTextMetricsRevision'

export const PaperCellCarryLayer = memo(function PaperCellCarryLayer({ context, page, activeOverlayPaperTrack, textClassName = 'paperCellCarryText', occupied }: {
  context: SheetRenderModelContext; page: SheetPage; activeOverlayPaperTrack?: string | null
  textClassName?: string; occupied?: ReadonlySet<string>
}) {
  const metrics = useSheetTextMetricsRevision()
  const items = useMemo(() => {
    const carries = paperCellCarryItemsForPage(context, page)
    const active = context.overlayTracks.find(track => track.paperTrack === activeOverlayPaperTrack)
    if (!active || !carries.length) return carries
    const columns = overlayColumnsForPage(context.template, context.project, active, page)
    return carries.filter(item => !shouldSuppressRectUnderActiveOverlay(context.project.logicalSheet.paperTracks.find(track => track.paperTrack === item.paperTrack), item.rect, columns))
    // Refit font measurements when the sheet font loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, page, activeOverlayPaperTrack, metrics])
  if (!items.length) return null
  return <g className="paperCellCarries" pointerEvents="none">
    {items.map(item => occupied?.has(timingReferenceAddress(item)) ? null : <g key={`${item.eventId}:${item.frame}:${item.rect.x}`}
      data-carry-track={item.paperTrack} data-carry-frame={item.frame}>
      {item.kind === 'blank' ? <TimingEventSymbol kind="blank" className="paperCellCarryBlank" rect={item.rect} pageSize={context.pageSize} />
        : <TimingCellText layout={item.textLayout} rect={item.rect} pageSize={context.pageSize} className={textClassName} />}
    </g>)}
  </g>
})
