import { describe, expect, it } from 'vitest'
import { createDefaultProject, createTimedRangeCue, standardA3SheetTemplate } from '@xsheet-remap/core'
import {
  buildSoundCueClipboard,
  cutSoundCuesToClipboard,
  normalizeSoundLabelHistory,
  pasteSoundCueClipboard,
  recordSoundLabelHistory,
  soundLaneIdForHit,
} from './soundCueEditing'

function projectWithCues() {
  let project = createDefaultProject()
  for (const [frameStart, frameEnd, label] of [[1, 6, 'A'], [12, 18, 'B']] as const) {
    project = createTimedRangeCue(project, {
      role: 'sound', laneId: 'sound_lane_1', frameStart, frameEnd, label,
    }).project
  }
  return project
}

describe('SOUND cue editing helpers', () => {
  it('keeps one normalized MRU regardless of label meaning', () => {
    expect(normalizeSoundLabelHistory(['アキラ', 'SE', ' アキラ ', 'se'])).toEqual(['アキラ', 'SE'])
    expect(recordSoundLabelHistory(['アキラ', 'SE'], 'SE')).toEqual(['SE', 'アキラ'])
    const many = Array.from({ length: 30 }, (_, index) => `L${index}`)
    expect(normalizeSoundLabelHistory(many)).toHaveLength(24)
  })

  it('maps both A3 SOUND halves to the same stable logical lane', () => {
    const left = standardA3SheetTemplate.regions.find(region => region.regionId === 'left_sound_grid')!
    const right = standardA3SheetTemplate.regions.find(region => region.regionId === 'right_sound_grid')!
    expect(soundLaneIdForHit(standardA3SheetTemplate, { regionId: left.regionId, columnId: 'sound_1', columnIndex: 0 })).toBe('sound_lane_1')
    expect(soundLaneIdForHit(standardA3SheetTemplate, { regionId: right.regionId, columnId: 'sound_1', columnIndex: 0 })).toBe('sound_lane_1')
  })

  it('cuts exact source cues and overwrites collisions at the paste target', () => {
    const project = projectWithCues()
    const clipboard = buildSoundCueClipboard(project, {
      laneId: 'sound_lane_1', frameStart: 1, frameEnd: 6, cueId: 'cue_1', mode: 'cut',
    })!
    const cut = cutSoundCuesToClipboard(project, clipboard)
    expect(cut.timedRangeCues.map(cue => cue.label)).toEqual(['B'])

    const pasted = pasteSoundCueClipboard(cut, clipboard, { laneId: 'sound_lane_1', frameStart: 12 }, 'overwrite')
    expect(pasted.project.timedRangeCues).toHaveLength(1)
    expect(pasted.project.timedRangeCues[0]).toMatchObject({ label: 'A', frameStart: 12, frameEnd: 17 })
  })

  it('insert-pastes by pushing intersecting cues without splitting dialogue', () => {
    const project = projectWithCues()
    const clipboard = buildSoundCueClipboard(project, {
      laneId: 'sound_lane_1', frameStart: 1, frameEnd: 6, cueId: 'cue_1', mode: 'copy',
    })!
    const pasted = pasteSoundCueClipboard(project, clipboard, { laneId: 'sound_lane_1', frameStart: 12 }, 'insert')
    expect(pasted.project.timedRangeCues.map(cue => [cue.label, cue.frameStart, cue.frameEnd])).toEqual([
      ['A', 1, 6],
      ['B', 18, 24],
      ['A', 12, 17],
    ])
  })
})
