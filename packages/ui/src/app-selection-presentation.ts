import {
  timingHitForFrame,
  type CutProject,
  type SheetHit,
  type SheetTemplate,
  type TimedRangeCue,
} from '@xsheet-remap/core'
import type { EditMode, Panel, SheetRangeSelection } from './appTypes'
import {
  formatFramePosition,
  formatFrameRangePosition,
  formatPaddedDurationTimecode,
  formatPaddedFrameTimecode,
} from './app-foundation'
import { paperTrackOrderForRole } from './app-sheet-geometry'
import { uiText } from './i18n'
import { sheetRoleForHit, sheetRoleLabel } from './sheetInteraction'
import { isPointEventRangeForUi, rangePaperTracks } from './timingEditing'

export function inputHitForRange(
  project: CutProject,
  template: SheetTemplate,
  range: SheetRangeSelection,
  durationFrames: number,
  frameOrigin: number,
): SheetHit {
  if (isPointEventRangeForUi(range)) {
    const paperTrack = rangePaperTracks(range)[0] ?? range.paperTrack
    const hit = timingHitForFrame(
      template,
      range.role,
      paperTrack,
      range.frameStart,
      durationFrames,
      frameOrigin,
      paperTrackOrderForRole(project, range.role),
    )
    if (hit) return hit
  }
  if (range.anchorHit.frame === range.frameStart) return range.anchorHit
  if (range.focusHit.frame === range.frameStart) return range.focusHit
  return range.anchorHit
}

export function buildSelectionPresentation({
  project,
  rangeSelection,
  selectedCue,
  selectedHit,
  correctionLayerLabel,
  panel,
  editMode,
  hasTimingClipboard,
  hasSelectedTimelineEvent,
}: {
  project: CutProject
  rangeSelection: SheetRangeSelection | null
  selectedCue: TimedRangeCue | null
  selectedHit: SheetHit | null
  correctionLayerLabel: string
  panel: Panel
  editMode: EditMode
  hasTimingClipboard: boolean
  hasSelectedTimelineEvent: boolean
}) {
  const selectedFrameSummary = rangeSelection
    ? formatFrameRangePosition(project, rangeSelection.frameStart, rangeSelection.frameEnd)
    : selectedCue
      ? formatFrameRangePosition(project, selectedCue.frameStart, selectedCue.frameEnd)
      : selectedHit
        ? formatFramePosition(project, selectedHit.frame)
        : '-'
  const rangeSummary = rangeSelection
    ? `${rangeSelection.role.toUpperCase()} ${rangeSelection.paperTrack ?? rangeSelection.columnId} ${selectedFrameSummary}`
    : null
  const rangeTimingStatus = rangeSelection
    ? `${uiText.sheet.rangeStart} ${formatPaddedFrameTimecode(project, rangeSelection.frameStart)} / ${uiText.sheet.rangeEnd} ${formatPaddedFrameTimecode(project, rangeSelection.frameEnd)} / ${uiText.sheet.rangeDuration} ${formatPaddedDurationTimecode(project, rangeSelection.frameEnd - rangeSelection.frameStart + 1)}`
    : null
  const statusSelectionText = rangeSummary
    ? `${correctionLayerLabel} / ${rangeSummary} / ${rangeTimingStatus}`
    : selectedCue
      ? `${selectedCue.role.toUpperCase()} / ${selectedCue.label} / ${selectedFrameSummary}`
      : selectedHit
        ? `${correctionLayerLabel} / ${sheetRoleLabel(sheetRoleForHit(selectedHit))} ${selectedHit.paperTrack ?? '-'} ${selectedFrameSummary}`
        : `${correctionLayerLabel} / ${uiText.app.noCellSelected}`
  const statusFallbackHint = panel === 'sheet'
    ? editMode === 'calibrate'
      ? uiText.statusHints.calibrateMode
      : editMode === 'pen'
        ? uiText.statusHints.penMode
        : editMode === 'eraser'
          ? uiText.statusHints.eraserMode
          : editMode === 'text'
            ? uiText.statusHints.textMode
            : rangeSelection
              ? uiText.statusHints.selectedRange(hasTimingClipboard)
              : selectedHit
                ? uiText.statusHints.selectedCell(hasSelectedTimelineEvent)
                : uiText.statusHints.sheetIdle
    : ''
  return { selectedFrameSummary, statusSelectionText, statusFallbackHint }
}
