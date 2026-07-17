import { logicalSheetDisplayFrameEnd, logicalSheetDisplayFrameStart } from './logical-sheet'
import type { CameraInstruction, CutProject, TimedRangeCue, TimedRangeRole } from './types'

export interface TimedRangeCueInput {
  role: TimedRangeRole
  laneId: string
  frameStart: number
  frameEnd: number
  label: string
  text?: string
  camera?: CameraInstruction
  source?: TimedRangeCue['source']
}

export interface TimedRangeCueUpdates {
  laneId?: string
  frameStart?: number
  frameEnd?: number
  label?: string
  text?: string
  camera?: CameraInstruction
}

export function createTimedRangeCue(project: CutProject, input: TimedRangeCueInput): { project: CutProject; cue: TimedRangeCue } {
  const cue = normalizeCue(project, {
    cueId: nextCueId(project.timedRangeCues),
    role: input.role,
    laneId: input.laneId,
    frameStart: input.frameStart,
    frameEnd: input.frameEnd,
    label: input.label,
    text: input.text ?? '',
    camera: input.camera,
    source: input.source ?? 'manual',
  })
  return {
    project: { ...project, timedRangeCues: [...project.timedRangeCues, cue] },
    cue,
  }
}

export function updateTimedRangeCue(project: CutProject, cueId: string, updates: TimedRangeCueUpdates): CutProject {
  const current = project.timedRangeCues.find(cue => cue.cueId === cueId)
  if (!current) return project
  const nextCue = normalizeCue(project, { ...current, ...updates, cueId: current.cueId, role: current.role })
  if (sameCue(current, nextCue)) return project
  return {
    ...project,
    timedRangeCues: project.timedRangeCues.map(cue => cue.cueId === cueId ? nextCue : cue),
  }
}

export function deleteTimedRangeCue(project: CutProject, cueId: string): CutProject {
  if (!project.timedRangeCues.some(cue => cue.cueId === cueId)) return project
  return { ...project, timedRangeCues: project.timedRangeCues.filter(cue => cue.cueId !== cueId) }
}

export function timedRangeCuesIntersecting(
  project: CutProject,
  role: TimedRangeRole,
  laneId: string,
  frameStart: number,
  frameEnd: number,
): TimedRangeCue[] {
  const start = Math.min(frameStart, frameEnd)
  const end = Math.max(frameStart, frameEnd)
  return project.timedRangeCues.filter(cue => cue.role === role
    && cue.laneId === laneId
    && cue.frameStart <= end
    && cue.frameEnd >= start)
}

export function replaceTimedRangeCues(project: CutProject, cues: TimedRangeCue[]): CutProject {
  const normalized = cues.map(cue => normalizeCue(project, cue))
  return { ...project, timedRangeCues: normalized }
}

export function timedRangeLaneIds(project: Pick<CutProject, 'logicalSheet'>, role: TimedRangeRole): string[] {
  return project.logicalSheet.timelineSections
    .find(section => section.role === role)
    ?.lanes?.slice().sort((left, right) => left.order - right.order).map(lane => lane.laneId) ?? []
}

function normalizeCue(project: CutProject, cue: TimedRangeCue): TimedRangeCue {
  const laneIds = timedRangeLaneIds(project, cue.role)
  if (!cue.laneId || !laneIds.includes(cue.laneId)) {
    throw new Error(`timed range lane not found: ${cue.role}/${cue.laneId}`)
  }
  const displayStart = logicalSheetDisplayFrameStart(project.logicalSheet)
  const displayEnd = logicalSheetDisplayFrameEnd(project.logicalSheet)
  const requestedStart = Math.min(Math.round(cue.frameStart), Math.round(cue.frameEnd))
  const requestedEnd = Math.max(Math.round(cue.frameStart), Math.round(cue.frameEnd))
  const frameStart = clamp(requestedStart, displayStart, displayEnd)
  const frameEnd = clamp(requestedEnd, frameStart, displayEnd)
  return {
    cueId: cue.cueId,
    role: cue.role,
    laneId: cue.laneId,
    frameStart,
    frameEnd,
    label: cue.label.trim(),
    text: cue.role === 'camera' ? '' : cue.text.trim(),
    camera: cue.role === 'camera' ? normalizeCameraInstruction({ ...cue, frameStart, frameEnd }) : undefined,
    source: cue.source ?? 'manual',
  }
}

function normalizeCameraInstruction(cue: TimedRangeCue): CameraInstruction {
  const input = cue.camera
  const shape = input?.shape ?? 'range'
  const pivotAnchorFrame = shape === 'overlap'
    ? clampCameraOverlapPivotAnchorFrame(
        input?.pivotAnchorFrame ?? defaultCameraOverlapPivotAnchorFrame(cue.frameStart, cue.frameEnd),
        cue.frameStart,
        cue.frameEnd,
      )
    : undefined
  const labelXRatio = input?.labelPlacement ? clamp(input.labelPlacement.xRatio, 0, 0.95) : 0
  const labelPlacement = input?.labelPlacement
    ? {
        mode: 'manual' as const,
        frameOffset: clamp(Math.round(input.labelPlacement.frameOffset), 0, Math.max(0, cue.frameEnd - cue.frameStart)),
        xRatio: labelXRatio,
        widthRatio: clamp(input.labelPlacement.widthRatio, 0.05, 1 - labelXRatio),
        heightFrames: Math.max(1, Math.round(input.labelPlacement.heightFrames)),
      }
    : undefined
  return {
    shape,
    startLabel: input?.startLabel.trim() ?? '',
    endLabel: input?.endLabel.trim() ?? '',
    pivotAnchorFrame,
    labelPlacement,
  }
}

export function defaultCameraOverlapPivotAnchorFrame(frameStart: number, frameEnd: number): number {
  const start = Math.min(Math.round(frameStart), Math.round(frameEnd))
  const end = Math.max(Math.round(frameStart), Math.round(frameEnd))
  return Math.floor((start + end) / 2)
}

export function clampCameraOverlapPivotAnchorFrame(anchorFrame: number, frameStart: number, frameEnd: number): number {
  const start = Math.min(Math.round(frameStart), Math.round(frameEnd))
  const end = Math.max(Math.round(frameStart), Math.round(frameEnd))
  const duration = end - start + 1
  const max = duration % 2 === 0 ? Math.max(start, end - 1) : end
  const requested = Number.isFinite(anchorFrame)
    ? Math.round(anchorFrame)
    : defaultCameraOverlapPivotAnchorFrame(start, end)
  return clamp(requested, start, max)
}

function nextCueId(cues: TimedRangeCue[]): string {
  const max = cues.reduce((value, cue) => {
    const match = /^cue_(\d+)$/.exec(cue.cueId)
    return match ? Math.max(value, Number(match[1])) : value
  }, 0)
  let index = max + 1
  const used = new Set(cues.map(cue => cue.cueId))
  while (used.has(`cue_${index}`)) index += 1
  return `cue_${index}`
}

function sameCue(left: TimedRangeCue, right: TimedRangeCue): boolean {
  return left.cueId === right.cueId
    && left.role === right.role
    && left.laneId === right.laneId
    && left.frameStart === right.frameStart
    && left.frameEnd === right.frameEnd
    && left.label === right.label
    && left.text === right.text
    && JSON.stringify(left.camera) === JSON.stringify(right.camera)
    && left.source === right.source
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
