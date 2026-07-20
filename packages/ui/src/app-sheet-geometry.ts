import {
  getSheetViewLayout,
  getSheetTemplateHiddenPaperTracks,
  logicalSheetDisplayDurationFrames,
  logicalSheetDisplayFrameStart,
  resolveSheetTemplateGridLayout,
  timelineLanesForLayout,
  type CutProject,
  type NormalizedPoint,
  type PaperTrack,
  type SheetTemplate,
  type SheetTimingRole,
} from '@xsheet-remap/core'
import { compareNaturalFileNameText } from './naturalSort'
import { clampNumber } from './sheetInteraction'

export function templatePaperTracks(project: CutProject, template?: SheetTemplate): PaperTrack[] {
  const showAllLogicalTracks = template && getSheetViewLayout(template).trackAxis?.type === 'logical-width'
  return project.logicalSheet.paperTracks
    .filter(track => showAllLogicalTracks || track.source !== 'overlay')
    .sort((a, b) => a.order - b.order)
}

export function overlayPaperTracks(project: CutProject, template?: SheetTemplate): PaperTrack[] {
  if (template && getSheetViewLayout(template).trackAxis?.type === 'logical-width') return []
  const ordered = [...project.logicalSheet.paperTracks].sort((a, b) => a.order - b.order)
  const hidden = template
    ? new Set(getSheetTemplateHiddenPaperTracks(template, 'cell', ordered.filter(track => track.source !== 'overlay').map(track => track.paperTrack)))
    : new Set<string>()
  return ordered.flatMap(track => {
    if (track.source === 'overlay') return [track]
    if (!template || !hidden.has(track.paperTrack)) return []
    return [{
      ...track,
      viewPlacement: {
        ...track.viewPlacement,
        templateId: template.templateId,
        sheetRole: 'cell' as const,
        snapIndex: Number.MAX_SAFE_INTEGER,
      },
    }]
  })
}

/** Records the source template for legacy numeric view overrides before a template switch. */
export function stampAuxiliaryPlacementTemplate(project: CutProject, templateId: string): CutProject {
  return {
    ...project,
    logicalSheet: {
      ...project.logicalSheet,
      paperTracks: project.logicalSheet.paperTracks.map(track =>
        track.source === 'overlay'
        && track.viewPlacement
        && !track.viewPlacement.templateId
        && Number.isFinite(track.viewPlacement.snapIndex)
          ? { ...track, viewPlacement: { ...track.viewPlacement, templateId } }
          : track),
    },
    stackGuideLabels: project.stackGuideLabels.map(label =>
      !label.viewTemplateId && Number.isFinite(label.viewSnapIndex)
        ? { ...label, viewTemplateId: templateId }
        : label),
  }
}

export function paperTrackOrderForRole(project: CutProject, role: SheetTimingRole): string[] {
  const templateTracks = templatePaperTracks(project)
  const templateOrder = new Map(templateTracks.map((track, index) => [track.paperTrack, index]))
  return project.logicalSheet.paperTracks
    .filter(track => track.source !== 'overlay' || (track.viewPlacement?.sheetRole ?? 'cell') === role)
    .map(track => ({
      track,
      visualOrder: track.source === 'overlay'
        ? (track.viewPlacement?.snapIndex ?? templateOrder.get(track.paperTrack) ?? track.order) - 0.35
        : templateOrder.get(track.paperTrack) ?? track.order,
    }))
    .sort((a, b) =>
      a.visualOrder - b.visualOrder
      || a.track.order - b.track.order
      || compareNaturalFileNameText(a.track.paperTrack, b.track.paperTrack),
    )
    .map(item => item.track.paperTrack)
}

export interface OverlayBandSegment {
  regionId: string
  rect: { x: number; y: number; w: number; h: number }
  frames: { frameStart: number; frameEnd: number; rowCount: number }
  globalFrameStart: number
  globalFrameEnd: number
  slots: OverlayBandSlot[]
  minX: number
  columnWidth: number
  snapCount: number
  majorLineEvery?: number
  rowLineRules?: NonNullable<SheetTemplate['regions'][number]['grid']>['rowLineRules']
}

export interface OverlayBandSlot {
  regionId: string
  columnId: string
  paperTrack?: string
  x: number
  w: number
}

export function overlayBandSegments(template: SheetTemplate, project: CutProject, role: SheetTimingRole): OverlayBandSegment[] {
  const templateTrackNames = templatePaperTracks(project, template).map(track => track.paperTrack)
  const timelineLanes = timelineLanesForLayout(project)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const viewLayout = getSheetViewLayout(template)
  const frameOrigin = viewLayout.frameAxis?.type === 'continuous' || viewLayout.frameAxis?.type === 'infinite'
    ? logicalSheetDisplayFrameStart(project.logicalSheet)
    : template.defaults.frameOrigin
  return template.regions.flatMap(region => {
    if (region.type !== 'exposure-grid' || region.grid?.role !== role) return []
    const layout = resolveSheetTemplateGridLayout(template, region, {
      paperTracks: templateTrackNames,
      timelineLanes,
      durationFrames: displayDurationFrames,
      frameOrigin,
      layoutOverrides: project.sheetView.layoutOverrides,
    })
    if (!layout || layout.columns.length === 0) return []
    const { rect, columns, frames } = layout
    const auxiliaryBand = template.auxiliaryBands?.find(band => band.anchorRegionIds.includes(region.regionId))
    const explicitSlots = auxiliaryBand?.slotRegionIds.flatMap(regionId => {
      const slotRegion = template.regions.find(candidate => candidate.regionId === regionId)
      if (!slotRegion?.grid) return []
      const slotLayout = resolveSheetTemplateGridLayout(template, slotRegion, {
        paperTracks: templateTrackNames,
        timelineLanes,
        durationFrames: displayDurationFrames,
        frameOrigin,
        layoutOverrides: project.sheetView.layoutOverrides,
      })
      return slotLayout?.columns.map(column => ({
        regionId,
        columnId: column.columnId,
        paperTrack: column.paperTrack,
        x: column.x,
        w: column.w,
      })) ?? []
    }) ?? []
    const actionRegion = matchingGridRegion(template, 'action', frames.frameStart)
    const cameraRegion = matchingGridRegion(template, 'camera', frames.frameStart)
    const resolveRelatedLayout = (relatedRegion: SheetTemplate['regions'][number] | undefined) => relatedRegion
      ? resolveSheetTemplateGridLayout(template, relatedRegion, {
          paperTracks: templateTrackNames,
          timelineLanes,
          durationFrames: displayDurationFrames,
          frameOrigin,
          layoutOverrides: project.sheetView.layoutOverrides,
        })
      : null
    const actionRect = resolveRelatedLayout(actionRegion)?.rect ?? rect
    const cameraRect = resolveRelatedLayout(cameraRegion)?.rect ?? rect
    const columnWidth = columns.reduce((total, column) => total + column.w, 0) / columns.length
    const legacyMinX = Math.max(0, actionRect.x - columnWidth)
    const legacyMaxX = Math.min(1 - columnWidth, cameraRect.x + cameraRect.w)
    const legacySnapCount = Math.max(0, Math.round((legacyMaxX - legacyMinX) / columnWidth))
    const slots = explicitSlots.length > 0
      ? explicitSlots
      : Array.from({ length: legacySnapCount + 1 }, (_, index) => ({
          regionId: region.regionId,
          columnId: `legacy_auxiliary_${index}`,
          x: legacyMinX + columnWidth * index,
          w: columnWidth,
        }))
    return [{
      regionId: region.regionId,
      rect,
      frames,
      globalFrameStart: frames.frameStart,
      globalFrameEnd: frames.frameEnd,
      slots,
      minX: slots[0]?.x ?? legacyMinX,
      columnWidth: slots[0]?.w ?? columnWidth,
      snapCount: Math.max(0, slots.length - 1),
      majorLineEvery: region.grid.majorLineEvery,
      rowLineRules: region.grid.rowLineRules,
    }]
  })
}

function matchingGridRegion(template: SheetTemplate, role: 'action' | 'cell' | 'camera', frameStart: number): SheetTemplate['regions'][number] | undefined {
  return template.regions.find(region =>
    region.type === 'exposure-grid'
    && region.grid?.role === role
    && (region.grid.frameStart ?? template.defaults.frameOrigin) === frameStart,
  )
}

export function overlaySnapIndexFromPoint(template: SheetTemplate, project: CutProject, point: NormalizedPoint, role: SheetTimingRole): number {
  const segments = overlayBandSegments(template, project, role)
  const segment = segments.find(item => {
    const first = item.slots[0]
    const last = item.slots.at(-1)
    return first && last && point.x >= first.x && point.x <= last.x + last.w
  })
    ?? segments.find(item => point.y >= item.rect.y && point.y <= item.rect.y + item.rect.h)
    ?? segments[0]
  return overlaySnapIndexFromSegment(point.x, segment)
}

export function overlaySnapIndexFromSegment(x: number, segment: OverlayBandSegment | null | undefined): number {
  if (!segment) return 0
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY
  segment.slots.forEach((slot, index) => {
    const distance = Math.abs(x - slot.x)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  })
  return clampNumber(nearestIndex, 0, segment.snapCount)
}

export function overlayVisibleSnapIndex(template: SheetTemplate, project: CutProject, track: PaperTrack, segment: OverlayBandSegment): number {
  const placement = track.viewPlacement
  if (!placement?.templateId || placement.templateId === template.templateId) {
    return clampNumber(Math.round(placement?.snapIndex ?? 0), 0, segment.snapCount)
  }
  const anchor = track.exportPlacement?.insertAfterPaperTrack
  if (!anchor) return 0
  const anchorSlotIndex = segment.slots.findIndex(slot => slot.regionId === segment.regionId && slot.paperTrack === anchor)
  if (anchorSlotIndex >= 0) return clampNumber(anchorSlotIndex + 1, 0, segment.snapCount)
  const trackIndex = templatePaperTracks(project, template).findIndex(candidate => candidate.paperTrack === anchor)
  return clampNumber(trackIndex >= 0 ? trackIndex + 2 : 0, 0, segment.snapCount)
}
