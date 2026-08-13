import { useState } from 'react'
import { floatingEditorStyle, type TimelineLaneEditorState } from './app-foundation'
import { Tooltip } from './Tooltip'
import { useFloatingEditorBoundary } from './useFloatingEditorBoundary'

export function TimelineLaneEditorPopover({
  state,
  onSubmit,
  onCancel,
}: {
  state: TimelineLaneEditorState
  onSubmit: (label: string) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState(state.initialName)
  const { rootRef, handleKeyDown, completeWithSheetFocus } = useFloatingEditorBoundary<HTMLFormElement>(onCancel)
  const roleLabel = state.role === 'sound' ? 'SOUND' : 'CAMERA'
  return (
    <form
      ref={rootRef}
      className="paperTrackEditorPopover timelineLaneEditorPopover"
      data-workspace-keyboard-scope="editor"
      style={floatingEditorStyle(state.x, state.y)}
      aria-label={`${roleLabel}列${state.mode === 'add' ? '追加' : '名前変更'}`}
      onSubmit={event => {
        event.preventDefault()
        const normalized = label.trim()
        if (normalized) completeWithSheetFocus(() => onSubmit(normalized))
      }}
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      <label>
        <span>{roleLabel}列名</span>
        <input autoFocus value={label} onChange={event => setLabel(event.currentTarget.value)} />
      </label>
      <div>
        <Tooltip label="確定">
          <button type="submit" aria-label="確定">✓</button>
        </Tooltip>
        <Tooltip label="キャンセル">
          <button type="button" aria-label="キャンセル" onClick={() => completeWithSheetFocus(onCancel)}>×</button>
        </Tooltip>
      </div>
    </form>
  )
}
