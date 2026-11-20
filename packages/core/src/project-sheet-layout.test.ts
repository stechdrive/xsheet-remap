import { describe, expect, it } from 'vitest'
import { addOverlayPaperTrack, createDefaultProject, deletePaperTrack, projectSheetLayoutOptions, updatePaperTrack } from './project-model'
import { digitalStandardSheetTemplate, standardA3SheetTemplate } from './sheet-template-presets'
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

  it('preserves the printed column underneath each remaining track, including after another deletion', () => {
    let project = updatePaperTrack(createDefaultProject(), 'B', { paperTrack: '口パク' })
    project = addOverlayPaperTrack(project, { paperTrack: '追加', insertAfterPaperTrack: '口パク' }).project
    const fixed = () => resolveSheetTemplateGridLayout(standardA3SheetTemplate, standardA3SheetTemplate.regions.find(r => r.regionId === 'left_cell_grid')!, projectSheetLayoutOptions(project, standardA3SheetTemplate))!
    const digital = () => projectSheetLayoutOptions(project, digitalStandardSheetTemplate).paperTracks
    const columns = fixed().columns
    project = deletePaperTrack(project, '口パク')
    expect(digital().slice(0, 3)).toEqual(['A', '追加', 'C'])
    expect(fixed().columns[1]).toMatchObject({ label: '', paperTrack: undefined })
    expect(fixed().columns[2]).toEqual(columns[2])
    project = deletePaperTrack(project, 'A')
    project = deletePaperTrack(project, '追加')
    expect(fixed().columns.slice(0, 3).map(c => c.label)).toEqual(['', '', 'C'])
    for (const name of [...digital()]) project = deletePaperTrack(project, name)
    expect(digital()).toEqual([])
    expect(fixed().columns.every(c => !c.label && !c.paperTrack)).toBe(true)
    project = addOverlayPaperTrack(project, { paperTrack: '新規' }).project
    expect(digital()).toEqual(['新規'])
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
