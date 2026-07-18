import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import type { SheetRevisionDocument } from '@xsheet-remap/core'
import { Tooltip } from './Tooltip'

type SheetHistoryBarProps = {
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

export function SheetHistoryBar(props: SheetHistoryBarProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'duplicate' | 'blank'>('duplicate')
  const [showSourceReference, setShowSourceReference] = useState(true)
  const [context, setContext] = useState<ContextState>(null)
  const contextRef = useRef<HTMLDivElement | null>(null)
  const activeRevision = props.revisions.find(revision => revision.revisionId === props.activeRevisionId) ?? props.revisions[0]
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

  function submitAdd(event: FormEvent) {
    event.preventDefault()
    const normalized = name.trim()
    if (!normalized) return
    props.onAdd({ name: normalized, mode, showSourceReference })
    setAddOpen(false)
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
    <div className="sheetHistoryBar" aria-label="シート履歴">
      <span className="sheetHistoryLabel">シート履歴</span>
      <div className="sheetHistoryTabs" role="tablist" aria-label="シート履歴">
        {props.revisions.map((revision, index) => {
          const active = revision.revisionId === props.activeRevisionId
          const reference = revision.reference
            ? props.revisions.find(candidate => candidate.revisionId === revision.reference?.revisionId)
            : undefined
          const overflowFrames = reference
            ? Math.max(0, reference.logicalSheet.durationFrames - revision.logicalSheet.durationFrames)
            : 0
          const tab = (
            <button
              key={revision.revisionId}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={revision.name || (index === 0 ? '現在のシート' : '名前のないシート')}
              className={active ? 'sheetHistoryTab active' : 'sheetHistoryTab'}
              onClick={() => props.onSwitch(revision.revisionId)}
              onDoubleClick={() => rename(revision)}
              onContextMenu={event => openContext(event, revision.revisionId)}
            >
              {revision.name ? <span className="sheetHistoryTabName">{revision.name}</span> : <SheetIcon />}
              {revision.protected && <span className="sheetHistoryTabState" aria-label="保護中">⌑</span>}
              {revision.reference && <span className="sheetHistoryTabState reference" aria-label="下敷き表示中">◫</span>}
              {overflowFrames > 0 && <span className="sheetHistoryReferenceOverflow">下敷き +{overflowFrames}K</span>}
            </button>
          )
          return revision.name ? tab : <Tooltip key={revision.revisionId} label={index === 0 ? '現在のシート' : '名前のないシート'}>{tab}</Tooltip>
        })}
      </div>
      <Tooltip label="シートを追加">
        <button type="button" className="sheetHistoryAddButton" onClick={openAdd} aria-label="シートを追加">＋</button>
      </Tooltip>

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
              if (window.confirm(`「${contextRevision.name || '現在のシート'}」を削除しますか？`)) props.onDelete(contextRevision.revisionId)
              setContext(null)
            }}
          >
            削除
          </button>
        </div>
      )}

      {addOpen && (
        <div className="sheetHistoryDialogBackdrop" role="presentation" onPointerDown={() => setAddOpen(false)}>
          <form className="sheetHistoryDialog" role="dialog" aria-modal="true" aria-labelledby="sheet-history-dialog-title" onSubmit={submitAdd} onPointerDown={event => event.stopPropagation()}>
            <h2 id="sheet-history-dialog-title">シートを追加</h2>
            <label>
              <span>名前</span>
              <input autoFocus value={name} list={suggestionId} onChange={event => setName(event.currentTarget.value)} />
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
              <button type="button" onClick={() => setAddOpen(false)}>キャンセル</button>
              <button type="submit" className="primary" disabled={!name.trim()}>追加</button>
            </div>
          </form>
        </div>
      )}
      {activeRevision?.protected && <span className="sheetHistoryProtectedNotice">編集保護中</span>}
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
