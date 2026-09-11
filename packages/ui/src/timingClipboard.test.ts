import { describe, expect, it } from 'vitest'
import {
  addOverlayPaperTrack, createDefaultProject, createOrSetEvent, digitalStandardSheetTemplate,
  registerAsset, setEvent, setTimingSpecialEvent, sheetTimingRoleForEvent, standardA3SheetTemplate,
  updateKey, upsertBinding, validateProject, type CutProject, type SheetHit, type SheetTimingRole,
} from '@xsheet-remap/core'
import type { SheetRangeSelection, TimingPasteMode } from './appTypes'
import { paperTrackOrderForRole } from './app-sheet-geometry'
import { projectTimingHitForFrame } from './sheet-layers-hit-geometry'
import { setTimingValueAt } from './sheet-timing-input'
import { applyTimingEditSession } from './timingEditSession'
import { nextProjectTimingHit } from './sheetTimingNavigation'
import { bindAssetToHit } from './sheetAssets'
import { buildTimingClipboard, canPasteTimingClipboardMode, pasteResultRange, pasteTimingClipboardToProject, timingPasteTarget } from './timingEditing'

function hit(role: SheetTimingRole, paperTrack = 'A', frame = 1): SheetHit {
  return { role, paperTrack, frame, regionId: role, columnId: paperTrack, label: paperTrack, rowIndex: frame - 1, columnIndex: 0 }
}
function range(role: SheetTimingRole, tracks = ['A'], frameStart = 1, frameEnd = 7): SheetRangeSelection & { role: SheetTimingRole; paperTrack: string } {
  return { role, paperTrack: tracks[0], paperTracks: tracks, columnId: tracks[0], inputMode: 'point-event', frameStart, frameEnd,
    anchorFrame: frameStart, focusFrame: frameEnd, anchorHit: hit(role, tracks[0], frameStart), focusHit: hit(role, tracks.at(-1), frameEnd) }
}
function events(project: CutProject, role: SheetTimingRole, track = 'A') {
  return project.logicalSheet.events.filter(event => sheetTimingRoleForEvent(event) === role && event.paperTrack === track).sort((a, b) => a.frame - b.frame)
}
function boundDrawing(project: CutProject, role: SheetTimingRole, track: string, name: string) {
  const created = createOrSetEvent(project, track, 1, role)
  const registered = registerAsset(created.project, { name, size: 100, lastModified: 1 }, { role: 'cell-material' })
  return { key: created.key, asset: registered.asset, project: upsertBinding(registered.project, {
    slotId: `slot_${track}`, keyId: created.key.keyId, cspCellName: name, assetId: registered.asset.assetId, materialState: 'assigned',
  }) }
}

describe('timing clipboard across ACTION, CELL and additional columns', () => {
  it.each(['action', 'cell'] as const)('copies %s notation with independent drawing numbers, gaps and special marks', sourceRole => {
    const targetRole = sourceRole === 'action' ? 'cell' : 'action'
    const first = createOrSetEvent(createDefaultProject(), 'A', 1, sourceRole)
    let project = setEvent(first.project, 'A', 1, first.key.keyId, sourceRole, { fontSizePx: 24 })
    project = setTimingSpecialEvent(project, 'A', 3, 'blank', sourceRole)
    project = setTimingSpecialEvent(project, 'A', 5, 'inbetween', sourceRole)
    project = setTimingSpecialEvent(project, 'A', 7, 'reverse', sourceRole)
    project = createOrSetEvent(project, 'A', 2, targetRole).project
    const clipboard = buildTimingClipboard(project, range(sourceRole), 'copy')
    const target = { role: targetRole, paperTrack: 'A', frameStart: 1, frameEnd: 1 } as const
    expect(canPasteTimingClipboardMode(clipboard, hit(targetRole), null, 'overwrite')).toBe(true)
    const pasted = pasteTimingClipboardToProject(project, clipboard, target, 'overwrite')
    const copied = events(pasted, targetRole)
    expect(copied.map(event => event.frame)).toEqual([1, 3, 5, 7])
    expect(copied[0].fontSizePx).toBe(24)
    expect(copied.slice(1).map(event => event.keyId)).toEqual(events(project, sourceRole).slice(1).map(event => event.keyId))
    expect(copied[0].keyId).not.toBe(first.key.keyId)
    const edited = setTimingValueAt(pasted, hit(targetRole), '5', 24, 'layer_sakuga').project
    expect(edited.logicalSheet.keys.find(key => key.keyId === first.key.keyId)?.displayLabel).toBe('1')
    expect(edited.logicalSheet.keys.find(key => key.keyId === copied[0].keyId)?.displayLabel).toBe('5')
    expect(events(edited, sourceRole)).toEqual(events(project, sourceRole))
  })

  it.each<TimingPasteMode>(['overwrite', 'insert', 'repeat-range', 'repeat-to-end'])('supports cross-role %s without changing ACTION', mode => {
    const first = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const second = createOrSetEvent(first.project, 'A', 3, 'action')
    const destination = createOrSetEvent(second.project, 'A', 5, 'cell')
    const project = { ...destination.project, logicalSheet: { ...destination.project.logicalSheet, durationFrames: 12 } }
    const clipboard = buildTimingClipboard(project, range('action', ['A'], 1, 3), 'copy')
    const pasted = pasteTimingClipboardToProject(project, clipboard, { role: 'cell', paperTrack: 'A', frameStart: 5, frameEnd: mode === 'repeat-range' ? 10 : 5 }, mode)
    const expected = { overwrite: [5, 7], insert: [5, 7, 8], 'repeat-range': [5, 7, 8, 10], 'repeat-to-end': [5, 7, 8, 10, 11] }
    expect(events(pasted, 'cell').map(event => event.frame)).toEqual(expected[mode])
    expect(events(pasted, 'action')).toEqual(events(project, 'action'))
  })

  it.each(['cell', 'action'] as const)('preserves an existing %s image and registration on ordinary paste', destinationRole => {
    const source = boundDrawing(createDefaultProject(), 'action', 'A', 'key-animation.png')
    const track = destinationRole === 'action' ? 'B' : 'A'
    const destination = boundDrawing(source.project, destinationRole, track, 'finished-drawing.png')
    const clipboard = buildTimingClipboard(destination.project, range('action', ['A'], 1, 1), 'copy')
    const pasted = pasteTimingClipboardToProject(destination.project, clipboard, { role: destinationRole, paperTrack: track, frameStart: 5, frameEnd: 5 }, 'overwrite')
    expect(pasted.bindings).toEqual(destination.project.bindings)
    expect(events(pasted, destinationRole, track).at(-1)?.keyId).toBe(destination.key.keyId)
    const explicit = pasteTimingClipboardToProject(destination.project, clipboard, { role: destinationRole, paperTrack: track, frameStart: 5, frameEnd: 5 }, 'overwrite', 'with-bindings')
    expect(explicit.bindings.find(binding => binding.keyId === destination.key.keyId)).toMatchObject({ assetId: source.asset.assetId, cspCellName: 'finished-drawing.png' })
    expect(validateProject(explicit).filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('creates a unique CSP registration when explicitly copying an image into the other role', () => {
    const source = boundDrawing(createDefaultProject(), 'action', 'A', 'A1')
    const clipboard = buildTimingClipboard(source.project, range('action', ['A'], 1, 1), 'copy')
    const target = { role: 'cell', paperTrack: 'A', frameStart: 1, frameEnd: 1 } as const
    const ordinary = pasteTimingClipboardToProject(source.project, clipboard, target, 'overwrite')
    expect(ordinary.bindings).toEqual(source.project.bindings)
    const explicit = pasteTimingClipboardToProject(source.project, clipboard, target, 'overwrite', 'with-bindings')
    expect(explicit.bindings).toHaveLength(2)
    expect(new Set(explicit.bindings.map(binding => binding.cspCellName)).size).toBe(2)
    expect(explicit.bindings.every(binding => binding.assetId === source.asset.assetId)).toBe(true)
    expect(validateProject(explicit).filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('does not downgrade an assigned destination when the copied registration has no image', () => {
    const source = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const unassigned = upsertBinding(source.project, { slotId: 'slot_A', keyId: source.key.keyId, cspCellName: 'key', materialState: 'unassigned' })
    const destination = boundDrawing(unassigned, 'cell', 'A', 'video.png')
    const clipboard = buildTimingClipboard(destination.project, range('action', ['A'], 1, 1), 'copy')
    const pasted = pasteTimingClipboardToProject(destination.project, clipboard, { role: 'cell', paperTrack: 'A', frameStart: 5, frameEnd: 5 }, 'overwrite', 'with-bindings')
    expect(pasted.bindings).toEqual(destination.project.bindings)
  })

  it('supports notation-only paste within a role without transferring images', () => {
    const source = boundDrawing(createDefaultProject(), 'cell', 'A', 'A1')
    const clipboard = buildTimingClipboard(source.project, range('cell', ['A'], 1, 1), 'copy')
    const pasted = pasteTimingClipboardToProject(source.project, clipboard, { role: 'cell', paperTrack: 'B', frameStart: 1, frameEnd: 1 }, 'overwrite', 'notation')
    expect(events(pasted, 'cell', 'B')).toHaveLength(1)
    expect(pasted.bindings).toEqual(source.project.bindings)
  })

  it('keeps different unnumbered drawings distinct and repeated uses shared without their images', () => {
    const a = registerAsset(createDefaultProject(), { name: 'A1.png', size: 10, lastModified: 1 }, { role: 'cell-material' })
    const first = bindAssetToHit(a.project, a.asset, hit('action'), 'layer_sakuga')
    const b = registerAsset(first.project, { name: 'A2.png', size: 20, lastModified: 2 }, { role: 'cell-material' })
    const second = bindAssetToHit(b.project, b.asset, hit('action', 'A', 2), 'layer_sakuga')
    const project = setEvent(second.project, 'A', 3, first.keyId!, 'action')
    const clipboard = buildTimingClipboard(project, range('action', ['A'], 1, 3), 'copy')
    const pasted = pasteTimingClipboardToProject(project, clipboard, { role: 'cell', paperTrack: 'A', frameStart: 1, frameEnd: 6 }, 'repeat-range')
    const keys = events(pasted, 'cell').map(event => event.keyId)
    expect(new Set(keys).size).toBe(2)
    expect(keys).toEqual([keys[0], keys[1], keys[0], keys[0], keys[1], keys[0]])
    expect(pasted.bindings).toEqual(project.bindings)
    expect(pasted.logicalSheet.keys.filter(key => keys.includes(key.keyId)).map(key => key.displayLabel)).toEqual(['', ''])
  })

  it('pastes the copied label even if the source drawing is renamed afterwards', () => {
    const source = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const clipboard = buildTimingClipboard(source.project, range('action', ['A'], 1, 1), 'copy')
    const renamed = updateKey(source.project, source.key.keyId, { displayLabel: '9' })
    const pasted = pasteTimingClipboardToProject(renamed, clipboard, { role: 'action', paperTrack: 'A', frameStart: 5, frameEnd: 5 }, 'overwrite')
    const keyId = events(pasted, 'action').at(-1)?.keyId
    expect(pasted.logicalSheet.keys.find(key => key.keyId === keyId)?.displayLabel).toBe('1')
    expect(pasted.logicalSheet.keys.find(key => key.keyId === source.key.keyId)?.displayLabel).toBe('9')
  })

  it('rejects a repeat paste when the destination has insufficient columns', () => {
    const clipboard = buildTimingClipboard(createDefaultProject(), range('action', ['A', 'B']), 'copy')
    expect(canPasteTimingClipboardMode(clipboard, hit('cell', 'I'), range('cell', ['I']), 'repeat-range', ['A', 'I'])).toBe(false)
    expect(canPasteTimingClipboardMode(clipboard, hit('cell'), null, 'repeat-range', ['A', 'B'])).toBe(false)
  })

  it('uses the digital column order for either role despite paper-only placements', () => {
    const added = addOverlayPaperTrack(createDefaultProject(), { paperTrack: 'J', sheetRole: 'action', insertAfterPaperTrack: 'A', snapIndex: 15 })
    const project = { ...added.project, sheetTemplateId: digitalStandardSheetTemplate.templateId }
    const expected = project.logicalSheet.paperTracks.map(track => track.paperTrack)
    expect(paperTrackOrderForRole(project, 'action', digitalStandardSheetTemplate)).toEqual(expected)
    expect(paperTrackOrderForRole(project, 'cell', digitalStandardSheetTemplate)).toEqual(expected)
    const first = createOrSetEvent(project, 'A', 1, 'action')
    const second = createOrSetEvent(first.project, 'B', 1, 'action')
    const clipboard = buildTimingClipboard(second.project, range('action', ['A', 'B'], 1, 1), 'copy')
    const target = { role: 'cell', paperTrack: 'J', paperTrackOrder: expected, frameStart: 1, frameEnd: 1 } as const
    const pasted = pasteTimingClipboardToProject(second.project, clipboard, target, 'overwrite')
    expect(events(pasted, 'cell', 'J')).toHaveLength(1)
    expect(events(pasted, 'cell', expected[expected.indexOf('J') + 1])).toHaveLength(1)
    expect(pasteResultRange(digitalStandardSheetTemplate, pasted, target, clipboard, 'overwrite')?.paperTracks).toEqual(expected.slice(expected.indexOf('J'), expected.indexOf('J') + 2))
  })

  it('keeps a pasted paper overflow column selected and editable', () => {
    const added = addOverlayPaperTrack(createDefaultProject(), { paperTrack: 'J', sheetRole: 'action', snapIndex: 2 })
    const source = createOrSetEvent(added.project, 'A', 1, 'cell')
    const clipboard = buildTimingClipboard(source.project, range('cell', ['A'], 1, 3), 'copy')
    const targetHit = projectTimingHitForFrame(standardA3SheetTemplate, source.project, 'action', 'J', 5)!
    expect(targetHit.regionId).toMatch(/^overlay:/)
    const target = { ...timingPasteTarget(targetHit, null)!, paperTrackOrder: paperTrackOrderForRole(source.project, 'action', standardA3SheetTemplate) }
    const pasted = pasteTimingClipboardToProject(source.project, clipboard, target, 'overwrite')
    const pastedRange = pasteResultRange(standardA3SheetTemplate, pasted, target, clipboard, 'overwrite')!
    expect(pastedRange).toMatchObject({ role: 'action', paperTracks: ['J'], frameStart: 5, frameEnd: 7 })
    const edited = applyTimingEditSession(pasted, standardA3SheetTemplate, { target: { kind: 'range', range: pastedRange }, value: '5', originalValue: '', cutId: 'cut_1', revisionId: 'revision_1', fontSizePx: 16, correctionLayerId: 'layer_sakuga' })
    expect(edited.logicalSheet.keys.find(key => key.keyId === events(edited, 'action', 'J')[0].keyId)?.displayLabel).toBe('5')
    expect(events(edited, 'cell')).toEqual(events(source.project, 'cell'))
    expect(nextProjectTimingHit(standardA3SheetTemplate, edited, pastedRange.anchorHit, 0, 1)).toMatchObject({ role: 'action', paperTrack: 'J', frame: 6 })
  })
})
