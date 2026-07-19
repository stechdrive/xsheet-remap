import type { CutProject, PaperTrack, StackGuideLabel, StackGuideStackBand } from './types'
import { stackGuideStackBand } from './project-shared'

const naturalFileNameCollator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' })

function compareNaturalFileNameText(a: string, b: string): number {
  return naturalFileNameCollator.compare(a, b) || a.localeCompare(b, 'ja')
}

export type CellStackOrderItem =
  | { id: string; kind: 'template-track'; label: string; paperTrack: string }
  | { id: string; kind: 'overlay-track'; label: string; paperTrack: string }
  | { id: string; kind: 'stack-guide'; label: string; labelId: string }

export type CspStackReorderEdge = 'before' | 'after'

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
      paperTrack: track.paperTrack,
    })
  }
  for (const label of project.stackGuideLabels) {
    if (stackGuideStackBand(label) !== 'cell-interleave') continue
    addGapEntry(stackGuideAnchorForCellOrder(project, label), label.orderInGap, {
      id: `stack:${label.labelId}`,
      kind: 'stack-guide',
      label: label.label,
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
  const stackGuideUpdates = new Map<string, { insertAfterPaperTrack?: string; orderInGap: number; clearViewOverride: boolean }>()
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
      clearViewOverride: syncViewOrder,
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
        ...(update.clearViewOverride ? { viewSnapIndex: undefined } : {}),
      }
    }),
  }
}

export function moveCellStackOrderItem(
  project: CutProject,
  itemId: string,
  direction: 'up' | 'down',
  syncViewOrder: boolean,
): CutProject | null {
  const items = cellStackOrderItems(project)
  const currentIndex = items.findIndex(item => item.id === itemId)
  const targetIndex = currentIndex + (direction === 'up' ? 1 : -1)
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= items.length) return null
  const orderedIds = items.map(item => item.id)
  const [moved] = orderedIds.splice(currentIndex, 1)
  orderedIds.splice(targetIndex, 0, moved)

  return applyStableCellStackOrder(project, orderedIds, syncViewOrder)
}

/**
 * Reorders a CSP track by stable item ids. `before` and `after` are expressed
 * in the order users see in CSP (top-to-bottom), while cellStackOrderItems is
 * the XDTS/paper order (bottom-to-top). Keeping that reversal here prevents
 * every UI from reimplementing the direction conversion.
 */
export function reorderCspStackItem(
  project: CutProject,
  itemId: string,
  referenceItemId: string,
  edge: CspStackReorderEdge,
  syncViewOrder: boolean,
): CutProject | null {
  if (itemId === referenceItemId) return null
  const cellItems = cellStackOrderItems(project)
  const cellItemIds = new Set(cellItems.map(item => item.id))
  if (cellItemIds.has(itemId) || cellItemIds.has(referenceItemId)) {
    if (!cellItemIds.has(itemId) || !cellItemIds.has(referenceItemId)) return null
    const cspTopToBottom = cellItems.map(item => item.id).reverse()
    const reordered = reorderIdsByReference(cspTopToBottom, itemId, referenceItemId, edge)
    if (!reordered) return null
    return applyStableCellStackOrder(project, reordered.reverse(), syncViewOrder)
  }

  const itemLabel = stackGuideLabelFromItemId(project, itemId)
  const referenceLabel = stackGuideLabelFromItemId(project, referenceItemId)
  if (!itemLabel || !referenceLabel) return null
  const band = stackGuideStackBand(itemLabel)
  if (band === 'cell-interleave' || stackGuideStackBand(referenceLabel) !== band) return null
  const cspTopToBottom = stackGuideIdsForBandTopToBottom(project, band)
  const reordered = reorderIdsByReference(cspTopToBottom, itemId, referenceItemId, edge)
  if (!reordered) return null
  const orderById = new Map(reordered.map((id, index) => [id, reordered.length - index - 1]))
  return {
    ...project,
    stackGuideLabels: project.stackGuideLabels.map(label => {
      const orderInGap = orderById.get(`stack:${label.labelId}`)
      return typeof orderInGap === 'number' && orderInGap !== label.orderInGap
        ? { ...label, orderInGap }
        : label
    }),
  }
}

export function cspStackReorderScope(project: CutProject, itemId: string): StackGuideStackBand | null {
  if (cellStackOrderItems(project).some(item => item.id === itemId)) return 'cell-interleave'
  const label = stackGuideLabelFromItemId(project, itemId)
  return label ? stackGuideStackBand(label) : null
}

function applyStableCellStackOrder(project: CutProject, orderedIds: string[], syncViewOrder: boolean): CutProject {
  const items = cellStackOrderItems(project)
  const currentIds = items.map(item => item.id)
  if (orderedIds.length !== currentIds.length || new Set(orderedIds).size !== currentIds.length) return project
  if (currentIds.some(id => !orderedIds.includes(id))) return project

  const itemById = new Map(items.map(item => [item.id, item]))
  const desiredAuxiliaryPlacement = new Map<string, { insertAfterPaperTrack?: string; orderInGap: number }>()
  const nextOrderByAnchor = new Map<string, number>()
  let currentTemplateAnchor: string | undefined
  for (const orderedId of orderedIds) {
    const item = itemById.get(orderedId)
    if (!item) continue
    if (item.kind === 'template-track') {
      currentTemplateAnchor = item.paperTrack
      continue
    }
    const anchorKey = currentTemplateAnchor ?? ''
    const orderInGap = nextOrderByAnchor.get(anchorKey) ?? 0
    nextOrderByAnchor.set(anchorKey, orderInGap + 1)
    desiredAuxiliaryPlacement.set(item.id, { insertAfterPaperTrack: currentTemplateAnchor, orderInGap })
  }

  const templateOrder = new Map(
    orderedIds
      .map(id => itemById.get(id))
      .filter((item): item is Extract<CellStackOrderItem, { kind: 'template-track' }> => item?.kind === 'template-track')
      .map((item, index) => [item.paperTrack, index]),
  )
  const originalAuxiliaryAnchor = new Map<string, string | undefined>()
  for (const item of items) {
    if (item.kind === 'overlay-track') {
      originalAuxiliaryAnchor.set(item.id, project.logicalSheet.paperTracks.find(track => track.paperTrack === item.paperTrack)?.exportPlacement?.insertAfterPaperTrack)
    } else if (item.kind === 'stack-guide') {
      const label = project.stackGuideLabels.find(candidate => candidate.labelId === item.labelId)
      originalAuxiliaryAnchor.set(item.id, label ? stackGuideAnchorForCellOrder(project, label) : undefined)
    }
  }
  const movedAcrossTemplate = new Set<string>()
  if (syncViewOrder) {
    for (const [id, placement] of desiredAuxiliaryPlacement) {
      if (originalAuxiliaryAnchor.get(id) !== placement.insertAfterPaperTrack) movedAcrossTemplate.add(id)
    }
  }

  // A one-step button move changes only the two adjacent stack entries. Keep
  // every other track object, view override, and display role intact. We only
  // normalize orderInGap values; unlike the previous full apply, this cannot
  // rewrite unrelated label anchors or push them outside another role's grid.
  const paperTracks = project.logicalSheet.paperTracks.map(track => {
    if (track.source !== 'overlay') {
      const order = templateOrder.get(track.paperTrack)
      return typeof order === 'number' && order !== track.order ? { ...track, order } : track
    }
    const itemIdForTrack = `paper:${track.paperTrack}`
    const placement = desiredAuxiliaryPlacement.get(itemIdForTrack)
    if (!placement) return track
    const nextViewPlacement = movedAcrossTemplate.has(itemIdForTrack)
      ? {
          ...track.viewPlacement,
          snapIndex: cellStackViewSnapIndexFromTemplateOrder(templateOrder, placement.insertAfterPaperTrack),
          expanded: true,
        }
      : track.viewPlacement
    return {
      ...track,
      exportPlacement: {
        ...track.exportPlacement,
        insertAfterPaperTrack: placement.insertAfterPaperTrack,
        orderInGap: placement.orderInGap,
      },
      viewPlacement: nextViewPlacement,
    }
  })

  const stackGuideLabels = project.stackGuideLabels.map(label => {
    const itemIdForLabel = `stack:${label.labelId}`
    const placement = desiredAuxiliaryPlacement.get(itemIdForLabel)
    if (!placement) return label
    const anchorIndex = placement.insertAfterPaperTrack ? templateOrder.get(placement.insertAfterPaperTrack) : undefined
    return {
      ...label,
      insertAfterPaperTrack: placement.insertAfterPaperTrack,
      gapIndex: typeof anchorIndex === 'number' ? anchorIndex + 1 : 0,
      orderInGap: placement.orderInGap,
      ...(movedAcrossTemplate.has(itemIdForLabel)
        ? { viewSnapIndex: cellStackViewSnapIndexFromTemplateOrder(templateOrder, placement.insertAfterPaperTrack) }
        : {}),
    }
  })

  return {
    ...project,
    logicalSheet: {
      ...project.logicalSheet,
      paperTracks,
    },
    stackGuideLabels,
  }
}

function stackGuideLabelFromItemId(project: CutProject, itemId: string): StackGuideLabel | undefined {
  if (!itemId.startsWith('stack:')) return undefined
  return project.stackGuideLabels.find(label => label.labelId === itemId.slice('stack:'.length))
}

function stackGuideIdsForBandTopToBottom(project: CutProject, band: Exclude<StackGuideStackBand, 'cell-interleave'>): string[] {
  return project.stackGuideLabels
    .filter(label => stackGuideStackBand(label) === band)
    .sort((a, b) =>
      b.orderInGap - a.orderInGap
      || b.label.localeCompare(a.label, 'ja')
      || b.labelId.localeCompare(a.labelId, 'ja'),
    )
    .map(label => `stack:${label.labelId}`)
}

function reorderIdsByReference(ids: string[], itemId: string, referenceItemId: string, edge: CspStackReorderEdge): string[] | null {
  const sourceIndex = ids.indexOf(itemId)
  if (sourceIndex < 0 || !ids.includes(referenceItemId)) return null
  const next = ids.filter(id => id !== itemId)
  const referenceIndex = next.indexOf(referenceItemId)
  if (referenceIndex < 0) return null
  next.splice(referenceIndex + (edge === 'after' ? 1 : 0), 0, itemId)
  return next.every((id, index) => id === ids[index]) ? null : next
}

function cellStackViewSnapIndexFromTemplateOrder(templateOrder: Map<string, number>, insertAfterPaperTrack: string | undefined): number {
  if (!insertAfterPaperTrack) return 0
  const index = templateOrder.get(insertAfterPaperTrack)
  return typeof index === 'number' ? index + 2 : 0
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
