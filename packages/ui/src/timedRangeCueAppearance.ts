import type { CSSProperties } from 'react'
import type { TimedRangeCue } from '@xsheet-remap/core'

export type TimedRangeCueTone = 'primary' | 'alternate'

export const TIMED_RANGE_CUE_TONE_PALETTE = {
  primary: {
    fill: 'rgba(37, 121, 94, 0.16)',
    hoverFill: 'rgba(37, 121, 94, 0.24)',
  },
  alternate: {
    fill: 'rgba(167, 112, 36, 0.16)',
    hoverFill: 'rgba(167, 112, 36, 0.24)',
  },
} as const satisfies Record<TimedRangeCueTone, { fill: string; hoverFill: string }>

type TimedRangeCueToneInput = Pick<TimedRangeCue, 'cueId' | 'role' | 'laneId' | 'frameStart' | 'frameEnd'>
type TimedRangeCueToneStyle = CSSProperties & {
  '--timed-range-cue-fill': string
  '--timed-range-cue-hover-fill': string
}

export function buildTimedRangeCueToneMap(cues: readonly TimedRangeCueToneInput[]): ReadonlyMap<string, TimedRangeCueTone> {
  const sorted = [...cues].sort(compareTimedRangeCueToneOrder)
  const tones = new Map<string, TimedRangeCueTone>()
  const nextRowByLane = new Map<string, number>()
  for (const cue of sorted) {
    const laneKey = `${cue.role}\u0000${cue.laneId}`
    const row = nextRowByLane.get(laneKey) ?? 0
    tones.set(cue.cueId, row % 2 === 0 ? 'primary' : 'alternate')
    nextRowByLane.set(laneKey, row + 1)
  }
  return tones
}

export function timedRangeCueToneFor(cueId: string, tones: ReadonlyMap<string, TimedRangeCueTone>): TimedRangeCueTone {
  return tones.get(cueId) ?? 'primary'
}

export function timedRangeCueToneClass(tone: TimedRangeCueTone): string {
  return tone === 'alternate' ? 'timedRangeCueToneAlternate' : 'timedRangeCueTonePrimary'
}

export function timedRangeCueToneStyle(tone: TimedRangeCueTone): TimedRangeCueToneStyle {
  const palette = TIMED_RANGE_CUE_TONE_PALETTE[tone]
  return {
    '--timed-range-cue-fill': palette.fill,
    '--timed-range-cue-hover-fill': palette.hoverFill,
  }
}

function compareTimedRangeCueToneOrder(left: TimedRangeCueToneInput, right: TimedRangeCueToneInput): number {
  return compareText(left.role, right.role)
    || compareText(left.laneId, right.laneId)
    || left.frameStart - right.frameStart
    || left.frameEnd - right.frameEnd
    || compareText(left.cueId, right.cueId)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
