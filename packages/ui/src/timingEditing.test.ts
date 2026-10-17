import { describe, expect, it } from 'vitest'
import {
  createDefaultProject,
  createOrSetEvent,
  setTimingReferenceAt,
  setTimingSpecialEvent,
  registerAsset,
  sheetTimingRoleForEvent,
  sheetTimingRoleForKey,
  upsertBinding,
  updateLogicalSheetSettings,
  validateProject,
  type SheetHit,
} from '@xsheet-remap/core'
import type { SheetRangeSelection } from './appTypes'
import {
  buildTimingClipboard,
  clearTimingRange,
  deleteTimelineFrames,
  ensurePostRollCoversFrame,
  insertTimelineFrames,
  moveTimingEventsInRange,
  planTimingRangeMove,
  prepareTimingRangeMove,
  pasteTimingClipboardToProject,
  rangeContainsHit,
  sameSheetHitCell,
} from './timingEditing'
import { bindAssetToHit } from './sheetAssets'

describe('reference notation editing', () => {
  it('copies numbered and empty marks across roles, repeats and overwrites old marks', () => {
    const source = setTimingReferenceAt(setTimingReferenceAt(createOrSetEvent(createDefaultProject(), 'A', 1, 'cell').project, 'A', 1, 'cell', true), 'A', 2, 'cell', true)
    const clipboard = buildTimingClipboard(source, testRange('A', 1, 3, 'cell'), 'copy')
    const pasted = pasteTimingClipboardToProject(source, clipboard, { role: 'action', paperTrack: 'B', frameStart: 5, frameEnd: 10 }, 'repeat-range')
    expect(pasted.logicalSheet.referenceMarks?.filter(mark => mark.sheetRole === 'action').map(mark => mark.frame)).toEqual([5, 6, 8, 9])
    expect(pasted.logicalSheet.events.filter(event => event.sheetRole === 'action' && event.paperTrack === 'B').map(event => event.frame)).toEqual([5, 8])
    const empty = buildTimingClipboard(source, testRange('A', 3, 3, 'cell'), 'copy')
    const overwritten = pasteTimingClipboardToProject(pasted, empty, { role: 'action', paperTrack: 'B', frameStart: 6, frameEnd: 6 }, 'overwrite')
    expect(overwritten.logicalSheet.referenceMarks?.filter(mark => mark.sheetRole === 'action').map(mark => mark.frame)).toEqual([5, 8, 9])
  })
  it('moves empty marks, counts mark-only collisions and clears them with Delete', () => {
    const source = setTimingReferenceAt(setTimingReferenceAt(createDefaultProject(), 'A', 2, 'cell', true), 'B', 5, 'cell', true)
    const result = moveTimingEventsInRange(source, testRange('A', 2, 2, 'cell'), testHit('A', 2, 'cell'), testHit('B', 5, 'cell'), ['A', 'B'])
    expect(result.status).toBe('moved')
    expect(result.collisionCount).toBe(1)
    expect(result.project.logicalSheet.referenceMarks).toEqual([{ sheetRole: 'cell', paperTrack: 'B', frame: 5 }])
    expect(result.project.logicalSheet.events).toEqual([])
    expect(clearTimingRange(result.project, testRange('B', 5, 5, 'cell')).logicalSheet.referenceMarks).toEqual([])
  })
  it('shifts only the selected track and role for insertion/deletion', () => {
    const source = setTimingReferenceAt(setTimingReferenceAt(createDefaultProject(), 'A', 5, 'cell', true), 'A', 5, 'action', true)
    const inserted = insertTimelineFrames(source, { scope: 'track', role: 'cell', paperTrack: 'A', atFrame: 4, frameCount: 3, durationPolicy: 'preserve' })
    expect(inserted.logicalSheet.referenceMarks?.map(mark => mark.frame)).toEqual([8, 5])
    const deleted = deleteTimelineFrames(inserted, { scope: 'track', role: 'cell', paperTrack: 'A', frameStart: 4, frameCount: 3, durationPolicy: 'preserve' })
    expect(deleted.logicalSheet.referenceMarks).toEqual(source.logicalSheet.referenceMarks)
  })
})

describe('post-roll work area', () => {
  it('repeats a cycle beyond the official end into the visible dummy frames', () => {
    const first = createOrSetEvent(createDefaultProject(), 'A', 1, 'cell')
    const second = createOrSetEvent(first.project, 'A', 3, 'cell')
    const project = updateLogicalSheetSettings(second.project, {
      workRange: { ...second.project.logicalSheet.workRange, postRollFrames: 24, showPostRoll: true },
    })
    const clipboard = buildTimingClipboard(project, testRange('A', 1, 4, 'cell'), 'copy')
    const repeated = pasteTimingClipboardToProject(project, clipboard, { role: 'cell', paperTrack: 'A', frameStart: 141, frameEnd: 141 }, 'repeat-to-end')
    expect(repeated.logicalSheet.events.filter(event => event.frame >= 141).map(event => [event.frame, event.keyId])).toEqual(
      Array.from({ length: 14 }, (_, index) => [141 + index * 2, index % 2 === 0 ? first.key.keyId : second.key.keyId]),
    )
    expect(repeated.logicalSheet.durationFrames).toBe(144)
    expect(validateProject(repeated).some(issue => issue.code === 'event.frame.afterDuration')).toBe(false)
  })

  it('preserves a hidden tail when editing inside its stored range and reveals new overflow', () => {
    const project = updateLogicalSheetSettings(createDefaultProject(), {
      workRange: { preRollFrames: 24, postRollFrames: 48, showPreRoll: false, showPostRoll: false },
    })
    expect(ensurePostRollCoversFrame(project, 160)).toBe(project)
    const extended = ensurePostRollCoversFrame(project, 200)
    expect(extended.logicalSheet.workRange).toEqual({ preRollFrames: 24, postRollFrames: 56, showPreRoll: false, showPostRoll: true })
    expect(extended.logicalSheet.durationFrames).toBe(144)
  })
})

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

  it('moves only the events in a selected frame range while preserving their gaps', () => {
    const first = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const second = createOrSetEvent(first.project, 'A', 3, 'action')
    const destinationGap = createOrSetEvent(second.project, 'A', 6, 'action')
    const destinationCollision = createOrSetEvent(destinationGap.project, 'A', 5, 'action')

    const moved = moveTimingEventsInRange(
      destinationCollision.project,
      testRange('A', 1, 3, 'action'),
      testHit('A', 1, 'action'),
      testHit('A', 5, 'action'),
      ['A', 'B', 'C'],
    )

    expect(moved.status).toBe('moved')
    expect(moved.collisionCount).toBe(1)
    expect(moved.project.logicalSheet.events
      .filter(event => event.paperTrack === 'A' && sheetTimingRoleForEvent(event) === 'action')
      .map(event => event.frame)
      .sort((a, b) => a - b)).toEqual([5, 6, 7])
  })

  it('plans from the grabbed cell without changing the project and commits the same sparse destination', () => {
    let project = createOrSetEvent(createDefaultProject(), 'A', 1, 'cell').project
    project = setTimingReferenceAt(project, 'A', 2, 'cell', true)
    project = setTimingSpecialEvent(project, 'B', 3, 'reverse', 'cell')
    project = createOrSetEvent(project, 'B', 11, 'cell').project
    project = setTimingReferenceAt(project, 'B', 11, 'cell', true) // Same cell counts only once.
    project = createOrSetEvent(project, 'B', 12, 'cell').project
    project = createOrSetEvent(project, 'C', 11, 'cell').project // Source gap: preserve it.
    project = createOrSetEvent(project, 'C', 13, 'action').project // Another role: no collision.
    const before = structuredClone(project)
    const range = testMultiTrackRange(['A', 'B'], 1, 3, 'cell')
    const grab = testHit('B', 3, 'cell')
    const target = testHit('C', 13, 'cell')
    const source = prepareTimingRangeMove(project, range, grab, ['A', 'B', 'C'])!
    const plan = planTimingRangeMove(source, target)
    expect(plan).toMatchObject({ status: 'moved', destinationPaperTracks: ['B', 'C'], destinationFrameStart: 11,
      destinationFrameEnd: 13, frameDelta: 10, trackDelta: 1, collisionCells: [{ paperTrack: 'B', frame: 11 }, { paperTrack: 'B', frame: 12 }] })
    expect(source.items.map(item => item.kind)).toEqual(['key', 'empty', 'reverse'])
    expect(project).toEqual(before)
    const result = moveTimingEventsInRange(project, range, grab, target, ['A', 'B', 'C'])
    expect(result).toMatchObject({ status: plan.status, collisionCount: plan.collisionCells.length,
      destinationPaperTracks: plan.destinationPaperTracks, destinationFrameStart: plan.destinationFrameStart, destinationFrameEnd: plan.destinationFrameEnd })
    expect(result.project.logicalSheet.events.filter(event => event.sheetRole === 'cell').map(event => `${event.paperTrack}:${event.frame}`).sort()).toEqual(['B:11', 'C:11', 'C:13'])
    expect(result.project.logicalSheet.referenceMarks).toContainEqual(expect.objectContaining({ paperTrack: 'B', frame: 12, sheetRole: 'cell' }))
  })

  it('excludes overlapping source cells from collision feedback and retains invalid destination offsets', () => {
    let project = createOrSetEvent(createDefaultProject(), 'A', 1, 'cell').project
    project = setTimingReferenceAt(project, 'A', 3, 'cell', true)
    const range = testMultiTrackRange(['A', 'B'], 1, 3, 'cell')
    const grab = testHit('B', 3, 'cell')
    const source = prepareTimingRangeMove(project, range, grab, ['A', 'B', 'C'])!
    expect(planTimingRangeMove(source, testHit('B', 5, 'cell'))).toMatchObject({ status: 'moved', collisionCells: [] })
    expect(planTimingRangeMove(source, testHit('A', 5, 'cell'))).toMatchObject({ status: 'invalid-target', reason: 'outside-tracks',
      destinationPaperTracks: ['', 'A'], destinationFrameStart: 3, destinationFrameEnd: 5 })
    expect(planTimingRangeMove(source, testHit('B', 1, 'cell'))).toMatchObject({ status: 'invalid-target', reason: 'outside-frames',
      destinationFrameStart: -1, destinationFrameEnd: 1 })
    expect(planTimingRangeMove(source, testHit('B', 5, 'action'))).toMatchObject({ status: 'invalid-target', reason: 'different-role' })
    expect(planTimingRangeMove(source, null)).toMatchObject({ status: 'invalid-target', reason: 'outside-sheet' })
    expect(planTimingRangeMove(source, grab)).toMatchObject({ status: 'same-target', collisionCells: [] })
    expect(moveTimingEventsInRange(project, range, grab, testHit('B', 1, 'cell'), ['A', 'B', 'C']).project).toBe(project)
  })

  it('moves an overlapping selected range atomically without losing events', () => {
    const first = createOrSetEvent(createDefaultProject(), 'A', 1, 'cell')
    const second = createOrSetEvent(first.project, 'A', 3, 'cell')
    const sourceKeyIds = second.project.logicalSheet.events
      .filter(event => event.paperTrack === 'A' && sheetTimingRoleForEvent(event) === 'cell')
      .sort((a, b) => a.frame - b.frame)
      .map(event => event.keyId)

    const moved = moveTimingEventsInRange(
      second.project,
      testRange('A', 1, 3, 'cell'),
      testHit('A', 1, 'cell'),
      testHit('A', 3, 'cell'),
      ['A', 'B', 'C'],
    )
    const events = moved.project.logicalSheet.events
      .filter(event => event.paperTrack === 'A' && sheetTimingRoleForEvent(event) === 'cell')
      .sort((a, b) => a.frame - b.frame)

    expect(moved.status).toBe('moved')
    expect(moved.collisionCount).toBe(0)
    expect(events.map(event => event.frame)).toEqual([3, 5])
    expect(events.map(event => event.keyId)).toEqual(sourceKeyIds)
  })

  it('moves a multi-track range together and rejects a partially out-of-bounds destination', () => {
    const a = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const b = createOrSetEvent(a.project, 'B', 2, 'action')
    const range = testMultiTrackRange(['A', 'B'], 1, 2, 'action')
    const moved = moveTimingEventsInRange(
      b.project,
      range,
      testHit('A', 1, 'action'),
      testHit('B', 5, 'action'),
      ['A', 'B', 'C'],
    )

    expect(moved.status).toBe('moved')
    expect(moved.destinationPaperTracks).toEqual(['B', 'C'])
    expect(moved.project.logicalSheet.events
      .filter(event => sheetTimingRoleForEvent(event) === 'action')
      .map(event => `${event.paperTrack}:${event.frame}`)
      .sort()).toEqual(['B:5', 'C:6'])

    const invalid = moveTimingEventsInRange(
      b.project,
      range,
      testHit('A', 1, 'action'),
      testHit('C', 5, 'action'),
      ['A', 'B', 'C'],
    )
    expect(invalid.status).toBe('invalid-target')
    expect(invalid.project).toBe(b.project)
  })

  it('repeats asset-drop-only registered cells even when their display label is blank', () => {
    const registered = registerAsset(createDefaultProject(), { name: 'A3.png', size: 100, lastModified: 1 }, { role: 'cell-material' })
    const bound = bindAssetToHit(registered.project, registered.asset, testHit('A', 1, 'cell'), 'layer_sakuga')
    const clipboard = buildTimingClipboard(bound.project, testRange('A', 1, 1, 'cell'), 'copy')

    const pasted = pasteTimingClipboardToProject(bound.project, clipboard, {
      role: 'cell',
      paperTrack: 'A',
      frameStart: 5,
      frameEnd: 7,
    }, 'repeat-range')

    const events = pasted.logicalSheet.events
      .filter(event => event.paperTrack === 'A' && sheetTimingRoleForEvent(event) === 'cell')
      .sort((a, b) => a.frame - b.frame)

    expect(events.map(event => event.frame)).toEqual([1, 5, 6, 7])
    expect(new Set(events.map(event => event.keyId))).toEqual(new Set([bound.keyId]))
    expect(pasted.bindings).toEqual([expect.objectContaining({
      keyId: bound.keyId,
      slotId: 'slot_A',
      cspCellName: 'A3',
      assetId: registered.asset.assetId,
      materialState: 'assigned',
    })])
  })

  it('clones asset-drop-only registered cell bindings when pasting to another paper track', () => {
    const registered = registerAsset(createDefaultProject(), { name: 'A3.png', size: 100, lastModified: 1 }, { role: 'cell-material' })
    const bound = bindAssetToHit(registered.project, registered.asset, testHit('A', 1, 'cell'), 'layer_sakuga')
    const clipboard = buildTimingClipboard(bound.project, testRange('A', 1, 1, 'cell'), 'copy')

    const pasted = pasteTimingClipboardToProject(bound.project, clipboard, {
      role: 'cell',
      paperTrack: 'B',
      frameStart: 5,
      frameEnd: 5,
    }, 'overwrite')

    const event = pasted.logicalSheet.events.find(item => item.paperTrack === 'B' && item.frame === 5 && sheetTimingRoleForEvent(item) === 'cell')
    const key = pasted.logicalSheet.keys.find(item => item.keyId === event?.keyId)
    const binding = pasted.bindings.find(item => item.keyId === event?.keyId && item.slotId === 'slot_B')

    expect(key).toMatchObject({ paperTrack: 'B', displayLabel: '1' })
    expect(binding).toMatchObject({
      cspCellName: 'A3',
      assetId: registered.asset.assetId,
      materialState: 'assigned',
    })
    expect(validateProject(pasted).filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('clones registered cell bindings for labeled timing keys when pasting to another paper track', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'cell')
    const registered = registerAsset(created.project, { name: 'A1.png', size: 100, lastModified: 1 }, { role: 'cell-material' })
    const bound = upsertBinding(registered.project, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      cspCellName: 'A1_custom',
      assetId: registered.asset.assetId,
      materialState: 'assigned',
    })
    const clipboard = buildTimingClipboard(bound, testRange('A', 1, 1, 'cell'), 'copy')

    const pasted = pasteTimingClipboardToProject(bound, clipboard, {
      role: 'cell',
      paperTrack: 'B',
      frameStart: 5,
      frameEnd: 5,
    }, 'overwrite')

    const event = pasted.logicalSheet.events.find(item => item.paperTrack === 'B' && item.frame === 5 && sheetTimingRoleForEvent(item) === 'cell')
    const key = pasted.logicalSheet.keys.find(item => item.keyId === event?.keyId)
    const binding = pasted.bindings.find(item => item.keyId === event?.keyId && item.slotId === 'slot_B')

    expect(key).toMatchObject({ paperTrack: 'B', displayLabel: '1' })
    expect(binding).toMatchObject({
      cspCellName: 'A1_custom',
      assetId: registered.asset.assetId,
      materialState: 'assigned',
    })
    expect(validateProject(pasted).filter(issue => issue.severity === 'error')).toEqual([])
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
