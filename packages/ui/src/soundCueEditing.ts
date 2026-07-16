import {
  createTimedRangeCue,
  deleteTimedRangeCue,
  logicalSheetDisplayFrameEnd,
  replaceTimedRangeCues,
  timedRangeCuesIntersecting,
  type CutProject,
  type SheetHit,
  type SheetTemplate,
  type TimedRangeCue,
} from '@xsheet-remap/core'
import type { SheetRangeSelection, SoundCueClipboard } from './appTypes'

export const SOUND_LABEL_HISTORY_LIMIT = 24
export const SOUND_LABEL_HISTORY_STORAGE_KEY = 'xsheet:sound-label-history'

export function soundLaneIdForHit(template: SheetTemplate, hit: Pick<SheetHit, 'regionId' | 'columnId' | 'columnIndex'>): string | null {
  const region = template.regions.find(item => item.regionId === hit.regionId)
  const column = region?.grid?.columns.find(item => item.columnId === hit.columnId)
    ?? region?.grid?.columns[hit.columnIndex]
  return column?.timelineLaneId ?? null
}

export function soundLaneIdForRange(template: SheetTemplate, range: SheetRangeSelection | null): string | null {
  if (!range || range.role !== 'sound') return null
  return soundLaneIdForHit(template, range.anchorHit)
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
  const selected = input.cueId
    ? project.timedRangeCues.filter(cue => cue.role === 'sound' && cue.cueId === input.cueId)
    : timedRangeCuesIntersecting(project, 'sound', input.laneId, input.frameStart, input.frameEnd)
  if (selected.length === 0) return null
  const frameStart = input.cueId ? Math.min(...selected.map(cue => cue.frameStart)) : Math.min(input.frameStart, input.frameEnd)
  const frameEnd = input.cueId ? Math.max(...selected.map(cue => cue.frameEnd)) : Math.max(input.frameStart, input.frameEnd)
  return {
    role: 'sound',
    sourceLaneId: input.laneId,
    sourceFrameStart: frameStart,
    sourceFrameEnd: frameEnd,
    spanFrames: frameEnd - frameStart + 1,
    mode: input.mode,
    sourceCueIds: selected.map(cue => cue.cueId),
    items: selected
      .slice()
      .sort((left, right) => left.frameStart - right.frameStart || left.cueId.localeCompare(right.cueId))
      .map(cue => ({
        frameStartOffset: cue.frameStart - frameStart,
        frameEndOffset: cue.frameEnd - frameStart,
        label: cue.label,
        text: cue.text,
        source: cue.source,
      })),
  }
}

export function cutSoundCuesToClipboard(project: CutProject, clipboard: SoundCueClipboard): CutProject {
  const selectedIds = new Set(clipboard.sourceCueIds)
  if (selectedIds.size === 0) return project
  return replaceTimedRangeCues(project, project.timedRangeCues.filter(cue => !selectedIds.has(cue.cueId)))
}

export function pasteSoundCueClipboard(
  project: CutProject,
  clipboard: SoundCueClipboard,
  target: { laneId: string; frameStart: number },
  mode: 'overwrite' | 'insert',
): { project: CutProject; cueIds: string[]; frameStart: number; frameEnd: number } {
  const maxFrame = logicalSheetDisplayFrameEnd(project.logicalSheet)
  const targetStart = Math.round(target.frameStart)
  const targetEnd = Math.min(maxFrame, targetStart + clipboard.spanFrames - 1)
  let next = project
  if (mode === 'overwrite') {
    const collisions = new Set(timedRangeCuesIntersecting(next, 'sound', target.laneId, targetStart, targetEnd).map(cue => cue.cueId))
    if (collisions.size > 0) {
      next = replaceTimedRangeCues(next, next.timedRangeCues.filter(cue => !collisions.has(cue.cueId)))
    }
  } else {
    const shifted = next.timedRangeCues.map(cue => {
      if (cue.role !== 'sound' || cue.laneId !== target.laneId || cue.frameEnd < targetStart) return cue
      const frameStart = Math.min(maxFrame, cue.frameStart + clipboard.spanFrames)
      const frameEnd = Math.min(maxFrame, cue.frameEnd + clipboard.spanFrames)
      return { ...cue, frameStart: Math.min(frameStart, frameEnd), frameEnd }
    })
    next = replaceTimedRangeCues(next, shifted)
  }

  const cueIds: string[] = []
  for (const item of clipboard.items) {
    const frameStart = targetStart + item.frameStartOffset
    if (frameStart > maxFrame) continue
    const result = createTimedRangeCue(next, {
      role: 'sound',
      laneId: target.laneId,
      frameStart,
      frameEnd: Math.min(maxFrame, targetStart + item.frameEndOffset),
      label: item.label,
      text: item.text,
      source: item.source,
    })
    next = result.project
    cueIds.push(result.cue.cueId)
  }
  return { project: next, cueIds, frameStart: targetStart, frameEnd: targetEnd }
}

export function deleteSoundCuesInRange(project: CutProject, laneId: string, frameStart: number, frameEnd: number): CutProject {
  const ids = new Set(timedRangeCuesIntersecting(project, 'sound', laneId, frameStart, frameEnd).map(cue => cue.cueId))
  if (ids.size === 0) return project
  return replaceTimedRangeCues(project, project.timedRangeCues.filter(cue => !ids.has(cue.cueId)))
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
