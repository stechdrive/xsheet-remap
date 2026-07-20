import { describe, expect, it } from 'vitest'
import {
  buildExportPlan,
  createDefaultProject,
  createUnplacedCspCard,
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

  it('treats a CSP cell without material as an ordinary key-only export', () => {
    const created = createUnplacedCspCard(createDefaultProject(), {
      slotId: 'slot_A',
      cspCellName: 'A1',
      sheetRole: 'action',
    })

    expect(buildExportPlan(created.project).validation).not.toContainEqual(expect.objectContaining({
      code: 'cspImport.asset.unassigned',
    }))
  })
})
