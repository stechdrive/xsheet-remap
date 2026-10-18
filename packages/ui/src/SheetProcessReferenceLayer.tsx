import { useMemo } from 'react'
import { baseTimingProcessId, baseTimingProject, sheetTimingRoleForEvent, type CutProject, type SheetPage, type SheetTemplate } from '@xsheet-remap/core'
import { createSheetRenderModelContext, continuationRenderItemsForPage, sheetContinuationPathData } from './sheetRenderModel'
import { eventRectsForPages } from './sheet-layers-hit-geometry'
import { TimingCellText } from './TimingCellText'
import { TimingEventSymbol } from './TimingEventSymbol'

/** Reference-only drawing: never supplies hits, selections, keys or export content. */
export function SheetProcessReferenceLayer({ project, template, page }: { project: CutProject; template: SheetTemplate; page: SheetPage }) {
  if (!project.logicalSheet.processTimings || project.logicalSheet.processTimings.activeProcessId === baseTimingProcessId(project)) return null
  return <ProcessReferenceDrawing project={project} template={template} page={page} />
}

function ProcessReferenceDrawing({ project, template, page }: { project: CutProject; template: SheetTemplate; page: SheetPage }) {
  const drawing = useMemo(() => {
    const base = baseTimingProject(project), context = createSheetRenderModelContext(base, template)
    const reference = eventRectsForPages(base, template, [page]).get(page.pageId) ?? []
    const active = eventRectsForPages(project, template, [page]).get(page.pageId) ?? []
    const address = (event: CutProject['logicalSheet']['events'][number]) => JSON.stringify([event.paperTrack, sheetTimingRoleForEvent(event), event.frame])
    const occupied = new Map(active.map(item => [address(item.event), item]))
    const referenceByAddress = new Map(reference.map(item => [address(item.event), item]))
    return { context, reference, active, occupied, referenceByAddress, address, lines: continuationRenderItemsForPage(context, page) }
  }, [project, template, page])
  const { context, reference, active, occupied, referenceByAddress, address, lines } = drawing
  return <svg className="sheetTransientOverlay sheetProcessReference" data-testid="base-process-reference" data-base-process={baseTimingProcessId(project)} viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="基準シートの参照" style={{ pointerEvents: 'none' }}>
    <g className="baseProcessInk">
      {lines.map((item, index) => <path key={`${item.eventId}:${index}`} d={sheetContinuationPathData(item.path)} fill="none" stroke="#70888a" opacity="0.5" strokeWidth={item.strokeWidth} />)}
      {reference.filter(item => !occupied.has(address(item.event))).map(item => <g key={item.event.eventId} data-base-frame={item.event.frame} data-base-value={item.displayLabel}>
        {item.eventKind === 'cell' ? <TimingCellText className="baseProcessText" layout={item.textLayout} rect={item.rect} pageSize={context.pageSize} /> : <TimingEventSymbol kind={item.eventKind} rect={item.rect} pageSize={context.pageSize} />}
      </g>)}
    </g>
    {active.map(item => {
      const base = referenceByAddress.get(address(item.event))
      const different = base && (base.displayLabel !== item.displayLabel || base.eventKind !== item.eventKind)
      return <g key={item.event.eventId} data-working-frame={item.event.frame} data-base-value={base?.displayLabel} data-working-value={item.displayLabel}>
        <rect x={item.rect.x} y={item.rect.y} width={item.rect.w} height={item.rect.h} fill="none" stroke="#387568" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {different && <path data-timing-conflict="true" d={`M${item.rect.x + item.rect.w * .8} ${item.rect.y}h${item.rect.w * .2}v${item.rect.h * .25}z`} fill="#b66b26" />}
      </g>
    })}
  </svg>
}
