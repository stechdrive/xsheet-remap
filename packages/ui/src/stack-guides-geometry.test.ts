import { describe, expect, it } from 'vitest'
import { createDefaultProject, createStackGuideLabel, standardA3SheetTemplate } from '@xsheet-remap/core'
import { stackGuidePlacements } from './stack-guides-geometry'

describe('stack guide geometry', () => {
  it('assigns overlapping display lanes from the canonical stack order', () => {
    const book = createStackGuideLabel(createDefaultProject(), {
      label: 'BOOK',
      displayRole: 'action',
      insertAfterPaperTrack: 'A',
      gapIndex: 1,
      viewSnapIndex: 2,
    })
    const bg = createStackGuideLabel(book.project, {
      label: 'BG',
      displayRole: 'action',
      insertAfterPaperTrack: 'A',
      gapIndex: 1,
      viewSnapIndex: 2,
    })
    const project = {
      ...bg.project,
      stackGuideLabels: bg.project.stackGuideLabels.map(label => ({
        ...label,
        orderInGap: label.labelId === book.label.labelId ? 1 : 0,
      })),
    }
    const placements = stackGuidePlacements(
      standardA3SheetTemplate,
      project,
      project.stackGuideLabels,
      24,
      [{ paperTrack: 'A' }, { paperTrack: 'B' }],
    )
    const laneByLabel = new Map(placements.map(placement => [placement.label.label, placement.lane]))

    expect(laneByLabel.get('BG')).toBe(0)
    expect(laneByLabel.get('BOOK')).toBe(1)
  })
})
