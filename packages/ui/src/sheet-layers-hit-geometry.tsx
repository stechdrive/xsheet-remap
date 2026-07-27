import { cellRectForHit, createSheetPages, type CutProject, type NormalizedRect, type NormalizedPoint, type PaperTrack, type SheetHit, type SheetPage, type SheetTemplate, type SheetTimingRole, getSheetViewLayout, sheetTimingRoleForEvent, timelineLanesForLayout, timingHitForFrame, globalizeSheetHit, localizeFrameToSheetPage, isSpecialTimingEvent, logicalSheetDisplayDurationFrames, logicalSheetDisplayFrameStart, timingEventValueKind } from '@xsheet-remap/core'
import { resolveTimingTextFontSizePx } from './sheetTextLayout'
import { clampNumber } from './sheetInteraction'
import { overlayBandSegments, overlayPaperTracks, overlayVisibleSnapIndex, templatePaperTracks, type OverlayBandSegment } from './app-sheet-geometry'

export type SheetEventRectRenderItem = {
  event: CutProject['logicalSheet']['events'][number]
  eventKind: ReturnType<typeof timingEventValueKind>
  displayLabel: string
  fontSizePx: number
  rect: NormalizedRect
  hasAssetBinding: boolean
}

export function eventRectsForPages(
  project: CutProject,
  template: SheetTemplate,
  pages: SheetPage[],
  options: { activeOverlayPaperTrack?: string | null } = {},
): Map<string, SheetEventRectRenderItem[]> {
  const result = new Map(pages.map(page => [page.pageId, [] as SheetEventRectRenderItem[]]))
  if (pages.length === 0 || project.logicalSheet.events.length === 0) return result

  const paperTracks = templatePaperTracks(project, template).map(track => track.paperTrack)
  const timelineLanes = timelineLanesForLayout(project)
  const presentedOverlayTracks = new Set(overlayPaperTracks(project, template).map(track => track.paperTrack))
  const displayFrameStart = logicalSheetDisplayFrameStart(project.logicalSheet)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const pageById = new Map(pages.map(page => [page.pageId, page]))
  const keyById = new Map(project.logicalSheet.keys.map(key => [key.keyId, key]))
  const trackByName = new Map(project.logicalSheet.paperTracks.map(track => [track.paperTrack, track]))
  const assetBoundKeyIds = new Set(project.bindings.filter(binding => Boolean(binding.assetId)).map(binding => binding.keyId))
  const activeOverlayTrack = options.activeOverlayPaperTrack
    ? trackByName.get(options.activeOverlayPaperTrack)
    : undefined
  const activeOverlayColumnByPage = new Map(pages.map(page => [
    page.pageId,
    activeOverlayTrack?.source === 'overlay' ? overlayColumnRectForPage(template, project, activeOverlayTrack, page) : null,
  ]))

  for (const event of project.logicalSheet.events) {
    const key = keyById.get(event.keyId)
    if (!key && !isSpecialTimingEvent(event)) continue
    const eventKind = timingEventValueKind(event)
    const displayLabel = eventKind === 'cell' ? key?.displayLabel ?? '' : ''
    const sheetRole = sheetTimingRoleForEvent(event)
    const fontSizePx = resolveTimingTextFontSizePx(template, sheetRole, event.fontSizePx)
    const track = trackByName.get(event.paperTrack)
    let page: SheetPage | undefined
    let rect: NormalizedRect | null

    if (track && presentedOverlayTracks.has(track.paperTrack)) {
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

    if (!page || !rect || shouldSuppressRectUnderActiveOverlay(track, rect, activeOverlayColumnByPage.get(page.pageId) ?? null)) continue
    result.get(page.pageId)?.push({
      event,
      eventKind,
      displayLabel,
      fontSizePx,
      rect,
      hasAssetBinding: assetBoundKeyIds.has(event.keyId),
    })
  }

  return result
}

export function eventRectsForPage(project: CutProject, template: SheetTemplate, page: SheetPage, options: { activeOverlayPaperTrack?: string | null } = {}) {
  return eventRectsForPages(project, template, [page], options).get(page.pageId) ?? []
}

export function shouldSuppressRectUnderActiveOverlay(track: PaperTrack | undefined, rect: NormalizedRect, activeOverlayColumn: (OverlayBandSegment & { rect: NormalizedRect }) | null): boolean {
  if (!activeOverlayColumn || track?.source === 'overlay') return false
  return normalizedRectsOverlap(rect, activeOverlayColumn.rect)
}

function normalizedRectsOverlap(a: NormalizedRect, b: NormalizedRect): boolean {
  return a.x < b.x + b.w
    && a.x + a.w > b.x
    && a.y < b.y + b.h
    && a.y + a.h > b.y
}

export function rectForHit(project: CutProject, template: SheetTemplate, hit: SheetHit): NormalizedRect | null {
  const displayFrameStart = logicalSheetDisplayFrameStart(project.logicalSheet)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const track = hit.paperTrack ? project.logicalSheet.paperTracks.find(item => item.paperTrack === hit.paperTrack) : undefined
  if (track && overlayPaperTracks(project, template).some(candidate => candidate.paperTrack === track.paperTrack)) {
    const page = hit.pageId ? createSheetPages(template, displayDurationFrames, displayFrameStart).find(item => item.pageId === hit.pageId) : undefined
    return page ? overlayCellRectForFrame(template, project, track, hit.frame, page) : null
  }
  return cellRectForHit(template, hit, displayDurationFrames, displayFrameStart, {
    paperTracks: templatePaperTracks(project, template).map(track => track.paperTrack),
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

export function overlayHitFromPoint(template: SheetTemplate, project: CutProject, page: SheetPage, point: NormalizedPoint, activePaperTrack: string | null): SheetHit | null {
  if (!activePaperTrack) return null
  for (const track of overlayPaperTracks(project, template)) {
    if (track.paperTrack !== activePaperTrack) continue
    const column = overlayColumnRectForPage(template, project, track, page)
    if (!column) continue
    const rect = column.rect
    if (point.x < rect.x || point.x > rect.x + rect.w || point.y < rect.y || point.y > rect.y + rect.h) continue
    const rowIndex = clampNumber(Math.floor(((point.y - rect.y) / rect.h) * column.frames.rowCount), 0, column.frames.rowCount - 1)
    const localFrame = column.frames.frameStart + rowIndex
    const localHit: SheetHit = {
      regionId: `overlay:${track.paperTrack}:${column.regionId}`,
      role: track.viewPlacement?.sheetRole ?? 'cell',
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

function overlayCellRectForFrame(template: SheetTemplate, project: CutProject, track: PaperTrack, frame: number, page: SheetPage): NormalizedRect | null {
  const localized = localizeFrameToSheetPage(template, frame, logicalSheetDisplayDurationFrames(project.logicalSheet), logicalSheetDisplayFrameStart(project.logicalSheet))
  if (!localized || localized.page.pageId !== page.pageId) return null
  const column = overlayColumnRectForPage(template, project, track, page)
  if (!column) return null
  if (localized.localFrame < column.frames.frameStart || localized.localFrame > column.frames.frameEnd) return null
  const rowIndex = localized.localFrame - column.frames.frameStart
  const rowH = column.rect.h / column.frames.rowCount
  return {
    x: column.rect.x,
    y: column.rect.y + rowH * rowIndex,
    w: column.rect.w,
    h: rowH,
  }
}

export function overlayRangeRectForPage(template: SheetTemplate, project: CutProject, track: PaperTrack, frameStart: number, frameEnd: number, page: SheetPage): NormalizedRect | null {
  const start = Math.max(frameStart, page.frameStart)
  const end = Math.min(frameEnd, page.frameEnd)
  if (end < start) return null
  const startRect = overlayCellRectForFrame(template, project, track, start, page)
  const endRect = overlayCellRectForFrame(template, project, track, end, page)
  if (!startRect || !endRect) return null
  return {
    x: startRect.x,
    y: startRect.y,
    w: startRect.w,
    h: endRect.y + endRect.h - startRect.y,
  }
}

export function overlayHitForFrame(template: SheetTemplate, project: CutProject, track: PaperTrack, frame: number, page: SheetPage, role: SheetTimingRole): SheetHit | null {
  const localized = localizeFrameToSheetPage(template, frame, logicalSheetDisplayDurationFrames(project.logicalSheet), logicalSheetDisplayFrameStart(project.logicalSheet))
  if (!localized || localized.page.pageId !== page.pageId) return null
  const column = overlayColumnRectForPage(template, project, track, page)
  if (!column) return null
  if (localized.localFrame < column.frames.frameStart || localized.localFrame > column.frames.frameEnd) return null
  const rowIndex = localized.localFrame - column.frames.frameStart
  return {
    regionId: `overlay:${track.paperTrack}:${column.regionId}`,
    role,
    frame,
    localFrame: localized.localFrame,
    rowIndex,
    columnIndex: 0,
    columnId: `overlay_${track.paperTrack}`,
    label: track.label,
    paperTrack: track.paperTrack,
    pageId: page.pageId,
    pageIndex: page.pageIndex,
  }
}

export function overlayColumnRectForPage(template: SheetTemplate, project: CutProject, track: PaperTrack, page: SheetPage): (OverlayBandSegment & { rect: NormalizedRect }) | null {
  const role = track.viewPlacement?.sheetRole ?? 'cell'
  const segments = overlayBandSegments(template, project, role)
  const frameOrigin = frameOriginForPageHit(template, page)
  const segment = segments.find(item => {
    const segmentStart = page.frameStart + (item.frames.frameStart - frameOrigin)
    const segmentEnd = page.frameStart + (item.frames.frameEnd - frameOrigin)
    return page.frameStart <= segmentEnd && page.frameEnd >= segmentStart
  })
  if (!segment) return null
  const snapIndex = overlayVisibleSnapIndex(template, project, track, segment)
  const slot = segment.slots[snapIndex]
  if (!slot) return null
  return {
    ...segment,
    rect: {
      x: slot.x,
      y: segment.rect.y,
      w: slot.w,
      h: segment.rect.h,
    },
  }
}
