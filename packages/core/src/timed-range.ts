import { logicalSheetDisplayFrameEnd, logicalSheetDisplayFrameStart } from './logical-sheet'
import { isTimelineMemo } from './sheet-memo'
import type { CameraInstruction, CameraInstructionPathStyle, CameraInstructionPoint, CameraInstructionPointRole, CameraInstructionSegment, CameraInstructionSegmentKind, CameraInstructionSegmentStyle, CameraInstructionShape, CutProject, TimedRangeCue, TimedRangeRole, TimelineMemoAnchor } from './types'

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
    memos: project.memos.map(memo => isTimelineMemo(memo) && memo.anchor.cueId === cueId
      ? { ...memo, anchor: cueLinkedMemoAnchor(memo.anchor, nextCue) }
      : memo),
  }
}

export function deleteTimedRangeCue(project: CutProject, cueId: string): CutProject {
  if (!project.timedRangeCues.some(cue => cue.cueId === cueId)) return project
  return {
    ...project,
    timedRangeCues: project.timedRangeCues.filter(cue => cue.cueId !== cueId),
    memos: project.memos.filter(memo => !isTimelineMemo(memo) || memo.anchor.cueId !== cueId),
  }
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
  const cueById = new Map(normalized.map(cue => [cue.cueId, cue]))
  return {
    ...project,
    timedRangeCues: normalized,
    memos: project.memos.flatMap(memo => {
      if (!isTimelineMemo(memo) || !memo.anchor.cueId) return [memo]
      const cue = cueById.get(memo.anchor.cueId)
      return cue ? [{ ...memo, anchor: cueLinkedMemoAnchor(memo.anchor, cue) }] : []
    }),
  }
}

function cueLinkedMemoAnchor(anchor: TimelineMemoAnchor, cue: TimedRangeCue): TimelineMemoAnchor {
  if (cue.role !== 'sound' && cue.role !== 'camera') return anchor
  return {
    ...anchor,
    role: cue.role,
    frame: cue.frameStart,
    laneId: cue.laneId,
    paperTrack: undefined,
    cueId: cue.cueId,
  }
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
  const points = resolveCameraInstructionPoints(input, cue.frameStart, cue.frameEnd)
  const segments = resolveCameraInstructionSegments(input, cue.frameStart, cue.frameEnd, points)
  const firstKind = segments[0]?.kind ?? 'straight'
  const shape = shapeForCameraSegmentKind(firstKind)
  const pathStyle: CameraInstructionPathStyle | undefined = firstKind === 'straight' || firstKind === 'wave' ? firstKind : undefined
  const pivotAnchorFrame = segments.length === 1 && firstKind === 'overlap' ? segments[0]?.pivotAnchorFrame : undefined
  return {
    shape,
    pathStyle,
    segmentStyles: segments.every(segment => segment.kind === 'straight' || segment.kind === 'wave')
      ? segments.map(segment => ({ endPointId: segment.endPointId, style: segment.kind as CameraInstructionPathStyle }))
      : undefined,
    segments,
    points,
    pivotAnchorFrame,
    labelPlacement,
  }
}

export const CAMERA_INSTRUCTION_CUE_END_POINT_ID = 'cue-end'

export function shapeForCameraSegmentKind(kind: CameraInstructionSegmentKind): CameraInstructionShape {
  return kind === 'straight' || kind === 'wave' ? 'range' : kind
}

export function cameraSegmentKindForLegacyInstruction(camera: CameraInstruction | null | undefined): CameraInstructionSegmentKind {
  if (camera?.shape === 'fade-in' || camera?.shape === 'fade-out' || camera?.shape === 'overlap') return camera.shape
  return camera?.pathStyle === 'wave' ? 'wave' : 'straight'
}

export function resolveCameraInstructionSegments(
  camera: CameraInstruction | null | undefined,
  frameStart: number,
  frameEnd: number,
  resolvedPoints = resolveCameraInstructionPoints(camera, frameStart, frameEnd),
): CameraInstructionSegment[] {
  const fallback = cameraSegmentKindForLegacyInstruction(camera)
  const legacyStyles = new Map((camera?.segmentStyles ?? []).map(item => [item.endPointId, item.style] as const))
  const requested = new Map((camera?.segments ?? []).flatMap(item => {
    const kind = isCameraInstructionSegmentKind(item.kind) ? item.kind : null
    return item.endPointId.trim() && kind ? [[item.endPointId, { ...item, kind }] as const] : []
  }))
  const targetIds = [
    ...resolvedPoints.filter(point => point.role === 'intermediate').map(point => point.pointId),
    CAMERA_INSTRUCTION_CUE_END_POINT_ID,
  ]
  let segmentStart = frameStart
  return targetIds.map(endPointId => {
    const targetPoint = resolvedPoints.find(point => point.pointId === endPointId)
    const segmentEnd = targetPoint ? frameStart + targetPoint.frameOffset - 1 : frameEnd
    const stored = requested.get(endPointId)
    const kind = stored?.kind ?? legacyStyles.get(endPointId) ?? fallback
    const pivotAnchorFrame = kind === 'overlap'
      ? clampCameraOverlapPivotAnchorFrame(
          stored?.pivotAnchorFrame
            ?? (targetIds.length === 1 ? camera?.pivotAnchorFrame : undefined)
            ?? defaultCameraOverlapPivotAnchorFrame(segmentStart, segmentEnd),
          segmentStart,
          segmentEnd,
        )
      : undefined
    const segment = { endPointId, kind, pivotAnchorFrame }
    segmentStart = segmentEnd + 1
    return segment
  })
}

function isCameraInstructionSegmentKind(value: unknown): value is CameraInstructionSegmentKind {
  return value === 'straight' || value === 'wave' || value === 'fade-in' || value === 'fade-out' || value === 'overlap'
}

export function resolveCameraInstructionSegmentStyles(
  camera: CameraInstruction | null | undefined,
  frameStart: number,
  frameEnd: number,
  resolvedPoints = resolveCameraInstructionPoints(camera, frameStart, frameEnd),
): CameraInstructionSegmentStyle[] {
  const fallback: CameraInstructionPathStyle = camera?.pathStyle === 'wave' ? 'wave' : 'straight'
  const requested = new Map((camera?.segmentStyles ?? []).flatMap(item =>
    item.endPointId.trim() && (item.style === 'straight' || item.style === 'wave')
      ? [[item.endPointId, item.style] as const]
      : [],
  ))
  const targetIds = [
    ...resolvedPoints.filter(point => point.role === 'intermediate').map(point => point.pointId),
    CAMERA_INSTRUCTION_CUE_END_POINT_ID,
  ]
  return targetIds.map(endPointId => ({ endPointId, style: requested.get(endPointId) ?? fallback }))
}

export function resolveCameraInstructionPoints(
  camera: CameraInstruction | null | undefined,
  frameStart: number,
  frameEnd: number,
): CameraInstructionPoint[] {
  const duration = Math.max(1, Math.round(frameEnd) - Math.round(frameStart) + 1)
  const legacyPoints: CameraInstructionPoint[] = [
    camera?.startLabel?.trim()
      ? { pointId: 'point_start', role: 'start', frameOffset: 0, label: camera.startLabel.trim() }
      : null,
    camera?.endLabel?.trim()
      ? { pointId: 'point_end', role: 'end', frameOffset: duration - 1, label: camera.endLabel.trim() }
      : null,
  ].filter((point): point is CameraInstructionPoint => point !== null)
  const source = camera?.points?.length ? camera.points : legacyPoints
  const usedIds = new Set<string>()
  const usedIntermediateOffsets = new Set<number>()
  let hasStart = false
  let hasEnd = false
  const normalized: CameraInstructionPoint[] = []
  for (const raw of source) {
    const label = raw.label.trim()
    const role: CameraInstructionPointRole = raw.role === 'start' || raw.role === 'end' ? raw.role : 'intermediate'
    if ((role !== 'intermediate' && !label) || (role === 'start' && hasStart) || (role === 'end' && hasEnd)) continue
    if (role === 'intermediate' && duration < 3) continue
    const frameOffset = role === 'start'
      ? 0
      : role === 'end'
        ? duration - 1
        : clamp(Math.round(raw.frameOffset), 1, duration - 2)
    if (role === 'intermediate' && usedIntermediateOffsets.has(frameOffset)) continue
    let pointId = raw.pointId.trim() || `point_${normalized.length + 1}`
    while (usedIds.has(pointId)) pointId = `${pointId}_${normalized.length + 1}`
    usedIds.add(pointId)
    if (role === 'start') hasStart = true
    if (role === 'end') hasEnd = true
    if (role === 'intermediate') usedIntermediateOffsets.add(frameOffset)
    normalized.push({ pointId, role, frameOffset, label })
    if (normalized.length >= duration) break
  }
  return normalized.sort((left, right) => left.frameOffset - right.frameOffset
    || pointRoleOrder(left.role) - pointRoleOrder(right.role))
}

export function transformCameraInstructionRange(
  camera: CameraInstruction,
  previousFrameStart: number,
  previousFrameEnd: number,
  nextFrameStart: number,
  nextFrameEnd: number,
): CameraInstruction {
  const movedBy = nextFrameStart - previousFrameStart
  const movedWholeRange = nextFrameEnd - previousFrameEnd === movedBy
  const points = movedWholeRange
    ? resolveCameraInstructionPoints(camera, previousFrameStart, previousFrameEnd)
    : resolveCameraInstructionPoints({
        ...camera,
        points: resolveCameraInstructionPoints(camera, previousFrameStart, previousFrameEnd).flatMap(point => {
          if (point.role !== 'intermediate') return [point]
          const absoluteFrame = previousFrameStart + point.frameOffset
          if (absoluteFrame <= nextFrameStart || absoluteFrame >= nextFrameEnd) return []
          return [{ ...point, frameOffset: absoluteFrame - nextFrameStart }]
        }),
      }, nextFrameStart, nextFrameEnd)
  const segments = resolveCameraInstructionSegments(camera, previousFrameStart, previousFrameEnd).map(segment => ({
    ...segment,
    pivotAnchorFrame: segment.pivotAnchorFrame === undefined
      ? undefined
      : clampCameraOverlapPivotAnchorFrame(
          movedWholeRange ? segment.pivotAnchorFrame + movedBy : segment.pivotAnchorFrame,
          nextFrameStart,
          nextFrameEnd,
        ),
  }))
  const pivotAnchorFrame = camera.pivotAnchorFrame === undefined
    ? undefined
    : clampCameraOverlapPivotAnchorFrame(
        movedWholeRange ? camera.pivotAnchorFrame + movedBy : camera.pivotAnchorFrame,
        nextFrameStart,
        nextFrameEnd,
      )
  return { ...camera, points, segments, startLabel: undefined, endLabel: undefined, pivotAnchorFrame }
}

function pointRoleOrder(role: CameraInstructionPointRole): number {
  return role === 'start' ? 0 : role === 'intermediate' ? 1 : 2
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
