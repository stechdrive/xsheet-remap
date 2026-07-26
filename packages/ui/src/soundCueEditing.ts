import {
  deleteTimedRangeCue,
  timelineLanesForLayout,
  type CutProject,
  type SheetHit,
  type SheetTemplate,
  type TimedRangeCue,
} from '@xsheet-remap/core'
import type { SheetRangeSelection, SoundCueClipboard } from './appTypes'
import {
  loadRecentValueHistory,
  normalizeRecentValueHistory,
  recordRecentValue,
  saveRecentValueHistory,
} from './recentValueHistory'
import {
  buildTimedRangeCueClipboard,
  cutTimedRangeCuesToClipboard,
  deleteTimedRangeCuesInRange,
  pasteTimedRangeCueClipboard,
  timedRangeLaneIdForHit,
  timedRangeLaneIdForRange,
} from './timedRangeCueEditing'

export const SOUND_LABEL_HISTORY_LIMIT = 24
export const SOUND_LABEL_HISTORY_STORAGE_KEY = 'xsheet:sound-label-history'
export const SOUND_CUE_PLACEMENT_CONFLICT_MESSAGE = 'この区間を配置できる空きSOUND列がありません。'

export interface SoundCueLanePlacement {
  laneId: string
  reassigned: boolean
}

export function resolveAvailableSoundCueLane(
  project: CutProject,
  preferredLaneId: string,
  frameStartInput: number,
  frameEndInput: number,
  excludeCueId?: string,
): SoundCueLanePlacement | null {
  const frameStart = Math.min(Math.round(frameStartInput), Math.round(frameEndInput))
  const frameEnd = Math.max(Math.round(frameStartInput), Math.round(frameEndInput))
  const laneIds = timelineLanesForLayout(project).sound?.map(lane => lane.laneId) ?? []
  const orderedLaneIds = [
    ...(laneIds.includes(preferredLaneId) ? [preferredLaneId] : []),
    ...laneIds.filter(laneId => laneId !== preferredLaneId),
  ]
  const laneId = orderedLaneIds.find(candidateLaneId => !project.timedRangeCues.some(cue =>
    cue.role === 'sound'
    && cue.cueId !== excludeCueId
    && cue.laneId === candidateLaneId
    && cue.frameStart <= frameEnd
    && cue.frameEnd >= frameStart))
  return laneId ? { laneId, reassigned: laneId !== preferredLaneId } : null
}

export function soundLaneIdForHit(template: SheetTemplate, hit: Pick<SheetHit, 'regionId' | 'columnId' | 'columnIndex'>): string | null {
  return timedRangeLaneIdForHit(template, 'sound', hit)
}

export function soundLaneIdForRange(template: SheetTemplate, range: SheetRangeSelection | null): string | null {
  return timedRangeLaneIdForRange(template, 'sound', range)
}

export function buildSoundCueClipboard(
  project: CutProject,
  input: {
    laneId: string
    frameStart: number
    frameEnd: number
    mode: SoundCueClipboard['mode']
    cueId?: string
  },
): SoundCueClipboard | null {
  return buildTimedRangeCueClipboard(project, 'sound', input)
}

export function cutSoundCuesToClipboard(project: CutProject, clipboard: SoundCueClipboard): CutProject {
  return cutTimedRangeCuesToClipboard(project, clipboard)
}

export function pasteSoundCueClipboard(
  project: CutProject,
  clipboard: SoundCueClipboard,
  target: { laneId: string; frameStart: number },
  mode: 'overwrite' | 'insert',
): { project: CutProject; cueIds: string[]; frameStart: number; frameEnd: number } {
  return pasteTimedRangeCueClipboard(project, clipboard, target, mode)
}

export function deleteSoundCuesInRange(project: CutProject, laneId: string, frameStart: number, frameEnd: number): CutProject {
  return deleteTimedRangeCuesInRange(project, 'sound', laneId, frameStart, frameEnd)
}

export function cueAfterDelete(project: CutProject, cueId: string): CutProject {
  return deleteTimedRangeCue(project, cueId)
}

export function normalizeSoundLabelHistory(values: readonly string[]): string[] {
  return normalizeRecentValueHistory(values, SOUND_LABEL_HISTORY_LIMIT)
}

export function recordSoundLabelHistory(history: readonly string[], label: string): string[] {
  return recordRecentValue(history, label, SOUND_LABEL_HISTORY_LIMIT)
}

export function loadSoundLabelHistory(): string[] {
  return loadRecentValueHistory(SOUND_LABEL_HISTORY_STORAGE_KEY, SOUND_LABEL_HISTORY_LIMIT)
}

export function saveSoundLabelHistory(history: readonly string[]): void {
  saveRecentValueHistory(SOUND_LABEL_HISTORY_STORAGE_KEY, history, SOUND_LABEL_HISTORY_LIMIT)
}

export function cueForId(project: CutProject, cueId: string | null | undefined): TimedRangeCue | null {
  return cueId ? project.timedRangeCues.find(cue => cue.cueId === cueId) ?? null : null
}
