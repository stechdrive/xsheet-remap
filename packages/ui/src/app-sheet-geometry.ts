import {
  getSheetViewLayout,
  logicalSheetDisplayDurationFrames,
  logicalSheetDisplayFrameStart,
  resolveSheetTemplateGridLayout,
  type CutProject,
  type NormalizedPoint,
  type PaperTrack,
  type SheetTemplate,
  type SheetTimingRole,
} from '@xsheet-remap/core'
import { compareNaturalFileNameText } from './naturalSort'
import { clampNumber } from './sheetInteraction'

export function templatePaperTracks(project: CutProject): PaperTrack[] {
  return project.logicalSheet.paperTracks.filter(track => track.source !== 'overlay').sort((a, b) => a.order - b.order)
}

export function overlayPaperTracks(project: CutProject): PaperTrack[] {
  return project.logicalSheet.paperTracks.filter(track => track.source === 'overlay').sort((a, b) => a.order - b.order)
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
  minX: number
  columnWidth: number
  snapCount: number
  majorLineEvery?: number
  rowLineRules?: NonNullable<SheetTemplate['regions'][number]['grid']>['rowLineRules']
}

export function overlayBandSegments(template: SheetTemplate, project: CutProject, role: SheetTimingRole): OverlayBandSegment[] {
  const templateTrackNames = templatePaperTracks(project).map(track => track.paperTrack)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const viewLayout = getSheetViewLayout(template)
  const frameOrigin = viewLayout.frameAxis?.type === 'continuous' || viewLayout.frameAxis?.type === 'infinite'
    ? logicalSheetDisplayFrameStart(project.logicalSheet)
    : template.defaults.frameOrigin
  return template.regions.flatMap(region => {
    if (region.type !== 'exposure-grid' || region.grid?.role !== role) return []
    const layout = resolveSheetTemplateGridLayout(template, region, {
      paperTracks: templateTrackNames,
      durationFrames: displayDurationFrames,
      frameOrigin,
      layoutOverrides: project.sheetView.layoutOverrides,
    })
    if (!layout || layout.columns.length === 0) return []
    const { rect, columns, frames } = layout
    const actionRegion = matchingGridRegion(template, 'action', frames.frameStart)
    const cameraRegion = matchingGridRegion(template, 'camera', frames.frameStart)
    const resolveRelatedLayout = (relatedRegion: SheetTemplate['regions'][number] | undefined) => relatedRegion
      ? resolveSheetTemplateGridLayout(template, relatedRegion, {
          paperTracks: templateTrackNames,
          durationFrames: displayDurationFrames,
          frameOrigin,
          layoutOverrides: project.sheetView.layoutOverrides,
        })
      : null
    const actionRect = resolveRelatedLayout(actionRegion)?.rect ?? rect
    const cameraRect = resolveRelatedLayout(cameraRegion)?.rect ?? rect
    const columnWidth = columns.reduce((total, column) => total + column.w, 0) / columns.length
    const minX = Math.max(0, actionRect.x - columnWidth)
    const maxX = Math.min(1 - columnWidth, cameraRect.x + cameraRect.w)
    return [{
      regionId: region.regionId,
      rect,
      frames,
      globalFrameStart: frames.frameStart,
      globalFrameEnd: frames.frameEnd,
      minX,
      columnWidth,
      snapCount: Math.max(0, Math.round((maxX - minX) / columnWidth)),
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
  const segment = segments.find(item => point.x >= item.minX && point.x <= item.minX + item.columnWidth * item.snapCount)
    ?? segments.find(item => point.y >= item.rect.y && point.y <= item.rect.y + item.rect.h)
    ?? segments[0]
  return overlaySnapIndexFromSegment(point.x, segment)
}

export function overlaySnapIndexFromSegment(x: number, segment: OverlayBandSegment | null | undefined): number {
  if (!segment) return 0
  return clampNumber(Math.round((x - segment.minX) / segment.columnWidth), 0, segment.snapCount)
}
