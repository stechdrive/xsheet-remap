import { useEffect, useMemo, useRef, useState } from 'react'
import { activeCutProjectFromDocument, createDefaultProjectDocument, clipImportFolders, clipImportSettings, openClipDocument, suggestClipImportColumns, type ClipImportColumn, type ClipImportData, type ClipImportNode, type CutGroupProjectDocument, type SheetTimingRole } from '@xsheet-remap/core'
import { readClipFile, clipSourceDataUrl } from '@xsheet-remap/adapters'
import { useModalDialogKeyboardBoundary } from './useModalDialogKeyboardBoundary'

function SelectionCheckbox({ label, checked, mixed, disabled, onChange }: { label: string; checked: boolean; mixed: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed }, [mixed])
  return <input ref={ref} type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={event => onChange(event.currentTarget.checked)} />
}

export function ClipImportDialog({ file, onClose, onImport }: { file: File; document: CutGroupProjectDocument; onClose: () => void; onImport: (document: CutGroupProjectDocument) => void }) {
  const project = useMemo(() => activeCutProjectFromDocument(createDefaultProjectDocument()), [])
  const [sourceDataUrl, setSourceDataUrl] = useState('')
  const [data, setData] = useState<ClipImportData | null>(null)
  const [timelineId, setTimelineId] = useState(''), [role, setRole] = useState<SheetTimingRole>('action')
  const [timelineIds, setTimelineIds] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([]), [names, setNames] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const dialog = useModalDialogKeyboardBoundary<HTMLDivElement>(onClose)
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        if (file.size > 512 * 1024 * 1024) throw new Error('CLIPは512MB以内にしてください。')
        const bytes = new Uint8Array(await file.arrayBuffer())
        controller.signal.throwIfAborted()
        const result = await readClipFile(bytes, file.name, controller.signal)
        controller.signal.throwIfAborted()
        setSourceDataUrl(clipSourceDataUrl(bytes))
        setData(result); setTimelineId(result.currentTimelineId); setTimelineIds(result.currentTimelineId ? [result.currentTimelineId] : [])
        const timeline = result.timelines.find(item => item.id === result.currentTimelineId)!
        setSelected(clipImportFolders(result.nodes).filter(node => !timeline?.tracks.find(track => track.layerId === node.id)?.error).map(node => node.id))
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error)) }
    })()
    return () => controller.abort()
  }, [file])
  const timeline = data?.timelines.find(item => item.id === timelineId)
  const folders = useMemo(() => data ? clipImportFolders(data.nodes) : [], [data])
  const columns = useMemo<ClipImportColumn[]>(() => data ? suggestClipImportColumns(project, data.nodes, selected).map(column => ({ ...column, name: names[column.layerId] ?? column.name })) : [], [data, project, selected, names])
  const preview = useMemo(() => {
    if (!data || !sourceDataUrl) return { project: null, error: '' }
    try { return { project: openClipDocument(data, sourceDataUrl, { timelineIds, role, columns }), error: '' } }
    catch (error) { return { project: null, error: error instanceof Error ? error.message : String(error) } }
  }, [data, sourceDataUrl, timelineIds, role, columns])
  const settings = timeline && clipImportSettings(project, timeline)
  const selectedSet = new Set(selected)
  function toggle(ids: string[], checked: boolean) {
    setSelected(current => checked ? [...new Set([...current, ...ids])] : current.filter(id => !ids.includes(id)))
  }
  function renderNode(node: ClipImportNode): React.ReactNode {
    const source = timeline?.tracks.find(track => track.layerId === node.id)
    const descendantIds = clipImportFolders([node]).map(folder => folder.id)
    const count = descendantIds.filter(id => selectedSet.has(id)).length
    const column = columns.find(column => column.layerId === node.id)
    const row = <span className="clipImportTreeRow">
      <SelectionCheckbox label={`${node.path.join(' / ')}を読み込む`} checked={count > 0 && count === descendantIds.length} mixed={count > 0 && count < descendantIds.length} disabled={!descendantIds.length} onChange={checked => toggle(descendantIds, checked)} />
      <span className="clipImportNodeName">{node.name}</span>
      {!node.visible && <small>非表示</small>}
      {node.animation && <>
        <small>{source?.error ? '読み込み不可' : source?.frames.some(frame => frame.value !== null) ? 'アニメーション' : 'セル指定なし'}</small>
        {column && <label className="clipImportColumnName"><span>セル列名</span><input aria-label={`${node.path.join(' / ')}のセル列名`} value={column.name} onChange={event => { const name = event.currentTarget.value; setNames(current => ({ ...current, [node.id]: name })) }} /></label>}
      </>}
    </span>
    return <li key={node.id}>
      {node.animation ? <>{row}{source?.error && <p className="clipImportTrackError">{source.error}</p>}</> : <details open><summary>{row}</summary><ul>{node.children.map(renderNode)}</ul></details>}
    </li>
  }
  return <div className="assetQuickPreviewBackdrop exportSettingsBackdrop" role="dialog" aria-modal="true" aria-label="CLIPを読み込む" ref={dialog}>
    <section className="timingExportDialog clipImportDialog">
      <header><div><strong>CLIPを読み込む</strong><span>{file.name}</span></div><button type="button" aria-label="閉じる" onClick={onClose}>×</button></header>
      <div className="timingExportDialogBody">
        {!data && !error && <p role="status">CLIPのフォルダーとタイムラインを確認しています…</p>}
        <p>現在の作業を閉じて、このCLIPを開きます。レイヤー構造と画像を保持し、シートの下敷き・入力・Undo履歴はリセットします。</p>
        {data && !data.timelines.length && <p>タイムラインのないCLIPです。レイヤーを保持して開き、必要なセル列を後から対応づけられます。</p>}
        {data && timeline && <>
          <fieldset><legend>読み込むタイムライン</legend>{data.timelines.map(item => <label className="clipCutChoice" key={item.id}><input type="checkbox" checked={timelineIds.includes(item.id)} onChange={event => { const checked = event.currentTarget.checked; setTimelineIds(current => checked ? [...current, item.id] : current.filter(id => id !== item.id)); setTimelineId(item.id) }} />{item.name}<span>{item.fps}fps / {item.endFrame - item.startFrame}F</span></label>)}{timelineIds.length > 1 && <p>各タイムラインを兼用カットとして読み込み、セルを共有します。フォルダーと列名の選択は共通です。</p>}</fieldset>
          <label className="timingExportPathField"><span>確認するタイムライン</span><select value={timelineId} onChange={event => {
            setTimelineId(event.currentTarget.value)
          }}>{data.timelines.map(item => <option key={item.id} value={item.id}>{item.name}（{item.endFrame - item.startFrame}F / {item.fps}fps）</option>)}</select></label>
          <fieldset><legend>タイミングの読み込み先</legend><div className="segmented">{(['action', 'cell'] as const).map(value => <button type="button" key={value} aria-pressed={role === value} onClick={() => setRole(value)}>{value.toUpperCase()}</button>)}</div></fieldset>
          <p>CLIP再生範囲：{timeline.startFrame + 1}〜{timeline.endFrame}F（{timeline.fps}fps）</p>
          <p>再生範囲外のセル指定は開始前・終了後のダミーコマに保持します。正式な尺には含めません。</p>
          {timelineIds.length === 1 && <p>読み込み後：{settings!.fps}fps・{settings!.durationFrames}フレーム</p>}
          {timelineIds.length === 1 && settings!.fps !== project.logicalSheet.fps && <p>新しいシートは{settings!.fps}fpsで作成します。</p>}
          <fieldset><legend>読み込むフォルダー</legend>
            <div className="clipImportSelectionActions"><button type="button" onClick={() => setSelected(folders.filter(node => !timeline.tracks.find(track => track.layerId === node.id)?.error).map(node => node.id))}>すべて選択</button><button type="button" onClick={() => setSelected([])}>すべて解除</button></div>
            {folders.length ? <ul className="clipImportTree">{data.nodes.map(renderNode)}</ul> : <p>アニメーションフォルダーがありません。</p>}
          </fieldset>
          <div className="clipImportOrder"><strong>シートの列順（作画工程）</strong><span>{columns.map(column => column.name || '未入力').join(' → ') || '未選択'}</span></div>
        </>}
        {(error || preview.error) && <p className="issue error" role="alert">{error || preview.error}</p>}
      </div>
      <footer><button type="button" onClick={onClose}>キャンセル</button><button type="button" className="primary" disabled={!preview.project || Boolean(error)} onClick={() => { if (preview.project) onImport(preview.project) }}>タイムシートに読み込む</button></footer>
    </section>
  </div>
}
