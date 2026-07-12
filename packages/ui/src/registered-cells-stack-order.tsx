import { type CutProject, type PaperTrack, type StackGuideLabel, stackGuideStackBand } from '@xsheet-remap/core'
import { uiText } from './i18n'
import { compareNaturalFileNameText } from './naturalSort'

export type CellStackOrderItem =
  | { id: string; kind: 'template-track'; label: string; kindLabel: string; paperTrack: string }
  | { id: string; kind: 'overlay-track'; label: string; kindLabel: string; paperTrack: string }
  | { id: string; kind: 'stack-guide'; label: string; kindLabel: string; labelId: string }

type VisibleCellStackOrderItem = { item: CellStackOrderItem; stackIndex: number }

export type StackPointerDrag = {
  pointerId: number
  itemIds: string[]
  startX: number
  startY: number
  moved: boolean
}

export function reorderVisibleStackItemsForDropPreview(
  visibleItems: VisibleCellStackOrderItem[],
  movingIds: string[],
  dropIndex: number | null,
): VisibleCellStackOrderItem[] {
  if (movingIds.length === 0 || dropIndex === null) return visibleItems
  const byId = new Map(visibleItems.map(entry => [entry.item.id, entry]))
  return reorderVisibleIdsForDrop(visibleItems.map(entry => entry.item.id), movingIds, dropIndex)
    .map(id => byId.get(id))
    .filter((entry): entry is VisibleCellStackOrderItem => Boolean(entry))
}

export function reorderVisibleIdsForDrop(visibleIds: string[], movingIds: string[], dropIndex: number): string[] {
  const movingSet = new Set(movingIds)
  const moving = visibleIds.filter(id => movingSet.has(id))
  if (moving.length === 0) return visibleIds
  const remaining = visibleIds.filter(id => !movingSet.has(id))
  const insertionIndex = visibleIds.slice(0, dropIndex).filter(id => !movingSet.has(id)).length
  return [
    ...remaining.slice(0, insertionIndex),
    ...moving,
    ...remaining.slice(insertionIndex),
  ]
}

export function cellStackOrderItems(project: CutProject): CellStackOrderItem[] {
  const templateTracks = project.logicalSheet.paperTracks
    .filter(track => track.source !== 'overlay')
    .sort((a, b) => a.order - b.order || compareNaturalFileNameText(a.paperTrack, b.paperTrack))
  const entriesByAnchor = new Map<string, Array<{ orderInGap: number; item: CellStackOrderItem }>>()

  function addGapEntry(anchor: string | undefined, orderInGap: number, item: CellStackOrderItem) {
    const key = anchor ?? ''
    const entries = entriesByAnchor.get(key) ?? []
    entries.push({ orderInGap, item })
    entriesByAnchor.set(key, entries)
  }

  for (const track of project.logicalSheet.paperTracks) {
    if (track.source !== 'overlay') continue
    addGapEntry(track.exportPlacement?.insertAfterPaperTrack, track.exportPlacement?.orderInGap ?? 0, {
      id: `paper:${track.paperTrack}`,
      kind: 'overlay-track',
      label: track.label || track.paperTrack,
      kindLabel: uiText.slots.overlayTrack,
      paperTrack: track.paperTrack,
    })
  }
  for (const label of project.stackGuideLabels) {
    if (stackGuideStackBand(label) !== 'cell-interleave') continue
    addGapEntry(stackGuideAnchorForCellOrder(project, label), label.orderInGap, {
      id: `stack:${label.labelId}`,
      kind: 'stack-guide',
      label: label.label,
      kindLabel: uiText.slots.stackGuideTrack,
      labelId: label.labelId,
    })
  }
  for (const entries of entriesByAnchor.values()) {
    entries.sort((a, b) =>
      a.orderInGap - b.orderInGap
      || cellStackOrderKindRank(a.item) - cellStackOrderKindRank(b.item)
      || compareNaturalFileNameText(a.item.label, b.item.label)
      || a.item.id.localeCompare(b.item.id, 'ja'),
    )
  }

  const items: CellStackOrderItem[] = []
  items.push(...cellStackGapItems(entriesByAnchor, undefined))
  templateTracks.forEach(track => {
    items.push({
      id: `paper:${track.paperTrack}`,
      kind: 'template-track',
      label: track.label || track.paperTrack,
      kindLabel: uiText.slots.fixedAnchor,
      paperTrack: track.paperTrack,
    })
    items.push(...cellStackGapItems(entriesByAnchor, track.paperTrack))
  })
  return items
}

function cellStackGapItems(entriesByAnchor: Map<string, Array<{ item: CellStackOrderItem }>>, anchor: string | undefined): CellStackOrderItem[] {
  return (entriesByAnchor.get(anchor ?? '') ?? []).map(entry => entry.item)
}

function stackGuideAnchorForCellOrder(project: CutProject, label: StackGuideLabel): string | undefined {
  const anchorTrack = label.insertAfterPaperTrack
    ? project.logicalSheet.paperTracks.find(track => track.paperTrack === label.insertAfterPaperTrack)
    : undefined
  if (anchorTrack?.source === 'overlay') return anchorTrack.exportPlacement?.insertAfterPaperTrack
  return label.insertAfterPaperTrack
}

function cellStackOrderKindRank(item: CellStackOrderItem) {
  if (item.kind === 'overlay-track') return 0
  if (item.kind === 'stack-guide') return 1
  return 2
}

export function applyCellStackOrder(project: CutProject, orderedItemIds: string[], syncViewOrder: boolean): CutProject {
  const currentItems = new Map(cellStackOrderItems(project).map(item => [item.id, item]))
  const gapOrder = new Map<string, number>()
  const paperTrackUpdates = new Map<string, { insertAfterPaperTrack?: string; orderInGap: number; snapIndex?: number }>()
  const stackGuideUpdates = new Map<string, { insertAfterPaperTrack?: string; orderInGap: number }>()
  const templateOrderUpdates = new Map<string, number>()
  let currentTemplateAnchor: string | undefined
  let paperDisplayIndex = 0

  function nextOrderInGap(insertAfterPaperTrack: string | undefined) {
    const key = insertAfterPaperTrack ?? ''
    const next = gapOrder.get(key) ?? 0
    gapOrder.set(key, next + 1)
    return next
  }

  for (const itemId of orderedItemIds) {
    const item = currentItems.get(itemId)
    if (!item) continue
    if (item.kind === 'template-track') {
      currentTemplateAnchor = item.paperTrack
      templateOrderUpdates.set(item.paperTrack, paperDisplayIndex)
      paperDisplayIndex += 1
      continue
    }
    if (item.kind === 'overlay-track') {
      paperTrackUpdates.set(item.paperTrack, {
        insertAfterPaperTrack: currentTemplateAnchor,
        orderInGap: nextOrderInGap(currentTemplateAnchor),
        ...(syncViewOrder ? { snapIndex: paperDisplayIndex } : {}),
      })
      paperDisplayIndex += 1
      continue
    }
    stackGuideUpdates.set(item.labelId, {
      insertAfterPaperTrack: currentTemplateAnchor,
      orderInGap: nextOrderInGap(currentTemplateAnchor),
    })
  }

  const paperTracks = normalizePaperTracksForUi(project.logicalSheet.paperTracks.map(track => {
    const update = paperTrackUpdates.get(track.paperTrack)
    const orderUpdate = templateOrderUpdates.get(track.paperTrack)
    if (!update) {
      return typeof orderUpdate === 'number' ? { ...track, order: orderUpdate } : track
    }
    return {
      ...track,
      order: typeof orderUpdate === 'number' ? orderUpdate : track.order,
      exportPlacement: {
        ...track.exportPlacement,
        insertAfterPaperTrack: update.insertAfterPaperTrack,
        orderInGap: update.orderInGap,
      },
      viewPlacement: syncViewOrder
        ? {
            ...track.viewPlacement,
            snapIndex: update.snapIndex,
            expanded: true,
          }
        : track.viewPlacement,
    }
  }))
  const paperTrackIndex = new Map(paperTracks.map((track, index) => [track.paperTrack, index]))

  return {
    ...project,
    logicalSheet: {
      ...project.logicalSheet,
      paperTracks,
    },
    stackGuideLabels: project.stackGuideLabels.map(label => {
      const update = stackGuideUpdates.get(label.labelId)
      if (!update) return label
      return {
        ...label,
        insertAfterPaperTrack: update.insertAfterPaperTrack,
        gapIndex: update.insertAfterPaperTrack ? (paperTrackIndex.get(update.insertAfterPaperTrack) ?? -1) + 1 : 0,
        orderInGap: update.orderInGap,
      }
    }),
  }
}

function normalizePaperTracksForUi(paperTracks: PaperTrack[]): PaperTrack[] {
  const templateTracks = paperTracks.filter(track => track.source !== 'overlay').sort((a, b) => a.order - b.order || compareNaturalFileNameText(a.paperTrack, b.paperTrack))
  const templateOrder = new Map(templateTracks.map((track, index) => [track.paperTrack, index]))
  return [...paperTracks]
    .sort((a, b) => {
      const aKey = paperTrackExportSortKeyForUi(a, templateOrder)
      const bKey = paperTrackExportSortKeyForUi(b, templateOrder)
      return aKey.position - bKey.position
        || aKey.orderInGap - bKey.orderInGap
        || aKey.baseOrder - bKey.baseOrder
        || compareNaturalFileNameText(a.paperTrack, b.paperTrack)
    })
    .map((track, order) => ({ ...track, order }))
}

function paperTrackExportSortKeyForUi(track: PaperTrack, templateOrder: Map<string, number>): { position: number; orderInGap: number; baseOrder: number } {
  const baseOrder = templateOrder.get(track.paperTrack) ?? Number.MAX_SAFE_INTEGER
  if (track.source !== 'overlay') return { position: baseOrder, orderInGap: 0, baseOrder }
  const insertAfter = track.exportPlacement?.insertAfterPaperTrack
  const afterOrder = insertAfter ? templateOrder.get(insertAfter) : undefined
  return {
    position: (afterOrder ?? -1) + 0.5,
    orderInGap: track.exportPlacement?.orderInGap ?? 0,
    baseOrder,
  }
}
