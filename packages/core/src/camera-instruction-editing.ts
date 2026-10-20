import type { CameraInstruction, CameraInstructionPoint, CameraInstructionSegment } from './types'
import {
  CAMERA_INSTRUCTION_CUE_END_POINT_ID, clampCameraOverlapPivotAnchorFrame,
  defaultCameraOverlapPivotAnchorFrame, resolveCameraInstructionPoints,
  resolveCameraInstructionSegments, shapeForCameraSegmentKind,
} from './timed-range'

export interface CameraInstructionRange {
  camera: CameraInstruction
  frameStart: number
  frameEnd: number
}

export interface CameraInstructionInterval extends CameraInstructionSegment {
  frameStart: number
  frameEnd: number
  durationFrames: number
}

export function cameraInstructionIntervals(range: CameraInstructionRange): CameraInstructionInterval[] {
  const points = resolveCameraInstructionPoints(range.camera, range.frameStart, range.frameEnd)
  const ends = new Map(points.filter(point => point.role === 'intermediate').map(point => [point.pointId, range.frameStart + point.frameOffset - 1]))
  let start = range.frameStart
  return resolveCameraInstructionSegments(range.camera, range.frameStart, range.frameEnd, points).map(segment => {
    const end = ends.get(segment.endPointId) ?? range.frameEnd
    const interval = { ...segment, frameStart: start, frameEnd: end, durationFrames: end - start + 1 }
    start = end + 1
    return interval
  })
}

/** Rebuild one instruction, keeping stable boundary IDs and the local OL crossing ratio. */
function assemble(range: CameraInstructionRange, intervals: CameraInstructionInterval[], frameStart = range.frameStart,
  points = resolveCameraInstructionPoints(range.camera, range.frameStart, range.frameEnd)): CameraInstructionRange {
  const duration = intervals.reduce((sum, item) => sum + item.durationFrames, 0)
  const frameEnd = frameStart + duration - 1
  let nextStart = frameStart
  const offsets = new Map<string, number>()
  const segments = intervals.map(interval => {
    const nextEnd = nextStart + interval.durationFrames - 1
    // An even interval crosses at a frame boundary, an odd interval at a frame centre.
    const oldDuration = interval.frameEnd - interval.frameStart + 1
    const oldPivot = interval.pivotAnchorFrame ?? defaultCameraOverlapPivotAnchorFrame(interval.frameStart, interval.frameEnd)
    const ratio = (oldPivot - interval.frameStart + (oldDuration % 2 === 0 ? 1 : 0.5)) / oldDuration
    const pivotAnchorFrame = interval.kind === 'overlap'
      ? clampCameraOverlapPivotAnchorFrame(Math.round(nextStart + ratio * interval.durationFrames - (interval.durationFrames % 2 === 0 ? 1 : 0.5)), nextStart, nextEnd)
      : undefined
    nextStart = nextEnd + 1
    offsets.set(interval.endPointId, nextStart - frameStart)
    return { endPointId: interval.endPointId, kind: interval.kind, pivotAnchorFrame }
  })
  const nextPoints = points.flatMap(point => {
    const offset = point.role === 'start' ? 0 : point.role === 'end' ? duration - 1 : offsets.get(point.pointId)
    return offset === undefined ? [] : [{ ...point, frameOffset: offset }]
  })
  const first = segments[0]!.kind
  return { frameStart, frameEnd, camera: {
    ...range.camera, shape: shapeForCameraSegmentKind(first), segments, points: nextPoints,
    pathStyle: first === 'straight' || first === 'wave' ? first : undefined,
    segmentStyles: undefined, startLabel: undefined, endLabel: undefined,
    pivotAnchorFrame: segments.length === 1 ? segments[0]!.pivotAnchorFrame : undefined,
  } }
}

export function resizeCameraInstruction(range: CameraInstructionRange, frameStart: number, frameEnd: number): CameraInstructionRange {
  const intervals = cameraInstructionIntervals(range)
  const movedBy = frameStart - range.frameStart
  if (frameEnd - range.frameEnd === movedBy) return assemble(range, intervals, frameStart)
  const first = intervals[0]!
  const last = intervals.at(-1)!
  if (intervals.length === 1) {
    const end = Math.max(frameStart, frameEnd)
    return assemble(range, [{ ...first, durationFrames: end - frameStart + 1 }], frameStart)
  }
  const start = Math.min(frameStart, first.frameEnd)
  const end = Math.max(frameEnd, last.frameStart)
  return assemble(range, intervals.map((item, index) => ({ ...item, durationFrames: index === 0
    ? first.frameEnd - start + 1 : index === intervals.length - 1 ? end - last.frameStart + 1 : item.durationFrames })), start)
}

export function changeCameraIntervalDuration(range: CameraInstructionRange, endPointId: string, requested: number,
  mode: 'boundary' | 'ripple' = 'boundary', maxFrameEnd = Number.MAX_SAFE_INTEGER): CameraInstructionRange {
  if (!Number.isFinite(requested)) return range
  const intervals = cameraInstructionIntervals(range)
  const index = intervals.findIndex(item => item.endPointId === endPointId)
  if (index < 0) return range
  const item = intervals[index]!
  const next = intervals[index + 1]
  const maximum = mode === 'boundary' && next ? item.durationFrames + next.durationFrames - 1
    : Math.max(1, maxFrameEnd - range.frameEnd + item.durationFrames)
  const durationFrames = Math.max(1, Math.min(maximum, Math.round(requested)))
  intervals[index] = { ...item, durationFrames }
  if (mode === 'boundary' && next) intervals[index + 1] = { ...next, durationFrames: next.durationFrames + item.durationFrames - durationFrames }
  return assemble(range, intervals)
}

export function moveCameraInstructionBoundary(range: CameraInstructionRange, pointId: string, absoluteFrame: number): CameraInstructionRange {
  const interval = cameraInstructionIntervals(range).find(item => item.endPointId === pointId)
  return interval ? changeCameraIntervalDuration(range, pointId, absoluteFrame - interval.frameStart) : range
}

export type CameraIntervalDivision = { mode: 'frames' | 'count' | 'at'; value: number }

export function cameraIntervalDivisionLengths(duration: number, division: CameraIntervalDivision): number[] {
  const value = Math.round(division.value)
  if (!Number.isFinite(value) || value < 1) return []
  if (division.mode === 'at') return value < duration ? [value, duration - value] : []
  if (division.mode === 'count') {
    if (value > duration) return []
    const base = Math.floor(duration / value)
    const remainder = duration % value
    return Array.from({ length: value }, (_, index) => base + (index < remainder ? 1 : 0))
  }
  return Array.from({ length: Math.ceil(duration / value) }, (_, index) => Math.min(value, duration - index * value))
}

/** null selects the whole instruction; otherwise only the selected interval is replaced. */
export function divideCameraInstruction(range: CameraInstructionRange, target: string | null, division: CameraIntervalDivision): CameraInstructionRange {
  const intervals = cameraInstructionIntervals(range)
  const index = target === null ? 0 : intervals.findIndex(item => item.endPointId === target)
  if (index < 0) return range
  const original = intervals[index]!
  const duration = target === null ? range.frameEnd - range.frameStart + 1 : original.durationFrames
  const lengths = cameraIntervalDivisionLengths(duration, division)
  if (lengths.length < 2) return range
  const originalPoints = resolveCameraInstructionPoints(range.camera, range.frameStart, range.frameEnd)
  const usedIds = new Set(originalPoints.map(point => point.pointId))
  const newPoints: CameraInstructionPoint[] = []
  let suffix = 1
  const replacement = lengths.map((length, part) => {
    let endPointId = target === null ? CAMERA_INSTRUCTION_CUE_END_POINT_ID : original.endPointId
    if (part < lengths.length - 1) {
      while (usedIds.has(`point_${suffix}`)) suffix++
      endPointId = `point_${suffix++}`
      usedIds.add(endPointId)
      newPoints.push({ pointId: endPointId, role: 'intermediate', frameOffset: 0, label: '' })
    }
    // Freshly divided OL intervals start with a centred crossing.
    return { ...original, endPointId, durationFrames: length, frameEnd: original.frameStart + length - 1,
      pivotAnchorFrame: defaultCameraOverlapPivotAnchorFrame(original.frameStart, original.frameStart + length - 1) }
  })
  const points = target === null ? originalPoints.filter(point => point.role !== 'intermediate') : originalPoints
  return assemble(range, target === null ? replacement : [...intervals.slice(0, index), ...replacement, ...intervals.slice(index + 1)],
    range.frameStart, [...points, ...newPoints])
}

/** Removing a boundary joins its neighbours using the following interval's drawing kind. */
export function removeCameraInstructionBoundary(range: CameraInstructionRange, pointId: string): CameraInstructionRange {
  const intervals = cameraInstructionIntervals(range)
  const index = intervals.findIndex(item => item.endPointId === pointId)
  if (index < 0 || index === intervals.length - 1) return range
  const following = intervals[index + 1]!
  return assemble(range, [...intervals.slice(0, index), { ...following,
    durationFrames: intervals[index]!.durationFrames + following.durationFrames }, ...intervals.slice(index + 2)])
}

export function scaleCameraInstruction(range: CameraInstructionRange, requested: number): CameraInstructionRange {
  const intervals = cameraInstructionIntervals(range)
  const target = Math.round(requested)
  if (!Number.isFinite(target) || target < intervals.length) return range
  // Constrained proportional allocation: pin sub-frame intervals to one frame,
  // then distribute integer rounding remainders in stable interval order.
  const pending = new Set(intervals.map((_, index) => index))
  const lengths = intervals.map(() => 1)
  let remaining = target
  while (pending.size) {
    const weight = [...pending].reduce((sum, index) => sum + intervals[index]!.durationFrames, 0)
    const tooShort = [...pending].filter(index => remaining * intervals[index]!.durationFrames / weight < 1)
    if (tooShort.length) {
      for (const index of tooShort) { pending.delete(index); remaining-- }
      continue
    }
    const ideals = [...pending].map(index => ({ index, value: remaining * intervals[index]!.durationFrames / weight }))
    for (const { index, value } of ideals) lengths[index] = Math.floor(value)
    const remainder = remaining - ideals.reduce((sum, item) => sum + lengths[item.index]!, 0)
    ideals.sort((a, b) => (b.value - Math.floor(b.value)) - (a.value - Math.floor(a.value)) || a.index - b.index)
    for (const { index } of ideals.slice(0, remainder)) lengths[index]!++
    break
  }
  return assemble(range, intervals.map((item, index) => ({ ...item, durationFrames: lengths[index]! })))
}
