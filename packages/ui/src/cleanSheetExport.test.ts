import { describe, expect, it } from 'vitest'
import {
  assignSheetSourceToPage,
  createDefaultProject,
  registerSheetSource,
  standardA3SheetTemplate,
  createTimedRangeCue,
  updateLogicalSheetSettings,
  updateSheetPageViewState,
} from '@xsheet-remap/core'
import {
  defaultSheetImageExportOptions,
  psdOpacityByte,
  sheetExportLayerDescriptors,
  timedRangeCueExportLayerIds,
} from './cleanSheetExport'

describe('clean sheet export options', () => {
  it('uses the structured A3 drawing without the reference-only tracing image', () => {
    expect(defaultSheetImageExportOptions(createDefaultProject(), standardA3SheetTemplate, 'png')).toEqual({
      format: 'png',
      includePaperSheet: false,
      includeTemplateImage: false,
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
    expect(sheetExportLayerDescriptors(camera, standardA3SheetTemplate, {
      format: 'psd',
      includePaperSheet: false,
      includeTemplateImage: true,
      includeTemplateDrawing: true,
    }).map(({ id, name }) => [id, name])).toEqual([
      ['white', '白地'],
      ['templateLines', 'テンプレ罫線'],
      ['templateLabels', 'テンプレラベル'],
      ['metadataText', 'シート情報'],
      ['timingInput', 'ACTION/CELL入力'],
      ['soundCues', 'SOUND指示'],
      ['cameraCues', 'CAMERA指示'],
      ['annotationBackground', 'メモ・背景'],
      ['annotationInk', 'メモ・手描き'],
      ['annotationText', 'メモ・テキスト'],
    ])
  })

  it('exports out-of-duration shading independently and follows the dummy-frame display setting', () => {
    const shortened = updateLogicalSheetSettings(createDefaultProject(), { durationFrames: 72 })
    const shortenedLayers = sheetExportLayerDescriptors(shortened, standardA3SheetTemplate, {
      format: 'psd',
      includePaperSheet: false,
      includeTemplateImage: false,
      includeTemplateDrawing: false,
    })
    expect(shortenedLayers.map(({ id, name }) => [id, name])).toContainEqual(['workRangeShade', '尺外グレー'])
    expect(shortenedLayers.some(layer => layer.id === 'templateLines')).toBe(false)

    const dummyFrames = updateLogicalSheetSettings(createDefaultProject(), {
      workRange: { ...createDefaultProject().logicalSheet.workRange, showPreRoll: true },
    })
    const pngLayers = sheetExportLayerDescriptors(dummyFrames, standardA3SheetTemplate, {
      format: 'png',
      includePaperSheet: false,
      includeTemplateImage: false,
      includeTemplateDrawing: true,
    })
    expect(pngLayers.map(layer => layer.id)).toContain('workRangeShade')
    expect(sheetExportLayerDescriptors(createDefaultProject(), standardA3SheetTemplate, {
      format: 'png',
      includePaperSheet: false,
      includeTemplateImage: false,
      includeTemplateDrawing: true,
    }).map(layer => layer.id)).not.toContain('workRangeShade')
  })

  it('stores paper opacity as editable PSD layer metadata instead of baking it into pixels', () => {
    const registered = registerSheetSource(createDefaultProject(), { name: 'sheet.png', size: 100 })
    const assigned = assignSheetSourceToPage(registered.project, 'page_1', registered.source.sourceId)
    const project = updateSheetPageViewState(assigned, 'page_1', { alignment: { opacity: 0.42 } })
    const paperLayer = sheetExportLayerDescriptors(project, standardA3SheetTemplate, {
      format: 'psd',
      includePaperSheet: true,
      includeTemplateImage: false,
      includeTemplateDrawing: true,
    }).find(layer => layer.id === 'paperSheet')

    expect(paperLayer).toMatchObject({
      name: '紙シート画像',
      opacityByPage: { page_1: 107 },
    })
    expect(psdOpacityByte(1)).toBe(255)
    expect(psdOpacityByte(0)).toBe(0)
    expect(psdOpacityByte(Number.NaN)).toBe(255)
  })
})
