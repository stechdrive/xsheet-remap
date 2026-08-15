import {
  createTimedRangeCue,
  logicalSheetDisplayFrameEnd,
  isInteractiveSheetTemplateGridRegion,
  replaceTimedRangeCues,
  timedRangeCuesIntersecting,
  type CutProject,
  type SheetHit,
  type SheetTemplate,
  type TimedRangeCue,
} from '@xsheet-remap/core'
import type { SheetRangeSelection, TimedRangeCueClipboard } from './appTypes'

export type EditableTimedRangeRole = 'sound' | 'camera'

export function timedRangeCueForId(project: CutProject, cueId: string | null | undefined): TimedRangeCue | null {
  return cueId ? project.timedRangeCues.find(cue => cue.cueId === cueId) ?? null : null
}

export function timedRangeLaneIdForHit(
  template: SheetTemplate,
  role: EditableTimedRangeRole,
  hit: Pick<SheetHit, 'regionId' | 'columnId' | 'columnIndex' | 'timelineLaneId'>,
): string | null {
  if (hit.timelineLaneId) return hit.timelineLaneId
  const region = template.regions.find(item => item.regionId === hit.regionId)
  if (!region || !isInteractiveSheetTemplateGridRegion(region) || region.grid.role !== role) return null
  const column = region.grid.columns.find(item => item.columnId === hit.columnId)
    ?? region.grid.columns[hit.columnIndex]
  return column?.timelineLaneId ?? null
}

export function timedRangeLaneIdForRange(
  template: SheetTemplate,
  role: EditableTimedRangeRole,
  range: SheetRangeSelection | null,
): string | null {
  if (!range || range.role !== role) return null
  return timedRangeLaneIdForHit(template, role, range.anchorHit)
}

export function buildTimedRangeCueClipboard<Role extends EditableTimedRangeRole>(
  project: CutProject,
  role: Role,
  input: {
    laneId: string
    frameStart: number
    frameEnd: number
    mode: TimedRangeCueClipboard<Role>['mode']
    cueId?: string
  },
): TimedRangeCueClipboard<Role> | null {
  const selected = input.cueId
    ? project.timedRangeCues.filter(cue => cue.role === role && cue.cueId === input.cueId)
    : timedRangeCuesIntersecting(project, role, input.laneId, input.frameStart, input.frameEnd)
  if (selected.length === 0) return null
  const frameStart = input.cueId ? Math.min(...selected.map(cue => cue.frameStart)) : Math.min(input.frameStart, input.frameEnd)
  const frameEnd = input.cueId ? Math.max(...selected.map(cue => cue.frameEnd)) : Math.max(input.frameStart, input.frameEnd)
  return {
    role,
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
        camera: cue.camera,
        source: cue.source,
      })),
  }
}

export function cutTimedRangeCuesToClipboard<Role extends EditableTimedRangeRole>(
  project: CutProject,
  clipboard: TimedRangeCueClipboard<Role>,
): CutProject {
  const selectedIds = new Set(clipboard.sourceCueIds)
  if (selectedIds.size === 0) return project
  return replaceTimedRangeCues(project, project.timedRangeCues.filter(cue => !selectedIds.has(cue.cueId)))
}

export function pasteTimedRangeCueClipboard<Role extends EditableTimedRangeRole>(
  project: CutProject,
  clipboard: TimedRangeCueClipboard<Role>,
  target: { laneId: string; frameStart: number },
  mode: 'overwrite' | 'insert',
): { project: CutProject; cueIds: string[]; frameStart: number; frameEnd: number } {
  const maxFrame = logicalSheetDisplayFrameEnd(project.logicalSheet)
  const targetStart = Math.round(target.frameStart)
  const targetEnd = Math.min(maxFrame, targetStart + clipboard.spanFrames - 1)
  let next = project
  if (mode === 'overwrite') {
    const collisions = new Set(timedRangeCuesIntersecting(next, clipboard.role, target.laneId, targetStart, targetEnd).map(cue => cue.cueId))
    if (collisions.size > 0) {
      next = replaceTimedRangeCues(next, next.timedRangeCues.filter(cue => !collisions.has(cue.cueId)))
    }
  } else {
    const shifted = next.timedRangeCues.map(cue => {
      if (cue.role !== clipboard.role || cue.laneId !== target.laneId || cue.frameEnd < targetStart) return cue
      const frameStart = Math.min(maxFrame, cue.frameStart + clipboard.spanFrames)
      const frameEnd = Math.min(maxFrame, cue.frameEnd + clipboard.spanFrames)
      const frameDelta = frameStart - cue.frameStart
      const camera = shiftCameraInstruction(cue.camera, frameDelta)
      return { ...cue, frameStart: Math.min(frameStart, frameEnd), frameEnd, camera }
    })
    next = replaceTimedRangeCues(next, shifted)
  }

  const cueIds: string[] = []
  for (const item of clipboard.items) {
    const frameStart = targetStart + item.frameStartOffset
    if (frameStart > maxFrame) continue
    const frameDelta = frameStart - (clipboard.sourceFrameStart + item.frameStartOffset)
    const camera = shiftCameraInstruction(item.camera, frameDelta)
    const result = createTimedRangeCue(next, {
      role: clipboard.role,
      laneId: target.laneId,
      frameStart,
      frameEnd: Math.min(maxFrame, targetStart + item.frameEndOffset),
      label: item.label,
      text: item.text,
      camera,
      source: item.source,
    })
    next = result.project
    cueIds.push(result.cue.cueId)
  }
  return { project: next, cueIds, frameStart: targetStart, frameEnd: targetEnd }
}

function shiftCameraInstruction(camera: TimedRangeCue['camera'], frameDelta: number): TimedRangeCue['camera'] {
  if (!camera || frameDelta === 0) return camera
  return {
    ...camera,
    pivotAnchorFrame: camera.pivotAnchorFrame === undefined ? undefined : camera.pivotAnchorFrame + frameDelta,
    segments: camera.segments?.map(segment => ({
      ...segment,
      pivotAnchorFrame: segment.pivotAnchorFrame === undefined ? undefined : segment.pivotAnchorFrame + frameDelta,
    })),
  }
}

export function deleteTimedRangeCuesInRange(
  project: CutProject,
  role: EditableTimedRangeRole,
  laneId: string,
  frameStart: number,
  frameEnd: number,
): CutProject {
  const ids = new Set(timedRangeCuesIntersecting(project, role, laneId, frameStart, frameEnd).map(cue => cue.cueId))
  if (ids.size === 0) return project
  return replaceTimedRangeCues(project, project.timedRangeCues.filter(cue => !ids.has(cue.cueId)))
}
