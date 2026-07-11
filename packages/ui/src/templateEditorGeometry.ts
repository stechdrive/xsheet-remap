import {
  resolveSheetTemplateGridLayout,
  resolveSheetTemplateRegionRect,
  sheetGridRowY,
  type NormalizedPoint,
  type NormalizedRect,
  type SheetGridLayout,
  type SheetGridLayoutOptions,
  type SheetTemplate,
  type SheetTemplateGrid,
  type SheetTemplateGridRole,
  type SheetTemplateGridRowLabelRule,
} from '@xsheet-remap/core'
import {
  STANDARD_A3_GRID_HEADER_HEIGHT,
  STANDARD_A3_GRID_HEADER_TOP_OFFSET,
} from './sheetConstants'
import { calibrationTargetRectForTemplate } from './sheetImages'
import { gridRoleLabel } from './templateEditing'

export type TemplateGridHeaderColumnRenderModel = {
  columnId: string
  label: string
  x: number
  y: number
  fontSize: number
}

export type TemplateGridHeaderRenderModel = {
  regionId: string
  rect: NormalizedRect
  label: string
  labelX: number
  labelY: number
  labelFontSize: number
  columns: TemplateGridHeaderColumnRenderModel[]
}

export type TemplateReferenceRegionRenderModel = {
  regionId: string
  type: string
  rect: NormalizedRect
}

export type TemplateChromeRenderModel = {
  showOuterFrame: boolean
  referenceRegions: TemplateReferenceRegionRenderModel[]
  headers: TemplateGridHeaderRenderModel[]
}

export type TemplateGridPathRenderModel = {
  className: string
  d: string
  segments: TemplateGridLineSegment[]
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
  fontSize: number
}

export type TemplateGridCounterRenderModel = {
  key: string
  text: string
  x: number
  y: number
  textAnchor: 'start' | 'end'
  fontSize: number
}

export type TemplateGridOverlayRenderModel = {
  regionId: string
  role: SheetTemplateGridRole
  rowPaths: TemplateGridPathRenderModel[]
  columnPath: TemplateGridPathRenderModel | null
  labels: TemplateGridRowLabelRenderModel[]
  frameNumbers: TemplateGridCounterRenderModel[]
  secondCounters: TemplateGridCounterRenderModel[]
}

export interface TemplateGridOverlayOptions extends SheetGridLayoutOptions {
  pageFrameStart?: number
  timelineFrameOrigin?: number
}

export type TemplateEditorRenderModel = {
  chrome: TemplateChromeRenderModel
  gridOverlays: TemplateGridOverlayRenderModel[]
  calibrationTargetRect: NormalizedRect | null
}

export type TemplateEditorTarget =
  | { kind: 'region'; regionId: string }
  | { kind: 'calibration-target' }

export type TemplateEditorRectKey = 'x' | 'y' | 'w' | 'h'

const TEMPLATE_GRID_HEADER_ROLE_ORDER: SheetTemplateGridRole[] = ['action', 'sound', 'cell', 'camera', 'frame-guide', 'count-table', 'other']

const GRID_ROW_LINE_WEIGHT_ORDER = {
  thin: 0,
  regular: 1,
  medium: 2,
  strong: 3,
} as const

const ZERO_RADIUS: NormalizedPoint = { x: 0, y: 0 }

export function buildTemplateEditorRenderModel(template: SheetTemplate): TemplateEditorRenderModel {
  return {
    chrome: buildTemplateChromeRenderModel(template),
    gridOverlays: template.regions
      .filter(region => region.type === 'exposure-grid')
      .map(region => buildTemplateGridOverlayRenderModel(template, region))
      .filter((model): model is TemplateGridOverlayRenderModel => model !== null),
    calibrationTargetRect: calibrationTargetRectForTemplate(template),
  }
}

export function buildTemplateChromeRenderModel(
  template: SheetTemplate,
  paperTracks = template.defaults.paperTracks,
  durationFrames = template.defaults.durationFrames,
): TemplateChromeRenderModel {
  return {
    showOuterFrame: template.templateKind !== 'digital-native',
    referenceRegions: template.regions
      .filter(region => region.type !== 'exposure-grid' && region.type !== 'metadata-field' && region.usage !== 'ignored')
      .map(region => ({
        regionId: region.regionId,
        type: region.type,
        rect: resolveSheetTemplateRegionRect(template, region, durationFrames),
      })),
    headers: template.regions
      .filter(region => region.type === 'exposure-grid' && region.grid)
      .map(region => buildTemplateGridHeaderRenderModel(template, region, paperTracks, durationFrames))
      .filter((model): model is TemplateGridHeaderRenderModel => model !== null),
  }
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
  return labelOverrides && role in labelOverrides
    ? labelOverrides[role] ?? ''
    : gridRoleLabel(role)
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
  if (region.grid.role === 'sound' && template.templateKind !== 'digital-native') return null
  const layout = resolveSheetTemplateGridLayout(template, region, options)
  if (!layout) return null
  const rect = layout.rect
  const pageSize = layout.pageSize
  const frames = layout.frames
  const rowPaths = new Map<string, TemplateGridLineSegment[]>()
  const renderHorizontalLines = !(template.templateKind === 'digital-native' && region.grid.role === 'sound')
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
  const columnPath = columnLines.length > 0
    ? {
        className: 'gridLine gridLineColumn',
        d: columnLines.map(x => `M ${x} ${rect.y} V ${rect.y + rect.h}`).join(' '),
        segments: columnLines.map(x => ({ x1: x, y1: rect.y, x2: x, y2: rect.y + rect.h })),
      }
    : null
  const labels = region.grid.rowLabelRules?.flatMap((rule, ruleIndex) => {
    const xOffset = (rule.xOffsetPx ?? 6) / pageSize.widthPx
    const yOffset = (rule.yOffsetPx ?? 0) / pageSize.heightPx
    const fontSize = (rule.fontSizePx ?? 20) / pageSize.heightPx
    const minY = rect.y + fontSize
    const maxY = rect.y + rect.h - fontSize * 0.25
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
        fontSize,
      }
    })
  }).filter((label): label is TemplateGridRowLabelRenderModel => label !== null) ?? []
  const frameNumbers = region.grid.role === 'action'
    ? buildActionFrameNumberRenderModels(template, region.grid, layout, options.pageFrameStart)
    : []
  const secondCounters = region.grid.role === 'cell' && template.style?.secondCounter?.visible
    ? buildSecondCounterRenderModels(template, region.grid, layout, options)
    : []
  return {
    regionId: region.regionId,
    role: region.grid.role,
    rowPaths: Array.from(rowPaths, ([className, segments]) => ({
      className,
      d: segments.map(segment => `M ${segment.x1} ${segment.y1} H ${segment.x2}`).join(' '),
      segments,
    })),
    columnPath,
    labels,
    frameNumbers,
    secondCounters,
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
): TemplateGridHeaderRenderModel | null {
  if (!region.grid) return null
  const layout = resolveSheetTemplateGridLayout(template, region, { paperTracks, durationFrames })
  if (!layout) return null
  const rect = layout.rect
  const pageSize = layout.pageSize
  const headerTopOffset = (STANDARD_A3_GRID_HEADER_TOP_OFFSET * template.page.heightPx) / pageSize.heightPx
  const headerHeight = (STANDARD_A3_GRID_HEADER_HEIGHT * template.page.heightPx) / pageSize.heightPx
  const y = rect.y - headerTopOffset
  const columnBaselineOffset = (0.0025 * template.page.heightPx) / pageSize.heightPx
  return {
    regionId: region.regionId,
    rect: { x: rect.x, y, w: rect.w, h: headerHeight },
    label: gridHeaderLabelForRole(template, region.grid.role),
    labelX: rect.x + rect.w / 2,
    labelY: y + headerHeight / 2,
    labelFontSize: templateGridHeaderFontSizePx(template) / pageSize.heightPx,
    columns: layout.columns.map(column => ({
      columnId: column.columnId,
      label: column.label,
      x: column.x + column.w / 2,
      y: rect.y - columnBaselineOffset,
      fontSize: templateGridColumnFontSizePx(template) / pageSize.heightPx,
    })),
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
      fontSize: fontSizePx / layout.pageSize.heightPx,
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
  const fontSizePx = gridCounterFontSizePx(layout)
  const frameOffset = gridTimelineFrameOffset(template, grid, options.pageFrameStart)
  const timelineFrameOrigin = options.timelineFrameOrigin ?? template.defaults.frameOrigin
  const framesPerSecond = Math.max(1, Math.round(template.defaults.fps))

  return Array.from({ length: layout.frames.rowCount }, (_, row) => {
    const boundaryFrame = layout.frames.frameStart + frameOffset + row
    const elapsedFrames = boundaryFrame - timelineFrameOrigin + 1
    if (elapsedFrames <= 0 || elapsedFrames % framesPerSecond !== 0) return null
    return {
      key: `second-${elapsedFrames}-${row}`,
      text: String(elapsedFrames / framesPerSecond),
      x,
      y: sheetGridRowY(layout, row + 1) - bottomInset,
      textAnchor: 'end',
      fontSize: fontSizePx / layout.pageSize.heightPx,
    }
  }).filter((item): item is TemplateGridCounterRenderModel => item !== null)
}

function gridCounterFontSizePx(layout: SheetGridLayout): number {
  return clampNumber(layout.frames.rowHeightPx * 0.4, 7, 9)
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
