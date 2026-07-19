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
import { addTimelineMemo } from './timeline-memo'

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

    const relabeled = {
      ...custom,
      regions: custom.regions.map(region => region.grid?.role === 'sound'
        ? { ...region, label: 'セリフ 1-144' }
        : region),
    }
    const relabeledProject = updateProjectTimelineSectionsFromTemplate(createDefaultProject(), relabeled)
    expect(relabeledProject.logicalSheet.timelineSections.find(section => section.role === 'sound')?.label).toBe('セリフ')

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

  it('keeps cue-linked memos synchronized and removes them with their cue', () => {
    const created = createTimedRangeCue(createDefaultProject(), {
      role: 'sound', laneId: 'sound_lane_1', frameStart: 4, frameEnd: 10, label: '声',
    })
    const withMemo = addTimelineMemo(created.project, {
      kind: 'timeline',
      memoId: 'timeline_memo_1',
      anchor: { role: 'sound', laneId: created.cue.laneId, frame: created.cue.frameStart, cueId: created.cue.cueId },
      placement: { frameOffset: 0, crossOffsetUnits: 0, widthUnits: 8, heightFrames: 7 },
      strokes: [],
      order: 1,
    })

    const moved = updateTimedRangeCue(withMemo, created.cue.cueId, {
      laneId: 'sound_lane_2', frameStart: 12, frameEnd: 18,
    })
    expect(moved.memos[0]).toMatchObject({
      anchor: { role: 'sound', laneId: 'sound_lane_2', frame: 12, cueId: created.cue.cueId },
    })
    expect(validateProject(moved).filter(issue => issue.code.startsWith('memo.cue.'))).toEqual([])

    const deleted = deleteTimedRangeCue(moved, created.cue.cueId)
    expect(deleted.memos).toEqual([])
  })

  it('normalizes semantic CAMERA geometry and logical manual label placement', () => {
    const created = createTimedRangeCue(createDefaultProject(), {
      role: 'camera',
      laneId: 'camera_lane_1',
      frameStart: 20,
      frameEnd: 10,
      label: '  PAN  ',
      text: '  成果物に出ない旧補足  ',
      camera: {
        shape: 'overlap',
        startLabel: ' A ',
        endLabel: ' B ',
        pivotAnchorFrame: 30,
        labelPlacement: { mode: 'manual', frameOffset: 99, xRatio: 0.9, widthRatio: 0.8, heightFrames: 2.4 },
      },
    })
    expect(created.cue).toMatchObject({
      role: 'camera',
      frameStart: 10,
      frameEnd: 20,
      label: 'PAN',
      text: '',
      camera: {
        shape: 'overlap',
        points: [
          { pointId: 'point_start', role: 'start', frameOffset: 0, label: 'A' },
          { pointId: 'point_end', role: 'end', frameOffset: 10, label: 'B' },
        ],
        pivotAnchorFrame: 20,
        labelPlacement: { mode: 'manual', frameOffset: 10, xRatio: 0.9, heightFrames: 2 },
      },
    })
    expect(created.cue.camera?.labelPlacement?.widthRatio).toBeCloseTo(0.1)

    const faded = updateTimedRangeCue(created.project, created.cue.cueId, {
      camera: { ...created.cue.camera!, shape: 'fade-in', segments: [{ endPointId: 'cue-end', kind: 'fade-in' }] },
    })
    expect(faded.timedRangeCues[0]?.camera?.pivotAnchorFrame).toBeUndefined()
    expect(validateProject(faded).filter(issue => issue.code.startsWith('cue.camera.'))).toEqual([])
  })

  it('normalizes CAMERA range path styles by stable intermediate-point targets', () => {
    const created = createTimedRangeCue(createDefaultProject(), {
      role: 'camera',
      laneId: 'camera_lane_1',
      frameStart: 1,
      frameEnd: 24,
      label: 'Follow',
      camera: {
        shape: 'range',
        pathStyle: 'wave',
        points: [{ pointId: 'mid', role: 'intermediate', frameOffset: 11, label: 'B' }],
        segmentStyles: [
          { endPointId: 'mid', style: 'straight' },
          { endPointId: 'removed', style: 'wave' },
        ],
      },
    })
    expect(created.cue.camera?.segments).toEqual([
      { endPointId: 'mid', kind: 'straight', pivotAnchorFrame: undefined },
      { endPointId: 'cue-end', kind: 'wave', pivotAnchorFrame: undefined },
    ])
    expect(validateProject(created.project).filter(issue => issue.code === 'cue.camera.segmentStyles.invalid')).toEqual([])
  })

  it('normalizes mixed CAMERA interval kinds and keeps an unlabeled geometry point', () => {
    const created = createTimedRangeCue(createDefaultProject(), {
      role: 'camera', laneId: 'camera_lane_1', frameStart: 1, frameEnd: 24, label: 'MIX',
      camera: {
        shape: 'range',
        points: [
          { pointId: 'mid_a', role: 'intermediate', frameOffset: 6, label: '' },
          { pointId: 'mid_b', role: 'intermediate', frameOffset: 12, label: 'B' },
        ],
        segments: [
          { endPointId: 'mid_a', kind: 'wave' },
          { endPointId: 'mid_b', kind: 'fade-in' },
          { endPointId: 'cue-end', kind: 'overlap', pivotAnchorFrame: 18 },
        ],
      },
    })
    expect(created.cue.camera?.points?.find(point => point.pointId === 'mid_a')?.label).toBe('')
    expect(created.cue.camera?.segments).toEqual([
      { endPointId: 'mid_a', kind: 'wave', pivotAnchorFrame: undefined },
      { endPointId: 'mid_b', kind: 'fade-in', pivotAnchorFrame: undefined },
      { endPointId: 'cue-end', kind: 'overlap', pivotAnchorFrame: 18 },
    ])
    expect(validateProject(created.project).filter(issue => issue.code.startsWith('cue.camera.'))).toEqual([])
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
