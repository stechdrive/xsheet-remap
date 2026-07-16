import { alphabeticTrackLabel, type NormalizedPoint, type SheetTemplate } from '@xsheet-remap/core'
import { uiText } from './i18n'
import { clampNumber } from './sheetInteraction'

export type TemplateRegionEdge = 'left' | 'right' | 'top' | 'bottom'
export type TemplateGridRole = NonNullable<SheetTemplate['regions'][number]['grid']>['role']
type EditableRect = SheetTemplate['regions'][number]['rect']

export function updateTemplateRectEdge(
  rect: EditableRect,
  edge: TemplateRegionEdge,
  point: NormalizedPoint,
  page?: Pick<SheetTemplate['page'], 'widthPx' | 'heightPx'>,
): EditableRect {
  const minWidth = page ? 1 / Math.max(1, page.widthPx) : 0.005
  const minHeight = page ? 1 / Math.max(1, page.heightPx) : 0.005
  const left = rect.x
  const right = rect.x + rect.w
  const top = rect.y
  const bottom = rect.y + rect.h
  if (edge === 'left') {
    const x = clampNumber(point.x, 0, right - minWidth)
    return { ...rect, x, w: right - x }
  }
  if (edge === 'right') {
    const nextRight = clampNumber(point.x, left + minWidth, 1)
    return { ...rect, w: nextRight - left }
  }
  if (edge === 'top') {
    const y = clampNumber(point.y, 0, bottom - minHeight)
    return { ...rect, y, h: bottom - y }
  }
  const nextBottom = clampNumber(point.y, top + minHeight, 1)
  return { ...rect, h: nextBottom - top }
}

export function updateTemplateRegionEdge(template: SheetTemplate, regionId: string, edge: TemplateRegionEdge, point: NormalizedPoint): SheetTemplate {
  return {
    ...template,
    regions: template.regions.map(region => {
      if (region.regionId !== regionId) return region
      return { ...region, rect: updateTemplateRectEdge(region.rect, edge, point, template.page) }
    }),
  }
}

export function setTemplateCalibrationTargetRect(template: SheetTemplate, rect: EditableRect): SheetTemplate {
  return {
    ...template,
    calibration: {
      ...(template.calibration ?? {}),
      targetRect: rect,
    },
  }
}

export function clearTemplateCalibrationTargetRect(template: SheetTemplate): SheetTemplate {
  const nextCalibration = { ...(template.calibration ?? {}) }
  delete nextCalibration.targetRect
  return {
    ...template,
    calibration: Object.keys(nextCalibration).length > 0 ? nextCalibration : undefined,
  }
}

export function updateTemplateCalibrationTargetRectEdge(
  template: SheetTemplate,
  rect: EditableRect,
  edge: TemplateRegionEdge,
  point: NormalizedPoint,
): SheetTemplate {
  return setTemplateCalibrationTargetRect(template, updateTemplateRectEdge(rect, edge, point, template.page))
}

export function defaultColumnCountForRole(template: SheetTemplate, role: TemplateGridRole): number {
  if (role === 'action' || role === 'cell') {
    return template.regions.find(region => region.grid?.role === role)?.grid?.columns.length ?? template.defaults.paperTracks.length
  }
  if (role === 'camera') return 6
  if (role === 'sound') return 4
  return 1
}

export function defaultRegionLabel(role: TemplateGridRole, index: number): string {
  return `${gridRoleLabel(role)} ${index}`
}

export function gridRoleLabel(role: TemplateGridRole): string {
  return {
    action: 'ACTION',
    sound: 'SOUND',
    cell: 'CELL',
    camera: 'CAMERA',
    'frame-guide': 'FRAME',
    'count-table': 'COUNT',
    other: 'OTHER',
  }[role]
}

export function buildTemplateColumns(
  template: SheetTemplate,
  role: TemplateGridRole,
  count: number,
  existing: NonNullable<SheetTemplate['regions'][number]['grid']>['columns'] = [],
): NonNullable<SheetTemplate['regions'][number]['grid']>['columns'] {
  return Array.from({ length: count }, (_, index) => {
    const existingColumn = existing[index]
    const label = defaultColumnLabel(template, role, index, count)
    return {
      columnId: existingColumn?.columnId ?? `${role}_${index + 1}`,
      label: existingColumn?.label ?? label,
      paperTrack: role === 'action' || role === 'cell' ? existingColumn?.paperTrack ?? label : existingColumn?.paperTrack,
      timelineLaneId: role === 'sound' || role === 'camera'
        ? existingColumn?.timelineLaneId ?? `${role}_lane_${index + 1}`
        : undefined,
      xdtsEligible: role === 'cell',
    }
  })
}

export function trackProjectionForRole(role: TemplateGridRole): NonNullable<SheetTemplate['regions'][number]['grid']>['trackProjection'] {
  return role === 'action' || role === 'cell'
    ? { source: 'logical-paper-tracks', startIndex: 0, overflow: 'hidden' }
    : undefined
}

export function resizePaperTrackLabels(labels: string[], count: number): string[] {
  const next = labels.map(label => label.trim()).filter(Boolean).slice(0, count)
  const used = new Set(next)
  let index = 0
  while (next.length < count) {
    const candidate = alphabeticTrackLabel(index)
    index += 1
    if (used.has(candidate)) continue
    next.push(candidate)
    used.add(candidate)
  }
  return next
}

export function addCellRegionToTemplate(template: SheetTemplate, rect: { x: number; y: number; w: number; h: number }): SheetTemplate {
  const labels = template.defaults.paperTracks.slice(0, defaultColumnCountForRole(template, 'cell'))
  const index = template.regions.filter(region => region.grid?.role === 'cell').length + 1
  return {
    ...template,
    regions: [
      ...template.regions,
      {
        regionId: `drawn_cell_${index}_${Math.round(rect.x * 10000)}_${Math.round(rect.y * 10000)}`,
        type: 'exposure-grid',
        label: uiText.template.customCellRegion(index),
        rect,
        usage: 'input',
        inputKind: 'timing-event',
        grid: {
          role: 'cell',
          frameStart: 1,
          frameEnd: template.defaults.durationFrames,
          rowCount: template.defaults.durationFrames,
          majorLineEvery: 6,
          pageBreakEvery: 24,
          trackProjection: { source: 'logical-paper-tracks', startIndex: 0, overflow: 'hidden' },
          columns: labels.map(label => ({ columnId: `cell_${label}`, label, paperTrack: label, xdtsEligible: true })),
        },
      },
    ],
  }
}

function defaultColumnLabel(template: SheetTemplate, role: TemplateGridRole, index: number, count: number): string {
  if (role === 'action' || role === 'cell') return template.defaults.paperTracks[index] ?? alphabeticTrackLabel(index)
  if (role === 'camera') return count === 1 ? 'CAMERA' : `CAM${index + 1}`
  if (role === 'sound') return ''
  return String(index + 1)
}
