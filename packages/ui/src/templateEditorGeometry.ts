import {
  isRenderableSheetTemplateGridRegion,
  resolveSheetTemplateGridLayout,
  resolveSheetTemplatePageSize,
  resolveSheetTemplateRegionRect,
  sheetGridRowY,
  type NormalizedPoint,
  type NormalizedRect,
  type SheetGridLayout,
  type SheetGridLayoutOptions,
  type SheetTemplate,
  type SheetTemplateLayoutResolveOptions,
  type SheetTemplateGrid,
  type SheetTemplateGridRole,
  type SheetTemplateGridRowLabelRule,
  type SheetTemplateFieldDefinition,
  type SheetTemplateLineStyle,
  type SheetTemplateTextStyle,
} from '@xsheet-remap/core'
import {
  STANDARD_A3_GRID_HEADER_HEIGHT,
  STANDARD_A3_GRID_HEADER_TOP_OFFSET,
} from './sheetConstants'
import { calibrationTargetRectForTemplate } from './sheetImages'
import type { SheetSvgPageSize } from './sheetSvgTextGeometry'
import { gridRoleLabel } from './templateEditing'

export type TemplateGridHeaderColumnRenderModel = {
  columnId: string
  label: string
  x: number
  y: number
  fontSizePx: number
}

export type TemplateGridHeaderRenderModel = {
  regionId: string
  rect: NormalizedRect
  label: string
  labelX: number
  labelY: number
  labelFontSizePx: number
  columns: TemplateGridHeaderColumnRenderModel[]
  columnHeaderRect: NormalizedRect
  columnBoundaries: number[]
}

export type TemplateLineRenderStyle = Required<Pick<SheetTemplateLineStyle, 'pattern' | 'color' | 'widthPx'>> & {
  dashPx: number[]
}

export type TemplateFormBoxRenderModel = {
  key: string
  rect: NormalizedRect
  style: TemplateLineRenderStyle
}

export type TemplateFormLabelRenderModel = {
  key: string
  text: string
  rect: NormalizedRect
  x: number
  y: number
  textAnchor: 'start' | 'middle' | 'end'
  dominantBaseline: 'hanging' | 'central' | 'text-after-edge'
  fontSizePx: number
  fontWeight: number
}

export type TemplateFormFieldRenderModel = {
  key: string
  regionId: string
  fieldId: string
  rect: NormalizedRect
  definition: SheetTemplateFieldDefinition
  textStyle: SheetTemplateTextStyle
  editable: boolean
  sourceFieldIds?: string[]
}

export type TemplateReferenceRegionRenderModel = {
  regionId: string
  type: string
  rect: NormalizedRect
}

export type TemplateChromeRenderModel = {
  pageSize: SheetSvgPageSize
  showOuterFrame: boolean
  referenceRegions: TemplateReferenceRegionRenderModel[]
  headers: TemplateGridHeaderRenderModel[]
  formBoxes: TemplateFormBoxRenderModel[]
  formLabels: TemplateFormLabelRenderModel[]
  formFields: TemplateFormFieldRenderModel[]
}

export type TemplateGridPathRenderModel = {
  className: string
  d: string
  segments: TemplateGridLineSegment[]
  style?: TemplateLineRenderStyle
}

export type TemplateGridLineSegment = {
  x1: number
  y1: number
  x2: number
  y2: number
}

export type TemplateGridRowLabelRenderModel = {
  key: string
  text: string
  x: number
  y: number
  textAnchor: 'start' | 'end'
  fontSizePx: number
}

export type TemplateGridCounterRenderModel = {
  key: string
  text: string
  x: number
  y: number
  textAnchor: 'start' | 'end'
  fontSizePx: number
}

export type TemplateBottomTrackLabelRenderModel = {
  key: string
  text: string
  x: number
  y: number
  fontSizePx: number
  opacity: number
}

export type TemplateGridOverlayRenderModel = {
  regionId: string
  role: SheetTemplateGridRole
  pageSize: SheetSvgPageSize
  rowPaths: TemplateGridPathRenderModel[]
  columnPath: TemplateGridPathRenderModel | null
  labels: TemplateGridRowLabelRenderModel[]
  frameNumbers: TemplateGridCounterRenderModel[]
  secondCounters: TemplateGridCounterRenderModel[]
  bottomTrackLabels: TemplateBottomTrackLabelRenderModel[]
}

export interface TemplateGridOverlayOptions extends SheetGridLayoutOptions {
  pageFrameStart?: number
}

export type TemplateEditorRenderModel = {
  chrome: TemplateChromeRenderModel
  gridOverlays: TemplateGridOverlayRenderModel[]
  calibrationTargetRect: NormalizedRect | null
}

export type TemplateEditorRegionRenderModel = {
  chrome: TemplateChromeRenderModel
  gridOverlay: TemplateGridOverlayRenderModel | null
}

export type TemplateEditorTarget =
  | { kind: 'region'; regionId: string }
  | { kind: 'calibration-target' }

export type TemplateEditorRectKey = 'x' | 'y' | 'w' | 'h'

export type TemplatePixelEdges = {
  left: number
  top: number
  right: number
  bottom: number
}

const TEMPLATE_GRID_HEADER_ROLE_ORDER: SheetTemplateGridRole[] = ['action', 'sound', 'cell', 'camera', 'frame-guide', 'count-table', 'other']

const GRID_ROW_LINE_WEIGHT_ORDER = {
  thin: 0,
  regular: 1,
  medium: 2,
  strong: 3,
} as const

const ZERO_RADIUS: NormalizedPoint = { x: 0, y: 0 }

export function buildTemplateEditorRenderModel(template: SheetTemplate, durationFrames = template.defaults.durationFrames): TemplateEditorRenderModel {
  return {
    chrome: buildTemplateChromeRenderModel(template, template.defaults.paperTracks, durationFrames),
    gridOverlays: template.regions
      .filter(isRenderableSheetTemplateGridRegion)
      .map(region => buildTemplateGridOverlayRenderModel(template, region, { durationFrames }))
      .filter((model): model is TemplateGridOverlayRenderModel => model !== null),
    calibrationTargetRect: calibrationTargetRectForTemplate(template),
  }
}

export function buildTemplateEditorRegionRenderModel(
  template: SheetTemplate,
  regionId: string,
  durationFrames = template.defaults.durationFrames,
): TemplateEditorRegionRenderModel | null {
  const region = template.regions.find(item => item.regionId === regionId)
  if (!region) return null
  const paperTracks = template.defaults.paperTracks
  const resolveOptions = { paperTracks }
  const header = region.type === 'exposure-grid' && region.grid
    ? buildTemplateGridHeaderRenderModel(template, region, paperTracks, durationFrames)
    : null
  const form = buildTemplateFormRenderModels(template, region, paperTracks, durationFrames, resolveOptions)
  return {
    chrome: {
      pageSize: resolveSheetTemplatePageSize(template, durationFrames, resolveOptions),
      showOuterFrame: false,
      referenceRegions: !region.form && !region.grid && region.type !== 'metadata-field' && region.usage !== 'ignored'
        ? [{
            regionId: region.regionId,
            type: region.type,
            rect: resolveSheetTemplateRegionRect(template, region, durationFrames, resolveOptions),
          }]
        : [],
      headers: header ? [header] : [],
      formBoxes: form.boxes,
      formLabels: form.labels,
      formFields: form.fields,
    },
    gridOverlay: isRenderableSheetTemplateGridRegion(region)
      ? buildTemplateGridOverlayRenderModel(template, region, { durationFrames })
      : null,
  }
}

export function buildTemplateChromeRenderModel(
  template: SheetTemplate,
  paperTracks = template.defaults.paperTracks,
  durationFrames = template.defaults.durationFrames,
  options: Omit<SheetTemplateLayoutResolveOptions, 'paperTracks'> = {},
): TemplateChromeRenderModel {
  const resolveOptions = { ...options, paperTracks }
  const pageSize = resolveSheetTemplatePageSize(template, durationFrames, resolveOptions)
  const forms = template.regions.map(region => buildTemplateFormRenderModels(template, region, paperTracks, durationFrames, resolveOptions))
  return {
    pageSize,
    showOuterFrame: template.templateKind !== 'digital-native' && template.style?.outerFrame?.visible !== false,
    referenceRegions: template.regions
      .filter(region => !region.form && !region.grid && region.type !== 'metadata-field' && region.usage !== 'ignored')
      .map(region => ({
        regionId: region.regionId,
        type: region.type,
        rect: resolveSheetTemplateRegionRect(template, region, durationFrames, resolveOptions),
      })),
    headers: template.regions
      .filter(region => region.type === 'exposure-grid' && region.grid)
      .map(region => buildTemplateGridHeaderRenderModel(template, region, paperTracks, durationFrames, options))
      .filter((model): model is TemplateGridHeaderRenderModel => model !== null),
    formBoxes: forms.flatMap(form => form.boxes),
    formLabels: forms.flatMap(form => form.labels),
    formFields: forms.flatMap(form => form.fields),
  }
}

export function buildTemplateFormRenderModels(
  template: SheetTemplate,
  region: SheetTemplate['regions'][number],
  paperTracks = template.defaults.paperTracks,
  durationFrames = template.defaults.durationFrames,
  options: SheetTemplateLayoutResolveOptions = {},
): {
  boxes: TemplateFormBoxRenderModel[]
  labels: TemplateFormLabelRenderModel[]
  fields: TemplateFormFieldRenderModel[]
} {
  const form = region.form
  if (!form || region.usage === 'ignored') return { boxes: [], labels: [], fields: [] }
  const regionRect = resolveSheetTemplateRegionRect(template, region, durationFrames, { ...options, paperTracks })
  const pageSize = resolveSheetTemplatePageSize(template, durationFrames, { ...options, paperTracks })
  const borderStyle = normalizeTemplateLineStyle(form.borderStyle)
  const cells = form.projection
    ? projectedTrackCountCells(template, region.regionId, form.projection, paperTracks)
    : [...(form.cells ?? [])]
  const rowWeights = form.projection
    ? projectedTrackCountRowWeights(form.rows, paperTracks.length)
    : form.rows
  const columnEdges = weightedEdges(form.columns, regionRect.x, regionRect.w)
  const rowEdges = weightedEdges(rowWeights, regionRect.y, regionRect.h)
  const occupied = new Set<string>()
  for (const cell of cells) {
    for (let row = cell.row; row < cell.row + (cell.rowSpan ?? 1); row += 1) {
      for (let column = cell.column; column < cell.column + (cell.columnSpan ?? 1); column += 1) {
        occupied.add(`${row}:${column}`)
      }
    }
  }
  if (form.fillEmptyCells) {
    for (let row = 0; row < rowWeights.length; row += 1) {
      for (let column = 0; column < form.columns.length; column += 1) {
        if (!occupied.has(`${row}:${column}`)) {
          cells.push({ cellId: `auto_${row}_${column}`, row, column, kind: 'spacer' })
        }
      }
    }
  }
  const boxes: TemplateFormBoxRenderModel[] = []
  const labels: TemplateFormLabelRenderModel[] = []
  const fields: TemplateFormFieldRenderModel[] = []
  for (const cell of cells) {
    const rect = formCellRect(cell.row, cell.column, cell.rowSpan ?? 1, cell.columnSpan ?? 1, rowEdges, columnEdges)
    if (!rect) continue
    if (cell.border !== false) {
      boxes.push({ key: `${region.regionId}:${cell.cellId}`, rect, style: normalizeTemplateLineStyle(cell.borderStyle, borderStyle) })
    }
    if (cell.kind === 'label' && cell.label) {
      labels.push(templateFormLabel(`${region.regionId}:${cell.cellId}`, cell.label, rect, cell.textStyle, pageSize))
    }
    if (cell.kind === 'field' && cell.fieldId) {
      const definition = fieldDefinitionForCell(template, region.regionId, cell.fieldId, cell.label)
      const isProjectedTotal = Boolean(form.projection && cell.fieldId.startsWith(`${form.projection.fieldPrefix}.total.`))
      const totalSuffix = isProjectedTotal ? cell.fieldId.split('.').at(-1) : undefined
      fields.push({
        key: `${region.regionId}:${cell.cellId}`,
        regionId: region.regionId,
        fieldId: cell.fieldId,
        rect,
        definition,
        textStyle: cell.textStyle ?? {},
        editable: !isProjectedTotal,
        sourceFieldIds: isProjectedTotal && totalSuffix
          ? paperTracks.map(paperTrack => `${form.projection!.fieldPrefix}.${paperTrack}.${totalSuffix}`)
          : undefined,
      })
    }
  }
  return { boxes, labels, fields }
}

function projectedTrackCountCells(
  template: SheetTemplate,
  regionId: string,
  projection: NonNullable<NonNullable<SheetTemplate['regions'][number]['form']>['projection']>,
  paperTracks: string[],
): NonNullable<NonNullable<SheetTemplate['regions'][number]['form']>['cells']> {
  const cells: NonNullable<NonNullable<SheetTemplate['regions'][number]['form']>['cells']> = [
    { cellId: 'count_header_spacer', row: 0, column: 0, kind: 'spacer' },
    ...projection.columns.map((column, index) => ({
      cellId: `count_header_${column.columnId}`,
      row: 0,
      column: index + 1,
      kind: 'label' as const,
      label: column.label,
      textStyle: { fontSizePx: 10, minFontSizePx: 7, fontWeight: 700, horizontalAlign: 'center' as const, verticalAlign: 'middle' as const, paddingPx: 2, shrinkToFit: true },
    })),
    { cellId: 'count_name', row: 1, column: 0, kind: 'label', label: projection.nameLabel ?? 'NAME' },
    ...projection.columns.map((column, index) => ({ cellId: `count_name_blank_${column.columnId}`, row: 1, column: index + 1, kind: 'spacer' as const })),
  ]
  paperTracks.forEach((paperTrack, trackIndex) => {
    const row = trackIndex + 2
    cells.push({ cellId: `count_track_${trackIndex}`, row, column: 0, kind: 'label', label: paperTrack })
    projection.columns.forEach((column, columnIndex) => {
      cells.push({
        cellId: `count_${trackIndex}_${column.columnId}`,
        row,
        column: columnIndex + 1,
        kind: 'field',
        fieldId: `${projection.fieldPrefix}.${paperTrack}.${column.fieldSuffix}`,
        label: `${paperTrack} ${column.label}`,
      })
    })
  })
  const totalRow = paperTracks.length + 2
  cells.push({ cellId: 'count_total_label', row: totalRow, column: 0, kind: 'label', label: projection.totalLabel ?? '計' })
  projection.columns.forEach((column, columnIndex) => {
    cells.push({
      cellId: `count_total_${column.columnId}`,
      row: totalRow,
      column: columnIndex + 1,
      kind: 'field',
      fieldId: `${projection.fieldPrefix}.total.${column.fieldSuffix}`,
      label: `${projection.totalLabel ?? '計'} ${column.label}`,
    })
  })
  void template
  void regionId
  return cells
}

function projectedTrackCountRowWeights(defaultRows: number[], trackCount: number): number[] {
  const header = defaultRows[0] ?? 24
  const name = defaultRows[1] ?? 47
  const total = defaultRows.at(-1) ?? 47
  const defaultTrackRows = defaultRows.slice(2, -1)
  const averageTrack = defaultTrackRows.length > 0
    ? defaultTrackRows.reduce((sum, value) => sum + value, 0) / defaultTrackRows.length
    : 24
  return [header, name, ...Array.from({ length: trackCount }, () => averageTrack), total]
}

function fieldDefinitionForCell(
  template: SheetTemplate,
  regionId: string,
  fieldId: string,
  label?: string,
): SheetTemplateFieldDefinition {
  const explicit = template.fields?.find(field => field.fieldId === fieldId)
  if (explicit) return explicit
  const projection = template.regions.find(region => region.regionId === regionId)?.form?.projection
  return {
    fieldId,
    label: label ?? fieldId,
    scope: projection?.scope ?? 'revision',
    valueType: projection ? 'number' : 'text',
  }
}

function formCellRect(
  row: number,
  column: number,
  rowSpan: number,
  columnSpan: number,
  rowEdges: number[],
  columnEdges: number[],
): NormalizedRect | null {
  const left = columnEdges[column]
  const right = columnEdges[column + columnSpan]
  const top = rowEdges[row]
  const bottom = rowEdges[row + rowSpan]
  if (left === undefined || right === undefined || top === undefined || bottom === undefined) return null
  return { x: left, y: top, w: right - left, h: bottom - top }
}

function weightedEdges(weights: number[], start: number, span: number): number[] {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0) || 1
  const edges = [start]
  let consumed = 0
  for (const weight of weights) {
    consumed += Math.max(0, weight)
    edges.push(start + span * consumed / total)
  }
  return edges
}

function templateFormLabel(
  key: string,
  text: string,
  rect: NormalizedRect,
  style: SheetTemplateTextStyle = {},
  pageSize: SheetSvgPageSize,
): TemplateFormLabelRenderModel {
  const paddingPx = Math.max(0, style.paddingPx ?? 2)
  const align = style.horizontalAlign ?? 'center'
  const vertical = style.verticalAlign ?? 'middle'
  const xPadding = paddingPx / pageSize.widthPx
  const yPadding = paddingPx / pageSize.heightPx
  return {
    key,
    text,
    rect,
    x: align === 'left' ? rect.x + xPadding : align === 'right' ? rect.x + rect.w - xPadding : rect.x + rect.w / 2,
    y: vertical === 'top' ? rect.y + yPadding : vertical === 'bottom' ? rect.y + rect.h - yPadding : rect.y + rect.h / 2,
    textAnchor: align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle',
    dominantBaseline: vertical === 'top' ? 'hanging' : vertical === 'bottom' ? 'text-after-edge' : 'central',
    fontSizePx: style.fontSizePx ?? 10,
    fontWeight: style.fontWeight ?? 700,
  }
}

export function normalizeTemplateLineStyle(
  style: SheetTemplateLineStyle | undefined,
  fallback?: TemplateLineRenderStyle,
): TemplateLineRenderStyle {
  const pattern = style?.pattern ?? fallback?.pattern ?? 'solid'
  const widthPx = style?.widthPx ?? lineWeightWidth(style?.weight) ?? fallback?.widthPx ?? 1
  const dashPx = style?.dashPx ?? (pattern === 'dotted' ? [1, Math.max(2, widthPx * 2.5)] : pattern === 'dashed' ? [6, 4] : [])
  return {
    pattern,
    color: style?.color ?? fallback?.color ?? '#2f3430',
    widthPx,
    dashPx,
  }
}

function lineWeightWidth(weight: SheetTemplateLineStyle['weight']): number | undefined {
  if (weight === 'strong') return 2.6
  if (weight === 'medium') return 1.8
  if (weight === 'regular') return 1.25
  if (weight === 'thin') return 0.8
  return undefined
}

function gridLineRuleIndexes(
  rule: NonNullable<SheetTemplateGrid['lineRules']>[number],
  boundaryCount: number,
): number[] {
  let indexes: number[]
  if (rule.target === 'indexes') indexes = rule.indexes ?? []
  else if (rule.target === 'inner') indexes = Array.from({ length: Math.max(0, boundaryCount - 1) }, (_, index) => index + 1)
  else if (rule.target === 'outer') indexes = boundaryCount === 0 ? [0] : [0, boundaryCount]
  else indexes = Array.from({ length: boundaryCount + 1 }, (_, index) => index)
  const every = Math.max(1, Math.round(rule.every ?? 1))
  const offset = Math.round(rule.offset ?? 0)
  return [...new Set(indexes)]
    .filter(index => Number.isInteger(index) && index >= 0 && index <= boundaryCount && (index - offset) % every === 0)
    .sort((a, b) => a - b)
}

function gridLineRuleSpans(
  rule: NonNullable<SheetTemplateGrid['lineRules']>[number],
  orthogonalBoundaryCount: number,
): Array<{ startBoundary: number; endBoundary: number }> {
  const spans = rule.spans?.length
    ? rule.spans
    : [{ startBoundary: 0, endBoundary: orthogonalBoundaryCount }]
  const normalized = spans.flatMap(span => {
    if (!Number.isFinite(span.startBoundary) || !Number.isFinite(span.endBoundary)) return []
    const first = Math.max(0, Math.min(orthogonalBoundaryCount, Math.round(span.startBoundary)))
    const last = Math.max(0, Math.min(orthogonalBoundaryCount, Math.round(span.endBoundary)))
    const startBoundary = Math.min(first, last)
    const endBoundary = Math.max(first, last)
    return startBoundary === endBoundary ? [] : [{ startBoundary, endBoundary }]
  })
  return [...new Map(normalized.map(span => [`${span.startBoundary}:${span.endBoundary}`, span])).values()]
    .sort((a, b) => a.startBoundary - b.startBoundary || a.endBoundary - b.endBoundary)
}

export function gridHeaderRolesForTemplate(template: SheetTemplate): SheetTemplateGridRole[] {
  const roles = new Set<SheetTemplateGridRole>()
  for (const region of template.regions) {
    if (region.type === 'exposure-grid' && region.grid) roles.add(region.grid.role)
  }
  return TEMPLATE_GRID_HEADER_ROLE_ORDER.filter(role => roles.has(role))
}

export function gridHeaderLabelForRole(template: SheetTemplate, role: SheetTemplateGridRole): string {
  const labelOverrides = template.style?.gridHeader?.labelOverrides
  if (labelOverrides && role in labelOverrides) return labelOverrides[role] ?? ''
  const regionLabel = template.regions.find(region =>
    region.type === 'exposure-grid' && region.grid?.role === role,
  )?.label
  if (regionLabel?.trim()) return regionLabel.replace(/\s+\d+\s*-\s*\d+\s*$/, '').trim()
  return gridRoleLabel(role)
}

export function templateGridHeaderFontSizePx(template: SheetTemplate): number {
  if (template.templateKind === 'digital-native') return 18
  return 0.0075 * template.page.heightPx
}

export function templateGridColumnFontSizePx(template: SheetTemplate): number {
  if (template.templateKind === 'digital-native') return 15
  return 0.0065 * template.page.heightPx
}

export function gridRowLineClassName(grid: Pick<SheetTemplateGrid, 'majorLineEvery' | 'rowLineRules'>, row: number): string {
  const weight = gridRowLineWeight(grid, row)
  if (weight === 'strong') return 'gridLine gridLineStrong gridLineMajor'
  if (weight === 'medium') return 'gridLine gridLineMedium'
  if (weight === 'regular') return 'gridLine gridLineRegular'
  return 'gridLine'
}

export function buildTemplateGridOverlayRenderModel(
  template: SheetTemplate,
  region: SheetTemplate['regions'][number],
  options: TemplateGridOverlayOptions = {},
): TemplateGridOverlayRenderModel | null {
  if (!region.grid) return null
  const layout = resolveSheetTemplateGridLayout(template, region, options)
  if (!layout) return null
  const rect = layout.rect
  const pageSize = layout.pageSize
  const frames = layout.frames
  const rowPaths = new Map<string, TemplateGridLineSegment[]>()
  const explicitPaths: TemplateGridPathRenderModel[] = []
  const hasExplicitLineRules = region.grid.lineRules !== undefined
  const renderHorizontalLines = !hasExplicitLineRules && !(template.templateKind === 'digital-native' && region.grid.role === 'sound')
  if (renderHorizontalLines) {
    for (let row = 0; row <= frames.rowCount; row += 1) {
      const y = sheetGridRowY(layout, row)
      const className = `${gridRowLineClassName(region.grid, row)} gridLineRow`
      const segments = rowPaths.get(className) ?? []
      segments.push({ x1: rect.x, y1: y, x2: rect.x + rect.w, y2: y })
      rowPaths.set(className, segments)
    }
  }
  const columnLines = [
    ...layout.columns.map(column => column.x),
    layout.columns.at(-1) ? layout.columns.at(-1)!.x + layout.columns.at(-1)!.w : rect.x + rect.w,
  ]
  if (hasExplicitLineRules) {
    for (const [ruleIndex, rule] of region.grid.lineRules!.entries()) {
      const boundaryCount = rule.axis === 'row' ? frames.rowCount : Math.max(0, columnLines.length - 1)
      const indexes = gridLineRuleIndexes(rule, boundaryCount)
      const orthogonalBoundaryCount = rule.axis === 'row' ? Math.max(0, columnLines.length - 1) : frames.rowCount
      const spans = gridLineRuleSpans(rule, orthogonalBoundaryCount)
      const segments = indexes.flatMap(index => spans.map(span => rule.axis === 'row'
        ? {
            x1: columnLines[span.startBoundary]!,
            y1: sheetGridRowY(layout, index),
            x2: columnLines[span.endBoundary]!,
            y2: sheetGridRowY(layout, index),
          }
        : {
            x1: columnLines[index]!,
            y1: sheetGridRowY(layout, span.startBoundary),
            x2: columnLines[index]!,
            y2: sheetGridRowY(layout, span.endBoundary),
          }))
      if (segments.length === 0) continue
      explicitPaths.push({
        className: `gridLine gridLineCustom gridLine${rule.axis === 'row' ? 'Row' : 'Column'}`,
        d: segments.map(segment => `M ${segment.x1} ${segment.y1} L ${segment.x2} ${segment.y2}`).join(' '),
        segments,
        style: normalizeTemplateLineStyle(rule.style),
      })
      void ruleIndex
    }
  }
  const columnPath = !hasExplicitLineRules && columnLines.length > 0
    ? {
        className: 'gridLine gridLineColumn',
        d: columnLines.map(x => `M ${x} ${rect.y} V ${rect.y + rect.h}`).join(' '),
        segments: columnLines.map(x => ({ x1: x, y1: rect.y, x2: x, y2: rect.y + rect.h })),
      }
    : null
  const labels = region.grid.rowLabelRules?.flatMap((rule, ruleIndex) => {
    const xOffset = (rule.xOffsetPx ?? 6) / pageSize.widthPx
    const yOffset = (rule.yOffsetPx ?? 0) / pageSize.heightPx
    const fontSizePx = rule.fontSizePx ?? 20
    const normalizedFontSize = fontSizePx / pageSize.heightPx
    const minY = rect.y + normalizedFontSize
    const maxY = rect.y + rect.h - normalizedFontSize * 0.25
    const x = rule.xAnchor === 'end' ? rect.x + rect.w - xOffset : rect.x + xOffset
    return Array.from({ length: frames.rowCount + 1 }, (_, row) => {
      const text = gridRowLabelText(template, frames, row, rule)
      if (text === null) return null
      const y = clampNumber(sheetGridRowY(layout, row) + yOffset, minY, maxY)
      return {
        key: `label-${ruleIndex}-${row}`,
        text,
        x,
        y,
        textAnchor: rule.xAnchor === 'end' ? 'end' : 'start',
        fontSizePx,
      }
    })
  }).filter((label): label is TemplateGridRowLabelRenderModel => label !== null) ?? []
  const frameNumbers = region.grid.role === 'action'
    ? buildActionFrameNumberRenderModels(template, region.grid, layout, options.pageFrameStart)
    : []
  const secondCounters = region.grid.role === 'cell' && template.style?.secondCounter?.visible
    ? buildSecondCounterRenderModels(template, region.grid, layout, options)
    : []
  const bottomTrackLabels = buildBottomTrackLabelRenderModels(template, region.grid, layout)
  return {
    regionId: region.regionId,
    role: region.grid.role,
    pageSize,
    rowPaths: [...Array.from(rowPaths, ([className, segments]) => ({
      className,
      d: segments.map(segment => `M ${segment.x1} ${segment.y1} H ${segment.x2}`).join(' '),
      segments,
    })), ...explicitPaths],
    columnPath,
    labels,
    frameNumbers,
    secondCounters,
    bottomTrackLabels,
  }
}

export function templateEditorPointFromClientRect(
  rect: Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number,
): NormalizedPoint {
  return {
    x: (clientX - rect.left) / rect.width,
    y: (clientY - rect.top) / rect.height,
  }
}

export function snapTemplateEditorPointToPagePixels(
  point: NormalizedPoint,
  page: Pick<SheetTemplate['page'], 'widthPx' | 'heightPx'>,
): NormalizedPoint {
  return {
    x: Math.round(point.x * page.widthPx) / page.widthPx,
    y: Math.round(point.y * page.heightPx) / page.heightPx,
  }
}

export function normalizedRectToPixelEdges(
  rect: NormalizedRect,
  page: Pick<SheetTemplate['page'], 'widthPx' | 'heightPx'>,
): TemplatePixelEdges {
  const widthPx = Math.max(1, Math.round(page.widthPx))
  const heightPx = Math.max(1, Math.round(page.heightPx))
  const left = clampInteger(Math.round(rect.x * widthPx), 0, widthPx)
  const top = clampInteger(Math.round(rect.y * heightPx), 0, heightPx)
  const right = clampInteger(Math.round((rect.x + rect.w) * widthPx), left, widthPx)
  const bottom = clampInteger(Math.round((rect.y + rect.h) * heightPx), top, heightPx)
  return { left, top, right, bottom }
}

export function pixelEdgesToNormalizedRect(
  edges: TemplatePixelEdges,
  page: Pick<SheetTemplate['page'], 'widthPx' | 'heightPx'>,
): NormalizedRect {
  const widthPx = Math.max(1, Math.round(page.widthPx))
  const heightPx = Math.max(1, Math.round(page.heightPx))
  const left = clampInteger(edges.left, 0, widthPx)
  const top = clampInteger(edges.top, 0, heightPx)
  const right = clampInteger(edges.right, left, widthPx)
  const bottom = clampInteger(edges.bottom, top, heightPx)
  return {
    x: left / widthPx,
    y: top / heightPx,
    w: (right - left) / widthPx,
    h: (bottom - top) / heightPx,
  }
}

export function quantizeNormalizedRectToPagePixels(
  rect: NormalizedRect,
  page: Pick<SheetTemplate['page'], 'widthPx' | 'heightPx'>,
): NormalizedRect {
  return pixelEdgesToNormalizedRect(normalizedRectToPixelEdges(rect, page), page)
}

export function templateEditorRectPixelValue(
  rect: NormalizedRect,
  key: TemplateEditorRectKey,
  page: Pick<SheetTemplate['page'], 'widthPx' | 'heightPx'>,
): number {
  const dimension = key === 'x' || key === 'w' ? page.widthPx : page.heightPx
  return roundTemplateEditorPixelValue(rect[key] * dimension)
}

export function templateEditorNormalizedRectValue(
  pixelValue: number,
  key: TemplateEditorRectKey,
  page: Pick<SheetTemplate['page'], 'widthPx' | 'heightPx'>,
): number {
  const dimension = key === 'x' || key === 'w' ? page.widthPx : page.heightPx
  return Number.isFinite(pixelValue) ? pixelValue / Math.max(1, dimension) : 0
}

export function templateEditorHitRadius(template: SheetTemplate, zoom: number, radiusPx: number): NormalizedPoint {
  const scale = Math.max(zoom, 0.0001)
  return {
    x: radiusPx / Math.max(template.page.widthPx * scale, 1),
    y: radiusPx / Math.max(template.page.heightPx * scale, 1),
  }
}

export function hitTestTemplateEditorTarget(
  template: SheetTemplate,
  point: NormalizedPoint,
  options: {
    calibrationTargetRect?: NormalizedRect | null
    calibrationHitRadius?: NormalizedPoint
    regionHitRadius?: NormalizedPoint
  } = {},
): TemplateEditorTarget | null {
  const calibrationTargetRect = options.calibrationTargetRect
  if (
    calibrationTargetRect &&
    pointInNormalizedRectStroke(point, calibrationTargetRect, options.calibrationHitRadius ?? ZERO_RADIUS)
  ) {
    return { kind: 'calibration-target' }
  }
  const regionHitRadius = options.regionHitRadius ?? ZERO_RADIUS
  for (let index = template.regions.length - 1; index >= 0; index -= 1) {
    const region = template.regions[index]
    if (pointInExpandedNormalizedRect(point, region.rect, regionHitRadius)) {
      return { kind: 'region', regionId: region.regionId }
    }
  }
  return null
}

export function pointInExpandedNormalizedRect(point: NormalizedPoint, rect: NormalizedRect, radius: NormalizedPoint = ZERO_RADIUS): boolean {
  return point.x >= rect.x - radius.x
    && point.x <= rect.x + rect.w + radius.x
    && point.y >= rect.y - radius.y
    && point.y <= rect.y + rect.h + radius.y
}

function buildTemplateGridHeaderRenderModel(
  template: SheetTemplate,
  region: SheetTemplate['regions'][number],
  paperTracks: string[],
  durationFrames: number,
  options: Omit<SheetTemplateLayoutResolveOptions, 'paperTracks'> = {},
): TemplateGridHeaderRenderModel | null {
  if (!region.grid) return null
  const layout = resolveSheetTemplateGridLayout(template, region, { ...options, paperTracks, durationFrames })
  if (!layout) return null
  const rect = layout.rect
  const pageSize = layout.pageSize
  const headerTopOffsetPx = region.grid.header?.topOffsetPx ?? STANDARD_A3_GRID_HEADER_TOP_OFFSET * template.page.heightPx
  const headerHeightPx = region.grid.header?.heightPx ?? STANDARD_A3_GRID_HEADER_HEIGHT * template.page.heightPx
  const columnHeightPx = region.grid.header?.columnHeightPx ?? Math.max(0, headerTopOffsetPx - headerHeightPx)
  const headerTopOffset = headerTopOffsetPx / pageSize.heightPx
  const headerHeight = headerHeightPx / pageSize.heightPx
  const columnHeight = columnHeightPx / pageSize.heightPx
  const y = rect.y - headerTopOffset
  const columnBaselineOffset = (0.0025 * template.page.heightPx) / pageSize.heightPx
  return {
    regionId: region.regionId,
    rect: { x: rect.x, y, w: rect.w, h: headerHeight },
    label: region.grid.header?.showLabel === false ? '' : gridHeaderLabelForRole(template, region.grid.role),
    labelX: rect.x + rect.w / 2,
    labelY: y + headerHeight / 2,
    labelFontSizePx: templateGridHeaderFontSizePx(template),
    columns: layout.columns.map(column => ({
      columnId: column.columnId,
      label: region.grid?.header?.showColumnLabels === false ? '' : column.label,
      x: column.x + column.w / 2,
      y: rect.y - columnBaselineOffset,
      fontSizePx: templateGridColumnFontSizePx(template),
    })),
    columnHeaderRect: { x: rect.x, y: rect.y - columnHeight, w: rect.w, h: columnHeight },
    columnBoundaries: [
      ...layout.columns.map(column => column.x),
      layout.columns.at(-1) ? layout.columns.at(-1)!.x + layout.columns.at(-1)!.w : rect.x + rect.w,
    ],
  }
}

function gridRowLineWeight(grid: Pick<SheetTemplateGrid, 'majorLineEvery' | 'rowLineRules'>, row: number): keyof typeof GRID_ROW_LINE_WEIGHT_ORDER {
  if (grid.rowLineRules?.length) {
    return grid.rowLineRules.reduce<keyof typeof GRID_ROW_LINE_WEIGHT_ORDER>((selected, rule) => {
      if (rule.every <= 0) return selected
      const offset = rule.offset ?? 0
      if ((row - offset) % rule.every !== 0) return selected
      return GRID_ROW_LINE_WEIGHT_ORDER[rule.weight] > GRID_ROW_LINE_WEIGHT_ORDER[selected] ? rule.weight : selected
    }, 'thin')
  }
  return row % (grid.majorLineEvery ?? 999) === 0 ? 'strong' : 'thin'
}

function gridRowLabelText(template: SheetTemplate, frames: { frameStart: number; rowCount: number }, row: number, rule: SheetTemplateGridRowLabelRule): string | null {
  if (rule.every <= 0) return null
  if (rule.skipRowZero && row === 0) return null
  const offset = rule.offset ?? 0
  if ((row - offset) % rule.every !== 0) return null
  if (rule.format === 'elapsed-seconds') {
    const boundaryFrame = frames.frameStart + row - 1
    return String(Math.floor((boundaryFrame - template.defaults.frameOrigin + 1) / rule.every))
  }
  return null
}

function buildActionFrameNumberRenderModels(
  template: SheetTemplate,
  grid: SheetTemplateGrid,
  layout: SheetGridLayout,
  pageFrameStart?: number,
): TemplateGridCounterRenderModel[] {
  const rightEdge = layout.columns.at(-1)
    ? layout.columns.at(-1)!.x + layout.columns.at(-1)!.w
    : layout.rect.x + layout.rect.w
  const x = rightEdge + 2 / layout.pageSize.widthPx
  const bottomInset = 1 / layout.pageSize.heightPx
  const fontSizePx = gridCounterFontSizePx(layout)
  const frameOffset = gridTimelineFrameOffset(template, grid, pageFrameStart)

  return Array.from({ length: layout.frames.rowCount }, (_, row) => {
    const frame = layout.frames.frameStart + frameOffset + row
    if (frame % 2 !== 0) return null
    return {
      key: `frame-${frame}-${row}`,
      text: String(frame),
      x,
      y: sheetGridRowY(layout, row + 1) - bottomInset,
      textAnchor: 'start',
      fontSizePx,
    }
  }).filter((item): item is TemplateGridCounterRenderModel => item !== null)
}

function buildSecondCounterRenderModels(
  template: SheetTemplate,
  grid: SheetTemplateGrid,
  layout: SheetGridLayout,
  options: TemplateGridOverlayOptions,
): TemplateGridCounterRenderModel[] {
  const leftEdge = layout.columns[0]?.x ?? layout.rect.x
  const x = leftEdge - 2 / layout.pageSize.widthPx
  const bottomInset = 1 / layout.pageSize.heightPx
  const fontSizePx = gridSecondCounterFontSizePx(layout)
  const frameOffset = gridTimelineFrameOffset(template, grid, options.pageFrameStart)
  const framesPerSecond = Math.max(1, Math.round(template.defaults.fps))

  return Array.from({ length: layout.frames.rowCount }, (_, row) => {
    const boundaryFrame = layout.frames.frameStart + frameOffset + row
    const cumulativeFrames = boundaryFrame - template.defaults.frameOrigin + 1
    if (cumulativeFrames <= 0 || cumulativeFrames % framesPerSecond !== 0) return null
    return {
      key: `second-${cumulativeFrames}-${row}`,
      text: String(cumulativeFrames / framesPerSecond),
      x,
      y: sheetGridRowY(layout, row + 1) - bottomInset,
      textAnchor: 'end',
      fontSizePx,
    }
  }).filter((item): item is TemplateGridCounterRenderModel => item !== null)
}

function buildBottomTrackLabelRenderModels(
  template: SheetTemplate,
  grid: SheetTemplateGrid,
  layout: SheetGridLayout,
): TemplateBottomTrackLabelRenderModel[] {
  const style = template.style?.bottomTrackLabels
  if (!template.page.isPhysical || !style?.visible || grid.trackProjection?.source !== 'logical-paper-tracks') {
    return []
  }

  if (layout.columns.length === 0) return []

  const pageSize = layout.pageSize
  const fontSizePx = layout.frames.rowHeightPx * 0.62
  const bottomInsetPx = Math.max(3, fontSizePx * 0.25)
  const gridBottom = layout.rect.y + layout.rect.h
  const labelY = Math.min(
    1 - bottomInsetPx / pageSize.heightPx,
    gridBottom + (fontSizePx + 2) / pageSize.heightPx,
  )
  return layout.columns.flatMap(column => {
    const text = (column.paperTrack ?? column.label).trim()
    return text
      ? [{
          key: `bottom-track-${column.columnId}`,
          text,
          x: column.x + column.w / 2,
          y: labelY,
          fontSizePx,
          opacity: 0.55,
        }]
      : []
  })
}

function gridCounterFontSizePx(layout: SheetGridLayout): number {
  return clampNumber(layout.frames.rowHeightPx * 0.4, 7, 9)
}

function gridSecondCounterFontSizePx(layout: SheetGridLayout): number {
  return layout.frames.rowHeightPx * 0.85
}

function gridTimelineFrameOffset(template: SheetTemplate, grid: SheetTemplateGrid, pageFrameStart?: number): number {
  return grid.frameProjection?.source === 'logical-frames'
    ? 0
    : (pageFrameStart ?? template.defaults.frameOrigin) - template.defaults.frameOrigin
}

function pointInNormalizedRectStroke(point: NormalizedPoint, rect: NormalizedRect, radius: NormalizedPoint): boolean {
  if (!pointInExpandedNormalizedRect(point, rect, radius)) return false
  const inner = {
    x: rect.x + radius.x,
    y: rect.y + radius.y,
    w: rect.w - radius.x * 2,
    h: rect.h - radius.y * 2,
  }
  if (inner.w <= 0 || inner.h <= 0) return true
  return !pointInExpandedNormalizedRect(point, inner, ZERO_RADIUS)
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function roundTemplateEditorPixelValue(value: number): number {
  return Math.round(value * 100) / 100
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
