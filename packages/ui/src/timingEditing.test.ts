import { describe, expect, it } from 'vitest'
import {
  createDefaultProject,
  createOrSetEvent,
  sheetTimingRoleForEvent,
  sheetTimingRoleForKey,
  type SheetHit,
} from '@xsheet-remap/core'
import type { SheetRangeSelection } from './appTypes'
import {
  buildTimingClipboard,
  deleteTimelineFrames,
  insertTimelineFrames,
  pasteTimingClipboardToProject,
  rangeContainsHit,
  sameSheetHitCell,
} from './timingEditing'

function testHit(paperTrack: string, frame: number, role: 'action' | 'cell' = 'action'): SheetHit {
  return {
    regionId: `region_${role}`,
    role,
    paperTrack,
    columnId: paperTrack,
    label: paperTrack,
    frame,
    rowIndex: frame - 1,
    columnIndex: paperTrack.charCodeAt(0) - 65,
    pageId: 'page_1',
  }
}

function testRange(paperTrack: string, frameStart: number, frameEnd: number, role: 'action' | 'cell' = 'action'): SheetRangeSelection & { role: 'action' | 'cell'; paperTrack: string } {
  return {
    role,
    inputMode: 'point-event',
    frameStart,
    frameEnd,
    anchorFrame: frameStart,
    focusFrame: frameEnd,
    columnId: paperTrack,
    paperTracks: [paperTrack],
    paperTrack,
    anchorHit: testHit(paperTrack, frameStart, role),
    focusHit: testHit(paperTrack, frameEnd, role),
  }
}

function testMultiTrackRange(paperTracks: string[], frameStart: number, frameEnd: number, role: 'action' | 'cell' = 'action'): SheetRangeSelection & { role: 'action' | 'cell'; paperTrack: string } {
  const firstTrack = paperTracks[0] ?? 'A'
  const lastTrack = paperTracks.at(-1) ?? firstTrack
  return {
    role,
    inputMode: 'point-event',
    frameStart,
    frameEnd,
    anchorFrame: frameStart,
    focusFrame: frameEnd,
    columnId: firstTrack,
    paperTracks,
    paperTrack: firstTrack,
    anchorHit: testHit(firstTrack, frameStart, role),
    focusHit: testHit(lastTrack, frameEnd, role),
  }
}

describe('timing editing model', () => {
  it('builds a clipboard from a selected range and pastes it to another paper track', () => {
    const first = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const second = createOrSetEvent(first.project, 'A', 3, 'action')
    const clipboard = buildTimingClipboard(second.project, testRange('A', 1, 3), 'copy')
    const pasted = pasteTimingClipboardToProject(second.project, clipboard, {
      role: 'action',
      paperTrack: 'B',
      frameStart: 5,
      frameEnd: 5,
    }, 'overwrite')

    const bEvents = pasted.logicalSheet.events
      .filter(event => event.paperTrack === 'B' && sheetTimingRoleForEvent(event) === 'action')
      .sort((a, b) => a.frame - b.frame)
    const keyById = new Map(pasted.logicalSheet.keys.map(key => [key.keyId, key]))

    expect(bEvents.map(event => event.frame)).toEqual([5, 7])
    expect(bEvents.map(event => keyById.get(event.keyId)?.displayLabel)).toEqual(['1', '2'])
    expect(bEvents.map(event => keyById.get(event.keyId)?.paperTrack)).toEqual(['B', 'B'])
  })

  it('recognizes matching hit cells and range membership by role, paper track, and frame', () => {
    const range = testRange('A', 1, 3, 'cell')
    expect(rangeContainsHit(range, testHit('A', 2, 'cell'))).toBe(true)
    expect(rangeContainsHit(range, testHit('A', 2, 'action'))).toBe(false)
    expect(sameSheetHitCell(testHit('A', 2, 'cell'), testHit('A', 2, 'cell'))).toBe(true)
    expect(sameSheetHitCell(testHit('A', 2, 'cell'), testHit('A', 3, 'cell'))).toBe(false)
  })

  it('copies a multi-track rectangular range and pastes it to matching destination tracks', () => {
    const a = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const b = createOrSetEvent(a.project, 'B', 2, 'action')
    const clipboard = buildTimingClipboard(b.project, testMultiTrackRange(['A', 'B'], 1, 2), 'copy')
    const pasted = pasteTimingClipboardToProject(b.project, clipboard, {
      role: 'action',
      paperTrack: 'C',
      paperTrackOrder: ['A', 'B', 'C', 'D'],
      frameStart: 5,
      frameEnd: 5,
    }, 'overwrite')

    const pastedEvents = pasted.logicalSheet.events
      .filter(event => ['C', 'D'].includes(event.paperTrack) && sheetTimingRoleForEvent(event) === 'action')
      .sort((aEvent, bEvent) => aEvent.paperTrack.localeCompare(bEvent.paperTrack) || aEvent.frame - bEvent.frame)
    const keyById = new Map(pasted.logicalSheet.keys.map(key => [key.keyId, key]))

    expect(pastedEvents.map(event => `${event.paperTrack}:${event.frame}`)).toEqual(['C:5', 'D:6'])
    expect(pastedEvents.map(event => keyById.get(event.keyId)?.paperTrack)).toEqual(['C', 'D'])
  })

  it('reuses a source key when pasting back to the same role and paper track', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const clipboard = buildTimingClipboard(created.project, testRange('A', 1, 1), 'copy')
    const pasted = pasteTimingClipboardToProject(created.project, clipboard, {
      role: 'action',
      paperTrack: 'A',
      frameStart: 4,
      frameEnd: 4,
    }, 'overwrite')

    const sourceEvent = pasted.logicalSheet.events.find(event => event.paperTrack === 'A' && event.frame === 1)
    const pastedEvent = pasted.logicalSheet.events.find(event => event.paperTrack === 'A' && event.frame === 4)
    const key = pasted.logicalSheet.keys.find(item => item.keyId === sourceEvent?.keyId)

    expect(pastedEvent?.keyId).toBe(sourceEvent?.keyId)
    expect(key && sheetTimingRoleForKey(key)).toBe('action')
  })

  it('inserts blank frames in one paper track without changing the official duration', () => {
    const first = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const second = createOrSetEvent(first.project, 'A', 3, 'action')
    const third = createOrSetEvent(second.project, 'B', 3, 'action')

    const edited = insertTimelineFrames(third.project, {
      scope: 'track',
      role: 'action',
      paperTrack: 'A',
      atFrame: 2,
      frameCount: 2,
      durationPolicy: 'preserve',
    })

    expect(edited.logicalSheet.durationFrames).toBe(third.project.logicalSheet.durationFrames)
    expect(edited.logicalSheet.events
      .filter(event => event.paperTrack === 'A' && sheetTimingRoleForEvent(event) === 'action')
      .map(event => event.frame)
      .sort((a, b) => a - b)).toEqual([1, 5])
    expect(edited.logicalSheet.events
      .filter(event => event.paperTrack === 'B' && sheetTimingRoleForEvent(event) === 'action')
      .map(event => event.frame)).toEqual([3])
  })

  it('inserts blank frames in selected paper tracks only', () => {
    const first = createOrSetEvent(createDefaultProject(), 'A', 2, 'action')
    const second = createOrSetEvent(first.project, 'B', 2, 'action')
    const third = createOrSetEvent(second.project, 'C', 2, 'action')

    const edited = insertTimelineFrames(third.project, {
      scope: 'tracks',
      role: 'action',
      paperTrack: 'A',
      paperTracks: ['A', 'B'],
      atFrame: 2,
      frameCount: 2,
      durationPolicy: 'preserve',
    })

    expect(edited.logicalSheet.events
      .filter(event => sheetTimingRoleForEvent(event) === 'action')
      .map(event => `${event.paperTrack}:${event.frame}`)
      .sort()).toEqual(['A:4', 'B:4', 'C:2'])
  })

  it('deletes and ripples one paper track while keeping registered keys', () => {
    const first = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const second = createOrSetEvent(first.project, 'A', 2, 'action')
    const third = createOrSetEvent(second.project, 'A', 4, 'action')
    const deletedKeyId = third.project.logicalSheet.events.find(event => event.paperTrack === 'A' && event.frame === 2)?.keyId

    const edited = deleteTimelineFrames(third.project, {
      scope: 'track',
      role: 'action',
      paperTrack: 'A',
      frameStart: 2,
      frameCount: 1,
      durationPolicy: 'preserve',
    })

    expect(edited.logicalSheet.durationFrames).toBe(third.project.logicalSheet.durationFrames)
    expect(edited.logicalSheet.events
      .filter(event => event.paperTrack === 'A' && sheetTimingRoleForEvent(event) === 'action')
      .map(event => event.frame)
      .sort((a, b) => a - b)).toEqual([1, 3])
    expect(edited.logicalSheet.keys.some(key => key.keyId === deletedKeyId)).toBe(true)
  })

  it('deletes and ripples selected paper tracks only', () => {
    const first = createOrSetEvent(createDefaultProject(), 'A', 2, 'action')
    const second = createOrSetEvent(first.project, 'A', 5, 'action')
    const third = createOrSetEvent(second.project, 'B', 5, 'action')
    const fourth = createOrSetEvent(third.project, 'C', 5, 'action')

    const edited = deleteTimelineFrames(fourth.project, {
      scope: 'tracks',
      role: 'action',
      paperTrack: 'A',
      paperTracks: ['A', 'B'],
      frameStart: 2,
      frameCount: 2,
      durationPolicy: 'preserve',
    })

    expect(edited.logicalSheet.events
      .filter(event => sheetTimingRoleForEvent(event) === 'action')
      .map(event => `${event.paperTrack}:${event.frame}`)
      .sort()).toEqual(['A:3', 'B:3', 'C:5'])
  })

  it('extends and shrinks the cut duration for whole-cut frame edits', () => {
    const first = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const second = createOrSetEvent(first.project, 'B', 4, 'action')

    const inserted = insertTimelineFrames(second.project, {
      scope: 'cut',
      role: 'action',
      paperTrack: 'A',
      atFrame: 2,
      frameCount: 3,
      durationPolicy: 'extend',
    })

    expect(inserted.logicalSheet.durationFrames).toBe(second.project.logicalSheet.durationFrames + 3)
    expect(inserted.logicalSheet.events
      .map(event => `${event.paperTrack}:${event.frame}`)
      .sort()).toEqual(['A:1', 'B:7'])

    const deleted = deleteTimelineFrames(inserted, {
      scope: 'cut',
      role: 'action',
      paperTrack: 'A',
      frameStart: 2,
      frameCount: 3,
      durationPolicy: 'shrink',
    })

    expect(deleted.logicalSheet.durationFrames).toBe(second.project.logicalSheet.durationFrames)
    expect(deleted.logicalSheet.events
      .map(event => `${event.paperTrack}:${event.frame}`)
      .sort()).toEqual(['A:1', 'B:4'])
  })
})
