import { type CutProject, type NormalizedRect, type NormalizedPoint, type SheetPage, type SheetTemplate, type SheetTimingRole, type StackGuideLabel, projectSheetLayoutOptions, resolveSheetTemplateGridLayout, resolveSheetTemplatePageSize, stackGuideStackBand } from '@xsheet-remap/core'
import { clampNumber } from './sheetInteraction'
import { StackGuideInsertTarget, StackGuideLabelUpdates } from './app-foundation'
import { stackGuideAnchorRegions, stackGuideColumnHeaderHitPx, stackGuideInsertionTargets, stackGuideNativeHeaderReachPx } from './stack-guides-geometry'

type StackGuideInsertHitMode = 'header' | 'page'

export function stackGuideInsertTargetFromPoint(
  template: SheetTemplate,
  project: CutProject,
  page: SheetPage,
  point: NormalizedPoint,
  hitMode: StackGuideInsertHitMode = 'header',
): StackGuideInsertTarget | null {
  const anchorRegions = stackGuideAnchorRegions(template, page, project.logicalSheet.frameOrigin)
  const layoutOptions = projectSheetLayoutOptions(project, template)
  const displayDurationFrames = layoutOptions.durationFrames ?? template.defaults.durationFrames
  const pageSize = resolveSheetTemplatePageSize(template, displayDurationFrames, {
    ...layoutOptions,
  })
  const candidates: Array<StackGuideInsertTarget & { score: number }> = []

  for (const region of anchorRegions) {
    if (!region.grid) continue
    const displayRole = region.grid.role as SheetTimingRole
    const layout = resolveSheetTemplateGridLayout(template, region, {
      ...layoutOptions,
    })
    if (!layout || layout.columns.length === 0) continue
    const columns = layout.columns
    const rect = layout.rect
    const targets = stackGuideInsertionTargets(template, project, displayRole, region.regionId, rect, columns)
    if (targets.length === 0) continue
    const minX = Math.min(...targets.map(target => target.x))
    const maxX = Math.max(...targets.map(target => target.x))
    if (hitMode === 'header' && (point.x < minX || point.x > maxX)) continue

    const headerReach = stackGuideNativeHeaderReachPx(template, rect, pageSize) / pageSize.heightPx
    const columnHeaderHit = stackGuideColumnHeaderHitPx(template, pageSize.heightPx) / pageSize.heightPx
    const headerTop = rect.y - headerReach
    const headerBottom = rect.y - columnHeaderHit
    if (hitMode === 'header' && (point.y < headerTop || point.y > headerBottom)) continue

    const nearestTarget = targets.reduce((nearest, target) =>
      Math.abs(point.x - target.x) < Math.abs(point.x - nearest.x) ? target : nearest,
    )
    const outsideX = point.x < rect.x ? rect.x - point.x : point.x > rect.x + rect.w ? point.x - (rect.x + rect.w) : 0
    const outsideHeaderOrGridY = point.y < headerTop ? headerTop - point.y : point.y > rect.y + rect.h ? point.y - (rect.y + rect.h) : 0
    const xDistance = Math.abs(point.x - nearestTarget.x)
    const score = hitMode === 'header'
      ? outsideX
      : xDistance * 0.65 + outsideX * 0.35 + outsideHeaderOrGridY * 1.8 + Math.abs(point.y - rect.y) * 0.2
    candidates.push({
      pageId: page.pageId,
      regionId: region.regionId,
      gapIndex: nearestTarget.gapIndex,
      insertAfterPaperTrack: nearestTarget.insertAfterPaperTrack,
      displayRole,
      snapIndex: nearestTarget.snapIndex,
      score,
    })
  }

  const [target] = candidates.sort((a, b) => a.score - b.score)
  if (!target) return null
  return {
    pageId: target.pageId,
    regionId: target.regionId,
    gapIndex: target.gapIndex,
    insertAfterPaperTrack: target.insertAfterPaperTrack,
    displayRole: target.displayRole,
    snapIndex: target.snapIndex,
  }
}

export function defaultStackGuideInsertTarget(
  template: SheetTemplate,
  project: CutProject,
  page: SheetPage,
  preferredSnapIndex = 1,
): StackGuideInsertTarget | null {
  const layoutOptions = projectSheetLayoutOptions(project, template)
  const anchorRegions = stackGuideAnchorRegions(template, page, project.logicalSheet.frameOrigin)
  const region = anchorRegions.find(item => item.grid?.role === 'action') ?? anchorRegions.find(item => item.grid)
  if (!region?.grid) return null
  const displayRole = region.grid.role as SheetTimingRole
  const layout = resolveSheetTemplateGridLayout(template, region, {
    ...layoutOptions,
  })
  if (!layout || layout.columns.length === 0) return null
  const columns = layout.columns
  const rect = layout.rect
  const targets = stackGuideInsertionTargets(template, project, displayRole, region.regionId, rect, columns)
  const target = targets.find(item => item.snapIndex === preferredSnapIndex) ?? targets[0]
  return target
    ? {
        pageId: page.pageId,
        regionId: region.regionId,
        gapIndex: target.gapIndex,
        insertAfterPaperTrack: target.insertAfterPaperTrack,
        displayRole,
        snapIndex: target.snapIndex,
      }
    : null
}

export function stackGuidePlacementUpdateFromPointer(
  svg: SVGSVGElement | null,
  clientX: number,
  clientY: number,
  project: CutProject,
  template: SheetTemplate,
  page: SheetPage,
  label: StackGuideLabel,
): StackGuideLabelUpdates | null {
  const target = stackGuidePlacementTargetFromPointer(svg, clientX, clientY, project, template, page)
  if (!target) return null
  const orderInGap = nextStackGuideOrderInGap(project, label.labelId, target.displayRole, target.gapIndex)
  return {
    displayRole: target.displayRole,
    gapIndex: target.gapIndex,
    insertAfterPaperTrack: target.insertAfterPaperTrack ?? '',
    viewTemplateId: template.templateId,
    viewSnapIndex: target.snapIndex,
    orderInGap,
  }
}

export function stackGuidePlacementTargetFromPointer(
  svg: SVGSVGElement | null,
  clientX: number,
  clientY: number,
  project: CutProject,
  template: SheetTemplate,
  page: SheetPage,
): (StackGuideInsertTarget & { columns: Array<{ paperTrack?: string }> }) | null {
  if (!svg) return null
  const box = svg.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return null
  const point = {
    x: clampNumber((clientX - box.left) / box.width, 0, 1),
    y: clampNumber((clientY - box.top) / box.height, 0, 1),
  }
  const layoutOptions = projectSheetLayoutOptions(project, template)
  type StackGuideDropCandidate = {
    role: SheetTimingRole
    regionId: string
    columns: Array<{ paperTrack?: string }>
    rect: NormalizedRect
    score: number
  }
  const candidates = stackGuideAnchorRegions(template, page, project.logicalSheet.frameOrigin)
    .flatMap((region): StackGuideDropCandidate[] => {
      if (!region.grid) return []
      const role = region.grid.role as SheetTimingRole
      const layout = resolveSheetTemplateGridLayout(template, region, {
        ...layoutOptions,
      })
      if (!layout || layout.columns.length === 0) return []
      const columns = layout.columns
      const rect = layout.rect
      const outsideX = point.x < rect.x ? rect.x - point.x : point.x > rect.x + rect.w ? point.x - (rect.x + rect.w) : 0
      const outsideY = point.y < rect.y ? rect.y - point.y : point.y > rect.y + rect.h ? point.y - (rect.y + rect.h) : 0
      return [{ role, regionId: region.regionId, columns, rect, score: Math.abs(point.y - rect.y) + outsideX * 0.65 + outsideY * 1.8 }]
    })
    .sort((a, b) => a.score - b.score)
  const target = candidates[0]
  if (!target) return null
  const insertionTargets = stackGuideInsertionTargets(template, project, target.role, target.regionId, target.rect, target.columns)
  const placement = insertionTargets.reduce((nearest, candidate) =>
    Math.abs(point.x - candidate.x) < Math.abs(point.x - nearest.x) ? candidate : nearest,
  )
  return {
    pageId: page.pageId,
    regionId: target.regionId,
    displayRole: target.role,
    gapIndex: placement.gapIndex,
    insertAfterPaperTrack: placement.insertAfterPaperTrack,
    snapIndex: placement.snapIndex,
    columns: target.columns,
  }
}

function nextStackGuideOrderInGap(
  project: CutProject,
  movedLabelId: string,
  displayRole: SheetTimingRole,
  gapIndex: number,
): number {
  const orders = project.stackGuideLabels
    .filter(label =>
      label.labelId !== movedLabelId
      && stackGuideStackBand(label) === 'cell-interleave'
      && (label.displayRole ?? 'action') === displayRole
      && label.gapIndex === gapIndex,
    )
    .map(label => label.orderInGap)
  return orders.length > 0 ? Math.max(...orders) + 1 : 0
}
