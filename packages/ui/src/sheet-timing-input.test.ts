import { describe, expect, it } from 'vitest'
import {
  buildExportPlan,
  createDefaultProject,
  createKey,
  defaultCorrectionLayerId,
  INBETWEEN_KEY_ID,
  NULL_CELL_CSP_CELL_NAME,
  NULL_CELL_KEY_ID,
  setEvent,
  setTimingSpecialEvent,
  sheetTimingRoleForEvent,
  standardA3SheetTemplate,
  type CutProject,
  type SheetHit,
  type SheetTimingRole,
} from '@xsheet-remap/core'
import { exportXdts } from '@xsheet-remap/xdts'
import { setTimingValueAt } from './sheet-timing-input'
import { continuationRenderItemsForPage, createSheetRenderModelContext } from './sheetRenderModel'

describe('sheet timing keyboard input', () => {
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
      { frame: 4, value: 'A7' },
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
