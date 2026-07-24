import { describe, expect, it } from 'vitest'
import { createDefaultProject, standardA3SheetTemplate, type SheetHit } from '@xsheet-remap/core'
import type { TimingEditSession } from './appTypes'
import { applyTimingEditSession } from './timingEditSession'

describe('timing edit session', () => {
  it('applies the value with the correction layer and text size captured when editing began', () => {
    const sourceProject = createDefaultProject()
    const hit: SheetHit = {
      regionId: 'cell_grid',
      role: 'cell',
      frame: sourceProject.logicalSheet.frameOrigin,
      rowIndex: 0,
      columnIndex: 0,
      columnId: 'A',
      label: 'A',
      paperTrack: 'A',
    }
    const session: TimingEditSession = {
      target: { kind: 'cell', hit },
      value: '12',
      originalValue: '',
      cutId: 'cut_1',
      revisionId: 'revision_1',
      correctionLayerId: 'layer_enshutsu',
      fontSizePx: 17,
    }

    const result = applyTimingEditSession(sourceProject, standardA3SheetTemplate, session)
    const event = result.logicalSheet.events.find(candidate => candidate.frame === hit.frame && candidate.paperTrack === hit.paperTrack)
    const binding = result.bindings.find(candidate => candidate.keyId === event?.keyId)
    const slot = result.cspTrackSlots.find(candidate => candidate.slotId === binding?.slotId)

    expect(event?.fontSizePx).toBe(17)
    expect(slot?.correctionLayerId).toBe('layer_enshutsu')
  })
})
