import { describe, expect, it } from 'vitest'
import {
  createDefaultProject,
  createProjectFromTemplate,
  createTimedRangeCue,
  deleteTimedRangeCue,
  digitalStandardSheetTemplate,
  timedRangeCuesIntersecting,
  updateProjectTimelineSectionsFromTemplate,
  updateTimedRangeCue,
  validateProject,
} from './index'

describe('timed range cues', () => {
  it('projects stable SOUND lanes from paper, digital, and custom template columns', () => {
    const paper = createDefaultProject().logicalSheet.timelineSections.find(section => section.role === 'sound')
    const digital = createProjectFromTemplate(digitalStandardSheetTemplate).logicalSheet.timelineSections.find(section => section.role === 'sound')
    expect(paper?.lanes).toEqual([
      { laneId: 'sound_lane_1', label: 'S1', order: 0 },
      { laneId: 'sound_lane_2', label: 'S2', order: 1 },
      { laneId: 'sound_lane_3', label: 'S3', order: 2 },
      { laneId: 'sound_lane_4', label: 'S4', order: 3 },
    ])
    expect(digital?.lanes?.map(lane => lane.laneId)).toEqual(paper?.lanes?.map(lane => lane.laneId))

    const custom = {
      ...digitalStandardSheetTemplate,
      regions: digitalStandardSheetTemplate.regions.map(region => region.grid?.role === 'sound'
        ? { ...region, grid: { ...region.grid, columns: region.grid.columns.slice(0, 2) } }
        : region),
    }
    const synced = updateProjectTimelineSectionsFromTemplate(createDefaultProject(), custom)
    expect(synced.logicalSheet.timelineSections.find(section => section.role === 'sound')?.lanes).toHaveLength(2)

    const withCue = createTimedRangeCue(createDefaultProject(), {
      role: 'sound', laneId: 'sound_lane_1', frameStart: 1, frameEnd: 6, label: '声',
    }).project
    const renamedLanes = {
      ...digitalStandardSheetTemplate,
      regions: digitalStandardSheetTemplate.regions.map(region => region.grid?.role === 'sound'
        ? { ...region, grid: { ...region.grid, columns: region.grid.columns.map((column, index) => ({ ...column, timelineLaneId: `custom_sound_${index + 1}` })) } }
        : region),
    }
    const remapped = updateProjectTimelineSectionsFromTemplate(withCue, renamedLanes)
    expect(remapped.timedRangeCues[0]?.laneId).toBe('custom_sound_1')
  })

  it('creates, edits, queries, and deletes a SOUND interval without a kind field', () => {
    const initial = createDefaultProject()
    const created = createTimedRangeCue(initial, {
      role: 'sound',
      laneId: 'sound_lane_1',
      frameStart: 1,
      frameEnd: 12,
      label: '  アキラ  ',
      text: '  走れ！  ',
    })
    expect(created.cue).toMatchObject({
      cueId: 'cue_1',
      role: 'sound',
      laneId: 'sound_lane_1',
      frameStart: 1,
      frameEnd: 12,
      label: 'アキラ',
      text: '走れ！',
    })
    expect('kind' in created.cue).toBe(false)
    expect(timedRangeCuesIntersecting(created.project, 'sound', 'sound_lane_1', 12, 20)).toEqual([created.cue])

    const updated = updateTimedRangeCue(created.project, created.cue.cueId, { frameStart: 4, frameEnd: 18, label: 'SE' })
    expect(updated.timedRangeCues[0]).toMatchObject({ frameStart: 4, frameEnd: 18, label: 'SE' })
    expect(deleteTimedRangeCue(updated, created.cue.cueId).timedRangeCues).toEqual([])
  })

  it('normalizes semantic CAMERA geometry and logical manual label placement', () => {
    const created = createTimedRangeCue(createDefaultProject(), {
      role: 'camera',
      laneId: 'camera_lane_1',
      frameStart: 20,
      frameEnd: 10,
      label: '  PAN  ',
      camera: {
        shape: 'overlap',
        startLabel: ' A ',
        endLabel: ' B ',
        pivotFrame: 30,
        labelPlacement: { mode: 'manual', frameOffset: 99, xRatio: 0.9, widthRatio: 0.8, heightFrames: 2.4 },
      },
    })
    expect(created.cue).toMatchObject({
      role: 'camera',
      frameStart: 10,
      frameEnd: 20,
      label: 'PAN',
      camera: {
        shape: 'overlap',
        startLabel: 'A',
        endLabel: 'B',
        pivotFrame: 20,
        labelPlacement: { mode: 'manual', frameOffset: 10, xRatio: 0.9, heightFrames: 2 },
      },
    })
    expect(created.cue.camera?.labelPlacement?.widthRatio).toBeCloseTo(0.1)

    const faded = updateTimedRangeCue(created.project, created.cue.cueId, {
      camera: { ...created.cue.camera!, shape: 'fade-in' },
    })
    expect(faded.timedRangeCues[0]?.camera?.pivotFrame).toBeUndefined()
    expect(validateProject(faded).filter(issue => issue.code.startsWith('cue.camera.'))).toEqual([])
  })

  it('rejects missing lanes and validation reports invalid stored lane references', () => {
    const project = createDefaultProject()
    expect(() => createTimedRangeCue(project, {
      role: 'sound',
      laneId: 'missing_lane',
      frameStart: 1,
      frameEnd: 1,
      label: 'SE',
    })).toThrow(/lane not found/)

    const invalid = {
      ...project,
      timedRangeCues: [{
        cueId: 'cue_invalid',
        role: 'sound' as const,
        laneId: 'missing_lane',
        frameStart: 1,
        frameEnd: 1,
        label: 'SE',
        text: '',
        source: 'manual' as const,
      }],
    }
    expect(validateProject(invalid).some(issue => issue.code === 'cue.lane.missing')).toBe(true)
  })
})
