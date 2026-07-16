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

export function cameraLaneIdForHit(template: SheetTemplate, hit: Pick<SheetHit, 'regionId' | 'columnId' | 'columnIndex'>): string | null {
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
