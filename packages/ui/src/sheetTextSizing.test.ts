import { describe, expect, it } from 'vitest'
import { activeCutProjectFromDocument, createDefaultProject, createKey, createProjectDocumentFromCutProject, createTimedRangeCue,
  parseProjectDocument, setEvent, setTimingSpecialEvent, standardA3SheetTemplate, timingHitForFrame,
  type CutProject, type SheetHit } from '@xsheet-remap/core'
import type { SheetRangeSelection, SheetSelection } from './appTypes'
import { applySheetTextSize, selectedSheetTextTargets, sheetTextSizeValues } from './sheetTextSizing'
import { buildTimingClipboard, pasteTimingClipboardToProject } from './timingEditing'
import { buildTimedRangeCueClipboard, pasteTimedRangeCueClipboard } from './timedRangeCueEditing'

const template = standardA3SheetTemplate
function add(project: CutProject, track: string, frame: number, label = '1', role: 'action' | 'cell' = 'cell', size = 18) {
  const created = createKey(project, track, label, 'manual', label, role)
  return setEvent(created.project, track, frame, created.key.keyId, role, { fontSizePx: size })
}
function textRange(tracks = ['A', 'B'], start = 1, end = 6): SheetRangeSelection & { role: 'cell'; paperTrack: string } {
  const hit = (track: string, frame: number): SheetHit => ({ ...timingHitForFrame(template, 'cell', track, frame)!, pageId: 'page_1' })
  return { role: 'cell', inputMode: 'point-event', paperTrack: tracks[0], paperTracks: tracks, columnId: tracks[0],
    frameStart: start, frameEnd: end, anchorFrame: start, focusFrame: end,
    anchorHit: hit(tracks[0], start), focusHit: hit(tracks.at(-1)!, end) }
}
function resize(project: CutProject, selection: SheetSelection, value: number) {
  return applySheetTextSize(project, template, selectedSheetTextTargets(project, selection), { kind: 'set', value })
}

describe('sheet text sizing', () => {
  it('changes occurrences in multiple columns, preserving keys, symbols, holds and other roles/processes', () => {
    let project = add(add(add(add(createDefaultProject(), 'A', 1), 'A', 10), 'B', 4, 'B', 'cell', 32), 'A', 2, 'action', 'action')
    project = setTimingSpecialEvent(project, 'B', 5, 'blank', 'cell')
    const inactive = { events: project.logicalSheet.events.slice(0, 1), referenceMarks: [] }
    project = { ...project, logicalSheet: { ...project.logicalSheet, processTimings: { activeProcessId: 'base', inactive: { other: inactive } } } }
    const selection: SheetSelection = { kind: 'range', range: textRange() }
    const targets = selectedSheetTextTargets(project, selection)
    expect(targets.events.map(event => [event.paperTrack, event.frame])).toEqual([['A', 1], ['B', 4]])
    expect(sheetTextSizeValues(template, targets, 18).value).toBeNull()
    const next = resize(project, selection, 24)
    expect(next.logicalSheet.events.filter(event => event.fontSizeMode === 'fixed').map(event => event.fontSizePx)).toEqual([24, 24])
    expect(next.logicalSheet.events).toHaveLength(project.logicalSheet.events.length)
    expect(next.logicalSheet.keys).toBe(project.logicalSheet.keys)
    expect(next.logicalSheet.processTimings?.inactive.other).toBe(inactive)
    for (const event of project.logicalSheet.events.filter(event => !targets.events.includes(event))) {
      expect(next.logicalSheet.events.find(item => item.eventId === event.eventId)).toBe(event)
    }
    expect(resize(next, selection, 24)).toBe(next)
    expect(selectedSheetTextTargets(project, { kind: 'range', range: textRange(['C'], 1, 6) }).nextOnly).toBe(false)
  })

  it('steps each size independently and resets to template defaults', () => {
    const project = add(add(createDefaultProject(), 'A', 1), 'B', 4, '2', 'cell', 32)
    const selection: SheetSelection = { kind: 'range', range: textRange() }
    const targets = selectedSheetTextTargets(project, selection)
    const next = applySheetTextSize(project, template, targets, { kind: 'step', direction: 1 })
    expect(next.logicalSheet.events.map(event => event.fontSizePx)).toEqual([20, 36])
    const reset = applySheetTextSize(next, template, selectedSheetTextTargets(next, selection), { kind: 'reset' })
    expect(reset.logicalSheet.events.every(event => event.fontSizePx === undefined && event.fontSizeMode === undefined)).toBe(true)
    expect(sheetTextSizeValues(template, selectedSheetTextTargets(reset, selection), 32).value).toBe(18)
  })

  it('retains per-occurrence sizes across document save/load and cross-role clipboard paste', () => {
    const source = resize(add(createDefaultProject(), 'A', 1), { kind: 'range', range: textRange(['A']) }, 32)
    const clip = buildTimingClipboard(source, textRange(['A'], 1, 1), 'copy')
    const pasted = pasteTimingClipboardToProject(source, clip, { role: 'action', paperTrack: 'B', frameStart: 12, frameEnd: 12 }, 'overwrite')
    const document = parseProjectDocument(JSON.parse(JSON.stringify(createProjectDocumentFromCutProject(pasted, { sheetTemplate: template }))))
    expect(activeCutProjectFromDocument(document).logicalSheet.events.slice().sort((a, b) => a.frame - b.frame).map(event => [event.frame, event.fontSizePx, event.fontSizeMode]))
      .toEqual([[1, 32, 'fixed'], [12, 32, 'fixed']])
  })

  it.each(['sound', 'camera'] as const)('sizes %s parts independently without changing timing, camera or audio data', role => {
    const source = createTimedRangeCue(createDefaultProject(), { role, laneId: `${role}_lane_1`, frameStart: 3, frameEnd: 10,
      label: 'A', text: '本文', camera: role === 'camera' ? { shape: 'range', startLabel: 'A', endLabel: 'B' } : undefined }).project
    const cue = source.timedRangeCues[0], selection: SheetSelection = { kind: 'cue', cueId: cue.cueId }
    const primary = resize(source, selection, 32)
    const parts = applySheetTextSize(primary, template, selectedSheetTextTargets(primary, selection), { kind: 'set', part: 'secondary', value: 14 })
    expect(parts.timedRangeCues[0]).toMatchObject({ ...cue, fontSizePx: 32, secondaryFontSizePx: 14, fontSizeMode: 'fixed' })
    const combined = applySheetTextSize(parts, template, selectedSheetTextTargets(parts, selection), { kind: 'set', value: 64 })
    expect(combined.timedRangeCues[0]).toMatchObject({ fontSizePx: 64, secondaryFontSizePx: 28, frameStart: 3, frameEnd: 10 })
    expect(combined.logicalSheet).toBe(source.logicalSheet)
    const clip = buildTimedRangeCueClipboard(parts, role, { laneId: cue.laneId, frameStart: 3, frameEnd: 10, mode: 'copy', cueId: cue.cueId })!
    const pasted = pasteTimedRangeCueClipboard(parts, clip, { laneId: cue.laneId, frameStart: 30 }, 'overwrite').project
    const document = parseProjectDocument(JSON.parse(JSON.stringify(createProjectDocumentFromCutProject(pasted, { sheetTemplate: template }))))
    const restored = activeCutProjectFromDocument(document)
    expect(restored.timedRangeCues).toHaveLength(2)
    expect(restored.timedRangeCues[1]).toMatchObject({ fontSizePx: 32, secondaryFontSizePx: 14, fontSizeMode: 'fixed', frameStart: 30, frameEnd: 37 })
    const reset = applySheetTextSize(parts, template, selectedSheetTextTargets(parts, selection), { kind: 'reset' })
    expect(reset.timedRangeCues[0]).toEqual(cue)
  })
})
