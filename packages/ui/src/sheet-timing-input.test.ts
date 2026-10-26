import { describe, expect, it } from 'vitest'
import {
  buildExportPlan,
  createDefaultProject,
  createKey,
  defaultCorrectionLayerId,
  INBETWEEN_KEY_ID,
  NULL_CELL_CSP_CELL_NAME,
  NULL_CELL_KEY_ID,
  registerAsset,
  setEvent,
  setTimingSpecialEvent,
  sheetTimingRoleForEvent,
  standardA3SheetTemplate,
  upsertBinding,
  type CutProject,
  type SheetHit,
  type SheetTimingRole,
} from '@xsheet-remap/core'
import { exportXdts } from '@xsheet-remap/xdts'
import { setTimingValueAt } from './sheet-timing-input'
import { continuationRenderItemsForPage, createSheetRenderModelContext } from './sheetRenderModel'

describe('sheet timing keyboard input', () => {
  it.each<SheetTimingRole>(['action', 'cell'])('replaces only the selected %s event with a new or existing number', role => {
    let project = createDefaultProject()
    const layer = correctionLayer(project)
    for (const track of ['A', 'B']) {
      for (const [frame, value] of [[1, '1'], [5, '2'], [9, '1'], [13, '3'], [17, '1']] as const) {
        project = setTimingValueAt(project, timingHit(role, track, frame), value, 12, layer).project
      }
    }
    const original = timingEvents(project, role, 'A')
    const replacement = setTimingValueAt(project, timingHit(role, 'A', 9), '4', 16, layer)
    const editedEvents = timingEvents(replacement.project, role, 'A')
    expect(editedEvents.map(event => replacement.project.logicalSheet.keys.find(key => key.keyId === event.keyId)?.displayLabel))
      .toEqual(['1', '2', '4', '3', '1'])
    expect(editedEvents.filter(event => event.frame !== 9)).toEqual(original.filter(event => event.frame !== 9))
    expect(editedEvents.find(event => event.frame === 9)).toMatchObject({ keyId: replacement.keyId, fontSizePx: 16 })
    expect(timingEvents(replacement.project, role, 'B')).toEqual(timingEvents(project, role, 'B'))
    expect(replacement.project.logicalSheet.keys).toEqual(expect.arrayContaining(project.logicalSheet.keys))
    expect(replacement.project.bindings).toEqual(expect.arrayContaining(project.bindings))

    const existing = setTimingValueAt(replacement.project, timingHit(role, 'A', 9), '2', 12, layer)
    expect(timingEvents(existing.project, role, 'A').map(event => existing.project.logicalSheet.keys.find(key => key.keyId === event.keyId)?.displayLabel))
      .toEqual(['1', '2', '2', '3', '1'])
    expect(existing.project.logicalSheet.keys).toEqual(replacement.project.logicalSheet.keys)
    expect(existing.project.bindings).toEqual(replacement.project.bindings)
  })

  it.each(['1', '001', '12A'])('uses the entered text %s as the new cell name in separate columns', value => {
    let project = createDefaultProject()
    for (const track of ['A', 'B']) {
      const result = setTimingValueAt(project, timingHit('cell', track, 1), value, 12, correctionLayer(project))
      expect(result.project.bindings.find(binding => binding.keyId === result.keyId)?.cspCellName).toBe(value)
      project = result.project
    }
  })

  it('keeps independent ACTION and CELL registrations unique within the same destination', () => {
    const project = createDefaultProject()
    const action = setTimingValueAt(project, timingHit('action', 'A', 1), '1', 12, correctionLayer(project))
    const cell = setTimingValueAt(action.project, timingHit('cell', 'A', 1), '1', 12, correctionLayer(project))
    expect(cell.keyId).not.toBe(action.keyId)
    expect(cell.project.bindings.map(binding => binding.cspCellName).sort()).toEqual(['1', '1_2'])
  })

  it('preserves the original image and registration when another frame selects a different cell', () => {
    const project = createDefaultProject()
    const first = setTimingValueAt(project, timingHit('cell', 'A', 1), '1', 12, correctionLayer(project))
    const image = registerAsset(first.project, { name: 'scan_0042.png', size: 1, lastModified: 1 }, { role: 'cell-material' })
    const originalBinding = first.project.bindings.find(binding => binding.keyId === first.keyId)!
    const bound = upsertBinding(image.project, { ...originalBinding, cspCellName: 'scan_0042', assetId: image.asset.assetId, materialState: 'assigned' })
    const repeated = setTimingValueAt(bound, timingHit('cell', 'A', 5), '1', 12, correctionLayer(project)).project
    const same = setTimingValueAt(repeated, timingHit('cell', 'A', 1), '1', 12, correctionLayer(project)).project
    expect(same.bindings).toEqual(bound.bindings)
    const replaced = setTimingValueAt(same, timingHit('cell', 'A', 5), '4', 12, correctionLayer(project))
    expect(replaced.project.bindings.find(binding => binding.keyId === first.keyId)).toEqual(bound.bindings[0])
    expect(replaced.project.bindings.find(binding => binding.keyId === replaced.keyId)).toMatchObject({ cspCellName: '4', materialState: 'unassigned' })
    expect(replaced.project.bindings.find(binding => binding.keyId === replaced.keyId)?.assetId).toBeUndefined()
    expect(replaced.project.assets).toEqual(bound.assets)
    expect(replaced.project.logicalSheet.keys.find(key => key.keyId === first.keyId)?.displayLabel).toBe('1')
  })

  it.each<SheetTimingRole>(['action', 'cell'])(
    'inserts an explicit leading blank before the first later %s key',
    role => {
      const project = createDefaultProject()
      const result = setTimingValueAt(project, timingHit(role, 'A', 5), '7', 12, correctionLayer(project))
      const events = timingEvents(result.project, role, 'A')

      expect(events.map(event => event.frame)).toEqual([project.logicalSheet.frameOrigin, 5])
      expect(events[0]?.keyId).toBe(NULL_CELL_KEY_ID)
      expect(events[1]?.keyId).toBe(result.keyId)
    },
  )

  it('does not add a leading blank when the first key is entered at the first frame', () => {
    const project = createDefaultProject()
    const result = setTimingValueAt(project, timingHit('cell', 'A', project.logicalSheet.frameOrigin), '1', 12, correctionLayer(project))

    expect(timingEvents(result.project, 'cell', 'A')).toHaveLength(1)
    expect(timingEvents(result.project, 'cell', 'A')[0]?.keyId).toBe(result.keyId)
  })

  it('does not add or overwrite the first frame when an event already exists at or before the target', () => {
    const project = setTimingSpecialEvent(createDefaultProject(), 'A', 3, 'inbetween', 'action')
    const result = setTimingValueAt(project, timingHit('action', 'A', 5), '2', 12, correctionLayer(project))

    expect(timingEvents(result.project, 'action', 'A').map(event => ({ frame: event.frame, keyId: event.keyId }))).toEqual([
      { frame: 3, keyId: INBETWEEN_KEY_ID },
      { frame: 5, keyId: result.keyId },
    ])
  })

  it('does not backfill a leading blank while editing an existing later key', () => {
    const project = createDefaultProject()
    const created = createKey(project, 'A', '1', 'manual', '1', 'cell')
    const legacyProject = setEvent(created.project, 'A', 5, created.key.keyId, 'cell')
    const result = setTimingValueAt(legacyProject, timingHit('cell', 'A', 5), '2', 12, correctionLayer(project))

    expect(timingEvents(result.project, 'cell', 'A')).toHaveLength(1)
    expect(timingEvents(result.project, 'cell', 'A')[0]?.frame).toBe(5)
  })

  it('exports the automatic leading blank as XDTS frame zero', () => {
    const project = createDefaultProject()
    const result = setTimingValueAt(project, timingHit('action', 'A', 5), '7', 12, correctionLayer(project))
    const directProject = withDirectExportProfile(result.project)
    const payload = JSON.parse(exportXdts(buildExportPlan(directProject, {
      profileId: 'direct',
      timingSourceRole: 'action',
    })).split('\n').slice(1).join('\n')) as {
      timeTables: Array<{ fields: Array<{ fieldId: number; tracks: Array<{ frames: Array<{ frame: number; data: Array<{ values: string[] }> }> }> }> }>
    }
    const frames = payload.timeTables[0]?.fields.find(field => field.fieldId === 0)?.tracks[0]?.frames

    expect(frames?.map(frame => ({ frame: frame.frame, value: frame.data[0]?.values[0] }))).toEqual([
      { frame: 0, value: NULL_CELL_CSP_CELL_NAME },
      { frame: 4, value: '7' },
    ])
  })

  it('renders an automatic leading blank with a wave on only its next three frames', () => {
    const project = createDefaultProject()
    const automatic = setTimingValueAt(project, timingHit('action', 'A', 10), '7', 12, correctionLayer(project)).project
    const automaticBlank = timingEvents(automatic, 'action', 'A').find(event => event.keyId === NULL_CELL_KEY_ID)
    const automaticContext = createSheetRenderModelContext(automatic, standardA3SheetTemplate)
    const automaticWave = continuationRenderItemsForPage(automaticContext, automaticContext.pages[0])
      .find(item => item.eventId === automaticBlank?.eventId)

    const referenceBlank = setTimingSpecialEvent(createDefaultProject(), 'A', 1, 'blank', 'action')
    const reference = setTimingValueAt(referenceBlank, timingHit('action', 'A', 5), '7', 12, correctionLayer(referenceBlank)).project
    const referenceEvent = timingEvents(reference, 'action', 'A').find(event => event.keyId === NULL_CELL_KEY_ID)
    const referenceContext = createSheetRenderModelContext(reference, standardA3SheetTemplate)
    const referenceWave = continuationRenderItemsForPage(referenceContext, referenceContext.pages[0])
      .find(item => item.eventId === referenceEvent?.eventId)

    expect(automaticWave).toMatchObject({ kind: 'wave' })
    expect(automaticWave?.path).toEqual(referenceWave?.path)
  })
})

function timingHit(role: SheetTimingRole, paperTrack: string, frame: number): SheetHit {
  return {
    regionId: `${role}_grid`,
    role,
    frame,
    rowIndex: frame - 1,
    columnIndex: 0,
    columnId: paperTrack,
    label: paperTrack,
    paperTrack,
  }
}

function correctionLayer(project: CutProject): string {
  const layerId = defaultCorrectionLayerId(project)
  if (!layerId) throw new Error('default correction layer not found')
  return layerId
}

function timingEvents(project: CutProject, role: SheetTimingRole, paperTrack: string) {
  return project.logicalSheet.events.filter(event =>
    event.paperTrack === paperTrack && sheetTimingRoleForEvent(event) === role,
  )
}

function withDirectExportProfile(project: CutProject): CutProject {
  return {
    ...project,
    exportProfiles: [{
      profileId: 'direct',
      name: 'Direct',
      mode: 'direct-to-visible-slots',
      slotIds: project.cspTrackSlots.map(slot => slot.slotId),
    }],
  }
}
