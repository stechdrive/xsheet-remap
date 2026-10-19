import { describe, expect, it } from 'vitest'
import { addTimelineLane, createDefaultProject, digitalStandardSheetTemplate, standardA3SheetTemplate, updateTimelineLane } from '@xsheet-remap/core'
import { hiddenSheetColumns, newlyHiddenAfterLaneInsertion, sheetColumnRoleLabel, timelineLaneInsertionTargets } from './sheetColumnModel'

describe('sheet column visibility and insertion', () => {
  it('reports unique hidden lane identities across repeated paper regions and restores all on digital', () => {
    const sound = addTimelineLane(createDefaultProject(), { role: 'sound' })
    const camera = addTimelineLane(sound.project, { role: 'camera' })
    const project = updateTimelineLane(camera.project, 'sound', sound.lane.laneId, { label: '効果音' })
    expect(hiddenSheetColumns(project, standardA3SheetTemplate)).toEqual([
      { role: 'sound', id: sound.lane.laneId, label: '効果音' },
      { role: 'camera', id: camera.lane.laneId, label: camera.lane.label },
    ])
    expect(hiddenSheetColumns(project, digitalStandardSheetTemplate)).toEqual([])
    expect(hiddenSheetColumns(createDefaultProject(), standardA3SheetTemplate)).toEqual([])
  })

  it.each(['sound', 'camera'] as const)('offers first, middle and last boundaries for %s and predicts the displaced lane', role => {
    const project = createDefaultProject()
    const lanes = project.logicalSheet.timelineSections.find(section => section.role === role)!.lanes!
    const targets = timelineLaneInsertionTargets(project, standardA3SheetTemplate, role)
    const region = standardA3SheetTemplate.regions.find(item => item.grid?.role === role)!
    const firstRegion = targets.filter(target => target.id.startsWith(`${region.regionId}:`))
    expect(firstRegion).toHaveLength(lanes.length + 1)
    expect(firstRegion[0]!.value).toEqual({ role, insertBeforeLaneId: lanes[0]!.laneId })
    expect(firstRegion[1]!.value).toEqual({ role, insertAfterLaneId: lanes[0]!.laneId })
    expect(firstRegion.at(-1)!.value).toEqual({ role, insertAfterLaneId: lanes.at(-1)!.laneId })
    expect(firstRegion[0]!.x).toBeCloseTo(region.rect.x)
    expect(firstRegion.at(-1)!.x).toBeCloseTo(region.rect.x + region.rect.w)
    expect(newlyHiddenAfterLaneInsertion(project, standardA3SheetTemplate, firstRegion[0]!.value)).toEqual([
      { role, id: lanes.at(-1)!.laneId, label: lanes.at(-1)!.label },
    ])
    const appended = newlyHiddenAfterLaneInsertion(project, standardA3SheetTemplate, firstRegion.at(-1)!.value)
    expect(appended).toHaveLength(1)
    expect(lanes.some(lane => lane.laneId === appended[0]!.id)).toBe(false)
    expect(newlyHiddenAfterLaneInsertion(project, digitalStandardSheetTemplate, firstRegion[0]!.value)).toEqual([])
    const withHidden = addTimelineLane(project, firstRegion.at(-1)!.value).project
    expect(timelineLaneInsertionTargets(withHidden, standardA3SheetTemplate, role).filter(target => target.id.startsWith(`${region.regionId}:`)).at(-1)!.label).toContain('表示中の右端')
  })

  it('uses the template label while identifying behavior by role', () => {
    const template = { ...standardA3SheetTemplate, regions: standardA3SheetTemplate.regions.map(region => region.grid?.role === 'sound'
      ? { ...region, label: 'セリフ', grid: { ...region.grid, header: { ...region.grid.header, label: 'セリフ' } } } : region) }
    expect(sheetColumnRoleLabel(template, 'sound')).toBe('セリフ')
    expect(timelineLaneInsertionTargets(createDefaultProject(), template, 'sound')[0]!.label).toContain('セリフ：')
  })
})
