import { cellRectForHit, createSheetPages, type CutProject, type NormalizedRect, type NormalizedPoint, type PaperTrack, type SheetHit, type SheetPage, type SheetTemplate, type SheetTimingRole, getSheetViewLayout, sheetTimingRoleForEvent, timingHitForFrame, NULL_CELL_DISPLAY_LABEL, globalizeSheetHit, localizeFrameToSheetPage, isNullCellKeyId, logicalSheetDisplayDurationFrames, logicalSheetDisplayFrameStart } from '@xsheet-remap/core'
import { resolveTimingTextFontSizePx } from './sheetTextLayout'
import { clampNumber } from './sheetInteraction'
import { overlayBandSegments, overlayPaperTracks, templatePaperTracks, type OverlayBandSegment } from './app-sheet-geometry'

export function eventRectsForPage(project: CutProject, template: SheetTemplate, page: SheetPage, options: { activeOverlayPaperTrack?: string | null } = {}) {
  const paperTracks = templatePaperTracks(project).map(track => track.paperTrack)
  const displayFrameStart = logicalSheetDisplayFrameStart(project.logicalSheet)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const activeOverlayTrack = options.activeOverlayPaperTrack
    ? project.logicalSheet.paperTracks.find(track => track.paperTrack === options.activeOverlayPaperTrack && track.source === 'overlay')
    : undefined
  const activeOverlayColumn = activeOverlayTrack ? overlayColumnRectForPage(template, project, activeOverlayTrack, page) : null
  return project.logicalSheet.events.flatMap(event => {
    const key = project.logicalSheet.keys.find(item => item.keyId === event.keyId)
    if (!key && !isNullCellKeyId(event.keyId)) return []
    const displayLabel = isNullCellKeyId(event.keyId) ? NULL_CELL_DISPLAY_LABEL : key?.displayLabel ?? ''
    const sheetRole = sheetTimingRoleForEvent(event)
    const fontSizePx = resolveTimingTextFontSizePx(template, sheetRole, event.fontSizePx)
    const track = project.logicalSheet.paperTracks.find(item => item.paperTrack === event.paperTrack)
    const rect = track?.source === 'overlay'
      ? overlayCellRectForFrame(template, project, track, event.frame, page)
      : (() => {
          const hit = timingHitForFrame(template, sheetRole, event.paperTrack, event.frame, displayDurationFrames, displayFrameStart, paperTracks)
          if (!hit || hit.pageId !== page.pageId) return null
          return cellRectForHit(template, hit, displayDurationFrames, displayFrameStart, {
            paperTracks,
            layoutOverrides: project.sheetView.layoutOverrides,
          })
        })()
    const hasAssetBinding = project.bindings.some(binding => binding.keyId === event.keyId && Boolean(binding.assetId))
    if (rect && shouldSuppressRectUnderActiveOverlay(track, rect, activeOverlayColumn)) return []
    return rect ? [{ event, displayLabel, fontSizePx, rect, hasAssetBinding }] : []
  })
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
  if (track?.source === 'overlay') {
    const page = hit.pageId ? createSheetPages(template, displayDurationFrames, displayFrameStart).find(item => item.pageId === hit.pageId) : undefined
    return page ? overlayCellRectForFrame(template, project, track, hit.frame, page) : null
  }
  return cellRectForHit(template, hit, displayDurationFrames, displayFrameStart, {
    paperTracks: templatePaperTracks(project).map(track => track.paperTrack),
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
  for (const track of overlayPaperTracks(project)) {
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
  const snapIndex = clampNumber(Math.round(track.viewPlacement?.snapIndex ?? 0), 0, segment.snapCount)
  return {
    ...segment,
    rect: {
      x: segment.minX + segment.columnWidth * snapIndex,
      y: segment.rect.y,
      w: segment.columnWidth,
      h: segment.rect.h,
    },
  }
}
