import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './project-model'
import { createOrSetEvent } from './project-timing'
import { createTimedRangeCue } from './timed-range'
import { applyCutTimelineFrameEdit } from './timeline-frame-edit'
import { validateProject } from './validation'

describe('cut timeline frame editing', () => {
  it('atomically inserts frames across point events, SOUND, CAMERA, and cut duration', () => {
    const source = timelineFixture()

    const edited = applyCutTimelineFrameEdit(source, { kind: 'insert', atFrame: 6, frameCount: 3 })

    expect(edited.logicalSheet.durationFrames).toBe(source.logicalSheet.durationFrames + 3)
    expect(eventFrames(edited)).toEqual(['action:A:5', 'cell:B:11'])
    expect(cue(edited, 'SOUND')).toMatchObject({ frameStart: 4, frameEnd: 13 })
    expect(cue(edited, 'CAMERA')).toMatchObject({
      frameStart: 4,
      frameEnd: 13,
      camera: {
        pivotFrame: 10,
        labelPlacement: { frameOffset: 5, heightFrames: 3 },
      },
    })
    expect(validateProject(edited).filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('restores the complete timeline when an inserted span is deleted again', () => {
    const source = timelineFixture()
    const inserted = applyCutTimelineFrameEdit(source, { kind: 'insert', atFrame: 6, frameCount: 3 })

    const restored = applyCutTimelineFrameEdit(inserted, { kind: 'delete', frameStart: 6, frameCount: 3 })

    expect(restored).toEqual(source)
  })

  it('deletes fully covered cues, contracts partial cues, and retains registered keys', () => {
    let source = createDefaultProject()
    const event = createOrSetEvent(source, 'A', 8, 'action')
    source = event.project
    source = createTimedRangeCue(source, {
      role: 'sound', laneId: 'sound_lane_1', frameStart: 6, frameEnd: 8, label: 'DELETE',
    }).project
    source = createTimedRangeCue(source, {
      role: 'camera', laneId: 'camera_lane_1', frameStart: 4, frameEnd: 12, label: 'KEEP',
      camera: {
        shape: 'overlap', startLabel: 'A', endLabel: 'B', pivotFrame: 7,
        labelPlacement: { mode: 'manual', frameOffset: 2, xRatio: 0.1, widthRatio: 0.8, heightFrames: 3 },
      },
    }).project
    const keyCount = source.logicalSheet.keys.length

    const edited = applyCutTimelineFrameEdit(source, { kind: 'delete', frameStart: 6, frameCount: 3 })

    expect(edited.logicalSheet.events).toEqual([])
    expect(edited.logicalSheet.keys).toHaveLength(keyCount)
    expect(edited.timedRangeCues.some(item => item.label === 'DELETE')).toBe(false)
    expect(cue(edited, 'KEEP')).toMatchObject({
      frameStart: 4,
      frameEnd: 9,
      camera: {
        pivotFrame: 6,
        labelPlacement: { frameOffset: 2, heightFrames: 1 },
      },
    })
    expect(validateProject(edited).filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('clips deletion to the official cut and leaves page-bound content untouched', () => {
    const source = timelineFixture()
    const annotation = {
      annotationId: 'annotation_1', pageId: 'page_1', kind: 'text' as const, text: 'paper note',
      x: 10, y: 20, color: '#000', fontSizePx: 12,
    }
    source.annotations = [annotation]
    const officialEnd = source.logicalSheet.frameOrigin + source.logicalSheet.durationFrames - 1

    const edited = applyCutTimelineFrameEdit(source, { kind: 'delete', frameStart: officialEnd + 1, frameCount: 20 })

    expect(edited).toBe(source)
    expect(edited.annotations).toEqual([annotation])
  })

  it('moves timeline memo anchors on insert without slicing their canvas or ink', () => {
    const source = timelineFixture()
    source.timelineMemos = [{
      memoId: 'timeline_memo_1',
      anchor: { role: 'action', frame: 8, paperTrack: 'A' },
      placement: { frameOffset: -1, crossOffsetUnits: 2, widthUnits: 12, heightFrames: 18 },
      strokes: [{ strokeId: 'stroke_1', color: '#d52b2b', widthUnits: 0.2, points: [{ x: 1, y: 1 }, { x: 4, y: 9 }] }],
      order: 1,
    }]

    const edited = applyCutTimelineFrameEdit(source, { kind: 'insert', atFrame: 6, frameCount: 3 })

    expect(edited.timelineMemos[0]).toEqual({
      ...source.timelineMemos[0],
      anchor: { ...source.timelineMemos[0]!.anchor, frame: 11 },
    })
  })

  it('deletes a memo only when its anchor frame is removed and shifts later anchors', () => {
    const source = timelineFixture()
    const makeMemo = (memoId: string, frame: number) => ({
      memoId,
      anchor: { role: 'cell' as const, frame, paperTrack: 'A' },
      placement: { frameOffset: -2, crossOffsetUnits: 0, widthUnits: 10, heightFrames: 24 },
      strokes: [],
      order: frame,
    })
    source.timelineMemos = [makeMemo('before', 4), makeMemo('anchored-inside', 7), makeMemo('after', 12)]

    const edited = applyCutTimelineFrameEdit(source, { kind: 'delete', frameStart: 6, frameCount: 3 })

    expect(edited.timelineMemos.map(memo => [memo.memoId, memo.anchor.frame])).toEqual([['before', 4], ['after', 9]])
    expect(edited.timelineMemos[0]?.placement.heightFrames).toBe(24)
  })
})

function timelineFixture() {
  let project = createDefaultProject()
  project = createOrSetEvent(project, 'A', 5, 'action').project
  project = createOrSetEvent(project, 'B', 8, 'cell').project
  project = createTimedRangeCue(project, {
    role: 'sound', laneId: 'sound_lane_1', frameStart: 4, frameEnd: 10, label: 'SOUND', text: 'line',
  }).project
  project = createTimedRangeCue(project, {
    role: 'camera', laneId: 'camera_lane_1', frameStart: 4, frameEnd: 10, label: 'CAMERA',
    camera: {
      shape: 'overlap', startLabel: 'A', endLabel: 'B', pivotFrame: 7,
      labelPlacement: { mode: 'manual', frameOffset: 2, xRatio: 0.1, widthRatio: 0.8, heightFrames: 3 },
    },
  }).project
  return project
}

function eventFrames(project: ReturnType<typeof timelineFixture>): string[] {
  return project.logicalSheet.events
    .map(event => `${event.sheetRole ?? 'cell'}:${event.paperTrack}:${event.frame}`)
    .sort()
}

function cue(project: ReturnType<typeof timelineFixture>, label: string) {
  return project.timedRangeCues.find(item => item.label === label)
}
