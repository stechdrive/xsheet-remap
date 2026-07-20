import { describe, expect, it } from 'vitest'
import {
  buildExportPlan,
  createDefaultProject,
  createStackGuideLabel,
  createUnplacedCspCard,
  validateCspMaterialAssignments,
  validateProject,
} from './index'

describe('purpose-specific export validation', () => {
  it('keeps image readiness out of project and XDTS validation', () => {
    const created = createUnplacedCspCard(createDefaultProject(), {
      slotId: 'slot_A',
      cspCellName: 'A1',
      sheetRole: 'action',
    })

    expect(validateProject(created.project).map(issue => issue.code)).not.toContain('cspImport.asset.unassigned')
    expect(buildExportPlan(created.project).validation.map(issue => issue.code)).not.toContain('cspImport.asset.unassigned')
  })

  it('reports the exact CSP cell that will be registered without material', () => {
    const created = createUnplacedCspCard(createDefaultProject(), {
      slotId: 'slot_A',
      cspCellName: 'A1',
      sheetRole: 'action',
    })

    expect(validateCspMaterialAssignments(created.project)).toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'cspImport.asset.unassigned',
      target: expect.objectContaining({ label: '作画 / A / A1' }),
    }))
  })

  it('uses the same CSP material validation for BG and BOOK registrations', () => {
    const created = createStackGuideLabel(createDefaultProject(), {
      label: 'BOOK_背景',
      kind: 'book',
      gapIndex: 1,
      correctionLayerId: 'layer_sakuga',
    })

    expect(validateCspMaterialAssignments(created.project)).toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'cspImport.asset.unassigned',
      target: expect.objectContaining({ label: '作画 / BOOK_背景 / BOOK_背景' }),
    }))
  })
})
