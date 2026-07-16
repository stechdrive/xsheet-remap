import { applyCutTimelineFrameEdit, type CutProject, type SheetHit, type SheetTimingRole } from '@xsheet-remap/core'
import type { SheetRangeSelection } from './appTypes'
import type { FrameOperationDialogState, FrameOperationKind, FrameOperationSubmit } from './app-foundation'
import { deleteTimelineFrames, insertTimelineFrames, rangeContainsHit, rangePaperTracks } from './timingEditing'

export function frameOperationRangeContainsHit(range: SheetRangeSelection | null, hit: SheetHit): boolean {
  if (!range || range.role !== hit.role || hit.frame < range.frameStart || hit.frame > range.frameEnd) return false
  return hit.role === 'action' || hit.role === 'cell'
    ? rangeContainsHit(range, hit)
    : range.columnId === hit.columnId
}

export function frameOperationDialogStateForHit(
  kind: FrameOperationKind,
  hit: SheetHit,
  range: SheetRangeSelection | null,
): FrameOperationDialogState | null {
  const role = hit.role
  if (role !== 'action' && role !== 'cell' && role !== 'sound' && role !== 'camera') return null
  if ((role === 'action' || role === 'cell') && !hit.paperTrack) return null
  const sourceRange = frameOperationRangeContainsHit(range, hit) ? range : null
  return {
    kind,
    role,
    paperTrack: hit.paperTrack ?? '',
    paperTracks: role === 'action' || role === 'cell'
      ? sourceRange ? rangePaperTracks(sourceRange) : [hit.paperTrack as string]
      : [],
    frameStart: sourceRange?.frameStart ?? hit.frame,
    frameEnd: sourceRange?.frameEnd ?? hit.frame,
    sourceHit: hit,
    sourceRange,
  }
}

export function applyFrameOperationToProject(
  project: CutProject,
  state: FrameOperationDialogState,
  input: FrameOperationSubmit,
): CutProject {
  const frameCount = Math.max(1, Math.round(input.frameCount))
  if (input.scope === 'cut') {
    return applyCutTimelineFrameEdit(project, state.kind === 'insert'
      ? { kind: 'insert', atFrame: state.frameStart, frameCount }
      : { kind: 'delete', frameStart: state.frameStart, frameCount })
  }
  const role = pointRoleForFrameOperation(state)
  if (!role) return project
  return state.kind === 'insert'
    ? insertTimelineFrames(project, {
        scope: input.scope, role, paperTrack: state.paperTrack, paperTracks: state.paperTracks,
        atFrame: state.frameStart, frameCount, durationPolicy: 'preserve',
      })
    : deleteTimelineFrames(project, {
        scope: input.scope, role, paperTrack: state.paperTrack, paperTracks: state.paperTracks,
        frameStart: state.frameStart, frameCount, durationPolicy: 'preserve',
      })
}

export function pointRoleForFrameOperation(state: FrameOperationDialogState): SheetTimingRole | null {
  return state.role === 'action' || state.role === 'cell' ? state.role : null
}
