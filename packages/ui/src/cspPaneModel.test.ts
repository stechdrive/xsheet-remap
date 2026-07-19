import { addOverlayPaperTrack, createDefaultProject, createOrSetEvent, createStackGuideLabel, upsertBinding } from '@xsheet-remap/core'
import { describe, expect, it } from 'vitest'
import { cspPaneNodeCapabilities, cspPaneSelectionCurrentLabel, cspPaneSelectionExists, type CspPaneSelection } from './cspPaneModel'

describe('cspPaneModel', () => {
  it('exposes one capability contract for template, overlay, and auxiliary tracks', () => {
    const overlay = addOverlayPaperTrack(createDefaultProject(), { paperTrack: 'J', label: 'J' })
    const guide = createStackGuideLabel(overlay.project, {
      label: 'BOOK1',
      kind: 'background',
      gapIndex: 2,
      correctionLayerId: 'layer_sakuga',
    })
    const templateSelection: CspPaneSelection = {
      kind: 'template-track', nodeId: 'paper:A', label: 'A', itemId: 'paper:A', paperTrack: 'A', correctionLayerId: 'layer_sakuga',
    }
    const overlaySelection: CspPaneSelection = {
      kind: 'overlay-track', nodeId: 'paper:J', label: 'J', itemId: 'paper:J', paperTrack: 'J', correctionLayerId: 'layer_sakuga',
    }
    const guideSelection: CspPaneSelection = {
      kind: 'stack-guide', nodeId: `stack-guide:${guide.label.labelId}`, label: 'BOOK1', itemId: `stack-guide:${guide.label.labelId}`, labelId: guide.label.labelId, band: 'cell-interleave', correctionLayerId: 'layer_sakuga',
    }

    expect(cspPaneNodeCapabilities(guide.project, templateSelection)).toMatchObject({ draggable: true, deletable: false })
    expect(cspPaneNodeCapabilities(guide.project, overlaySelection)).toMatchObject({ draggable: true, deletable: true })
    expect(cspPaneNodeCapabilities(guide.project, guideSelection)).toMatchObject({ draggable: true, deletable: true })
    expect(cspPaneNodeCapabilities(guide.project, overlaySelection).reorderScope).toBe(cspPaneNodeCapabilities(guide.project, guideSelection).reorderScope)
    expect(cspPaneSelectionExists(guide.project, overlaySelection)).toBe(true)
    expect(cspPaneSelectionExists(guide.project, guideSelection)).toBe(true)
    expect(cspPaneSelectionCurrentLabel(guide.project, guideSelection)).toBe('BOOK1')
  })

  it('disables correction-layer deletion when that layer owns registered cards', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'cell')
    const project = upsertBinding(created.project, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      cspCellName: 'A1',
      materialState: 'unassigned',
    })
    const selection: CspPaneSelection = {
      kind: 'correction-layer', nodeId: 'layer:layer_sakuga', label: '作画', stageId: 'stage_lo', layerId: 'layer_sakuga',
    }
    expect(cspPaneNodeCapabilities(project, selection)).toMatchObject({
      draggable: true,
      deletable: false,
      disabledReason: '登録セルがある工程は削除できません。',
    })
  })
})
