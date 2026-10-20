import { useEffect, useMemo, useState } from 'react'
import {
  assertPaperTranscriptionContext, buildPaperTranscriptionPrompt, buildPaperTranscriptionRepairPrompt,
  createPaperTranscriptionRequest, logicalSheetDisplayFrameStart, logicalSheetDisplayFrameEnd,
  parsePaperTranscription, planPaperTranscriptionImport,
  type CutProject, type PaperTranscriptionImportOptions, type PaperTranscriptionRequest,
  type PaperTranscriptionResult, type PaperTranscriptionRun, type SheetTemplate,
} from '@xsheet-remap/core'
import { saveBinaryFile, saveTextFile, writeClipboardText } from '@xsheet-remap/adapters'
import { useModalDialogKeyboardBoundary } from './useModalDialogKeyboardBoundary'
import { PaperTranscriptionReview } from './PaperTranscriptionReview'
import { PaperTranscriptionPreview } from './PaperTranscriptionPreview'
import { paperTranscriptionImageArchive } from './paperTranscriptionImages'

export interface PaperTranscriptionDialogProps {
  open: boolean
  project: CutProject
  template: SheetTemplate
  scopeKey: string
  runtimeImageUrls: Record<string, string>
  initialRange: { from: number; to: number }
  onClose: () => void
  onApply: (request: PaperTranscriptionRequest, result: PaperTranscriptionResult, options: PaperTranscriptionImportOptions) => void
}
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)

function restoreSession(key: string, props: PaperTranscriptionDialogProps) {
  let source = '', warning = ''
  let request: PaperTranscriptionRequest | null = null
  try {
    const stored = localStorage.getItem(key)
    if (stored) {
      const data = JSON.parse(stored) as { request: PaperTranscriptionRequest; source: string }
      if (typeof data.source === 'string' && data.source.length <= 2_000_000) source = data.source
      const next = createPaperTranscriptionRequest(props.project, props.template, props.scopeKey, data.request.selection, data.request.requestId)
      if (data.request.context !== next.context) throw new Error('保存済みの解析依頼と現在のシートが異なります。対象を確認して新しい依頼を作成してください。入力JSONは保持しています。')
      request = next
    }
  } catch (reason) { warning = `解析依頼の復元: ${errorText(reason)}` }
  return { request, source, warning }
}

/** Remains mounted while closed. Parent keys it by cut, revision and process. */
export function PaperTranscriptionDialog(props: PaperTranscriptionDialogProps) {
  const { project, template, scopeKey, open, onClose } = props
  const storageKey = `xsheet-paper-transcription-v1:${project.projectId}:${scopeKey}:${project.logicalSheet.processTimings?.activeProcessId ?? 'base'}`
  const [initial] = useState(() => restoreSession(storageKey, props))
  const [request, setRequest] = useState(initial.request)
  const [selection, setSelection] = useState<PaperTranscriptionRequest['selection']>(() => initial.request?.selection ?? {
    roles: ['action', 'cell'], columns: project.logicalSheet.paperTracks.slice(0, 1).map(track => track.paperTrack),
    from: props.initialRange.from, to: props.initialRange.to,
  })
  const [source, setSource] = useState(initial.source)
  const [tab, setTab] = useState<'request' | 'result'>('request')
  const [result, setResult] = useState<PaperTranscriptionResult | null>(null)
  const [reviewGeneration, setReviewGeneration] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [activeTarget, setActiveTarget] = useState('')
  const [focusedRun, setFocusedRun] = useState<PaperTranscriptionRun>()
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(initial.warning)
  const [storageError, setStorageError] = useState('')
  const dialog = useModalDialogKeyboardBoundary<HTMLDivElement>(onClose, open)
  const requestError = useMemo(() => {
    if (!request) return ''
    try { assertPaperTranscriptionContext(request, project, template, scopeKey); return '' }
    catch (reason) { return errorText(reason) }
  }, [request, project, template, scopeKey])
  const prompt = useMemo(() => request ? buildPaperTranscriptionPrompt(request) : '', [request])
  const plan = useMemo(() => {
    if (!request || !result) return null
    try { return { value: planPaperTranscriptionImport(project, template, scopeKey, request, result, { targetIds: selected, replaceExisting }), error: '' } }
    catch (reason) { return { value: null, error: errorText(reason) } }
  }, [project, template, scopeKey, request, result, selected, replaceExisting])
  useEffect(() => {
    if (!request) return
    // Persist now, report the external storage result after React's effect phase.
    let message = ''
    try { localStorage.setItem(storageKey, JSON.stringify({ request, source })) }
    catch { message = 'この端末に依頼を保存できませんでした。閉じる前にプロンプトと結果JSONを保存してください。' }
    let current = true
    queueMicrotask(() => { if (current) setStorageError(message) })
    return () => { current = false }
  }, [request, source, storageKey])

  function prepare() {
    if (request && !requestError && JSON.stringify(request.selection) === JSON.stringify(selection)) return request
    const id = globalThis.crypto?.randomUUID?.() ?? `paper-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const next = createPaperTranscriptionRequest(project, template, scopeKey, selection, id)
    setRequest(next); setResult(null); setReviewed(false); setActiveTarget(next.targets[0]!.targetId)
    return next
  }
  async function perform(action: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  async function sendPrompt(file: boolean) {
    const next = prepare(), text = buildPaperTranscriptionPrompt(next)
    if (file) {
      const saved = await saveTextFile(text, '紙シート解析プロンプト.txt', 'text/plain;charset=utf-8', { extensions: ['txt'] })
      if (saved.saved) setNotice('解析プロンプトを保存しました。紙シート画像と一緒にAIチャットへ添付してください。')
    } else {
      await writeClipboardText(text)
      setNotice('解析プロンプトをコピーしました。紙シート画像と一緒にAIチャットへ渡してください。')
    }
  }
  function validate() {
    setError(''); setNotice(''); setReviewed(false); setResult(null); setFocusedRun(undefined)
    try {
      if (!request) throw new Error('先に「AIに渡す」で解析依頼を作成してください。')
      assertPaperTranscriptionContext(request, project, template, scopeKey)
      const parsed = parsePaperTranscription(source, request)
      setReviewGeneration(value => value + 1)
      setResult(parsed); setSelected(parsed.targets.map(target => target.targetId)); setActiveTarget(parsed.targets[0]!.targetId)
    } catch (reason) { setError(errorText(reason)) }
  }
  function updateResult(next: PaperTranscriptionResult) {
    setResult(next); setSource(JSON.stringify(next, null, 2)); setReviewed(false); setError('')
  }
  function apply() {
    if (!request || !result || !plan?.value?.changed || !reviewed) return
    try {
      props.onApply(request, result, { targetIds: selected, replaceExisting })
      setResult(null); setReviewed(false); setNotice('読み取り結果を反映しました。一度のUndoで戻せます。')
    } catch (reason) { setError(errorText(reason)) }
  }
  if (!open) return null
  const target = request?.targets.find(target => target.targetId === activeTarget) ?? request?.targets[0]
  return <div className="dialogBackdrop paperAiBackdrop" role="dialog" aria-modal="true" aria-label="紙シートのAI読み取り" ref={dialog}>
    <section className="paperAiDialog">
      <header><div><strong>紙シートのAI読み取り</strong><small>お使いのAIチャットに、プロンプトと紙シート画像を渡します。</small></div><button type="button" onClick={onClose}>閉じる</button></header>
      <div className="paperAiTabs" role="tablist" aria-label="AI読み取りの操作">
        <button type="button" role="tab" id="paperAiRequestTab" aria-selected={tab === 'request'} aria-controls="paperAiRequestPanel" onClick={() => setTab('request')}>AIに渡す</button>
        <button type="button" role="tab" id="paperAiResultTab" aria-selected={tab === 'result'} aria-controls="paperAiResultPanel" onClick={() => setTab('result')}>結果を取り込む</button>
      </div>
      <div className="paperAiBody">
        {tab === 'request' ? <div role="tabpanel" id="paperAiRequestPanel" aria-labelledby="paperAiRequestTab">
          <p>テンプレート：<strong>{template.name}</strong> / {project.logicalSheet.fps} fps</p>
          <fieldset disabled={busy}><legend>読み取る対象</legend>
            <div className="paperAiChoices">{(['action', 'cell'] as const).map(role => <label key={role}><input type="checkbox" checked={selection.roles.includes(role)} onChange={event => setSelection({ ...selection, roles: event.target.checked ? [...selection.roles, role] : selection.roles.filter(value => value !== role) })} /> {role.toUpperCase()}</label>)}</div>
            <div className="paperAiChoices" aria-label="読み取る列">{project.logicalSheet.paperTracks.map(track => <label key={track.paperTrack}><input type="checkbox" checked={selection.columns.includes(track.paperTrack)} onChange={event => setSelection({ ...selection, columns: event.target.checked ? [...selection.columns, track.paperTrack] : selection.columns.filter(value => value !== track.paperTrack) })} /> {track.label || track.paperTrack}</label>)}</div>
            <div className="paperAiRange"><label>開始コマ<input aria-label="開始コマ" type="number" value={selection.from} min={logicalSheetDisplayFrameStart(project.logicalSheet)} max={logicalSheetDisplayFrameEnd(project.logicalSheet)} onChange={event => setSelection({ ...selection, from: Number(event.target.value) })} /></label><label>終了コマ<input aria-label="終了コマ" type="number" value={selection.to} min={selection.from} max={logicalSheetDisplayFrameEnd(project.logicalSheet)} onChange={event => setSelection({ ...selection, to: Number(event.target.value) })} /></label></div>
          </fieldset>
          <div className="paperAiActions"><button className="primary" disabled={busy} onClick={() => void perform(() => sendPrompt(false))}>プロンプトをコピー</button><button disabled={busy} onClick={() => void perform(() => sendPrompt(true))}>テキストファイルを保存…</button></div>
          <p>手元のスキャン画像を直接チャットに添付できます。対象やテンプレートを変えてコピーすると、新しい依頼になります。</p>
          <button disabled={busy} onClick={() => void perform(async () => {
            const next = prepare()
            const bytes = await paperTranscriptionImageArchive(project, template, props.runtimeImageUrls, next)
            const saved = await saveBinaryFile(bytes, '紙シートAI読み取り.zip', 'application/zip', { extensions: ['zip'] })
            if (saved.saved) setNotice('画像セットを保存しました。ZIPを展開し、プロンプトと全体・拡大画像をチャットに添付してください。')
          })}>登録済み画像とプロンプトをまとめて保存…</button>
          <p className="muted">紙シートメニューで登録・補正した画像から、全体画像と周囲を残した拡大画像を作ります。</p>
          {request && <details><summary>プロンプトを確認する（{prompt.length.toLocaleString()}文字）</summary><textarea aria-label="解析プロンプト" value={prompt} readOnly rows={12} /></details>}
        </div> : <div role="tabpanel" id="paperAiResultPanel" aria-labelledby="paperAiResultTab">
          <label>AIから返ってきたJSON<textarea aria-label="AIから返ってきたJSON" value={source} maxLength={2_000_000} rows={result ? 4 : 10} onChange={event => { setSource(event.target.value); setResult(null); setReviewed(false); setError('') }} placeholder="返答のJSONをここへ貼り付けます。" /></label>
          <div className="paperAiActions"><label className="fileButton">JSONファイルを開く…<input type="file" accept=".json,application/json,text/plain" disabled={busy} onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ''
            if (file) void perform(async () => {
              if (file.size > 8_000_000) throw new Error('JSONファイルが大きすぎます。対象を分けてください。')
              const text = await file.text()
              if (text.length > 2_000_000) throw new Error('JSONは2,000,000文字以内に分けてください。')
              setSource(text); setResult(null); setReviewed(false)
            })
          }} /></label><button className="primary" disabled={busy || !source.trim() || !request} onClick={validate}>内容を確認する</button>
          {source && <button disabled={busy} onClick={() => void perform(async () => { await saveTextFile(source, '紙シート読み取り結果.json', 'application/json', { extensions: ['json'] }) })}>結果JSONを保存…</button>}</div>
          {!request && <p>「AIに渡す」でプロンプトをコピーまたは保存して、解析依頼を作成してください。</p>}
          {result && request && target && <div className="paperAiReviewLayout">
            <div><PaperTranscriptionReview key={reviewGeneration} request={request} result={result} activeTarget={activeTarget} onTarget={setActiveTarget} onFocusRun={setFocusedRun} onChange={updateResult} selected={selected} onSelect={ids => { setSelected(ids); setReviewed(false) }} />
              <label><input type="checkbox" checked={replaceExisting} onChange={event => { setReplaceExisting(event.target.checked); setReviewed(false) }} /> 選択した範囲の既存記入を置き換える</label>
              <p className="muted">範囲内の記入を転記結果に揃えます。範囲外への継続は元に戻す指定を補います。</p>
              {plan?.value && <p>対象 {plan.value.targets} / 記入 {plan.value.recordedMarks} / 置き換え {plan.value.replacedMarks} / 継続を戻す指定 {plan.value.boundaryMarks}</p>}
              {plan?.error && <p className="paperAiError" role="alert">{plan.error}</p>}
              {plan?.value && !plan.value.changed && <p>既存の記入と同じです。反映する変更はありません。</p>}
              <label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> 原画像と対象範囲を確認しました</label>
            </div>
            <PaperTranscriptionPreview project={project} template={template} urls={props.runtimeImageUrls} target={target} run={focusedRun} />
          </div>}
        </div>}
        {requestError && <p className="paperAiError" role="alert">{requestError}</p>}
        {error && <div className="paperAiError" role="alert"><pre>{error}</pre>{request && source && tab === 'result' && <button disabled={busy} onClick={() => void perform(async () => { await writeClipboardText(buildPaperTranscriptionRepairPrompt(request, error, source)); setNotice('仕様とエラーを含む修正依頼をコピーしました。') })}>修正依頼をコピー</button>}</div>}
        {storageError && <p role="alert">{storageError}</p>}
        {notice && <p role="status">{notice}</p>}
        {busy && <p role="status">準備しています…</p>}
      </div>
      <footer><button onClick={onClose}>閉じる</button>{tab === 'result' && <button className="primary" disabled={busy || !reviewed || !plan?.value?.changed || !!requestError} onClick={apply}>確認した内容を反映</button>}</footer>
    </section>
  </div>
}
