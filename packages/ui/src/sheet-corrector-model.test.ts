import { describe, expect, it } from 'vitest'
import type { SheetCorrectionDraft } from './sheet-corrector-types'
import { discardDraftsForTemplate } from './sheet-corrector-model'

describe('sheet corrector template draft isolation', () => {
  it('discards only drafts for an externally reloaded template revision', () => {
    const points: SheetCorrectionDraft['points'] = []
    const drafts: Record<string, SheetCorrectionDraft> = {
      'sheet-a.png': { templateId: 'custom-paper', points, applied: true },
      'sheet-b.png': { templateId: 'a3-standard', points, applied: false },
    }

    expect(discardDraftsForTemplate(drafts, 'custom-paper')).toEqual({
      'sheet-b.png': drafts['sheet-b.png'],
    })
    expect(drafts).toHaveProperty('sheet-a.png')
  })
})
