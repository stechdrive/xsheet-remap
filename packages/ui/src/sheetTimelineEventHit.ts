import { sheetTimingRoleForEvent, timingHitForFrame, type CutProject, type SheetHit, type SheetPage, type SheetTimingRole } from '@xsheet-remap/core'
import { overlayHitForFrame } from './sheet-layers-hit-geometry'
import type { SheetRenderModelGeometry } from './sheetRenderModel'

export type TimelineHitEvent = { paperTrack: string; frame: number; sheetRole?: SheetTimingRole }

export function sheetTimelineEventHit(project: CutProject, geometry: SheetRenderModelGeometry,
  event: TimelineHitEvent, page: SheetPage): SheetHit | null {
  const role = sheetTimingRoleForEvent(event)
  const track = geometry.overlayTracks.find(candidate => candidate.paperTrack === event.paperTrack)
  if (track) return overlayHitForFrame(geometry.template, project, track, event.frame, page, role)
  const hit = timingHitForFrame(geometry.template, role, event.paperTrack, event.frame,
    geometry.displayDurationFrames, geometry.displayFrameStart, geometry.paperTracks)
  return hit?.pageId === page.pageId ? hit : null
}
