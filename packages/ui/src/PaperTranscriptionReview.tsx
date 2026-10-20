import { useState } from 'react'
import { PAPER_TRANSCRIPTION_KINDS, paperTranscriptionKindLabels, type PaperTranscriptionKind, type PaperTranscriptionRequest, type PaperTranscriptionResult, type PaperTranscriptionRun } from '@xsheet-remap/core'

export function revisePaperTranscriptionRun(runs: PaperTranscriptionRun[], index: number, kind: PaperTranscriptionKind, value: string, frame: number): PaperTranscriptionRun[] {
  const original = runs[index]!
  const point = ['cell', 'blank', 'inbetween', 'reverse'].includes(kind)
  if (point && (!Number.isSafeInteger(frame) || frame < original.from || frame > original.to)) throw new Error('記入のコマを元の区間内で指定してください。')
  if (kind === 'cell' && !value.trim()) throw new Error('セル番号を入力してください。')
  const changed: PaperTranscriptionRun = {
    from: point ? frame : original.from, to: point ? frame : original.to, kind,
    raw: kind === 'empty' ? '' : original.raw,
    ...(kind === 'cell' ? { value: value.trim() } : {}),
    note: `ユーザーが確認・修正。元の記録: ${original.raw}${original.note ? ` / ${original.note}` : ''}`.slice(0, 1000),
  }
  const remaining = (from: number, to: number): PaperTranscriptionRun => ({ from, to, kind: 'uncertain', raw: '', note: '記入位置を確定した後の残りのコマです。記入なし・継続等を確認してください。' })
  return [...runs.slice(0, index),
    ...(point && frame > original.from ? [remaining(original.from, frame - 1)] : []),
    changed,
    ...(point && frame < original.to ? [remaining(frame + 1, original.to)] : []),
    ...runs.slice(index + 1)]
}

export function PaperTranscriptionReview({ request, result, activeTarget, onTarget, onFocusRun, onChange, selected, onSelect }: {
  request: PaperTranscriptionRequest; result: PaperTranscriptionResult
  activeTarget: string; onTarget: (id: string) => void; onFocusRun: (run: PaperTranscriptionRun | undefined) => void
  onChange: (result: PaperTranscriptionResult) => void
  selected: string[]; onSelect: (ids: string[]) => void
}) {
  const target = request.targets.find(target => target.targetId === activeTarget) ?? request.targets[0]!
  const entry = result.targets.find(entry => entry.targetId === target.targetId)!
  const [offset, setOffset] = useState(0)
  const [edit, setEdit] = useState<{ index: number; kind: PaperTranscriptionKind; value: string; frame: number } | null>(null)
  const [error, setError] = useState('')
  function selectTarget(id: string) { onTarget(id); onFocusRun(undefined); setOffset(0); setEdit(null); setError('') }
  function revise() {
    if (!edit) return
    try {
      const runs = revisePaperTranscriptionRun(entry.runs, edit.index, edit.kind, edit.value, edit.frame)
      onChange({ ...result, targets: result.targets.map(item => item.targetId === target.targetId ? { ...item, runs } : item) })
      setEdit(null); onFocusRun(undefined); setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  return <div className="paperAiReview">
    <label>確認する対象<select aria-label="確認する対象" value={target.targetId} onChange={event => selectTarget(event.target.value)}>
      {request.targets.map(item => {
        const unresolved = result.targets.find(entry => entry.targetId === item.targetId)!.runs.some(run => run.kind === 'uncertain' || run.kind === 'unread')
        return <option key={item.targetId} value={item.targetId}>{item.pageNumber}頁 {item.label} {item.columnLabel}列 {item.from}–{item.to}F{unresolved ? '（要確認・未読あり）' : ''}</option>
      })}
    </select></label>
    <label><input type="checkbox" checked={selected.includes(target.targetId)} onChange={event => onSelect(event.target.checked ? [...selected, target.targetId] : selected.filter(id => id !== target.targetId))} /> この対象を反映する</label>
    <p>反映対象 {selected.length} / {request.targets.length}。要確認・未読が残る対象は、修正するか反映から外してください。</p>
    <div className="paperAiTable"><table>
      <thead><tr><th>コマ</th><th>種別</th><th>読み取り</th><th>確認</th></tr></thead>
      <tbody>{entry.runs.slice(offset, offset + 80).map((run, row) => <tr key={offset + row} className={['uncertain', 'unread'].includes(run.kind) ? 'paperAiUncertain' : ''}>
        <td>{run.from === run.to ? run.from : `${run.from}–${run.to}`}</td>
        <td>{paperTranscriptionKindLabels[run.kind]}</td>
        <td><strong>{run.value ?? run.raw}</strong>{run.value && run.raw && run.raw !== run.value && <small>原表記: {run.raw}</small>}{run.note && <small>{run.note}</small>}{run.frameCandidates?.length ? <small>位置候補: {run.frameCandidates.join(', ')} F</small> : null}{run.valueCandidates?.length ? <small>文字候補: {run.valueCandidates.join(' / ')}</small> : null}</td>
        <td><button type="button" onClick={() => { onFocusRun(run); setEdit({ index: offset + row, kind: run.kind, value: run.value ?? run.valueCandidates?.[0] ?? '', frame: run.frameCandidates?.[0] ?? run.from }); setError('') }}>確認・修正</button></td>
      </tr>)}</tbody>
    </table></div>
    {entry.runs.length > 80 && <div className="paperAiActions"><button disabled={offset === 0} onClick={() => { setOffset(offset - 80); setEdit(null) }}>前へ</button><span>{offset + 1}–{Math.min(entry.runs.length, offset + 80)} / {entry.runs.length}</span><button disabled={offset + 80 >= entry.runs.length} onClick={() => { setOffset(offset + 80); setEdit(null) }}>次へ</button></div>}
    {edit && <fieldset className="paperAiRunEditor"><legend>{entry.runs[edit.index]!.from}〜{entry.runs[edit.index]!.to} F の記入を修正</legend>
      <label>確認後の種別<select aria-label="確認後の種別" value={edit.kind} onChange={event => setEdit({ ...edit, kind: event.target.value as PaperTranscriptionKind })}>{PAPER_TRANSCRIPTION_KINDS.map(kind => <option key={kind} value={kind}>{paperTranscriptionKindLabels[kind]}</option>)}</select></label>
      {['cell', 'blank', 'inbetween', 'reverse'].includes(edit.kind) && <label>記入のコマ<input aria-label="記入のコマ" type="number" min={entry.runs[edit.index]!.from} max={entry.runs[edit.index]!.to} value={edit.frame} onChange={event => setEdit({ ...edit, frame: Number(event.target.value) })} /></label>}
      {edit.kind === 'cell' && <label>セル番号<input aria-label="確認後のセル番号" maxLength={100} value={edit.value} onChange={event => setEdit({ ...edit, value: event.target.value })} /></label>}
      <p className="muted">区間内の一コマに記入を確定すると、残りのコマは要確認として分割します。</p>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={revise}>修正を反映</button>
    </fieldset>}
  </div>
}
