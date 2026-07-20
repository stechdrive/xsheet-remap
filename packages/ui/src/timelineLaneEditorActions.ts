import type { Dispatch, SetStateAction } from 'react'
import type { LogicalTimelineLane, TimedRangeRole } from '@xsheet-remap/core'
import type { TimedRangeLaneHeaderMenuState, TimelineLaneEditorState } from './app-foundation'

export function createTimelineLaneEditorActions(options: {
  timelineLanes: Partial<Record<TimedRangeRole, LogicalTimelineLane[]>>
  editor: TimelineLaneEditorState | null
  setEditor: Dispatch<SetStateAction<TimelineLaneEditorState | null>>
  setHeaderMenu: Dispatch<SetStateAction<TimedRangeLaneHeaderMenuState | null>>
  onAdd: (input: { role: TimedRangeRole; label: string; insertAfterLaneId?: string }) => void
  onUpdate: (role: TimedRangeRole, laneId: string, label: string) => void
}) {
  function runTimedRangeLaneHeaderMenuAction(action: () => void) {
    action()
    options.setHeaderMenu(null)
  }

  function openTimelineLaneEditor(state: TimedRangeLaneHeaderMenuState, mode: 'add' | 'rename') {
    const sequence = (options.timelineLanes[state.role]?.length ?? 0) + 1
    options.setEditor({
      ...state,
      mode,
      initialName: mode === 'rename' ? state.label : state.role === 'sound' ? `S${sequence}` : String(sequence),
      insertAfterLaneId: mode === 'add' ? state.laneId : undefined,
    })
    options.setHeaderMenu(null)
  }

  function submitTimelineLaneEditor(label: string) {
    if (!options.editor) return
    if (options.editor.mode === 'add') {
      options.onAdd({ role: options.editor.role, label, insertAfterLaneId: options.editor.insertAfterLaneId })
    } else {
      options.onUpdate(options.editor.role, options.editor.laneId, label)
    }
    options.setEditor(null)
  }

  return { runTimedRangeLaneHeaderMenuAction, openTimelineLaneEditor, submitTimelineLaneEditor }
}
