import { describe, expect, it } from 'vitest'
import { applyCellStackOrder, cellStackOrderItems, createDefaultProject, createStackGuideLabel, moveCellStackOrderItem } from './index'

describe('cell stack order', () => {
  it('clears a stack-guide view override when CSP ordering is synchronized to the sheet', () => {
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
    const itemId = `stack:${book.label.labelId}`
    const orderedIds = cellStackOrderItems(bg.project).map(item => item.id).filter(id => id !== itemId)
    orderedIds.splice(orderedIds.indexOf('paper:B') + 1, 0, itemId)

    const updated = applyCellStackOrder(bg.project, orderedIds, true)
    const moved = updated.stackGuideLabels.find(label => label.labelId === book.label.labelId)

    expect(moved).toMatchObject({ insertAfterPaperTrack: 'B', gapIndex: 2 })
    expect(moved?.viewSnapIndex).toBeUndefined()
    expect(updated.stackGuideLabels.find(label => label.labelId === bg.label.labelId)).toMatchObject({ insertAfterPaperTrack: 'A' })
  })

  it('preserves an explicit view override when only export ordering is requested', () => {
    const created = createStackGuideLabel(createDefaultProject(), {
      label: 'BOOK',
      displayRole: 'action',
      insertAfterPaperTrack: 'A',
      gapIndex: 1,
      viewSnapIndex: 7,
    })
    const orderedIds = cellStackOrderItems(created.project).map(item => item.id)
    const updated = applyCellStackOrder(created.project, orderedIds, false)

    expect(updated.stackGuideLabels[0]?.viewSnapIndex).toBe(7)
  })

  it('moves one item according to the CSP direction and rejects an edge move', () => {
    const created = createStackGuideLabel(createDefaultProject(), {
      label: 'BOOK',
      displayRole: 'action',
      insertAfterPaperTrack: 'A',
      gapIndex: 1,
      viewSnapIndex: 2,
    })
    const itemId = `stack:${created.label.labelId}`
    const moved = moveCellStackOrderItem(created.project, itemId, 'up', true)

    expect(moved?.stackGuideLabels[0]).toMatchObject({ insertAfterPaperTrack: 'B', gapIndex: 2 })
    expect(moveCellStackOrderItem(created.project, 'paper:A', 'down', true)).toBeNull()
  })
})
