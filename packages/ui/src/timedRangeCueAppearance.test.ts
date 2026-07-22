import { describe, expect, it } from 'vitest'
import type { TimedRangeCue } from '@xsheet-remap/core'
import { buildTimedRangeCueToneMap, timedRangeCueToneFor } from './timedRangeCueAppearance'

describe('timed range cue appearance', () => {
  it('alternates by visual row within each role and lane regardless of project order', () => {
    const cues: TimedRangeCue[] = [
      cue('sound-lane-1-third', 'sound', 'sound_lane_1', 30, 36),
      cue('camera-lane-1-first', 'camera', 'camera_lane_1', 1, 6),
      cue('sound-lane-2-first', 'sound', 'sound_lane_2', 5, 8),
      cue('sound-lane-1-second', 'sound', 'sound_lane_1', 20, 24),
      cue('sound-lane-1-first', 'sound', 'sound_lane_1', 10, 12),
    ]

    const tones = buildTimedRangeCueToneMap(cues)

    expect(timedRangeCueToneFor('sound-lane-1-first', tones)).toBe('primary')
    expect(timedRangeCueToneFor('sound-lane-1-second', tones)).toBe('alternate')
    expect(timedRangeCueToneFor('sound-lane-1-third', tones)).toBe('primary')
    expect(timedRangeCueToneFor('sound-lane-2-first', tones)).toBe('primary')
    expect(timedRangeCueToneFor('camera-lane-1-first', tones)).toBe('primary')
  })
})

function cue(cueId: string, role: TimedRangeCue['role'], laneId: string, frameStart: number, frameEnd: number): TimedRangeCue {
  return { cueId, role, laneId, frameStart, frameEnd, label: cueId, text: '', source: 'manual' }
}
