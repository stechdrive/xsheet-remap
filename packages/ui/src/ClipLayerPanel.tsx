import { useEffect, useMemo, useRef, useState } from 'react'
import { addClipLayers, clipCelRoot, clipEffectiveCel, clipNodePath, createClipNode, deleteClipLayer, moveClipLayer, setClipTarget, unsetClipTarget, updateClipLayer, type ClipLayerNode, type CutProject, type SheetHit } from '@xsheet-remap/core'
import { clipSourceBytes, previewClipLayer, isTauriHost } from '@xsheet-remap/adapters'
import { collectAssetFilesFromDrop } from './assetFiles'
import { createStackGuideLabel } from '@xsheet-remap/core'
import { setInternalDragDropValidity, startInternalPointerDrag, subscribeInternalDrag } from './internalDrag'
import { AssetFloatingPreview } from './assetPreview'
import { initialAssetPreviewRect, type AssetPreviewPayload } from './assetPreviewModel'
import './styles/clip-layers.css'

const blendModes: [number, string][] = [[0, '通常'], [1, '比較（暗）'], [2, '乗算'], [3, '焼き込みカラー'], [4, '焼き込み（リニア）'], [5, '減算'], [7, '比較（明）'], [8, 'スクリーン'], [9, '覆い焼きカラー'], [11, '加算'], [14, 'オーバーレイ'], [15, 'ソフトライト'], [16, 'ハードライト'], [21, '差の絶対値'], [22, '除外'], [23, '色相'], [24, '彩度'], [25, 'カラー'], [26, '輝度'], [30, '通過']]

export interface ClipLayerPanelProps {
  project: CutProject
  activeCutId: string
  activeProcessId: string
  onProcessChange: (id: string) => void
  onChange: (project: CutProject) => void
  onFiles: (files: File[], parentId: string | null) => void
  onSelectKey: (id: string) => void
  selectedHit: SheetHit | null
  disabled?: boolean
  filterProcess: boolean
  onFilterProcess: (enabled: boolean) => void
  onAddColumn: () => void
  onNormalizeNames: () => void
  onAddGuide: (kind: 'background' | 'book' | 'memo') => void
}

export function ClipLayerPanel(props: ClipLayerPanelProps) {
  const { project } = props, document = project.clipDocument!
  const latestProject = useRef(project)
  useEffect(() => { latestProject.current = project }, [project])
  const [selectedId, setSelectedId] = useState<string | null>(null), [notice, setNotice] = useState('')
  const [dropTarget, setDropTarget] = useState<{ id: string; before: boolean; valid: boolean } | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(document.nodes.filter(node => node.id.startsWith('process:') && node.id !== `process:${props.activeProcessId}`).map(node => node.id))), [search, setSearch] = useState(''), [unusedOnly, setUnusedOnly] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false), [preview, setPreview] = useState<{ request: object; payload: AssetPreviewPayload } | null>(null), [previewRect, setPreviewRect] = useState(initialAssetPreviewRect)
  const [paperTrack, setPaperTrack] = useState(project.logicalSheet.paperTracks[0]?.paperTrack ?? '')
  const [pathDraft, setPathDraft] = useState<{ slotId?: string; value: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const selected = document.nodes.find(node => node.id === selectedId)
  const parentId = selected && ['folder', 'animation'].includes(selected.kind) ? selected.id : selected?.parentId ?? null
  const target = document.targets.find(item => item.slotId === project.cspTrackSlots.find(slot => slot.paperTrack === paperTrack && slot.correctionLayerId === props.activeProcessId)?.slotId)
  const cellPath = pathDraft && pathDraft.slotId === target?.slotId ? pathDraft.value : target?.cellPath?.join('/') ?? ''
  const previewRequest = useMemo(() => ({ selected, document, sheet: project.logicalSheet, cutId: props.activeCutId, hit: props.selectedHit }), [selected, document, project.logicalSheet, props.activeCutId, props.selectedHit])
  const used = useMemo(() => new Set(project.bindings.filter(binding => project.logicalSheet.events.some(event => event.keyId === binding.keyId)).flatMap(binding => binding.clipLayerId ? [binding.clipLayerId] : [])), [project.bindings, project.logicalSheet.events])
  const children = useMemo(() => {
    const result = new Map<string | null, ClipLayerNode[]>()
    for (const node of document.nodes) result.set(node.parentId, [...result.get(node.parentId) ?? [], node])
    return result
  }, [document.nodes])

  function apply(action: () => CutProject) {
    if (props.disabled) return
    try { props.onChange(action()); setNotice('') } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
  }

  function select(node: ClipLayerNode) {
    setSelectedId(node.id)
    const cel = clipCelRoot(document, node.id), folderId = cel?.parentId ?? (node.kind === 'animation' ? node.id : undefined)
    const mapped = document.targets.find(item => item.folderId === folderId)
    const slot = project.cspTrackSlots.find(item => item.slotId === mapped?.slotId)
    if (slot?.correctionLayerId) { props.onProcessChange(slot.correctionLayerId); setPaperTrack(slot.paperTrack) }
    const binding = cel && project.bindings.find(item => item.clipLayerId === cel.id)
    if (binding) props.onSelectKey(binding.keyId)
  }

  useEffect(() => subscribeInternalDrag(detail => {
    if (detail.payload.kind !== 'clip-layer') return
    if (detail.phase === 'cancel') { setDropTarget(null); setInternalDragDropValidity(null); return }
    const element = window.document.elementFromPoint?.(detail.clientX, detail.clientY)?.closest<HTMLElement>('[data-clip-layer-id]')
    if (!element) { setDropTarget(null); return }
    const destination = document.nodes.find(node => node.id === element.dataset.clipLayerId)
    if (!destination || destination.id === detail.payload.layerId) return
    const rect = element.getBoundingClientRect(), before = detail.clientY < rect.top + rect.height * 0.25
    const nextParent = before || !['folder', 'animation'].includes(destination.kind) ? destination.parentId : destination.id
    try {
      const next = moveClipLayer(project, detail.payload.layerId, nextParent, before ? destination.id : undefined)
      setInternalDragDropValidity(props.disabled ? 'invalid' : 'valid')
      setDropTarget({ id: destination.id, before, valid: !props.disabled })
      if (detail.phase === 'drop' && !props.disabled) { props.onChange(next); setNotice('レイヤーを移動しました。'); setInternalDragDropValidity(null); setDropTarget(null) }
    } catch (error) {
      setInternalDragDropValidity('invalid')
      setDropTarget({ id: destination.id, before, valid: false })
      if (detail.phase === 'drop') { setNotice(error instanceof Error ? error.message : String(error)); setDropTarget(null); setInternalDragDropValidity(null) }
    }
  }), [document, project, props])

  useEffect(() => {
    if (!previewOpen || !selected) return
    const controller = new AbortController(); const urls: string[] = []
    void (async () => {
      try {
        let node = selected
        if (node.kind === 'animation') {
          const mapped = document.targets.find(item => item.folderId === node.id)
          const slot = project.cspTrackSlots.find(item => item.slotId === mapped?.slotId)
          const frame = props.selectedHit?.frame ?? project.logicalSheet.frameOrigin
          const event = project.logicalSheet.events.filter(item => item.paperTrack === slot?.paperTrack && item.frame <= frame && item.sheetRole === (props.selectedHit?.role === 'cell' ? 'cell' : 'action')).sort((a, b) => b.frame - a.frame)[0]
          const binding = event && project.bindings.find(item => item.keyId === event.keyId && item.slotId === slot?.slotId)
          const sourceId = document.timelineIds?.[props.activeCutId]
          const nativeFrames = document.sourceTimelines?.find(item => item.id === sourceId)?.tracks.find(item => item.layerId === node.id)?.frames
          const nativeValue = nativeFrames?.filter(item => item.frame <= frame - project.logicalSheet.frameOrigin).at(-1)?.value
          const cel = clipEffectiveCel(document, node.id, event ? binding?.cspCellName ?? '' : nativeValue ?? '')
          if (!cel) throw new Error('このフレームにセル指定はありません。')
          node = cel
        }
        const read = async (layer: ClipLayerNode) => {
          let imageUrl = layer.imageDataUrl ?? project.assets.find(asset => asset.assetId === layer.assetId)?.thumbnailUrl
          let detailText = clipNodePath(document, layer.id)
          if (!imageUrl && layer.sourceLayerId !== undefined && document.source) {
            const result = await previewClipLayer(clipSourceBytes(document.source.dataUrl), layer.sourceLayerId, controller.signal)
            controller.signal.throwIfAborted()
            imageUrl = URL.createObjectURL(new Blob([Uint8Array.from(result.bytes)], { type: 'image/png' })); urls.push(imageUrl)
            detailText += ` / ${result.width} × ${result.height}px${result.storedComposite ? ' / CLIP保存時の合成画像（編集は未反映）' : ''}`
          }
          return { label: layer.name, imageUrl, detailText }
        }
        if (node.kind === 'folder') {
          // Show the saved composite when available, and the actual current children
          // otherwise. A gallery does not pretend to reproduce unsupported CSP effects.
          try {
            const saved = await read(node)
            if (saved.imageUrl) { setPreview({ request: previewRequest, payload: { displayName: node.name, ...saved } }); return }
          } catch { controller.signal.throwIfAborted() }
          const descendantIds = new Set([node.id])
          for (let size = -1; size !== descendantIds.size;) { size = descendantIds.size; for (const child of document.nodes) if (child.parentId && descendantIds.has(child.parentId)) descendantIds.add(child.id) }
          const layers = document.nodes.filter(child => descendantIds.has(child.id) && !['folder', 'animation'].includes(child.kind)).slice(0, 24)
          const items = []
          for (const layer of layers) {
            try { items.push(await read(layer)) } catch (error) { controller.signal.throwIfAborted(); items.push({ label: layer.name, detailText: String(error) }) }
          }
          controller.signal.throwIfAborted()
          setPreview({ request: previewRequest, payload: { displayName: node.name, detailText: 'フォルダー内の画像（最大24枚・個別表示）', items } })
          return
        }
        const item = await read(node)
        if (!item.imageUrl) throw new Error('画像のないレイヤーです。')
        controller.signal.throwIfAborted()
        setPreview({ request: previewRequest, payload: { displayName: node.name, ...item } })
      } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : String(error)) }
    })()
    return () => { controller.abort(); urls.forEach(url => URL.revokeObjectURL(url)) }
  }, [previewOpen, selected, document, project.assets, project.bindings, project.cspTrackSlots, project.logicalSheet, props.selectedHit, props.activeCutId, previewRequest])

  function add(kind: 'folder' | 'animation' | 'raster') {
    const name = window.prompt(kind === 'animation' ? 'アニメーションフォルダー名' : kind === 'folder' ? 'フォルダー名' : 'セル名', kind === 'folder' ? 'フォルダー' : kind === 'animation' ? 'A' : '001')
    if (name === null) return
    const node = createClipNode(name, kind, parentId)
    apply(() => addClipLayers(project, [node])); setSelectedId(node.id)
  }

  function addGuide(kind: 'background' | 'book' | 'memo') {
    if (!selected) { props.onAddGuide(kind); return }
    apply(() => {
      const created = createStackGuideLabel(project, { label: selected.name, kind, gapIndex: 0, correctionLayerId: props.activeProcessId, exportAsStaticCell: false })
      return { ...created.project, stackGuideLabels: created.project.stackGuideLabels.map(label => label.labelId === created.label.labelId ? { ...label, clipLayerId: selected.id } : label) }
    })
  }

  function renderNodes(parent: string | null, depth = 0): React.ReactNode {
    return (children.get(parent) ?? []).map(node => {
      const cel = clipCelRoot(document, node.id), isUsed = Boolean(cel && used.has(cel.id))
      const isFolder = node.kind === 'folder' || node.kind === 'animation'
      if (!isFolder && (search && !node.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) || unusedOnly && isUsed)) return null
      const ambiguous = cel?.id === node.id && clipEffectiveCel(document, node.parentId!, node.name)?.id !== node.id
      return <div key={node.id} role="treeitem" aria-selected={node.id === selectedId} aria-expanded={isFolder ? !collapsed.has(node.id) : undefined}>
        <div className={`clipLayerRow ${node.id === selectedId ? 'selected' : ''} ${dropTarget?.id === node.id ? dropTarget.valid ? dropTarget.before ? 'clipDropBefore' : 'clipDropInto' : 'clipDropInvalid' : ''}`} style={{ paddingLeft: 6 + depth * 14 }} data-clip-layer-id={node.id} data-clip-layer-parent={isFolder ? node.id : node.parentId ?? '__root__'}
          onClick={() => select(node)} onDoubleClick={() => { select(node); setPreviewOpen(true) }}
          onPointerDown={event => startInternalPointerDrag(event, { begin: () => props.disabled ? null : { kind: 'clip-layer', layerId: node.id }, createPreview: () => ({ primaryText: node.name, secondaryText: clipNodePath(document, node.id) }) })}>
          {isFolder ? <button type="button" aria-label={`${node.name}を${collapsed.has(node.id) ? '展開' : '折りたたむ'}`} onClick={event => { event.stopPropagation(); setCollapsed(current => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next }) }}>{collapsed.has(node.id) ? '▸' : '▾'}</button> : <span className="clipDisclosureSpace" />}
          <input type="checkbox" aria-label={`${node.name}の表示`} checked={node.visible} disabled={props.disabled || node.locked} onClick={event => event.stopPropagation()} onChange={event => apply(() => updateClipLayer(project, node.id, { visible: event.target.checked }))} />
          <span className="clipLayerKind">{node.kind === 'animation' ? '動画' : node.kind === 'folder' ? '▱' : node.kind === 'raster' ? '▧' : '◇'}</span>
          <span className="clipLayerName" title={clipNodePath(document, node.id)}>{node.name}</span>
          {project.stackGuideLabels.some(label => label.clipLayerId === node.id) && <small title="シート上の表示フラグに対応">旗</small>}
          {ambiguous ? <small title="同名の下段セルがタイムラインで採用されます">同名</small> : cel?.id === node.id && <small>{isUsed ? '使用中' : '未使用'}</small>}
          <button type="button" aria-label={`${node.name}をクイックルック`} onClick={event => { event.stopPropagation(); select(node); setPreviewOpen(true) }}>◉</button>
        </div>
        {isFolder && !collapsed.has(node.id) && <div role="group">{renderNodes(node.id, depth + 1)}</div>}
      </div>
    })
  }

  return <section className="clipLayerPanel" data-workspace-keyboard-scope="editor" data-clip-layer-parent="__root__"
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = props.disabled ? 'none' : 'copy' } }}
    onDrop={event => {
      event.preventDefault(); event.stopPropagation(); if (props.disabled || isTauriHost()) return
      const destination = (event.target as Element).closest<HTMLElement>('[data-clip-layer-parent]')?.dataset.clipLayerParent
      const parent = destination && destination !== '__root__' ? destination : null
      const currentDocument = project
      void collectAssetFilesFromDrop(event.dataTransfer).then(files => { if (latestProject.current === currentDocument) props.onFiles(files, parent) }).catch(error => setNotice(String(error)))
    }} onKeyDown={event => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
      if (event.key === ' ' && selected) { event.preventDefault(); event.stopPropagation(); setPreviewOpen(current => !current) }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation()
        const ids = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-clip-layer-id]')).map(element => element.dataset.clipLayerId)
        const index = Math.max(0, Math.min(ids.length - 1, ids.indexOf(selectedId ?? '') + (event.key === 'ArrowDown' ? 1 : -1)))
        const next = document.nodes.find(node => node.id === ids[index]); if (next) select(next)
      }
    }} tabIndex={0}>
    <header><strong>レイヤー</strong><button type="button" disabled={props.disabled} onClick={() => input.current?.click()}>画像を追加…</button></header>
    <p className="clipTargetPath">画像の追加先：{parentId ? clipNodePath(document, parentId) : '最上位'}</p>
    <input ref={input} type="file" accept="image/*" multiple hidden onChange={event => { props.onFiles(Array.from(event.target.files ?? []), parentId); event.target.value = '' }} />
    <div className="clipLayerTools"><button type="button" disabled={props.disabled} onClick={() => add('folder')}>フォルダー＋</button><button type="button" disabled={props.disabled} onClick={() => add('animation')}>アニメーション＋</button><button type="button" disabled={props.disabled} onClick={() => add('raster')}>セル＋</button></div>
    <button type="button" disabled={props.disabled} onClick={props.onNormalizeNames}>一括リネーム</button>
    <input aria-label="レイヤーを検索" placeholder="レイヤー名で検索" value={search} onChange={event => setSearch(event.target.value)} />
    <label><input type="checkbox" checked={unusedOnly} onChange={event => setUnusedOnly(event.target.checked)} />現在のタイムラインで未使用</label>
    <div className="clipLayerTree" role="tree" aria-label="CLIPレイヤーツリー">{renderNodes(null)}</div>
    {selected && <fieldset className="clipLayerProperties" disabled={props.disabled || selected.locked}>
      <label>移動先<select aria-label="レイヤーの移動先" value={selected.parentId ?? ''} onChange={event => apply(() => moveClipLayer(project, selected.id, event.target.value || null))}><option value="">最上位</option>{document.nodes.filter(node => node.id !== selected.id && ['folder', 'animation'].includes(node.kind)).map(node => <option key={node.id} value={node.id}>{clipNodePath(document, node.id)}</option>)}</select></label>
      <label>名前<input aria-label="レイヤー名" key={selected.id + selected.name} defaultValue={selected.name} onBlur={event => { if (event.target.value !== selected.name) apply(() => updateClipLayer(project, selected.id, { name: event.target.value })) }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur() }} /></label>
      <label>不透明度<input aria-label="レイヤーの不透明度" type="number" min={0} max={100} value={Math.round(selected.opacity * 100)} onChange={event => apply(() => updateClipLayer(project, selected.id, { opacity: Number(event.target.value) / 100 }))} /></label>
      <label>合成モード<select aria-label="レイヤーの合成モード" value={selected.blendMode} onChange={event => apply(() => updateClipLayer(project, selected.id, { blendMode: Number(event.target.value) }))}>{!blendModes.some(([value]) => value === selected.blendMode) && <option value={selected.blendMode}>既存のモード（{selected.blendMode}）</option>}{blendModes.filter(([value]) => value !== 30 || selected.kind === 'folder' || selected.kind === 'animation').map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
      <button type="button" onClick={() => { if (window.confirm(`「${selected.name}」と中のレイヤーを削除しますか？シート上の番号は残ります。`)) apply(() => deleteClipLayer(project, selected.id)) }}>レイヤーを削除</button>
    </fieldset>}
    <fieldset className="clipLayerTargets" disabled={props.disabled}><legend>シートへの登録先</legend>
      <label>工程<select aria-label="登録先工程" value={props.activeProcessId} onChange={event => props.onProcessChange(event.target.value)}>{project.correctionLayers.map(process => <option key={process.layerId} value={process.layerId}>{process.label}</option>)}</select></label>
      <label>列<select aria-label="登録先セル列" value={paperTrack} onChange={event => setPaperTrack(event.target.value)}>{project.logicalSheet.paperTracks.map(track => <option key={track.paperTrack} value={track.paperTrack}>{track.label}</option>)}</select></label>
      <p className="clipTargetPath">{target ? clipNodePath(document, target.folderId) : '未設定'}</p>
      <label>セル内フォルダー<input aria-label="セル内の画像登録先" placeholder="例：作監（空欄はセル直下）" value={cellPath} onChange={event => setPathDraft({ slotId: target?.slotId, value: event.target.value })} /></label>
      <button type="button" disabled={selected?.kind !== 'animation'} onClick={() => apply(() => {
        const slot = project.cspTrackSlots.find(item => item.paperTrack === paperTrack && item.correctionLayerId === props.activeProcessId)
        if (!slot || !selected) throw new Error('登録先のセル列を選択してください。')
        return setClipTarget(project, slot.slotId, selected.id, cellPath.split('/').map(value => value.trim()).filter(Boolean))
      })}>選択フォルダーを登録先にする</button>
      {target && <button type="button" onClick={() => { if (window.confirm('この工程・列の対応を解除します。シートの番号とCLIPのレイヤーは残ります。')) apply(() => unsetClipTarget(project, target.slotId)) }}>対応を解除</button>}
      <label><input type="checkbox" checked={props.filterProcess} onChange={event => props.onFilterProcess(event.target.checked)} />シートは選択工程だけ表示</label>
    </fieldset>
    <div className="clipLayerTools"><button type="button" disabled={props.disabled} onClick={props.onAddColumn}>セル列＋</button>{(['background', 'book', 'memo'] as const).map(kind => <button type="button" key={kind} disabled={props.disabled} onClick={() => addGuide(kind)}>{kind === 'background' ? 'BG' : kind === 'book' ? 'BOOK' : 'メモ'}表示＋</button>)}</div>
    {notice && <p role="status" className="clipLayerNotice">{notice}</p>}
    {previewOpen && preview?.request === previewRequest && <AssetFloatingPreview isDragPassthrough={false} payload={preview.payload} rect={previewRect} onRectChange={setPreviewRect} onClose={() => setPreviewOpen(false)} />}
  </section>
}
