import type { WheelEvent } from 'react'
import {
  createSheetPages,
  globalizeSheetHit,
  isInteractiveSheetTemplateGridRegion,
  resolveSheetTemplateGridColumns,
  resolveSheetTemplateGridFrames,
  resolveSheetTemplateGridLayout,
  sheetGridCellRect,
  type NormalizedRect,
  type SheetHit,
  type SheetGridLayoutOptions,
  type SheetPage,
  type SheetTemplate,
  type SheetTemplateInputMode,
  type SheetTimingRole,
} from '@xsheet-remap/core'
import { uiText } from './i18n'
import { SHEET_ZOOM_MAX, SHEET_ZOOM_MIN, WHEEL_LINE_SCROLL_PX } from './sheetConstants'
import type { EditMode, SheetRangeSelection } from './appTypes'

type LegacyWheelEvent = WheelEvent<HTMLElement>['nativeEvent'] & {
  wheelDelta?: number
  wheelDeltaX?: number
  wheelDeltaY?: number
}

type NativeLegacyWheelEvent = globalThis.WheelEvent & {
  wheelDelta?: number
  wheelDeltaX?: number
  wheelDeltaY?: number
}

export function wheelDeltaToPixels(event: WheelEvent<HTMLElement>, delta: number) {
  if (event.deltaMode === 1) return delta * WHEEL_LINE_SCROLL_PX
  if (event.deltaMode === 2) return delta * event.currentTarget.clientWidth
  return delta
}

export function nativeWheelDeltaToPixels(event: globalThis.WheelEvent, target: HTMLElement, delta: number) {
  if (event.deltaMode === 1) return delta * WHEEL_LINE_SCROLL_PX
  if (event.deltaMode === 2) return delta * target.clientWidth
  return delta
}

function legacyWheelNumber(event: WheelEvent<HTMLElement>, key: keyof LegacyWheelEvent) {
  const value = (event.nativeEvent as LegacyWheelEvent)[key]
  return typeof value === 'number' ? value : null
}

function nativeLegacyWheelNumber(event: globalThis.WheelEvent, key: keyof NativeLegacyWheelEvent) {
  const value = (event as NativeLegacyWheelEvent)[key]
  return typeof value === 'number' ? value : null
}

function horizontalWheelDelta(event: WheelEvent<HTMLElement>) {
  if (event.deltaX !== 0) return event.deltaX
  const legacyDeltaX = legacyWheelNumber(event, 'wheelDeltaX') ?? 0
  if (legacyDeltaX !== 0) return -legacyDeltaX
  return event.shiftKey ? event.deltaY : 0
}

export function nativeHorizontalWheelDelta(event: globalThis.WheelEvent) {
  if (event.deltaX !== 0) return event.deltaX
  const legacyDeltaX = nativeLegacyWheelNumber(event, 'wheelDeltaX') ?? 0
  if (legacyDeltaX !== 0) return -legacyDeltaX
  return event.shiftKey ? event.deltaY : 0
}

export function verticalWheelDelta(event: WheelEvent<HTMLElement>) {
  if (event.deltaY !== 0) return event.deltaY
  const legacyDeltaY = legacyWheelNumber(event, 'wheelDeltaY') ?? legacyWheelNumber(event, 'wheelDelta') ?? 0
  return legacyDeltaY === 0 ? 0 : -legacyDeltaY
}

export function nativeVerticalWheelDelta(event: globalThis.WheelEvent) {
  if (event.deltaY !== 0) return event.deltaY
  const legacyDeltaY = nativeLegacyWheelNumber(event, 'wheelDeltaY') ?? nativeLegacyWheelNumber(event, 'wheelDelta') ?? 0
  return legacyDeltaY === 0 ? 0 : -legacyDeltaY
}

export function handleHorizontalWheelScroll(event: WheelEvent<HTMLElement>) {
  const rawDelta = horizontalWheelDelta(event)
  if (rawDelta === 0) return false
  event.preventDefault()
  event.currentTarget.scrollLeft += wheelDeltaToPixels(event, rawDelta)
  return true
}

export function handleNativeHorizontalWheelScroll(event: globalThis.WheelEvent, target: HTMLElement) {
  const rawDelta = nativeHorizontalWheelDelta(event)
  if (rawDelta === 0) return false
  event.preventDefault()
  target.scrollLeft += nativeWheelDeltaToPixels(event, target, rawDelta)
  return true
}

/** Keeps document navigation and application zoom routing identical across sheet surfaces. */
export function nativeWheelUsesApplicationZoom(event: Pick<globalThis.WheelEvent, 'ctrlKey' | 'metaKey'>, zoomMode = false) {
  return zoomMode || event.ctrlKey || event.metaKey
}

export function enumerateTemplateCellHits(template: SheetTemplate, durationFrames = template.defaults.durationFrames, frameOrigin = template.defaults.frameOrigin): SheetHit[] {
  return enumerateTemplateTimingHits(template, 'cell', durationFrames, frameOrigin)
}

export function enumerateTemplateTimingHits(template: SheetTemplate, sheetRole: SheetTimingRole, durationFrames = template.defaults.durationFrames, frameOrigin = template.defaults.frameOrigin, paperTracks = template.defaults.paperTracks): SheetHit[] {
  return template.regions.flatMap(region => {
    if (!isInteractiveSheetTemplateGridRegion(region) || region.grid.role !== sheetRole) return []
    const columns = resolveSheetTemplateGridColumns(template, region.grid, paperTracks)
    const frames = resolveSheetTemplateGridFrames(template, region.grid, durationFrames, frameOrigin)
    const hits: SheetHit[] = []
    for (let rowIndex = 0; rowIndex < frames.rowCount; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
        const column = columns[columnIndex]
        if (!column.paperTrack) continue
        hits.push({
          regionId: region.regionId,
          role: sheetRole,
          frame: frames.frameStart + rowIndex,
          rowIndex,
          columnIndex,
          columnId: column.columnId,
          label: column.label,
          paperTrack: column.paperTrack,
        })
      }
    }
    return hits
  })
}

export function enumerateCellHits(template: SheetTemplate, durationFrames: number, frameOrigin: number): SheetHit[] {
  return createSheetPages(template, durationFrames, frameOrigin).flatMap(page =>
    enumerateTemplateCellHits(template, durationFrames, frameOrigin)
      .map(hit => globalizeSheetHit(template, hit, page))
      .filter(hit => hit.frame <= page.frameEnd),
  )
}

export function enumerateTimingHits(template: SheetTemplate, durationFrames: number, frameOrigin: number, sheetRole: SheetTimingRole, paperTracks = template.defaults.paperTracks): SheetHit[] {
  return createSheetPages(template, durationFrames, frameOrigin).flatMap(page =>
    enumerateTemplateTimingHits(template, sheetRole, durationFrames, frameOrigin, paperTracks)
      .map(hit => globalizeSheetHit(template, hit, page))
      .filter(hit => hit.frame <= page.frameEnd),
  )
}

export function nextTimingHit(template: SheetTemplate, durationFrames: number, frameOrigin: number, current: SheetHit | null, trackDelta: number, frameDelta: number, paperTracks = template.defaults.paperTracks): SheetHit | null {
  const sheetRole = current ? sheetRoleForHit(current) : 'cell'
  const hits = enumerateTimingHits(template, durationFrames, frameOrigin, sheetRole, paperTracks)
  if (hits.length === 0) return null
  if (!current?.paperTrack) return hits[0]

  const tracks = Array.from(new Set(hits.flatMap(hit => hit.paperTrack ? [hit.paperTrack] : [])))
  const frames = hits.map(hit => hit.frame)
  const minFrame = Math.min(...frames)
  const maxFrame = Math.max(...frames)
  const currentTrackIndex = Math.max(0, tracks.indexOf(current.paperTrack))
  const nextTrack = tracks[clampNumber(currentTrackIndex + trackDelta, 0, tracks.length - 1)] ?? current.paperTrack
  const nextFrame = clampNumber(current.frame + frameDelta, minFrame, maxFrame)
  return hits.find(hit => hit.paperTrack === nextTrack && hit.frame === nextFrame) ?? current
}

export type PointEventKeyboardNavigation =
  | { kind: 'cell'; hit: SheetHit; focusHit: SheetHit }
  | { kind: 'range'; range: SheetRangeSelection; focusHit: SheetHit }

export function navigatePointEventSelection(input: {
  template: SheetTemplate
  durationFrames: number
  frameOrigin: number
  currentHit: SheetHit | null
  range: SheetRangeSelection | null
  paperTracks: string[]
  trackDelta: number
  frameDelta: number
  extendRange: boolean
}): PointEventKeyboardNavigation | null {
  const move = (hit: SheetHit) => nextTimingHit(
    input.template,
    input.durationFrames,
    input.frameOrigin,
    hit,
    input.trackDelta,
    input.frameDelta,
    input.paperTracks,
  )
  const range = input.range
  if (range && (range.role === 'action' || range.role === 'cell') && range.paperTrack) {
    if (input.extendRange) {
      const focusHit = move(range.focusHit)
      if (!focusHit || sameHitCell(focusHit, range.focusHit)) return null
      const nextRange = rangeSelectionFromHits(input.template, range.anchorHit, focusHit, input.paperTracks)
      return nextRange ? { kind: 'range', range: nextRange, focusHit } : null
    }
    const anchorHit = move(range.anchorHit)
    const focusHit = move(range.focusHit)
    if (!anchorHit || !focusHit) return null
    const hitBoundary = (input.trackDelta !== 0 && (anchorHit.paperTrack === range.anchorHit.paperTrack || focusHit.paperTrack === range.focusHit.paperTrack))
      || (input.frameDelta !== 0 && (anchorHit.frame === range.anchorHit.frame || focusHit.frame === range.focusHit.frame))
    if (hitBoundary) return null
    const nextRange = rangeSelectionFromHits(input.template, anchorHit, focusHit, input.paperTracks)
    return nextRange ? { kind: 'range', range: nextRange, focusHit } : null
  }
  const hit = nextTimingHit(
    input.template,
    input.durationFrames,
    input.frameOrigin,
    input.currentHit,
    input.trackDelta,
    input.frameDelta,
    input.paperTracks,
  )
  if (!hit) return null
  if (!input.extendRange || !input.currentHit) return { kind: 'cell', hit, focusHit: hit }
  if (sameHitCell(input.currentHit, hit)) return null
  const nextRange = rangeSelectionFromHits(input.template, input.currentHit, hit, input.paperTracks)
  return nextRange ? { kind: 'range', range: nextRange, focusHit: hit } : null
}

function sameHitCell(left: SheetHit, right: SheetHit): boolean {
  return left.role === right.role && left.paperTrack === right.paperTrack && left.columnId === right.columnId && left.frame === right.frame
}

export function modeShortcut(key: string): EditMode | null {
  const shortcuts: Record<string, EditMode> = {
    p: 'pen',
  }
  return shortcuts[key.toLowerCase()] ?? null
}

export function isTimingValueCharacter(key: string): boolean {
  return key.length === 1 && !/\s/.test(key)
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function sheetRoleForHit(hit: Pick<SheetHit, 'role'>): SheetTimingRole {
  return hit.role === 'action' ? 'action' : 'cell'
}

export function sheetRoleLabel(sheetRole: SheetTimingRole): string {
  return uiText.sheetRoles[sheetRole]
}

export function clampSheetZoom(value: number): number {
  return clampNumber(value, SHEET_ZOOM_MIN, SHEET_ZOOM_MAX)
}

export function fitZoomForViewport(
  viewport: HTMLElement,
  pageSize: { widthPx: number; heightPx: number },
  inset: { horizontal: number; vertical: number },
): number | null {
  if (viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return null
  const availableWidth = Math.max(1, viewport.clientWidth - inset.horizontal)
  const availableHeight = Math.max(1, viewport.clientHeight - inset.vertical)
  return Math.min(
    availableWidth / pageSize.widthPx,
    availableHeight / pageSize.heightPx,
  )
}

export function candidateToHit(
  template: SheetTemplate,
  durationFrames: number,
  frameOrigin: number,
  candidate: { paperTrack: string; frame: number; sheetRole: SheetTimingRole },
  paperTracks: string[] = template.defaults.paperTracks,
): SheetHit | null {
  return enumerateTimingHits(template, durationFrames, frameOrigin, candidate.sheetRole, paperTracks)
    .find(hit => hit.paperTrack === candidate.paperTrack && hit.frame === candidate.frame) ?? null
}

export function rangeSelectionFromHits(template: SheetTemplate, anchorHit: SheetHit, focusHit: SheetHit, paperTracks = template.defaults.paperTracks): SheetRangeSelection | null {
  if (anchorHit.role !== focusHit.role) return null
  const anchorRegion = template.regions.find(region => region.regionId === anchorHit.regionId)
  const focusRegion = template.regions.find(region => region.regionId === focusHit.regionId)
  const isPointEventRole = anchorHit.role === 'action' || anchorHit.role === 'cell'
  const bothPaperTracks = Boolean(anchorHit.paperTrack && focusHit.paperTrack)
  if (!isPointEventRole || !bothPaperTracks) {
    if (anchorHit.columnId !== focusHit.columnId) return null
    if (anchorHit.paperTrack !== focusHit.paperTrack) return null
  }
  if ((anchorRegion && !anchorRegion.grid) || (focusRegion && !focusRegion.grid)) return null
  if (!anchorRegion && !isPointEventRole) return null
  if (!focusRegion && !isPointEventRole) return null
  const flowRegion = anchorRegion ?? focusRegion
  const flowGroupId = flowRegion?.flowGroupId ?? flowRegion?.regionId ?? `virtual:${anchorHit.role}`
  const focusFlowGroupId = focusRegion?.flowGroupId ?? focusRegion?.regionId ?? `virtual:${focusHit.role}`
  if (anchorRegion && focusRegion && focusFlowGroupId !== flowGroupId) return null
  const inputMode = anchorRegion ? inputModeForRegion(anchorRegion) : 'point-event'
  const selectedPaperTracks = isPointEventRole && anchorHit.paperTrack && focusHit.paperTrack
    ? paperTracksBetween(paperTracks, anchorHit.paperTrack, focusHit.paperTrack)
    : anchorHit.paperTrack ? [anchorHit.paperTrack] : []
  if (isPointEventRole && selectedPaperTracks.length === 0) return null
  return {
    role: anchorHit.role,
    inputMode,
    frameStart: Math.min(anchorHit.frame, focusHit.frame),
    frameEnd: Math.max(anchorHit.frame, focusHit.frame),
    anchorFrame: anchorHit.frame,
    focusFrame: focusHit.frame,
    columnId: anchorHit.columnId,
    paperTracks: selectedPaperTracks,
    paperTrack: anchorHit.paperTrack,
    flowGroupId,
    anchorHit,
    focusHit,
  }
}

export function rangeRectsForPage(
  template: SheetTemplate,
  range: SheetRangeSelection,
  page: SheetPage,
  options: SheetGridLayoutOptions = {},
): NormalizedRect[] {
  const rects: NormalizedRect[] = []
  const paperTracks = options.paperTracks ?? template.defaults.paperTracks
  const durationFrames = options.durationFrames ?? page.frameEnd - page.frameStart + 1
  const frameOrigin = options.frameOrigin ?? template.defaults.frameOrigin
  const localStart = range.frameStart - page.frameStart + frameOrigin
  const localEnd = range.frameEnd - page.frameStart + frameOrigin
  const selectedPaperTracks = new Set(range.paperTracks.length > 0 ? range.paperTracks : range.paperTrack ? [range.paperTrack] : [])

  for (const region of template.regions) {
    if (!isInteractiveSheetTemplateGridRegion(region) || region.grid.role !== range.role) continue
    if ((region.flowGroupId ?? region.regionId) !== range.flowGroupId) continue
    const layout = resolveSheetTemplateGridLayout(template, region, {
      ...options,
      paperTracks,
      durationFrames,
      frameOrigin,
    })
    if (!layout) continue
    const columns = layout.columns
    const frames = layout.frames
    const start = Math.max(localStart, frames.frameStart)
    const end = Math.min(localEnd, frames.frameEnd)
    if (end < start) continue
    const rowIndex = start - frames.frameStart
    const rowCount = end - start + 1
    if (selectedPaperTracks.size > 0) {
      columns.forEach((column, index) => {
        if (!column.paperTrack || !selectedPaperTracks.has(column.paperTrack)) return
        const first = sheetGridCellRect(layout, index, rowIndex)
        if (!first) return
        rects.push({
          x: first.x,
          y: first.y,
          w: first.w,
          h: frames.rowHeight * rowCount,
        })
      })
    } else {
      const columnIndex = range.paperTrack
        ? columns.findIndex(column => column.paperTrack === range.paperTrack)
        : columns.findIndex(column => column.columnId === range.columnId)
      if (columnIndex < 0) continue
      const first = sheetGridCellRect(layout, columnIndex, rowIndex)
      if (!first) continue
      rects.push({
        x: first.x,
        y: first.y,
        w: first.w,
        h: frames.rowHeight * rowCount,
      })
    }
  }
  return rects
}

function paperTracksBetween(paperTracks: string[], anchorPaperTrack: string, focusPaperTrack: string): string[] {
  const anchorIndex = paperTracks.indexOf(anchorPaperTrack)
  const focusIndex = paperTracks.indexOf(focusPaperTrack)
  if (anchorIndex < 0 || focusIndex < 0) return anchorPaperTrack === focusPaperTrack ? [anchorPaperTrack] : []
  const start = Math.min(anchorIndex, focusIndex)
  const end = Math.max(anchorIndex, focusIndex)
  return paperTracks.slice(start, end + 1)
}

function inputModeForRegion(region: SheetTemplate['regions'][number]): SheetTemplateInputMode {
  if (region.inputMode) return region.inputMode
  if (region.grid?.role === 'sound' || region.grid?.role === 'camera') return 'timed-range'
  if (region.grid?.role === 'action' || region.grid?.role === 'cell') return 'point-event'
  return 'reference'
}
