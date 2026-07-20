import { describe, expect, it } from 'vitest'
import {
  createAlphabeticTrackLabels,
  digitalStandardSheetTemplate,
  resolveSheetTemplateGridLayout,
  resolveSheetTemplatePageSize,
  resolveSheetTemplateRegionRect,
  standardA3SheetTemplate,
} from './index'

describe('dynamic sheet template layout', () => {
  it('stacks digital standard cut metadata above a full-width memo area', () => {
    const pageSize = resolveSheetTemplatePageSize(digitalStandardSheetTemplate)
    const rectForRegion = (regionId: string) => {
      const region = digitalStandardSheetTemplate.regions.find(item => item.regionId === regionId)
      if (!region) throw new Error(`region not found: ${regionId}`)
      const rect = resolveSheetTemplateRegionRect(digitalStandardSheetTemplate, region)
      return {
        x: Math.round(rect.x * pageSize.widthPx),
        y: Math.round(rect.y * pageSize.heightPx),
        w: Math.round(rect.w * pageSize.widthPx),
        h: Math.round(rect.h * pageSize.heightPx),
      }
    }
    const cutMetadata = rectForRegion('digital_metadata_form')
    const memo = rectForRegion('digital_memo_area')
    const action = rectForRegion('digital_action_grid')
    const camera = rectForRegion('digital_camera_grid')
    const actionGrid = digitalStandardSheetTemplate.regions.find(item => item.regionId === 'digital_action_grid')?.grid
    const soundGrid = digitalStandardSheetTemplate.regions.find(item => item.regionId === 'digital_sound_grid')?.grid

    expect(cutMetadata).toEqual({ x: 32, y: 24, w: 1856, h: 90 })
    expect(memo).toEqual({ x: 32, y: 160, w: 1856, h: 300 })
    expect(digitalStandardSheetTemplate.regions.some(region => region.regionId.includes('reserve'))).toBe(false)
    expect(action).toMatchObject({ x: 32, y: 620, h: 2880 })
    expect(camera.x + camera.w).toBe(1840)
    expect(action.y).toBeGreaterThan(memo.y + memo.h)
    expect(actionGrid?.rowCount).toBe(144)
    expect(action.h / (actionGrid?.rowCount ?? 1)).toBe(20)
    expect(actionGrid?.rowLineRules).toEqual([
      { every: 24, weight: 'strong' },
      { every: 12, weight: 'medium' },
      { every: 6, weight: 'regular' },
    ])
    expect(soundGrid?.rowLineRules).toBeUndefined()
    expect(soundGrid?.rowLabelRules).toBeUndefined()
    expect(digitalStandardSheetTemplate.style?.secondCounter).toEqual({ visible: true })
    expect(digitalStandardSheetTemplate.style?.bottomTrackLabels).toBeUndefined()
  })

  it('flows every digital timing section horizontally as logical columns grow', () => {
    const paperTracks = createAlphabeticTrackLabels(12)
    const timelineLanes = {
      sound: Array.from({ length: 6 }, (_, index) => ({ laneId: `sound_lane_${index + 1}`, label: `S${index + 1}`, order: index })),
      camera: Array.from({ length: 7 }, (_, index) => ({ laneId: `camera_lane_${index + 1}`, label: String(index + 1), order: index })),
    }
    const pageSize = resolveSheetTemplatePageSize(digitalStandardSheetTemplate, 144, { paperTracks, timelineLanes })
    const layouts = ['digital_action_grid', 'digital_sound_grid', 'digital_cell_grid', 'digital_camera_grid'].map(regionId => {
      const region = digitalStandardSheetTemplate.regions.find(candidate => candidate.regionId === regionId)
      if (!region) throw new Error(`region not found: ${regionId}`)
      return resolveSheetTemplateGridLayout(digitalStandardSheetTemplate, region, { paperTracks, timelineLanes })!
    })

    expect(pageSize.widthPx).toBeGreaterThan(digitalStandardSheetTemplate.page.widthPx)
    expect(layouts.map(layout => layout.columns.length)).toEqual([12, 6, 12, 7])
    expect(layouts.map(layout => Math.round(layout.rect.w * pageSize.widthPx))).toEqual([560, 330, 1067, 602])
    for (let index = 1; index < layouts.length; index += 1) {
      const previous = layouts[index - 1]!
      const current = layouts[index]!
      expect(Math.round((current.rect.x - previous.rect.x - previous.rect.w) * pageSize.widthPx)).toBe(8)
    }
    for (const regionId of ['digital_metadata_form', 'digital_memo_area']) {
      const region = digitalStandardSheetTemplate.regions.find(candidate => candidate.regionId === regionId)!
      const rect = resolveSheetTemplateRegionRect(digitalStandardSheetTemplate, region, 144, { paperTracks, timelineLanes })
      expect(Math.round(rect.x * pageSize.widthPx)).toBe(32)
      expect(Math.round(rect.w * pageSize.widthPx)).toBe(pageSize.widthPx - 64)
    }
  })

  it('clips logical SOUND and CAMERA lanes to fixed paper capacity without deleting them', () => {
    const timelineLanes = {
      sound: Array.from({ length: 6 }, (_, index) => ({ laneId: `sound_lane_${index + 1}`, label: `S${index + 1}`, order: index })),
      camera: Array.from({ length: 8 }, (_, index) => ({ laneId: `camera_lane_${index + 1}`, label: String(index + 1), order: index })),
    }
    const soundRegion = standardA3SheetTemplate.regions.find(region => region.regionId === 'left_sound_grid')!
    const cameraRegion = standardA3SheetTemplate.regions.find(region => region.regionId === 'left_camera_grid')!
    const sound = resolveSheetTemplateGridLayout(standardA3SheetTemplate, soundRegion, { timelineLanes })!
    const camera = resolveSheetTemplateGridLayout(standardA3SheetTemplate, cameraRegion, { timelineLanes })!

    expect(sound.columns.map(column => column.timelineLaneId)).toEqual(timelineLanes.sound.slice(0, 4).map(lane => lane.laneId))
    expect(camera.columns.map(column => column.timelineLaneId)).toEqual(timelineLanes.camera.slice(0, 6).map(lane => lane.laneId))
    expect(sound.pageSize.widthPx).toBe(standardA3SheetTemplate.page.widthPx)
    expect(camera.pageSize.widthPx).toBe(standardA3SheetTemplate.page.widthPx)
  })
})
