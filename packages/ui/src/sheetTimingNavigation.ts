import { logicalSheetDisplayFrameEnd, logicalSheetDisplayFrameStart, type CutProject, type SheetHit, type SheetTemplate } from '@xsheet-remap/core'
import { paperTrackOrderForRole } from './app-sheet-geometry'
import { projectTimingHitForFrame } from './sheet-layers-hit-geometry'
import { clampNumber, sheetRoleForHit } from './sheetInteraction'

export function nextProjectTimingHit(template: SheetTemplate, project: CutProject, current: SheetHit | null, trackDelta: number, frameDelta: number): SheetHit | null {
  const role = current ? sheetRoleForHit(current) : 'cell'
  const tracks = paperTrackOrderForRole(project, role, template)
  const trackIndex = current?.paperTrack ? Math.max(0, tracks.indexOf(current.paperTrack)) : 0
  const track = tracks[clampNumber(trackIndex + (current ? trackDelta : 0), 0, tracks.length - 1)]
  if (!track) return null
  const start = logicalSheetDisplayFrameStart(project.logicalSheet)
  const frame = clampNumber(current ? current.frame + frameDelta : start, start, logicalSheetDisplayFrameEnd(project.logicalSheet))
  return projectTimingHitForFrame(template, project, role, track, frame) ?? current
}
