import { describe, expect, it } from 'vitest'
import { createDefaultProject, createStackGuideLabel, standardA3SheetTemplate } from '@xsheet-remap/core'
import { stackGuidePlacements, stackGuideSvgGeometry } from './stack-guides-geometry'

const testRect = { x: 0.1, y: 0.3, w: 0.8, h: 0.6 }
const testColumns = Array.from({ length: 10 }, (_, index) => ({
  paperTrack: String.fromCharCode(65 + index),
  x: testRect.x + (testRect.w * index) / 10,
  w: testRect.w / 10,
}))

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
      testRect,
      standardA3SheetTemplate.page,
      testColumns,
    )
    const laneByLabel = new Map(placements.map(placement => [placement.label.label, placement.lane]))

    expect(laneByLabel.get('BG')).toBe(0)
    expect(laneByLabel.get('BOOK')).toBe(1)
  })

  it('uses the rendered horizontal ranges to separate long labels at adjacent insertion points', () => {
    const first = createStackGuideLabel(createDefaultProject(), {
      label: 'BOOK_BACKGROUND_REFERENCE_LAYER_01',
      displayRole: 'action',
      insertAfterPaperTrack: 'A',
      gapIndex: 1,
      viewSnapIndex: 2,
    })
    const second = createStackGuideLabel(first.project, {
      label: 'BG_LIGHTING_REFERENCE_LAYER_02',
      displayRole: 'action',
      insertAfterPaperTrack: 'B',
      gapIndex: 2,
      viewSnapIndex: 3,
    })

    const placements = stackGuidePlacements(
      standardA3SheetTemplate,
      second.project,
      second.project.stackGuideLabels,
      testRect,
      standardA3SheetTemplate.page,
      testColumns,
    )
    const laneByLabel = new Map(placements.map(placement => [placement.label.label, placement.lane]))

    expect(laneByLabel.get('BOOK_BACKGROUND_REFERENCE_LAYER_01')).not.toBe(laneByLabel.get('BG_LIGHTING_REFERENCE_LAYER_02'))
  })

  it('keeps a long label inside the page without truncating it when physical width remains', () => {
    const created = createStackGuideLabel(createDefaultProject(), {
      label: 'BOOK_BACKGROUND_REFERENCE_LAYER_01',
      displayRole: 'action',
      gapIndex: 1,
      viewSnapIndex: 2,
    })
    const geometry = stackGuideSvgGeometry(
      standardA3SheetTemplate,
      testRect,
      standardA3SheetTemplate.page,
      created.label,
      0,
      testColumns,
    )

    expect(geometry.displayText).toBe('BOOK_BACKGROUND_REFERENCE_LAYER_01')
    expect(geometry.truncated).toBe(false)
    expect(geometry.labelX).toBeGreaterThanOrEqual(0)
    expect(geometry.labelX + geometry.labelWidth).toBeLessThanOrEqual(1)
  })
})
