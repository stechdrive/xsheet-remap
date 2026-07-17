import { createDefaultProject, standardA3SheetTemplate, type SheetHit } from '@xsheet-remap/core'
import { describe, expect, it } from 'vitest'
import { timedRangeCueForMemoContext, timelineMemoIdsFromElement } from './timelineMemoEditing'

describe('timeline memo interaction targets', () => {
  it('resolves a memo body or every memo represented by an anchor marker', () => {
    const body = document.createElement('div')
    body.dataset.timelineMemoId = 'memo_body'
    const bodyChild = document.createElement('span')
    body.append(bodyChild)
    expect(timelineMemoIdsFromElement(bodyChild)).toEqual(['memo_body'])

    const anchor = document.createElement('div')
    anchor.dataset.timelineMemoIds = 'memo_1 memo_2'
    anchor.dataset.timelineMemoId = 'memo_1'
    const anchorChild = document.createElement('span')
    anchor.append(anchorChild)
    expect(timelineMemoIdsFromElement(anchorChild)).toEqual(['memo_1', 'memo_2'])
  })

  it('recovers the timed-range cue hidden below a memo target from logical sheet coordinates', () => {
    const project = createDefaultProject()
    project.timedRangeCues = [{
      cueId: 'camera_1',
      role: 'camera',
      laneId: 'camera_lane_1',
      frameStart: 4,
      frameEnd: 12,
      label: 'PAN',
      text: '',
      source: 'manual',
      camera: { shape: 'range', startLabel: '', endLabel: '' },
    }]
    const region = standardA3SheetTemplate.regions.find(item => item.grid?.role === 'camera')!
    const columnIndex = region.grid!.columns.findIndex(column => column.timelineLaneId === 'camera_lane_1')
    const hit: SheetHit = {
      regionId: region.regionId,
      role: 'camera',
      frame: 8,
      rowIndex: 7,
      columnIndex,
      columnId: region.grid!.columns[columnIndex]!.columnId,
      label: region.grid!.columns[columnIndex]!.label,
    }

    expect(timedRangeCueForMemoContext(project, standardA3SheetTemplate, hit, ['memo_1'])?.cueId).toBe('camera_1')
    expect(timedRangeCueForMemoContext(project, standardA3SheetTemplate, hit, undefined)).toBeUndefined()
  })
})
