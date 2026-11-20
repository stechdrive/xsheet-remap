import { paperTrackDisplayRole, cellRectForHit, createSheetPages, type CutProject, type NormalizedRect, type NormalizedPoint, type PaperTrack, type SheetHit, type SheetPage, type SheetTemplate, type SheetTimingRole, getSheetViewLayout, sheetTimingRoleForEvent, timelineLanesForLayout, timingHitForFrame, globalizeSheetHit, localizeFrameToSheetPage, isSpecialTimingEvent, logicalSheetDisplayDurationFrames, logicalSheetDisplayFrameStart, timingEventValueKind } from '@xsheet-remap/core'
import { defaultTimingTextMinFontSizePx, resolveTimingTextFontSizePx } from './sheetTextLayout'
import { resolveSheetTemplatePageSize, projectSheetLayoutOptions, timingReferenceAddress, timingReferenceMap } from '@xsheet-remap/core'
import { layoutTimingCellText, type TimingCellTextLayout } from './timingCellTextLayout'
import { timingEventsInRange, timingKeyIndex, type TimelineEvent, type TimingKey } from '@xsheet-remap/core'
import type { SheetContentInput, SheetGeometryInput } from '@xsheet-remap/core'
import { clampNumber } from './sheetInteraction'
import { overlayColumnsForPage, overlayColumnAtFrame, overlayCellRect, overlayPaperTracks, type OverlayBandSegment } from './app-sheet-geometry'

export type SheetEventRectRenderItem = {
  event: CutProject['logicalSheet']['events'][number]
  eventKind: ReturnType<typeof timingEventValueKind>
  displayLabel: string
  fontSizePx: number
  rect: NormalizedRect
  hasAssetBinding: boolean
  textLayout: TimingCellTextLayout
}
export type SheetEventGeometryCache = WeakMap<TimelineEvent, { item: SheetEventRectRenderItem; key: TimingKey | undefined; pageId: string }>

export function eventRectsForPages(
  project: SheetContentInput,
  template: SheetTemplate,
  pages: SheetPage[],
  options: { activeOverlayPaperTrack?: string | null; frameRange?: { start: number; end: number }; cache?: SheetEventGeometryCache } = {},
): Map<string, SheetEventRectRenderItem[]> {
  const result = new Map(pages.map(page => [page.pageId, [] as SheetEventRectRenderItem[]]))
  if (pages.length === 0 || project.logicalSheet.events.length === 0) return result
  const layoutOptions = projectSheetLayoutOptions(project, template)
  const pageSize = resolveSheetTemplatePageSize(template, logicalSheetDisplayDurationFrames(project.logicalSheet), layoutOptions)
  const references = timingReferenceMap(project.logicalSheet.referenceMarks)

  const paperTracks = layoutOptions.paperTracks
  const timelineLanes = timelineLanesForLayout(project)
  const presentedOverlayTracks = new Set(overlayPaperTracks(project, template).map(track => track.paperTrack))
  const displayFrameStart = logicalSheetDisplayFrameStart(project.logicalSheet)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const pageById = new Map(pages.map(page => [page.pageId, page]))
  const keyById = timingKeyIndex(project.logicalSheet.keys)
  const trackByName = new Map(project.logicalSheet.paperTracks.map(track => [track.paperTrack, track]))
  const assetBoundKeyIds = new Set(project.bindings.filter(binding => Boolean(binding.assetId)).map(binding => binding.keyId))
  const activeOverlayTrack = options.activeOverlayPaperTrack
    ? trackByName.get(options.activeOverlayPaperTrack)
    : undefined
  const activeOverlayColumnsByPage = new Map(pages.map(page => [
    page.pageId,
    activeOverlayTrack && presentedOverlayTracks.has(activeOverlayTrack.paperTrack) ? overlayColumnsForPage(template, project, activeOverlayTrack, page) : [],
  ]))

  const candidates = pages.flatMap(page => timingEventsInRange(project.logicalSheet.events,
    Math.max(page.frameStart, options.frameRange?.start ?? page.frameStart), Math.min(page.frameEnd, options.frameRange?.end ?? page.frameEnd)))
  for (const event of candidates) {
    const key = keyById.get(event.keyId)
    if (!key && !isSpecialTimingEvent(event)) continue
    const cached = options.cache?.get(event)
    const reference = !isSpecialTimingEvent(event) ? references.get(timingReferenceAddress(event)) : undefined
    const cachedReference = cached?.item.textLayout.reference
    const cachedShape = cachedReference ? cachedReference.ellipse ? 'circle' : 'triangle' : undefined
    if (cached && cached.key === key && cachedShape === reference && cached.item.hasAssetBinding === assetBoundKeyIds.has(event.keyId)) {
      result.get(cached.pageId)?.push(cached.item)
      continue
    }
    const eventKind = timingEventValueKind(event)
    const displayLabel = eventKind === 'cell' ? key?.displayLabel ?? '' : ''
    const sheetRole = sheetTimingRoleForEvent(event)
    const fontSizePx = resolveTimingTextFontSizePx(template, sheetRole, event.fontSizePx)
    const track = trackByName.get(event.paperTrack)
    let page: SheetPage | undefined
    let rect: NormalizedRect | null

    if (track && paperTrackDisplayRole(track) === sheetRole && presentedOverlayTracks.has(track.paperTrack)) {
      const localized = localizeFrameToSheetPage(template, event.frame, displayDurationFrames, displayFrameStart)
      page = localized ? pageById.get(localized.page.pageId) : undefined
      rect = page ? overlayCellRectForFrame(template, project, track, event.frame, page) : null
    } else {
      const hit = timingHitForFrame(template, sheetRole, event.paperTrack, event.frame, displayDurationFrames, displayFrameStart, paperTracks)
      page = hit?.pageId ? pageById.get(hit.pageId) : undefined
      rect = hit && page
        ? cellRectForHit(template, hit, displayDurationFrames, displayFrameStart, {
            paperTracks,
            timelineLanes,
            layoutOverrides: project.sheetView.layoutOverrides,
          })
        : null
    }

    if (!page || !rect || (!presentedOverlayTracks.has(event.paperTrack) && shouldSuppressRectUnderActiveOverlay(track, rect, activeOverlayColumnsByPage.get(page.pageId) ?? []))) continue
    const item = {
      event,
      eventKind,
      displayLabel,
      fontSizePx,
      rect,
      hasAssetBinding: assetBoundKeyIds.has(event.keyId),
      textLayout: layoutTimingCellText(displayLabel, fontSizePx, defaultTimingTextMinFontSizePx(template, sheetRole), rect, pageSize, undefined, reference, event.fontSizeMode !== 'fixed', event.fontSizeMode === 'fit'),
    }
    result.get(page.pageId)?.push(item)
    options.cache?.set(event, { item, key, pageId: page.pageId })
  }

  return result
}

export function eventRectsForPage(project: CutProject, template: SheetTemplate, page: SheetPage, options: { activeOverlayPaperTrack?: string | null } = {}) {
  return eventRectsForPages(project, template, [page], options).get(page.pageId) ?? []
}

export function shouldSuppressRectUnderActiveOverlay(track: PaperTrack | undefined, rect: NormalizedRect, columns: readonly (Pick<OverlayBandSegment, 'rect'> & { paperTrack?: string })[]): boolean {
  return track?.source !== 'overlay' && columns.some(column => (!track || track.paperTrack !== column.paperTrack) && normalizedRectsOverlap(rect, column.rect))
}

function normalizedRectsOverlap(a: NormalizedRect, b: NormalizedRect): boolean {
  return a.x < b.x + b.w
    && a.x + a.w > b.x
    && a.y < b.y + b.h
    && a.y + a.h > b.y
}

export function rectForHit(project: SheetGeometryInput, template: SheetTemplate, hit: SheetHit): NormalizedRect | null {
  const displayFrameStart = logicalSheetDisplayFrameStart(project.logicalSheet)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const track = hit.paperTrack ? project.logicalSheet.paperTracks.find(item => item.paperTrack === hit.paperTrack) : undefined
  if (track && paperTrackDisplayRole(track) === hit.role && overlayPaperTracks(project, template).some(candidate => candidate.paperTrack === track.paperTrack)) {
    const page = hit.pageId ? createSheetPages(template, displayDurationFrames, displayFrameStart).find(item => item.pageId === hit.pageId) : undefined
    return page ? overlayCellRectForFrame(template, project, track, hit.frame, page) : null
  }
  return cellRectForHit(template, hit, displayDurationFrames, displayFrameStart, {
    paperTracks: projectSheetLayoutOptions(project, template).paperTracks,
    timelineLanes: timelineLanesForLayout(project),
    layoutOverrides: project.sheetView.layoutOverrides,
  })
}

export function frameOriginForPageHit(template: SheetTemplate, page: SheetPage): number {
  const layout = getSheetViewLayout(template)
  return layout.frameAxis?.type === 'continuous' || layout.frameAxis?.type === 'infinite'
    ? page.frameStart
    : template.defaults.frameOrigin
}

export function materializePageHit(template: SheetTemplate, hit: SheetHit, page: SheetPage): SheetHit {
  const layout = getSheetViewLayout(template)
  if (layout.frameAxis?.type === 'continuous' || layout.frameAxis?.type === 'infinite') {
    return {
      ...hit,
      localFrame: hit.localFrame ?? hit.frame,
      pageId: page.pageId,
      pageIndex: page.pageIndex,
    }
  }
  return globalizeSheetHit(template, hit, page)
}

export function nextOverlayTrackNameForUi(project: CutProject): string {
  const used = new Set(project.logicalSheet.paperTracks.map(track => track.paperTrack))
  for (let code = 0; code < 26; code += 1) {
    const candidate = String.fromCharCode(74 + code)
    if (!used.has(candidate)) return candidate
  }
  return '追加'
}

/** Resolve logical timing targets using the same columns as the paper renderer. */
export function projectTimingHitForFrame(template: SheetTemplate, project: SheetGeometryInput, role: SheetTimingRole, paperTrack: string, frame: number): SheetHit | null {
  const duration = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const origin = logicalSheetDisplayFrameStart(project.logicalSheet)
  const overlay = overlayPaperTracks(project, template).find(track =>
    track.paperTrack === paperTrack && (paperTrackDisplayRole(track)) === role,
  )
  if (overlay) {
    const localized = localizeFrameToSheetPage(template, frame, duration, origin)
    return localized ? overlayHitForFrame(template, project, overlay, frame, localized.page, role) : null
  }
  return timingHitForFrame(template, role, paperTrack, frame, duration, origin, projectSheetLayoutOptions(project, template).paperTracks)
}

export function overlayHitFromPoint(template: SheetTemplate, project: CutProject, page: SheetPage, point: NormalizedPoint, activePaperTrack: string | null): SheetHit | null {
  const track = overlayPaperTracks(project, template).find(item => item.paperTrack === activePaperTrack)
  if (!track) return null
  for (const column of overlayColumnsForPage(template, project, track, page)) {
    const rect = column.rect
    if (point.x < rect.x || point.x > rect.x + rect.w || point.y < rect.y || point.y > rect.y + rect.h) continue
    const rowIndex = clampNumber(Math.floor(((point.y - rect.y) / rect.h) * column.frames.rowCount), 0, column.frames.rowCount - 1)
    const localFrame = column.frames.frameStart + rowIndex
    const localHit: SheetHit = {
      regionId: `overlay:${track.paperTrack}:${column.regionId}`,
      role: paperTrackDisplayRole(track),
      frame: localFrame,
      localFrame,
      rowIndex,
      columnIndex: 0,
      columnId: `overlay_${track.paperTrack}`,
      label: track.label,
      paperTrack: track.paperTrack,
    }
    const hit = materializePageHit(template, localHit, page)
    return hit.frame <= page.frameEnd ? localHit : null
  }
  return null
}

function overlayCellRectForFrame(template: SheetTemplate, project: SheetGeometryInput, track: PaperTrack, frame: number, page: SheetPage): NormalizedRect | null {
  if (frame < page.frameStart || frame > page.frameEnd) return null
  const column = overlayColumnAtFrame(overlayColumnsForPage(template, project, track, page), frame)
  return column ? overlayCellRect(column, frame) : null
}

export function overlayRangeRectsForPage(template: SheetTemplate, project: SheetGeometryInput, track: PaperTrack, frameStart: number, frameEnd: number, page: SheetPage): NormalizedRect[] {
  return overlayColumnsForPage(template, project, track, page).flatMap(column => {
    const start = Math.max(frameStart, page.frameStart, column.globalFrameStart)
    const end = Math.min(frameEnd, page.frameEnd, column.globalFrameEnd)
    if (start > end) return []
    const rect = overlayCellRect(column, start)
    return [{ ...rect, h: rect.h * (end - start + 1) }]
  })
}

export function overlayHitForFrame(template: SheetTemplate, project: SheetGeometryInput, track: PaperTrack, frame: number, page: SheetPage, role: SheetTimingRole): SheetHit | null {
  if (frame < page.frameStart || frame > page.frameEnd) return null
  const column = overlayColumnAtFrame(overlayColumnsForPage(template, project, track, page), frame)
  if (!column) return null
  const rowIndex = frame - column.globalFrameStart
  return {
    regionId: `overlay:${track.paperTrack}:${column.regionId}`,
    role,
    frame,
    localFrame: column.frames.frameStart + rowIndex,
    rowIndex,
    columnIndex: 0,
    columnId: `overlay_${track.paperTrack}`,
    label: track.label,
    paperTrack: track.paperTrack,
    pageId: page.pageId,
    pageIndex: page.pageIndex,
  }
}

export { overlayColumnsForPage } from './app-sheet-geometry'
