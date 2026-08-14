import {
  createPaperTrackColumns,
  type NormalizedRect,
  type SheetTemplate,
  type SheetTemplateRegion,
} from '@xsheet-remap/core'
import { buildTemplateColumns, resizePaperTrackLabels, type TemplateGridRole } from './templateEditing'

export const PAPER_TIMELINE_TARGET_ID = '__paper_timeline__'
export const PAPER_TIMELINE_ROWS_PER_BLOCK = 72
export const PAPER_TIMELINE_BLOCK_COUNT = 2

export type PaperTimelineRole = 'action' | 'sound' | 'cell' | 'camera'
export type PaperTimelineSide = 'left' | 'right'
export type PaperTimelineStatus = 'compatible' | 'misaligned' | 'incomplete'

export interface PaperTimelineRolePair {
  leftRegionId: string
  rightRegionId: string
}

export interface PaperTimelineStructure {
  status: PaperTimelineStatus
  frameOrigin: number
  roles: Record<PaperTimelineRole, PaperTimelineRolePair>
  requiredRegionIds: readonly string[]
  auxiliaryRegionIds: readonly string[]
  managedRegionIds: ReadonlySet<string>
  outerRegionId: string | null
  rect: NormalizedRect
  gridRect: NormalizedRect
  leftRect: NormalizedRect
  rightRect: NormalizedRect
  rowTopPx: number | null
  rowBottomPx: number | null
  missingLabels: readonly string[]
}

export type PaperTimelineAlignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom'

const PAPER_TIMELINE_ROLES: readonly PaperTimelineRole[] = ['action', 'sound', 'cell', 'camera']
const MIN_REGION_WIDTH_PX = 8

export function isPaperTemplateForAuthoring(template: SheetTemplate): boolean {
  return template.templateKind !== 'digital-native'
    && template.layoutMode !== 'infinite-digital'
    && (template.page.isPhysical === true || template.templateKind?.includes('paper') === true)
}

export function editablePaperTimelineStructure(template: SheetTemplate): PaperTimelineStructure | null {
  const structure = detectPaperTimelineStructure(template)
  return structure?.status === 'incomplete' ? null : structure
}

export function detectPaperTimelineStructure(template: SheetTemplate): PaperTimelineStructure | null {
  if (!isPaperTemplateForAuthoring(template)) return null
  const frameOrigin = template.defaults.frameOrigin
  const leftStart = frameOrigin
  const rightStart = frameOrigin + PAPER_TIMELINE_ROWS_PER_BLOCK
  const roles = {} as Record<PaperTimelineRole, PaperTimelineRolePair>
  const requiredRegions: SheetTemplateRegion[] = []
  const missingLabels: string[] = []

  for (const role of PAPER_TIMELINE_ROLES) {
    const left = findTimelineRegion(template, role, leftStart)
    const right = findTimelineRegion(template, role, rightStart)
    if (!left) missingLabels.push(`${roleLabel(role)} 左3秒`)
    if (!right) missingLabels.push(`${roleLabel(role)} 右3秒`)
    if (!left || !right) continue
    roles[role] = { leftRegionId: left.regionId, rightRegionId: right.regionId }
    requiredRegions.push(left, right)
  }

  const fallbackRect = requiredRegions.length > 0
    ? rectBounds(requiredRegions.map(region => region.rect))
    : { x: 0, y: 0, w: 1, h: 1 }
  if (missingLabels.length > 0) {
    const existingIds = requiredRegions.map(region => region.regionId)
    return {
      status: 'incomplete',
      frameOrigin,
      roles,
      requiredRegionIds: existingIds,
      auxiliaryRegionIds: [],
      managedRegionIds: new Set(existingIds),
      outerRegionId: null,
      rect: fallbackRect,
      gridRect: fallbackRect,
      leftRect: fallbackRect,
      rightRect: fallbackRect,
      rowTopPx: null,
      rowBottomPx: null,
      missingLabels,
    }
  }

  const auxiliaryRegions = template.regions.filter(region => isPaperTimelineAuxiliaryRegion(region, leftStart, rightStart))
  const gridRegions = [...requiredRegions, ...auxiliaryRegions]
  const gridRect = rectBounds(gridRegions.map(region => region.rect))
  const outerRegion = smallestContainingOuterRegion(template, gridRect, new Set(gridRegions.map(region => region.regionId)))
  const managedIds = new Set(gridRegions.map(region => region.regionId))
  if (outerRegion) managedIds.add(outerRegion.regionId)
  const leftRegions = gridRegions.filter(region => region.grid?.frameStart === leftStart)
  const rightRegions = gridRegions.filter(region => region.grid?.frameStart === rightStart)
  const rowEdges = requiredRegions.map(region => pixelVerticalEdges(region.rect, template.page.heightPx))
  const rowTopPx = rowEdges[0]?.top ?? null
  const rowBottomPx = rowEdges[0]?.bottom ?? null
  const aligned = rowTopPx !== null && rowBottomPx !== null
    && rowEdges.every(edges => edges.top === rowTopPx && edges.bottom === rowBottomPx)

  return {
    status: aligned ? 'compatible' : 'misaligned',
    frameOrigin,
    roles,
    requiredRegionIds: requiredRegions.map(region => region.regionId),
    auxiliaryRegionIds: auxiliaryRegions.map(region => region.regionId),
    managedRegionIds: managedIds,
    outerRegionId: outerRegion?.regionId ?? null,
    rect: outerRegion?.rect ?? gridRect,
    gridRect,
    leftRect: rectBounds(leftRegions.map(region => region.rect)),
    rightRect: rectBounds(rightRegions.map(region => region.rect)),
    rowTopPx,
    rowBottomPx,
    missingLabels,
  }
}

export function transformPaperTimelineRect(
  template: SheetTemplate,
  structure: PaperTimelineStructure,
  requestedRect: NormalizedRect,
): SheetTemplate {
  if (structure.status === 'incomplete') return template
  const source = structure.rect
  const target = clampRectToPage(requestedRect, template)
  if (source.w <= 0 || source.h <= 0) return template
  if (sameRectInPagePixels(source, target, template)) return template
  const scaleX = target.w / source.w
  const scaleY = target.h / source.h
  const transformRect = (rect: NormalizedRect): NormalizedRect => quantizeRect({
    x: target.x + (rect.x - source.x) * scaleX,
    y: target.y + (rect.y - source.y) * scaleY,
    w: rect.w * scaleX,
    h: rect.h * scaleY,
  }, template)
  const calibrationMatchesTable = Boolean(template.calibration?.targetRect
    && sameRectInPagePixels(template.calibration.targetRect, source, template))

  return {
    ...template,
    regions: template.regions.map(region => structure.managedRegionIds.has(region.regionId)
      ? { ...region, rect: transformRect(region.rect) }
      : region),
    calibration: calibrationMatchesTable
      ? { ...(template.calibration ?? {}), targetRect: transformRect(template.calibration!.targetRect!) }
      : template.calibration,
  }
}

export function normalizePaperTimelineRows(
  template: SheetTemplate,
  structure: PaperTimelineStructure,
): SheetTemplate {
  if (structure.status === 'incomplete') return template
  const canonical = regionFor(template, structure.roles.action.leftRegionId)
  if (!canonical) return template
  const rowRegionIds = new Set([...structure.requiredRegionIds, ...structure.auxiliaryRegionIds])
  const y = quantizeY(canonical.rect.y, template)
  const bottom = quantizeY(canonical.rect.y + canonical.rect.h, template)
  return {
    ...template,
    regions: template.regions.map(region => rowRegionIds.has(region.regionId)
      ? { ...region, rect: { ...region.rect, y, h: bottom - y } }
      : region),
  }
}

export function setPaperTimelineGapPx(
  template: SheetTemplate,
  structure: PaperTimelineStructure,
  requestedGapPx: number,
): SheetTemplate {
  if (structure.status === 'incomplete') return template
  const pageWidth = Math.max(1, template.page.widthPx)
  const currentGapPx = (structure.rightRect.x - (structure.leftRect.x + structure.leftRect.w)) * pageWidth
  const requestedDeltaPx = Math.round(requestedGapPx - currentGapPx)
  const tableRightPx = (structure.rect.x + structure.rect.w) * pageWidth
  const minimumDeltaPx = -Math.max(0, Math.round(currentGapPx))
  const maximumDeltaPx = Math.max(0, Math.floor(pageWidth - tableRightPx))
  const deltaPx = clamp(requestedDeltaPx, minimumDeltaPx, maximumDeltaPx)
  if (deltaPx === 0) return template
  const delta = deltaPx / pageWidth
  const rightStart = structure.frameOrigin + PAPER_TIMELINE_ROWS_PER_BLOCK
  const rightIds = new Set(template.regions
    .filter(region => structure.managedRegionIds.has(region.regionId) && region.grid?.frameStart === rightStart)
    .map(region => region.regionId))
  const calibrationMatchesTable = Boolean(template.calibration?.targetRect
    && sameRectInPagePixels(template.calibration.targetRect, structure.rect, template))

  return {
    ...template,
    regions: template.regions.map(region => {
      if (rightIds.has(region.regionId)) return { ...region, rect: quantizeRect({ ...region.rect, x: region.rect.x + delta }, template) }
      if (region.regionId === structure.outerRegionId) return { ...region, rect: quantizeRect({ ...region.rect, w: region.rect.w + delta }, template) }
      return region
    }),
    calibration: calibrationMatchesTable
      ? { ...(template.calibration ?? {}), targetRect: quantizeRect({ ...template.calibration!.targetRect!, w: template.calibration!.targetRect!.w + delta }, template) }
      : template.calibration,
  }
}

export function setPaperTimelineRoleWidthPx(
  template: SheetTemplate,
  structure: PaperTimelineStructure,
  role: PaperTimelineRole,
  requestedWidthPx: number,
): SheetTemplate {
  if (structure.status === 'incomplete') return template
  const leftRole = regionFor(template, structure.roles[role].leftRegionId)
  if (!leftRole) return template
  const pageWidth = Math.max(1, template.page.widthPx)
  const requestedDeltaPx = Math.round(requestedWidthPx - leftRole.rect.w * pageWidth)
  const range = paperTimelineRoleWidthDeltaRangePx(template, structure, role)
  if (!range) return template
  const deltaPx = clamp(requestedDeltaPx, range.minimum, range.maximum)
  if (deltaPx === 0) return template
  if (role === 'camera') {
    const cell = regionFor(template, structure.roles.cell.leftRegionId)
    return cell
      ? setPaperTimelineRoleWidthPx(template, structure, 'cell', cell.rect.w * pageWidth - deltaPx)
      : template
  }
  const nextRole = PAPER_TIMELINE_ROLES[PAPER_TIMELINE_ROLES.indexOf(role) + 1]!
  const delta = deltaPx / pageWidth
  const currentIds = new Set([
    structure.roles[role].leftRegionId,
    structure.roles[role].rightRegionId,
  ])
  const adjacentIds = new Set([
    structure.roles[nextRole].leftRegionId,
    structure.roles[nextRole].rightRegionId,
  ])
  return {
    ...template,
    regions: template.regions.map(region => {
      if (currentIds.has(region.regionId)) return { ...region, rect: quantizeRect({ ...region.rect, w: region.rect.w + delta }, template) }
      if (adjacentIds.has(region.regionId)) return { ...region, rect: quantizeRect({ ...region.rect, x: region.rect.x + delta, w: region.rect.w - delta }, template) }
      return region
    }),
  }
}

export function nudgePaperTimelineRoleWidthPx(
  template: SheetTemplate,
  structure: PaperTimelineStructure,
  role: PaperTimelineRole,
  direction: -1 | 1,
): SheetTemplate {
  const current = regionFor(template, structure.roles[role].leftRegionId)
  if (!current) return template
  return setPaperTimelineRoleWidthPx(
    template,
    structure,
    role,
    current.rect.w * Math.max(1, template.page.widthPx) + direction,
  )
}

export function canNudgePaperTimelineRoleWidthPx(
  template: SheetTemplate,
  structure: PaperTimelineStructure,
  role: PaperTimelineRole,
  direction: -1 | 1,
): boolean {
  const range = paperTimelineRoleWidthDeltaRangePx(template, structure, role)
  return Boolean(range && (direction < 0 ? range.minimum <= -1 : range.maximum >= 1))
}

export function resizePaperTimelineColumns(
  template: SheetTemplate,
  structure: PaperTimelineStructure,
  role: PaperTimelineRole,
  requestedCount: number,
): SheetTemplate {
  if (structure.status === 'incomplete') return template
  const count = clamp(Math.round(requestedCount), 1, 64)
  if (role === 'action' || role === 'cell') {
    const paperTracks = resizePaperTrackLabels(template.defaults.paperTracks, count)
    const managedIds = new Set([
      structure.roles.action.leftRegionId,
      structure.roles.action.rightRegionId,
      structure.roles.cell.leftRegionId,
      structure.roles.cell.rightRegionId,
    ])
    return {
      ...template,
      defaults: { ...template.defaults, paperTracks },
      regions: template.regions.map(region => {
        if (!managedIds.has(region.regionId) || !region.grid || (region.grid.role !== 'action' && region.grid.role !== 'cell')) return region
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

  const pair = structure.roles[role]
  const left = regionFor(template, pair.leftRegionId)
  if (!left?.grid) return template
  const shared = buildTemplateColumns(template, role as TemplateGridRole, count, left.grid.columns)
  const ids = new Set([pair.leftRegionId, pair.rightRegionId])
  return {
    ...template,
    regions: template.regions.map(region => {
      if (!ids.has(region.regionId) || !region.grid) return region
      return {
        ...region,
        grid: {
          ...region.grid,
          columns: shared.map((column, index) => ({
            ...column,
            columnId: region.grid?.columns[index]?.columnId ?? column.columnId,
          })),
        },
      }
    }),
  }
}

export function alignTemplateRegionToRect(
  template: SheetTemplate,
  regionId: string,
  target: NormalizedRect,
  alignment: PaperTimelineAlignment,
): SheetTemplate {
  return {
    ...template,
    regions: template.regions.map(region => {
      if (region.regionId !== regionId) return region
      const rect = { ...region.rect }
      if (alignment === 'left') rect.x = target.x
      if (alignment === 'center-x') rect.x = target.x + (target.w - rect.w) / 2
      if (alignment === 'right') rect.x = target.x + target.w - rect.w
      if (alignment === 'top') rect.y = target.y
      if (alignment === 'center-y') rect.y = target.y + (target.h - rect.h) / 2
      if (alignment === 'bottom') rect.y = target.y + target.h - rect.h
      return { ...region, rect: quantizeRect(clampRectToPage(rect, template), template) }
    }),
  }
}

export function paperTimelineRoleRegion(
  template: SheetTemplate,
  structure: PaperTimelineStructure,
  role: PaperTimelineRole,
  side: PaperTimelineSide = 'left',
): SheetTemplateRegion | null {
  return regionFor(template, regionIdForSide(structure.roles[role], side))
}

export function paperTimelineGapPx(structure: PaperTimelineStructure, template: SheetTemplate): number {
  return Math.round((structure.rightRect.x - structure.leftRect.x - structure.leftRect.w) * template.page.widthPx)
}

export function paperTimelineColumnWidthMm(region: SheetTemplateRegion, template: SheetTemplate): number {
  const columns = Math.max(1, region.grid?.columns.length ?? 1)
  return pxToMm(region.rect.w * template.page.widthPx / columns, template)
}

export function paperTimelineRegionMinimumWidthMm(region: SheetTemplateRegion, template: SheetTemplate): number {
  return pxToMm(minimumWidthPx(region, template), template)
}

export function pxToMm(px: number, template: SheetTemplate): number {
  return px * 25.4 / Math.max(1, template.page.dpi ?? 150)
}

export function mmToPx(mm: number, template: SheetTemplate): number {
  return mm * Math.max(1, template.page.dpi ?? 150) / 25.4
}

function findTimelineRegion(template: SheetTemplate, role: PaperTimelineRole, frameStart: number): SheetTemplateRegion | null {
  return template.regions.find(region => {
    if (region.grid?.role !== role || region.grid.frameStart !== frameStart) return false
    if (region.grid.rowCount !== PAPER_TIMELINE_ROWS_PER_BLOCK) return false
    return region.grid.frameEnd === undefined || region.grid.frameEnd === frameStart + PAPER_TIMELINE_ROWS_PER_BLOCK - 1
  }) ?? null
}

function isPaperTimelineAuxiliaryRegion(region: SheetTemplateRegion, leftStart: number, rightStart: number): boolean {
  return region.grid?.role === 'other'
    && region.grid.rowCount === PAPER_TIMELINE_ROWS_PER_BLOCK
    && (region.grid.frameStart === leftStart || region.grid.frameStart === rightStart)
}

function smallestContainingOuterRegion(
  template: SheetTemplate,
  gridRect: NormalizedRect,
  excludedIds: ReadonlySet<string>,
): SheetTemplateRegion | null {
  const candidates = template.regions.filter(region => !excludedIds.has(region.regionId)
    && region.usage === 'render-only'
    && rectContainsInPagePixels(region.rect, gridRect, template))
  return candidates.sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0] ?? null
}

function regionFor(template: SheetTemplate, regionId: string | undefined): SheetTemplateRegion | null {
  if (!regionId) return null
  return template.regions.find(region => region.regionId === regionId) ?? null
}

function regionIdForSide(pair: PaperTimelineRolePair, side: PaperTimelineSide): string {
  return side === 'left' ? pair.leftRegionId : pair.rightRegionId
}

function roleLabel(role: PaperTimelineRole): string {
  return role.toUpperCase()
}

function rectBounds(rects: readonly NormalizedRect[]): NormalizedRect {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  const left = Math.min(...rects.map(rect => rect.x))
  const top = Math.min(...rects.map(rect => rect.y))
  const right = Math.max(...rects.map(rect => rect.x + rect.w))
  const bottom = Math.max(...rects.map(rect => rect.y + rect.h))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

function pixelVerticalEdges(rect: NormalizedRect, pageHeight: number): { top: number; bottom: number } {
  return {
    top: Math.round(rect.y * pageHeight),
    bottom: Math.round((rect.y + rect.h) * pageHeight),
  }
}

function minimumWidthPx(region: SheetTemplateRegion, template: SheetTemplate): number {
  const columnCount = Math.max(1, region.grid?.columns.length ?? 1)
  const minimumColumnWidthPx = mmToPx(2.5, template)
  return Math.max(MIN_REGION_WIDTH_PX, columnCount * minimumColumnWidthPx)
}

function paperTimelineRoleWidthDeltaRangePx(
  template: SheetTemplate,
  structure: PaperTimelineStructure,
  role: PaperTimelineRole,
): { minimum: number; maximum: number } | null {
  if (structure.status === 'incomplete') return null
  if (role === 'camera') {
    const cellRange = paperTimelineRoleWidthDeltaRangePx(template, structure, 'cell')
    return cellRange ? { minimum: -cellRange.maximum, maximum: -cellRange.minimum } : null
  }
  const nextRole = PAPER_TIMELINE_ROLES[PAPER_TIMELINE_ROLES.indexOf(role) + 1]
  if (!nextRole) return null
  const pageWidth = Math.max(1, template.page.widthPx)
  let minimumDeltaPx = Number.NEGATIVE_INFINITY
  let maximumDeltaPx = Number.POSITIVE_INFINITY
  for (const side of ['left', 'right'] as const) {
    const current = regionFor(template, regionIdForSide(structure.roles[role], side))
    const adjacent = regionFor(template, regionIdForSide(structure.roles[nextRole], side))
    if (!current || !adjacent) return null
    minimumDeltaPx = Math.max(minimumDeltaPx, minimumWidthPx(current, template) - current.rect.w * pageWidth)
    maximumDeltaPx = Math.min(maximumDeltaPx, adjacent.rect.w * pageWidth - minimumWidthPx(adjacent, template))
  }
  return { minimum: Math.ceil(minimumDeltaPx), maximum: Math.floor(maximumDeltaPx) }
}

function clampRectToPage(rect: NormalizedRect, template: SheetTemplate): NormalizedRect {
  const minWidth = 1 / Math.max(1, template.page.widthPx)
  const minHeight = 1 / Math.max(1, template.page.heightPx)
  const width = clamp(rect.w, minWidth, 1)
  const height = clamp(rect.h, minHeight, 1)
  return {
    x: clamp(rect.x, 0, 1 - width),
    y: clamp(rect.y, 0, 1 - height),
    w: width,
    h: height,
  }
}

function quantizeRect(rect: NormalizedRect, template: SheetTemplate): NormalizedRect {
  const left = Math.round(rect.x * template.page.widthPx)
  const top = Math.round(rect.y * template.page.heightPx)
  const right = Math.round((rect.x + rect.w) * template.page.widthPx)
  const bottom = Math.round((rect.y + rect.h) * template.page.heightPx)
  return {
    x: left / template.page.widthPx,
    y: top / template.page.heightPx,
    w: Math.max(1, right - left) / template.page.widthPx,
    h: Math.max(1, bottom - top) / template.page.heightPx,
  }
}

function quantizeY(value: number, template: SheetTemplate): number {
  return Math.round(value * template.page.heightPx) / template.page.heightPx
}

function rectContainsInPagePixels(outer: NormalizedRect, inner: NormalizedRect, template: SheetTemplate): boolean {
  const tolerancePx = 1
  return outer.x * template.page.widthPx <= inner.x * template.page.widthPx + tolerancePx
    && outer.y * template.page.heightPx <= inner.y * template.page.heightPx + tolerancePx
    && (outer.x + outer.w) * template.page.widthPx + tolerancePx >= (inner.x + inner.w) * template.page.widthPx
    && (outer.y + outer.h) * template.page.heightPx + tolerancePx >= (inner.y + inner.h) * template.page.heightPx
}

function sameRectInPagePixels(a: NormalizedRect, b: NormalizedRect, template: SheetTemplate): boolean {
  const aLeft = Math.round(a.x * template.page.widthPx)
  const aTop = Math.round(a.y * template.page.heightPx)
  const aRight = Math.round((a.x + a.w) * template.page.widthPx)
  const aBottom = Math.round((a.y + a.h) * template.page.heightPx)
  const bLeft = Math.round(b.x * template.page.widthPx)
  const bTop = Math.round(b.y * template.page.heightPx)
  const bRight = Math.round((b.x + b.w) * template.page.widthPx)
  const bBottom = Math.round((b.y + b.h) * template.page.heightPx)
  return aLeft === bLeft && aTop === bTop && aRight === bRight && aBottom === bBottom
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
