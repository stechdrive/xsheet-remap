import { useEffect, useRef } from 'react'
import type { SheetPage, SheetPageViewState, SheetSource } from '@xsheet-remap/core'
import { uiText } from './i18n'

export function PaperSheetAssignmentEditor(props: {
  pages: SheetPage[]
  pageStates: SheetPageViewState[]
  sources: SheetSource[]
  activePageId?: string
  onPageSelect: (pageIndex: number) => void
  onAssign: (pageId: string, sourceId: string | null) => void
  onRemove: (sourceId: string) => void
}) {
  const registeredSectionRef = useRef<HTMLElement>(null)
  const registeredHeadingRef = useRef<HTMLHeadingElement>(null)
  const activePageRowRef = useRef<HTMLDivElement>(null)
  const scanSources = props.sources.filter(source => source.kind === 'sheet-scan')
  const sourceNameCounts = new Map<string, number>()
  for (const source of scanSources) sourceNameCounts.set(source.imageRef.name, (sourceNameCounts.get(source.imageRef.name) ?? 0) + 1)
  const sourceNameIndexes = new Map<string, number>()
  const displayNameBySourceId = new Map(scanSources.map(source => {
    const index = (sourceNameIndexes.get(source.imageRef.name) ?? 0) + 1
    sourceNameIndexes.set(source.imageRef.name, index)
    const total = sourceNameCounts.get(source.imageRef.name) ?? 1
    return [source.sourceId, total > 1 ? uiText.sources.duplicateSourceName(source.imageRef.name, index, total) : source.imageRef.name]
  }))
  const pageNumberById = new Map(props.pages.map(page => [page.pageId, page.pageIndex + 1]))
  const assignedPagesBySource = new Map<string, number[]>()
  for (const pageState of props.pageStates) {
    if (!pageState.sourceId) continue
    const numericPageId = /^page_(\d+)$/.exec(pageState.pageId)
    const pageNumber = pageNumberById.get(pageState.pageId) ?? (numericPageId ? Number(numericPageId[1]) : undefined)
    if (!pageNumber) continue
    assignedPagesBySource.set(pageState.sourceId, [...(assignedPagesBySource.get(pageState.sourceId) ?? []), pageNumber])
  }
  for (const pageNumbers of assignedPagesBySource.values()) pageNumbers.sort((left, right) => left - right)

  useEffect(() => {
    activePageRowRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [props.activePageId, scanSources.length])

  if (scanSources.length === 0) return <p className="paperSheetEmpty">{uiText.sources.empty}</p>

  const sourceOptionLabel = (source: SheetSource) => uiText.sources.sourceOption(
    displayNameBySourceId.get(source.sourceId) ?? source.imageRef.name,
    usageLabel(assignedPagesBySource.get(source.sourceId) ?? []),
  )

  return (
    <div className="paperSheetAssignmentEditor" data-action-menu-keep-open>
      <section aria-label={uiText.sources.assignmentSection}>
        <h3>{uiText.sources.assignmentSection}</h3>
        <div className="paperSheetAssignmentList">
          {props.pages.map(page => {
            const sourceId = props.pageStates.find(state => state.pageId === page.pageId)?.sourceId ?? ''
            const pageNumber = page.pageIndex + 1
            return (
              <div ref={page.pageId === props.activePageId ? activePageRowRef : undefined} className="paperSheetAssignmentRow" key={page.pageId}>
                <button
                  type="button"
                  className={page.pageId === props.activePageId ? 'paperSheetPageButton active' : 'paperSheetPageButton'}
                  aria-current={page.pageId === props.activePageId ? 'page' : undefined}
                  aria-label={uiText.sheet.pageJumpTitle(pageNumber)}
                  onClick={() => props.onPageSelect(page.pageIndex)}
                >
                  {uiText.sheet.pageTab(pageNumber)}
                </button>
                <label className="paperSheetSourceSelect">
                  <span className="visuallyHidden">{uiText.sources.pageAssignmentLabel(pageNumber)}</span>
                  <select
                    value={sourceId}
                    aria-label={uiText.sources.pageAssignmentLabel(pageNumber)}
                    onChange={event => props.onAssign(page.pageId, event.currentTarget.value || null)}
                  >
                    <option value="">{uiText.sources.noPaperSheet}</option>
                    {scanSources.map(source => <option key={source.sourceId} value={source.sourceId}>{sourceOptionLabel(source)}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  className="paperSheetClearButton"
                  aria-label={uiText.sources.clearAssignmentForPage(pageNumber)}
                  disabled={!sourceId}
                  onClick={() => props.onAssign(page.pageId, null)}
                >
                  {uiText.sources.clearAssignment}
                </button>
              </div>
            )
          })}
        </div>
      </section>
      <section ref={registeredSectionRef} aria-label={uiText.sources.registeredSection}>
        <h3 ref={registeredHeadingRef} tabIndex={-1}>{uiText.sources.registeredSection}</h3>
        <div className="paperSheetSourceList">
          {scanSources.map(source => {
            const pageNumbers = assignedPagesBySource.get(source.sourceId) ?? []
            const usage = usageLabel(pageNumbers)
            const displayName = displayNameBySourceId.get(source.sourceId) ?? source.imageRef.name
            return (
              <div className="paperSheetSourceRow" key={source.sourceId}>
                <span className="paperSheetSourceName" title={source.imageRef.path ?? source.imageRef.name}>{displayName}</span>
                <span className="paperSheetSourceUsage">{usage}</span>
                <button
                  type="button"
                  className="paperSheetDeleteButton"
                  aria-label={uiText.sources.removeSourceLabel(displayName)}
                  onClick={event => {
                    if (!window.confirm(uiText.sources.removeSourceConfirm(displayName, usage))) return
                    const buttons = Array.from(registeredSectionRef.current?.querySelectorAll<HTMLButtonElement>('.paperSheetDeleteButton') ?? [])
                    const buttonIndex = buttons.indexOf(event.currentTarget)
                    props.onRemove(source.sourceId)
                    window.requestAnimationFrame(() => {
                      const remaining = Array.from(registeredSectionRef.current?.querySelectorAll<HTMLButtonElement>('.paperSheetDeleteButton') ?? [])
                      ;(remaining[Math.min(Math.max(0, buttonIndex), remaining.length - 1)]
                        ?? registeredHeadingRef.current
                        ?? document.querySelector<HTMLElement>('.actionMenuPortalContent.paperSheetRailMenu .paperSheetLoadButton'))?.focus()
                    })
                  }}
                >
                  {uiText.sources.removeSource}
                </button>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function usageLabel(pageNumbers: number[]): string {
  return pageNumbers.length > 0 ? uiText.sources.assignedPages(pageNumbers) : uiText.sources.unassignedSource
}
