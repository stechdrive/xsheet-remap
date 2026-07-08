import type { LogicalSheet, LogicalSheetWorkRange } from './types'
import { getSheetViewLayout, standardA3SheetTemplate, type SheetTemplate } from './sheet-template'

export const DEFAULT_PRE_ROLL_FRAMES = 24

export function defaultLogicalSheetWorkRange(template: Pick<SheetTemplate, 'viewLayout' | 'pageModel'> = standardA3SheetTemplate): LogicalSheetWorkRange {
  const defaults = getSheetViewLayout(template).workRange
  return normalizeLogicalSheetWorkRange({
    preRollFrames: defaults?.preRollFrames ?? DEFAULT_PRE_ROLL_FRAMES,
    postRollFrames: defaults?.postRollFrames ?? 0,
    showPreRoll: defaults?.showPreRoll ?? false,
    showPostRoll: defaults?.showPostRoll ?? true,
  })
}

export function normalizeLogicalSheetWorkRange(input: Partial<LogicalSheetWorkRange> | undefined): LogicalSheetWorkRange {
  return {
    preRollFrames: Math.max(0, Math.round(input?.preRollFrames ?? DEFAULT_PRE_ROLL_FRAMES)),
    postRollFrames: Math.max(0, Math.round(input?.postRollFrames ?? 0)),
    showPreRoll: Boolean(input?.showPreRoll),
    showPostRoll: true,
  }
}

export function logicalSheetOfficialFrameEnd(sheet: Pick<LogicalSheet, 'frameOrigin' | 'durationFrames'>): number {
  return sheet.frameOrigin + Math.max(1, Math.round(sheet.durationFrames)) - 1
}

export function logicalSheetFrameNumber(sheet: Pick<LogicalSheet, 'frameOrigin'>, frame: number): number {
  return Math.round(frame) - Math.round(sheet.frameOrigin) + 1
}

export function formatLogicalSheetFrameTimecode(frame: number, frameOrigin: number, fps: number): string {
  const safeFps = Math.max(1, Math.round(fps))
  const offset = Math.round(frame) - Math.round(frameOrigin)
  if (offset >= 0) {
    const seconds = Math.floor(offset / safeFps)
    const koma = (offset % safeFps) + 1
    return `${seconds}+${koma}`
  }

  const framesBefore = Math.abs(offset)
  const seconds = Math.floor((framesBefore - 1) / safeFps)
  const koma = ((framesBefore - 1) % safeFps) + 1
  return `-${seconds}+${koma}`
}

export function logicalSheetWorkRange(sheet: Pick<LogicalSheet, 'workRange'>): LogicalSheetWorkRange {
  return normalizeLogicalSheetWorkRange(sheet.workRange)
}

export function logicalSheetDisplayFrameStart(sheet: Pick<LogicalSheet, 'frameOrigin' | 'workRange'>): number {
  const workRange = logicalSheetWorkRange(sheet)
  return sheet.frameOrigin - (workRange.showPreRoll ? workRange.preRollFrames : 0)
}

export function logicalSheetDisplayFrameEnd(sheet: Pick<LogicalSheet, 'frameOrigin' | 'durationFrames' | 'workRange'>): number {
  const workRange = logicalSheetWorkRange(sheet)
  return logicalSheetOfficialFrameEnd(sheet) + (workRange.showPostRoll ? workRange.postRollFrames : 0)
}

export function logicalSheetDisplayDurationFrames(sheet: Pick<LogicalSheet, 'frameOrigin' | 'durationFrames' | 'workRange'>): number {
  return Math.max(1, logicalSheetDisplayFrameEnd(sheet) - logicalSheetDisplayFrameStart(sheet) + 1)
}

export function logicalSheetFrameIsInOfficialRange(sheet: Pick<LogicalSheet, 'frameOrigin' | 'durationFrames'>, frame: number): boolean {
  return frame >= sheet.frameOrigin && frame <= logicalSheetOfficialFrameEnd(sheet)
}
