import { describe, expect, it } from 'vitest'
import { addOverlayPaperTrack, addOverlayPaperTrackAtCspTop, applyCellStackOrder, buildCspLayerTree, cellStackOrderItems, createDefaultProject, createProjectFromTrackLabels, createProjectHistory, createStackGuideLabel, createStackGuideLabelAtCspCellBottom, moveCellStackOrderItem, reorderCorrectionLayer, reorderCspStackItem, reorderProductionStage } from './index'

describe('cell stack order', () => {
  it('adds a pane cell column above every existing cell column for a custom template', () => {
    const custom = createProjectFromTrackLabels(['KEY', 'FX', 'MATTE'])
    const existing = addOverlayPaperTrack(custom, {
      paperTrack: 'EXISTING_CELL',
      insertAfterPaperTrack: 'MATTE',
      snapIndex: 14,
      sheetRole: 'cell',
    })
    const background = createStackGuideLabel(existing.project, {
      label: 'BG_EXISTING',
      kind: 'background',
      gapIndex: 0,
      viewSnapIndex: 3,
    })

    const created = addOverlayPaperTrackAtCspTop(background.project, { paperTrack: 'NEW_CELL' })
    const cspPaperOrder = cellStackOrderItems(created.project)
      .filter(item => item.kind !== 'stack-guide')
      .map(item => item.id)
      .reverse()

    expect(cspPaperOrder[0]).toBe('paper:NEW_CELL')
    expect(created.paperTrack.viewPlacement).toMatchObject({ sheetRole: 'cell', snapIndex: 15 })
    expect(created.project.logicalSheet.paperTracks.find(track => track.paperTrack === 'EXISTING_CELL')?.viewPlacement?.snapIndex).toBe(14)
    expect(created.project.stackGuideLabels.find(label => label.labelId === background.label.labelId)?.viewSnapIndex).toBe(3)
  })

  it('adds a pane BG/BOOK below every cell column and above existing BG/BOOK labels', () => {
    const overlay = addOverlayPaperTrack(createProjectFromTrackLabels(['X', 'Y']), {
      paperTrack: 'LOW_CELL',
      snapIndex: 0,
      sheetRole: 'cell',
    })
    const existing = createStackGuideLabelAtCspCellBottom(overlay.project, {
      label: 'BOOK_EXISTING',
      kind: 'book',
    })

    const created = createStackGuideLabelAtCspCellBottom(existing.project, {
      label: 'BG_NEW',
      kind: 'background',
      correctionLayerId: 'layer_sakuga',
    })
    const cspOrder = cellStackOrderItems(created.project).map(item => item.id).reverse()
    const newId = `stack:${created.label.labelId}`
    const existingId = `stack:${existing.label.labelId}`
    const paperIndices = cspOrder
      .map((id, index) => id.startsWith('paper:') ? index : -1)
      .filter(index => index >= 0)

    expect(Math.max(...paperIndices)).toBeLessThan(cspOrder.indexOf(newId))
    expect(cspOrder.indexOf(newId)).toBeLessThan(cspOrder.indexOf(existingId))
    expect(created.label).toMatchObject({ insertAfterPaperTrack: undefined, gapIndex: 0, viewSnapIndex: 0 })
  })

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
    expect(moved?.stackGuideLabels[0]?.viewSnapIndex).toBe(3)
    expect(moveCellStackOrderItem(created.project, 'paper:A', 'down', true)).toBeNull()
  })

  it('moves a label to the absolute left edge without changing untouched view positions', () => {
    const book = createStackGuideLabel(createDefaultProject(), {
      label: 'BOOK',
      displayRole: 'action',
      insertAfterPaperTrack: 'A',
      gapIndex: 1,
      viewSnapIndex: 9,
    })
    const bg = createStackGuideLabel(book.project, {
      label: 'BG',
      displayRole: 'action',
      insertAfterPaperTrack: 'B',
      gapIndex: 2,
      viewSnapIndex: 12,
    })

    const moved = moveCellStackOrderItem(bg.project, `stack:${book.label.labelId}`, 'down', true)

    expect(moved?.stackGuideLabels.find(label => label.labelId === book.label.labelId)).toMatchObject({
      insertAfterPaperTrack: undefined,
      viewSnapIndex: 0,
    })
    expect(moved?.stackGuideLabels.find(label => label.labelId === bg.label.labelId)?.viewSnapIndex).toBe(12)
  })

  it('synchronizes only the moved overlay column view position', () => {
    const first = addOverlayPaperTrack(createDefaultProject(), {
      paperTrack: 'BOOK',
      insertAfterPaperTrack: 'A',
      snapIndex: 8,
      sheetRole: 'action',
    })
    const second = addOverlayPaperTrack(first.project, {
      paperTrack: 'BG',
      insertAfterPaperTrack: 'B',
      snapIndex: 11,
      sheetRole: 'action',
    })

    const moved = moveCellStackOrderItem(second.project, 'paper:BOOK', 'down', true)

    expect(moved?.logicalSheet.paperTracks.find(track => track.paperTrack === 'BOOK')).toMatchObject({
      exportPlacement: { insertAfterPaperTrack: undefined },
      viewPlacement: { snapIndex: 0 },
    })
    expect(moved?.logicalSheet.paperTracks.find(track => track.paperTrack === 'BG')?.viewPlacement?.snapIndex).toBe(11)
  })

  it('never removes or relocates the other labels during repeated arrow moves', () => {
    const book = createStackGuideLabel(createDefaultProject(), {
      label: 'BOOK_LONG_REFERENCE',
      displayRole: 'action',
      insertAfterPaperTrack: 'A',
      gapIndex: 1,
      viewSnapIndex: 8,
    })
    const bg = createStackGuideLabel(book.project, {
      label: 'BG_LONG_REFERENCE',
      displayRole: 'action',
      insertAfterPaperTrack: 'C',
      gapIndex: 3,
      viewSnapIndex: 13,
    })
    const cell = createStackGuideLabel(bg.project, {
      label: 'CELL_LONG_REFERENCE',
      displayRole: 'cell',
      insertAfterPaperTrack: 'E',
      gapIndex: 5,
      viewSnapIndex: 17,
    })
    const overlay = addOverlayPaperTrack(cell.project, {
      paperTrack: 'FX_REFERENCE',
      insertAfterPaperTrack: 'B',
      snapIndex: 15,
      sheetRole: 'cell',
    })
    const movedId = `stack:${book.label.labelId}`
    const expectedLabelIds = overlay.project.stackGuideLabels.map(label => label.labelId).sort()
    const untouched = new Map([
      [bg.label.labelId, { insertAfterPaperTrack: 'C', viewSnapIndex: 13, displayRole: 'action' }],
      [cell.label.labelId, { insertAfterPaperTrack: 'E', viewSnapIndex: 17, displayRole: 'cell' }],
    ])
    let project = overlay.project

    for (const direction of [...Array(20).fill('up'), ...Array(20).fill('down')] as Array<'up' | 'down'>) {
      project = moveCellStackOrderItem(project, movedId, direction, true) ?? project

      expect(project.stackGuideLabels.map(label => label.labelId).sort()).toEqual(expectedLabelIds)
      for (const [labelId, placement] of untouched) {
        expect(project.stackGuideLabels.find(label => label.labelId === labelId)).toMatchObject(placement)
      }
      expect(project.logicalSheet.paperTracks.find(track => track.paperTrack === 'FX_REFERENCE')).toMatchObject({
        exportPlacement: { insertAfterPaperTrack: 'B' },
        viewPlacement: { snapIndex: 15 },
      })
    }
  })

  it('drops any cell stack item before or after another item in CSP top-to-bottom order', () => {
    const created = createStackGuideLabel(createDefaultProject(), {
      label: 'BOOK_DRAG',
      insertAfterPaperTrack: 'A',
      gapIndex: 1,
      viewSnapIndex: 2,
    })
    const itemId = `stack:${created.label.labelId}`
    const moved = reorderCspStackItem(created.project, itemId, 'paper:E', 'before', true)
    if (!moved) throw new Error('reorder failed')

    const cspOrder = cellStackOrderItems(moved).map(item => item.id).reverse()
    expect(cspOrder.indexOf(itemId)).toBe(cspOrder.indexOf('paper:E') - 1)
    expect(moved.stackGuideLabels.find(label => label.labelId === created.label.labelId)?.viewSnapIndex).toBe(6)
    expect(reorderCspStackItem(moved, itemId, 'paper:E', 'before', true)).toBeNull()
  })

  it('keeps CSP tree order aligned when dragging one BG/BOOK guide across a template track', () => {
    const background = createStackGuideLabel(createDefaultProject(), {
      label: 'BG1',
      kind: 'background',
      gapIndex: 1,
      correctionLayerId: 'layer_sakuga',
    })
    const dragged = createStackGuideLabel(background.project, {
      label: 'BG_DRAG',
      kind: 'background',
      gapIndex: 0,
      correctionLayerId: 'layer_sakuga',
    })
    const trackLabels = (project: typeof dragged.project) => buildCspLayerTree(project).stages
      .flatMap(stage => stage.layers)
      .find(layer => layer.layerId === 'layer_sakuga')
      ?.tracks.map(track => track.label) ?? []
    expect(trackLabels(dragged.project).indexOf('BG_DRAG')).toBeGreaterThan(trackLabels(dragged.project).indexOf('BG1'))

    const moved = reorderCspStackItem(
      dragged.project,
      `stack:${dragged.label.labelId}`,
      `stack:${background.label.labelId}`,
      'before',
      true,
    )
    if (!moved) throw new Error('BG/BOOK reorder failed')
    expect(trackLabels(moved).indexOf('BG_DRAG')).toBeLessThan(trackLabels(moved).indexOf('BG1'))
    expect(trackLabels(createProjectHistory(moved).present).indexOf('BG_DRAG')).toBeLessThan(trackLabels(createProjectHistory(moved).present).indexOf('BG1'))
  })

  it('reorders camera and memo labels inside their own bands and rejects cross-band drops', () => {
    const cameraA = createStackGuideLabel(createDefaultProject(), { label: 'CAM_A', kind: 'camera-note', gapIndex: 0 })
    const cameraB = createStackGuideLabel(cameraA.project, { label: 'CAM_B', kind: 'camera-note', gapIndex: 0 })
    const memo = createStackGuideLabel(cameraB.project, { label: 'MEMO_A', kind: 'memo', gapIndex: 0 })
    const cameraAId = `stack:${cameraA.label.labelId}`
    const cameraBId = `stack:${cameraB.label.labelId}`
    const memoId = `stack:${memo.label.labelId}`

    const moved = reorderCspStackItem(memo.project, cameraAId, cameraBId, 'before', true)
    if (!moved) throw new Error('camera reorder failed')
    const cameras = moved.stackGuideLabels
      .filter(label => label.kind === 'camera-note')
      .sort((a, b) => b.orderInGap - a.orderInGap)
    expect(cameras.map(label => label.labelId)).toEqual([cameraA.label.labelId, cameraB.label.labelId])
    expect(reorderCspStackItem(moved, cameraAId, memoId, 'before', true)).toBeNull()
  })

  it('reorders production stages and correction layers by stable ids', () => {
    const base = createDefaultProject()
    const project = {
      ...base,
      productionStages: [
        { stageId: 'stage-a', label: 'A', order: 0 },
        { stageId: 'stage-b', label: 'B', order: 1 },
      ],
      correctionLayers: base.correctionLayers.slice(0, 2).map((layer, index) => ({
        ...layer,
        stageId: 'stage-a',
        order: index,
      })),
    }
    const movedStage = reorderProductionStage(project, 'stage-a', 'stage-b', 'before')
    expect(movedStage?.productionStages.slice().sort((a, b) => b.order - a.order).map(stage => stage.stageId)).toEqual(['stage-a', 'stage-b'])

    const [firstLayer, secondLayer] = project.correctionLayers
    const movedLayer = reorderCorrectionLayer(project, firstLayer!.layerId, secondLayer!.layerId, 'before')
    expect(movedLayer?.correctionLayers.slice().sort((a, b) => b.order - a.order).map(layer => layer.layerId)).toEqual([firstLayer!.layerId, secondLayer!.layerId])
    expect(reorderCorrectionLayer(project, firstLayer!.layerId, 'missing', 'before')).toBeNull()
  })
})
