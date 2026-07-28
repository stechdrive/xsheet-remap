interface SheetTouchControlsProps {
  visible: boolean
  timingInputVisible: boolean
  timingInputDisabled: boolean
  timingDraftValue: string
  timingDisplayValue: string
  rangeSelectionMode: boolean
  contextMenuAvailable: boolean
  onTimingCharacter: (character: string) => void
  onTimingBackspace: () => void
  onTimingCommit: () => void
  onTimingMove: (trackDelta: number, frameDelta: number) => void
  onToggleRangeSelectionMode: () => void
  onOpenContextMenu: (anchor: HTMLElement) => void
  onClose: () => void
}

const timingKeys = [
  ['7', '7'], ['8', '8'], ['9', '9'],
  ['4', '4'], ['5', '5'], ['6', '6'],
  ['1', '1'], ['2', '2'], ['3', '3'],
  ['空', 'x'], ['0', '0'], ['中割', '/'], ['逆', '.'],
] as const

export function SheetTouchControls({
  visible,
  timingInputVisible,
  timingInputDisabled,
  timingDraftValue,
  timingDisplayValue,
  rangeSelectionMode,
  contextMenuAvailable,
  onTimingCharacter,
  onTimingBackspace,
  onTimingCommit,
  onTimingMove,
  onToggleRangeSelectionMode,
  onOpenContextMenu,
  onClose,
}: SheetTouchControlsProps) {
  if (!visible) return null
  const displayValue = timingDraftValue || timingDisplayValue || '入力待ち'

  return (
    <div
      className="sheetTouchControls"
      data-timing-edit-boundary="manual"
      aria-label="タッチ操作"
    >
      <div className="sheetTouchCommandBar">
        <button
          type="button"
          className={rangeSelectionMode ? 'active' : ''}
          aria-label="指で範囲選択"
          aria-pressed={rangeSelectionMode}
          onClick={onToggleRangeSelectionMode}
        >
          範囲
        </button>
        <button
          type="button"
          aria-label="シート操作メニュー"
          disabled={!contextMenuAvailable}
          onClick={event => onOpenContextMenu(event.currentTarget)}
        >
          …
        </button>
        <button type="button" aria-label="タッチ操作を閉じる" onClick={onClose}>×</button>
      </div>

      {timingInputVisible && (
        <div className="sheetTouchTimingPad" role="group" aria-label="タッチタイミング入力">
          <output className="sheetTouchTimingValue" aria-live="polite">{displayValue}</output>
          <div className="sheetTouchTimingKeys">
            {timingKeys.map(([label, value]) => (
              <button
                key={value}
                type="button"
                aria-label={`タイミング ${label}`}
                disabled={timingInputDisabled}
                onClick={() => onTimingCharacter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="sheetTouchTimingActions">
            <button
              type="button"
              aria-label="入力を1文字戻す"
              disabled={timingInputDisabled}
              onClick={onTimingBackspace}
            >
              ⌫
            </button>
            <button
              type="button"
              className="primary"
              aria-label="入力を確定して次へ"
              disabled={timingInputDisabled}
              onClick={onTimingCommit}
            >
              確定↓
            </button>
          </div>
          <div className="sheetTouchTimingNavigation" aria-label="セル移動">
            <button type="button" aria-label="選択を上へ" onClick={() => onTimingMove(0, -1)}>↑</button>
            <button type="button" aria-label="選択を左へ" onClick={() => onTimingMove(-1, 0)}>←</button>
            <button type="button" aria-label="選択を下へ" onClick={() => onTimingMove(0, 1)}>↓</button>
            <button type="button" aria-label="選択を右へ" onClick={() => onTimingMove(1, 0)}>→</button>
          </div>
        </div>
      )}
    </div>
  )
}
