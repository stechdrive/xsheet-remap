import type { Dispatch, SetStateAction } from 'react'
import type { TimedRangeRole } from '@xsheet-remap/core'
import type { TimedRangeLaneHeaderMenuState, TimelineLaneEditorState } from './app-foundation'

export function createTimelineLaneEditorActions(options: {
  editor: TimelineLaneEditorState | null
  setEditor: Dispatch<SetStateAction<TimelineLaneEditorState | null>>
  setHeaderMenu: Dispatch<SetStateAction<TimedRangeLaneHeaderMenuState | null>>
  onUpdate: (role: TimedRangeRole, laneId: string, label: string) => void
}) {
  function runTimedRangeLaneHeaderMenuAction(action: () => void) {
    action()
    options.setHeaderMenu(null)
  }

  function openTimelineLaneEditor(state: TimedRangeLaneHeaderMenuState, mode: 'rename') {
    options.setEditor({
      ...state,
      mode,
      initialName: state.label,
    })
    options.setHeaderMenu(null)
  }

  function submitTimelineLaneEditor(label: string) {
    if (!options.editor) return
    options.onUpdate(options.editor.role, options.editor.laneId, label)
    options.setEditor(null)
  }

  return { runTimedRangeLaneHeaderMenuAction, openTimelineLaneEditor, submitTimelineLaneEditor }
}
