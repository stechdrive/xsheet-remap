import {
  logicalSheetDisplayDurationFrames,
  logicalSheetDisplayFrameStart,
  timingHitForFrame,
  type CutProject,
  type SheetTemplate,
} from '@xsheet-remap/core'
import type { TimingEditSession } from './appTypes'
import { paperTrackOrderForRole } from './app-sheet-geometry'
import { setTimingValueAt } from './sheet-timing-input'
import { isPointEventRangeForUi, rangePaperTracks } from './timingEditing'

export function applyTimingEditSession(
  sourceProject: CutProject,
  template: SheetTemplate,
  session: TimingEditSession,
): CutProject {
  const value = session.value.trim()
  if (session.target.kind === 'cell') {
    return setTimingValueAt(
      sourceProject,
      session.target.hit,
      value,
      session.fontSizePx,
      session.correctionLayerId,
    ).project
  }

  const range = session.target.range
  if (!isPointEventRangeForUi(range)) return sourceProject
  const trackOrder = paperTrackOrderForRole(sourceProject, range.role)
  const durationFrames = logicalSheetDisplayDurationFrames(sourceProject.logicalSheet)
  const frameStart = logicalSheetDisplayFrameStart(sourceProject.logicalSheet)
  let nextProject = sourceProject
  for (const paperTrack of rangePaperTracks(range)) {
    const startHit = timingHitForFrame(
      template,
      range.role,
      paperTrack,
      range.frameStart,
      durationFrames,
      frameStart,
      trackOrder,
    )
    if (startHit) {
      nextProject = setTimingValueAt(
        nextProject,
        startHit,
        value,
        session.fontSizePx,
        session.correctionLayerId,
      ).project
    }
  }
  return nextProject
}
