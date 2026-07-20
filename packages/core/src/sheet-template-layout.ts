import type { PaperTrackName, SheetTimingRole, SheetViewLayoutOverrides } from './types'
import { NormalizedRect, SheetFrameAxisLayout, SheetHit, SheetPage, SheetTemplate, SheetTemplateColumn, SheetTemplateGrid, SheetTemplateGridColumnSize, SheetTemplateGridRole, SheetTemplateLayoutResolveOptions, SheetTemplatePageSize, SheetTemplateRegion, SheetTrackAxisLayout, SheetViewLayout, SheetViewSurfaceLayout } from './sheet-template-schema'

interface ResolvedHorizontalFlow {
  widthPx: number
  regions: Map<string, { xPx: number; widthPx: number }>
}

function resolveSheetTemplateHorizontalFlow(
  template: SheetTemplate,
  options: SheetTemplateLayoutResolveOptions,
): ResolvedHorizontalFlow | null {
  const flow = template.horizontalFlow
  if (!flow || flow.regionIds.length === 0) return null
  const regions = new Map<string, { xPx: number; widthPx: number }>()
  const gapPx = Math.max(0, flow.gapPx ?? 0)
  let cursorPx = Math.max(0, flow.leftPx)
  for (const regionId of flow.regionIds) {
    const region = template.regions.find(candidate => candidate.regionId === regionId)
    if (!region) continue
    const baseWidthPx = region.rect.w * template.page.widthPx
    const columns = region.grid
      ? resolveSheetTemplateGridColumns(template, region.grid, options.paperTracks, options.timelineLanes)
      : []
    const widthPx = region.grid
      ? gridFixedContentWidthPx(region.grid, columns, options.layoutOverrides?.grids?.[region.regionId]) ?? baseWidthPx
      : baseWidthPx
    regions.set(regionId, { xPx: cursorPx, widthPx })
    cursorPx += widthPx + gapPx
  }
  const contentRightPx = Math.max(flow.leftPx, cursorPx - gapPx)
  return {
    widthPx: Math.max(template.page.widthPx, Math.ceil(contentRightPx + Math.max(0, flow.rightPx))),
    regions,
  }
}

export function resolveSheetTemplatePageSize(
  template: SheetTemplate,
  durationFrames = template.defaults.durationFrames,
  options: SheetTemplateLayoutResolveOptions = {},
): SheetTemplatePageSize {
  const viewLayout = getSheetViewLayout(template)
  const baseSize = { widthPx: template.page.widthPx, heightPx: template.page.heightPx }
  if (viewLayout.surface?.type !== 'continuous-canvas') return baseSize

  let widthPx = template.page.widthPx
  let heightPx = template.page.heightPx
  const horizontalFlow = resolveSheetTemplateHorizontalFlow(template, options)
  if (horizontalFlow) widthPx = Math.max(widthPx, horizontalFlow.widthPx)
  for (const region of template.regions) {
    if (region.type !== 'exposure-grid' || !region.grid) continue
    const baseY = region.rect.y * template.page.heightPx
    const baseHeight = region.rect.h * template.page.heightPx
    const baseBottomMargin = Math.max(0, template.page.heightPx - (baseY + baseHeight))
    const frames = resolveSheetTemplateGridFrames(template, region.grid, durationFrames)
    const rowHeightPx = gridFixedRowHeightPx(region.grid, options.layoutOverrides?.grids?.[region.regionId])
    const projectedHeight = rowHeightPx
      ? rowHeightPx * frames.rowCount
      : baseHeight * logicalFrameScaleForGrid(region.grid, durationFrames)
    heightPx = Math.max(heightPx, Math.ceil(baseY + projectedHeight + baseBottomMargin))

    if (horizontalFlow?.regions.has(region.regionId)) continue
    const baseX = region.rect.x * template.page.widthPx
    const baseWidth = region.rect.w * template.page.widthPx
    const baseRightMargin = Math.max(0, template.page.widthPx - (baseX + baseWidth))
    const columns = resolveSheetTemplateGridColumns(template, region.grid, options.paperTracks, options.timelineLanes)
    const projectedWidth = gridFixedContentWidthPx(region.grid, columns, options.layoutOverrides?.grids?.[region.regionId]) ?? baseWidth
    widthPx = Math.max(widthPx, Math.ceil(baseX + projectedWidth + baseRightMargin))
  }

  return { ...baseSize, widthPx, heightPx }
}

export function resolveSheetTemplateRegionRect(
  template: SheetTemplate,
  region: SheetTemplateRegion,
  durationFrames = template.defaults.durationFrames,
  options: SheetTemplateLayoutResolveOptions = {},
): NormalizedRect {
  const pageSize = resolveSheetTemplatePageSize(template, durationFrames, options)
  if (!template.horizontalFlow && pageSize.widthPx === template.page.widthPx && pageSize.heightPx === template.page.heightPx) return region.rect

  const baseX = region.rect.x * template.page.widthPx
  const baseY = region.rect.y * template.page.heightPx
  const baseWidth = region.rect.w * template.page.widthPx
  const baseHeight = region.rect.h * template.page.heightPx
  const baseRightMargin = Math.max(0, template.page.widthPx - baseX - baseWidth)
  const columns = region.grid ? resolveSheetTemplateGridColumns(template, region.grid, options.paperTracks, options.timelineLanes) : []
  const width = region.grid
    ? gridFixedContentWidthPx(region.grid, columns, options.layoutOverrides?.grids?.[region.regionId]) ?? baseWidth
    : baseWidth
  const rowHeightPx = region.grid ? gridFixedRowHeightPx(region.grid, options.layoutOverrides?.grids?.[region.regionId]) : undefined
  const frames = region.grid ? resolveSheetTemplateGridFrames(template, region.grid, durationFrames) : undefined
  const height = rowHeightPx && frames
    ? rowHeightPx * frames.rowCount
    : region.grid?.frameProjection?.source === 'logical-frames'
      ? baseHeight * logicalFrameScaleForGrid(region.grid, durationFrames)
      : baseHeight

  const horizontalFlow = resolveSheetTemplateHorizontalFlow(template, options)
  const flowed = horizontalFlow?.regions.get(region.regionId)
  const resolvedWidth = region.horizontalSpan?.source === 'resolved-page-content'
    ? Math.max(0, pageSize.widthPx - baseX - baseRightMargin)
    : flowed?.widthPx ?? width
  return {
    x: (flowed?.xPx ?? baseX) / pageSize.widthPx,
    y: baseY / pageSize.heightPx,
    w: resolvedWidth / pageSize.widthPx,
    h: height / pageSize.heightPx,
  }
}

export function resolveSheetTemplateGridColumns(
  template: Pick<SheetTemplate, 'defaults' | 'viewLayout' | 'pageModel'>,
  grid: SheetTemplateGrid,
  paperTracks: PaperTrackName[] = template.defaults.paperTracks,
  timelineLanes: SheetTemplateLayoutResolveOptions['timelineLanes'] = {},
): SheetTemplateColumn[] {
  if (grid.trackProjection?.source === 'logical-timeline-lanes' && (grid.role === 'sound' || grid.role === 'camera')) {
    const lanes = [...(timelineLanes?.[grid.role] ?? [])].sort((left, right) => left.order - right.order)
    if (lanes.length === 0) return grid.columns
    const startIndex = Math.max(0, Math.floor(grid.trackProjection.startIndex ?? 0))
    const viewLayout = getSheetViewLayout(template)
    const columnCount = viewLayout.trackAxis?.type === 'logical-width'
      ? Math.max(grid.columns.length, Math.max(0, lanes.length - startIndex))
      : grid.columns.length
    return Array.from({ length: columnCount }, (_, index) => {
      const baseColumn = grid.columns[index]
      const lane = lanes[startIndex + index]
      return {
        ...baseColumn,
        columnId: baseColumn?.columnId ?? `${grid.role}_${safeIdFragment(lane?.laneId ?? '', index)}`,
        label: lane?.label ?? '',
        timelineLaneId: lane?.laneId,
        xdtsEligible: false,
      }
    })
  }
  if (!usesPaperTracks(grid.role) || grid.trackProjection?.source !== 'logical-paper-tracks') return grid.columns
  const tracks = normalizePaperTrackNames(paperTracks.length > 0 ? paperTracks : template.defaults.paperTracks)
  const startIndex = Math.max(0, Math.floor(grid.trackProjection.startIndex ?? 0))
  const viewLayout = getSheetViewLayout(template)
  const columnCount = viewLayout.trackAxis?.type === 'logical-width'
    ? Math.max(0, tracks.length - startIndex)
    : grid.columns.length
  return Array.from({ length: columnCount }, (_, index) => {
    const baseColumn = grid.columns[index]
    const paperTrack = tracks[startIndex + index]
    return {
      ...baseColumn,
      columnId: baseColumn?.columnId ?? `${grid.role}_${safeIdFragment(paperTrack ?? '', index)}`,
      label: paperTrack ?? '',
      paperTrack,
      xdtsEligible: paperTrack ? baseColumn?.xdtsEligible ?? grid.role === 'cell' : false,
    }
  })
}

export function resolveSheetTemplateGridFrames(
  template: Pick<SheetTemplate, 'defaults'>,
  grid: SheetTemplateGrid,
  durationFrames = template.defaults.durationFrames,
  frameOrigin = template.defaults.frameOrigin,
): { frameStart: number; frameEnd: number; rowCount: number } {
  if (grid.frameProjection?.source === 'logical-frames') {
    const frameStart = grid.frameProjection.startFrame ?? frameOrigin
    const rowCount = Math.max(1, Math.floor(durationFrames))
    return {
      frameStart,
      frameEnd: frameStart + rowCount - 1,
      rowCount,
    }
  }
  const frameStart = grid.frameStart ?? frameOrigin
  const rowCount = Math.max(1, Math.floor(grid.rowCount))
  return {
    frameStart,
    frameEnd: grid.frameEnd ?? frameStart + rowCount - 1,
    rowCount,
  }
}

export interface SheetGridLayoutColumn extends SheetTemplateColumn {
  index: number
  x: number
  w: number
  xPx: number
  widthPx: number
}

export interface SheetGridLayoutRows {
  frameStart: number
  frameEnd: number
  rowCount: number
  rowHeight: number
  rowHeightPx: number
}

export interface SheetGridLayout {
  regionId: string
  role: SheetTemplateGridRole
  rect: NormalizedRect
  pageSize: SheetTemplatePageSize
  columns: SheetGridLayoutColumn[]
  frames: SheetGridLayoutRows
}

export interface SheetGridLayoutOptions extends SheetTemplateLayoutResolveOptions {
  durationFrames?: number
  frameOrigin?: number
}

type SheetViewGridLayoutOverrideInput = NonNullable<SheetViewLayoutOverrides['grids']>[string]

export function resolveSheetTemplateGridLayout(
  template: SheetTemplate,
  region: SheetTemplateRegion,
  options: SheetGridLayoutOptions = {},
): SheetGridLayout | null {
  if (!region.grid) return null
  const durationFrames = options.durationFrames ?? template.defaults.durationFrames
  const frameOrigin = options.frameOrigin ?? template.defaults.frameOrigin
  const pageSize = resolveSheetTemplatePageSize(template, durationFrames, options)
  const rect = resolveSheetTemplateRegionRect(template, region, durationFrames, options)
  const columns = resolveSheetTemplateGridColumns(template, region.grid, options.paperTracks, options.timelineLanes)
  const frames = resolveSheetTemplateGridFrames(template, region.grid, durationFrames, frameOrigin)
  const columnWidthsPx = resolveGridColumnWidthsPx(region.grid, columns, rect.w * pageSize.widthPx, options.layoutOverrides?.grids?.[region.regionId])
  const rowHeightPx = resolveGridRowHeightPx(region.grid, frames.rowCount, rect.h * pageSize.heightPx, options.layoutOverrides?.grids?.[region.regionId])
  let cursorPx = rect.x * pageSize.widthPx
  return {
    regionId: region.regionId,
    role: region.grid.role,
    rect,
    pageSize,
    columns: columns.map((column, index) => {
      const widthPx = columnWidthsPx[index] ?? 0
      const item: SheetGridLayoutColumn = {
        ...column,
        index,
        x: cursorPx / pageSize.widthPx,
        w: widthPx / pageSize.widthPx,
        xPx: cursorPx,
        widthPx,
      }
      cursorPx += widthPx
      return item
    }),
    frames: {
      ...frames,
      rowHeight: rowHeightPx / pageSize.heightPx,
      rowHeightPx,
    },
  }
}

export function sheetGridColumnAt(layout: SheetGridLayout, x: number): SheetGridLayoutColumn | null {
  return layout.columns.find(column => x >= column.x && x <= column.x + column.w) ?? null
}

export function sheetGridColumnRect(layout: SheetGridLayout, columnIndex: number): NormalizedRect | null {
  const column = layout.columns[columnIndex]
  if (!column) return null
  return {
    x: column.x,
    y: layout.rect.y,
    w: column.w,
    h: layout.rect.h,
  }
}

export function sheetGridCellRect(layout: SheetGridLayout, columnIndex: number, rowIndex: number): NormalizedRect | null {
  const column = layout.columns[columnIndex]
  if (!column || rowIndex < 0 || rowIndex >= layout.frames.rowCount) return null
  return {
    x: column.x,
    y: layout.rect.y + layout.frames.rowHeight * rowIndex,
    w: column.w,
    h: layout.frames.rowHeight,
  }
}

export function sheetGridRowY(layout: SheetGridLayout, row: number): number {
  return layout.rect.y + layout.frames.rowHeight * row
}

export function getSheetTemplateVisiblePaperTracks(
  template: SheetTemplate,
  sheetRole: SheetTimingRole = 'cell',
  paperTracks: PaperTrackName[] = template.defaults.paperTracks,
): PaperTrackName[] {
  const visible: PaperTrackName[] = []
  const seen = new Set<string>()
  for (const region of template.regions) {
    if (region.type !== 'exposure-grid' || region.grid?.role !== sheetRole) continue
    for (const column of resolveSheetTemplateGridColumns(template, region.grid, paperTracks)) {
      if (!column.paperTrack || seen.has(column.paperTrack)) continue
      visible.push(column.paperTrack)
      seen.add(column.paperTrack)
    }
  }
  return visible
}

export function getSheetTemplateHiddenPaperTracks(
  template: SheetTemplate,
  sheetRole: SheetTimingRole = 'cell',
  paperTracks: PaperTrackName[] = template.defaults.paperTracks,
): PaperTrackName[] {
  const visible = new Set(getSheetTemplateVisiblePaperTracks(template, sheetRole, paperTracks))
  return normalizePaperTrackNames(paperTracks).filter(paperTrack => !visible.has(paperTrack))
}

export function hitTestSheetTemplate(
  template: SheetTemplate,
  point: { x: number; y: number },
  options: SheetGridLayoutOptions & { onlyXdtsEligible?: boolean; role?: SheetTemplateGrid['role'] } = {},
): SheetHit | null {
  for (const region of template.regions) {
    if (region.type !== 'exposure-grid' || !region.grid) continue
    if (options.role && region.grid.role !== options.role) continue
    const layout = resolveSheetTemplateGridLayout(template, region, options)
    if (!layout || !contains(layout.rect, point)) continue

    if (layout.columns.length === 0) return null
    const column = sheetGridColumnAt(layout, point.x)
    if (!column) return null
    const localY = (point.y - layout.rect.y) / layout.frames.rowHeight
    const rowIndex = clamp(Math.floor(localY), 0, layout.frames.rowCount - 1)
    if (options.onlyXdtsEligible && !column.xdtsEligible) return null

    return {
      regionId: region.regionId,
      role: region.grid.role,
      frame: layout.frames.frameStart + rowIndex,
      rowIndex,
      columnIndex: column.index,
      columnId: column.columnId,
      label: column.label,
      paperTrack: column.paperTrack,
    }
  }
  return null
}

export function cellRectForHit(
  template: SheetTemplate,
  hit: SheetHit,
  durationFrames = template.defaults.durationFrames,
  frameOrigin = template.defaults.frameOrigin,
  options: SheetTemplateLayoutResolveOptions = {},
): NormalizedRect | null {
  const region = template.regions.find(item => item.regionId === hit.regionId)
  if (!region?.grid) return null
  const layout = resolveSheetTemplateGridLayout(template, region, { ...options, durationFrames, frameOrigin })
  return layout ? sheetGridCellRect(layout, hit.columnIndex, hit.rowIndex) : null
}

export function getSheetViewLayout(template: Pick<SheetTemplate, 'viewLayout' | 'pageModel'>): SheetViewLayout {
  if (template.viewLayout) return normalizeSheetViewLayout(template.viewLayout)
  const pageModel = template.pageModel
  if (!pageModel) return normalizeSheetViewLayout({ type: 'paged', defaultViewMode: 'continuous' })
  if (pageModel.type === 'continuous' || pageModel.type === 'infinite') {
    return normalizeSheetViewLayout({
      type: pageModel.type,
      framesPerPage: pageModel.framesPerPage,
      defaultViewMode: pageModel.defaultViewMode,
    })
  }
  return normalizeSheetViewLayout({
    type: 'paged',
    framesPerPage: pageModel.framesPerPage,
    defaultViewMode: pageModel.defaultViewMode,
  })
}

function normalizeSheetViewLayout(layout: SheetViewLayout): SheetViewLayout {
  const frameAxis = layout.frameAxis ?? defaultFrameAxisLayout(layout)
  const trackAxis = layout.trackAxis ?? defaultTrackAxisLayout(layout)
  const surface = layout.surface ?? defaultViewSurfaceLayout(layout)
  return {
    ...layout,
    framesPerPage: layout.framesPerPage ?? frameAxis.framesPerPage,
    frameAxis,
    trackAxis,
    surface,
  }
}

function defaultFrameAxisLayout(layout: Pick<SheetViewLayout, 'type' | 'framesPerPage'>): SheetFrameAxisLayout {
  if (layout.type === 'continuous') return { type: 'continuous', overflow: 'scroll' }
  if (layout.type === 'infinite') return { type: 'infinite', overflow: 'scroll' }
  return { type: 'paged', framesPerPage: layout.framesPerPage, overflow: 'paginate' }
}

function defaultTrackAxisLayout(layout: Pick<SheetViewLayout, 'type'>): SheetTrackAxisLayout {
  return layout.type === 'infinite'
    ? { type: 'logical-width', overflow: 'scroll' }
    : { type: 'fixed-slots', overflow: 'hidden' }
}

function defaultViewSurfaceLayout(layout: Pick<SheetViewLayout, 'type'>): SheetViewSurfaceLayout {
  return layout.type === 'infinite'
    ? { type: 'continuous-canvas' }
    : { type: 'fixed-page' }
}

export function getTemplateFramesPerPage(template: SheetTemplate): number {
  const viewLayout = getSheetViewLayout(template)
  if (viewLayout.frameAxis?.framesPerPage && viewLayout.frameAxis.framesPerPage > 0) {
    return viewLayout.frameAxis.framesPerPage
  }
  const regionMax = Math.max(
    0,
    ...template.regions.flatMap(region => {
      if (region.type !== 'exposure-grid' || region.grid?.role !== 'cell') return []
      const start = region.grid.frameStart ?? template.defaults.frameOrigin
      return [region.grid.frameEnd ?? start + region.grid.rowCount - 1]
    }),
  )
  return Math.max(1, regionMax || template.defaults.durationFrames)
}

export function createSheetPages(template: SheetTemplate, durationFrames: number, frameOrigin = template.defaults.frameOrigin): SheetPage[] {
  const viewLayout = getSheetViewLayout(template)
  if (viewLayout.frameAxis?.type === 'continuous' || viewLayout.frameAxis?.type === 'infinite') {
    return [{
      pageId: 'page_1',
      pageIndex: 0,
      frameStart: frameOrigin,
      frameEnd: frameOrigin + Math.max(1, durationFrames) - 1,
    }]
  }
  const framesPerPage = getTemplateFramesPerPage(template)
  const pageCount = Math.max(1, Math.ceil(Math.max(1, durationFrames) / framesPerPage))
  return Array.from({ length: pageCount }, (_, pageIndex) => {
    const frameStart = frameOrigin + pageIndex * framesPerPage
    const absoluteEnd = frameOrigin + Math.max(1, durationFrames) - 1
    return {
      pageId: `page_${pageIndex + 1}`,
      pageIndex,
      frameStart,
      frameEnd: Math.min(frameStart + framesPerPage - 1, absoluteEnd),
    }
  })
}

export function localizeFrameToSheetPage(
  template: SheetTemplate,
  frame: number,
  durationFrames = template.defaults.durationFrames,
  frameOrigin = template.defaults.frameOrigin,
): { page: SheetPage; localFrame: number } | null {
  if (durationFrames < 1) return null
  const absoluteEnd = frameOrigin + durationFrames - 1
  if (frame < frameOrigin || frame > absoluteEnd) return null
  const viewLayout = getSheetViewLayout(template)
  if (viewLayout.frameAxis?.type === 'continuous' || viewLayout.frameAxis?.type === 'infinite') {
    const [page] = createSheetPages(template, durationFrames, frameOrigin)
    return page ? { page, localFrame: frame } : null
  }
  const framesPerPage = getTemplateFramesPerPage(template)
  const pageIndex = Math.floor((frame - frameOrigin) / framesPerPage)
  const pages = createSheetPages(template, durationFrames, frameOrigin)
  const page = pages[pageIndex]
  if (!page) return null
  return { page, localFrame: frame - page.frameStart + template.defaults.frameOrigin }
}

export function cellHitForFrame(
  template: SheetTemplate,
  paperTrack: PaperTrackName,
  frame: number,
  durationFrames = template.defaults.durationFrames,
  frameOrigin = template.defaults.frameOrigin,
  paperTracks: PaperTrackName[] = template.defaults.paperTracks,
): SheetHit | null {
  return timingHitForFrame(template, 'cell', paperTrack, frame, durationFrames, frameOrigin, paperTracks)
}

export function timingHitForFrame(
  template: SheetTemplate,
  sheetRole: SheetTimingRole,
  paperTrack: PaperTrackName,
  frame: number,
  durationFrames = template.defaults.durationFrames,
  frameOrigin = template.defaults.frameOrigin,
  paperTracks: PaperTrackName[] = template.defaults.paperTracks,
): SheetHit | null {
  const localized = localizeFrameToSheetPage(template, frame, durationFrames, frameOrigin)
  if (!localized) return null

  for (const region of template.regions) {
    if (region.type !== 'exposure-grid' || region.grid?.role !== sheetRole) continue
    const frames = resolveSheetTemplateGridFrames(template, region.grid, durationFrames, frameOrigin)
    if (localized.localFrame < frames.frameStart || localized.localFrame > frames.frameEnd) continue
    const columns = resolveSheetTemplateGridColumns(template, region.grid, paperTracks)
    const columnIndex = columns.findIndex(column => column.paperTrack === paperTrack)
    if (columnIndex < 0) continue
    const column = columns[columnIndex]
    return {
      regionId: region.regionId,
      role: sheetRole,
      frame,
      localFrame: localized.localFrame,
      rowIndex: localized.localFrame - frames.frameStart,
      columnIndex,
      columnId: column.columnId,
      label: column.label,
      paperTrack,
      pageId: localized.page.pageId,
      pageIndex: localized.page.pageIndex,
    }
  }
  return null
}

export function globalizeSheetHit(template: SheetTemplate, hit: SheetHit, page: SheetPage): SheetHit {
  const localFrame = hit.localFrame ?? hit.frame
  return {
    ...hit,
    frame: page.frameStart + (localFrame - template.defaults.frameOrigin),
    localFrame,
    pageId: page.pageId,
    pageIndex: page.pageIndex,
  }
}

export function alphabeticTrackLabel(index: number): string {
  let value = index
  let label = ''
  do {
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return label
}

export function createAlphabeticTrackLabels(count: number, startIndex = 0): PaperTrackName[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, index) => alphabeticTrackLabel(startIndex + index))
}

export function getSheetTemplatePaperTracks(template: Pick<SheetTemplate, 'defaults' | 'regions'>): PaperTrackName[] {
  const tracks: PaperTrackName[] = []
  const seen = new Set<string>()
  for (const region of template.regions) {
    if (region.type !== 'exposure-grid' || region.grid?.role !== 'cell') continue
    if (region.grid.trackProjection?.source === 'logical-paper-tracks') {
      for (const paperTrack of normalizePaperTrackNames(template.defaults.paperTracks)) {
        if (seen.has(paperTrack)) continue
        tracks.push(paperTrack)
        seen.add(paperTrack)
      }
      continue
    }
    for (const column of region.grid.columns) {
      if (!column.xdtsEligible || !column.paperTrack || seen.has(column.paperTrack)) continue
      tracks.push(column.paperTrack)
      seen.add(column.paperTrack)
    }
  }
  return tracks.length > 0 ? tracks : normalizePaperTrackNames(template.defaults.paperTracks)
}

export function withSheetTemplatePaperTracks(template: SheetTemplate, labels: PaperTrackName[]): SheetTemplate {
  const paperTracks = normalizePaperTrackNames(labels)
  const sharesAllDigitalPaperTracks = template.templateKind === 'digital-native'
  return {
    ...template,
    defaults: {
      ...template.defaults,
      paperTracks,
    },
    regions: template.regions.map(region => {
      if (region.type !== 'exposure-grid' || !region.grid || !usesPaperTracks(region.grid.role)) return region
      if (sharesAllDigitalPaperTracks) {
        return {
          ...region,
          grid: {
            ...region.grid,
            trackProjection: { source: 'logical-paper-tracks', startIndex: 0, overflow: 'scroll' },
            columns: createPaperTrackColumns(region.grid.role, paperTracks, region.grid.columns),
          },
        }
      }
      if (region.grid.trackProjection?.source === 'logical-paper-tracks') return region
      return {
        ...region,
        grid: {
          ...region.grid,
          columns: createPaperTrackColumns(region.grid.role, paperTracks, region.grid.columns),
        },
      }
    }),
  }
}

export function createPaperTrackColumns(
  role: Extract<SheetTemplateGrid['role'], 'action' | 'cell'>,
  paperTracks: PaperTrackName[],
  existing: SheetTemplateColumn[] = [],
): SheetTemplateColumn[] {
  return normalizePaperTrackNames(paperTracks).map((paperTrack, index) => ({
    columnId: existing[index]?.columnId ?? `${role}_${safeIdFragment(paperTrack, index)}`,
    label: paperTrack,
    paperTrack,
    xdtsEligible: role === 'cell',
  }))
}

function resolveGridColumnWidthsPx(
  grid: SheetTemplateGrid,
  columns: SheetTemplateColumn[],
  regionWidthPx: number,
  override?: SheetViewGridLayoutOverrideInput,
): number[] {
  if (columns.length === 0) return []
  const hasSizing = Boolean(
    grid.columnSizing
    || override?.columnWidthsPx
    || columns.some(column => columnSizeForColumn(grid, column)),
  )
  if (!hasSizing) {
    const width = regionWidthPx / columns.length
    return columns.map(() => width)
  }

  const fallbackWeight = 1
  const defaultWidth = grid.columnSizing?.defaultWidthPx
  const minWidth = Math.max(1, grid.columnSizing?.minWidthPx ?? 1)
  const maxWidth = grid.columnSizing?.maxWidthPx
  const specs = columns.map(column => {
    const size = columnSizeForColumn(grid, column)
    const overrideWidth = columnWidthOverridePx(override, column)
    const widthPx = clampOptionalWidth(overrideWidth ?? size?.widthPx ?? defaultWidth, size?.minWidthPx ?? minWidth, size?.maxWidthPx ?? maxWidth)
    return {
      widthPx,
      weight: Math.max(0.01, size?.weight ?? fallbackWeight),
      minWidthPx: size?.minWidthPx ?? minWidth,
      maxWidthPx: size?.maxWidthPx ?? maxWidth,
    }
  })
  const fixedTotal = specs.reduce((total, spec) => total + (spec.widthPx ?? 0), 0)
  const flexibleSpecs = specs.filter(spec => spec.widthPx === undefined)
  const flexibleWeightTotal = flexibleSpecs.reduce((total, spec) => total + spec.weight, 0)
  const remaining = Math.max(0, regionWidthPx - fixedTotal)
  let widths = specs.map(spec => {
    if (spec.widthPx !== undefined) return spec.widthPx
    const raw = flexibleWeightTotal > 0 ? (remaining * spec.weight) / flexibleWeightTotal : remaining / Math.max(1, flexibleSpecs.length)
    return clampWidth(raw, spec.minWidthPx, spec.maxWidthPx)
  })

  if (grid.columnSizing?.mode !== 'fixed-content') {
    const total = widths.reduce((sum, width) => sum + width, 0)
    if (total > 0 && regionWidthPx > 0) {
      const scale = regionWidthPx / total
      widths = widths.map(width => width * scale)
    }
  }
  return widths
}

function resolveGridRowHeightPx(
  grid: SheetTemplateGrid,
  rowCount: number,
  regionHeightPx: number,
  override?: SheetViewGridLayoutOverrideInput,
): number {
  const fixedRowHeight = gridFixedRowHeightPx(grid, override)
  if (fixedRowHeight) return fixedRowHeight
  return regionHeightPx / Math.max(1, rowCount)
}

function gridFixedRowHeightPx(
  grid: SheetTemplateGrid,
  override?: SheetViewGridLayoutOverrideInput,
): number | undefined {
  const raw = override?.rowHeightPx ?? grid.rowSizing?.rowHeightPx
  if (raw === undefined || (grid.rowSizing?.mode ?? 'fit-region') !== 'fixed-height') return undefined
  return clampWidth(raw, grid.rowSizing?.minRowHeightPx ?? 1, grid.rowSizing?.maxRowHeightPx)
}

function gridFixedContentWidthPx(
  grid: SheetTemplateGrid,
  columns: SheetTemplateColumn[],
  override?: SheetViewGridLayoutOverrideInput,
): number | undefined {
  if ((grid.columnSizing?.mode ?? 'fit-region') !== 'fixed-content' && !override?.columnWidthsPx) return undefined
  const explicitWidths = columns.map(column => {
    const size = columnSizeForColumn(grid, column)
    return columnWidthOverridePx(override, column) ?? size?.widthPx ?? grid.columnSizing?.defaultWidthPx
  })
  if (explicitWidths.every(width => width === undefined)) return undefined
  const minWidth = Math.max(1, grid.columnSizing?.minWidthPx ?? 1)
  return explicitWidths.reduce<number>((total, width, index) => {
    const size = columnSizeForColumn(grid, columns[index]!)
    return total + clampOptionalWidth(width ?? minWidth, size?.minWidthPx ?? minWidth, size?.maxWidthPx ?? grid.columnSizing?.maxWidthPx)!
  }, 0)
}

function columnSizeForColumn(grid: SheetTemplateGrid, column: SheetTemplateColumn): SheetTemplateGridColumnSize | undefined {
  const sizes = grid.columnSizing?.columns
  if (!sizes) return undefined
  return sizes[column.columnId] ?? (column.paperTrack ? sizes[column.paperTrack] : undefined) ?? sizes[column.label]
}

function columnWidthOverridePx(
  override: SheetViewGridLayoutOverrideInput | undefined,
  column: SheetTemplateColumn,
): number | undefined {
  const widths = override?.columnWidthsPx
  if (!widths) return undefined
  return widths[column.columnId] ?? (column.paperTrack ? widths[column.paperTrack] : undefined) ?? widths[column.label]
}

function clampOptionalWidth(value: number | undefined, min: number, max?: number): number | undefined {
  return value === undefined ? undefined : clampWidth(value, min, max)
}

function clampWidth(value: number, min: number, max?: number): number {
  const safeValue = Number.isFinite(value) ? value : min
  return Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, safeValue))
}

function contains(rect: NormalizedRect, point: { x: number; y: number }): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function usesPaperTracks(role: SheetTemplateGrid['role']): role is Extract<SheetTemplateGrid['role'], 'action' | 'cell'> {
  return role === 'action' || role === 'cell'
}

function logicalFrameScaleForGrid(grid: SheetTemplateGrid, durationFrames: number): number {
  if (grid.frameProjection?.source !== 'logical-frames') return 1
  return Math.max(1, Math.max(1, Math.floor(durationFrames)) / Math.max(1, Math.floor(grid.rowCount)))
}

function normalizePaperTrackNames(labels: PaperTrackName[]): PaperTrackName[] {
  const seen = new Set<string>()
  const normalized: PaperTrackName[] = []
  for (const label of labels) {
    const trimmed = label.trim()
    if (!trimmed || seen.has(trimmed)) continue
    normalized.push(trimmed)
    seen.add(trimmed)
  }
  return normalized
}

function safeIdFragment(value: string, index: number): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, '_') || `track_${index + 1}`
}
