import type { CutProject, SheetHit, SheetTemplate } from '@xsheet-remap/core'
import type { CameraCueClipboard, SheetRangeSelection } from './appTypes'
import {
  buildTimedRangeCueClipboard,
  cutTimedRangeCuesToClipboard,
  deleteTimedRangeCuesInRange,
  pasteTimedRangeCueClipboard,
  timedRangeLaneIdForHit,
  timedRangeLaneIdForRange,
} from './timedRangeCueEditing'
import { loadRecentValueHistory, recordRecentValue, saveRecentValueHistory } from './recentValueHistory'

export const CAMERA_INSTRUCTION_HISTORY_LIMIT = 64
export const CAMERA_POINT_LABEL_HISTORY_LIMIT = 32
export const CAMERA_INSTRUCTION_HISTORY_STORAGE_KEY = 'xsheet:camera-instruction-history'
export const CAMERA_POINT_LABEL_HISTORY_STORAGE_KEY = 'xsheet:camera-point-label-history'
export const CAMERA_INSTRUCTION_BUILT_INS = [
  'OL', 'TU', 'TB', 'SL', 'DTU', 'DTB', 'PAN', 'FI', 'FO', 'WI', 'WO', 'Follow', '画ブレ',
] as const

export function loadCameraInstructionHistory(): string[] {
  return loadRecentValueHistory(CAMERA_INSTRUCTION_HISTORY_STORAGE_KEY, CAMERA_INSTRUCTION_HISTORY_LIMIT)
}

export function loadCameraPointLabelHistory(): string[] {
  return loadRecentValueHistory(CAMERA_POINT_LABEL_HISTORY_STORAGE_KEY, CAMERA_POINT_LABEL_HISTORY_LIMIT)
}

export function saveCameraInstructionHistory(history: readonly string[]): void {
  saveRecentValueHistory(CAMERA_INSTRUCTION_HISTORY_STORAGE_KEY, history, CAMERA_INSTRUCTION_HISTORY_LIMIT)
}

export function saveCameraPointLabelHistory(history: readonly string[]): void {
  saveRecentValueHistory(CAMERA_POINT_LABEL_HISTORY_STORAGE_KEY, history, CAMERA_POINT_LABEL_HISTORY_LIMIT)
}

export function recordCameraInstructionHistory(history: readonly string[], value: string): string[] {
  return recordRecentValue(history, value, CAMERA_INSTRUCTION_HISTORY_LIMIT)
}

export function recordCameraPointLabelHistory(history: readonly string[], values: readonly string[]): string[] {
  return values.reduce((current, value) => value.trim()
    ? recordRecentValue(current, value, CAMERA_POINT_LABEL_HISTORY_LIMIT)
    : current, [...history])
}

export function cameraLaneIdForHit(template: SheetTemplate, hit: Pick<SheetHit, 'regionId' | 'columnId' | 'columnIndex' | 'timelineLaneId'>): string | null {
  return timedRangeLaneIdForHit(template, 'camera', hit)
}

export function cameraLaneIdForRange(template: SheetTemplate, range: SheetRangeSelection | null): string | null {
  return timedRangeLaneIdForRange(template, 'camera', range)
}

export function buildCameraCueClipboard(
  project: CutProject,
  input: {
    laneId: string
    frameStart: number
    frameEnd: number
    mode: CameraCueClipboard['mode']
    cueId?: string
  },
): CameraCueClipboard | null {
  return buildTimedRangeCueClipboard(project, 'camera', input)
}

export function cutCameraCuesToClipboard(project: CutProject, clipboard: CameraCueClipboard): CutProject {
  return cutTimedRangeCuesToClipboard(project, clipboard)
}

export function pasteCameraCueClipboard(
  project: CutProject,
  clipboard: CameraCueClipboard,
  target: { laneId: string; frameStart: number },
  mode: 'overwrite' | 'insert',
) {
  return pasteTimedRangeCueClipboard(project, clipboard, target, mode)
}

export function deleteCameraCuesInRange(project: CutProject, laneId: string, frameStart: number, frameEnd: number): CutProject {
  return deleteTimedRangeCuesInRange(project, 'camera', laneId, frameStart, frameEnd)
}
