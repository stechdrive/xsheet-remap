import { describe, expect, it } from 'vitest'
import { createDefaultProject, createTimedRangeCue, validateProject } from './index'
import {
  cameraInstructionIntervals, cameraIntervalDivisionLengths, changeCameraIntervalDuration, divideCameraInstruction,
  moveCameraInstructionBoundary, removeCameraInstructionBoundary, resizeCameraInstruction, scaleCameraInstruction,
  type CameraInstructionRange,
} from './camera-instruction-editing'

const range = (duration = 72): CameraInstructionRange => ({ frameStart: 101, frameEnd: 100 + duration, camera: { shape: 'overlap', points: [] } })
const lengths = (value: CameraInstructionRange) => cameraInstructionIntervals(value).map(item => item.durationFrames)
const divided = (duration = 72, value = 12) => divideCameraInstruction(range(duration), null, { mode: 'frames', value })

describe('CAMERA interval editing', () => {
  it('distinguishes fixed length, count and explicit boundary including a one-frame remainder', () => {
    expect(lengths(divided(70))).toEqual([12, 12, 12, 12, 12, 10])
    expect(lengths(divided(73))).toEqual([12, 12, 12, 12, 12, 12, 1])
    expect(cameraIntervalDivisionLengths(70, { mode: 'count', value: 6 })).toEqual([12, 12, 12, 12, 11, 11])
    expect(cameraIntervalDivisionLengths(2, { mode: 'at', value: 1 })).toEqual([1, 1])
    expect(cameraIntervalDivisionLengths(6, { mode: 'count', value: 7 })).toEqual([])
    expect(cameraIntervalDivisionLengths(6, { mode: 'frames', value: 0 })).toEqual([])
  })

  it('keeps FI and the surrounding intervals while subdividing a selected OL', () => {
    let draft = divideCameraInstruction(range(), null, { mode: 'at', value: 6 })
    draft.camera.segments![0]!.kind = 'fade-in'
    draft = divideCameraInstruction(draft, 'cue-end', { mode: 'frames', value: 12 })
    expect(lengths(draft)).toEqual([6, 12, 12, 12, 12, 12, 6])
    expect(cameraInstructionIntervals(draft).map(item => item.kind)).toEqual(['fade-in', ...Array(6).fill('overlap')])
    expect(new Set(draft.camera.points!.map(point => point.pointId)).size).toBe(6)
  })

  it('makes numeric duration and boundary dragging identical and keeps distant intervals fixed', () => {
    const draft = divided(36)
    const first = cameraInstructionIntervals(draft)[0]!
    const numeric = changeCameraIntervalDuration(draft, first.endPointId, 14)
    const drag = moveCameraInstructionBoundary(draft, first.endPointId, 115)
    expect(drag).toEqual(numeric)
    expect(lengths(numeric)).toEqual([14, 10, 12])
    expect(numeric.frameEnd).toBe(draft.frameEnd)
    expect(lengths(changeCameraIntervalDuration(draft, first.endPointId, 30))).toEqual([23, 1, 12])
  })

  it('ripples only the instruction tail and moves every following pivot with it', () => {
    const draft = divided(36)
    const original = cameraInstructionIntervals(draft)
    const edited = changeCameraIntervalDuration(draft, original[0]!.endPointId, 14, 'ripple')
    expect(lengths(edited)).toEqual([14, 12, 12])
    expect(edited.frameEnd).toBe(draft.frameEnd + 2)
    expect(cameraInstructionIntervals(edited)[2]!.pivotAnchorFrame).toBe(original[2]!.pivotAnchorFrame! + 2)
    expect(lengths(changeCameraIntervalDuration(draft, original[0]!.endPointId, 99, 'ripple', draft.frameEnd + 3))).toEqual([15, 12, 12])
  })

  it('resizes only the edge interval and never consumes an internal boundary', () => {
    const draft = divided(36)
    expect(lengths(resizeCameraInstruction(draft, 101, 140))).toEqual([12, 12, 16])
    expect(lengths(resizeCameraInstruction(draft, 101, 110))).toEqual([12, 12, 1])
    expect(resizeCameraInstruction(draft, 101, 110).frameEnd).toBe(125)
    expect(lengths(resizeCameraInstruction(draft, 120, 136))).toEqual([1, 12, 12])
    expect(resizeCameraInstruction(draft, 120, 136).frameStart).toBe(112)
    const moved = resizeCameraInstruction(draft, 111, 146)
    expect(lengths(moved)).toEqual([12, 12, 12])
    expect(moved.camera.points).toEqual(draft.camera.points)
  })

  it('preserves centred and manually offset OL ratios under even and odd resizing', () => {
    const draft = range(12)
    draft.camera.segments = [{ endPointId: 'cue-end', kind: 'overlap', pivotAnchorFrame: 103 }]
    expect(cameraInstructionIntervals(scaleCameraInstruction(draft, 24))[0]!.pivotAnchorFrame).toBe(106)
    for (const duration of [1, 2, 3, 11, 12, 13]) {
      const scaled = scaleCameraInstruction(range(12), duration)
      expect(cameraInstructionIntervals(scaled)[0]!.pivotAnchorFrame).toBe(101 + Math.floor((duration - 1) / 2))
    }
  })

  it('scales uneven intervals to exact integer totals without losing an interval', () => {
    const draft = divideCameraInstruction(range(24), null, { mode: 'at', value: 6 })
    expect(lengths(scaleCameraInstruction(draft, 48))).toEqual([12, 36])
    expect(lengths(scaleCameraInstruction(draft, 3))).toEqual([1, 2])
    expect(scaleCameraInstruction(draft, 1)).toBe(draft)
    for (let target = 6; target <= 120; target++) {
      const result = lengths(scaleCameraInstruction(divided(70), target))
      expect(result.reduce((sum, value) => sum + value, 0)).toBe(target)
      expect(result.every(value => Number.isInteger(value) && value >= 1)).toBe(true)
    }
  })

  it('merges a boundary using the following kind and retains the whole duration', () => {
    const draft = divided(36)
    draft.camera.segments![1]!.kind = 'fade-in'
    const merged = removeCameraInstructionBoundary(draft, draft.camera.segments![0]!.endPointId)
    expect(lengths(merged)).toEqual([24, 12])
    expect(cameraInstructionIntervals(merged)[0]!.kind).toBe('fade-in')
    expect(merged.camera.points).toHaveLength(1)
  })

  it('normalizes and validates a single instruction with one-frame intervals and endpoint labels', () => {
    const draft = divided(2, 1)
    draft.camera.points!.push({ pointId: 'start', role: 'start', frameOffset: 0, label: '開始' },
      { pointId: 'end', role: 'end', frameOffset: 1, label: '終了' })
    const created = createTimedRangeCue(createDefaultProject(), { ...draft, role: 'camera', laneId: 'camera_lane_1', label: '「ストロボー。」' })
    expect(created.project.timedRangeCues).toHaveLength(1)
    expect(created.cue.camera!.points).toHaveLength(3)
    expect(lengths({ ...created.cue, camera: created.cue.camera! })).toEqual([1, 1])
    expect(validateProject(created.project).filter(issue => issue.code.startsWith('cue.'))).toEqual([])
  })
})
