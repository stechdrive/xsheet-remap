import {
  deleteTimedRangeCue,
  type CutProject,
  type SheetHit,
  type SheetTemplate,
  type TimedRangeCue,
} from '@xsheet-remap/core'
import type { SheetRangeSelection, SoundCueClipboard } from './appTypes'
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
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const raw of values) {
    const value = raw.trim()
    const identity = value.toLocaleLowerCase('ja-JP')
    if (!value || seen.has(identity)) continue
    seen.add(identity)
    normalized.push(value)
    if (normalized.length >= SOUND_LABEL_HISTORY_LIMIT) break
  }
  return normalized
}

export function recordSoundLabelHistory(history: readonly string[], label: string): string[] {
  return normalizeSoundLabelHistory([label, ...history])
}

export function loadSoundLabelHistory(): string[] {
  try {
    const stored = window.localStorage.getItem(SOUND_LABEL_HISTORY_STORAGE_KEY)
    return stored ? normalizeSoundLabelHistory(JSON.parse(stored) as string[]) : []
  } catch {
    return []
  }
}

export function saveSoundLabelHistory(history: readonly string[]): void {
  try {
    window.localStorage.setItem(SOUND_LABEL_HISTORY_STORAGE_KEY, JSON.stringify(normalizeSoundLabelHistory(history)))
  } catch {
    // Optional in restricted browser contexts.
  }
}

export function cueForId(project: CutProject, cueId: string | null | undefined): TimedRangeCue | null {
  return cueId ? project.timedRangeCues.find(cue => cue.cueId === cueId) ?? null : null
}
