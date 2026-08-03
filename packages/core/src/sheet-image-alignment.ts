import { withoutUndefined } from './core-utils'
import type { SheetImageAlignment } from './types'

export function defaultSheetImageAlignment(): SheetImageAlignment {
  return {
    opacity: 0.94,
    x: 0,
    y: 0,
    scale: 1,
    corners: {
      tl: { x: 0, y: 0 },
      tr: { x: 1, y: 0 },
      br: { x: 1, y: 1 },
      bl: { x: 0, y: 1 },
    },
  }
}

export function mergeSheetImageAlignment(base: SheetImageAlignment, updates: Partial<SheetImageAlignment>): SheetImageAlignment {
  return {
    ...base,
    ...withoutUndefined(updates),
    corners: {
      ...base.corners,
      ...(updates.corners ?? {}),
    },
    calibration: updates.calibration ?? base.calibration,
    levelCorrection: updates.levelCorrection ? {
      enabled: updates.levelCorrection.enabled ?? base.levelCorrection?.enabled ?? false,
      inputBlack: updates.levelCorrection.inputBlack ?? base.levelCorrection?.inputBlack ?? 0,
      inputWhite: updates.levelCorrection.inputWhite ?? base.levelCorrection?.inputWhite ?? 255,
      gamma: updates.levelCorrection.gamma ?? base.levelCorrection?.gamma ?? 1,
    } : base.levelCorrection,
  }
}
