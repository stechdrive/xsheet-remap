import {
  addTimelineLane,
  deleteTimelineLane,
  updateTimelineLane,
  type CutProject,
  type TimedRangeRole,
} from '@xsheet-remap/core'
import { errorMessage } from './app-foundation'

export function createAppTimelineLaneActions(options: {
  getProject: () => CutProject
  commitProject: (project: CutProject) => void
  clearSelection: () => void
}) {
  function handleAddTimelineLane(input: { role: TimedRangeRole; label: string; insertAfterLaneId?: string }) {
    try {
      options.commitProject(addTimelineLane(options.getProject(), input).project)
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  function handleUpdateTimelineLane(role: TimedRangeRole, laneId: string, label: string) {
    try {
      options.commitProject(updateTimelineLane(options.getProject(), role, laneId, { label }))
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  function handleDeleteTimelineLane(role: TimedRangeRole, laneId: string) {
    const project = options.getProject()
    const lane = project.logicalSheet.timelineSections
      .find(section => section.role === role)?.lanes?.find(candidate => candidate.laneId === laneId)
    if (!lane) return
    const cueCount = project.timedRangeCues.filter(cue => cue.role === role && cue.laneId === laneId).length
    if (cueCount > 0 && !window.confirm(`${lane.label}列と、この列の指示${cueCount}件を削除します。よろしいですか？`)) return
    try {
      options.commitProject(deleteTimelineLane(project, role, laneId))
      options.clearSelection()
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  return { handleAddTimelineLane, handleUpdateTimelineLane, handleDeleteTimelineLane }
}
