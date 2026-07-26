import { describe, expect, it } from 'vitest'
import { createDefaultProject } from '@xsheet-remap/core'
import { eventKeyIdAtSheetHit, timingKeyAtSheetHit, timingKeyDisplayLabel } from './workspaceSelectionModel'

describe('workspace selection model', () => {
  it('resolves the selected timing key and its display label from one policy boundary', () => {
    const project = createDefaultProject()
    const paperTrack = project.logicalSheet.paperTracks[0]?.paperTrack ?? 'A'
    const key = { keyId: 'key-1', paperTrack, sheetRole: 'cell' as const, displayLabel: '1', createdFrom: 'manual' as const }
    const event = { eventId: 'event-1', paperTrack, sheetRole: 'cell' as const, frame: 1, keyId: key.keyId, valueKind: 'cell' as const }
    project.logicalSheet.keys = [key]
    project.logicalSheet.events = [event]
    const hit = {
      regionId: 'cell-grid',
      role: 'cell' as const,
      paperTrack: event.paperTrack,
      frame: event.frame,
      rowIndex: 0,
      columnIndex: 0,
      columnId: event.paperTrack,
      label: event.paperTrack,
    }

    expect(eventKeyIdAtSheetHit(project, hit)).toBe(key.keyId)
    expect(timingKeyAtSheetHit(project, hit)?.keyId).toBe(key.keyId)
    expect(timingKeyDisplayLabel(project, key.keyId)).toBe(key.displayLabel)
  })
})
