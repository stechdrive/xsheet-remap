import { logicalSheetOfficialFrameEnd } from './logical-sheet'
import { compareTimelineEvents } from './project-shared'
import { clampCameraOverlapPivotAnchorFrame, replaceTimedRangeCues, resolveCameraInstructionPoints } from './timed-range'
import { deleteTimelineMemoAnchors, insertTimelineMemoAnchors } from './timeline-memo'
import { replaceTimelineMemos, timelineMemos } from './sheet-memo'
import type { CameraInstruction, CutProject, TimedRangeCue } from './types'

export type CutTimelineFrameEdit =
  | { kind: 'insert'; atFrame: number; frameCount: number }
  | { kind: 'delete'; frameStart: number; frameCount: number }

/**
 * Applies one atomic ripple edit to every frame-addressed timeline layer.
 * Registered keys, bindings, assets, paper images, and view-surface annotations
 * are deliberately retained because they are not timeline occurrences.
 */
export function applyCutTimelineFrameEdit(project: CutProject, edit: CutTimelineFrameEdit): CutProject {
  return edit.kind === 'insert'
    ? insertCutTimelineFrames(project, edit.atFrame, edit.frameCount)
    : deleteCutTimelineFrames(project, edit.frameStart, edit.frameCount)
}

function insertCutTimelineFrames(project: CutProject, requestedFrame: number, requestedCount: number): CutProject {
  const frameCount = normalizeFrameCount(requestedCount)
  const officialStart = Math.round(project.logicalSheet.frameOrigin)
  const officialEnd = logicalSheetOfficialFrameEnd(project.logicalSheet)
  const atFrame = clamp(Math.round(requestedFrame), officialStart, officialEnd + 1)
  const events = project.logicalSheet.events
    .map(event => event.frame >= atFrame ? { ...event, frame: event.frame + frameCount } : event)
    .sort(compareTimelineEvents)
  const cues = project.timedRangeCues.map(cue => insertIntoCue(cue, atFrame, frameCount))
  const resized: CutProject = replaceTimelineMemos({
    ...project,
    logicalSheet: {
      ...project.logicalSheet,
      durationFrames: Math.max(1, Math.round(project.logicalSheet.durationFrames) + frameCount),
      events,
    },
  }, insertTimelineMemoAnchors(timelineMemos(project), atFrame, frameCount))
  return replaceTimedRangeCues(resized, cues)
}

function deleteCutTimelineFrames(project: CutProject, requestedStart: number, requestedCount: number): CutProject {
  const officialStart = Math.round(project.logicalSheet.frameOrigin)
  const officialEnd = logicalSheetOfficialFrameEnd(project.logicalSheet)
  const frameStart = Math.max(officialStart, Math.round(requestedStart))
  if (frameStart > officialEnd) return project
  const frameEnd = Math.min(officialEnd, frameStart + normalizeFrameCount(requestedCount) - 1)
  const frameCount = frameEnd - frameStart + 1
  const events = project.logicalSheet.events
    .flatMap(event => {
      if (event.frame < frameStart) return [event]
      if (event.frame <= frameEnd) return []
      return [{ ...event, frame: event.frame - frameCount }]
    })
    .sort(compareTimelineEvents)
  const cues = project.timedRangeCues.flatMap(cue => {
    const transformed = deleteFromCue(cue, frameStart, frameEnd, frameCount)
    return transformed ? [transformed] : []
  })
  const resized: CutProject = replaceTimelineMemos({
    ...project,
    logicalSheet: {
      ...project.logicalSheet,
      durationFrames: Math.max(1, Math.round(project.logicalSheet.durationFrames) - frameCount),
      events,
    },
  }, deleteTimelineMemoAnchors(timelineMemos(project), frameStart, frameEnd, frameCount))
  return replaceTimedRangeCues(resized, cues)
}

function insertIntoCue(cue: TimedRangeCue, atFrame: number, frameCount: number): TimedRangeCue {
  const range = insertIntoInterval({ start: cue.frameStart, end: cue.frameEnd }, atFrame, frameCount)
  return {
    ...cue,
    frameStart: range.start,
    frameEnd: range.end,
    camera: cue.camera ? insertIntoCamera(cue, range, atFrame, frameCount) : undefined,
  }
}

function insertIntoCamera(
  cue: TimedRangeCue,
  nextCueRange: FrameInterval,
  atFrame: number,
  frameCount: number,
): CameraInstruction {
  const camera = cue.camera as CameraInstruction
  const pivotAnchorFrame = camera.pivotAnchorFrame === undefined
    ? undefined
    : clampCameraOverlapPivotAnchorFrame(
        insertPoint(camera.pivotAnchorFrame, atFrame, frameCount),
        nextCueRange.start,
        nextCueRange.end,
      )
  const labelPlacement = camera.labelPlacement
    ? placementAfterInsert(cue, nextCueRange, atFrame, frameCount)
    : undefined
  const points = resolveCameraInstructionPoints({
    ...camera,
    points: resolveCameraInstructionPoints(camera, cue.frameStart, cue.frameEnd).map(point => {
      const nextFrame = insertPoint(cue.frameStart + point.frameOffset, atFrame, frameCount)
      return { ...point, frameOffset: nextFrame - nextCueRange.start }
    }),
  }, nextCueRange.start, nextCueRange.end)
  return { ...camera, points, startLabel: undefined, endLabel: undefined, pivotAnchorFrame, labelPlacement }
}

function placementAfterInsert(
  cue: TimedRangeCue,
  nextCueRange: FrameInterval,
  atFrame: number,
  frameCount: number,
): NonNullable<CameraInstruction['labelPlacement']> {
  const placement = cue.camera?.labelPlacement as NonNullable<CameraInstruction['labelPlacement']>
  const start = cue.frameStart + placement.frameOffset
  const range = insertIntoInterval({ start, end: start + placement.heightFrames - 1 }, atFrame, frameCount)
  const nextStart = clamp(range.start, nextCueRange.start, nextCueRange.end)
  return {
    ...placement,
    frameOffset: nextStart - nextCueRange.start,
    heightFrames: Math.max(1, range.end - range.start + 1),
  }
}

function deleteFromCue(cue: TimedRangeCue, frameStart: number, frameEnd: number, frameCount: number): TimedRangeCue | null {
  const range = deleteFromInterval({ start: cue.frameStart, end: cue.frameEnd }, frameStart, frameEnd, frameCount)
  if (!range) return null
  return {
    ...cue,
    frameStart: range.start,
    frameEnd: range.end,
    camera: cue.camera ? deleteFromCamera(cue, range, frameStart, frameEnd, frameCount) : undefined,
  }
}

function deleteFromCamera(
  cue: TimedRangeCue,
  nextCueRange: FrameInterval,
  frameStart: number,
  frameEnd: number,
  frameCount: number,
): CameraInstruction {
  const camera = cue.camera as CameraInstruction
  const pivotAnchorFrame = camera.pivotAnchorFrame === undefined
    ? undefined
    : clampCameraOverlapPivotAnchorFrame(
        deletePoint(camera.pivotAnchorFrame, frameStart, frameEnd, frameCount, nextCueRange),
        nextCueRange.start,
        nextCueRange.end,
      )
  const labelPlacement = camera.labelPlacement
    ? placementAfterDelete(cue, nextCueRange, frameStart, frameEnd, frameCount)
    : undefined
  const points = resolveCameraInstructionPoints({
    ...camera,
    points: resolveCameraInstructionPoints(camera, cue.frameStart, cue.frameEnd).flatMap(point => {
      const absoluteFrame = cue.frameStart + point.frameOffset
      if (point.role === 'intermediate' && absoluteFrame >= frameStart && absoluteFrame <= frameEnd) return []
      const nextFrame = deletePoint(absoluteFrame, frameStart, frameEnd, frameCount, nextCueRange)
      return [{ ...point, frameOffset: nextFrame - nextCueRange.start }]
    }),
  }, nextCueRange.start, nextCueRange.end)
  return { ...camera, points, startLabel: undefined, endLabel: undefined, pivotAnchorFrame, labelPlacement }
}

function placementAfterDelete(
  cue: TimedRangeCue,
  nextCueRange: FrameInterval,
  frameStart: number,
  frameEnd: number,
  frameCount: number,
): NonNullable<CameraInstruction['labelPlacement']> {
  const placement = cue.camera?.labelPlacement as NonNullable<CameraInstruction['labelPlacement']>
  const start = cue.frameStart + placement.frameOffset
  const transformed = deleteFromInterval({ start, end: start + placement.heightFrames - 1 }, frameStart, frameEnd, frameCount)
  const range = transformed ?? {
    start: clamp(frameStart, nextCueRange.start, nextCueRange.end),
    end: clamp(frameStart, nextCueRange.start, nextCueRange.end),
  }
  const nextStart = clamp(range.start, nextCueRange.start, nextCueRange.end)
  return {
    ...placement,
    frameOffset: nextStart - nextCueRange.start,
    heightFrames: Math.max(1, range.end - range.start + 1),
  }
}

type FrameInterval = { start: number; end: number }

function insertIntoInterval(range: FrameInterval, atFrame: number, frameCount: number): FrameInterval {
  if (atFrame <= range.start) return { start: range.start + frameCount, end: range.end + frameCount }
  if (atFrame <= range.end) return { start: range.start, end: range.end + frameCount }
  return range
}

function deleteFromInterval(range: FrameInterval, frameStart: number, frameEnd: number, frameCount: number): FrameInterval | null {
  if (range.end < frameStart) return range
  if (range.start > frameEnd) return { start: range.start - frameCount, end: range.end - frameCount }
  const hasLeft = range.start < frameStart
  const hasRight = range.end > frameEnd
  if (!hasLeft && !hasRight) return null
  return {
    start: hasLeft ? range.start : frameStart,
    end: hasRight ? range.end - frameCount : frameStart - 1,
  }
}

function insertPoint(frame: number, atFrame: number, frameCount: number): number {
  return frame >= atFrame ? frame + frameCount : frame
}

function deletePoint(frame: number, frameStart: number, frameEnd: number, frameCount: number, survivingRange: FrameInterval): number {
  if (frame < frameStart) return frame
  if (frame > frameEnd) return frame - frameCount
  return clamp(frameStart, survivingRange.start, survivingRange.end)
}

function normalizeFrameCount(value: number): number {
  return Math.max(1, Math.round(value))
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
