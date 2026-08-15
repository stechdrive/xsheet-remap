import { describe, expect, it } from 'vitest'
import { createDefaultProject, projectSheetLayoutOptions } from './project-model'
import { digitalStandardSheetTemplate } from './sheet-template-presets'
import { hitTestSheetTemplate, resolveSheetTemplateGridLayout, resolveSheetTemplatePageSize } from './sheet-template-layout'

describe('project sheet layout context', () => {
  it('keeps project tracks and logical lanes authoritative after switching templates', () => {
    const project = createDefaultProject()
    const options = projectSheetLayoutOptions(project, digitalStandardSheetTemplate)
    const cameraRegion = digitalStandardSheetTemplate.regions.find(region => region.regionId === 'digital_camera_grid')!
    const cameraLayout = resolveSheetTemplateGridLayout(digitalStandardSheetTemplate, cameraRegion, options)!
    const lastColumn = cameraLayout.columns.at(-1)!
    const hit = hitTestSheetTemplate(digitalStandardSheetTemplate, {
      x: lastColumn.x + lastColumn.w / 2,
      y: cameraLayout.rect.y + cameraLayout.frames.rowHeight / 2,
    }, options)

    expect(options.paperTracks).toEqual(project.logicalSheet.paperTracks.map(track => track.paperTrack))
    expect(options.timelineLanes?.camera).toHaveLength(6)
    expect(cameraLayout.columns).toHaveLength(6)
    expect(hit).toMatchObject({
      role: 'camera',
      columnIndex: 5,
      timelineLaneId: 'camera_lane_6',
    })
    expect(resolveSheetTemplatePageSize(
      digitalStandardSheetTemplate,
      options.durationFrames,
      options,
    ).widthPx).toBeGreaterThan(resolveSheetTemplatePageSize(digitalStandardSheetTemplate).widthPx)
  })

  it('does not mistake a custom template column lane id for the resolved project lane', () => {
    const project = createDefaultProject()
    const customTemplate = structuredClone(digitalStandardSheetTemplate)
    customTemplate.templateId = 'custom-digital-layout'
    const cameraRegion = customTemplate.regions.find(region => region.regionId === 'digital_camera_grid')!
    cameraRegion.grid!.columns[0]!.columnId = 'custom_camera_column'
    cameraRegion.grid!.columns[0]!.timelineLaneId = 'custom_template_lane'
    const options = projectSheetLayoutOptions(project, customTemplate)
    const layout = resolveSheetTemplateGridLayout(customTemplate, cameraRegion, options)!
    const column = layout.columns[0]!
    const hit = hitTestSheetTemplate(customTemplate, {
      x: column.x + column.w / 2,
      y: layout.rect.y + layout.frames.rowHeight / 2,
    }, options)

    expect(hit).toMatchObject({
      columnId: 'custom_camera_column',
      timelineLaneId: 'camera_lane_1',
    })
    expect(hit?.timelineLaneId).not.toBe('custom_template_lane')
  })
})
