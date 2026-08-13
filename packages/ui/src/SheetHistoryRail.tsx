import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import type { SheetRevisionDocument } from '@xsheet-remap/core'
import { Tooltip } from './Tooltip'
import { useTouchLongPress } from './useTouchLongPress'
import { useModalDialogKeyboardBoundary } from './useModalDialogKeyboardBoundary'

type SheetHistoryRailProps = {
  topActions?: ReactNode
  bottomActions?: ReactNode
  revisions: SheetRevisionDocument[]
  activeRevisionId: string
  processSuggestions: string[]
  onSwitch: (revisionId: string) => void
  onAdd: (input: { name: string; mode: 'duplicate' | 'blank'; showSourceReference: boolean }) => void
  onRename: (revisionId: string, name: string | undefined) => void
  onToggleProtected: (revisionId: string, protectedState: boolean) => void
  onToggleSourceReference: (revisionId: string, enabled: boolean) => void
  onDelete: (revisionId: string) => void
}

type ContextState = { revisionId: string; x: number; y: number } | null

export function SheetHistoryRail(props: SheetHistoryRailProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'duplicate' | 'blank'>('duplicate')
  const [showSourceReference, setShowSourceReference] = useState(true)
  const [context, setContext] = useState<ContextState>(null)
  const touchLongPress = useTouchLongPress()
  const contextRef = useRef<HTMLDivElement | null>(null)
  const addDialogRef = useModalDialogKeyboardBoundary<HTMLFormElement>(closeAdd, addOpen)
  const contextRevision = context
    ? props.revisions.find(revision => revision.revisionId === context.revisionId)
    : undefined
  const sourceRevision = contextRevision?.sourceRevisionId
    ? props.revisions.find(revision => revision.revisionId === contextRevision.sourceRevisionId)
    : undefined
  const suggestionId = `sheet-history-names-${useId().replace(/:/g, '')}`

  useEffect(() => {
    if (!context) return
    const close = (event: PointerEvent) => {
      if (contextRef.current?.contains(event.target as Node)) return
      setContext(null)
    }
    const closeOnBlur = () => setContext(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', closeOnBlur)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', closeOnBlur)
    }
  }, [context])

  function openAdd() {
    setName(props.processSuggestions[0] ?? '')
    setMode('duplicate')
    setShowSourceReference(true)
    setAddOpen(true)
  }

  function closeAdd() {
    setAddOpen(false)
  }

  function submitAdd(event: FormEvent) {
    event.preventDefault()
    const normalized = name.trim()
    if (!normalized) return
    props.onAdd({ name: normalized, mode, showSourceReference })
    closeAdd()
  }

  function openContext(event: MouseEvent, revisionId: string) {
    event.preventDefault()
    setContext({ revisionId, x: event.clientX, y: event.clientY })
  }

  function rename(revision: SheetRevisionDocument) {
    setContext(null)
    const next = window.prompt('シート名', revision.name ?? '')
    if (next === null) return
    props.onRename(revision.revisionId, next.trim() || undefined)
  }

  return (
    <div className="sheetHistoryRail sheetWorkspaceRail" aria-label="シート作業レール">
      {props.topActions && (
        <div className="sheetWorkspaceRailTop" role="toolbar" aria-label="兼用カット操作">
          {props.topActions}
        </div>
      )}
      <div className="sheetHistoryTabs" role="tablist" aria-label="シート履歴" aria-orientation="vertical">
        {props.revisions.map((revision, index) => {
          const active = revision.revisionId === props.activeRevisionId
          const accessibleLabel = revision.name || `シート${index + 1}（名前なし）`
          const reference = revision.reference
            ? props.revisions.find(candidate => candidate.revisionId === revision.reference?.revisionId)
            : undefined
          const overflowFrames = reference
            ? Math.max(0, reference.logicalSheet.durationFrames - revision.logicalSheet.durationFrames)
            : 0
          return (
            <button
              key={revision.revisionId}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={accessibleLabel}
              className={active ? 'sheetHistoryTab active' : 'sheetHistoryTab'}
              onClick={() => props.onSwitch(revision.revisionId)}
              onPointerDown={event => {
                touchLongPress.begin(event, activation => {
                  props.onSwitch(revision.revisionId)
                  setContext({
                    revisionId: revision.revisionId,
                    x: activation.clientX,
                    y: activation.clientY,
                  })
                })
              }}
              onDoubleClick={() => rename(revision)}
              onContextMenu={event => openContext(event, revision.revisionId)}
            >
              {revision.name ? <span className="sheetHistoryTabName">{revision.name}</span> : <SheetIcon />}
              {revision.protected && <span className="sheetHistoryTabState" aria-label="保護中">⌑</span>}
              {revision.reference && <span className="sheetHistoryTabState reference" aria-label="下敷き表示中">◫</span>}
              {overflowFrames > 0 && <span className="sheetHistoryReferenceOverflow">下敷き +{overflowFrames}K</span>}
            </button>
          )
        })}
        <Tooltip label={'修正用シートを追加\n元のシートを残したまま、修正履歴として管理できます'}>
          <button type="button" className="sheetHistoryAddButton" onClick={openAdd} aria-label="修正用シートを追加">＋</button>
        </Tooltip>
      </div>
      {props.bottomActions && (
        <div className="sheetWorkspaceRailBottom" role="toolbar" aria-label="シート表示と編集">
          {props.bottomActions}
        </div>
      )}

      {context && contextRevision && (
        <div
          ref={contextRef}
          className="sheetHistoryContextMenu"
          role="menu"
          style={{ left: context.x, top: context.y }}
        >
          <button type="button" role="menuitem" onClick={() => rename(contextRevision)}>名前を変更</button>
          {sourceRevision && (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={contextRevision.reference?.revisionId === sourceRevision.revisionId}
              onClick={() => {
                props.onToggleSourceReference(contextRevision.revisionId, contextRevision.reference?.revisionId !== sourceRevision.revisionId)
                setContext(null)
              }}
            >
              {contextRevision.reference?.revisionId === sourceRevision.revisionId ? '元のシートを隠す' : '元のシートを薄く表示'}
            </button>
          )}
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={contextRevision.protected === true}
            onClick={() => {
              props.onToggleProtected(contextRevision.revisionId, !contextRevision.protected)
              setContext(null)
            }}
          >
            {contextRevision.protected ? '保護を解除' : '編集を保護'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            disabled={props.revisions.length <= 1 || contextRevision.protected}
            onClick={() => {
              if (window.confirm(`「${contextRevision.name || '名前のないシート'}」を削除しますか？`)) props.onDelete(contextRevision.revisionId)
              setContext(null)
            }}
          >
            削除
          </button>
        </div>
      )}

      {addOpen && (
        <div className="sheetHistoryDialogBackdrop" role="presentation" onPointerDown={closeAdd}>
          <form ref={addDialogRef} className="sheetHistoryDialog" role="dialog" aria-modal="true" aria-labelledby="sheet-history-dialog-title" data-workspace-keyboard-scope="dialog" onSubmit={submitAdd} onPointerDown={event => event.stopPropagation()}>
            <h2 id="sheet-history-dialog-title">シートを追加</h2>
            <label>
              <span>名前</span>
              <input value={name} list={suggestionId} onChange={event => setName(event.currentTarget.value)} />
              <datalist id={suggestionId}>{props.processSuggestions.map(value => <option key={value} value={value} />)}</datalist>
            </label>
            <fieldset className="sheetHistoryCreateMode">
              <button type="button" className={mode === 'duplicate' ? 'active' : ''} aria-pressed={mode === 'duplicate'} onClick={() => setMode('duplicate')}>現在のシートを引き継ぐ</button>
              <button type="button" className={mode === 'blank' ? 'active' : ''} aria-pressed={mode === 'blank'} onClick={() => setMode('blank')}>空のシートを追加</button>
            </fieldset>
            <label className="sheetHistoryReferenceOption">
              <input type="checkbox" checked={showSourceReference} onChange={event => setShowSourceReference(event.currentTarget.checked)} />
              元のシートを薄く表示
            </label>
            <div className="sheetHistoryDialogActions">
              <button type="button" onClick={closeAdd}>キャンセル</button>
              <button type="submit" className="primary" disabled={!name.trim()}>追加</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function SheetIcon() {
  return (
    <svg className="sheetHistorySheetIcon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 1.5h6.2L13 5.3v9.2H3z" />
      <path d="M9 1.8v3.7h3.7M5.2 8h5.6M5.2 10.5h5.6" />
    </svg>
  )
}
