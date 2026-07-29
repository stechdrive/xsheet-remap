import type { CameraInstruction, TimedRangeCue } from '@xsheet-remap/core'
import type { CameraCueDragGeometry, CameraCueDragMode } from './CameraCueLayer'
import type { SoundCueDragMode } from './SoundCueLayer'
import { clampNumber } from './sheetInteraction'

export interface SoundCuePointerDrag {
  pointerId: number
  mode: SoundCueDragMode
  origin: TimedRangeCue
  preview: TimedRangeCue
  grabOffsetFrames: number
  startX: number
  startY: number
  moved: boolean
}

export interface CameraCuePointerDrag {
  pointerId: number
  mode: CameraCueDragMode
  origin: TimedRangeCue
  preview: TimedRangeCue
  grabOffsetFrames: number
  startX: number
  startY: number
  moved: boolean
  labelGeometry?: CameraCueDragGeometry
  labelPointerOffset?: { x: number; frames: number }
  labelOriginPlacement?: NonNullable<CameraInstruction['labelPlacement']>
}

export function createSoundCuePointerDrag(input: {
  pointerId: number
  clientX: number
  clientY: number
  cue: TimedRangeCue
  mode: SoundCueDragMode
  pointedFrame?: number
}): SoundCuePointerDrag {
  const { pointerId, clientX, clientY, cue, mode, pointedFrame } = input
  return {
    pointerId,
    mode,
    origin: cue,
    preview: cue,
    grabOffsetFrames: pointedFrame === undefined
      ? 0
      : clampNumber(pointedFrame - cue.frameStart, 0, cue.frameEnd - cue.frameStart),
    startX: clientX,
    startY: clientY,
    moved: false,
  }
}

export function createCameraCuePointerDrag(input: {
  pointerId: number
  clientX: number
  clientY: number
  cue: TimedRangeCue
  mode: CameraCueDragMode
  geometry?: CameraCueDragGeometry
  pointed?: { frame: number; x: number; y: number }
}): CameraCuePointerDrag {
  const { pointerId, clientX, clientY, cue, mode, geometry, pointed } = input
  const labelLayout = geometry?.labelLayout
  const labelPointerOffset = pointed && labelLayout
    ? {
        x: pointed.x - labelLayout.rect.x,
        frames: (pointed.y - labelLayout.rect.y) / Math.max(0.000001, labelLayout.rowHeight),
      }
    : undefined
  const inferredFrameStart = pointed && labelLayout
    ? Math.round(pointed.frame - (pointed.y - labelLayout.rect.y) / Math.max(0.000001, labelLayout.rowHeight))
    : cue.frameStart
  const labelOriginPlacement = labelLayout
    ? {
        mode: 'manual' as const,
        frameOffset: clampNumber(inferredFrameStart - cue.frameStart, 0, cue.frameEnd - cue.frameStart),
        xRatio: clampNumber((labelLayout.rect.x - labelLayout.regionRect.x) / Math.max(0.000001, labelLayout.regionRect.w), 0, 0.95),
        widthRatio: clampNumber(labelLayout.rect.w / Math.max(0.000001, labelLayout.regionRect.w), 0.05, 1),
        heightFrames: Math.max(1, Math.round(labelLayout.rect.h / Math.max(0.000001, labelLayout.rowHeight))),
      }
    : undefined
  return {
    pointerId,
    mode,
    origin: cue,
    preview: cue,
    grabOffsetFrames: pointed ? clampNumber(pointed.frame - cue.frameStart, 0, cue.frameEnd - cue.frameStart) : 0,
    startX: clientX,
    startY: clientY,
    moved: false,
    labelGeometry: geometry,
    labelPointerOffset,
    labelOriginPlacement,
  }
}
