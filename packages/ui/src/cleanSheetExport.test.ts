import { describe, expect, it } from 'vitest'
import {
  assignSheetSourceToPage,
  createDefaultProject,
  registerSheetSource,
  standardA3SheetTemplate,
  createTimedRangeCue,
} from '@xsheet-remap/core'
import { defaultSheetImageExportOptions, timedRangeCueExportLayerIds } from './cleanSheetExport'

describe('clean sheet export options', () => {
  it('combines the template image and app drawing for a clean sheet export', () => {
    expect(defaultSheetImageExportOptions(createDefaultProject(), standardA3SheetTemplate, 'png')).toEqual({
      format: 'png',
      includePaperSheet: false,
      includeTemplateImage: true,
      includeTemplateDrawing: true,
    })
  })

  it('uses the scanned paper and app drawing without adding the clean template image', () => {
    const registered = registerSheetSource(createDefaultProject(), { name: 'sheet.png', size: 100 })
    const project = assignSheetSourceToPage(registered.project, 'page_1', registered.source.sourceId)

    expect(defaultSheetImageExportOptions(project, standardA3SheetTemplate, 'psd')).toEqual({
      format: 'psd',
      includePaperSheet: true,
      includeTemplateImage: false,
      includeTemplateDrawing: true,
    })
  })

  it('adds dedicated deliverable layers for SOUND and CAMERA instructions', () => {
    const sound = createTimedRangeCue(createDefaultProject(), {
      role: 'sound', laneId: 'sound_lane_1', frameStart: 1, frameEnd: 12, label: 'アキラ', text: '走れ！',
    }).project
    const camera = createTimedRangeCue(sound, {
      role: 'camera', laneId: 'camera_lane_1', frameStart: 1, frameEnd: 12, label: 'PAN',
      camera: { shape: 'range', startLabel: 'A', endLabel: 'B' },
    }).project

    expect(timedRangeCueExportLayerIds(camera)).toEqual(['soundCues', 'cameraCues'])
  })
})
