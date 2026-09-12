import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './project-model'
import { createOrSetEvent, clearEvent, setEvent } from './project-timing'
import { timingEventIndex, timingEventsInRange, timingGroupKey } from './timing-index'
import type { TimelineEvent } from './types'

describe('timing runtime index', () => {
  it('preserves unaffected tracks and historical reads across edits, deletion and undo', () => {
    let project = createOrSetEvent(createDefaultProject(), 'A', 1).project
    project = createOrSetEvent(project, 'B', 2).project
    const before = timingEventIndex(project.logicalSheet.events)
    const next = setEvent(project, 'A', 7, project.logicalSheet.keys[0]!.keyId)
    const after = timingEventIndex(next.logicalSheet.events)
    expect(after.groups.get(timingGroupKey('cell', 'B'))).toBe(before.groups.get(timingGroupKey('cell', 'B')))
    expect(timingEventsInRange(next.logicalSheet.events, 2, 7).map(event => event.frame).sort()).toEqual([2, 7])
    const removed = clearEvent(next, 'A', 7)
    expect(timingEventsInRange(removed.logicalSheet.events, 7, 7)).toEqual([])
    expect(timingEventsInRange(project.logicalSheet.events, 1, 144)).toEqual(project.logicalSheet.events)
    expect(after.changes?.[0]).toMatchObject({ role: 'cell', paperTrack: 'A', frameStart: 7, frameEnd: 7 })
    expect(clearEvent(removed, 'A', 7)).toBe(removed)
  })

  it('bounds a small visible query independently of the total number of events', () => {
    let reads = 0
    const events: TimelineEvent[] = Array.from({ length: 100_000 }, (_, index) => ({
      eventId: `event_${index}`, paperTrack: 'A', sheetRole: 'cell', keyId: 'key_1', source: 'manual', valueKind: 'cell',
      get frame() { reads++; return index + 1 },
    }))
    timingEventIndex(events)
    reads = 0
    expect(timingEventsInRange(events, 50_000, 50_005).map(event => event.frame)).toEqual([50_000, 50_001, 50_002, 50_003, 50_004, 50_005])
    expect(reads).toBeLessThan(100)
  })
})
