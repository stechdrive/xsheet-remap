import {
  addTimelineLane, isInteractiveSheetTemplateGridRegion, projectSheetLayoutOptions,
  resolveSheetTemplateGridLayout, timelineLanesForLayout,
  type CutProject, type NormalizedRect, type SheetHit, type SheetTemplate, type SheetTimingRole, type TimedRangeRole,
} from '@xsheet-remap/core'
import { gridHeaderLabelForRegion, gridHeaderLabelForRole } from './templateEditorGeometry'
import { sheetGridHeaderGeometry } from './sheetGridHeaderGeometry'
import { overlayPaperTracks } from './app-sheet-geometry'

export type TimelineLaneAddition = Parameters<typeof addTimelineLane>[1]
export type TimelineColumnRole = Extract<TimedRangeRole, 'sound' | 'camera'>
export type SheetColumnRole = SheetTimingRole | TimelineColumnRole
export type SheetColumnAddKind = 'label-editor' | 'overlay-track' | TimelineColumnRole
export type SheetColumnAddContext = Pick<SheetHit, 'role' | 'regionId' | 'pageId' | 'paperTrack' | 'timelineLaneId'>

export function sheetColumnRoleLabel(template: SheetTemplate, role: SheetColumnRole, regionId?: string) {
  const region = template.regions.find(item => item.regionId === regionId && item.grid?.role === role)
    ?? template.regions.find(item => isInteractiveSheetTemplateGridRegion(item) && item.grid.role === role)
  return (region ? gridHeaderLabelForRegion(template, region) : gridHeaderLabelForRole(template, role))
    || ({ action: 'ACTION', cell: 'CELL', sound: 'SOUND', camera: 'CAMERA' }[role])
}

export function hiddenSheetColumns(project: CutProject, template: SheetTemplate) {
  const options = projectSheetLayoutOptions(project, template)
  const visibleLanes = { sound: new Set<string>(), camera: new Set<string>() }
  const visibleTracks = new Set<string>()
  let hasPaperGrid = false
  for (const region of template.regions) {
    if (!isInteractiveSheetTemplateGridRegion(region)) continue
    const layout = resolveSheetTemplateGridLayout(template, region, options)
    if (region.grid.role === 'action' || region.grid.role === 'cell') hasPaperGrid = true
    for (const column of layout?.columns ?? []) {
      if (column.paperTrack) visibleTracks.add(column.paperTrack)
      if ((region.grid.role === 'sound' || region.grid.role === 'camera') && column.timelineLaneId) {
        visibleLanes[region.grid.role].add(column.timelineLaneId)
      }
    }
  }
  // Paper overflow tracks already have auxiliary labels/columns. They are not invisible lanes.
  if (hasPaperGrid) for (const track of overlayPaperTracks(project, template)) visibleTracks.add(track.paperTrack)
  const rows: Array<{ role: 'cell' | TimelineColumnRole; id: string; label: string }> = project.logicalSheet.paperTracks
    .filter(track => !visibleTracks.has(track.paperTrack))
    .map(track => ({ role: 'cell', id: track.paperTrack, label: track.paperTrack }))
  const lanes = timelineLanesForLayout(project)
  for (const role of ['sound', 'camera'] as const) {
    for (const lane of lanes[role] ?? []) {
      if (!visibleLanes[role].has(lane.laneId)) rows.push({ role, id: lane.laneId, label: lane.label })
    }
  }
  return rows
}

export interface ColumnInsertionTarget<T> {
  id: string
  x: number
  top: number
  bottom: number
  area: NormalizedRect
  label: string
  value: T
}

export function timelineLaneInsertionTargets(project: CutProject, template: SheetTemplate, role: TimelineColumnRole): ColumnInsertionTarget<TimelineLaneAddition>[] {
  const options = projectSheetLayoutOptions(project, template)
  const allLanes = timelineLanesForLayout(project)[role] ?? []
  return template.regions.flatMap(region => {
    if (!isInteractiveSheetTemplateGridRegion(region) || region.grid.role !== role) return []
    const layout = resolveSheetTemplateGridLayout(template, region, options)
    if (!layout) return []
    const columns = layout.columns.filter(column => column.timelineLaneId)
    if (!columns.length) return []
    const header = sheetGridHeaderGeometry(template, region, layout.rect, layout.pageSize.heightPx)
    const roleLabel = sheetColumnRoleLabel(template, role, region.regionId)
    return Array.from({ length: columns.length + 1 }, (_, index) => {
      const previous = columns[index - 1]
      const next = columns[index]
      const allIndex = previous ? allLanes.findIndex(lane => lane.laneId === previous.timelineLaneId) + 1
        : allLanes.findIndex(lane => lane.laneId === next?.timelineLaneId)
      const before = allLanes[allIndex - 1]
      const after = allLanes[allIndex]
      const position = before && after ? `${before.label} と ${after.label} の間`
        : before ? `${before.label} の後（末尾）` : `${after?.label ?? ''} の前（先頭）`
      return {
        id: `${region.regionId}:${index}`,
        x: next?.x ?? previous!.x + previous!.w,
        top: header.title.y, bottom: layout.rect.y + layout.rect.h,
        area: { ...layout.rect, y: header.title.y, h: layout.rect.y + layout.rect.h - header.title.y },
        label: `${roleLabel}：${position}${!next && after ? '（表示中の右端）' : ''}`,
        value: { role, ...(previous ? { insertAfterLaneId: previous.timelineLaneId } : { insertBeforeLaneId: next!.timelineLaneId }) },
      }
    })
  })
}

export function newlyHiddenAfterLaneInsertion(project: CutProject, template: SheetTemplate, input: TimelineLaneAddition) {
  const before = new Set(hiddenSheetColumns(project, template).map(column => `${column.role}:${column.id}`))
  return hiddenSheetColumns(addTimelineLane(project, input).project, template)
    .filter(column => !before.has(`${column.role}:${column.id}`))
}
