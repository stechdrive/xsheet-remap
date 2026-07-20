import { describe, expect, it } from 'vitest'
import { digitalStandardSheetTemplate, standardA3SheetTemplate } from '@xsheet-remap/core'
import {
  resizeTemplateTimelineLanes,
  setTemplateGridColumnLabelsVisible,
  setTemplateTimelineLaneLabel,
  templateGridColumnLabelsVisible,
  templateTimelineLaneDefinitions,
  trackProjectionForRole,
} from './templateEditing'

describe('template timeline lane editing', () => {
  it('treats repeated A3 SOUND regions as one shared logical lane list', () => {
    expect(templateTimelineLaneDefinitions(standardA3SheetTemplate, 'sound').map(lane => lane.label)).toEqual(['S1', 'S2', 'S3', 'S4'])

    const renamed = setTemplateTimelineLaneLabel(standardA3SheetTemplate, 'sound', 'sound_lane_1', '台詞')
    const soundRegions = renamed.regions.filter(region => region.grid?.role === 'sound')
    expect(soundRegions).toHaveLength(2)
    expect(soundRegions.map(region => region.grid?.columns[0]?.label)).toEqual(['台詞', '台詞'])

    const resized = resizeTemplateTimelineLanes(renamed, 'sound', 5)
    expect(resized.regions.filter(region => region.grid?.role === 'sound').map(region => region.grid?.columns.length)).toEqual([5, 5])
    expect(templateTimelineLaneDefinitions(resized, 'sound').map(lane => lane.label)).toEqual(['台詞', 'S2', 'S3', 'S4', 'S5'])
  })

  it('controls column-name visibility without clearing logical lane names', () => {
    expect(templateGridColumnLabelsVisible(digitalStandardSheetTemplate, 'sound')).toBe(false)
    expect(templateTimelineLaneDefinitions(digitalStandardSheetTemplate, 'sound').map(lane => lane.label)).toEqual(['S1', 'S2', 'S3', 'S4'])

    const visible = setTemplateGridColumnLabelsVisible(digitalStandardSheetTemplate, 'sound', true)
    expect(templateGridColumnLabelsVisible(visible, 'sound')).toBe(true)
    expect(templateTimelineLaneDefinitions(visible, 'sound').map(lane => lane.label)).toEqual(['S1', 'S2', 'S3', 'S4'])
  })

  it('projects newly added timed-range regions from logical SOUND and CAMERA lanes', () => {
    expect(trackProjectionForRole(standardA3SheetTemplate, 'sound')).toEqual({ source: 'logical-timeline-lanes', startIndex: 0, overflow: 'hidden' })
    expect(trackProjectionForRole(digitalStandardSheetTemplate, 'camera')).toEqual({ source: 'logical-timeline-lanes', startIndex: 0, overflow: 'scroll' })
  })
})
