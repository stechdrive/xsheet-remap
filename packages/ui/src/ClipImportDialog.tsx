import { useEffect, useMemo, useState } from 'react'
import { activeCutProjectFromDocument, createDefaultProjectDocument, clipImportFolders, clipImportSettings, openClipDocument, suggestClipProcessColumns, suggestClipBaseProcess, clipProcessName, type ClipImportColumn, type ClipImportData, type ClipImportNode, type CutGroupProjectDocument, type SheetTimingRole } from '@xsheet-remap/core'
import { readClipFile, clipSourceDataUrl } from '@xsheet-remap/adapters'
import { useModalDialogKeyboardBoundary } from './useModalDialogKeyboardBoundary'
import { TooltipTarget } from './Tooltip'
import { ClipImportLayerTree } from './ClipImportLayerTree'

export function ClipImportDialog({ file, onClose, onImport }: { file: File; document: CutGroupProjectDocument; onClose: () => void; onImport: (document: CutGroupProjectDocument) => void }) {
  const project = useMemo(() => activeCutProjectFromDocument(createDefaultProjectDocument()), [])
  const [sourceDataUrl, setSourceDataUrl] = useState('')
  const [data, setData] = useState<ClipImportData | null>(null)
  const [timelineId, setTimelineId] = useState(''), [role, setRole] = useState<SheetTimingRole>('action')
  const [timelineIds, setTimelineIds] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([]), [names, setNames] = useState<Record<string, string>>({})
  const [processes, setProcesses] = useState<Record<string, string>>({})
  const [baseProcess, setBaseProcess] = useState(''), [focusedNode, setFocusedNode] = useState<ClipImportNode | null>(null)
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
        const timeline = result.timelines.find(item => item.id === result.currentTimelineId)
        const folders = clipImportFolders(result.nodes).filter(node => !timeline?.tracks.find(track => track.layerId === node.id)?.error)
        const ids = folders.map(node => node.id)
        setSelected(ids); setNames({}); setProcesses({})
        setBaseProcess(suggestClipBaseProcess(result, suggestClipProcessColumns(result, ids)))
        setFocusedNode(null)
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error)) }
    })()
    return () => controller.abort()
  }, [file])
  const timeline = data?.timelines.find(item => item.id === timelineId)
  const folders = useMemo(() => data ? clipImportFolders(data.nodes) : [], [data])
  const columns = useMemo<ClipImportColumn[]>(() => data ? suggestClipProcessColumns(data, selected).map(column => ({ ...column, name: names[column.layerId] ?? column.name, process: processes[column.layerId] ?? column.process })) : [], [data, selected, names, processes])
  const processNames = [...new Set(columns.map(clipProcessName))]
  // Only the initial read consults visibility. User edits and disclosure never re-rank it.
  const selectedBase = processNames.includes(baseProcess) ? baseProcess : processNames[0] ?? ''
  const preview = useMemo(() => {
    if (!data || !sourceDataUrl) return { project: null, error: '' }
    try { return { project: openClipDocument(data, sourceDataUrl, { timelineIds, role, columns, ...(selectedBase ? { baseProcess: selectedBase } : {}) }), error: '' } }
    catch (error) { return { project: null, error: error instanceof Error ? error.message : String(error) } }
  }, [data, sourceDataUrl, timelineIds, role, columns, selectedBase])
  const settings = timeline && clipImportSettings(project, timeline)
  const focusedColumn = columns.find(column => column.layerId === focusedNode?.id)
  function toggle(ids: string[], checked: boolean) {
    setSelected(current => checked ? [...new Set([...current, ...ids])] : current.filter(id => !ids.includes(id)))
  }
  return <div className="assetQuickPreviewBackdrop exportSettingsBackdrop" role="dialog" aria-modal="true" aria-label="CLIPを読み込む" ref={dialog}>
    <section className="timingExportDialog clipImportDialog">
      <header><div><strong>CLIPを読み込む</strong><span>{file.name}</span></div><button type="button" aria-label="閉じる" onClick={onClose}>×</button></header>
      <div className="clipImportWorkspace">
        <div className="clipImportSettings">
          <div className="timingExportDialogBody">
            {!data && !error && <p role="status">CLIPのフォルダーとタイムラインを確認しています…</p>}
            <p>現在の作業を閉じてCLIPを開きます。シートの下敷き・入力・Undo履歴はリセットします。</p>
            {data && !timelineIds.length && <p>セル指定を取り込まず、レイヤーと元のタイムラインを保持して開きます。</p>}
            {data && timeline && <>
              <fieldset><legend>読み込むタイムライン</legend>{data.timelines.map(item => <label className="clipCutChoice" key={item.id}><input type="checkbox" checked={timelineIds.includes(item.id)} onChange={event => { const checked = event.currentTarget.checked; setTimelineIds(current => checked ? [...current, item.id] : current.filter(id => id !== item.id)); setTimelineId(item.id) }} />{item.name}<span>{item.fps}fps / {item.endFrame - item.startFrame}F</span></label>)}</fieldset>
              {data.timelines.length > 1 && <label className="timingExportPathField"><span>確認するタイムライン</span><select value={timelineId} onChange={event => setTimelineId(event.currentTarget.value)}>{data.timelines.map(item => <option key={item.id} value={item.id}>{item.name}（{item.endFrame - item.startFrame}F / {item.fps}fps）</option>)}</select></label>}
              <fieldset><legend>タイミングの読み込み先</legend><div className="segmented">{(['action', 'cell'] as const).map(value => <button type="button" key={value} aria-pressed={role === value} onClick={() => setRole(value)}>{value.toUpperCase()}</button>)}</div></fieldset>
              {timelineIds.length === 1 && <p>{settings!.fps}fps・{settings!.durationFrames}フレーム（範囲外のセル指定はダミーコマに保持）</p>}
              {timelineIds.length > 1 && <p>各タイムラインを兼用カットとして読み込み、セルを共有します。</p>}
            </>}
            {data && <>
              <fieldset className="clipImportFocused"><legend>選択したレイヤーの読み込み設定</legend>
                {focusedNode ? <>
                  <p className="clipImportNodePath">{focusedNode.path.join(' / ')}</p>
                  {focusedColumn ? <>
                    <label><span>セル列名</span><input aria-label={`${focusedNode.path.join(' / ')}のセル列名`} value={focusedColumn.name} onChange={event => { const name = event.currentTarget.value; setNames(current => ({ ...current, [focusedNode.id]: name })) }} /></label>
                    <label><span>表示グループ（工程）</span><input list="clip-import-processes" aria-label={`${focusedNode.path.join(' / ')}の表示グループ`} value={focusedColumn.process} onChange={event => { const name = event.currentTarget.value; setProcesses(current => ({ ...current, [focusedNode.id]: name })); if (clipProcessName(focusedColumn) === selectedBase && columns.filter(column => clipProcessName(column) === selectedBase).length === 1) setBaseProcess(name.trim()) }} /></label>
                    {timeline?.tracks.find(track => track.layerId === focusedNode.id)?.error && <p className="clipImportTrackError">{timeline.tracks.find(track => track.layerId === focusedNode.id)!.error}</p>}
                  </> : <p>{focusedNode.animation ? 'チェックを入れると、セル列名と工程を設定できます。' : 'レイヤー構造と素材はそのまま保持します。'}</p>}
                </> : <p>右のツリーでアニメーションフォルダーを選択すると、セル列名と工程を設定できます。</p>}
              </fieldset>
              <datalist id="clip-import-processes">{processNames.map(name => <option key={name} value={name} />)}</datalist>
              <div className="clipImportOrder"><strong>シートの列順（全グループ共通）</strong><span>{[...new Set(columns.map(column => column.name || '未入力'))].join(' → ') || '未選択'}</span></div>
            </>}
          </div>
          <footer>
            {(error || preview.error) && <p className="issue error clipImportError" role="alert">{error || preview.error}</p>}
            {processNames.length > 0 && <label className="clipImportBaseProcess"><span>シートの基準にする工程を選択</span><TooltipTarget label="シート編集で使い、CLIP組み立て中も常に表示する工程">{tooltip => <select {...tooltip} aria-label="シートの基準にする工程を選択" value={selectedBase} onChange={event => setBaseProcess(event.target.value)}>{processNames.map(name => <option key={name}>{name}</option>)}</select>}</TooltipTarget></label>}
            <div className="clipImportSubmit"><button type="button" onClick={onClose}>キャンセル</button><button type="button" className="primary" disabled={!preview.project || Boolean(error)} onClick={() => { if (preview.project) onImport(preview.project) }}>タイムシートに読み込む</button></div>
          </footer>
        </div>
        {data && <ClipImportLayerTree key={data.fileHash} data={data} selected={selected} columns={columns} baseProcess={selectedBase} focusedId={focusedNode?.id ?? ''} onFocus={setFocusedNode} onToggle={toggle} onAll={checked => setSelected(checked ? folders.filter(node => !timeline?.tracks.find(track => track.layerId === node.id)?.error).map(node => node.id) : [])} />}
      </div>
    </section>
  </div>
}
