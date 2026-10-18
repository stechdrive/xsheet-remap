import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { addClipLayers, clipCelRoot, clipEffectiveCel, clipNodePath, createClipNode, deleteClipLayer, moveClipLayer, setClipTarget, unsetClipTarget, updateClipLayer, type ClipLayerNode, type CutProject, type SheetHit } from '@xsheet-remap/core'
import { clipSourceBytes, previewClipLayer, isTauriHost } from '@xsheet-remap/adapters'
import { collectAssetFilesFromDrop } from './assetFiles'
import { createStackGuideLabel } from '@xsheet-remap/core'
import { setInternalDragDropValidity, startInternalPointerDrag, subscribeInternalDrag } from './internalDrag'
import { AssetFloatingPreview } from './assetPreview'
import { initialAssetPreviewRect, type AssetPreviewPayload } from './assetPreviewModel'
import { ClipLayerAppearance, clipBlendLabel } from './ClipLayerAppearance'
import { ClipLayerIcon, clipLayerKindLabel } from './ClipLayerIcons'
import { ClipAudioImport } from './ClipAudioImport'
import { ClipProcessComparison } from './ClipProcessComparison'
import { ProcessSettingsDialog } from './ProcessSettingsDialog'
import { updateCorrectionLayers } from '@xsheet-remap/core'
import { clipLayerDropAtElement, clipLayerFileDropAllowed, subscribeNativeLayerHover, type ClipLayerDropTarget } from './clipLayerDrop'
import './styles/clip-layers.css'

export interface ClipLayerPanelProps {
  project: CutProject
  activeCutId: string
  activeSheetRevisionId?: string
  activeProcessId: string
  onProcessChange: (id: string) => void
  onChange: (project: CutProject) => void
  onFiles: (files: File[], parentId: string | null, beforeId?: string) => void
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
  const [processSettingsOpen, setProcessSettingsOpen] = useState(false)
  const [dropState, setDropState] = useState<{ project: CutProject; target: ClipLayerDropTarget & { valid: boolean } } | null>(null)
  const dropTarget = dropState?.project === project ? dropState.target : null
  const setDropTarget = useCallback((target: (ClipLayerDropTarget & { valid: boolean }) | null) => {
    setDropState(current => current?.project === project && JSON.stringify(current.target) === JSON.stringify(target) ? current : target ? { project, target } : null)
  }, [project])
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(document.nodes.filter(node => node.id.startsWith('process:') && node.id !== `process:${props.activeProcessId}`).map(node => node.id))), [search, setSearch] = useState(''), [unusedOnly, setUnusedOnly] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false), [preview, setPreview] = useState<{ request: object; payload: AssetPreviewPayload } | null>(null), [previewRect, setPreviewRect] = useState(initialAssetPreviewRect)
  const [paperTrack, setPaperTrack] = useState(project.logicalSheet.paperTracks[0]?.paperTrack ?? '')
  const [pathDraft, setPathDraft] = useState<{ slotId?: string; value: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLElement>(null)
  const dragged = useRef(false)
  const selected = document.nodes.find(node => node.id === selectedId)
  const parentId = selected && ['folder', 'animation'].includes(selected.kind) ? selected.id : selected?.parentId ?? null
  const selectedSlot = project.cspTrackSlots.find(slot => slot.paperTrack === paperTrack && slot.correctionLayerId === props.activeProcessId)
  const target = document.targets.find(item => item.slotId === selectedSlot?.slotId)
  const targetLabel = target ? clipNodePath(document, target.folderId) : selectedSlot && document.deletedTargetSlotIds?.includes(selectedSlot.slotId) ? 'フォルダー削除済み（CLIP出力から除外）' : '未設定'
  const cellPath = pathDraft && pathDraft.slotId === target?.slotId ? pathDraft.value : target?.cellPath?.join('/') ?? ''
  const previewRequest = useMemo(() => ({ selected, document, sheet: project.logicalSheet, cutId: props.activeCutId, hit: props.selectedHit }), [selected, document, project.logicalSheet, props.activeCutId, props.selectedHit])
  const used = useMemo(() => new Set(project.bindings.filter(binding => project.logicalSheet.events.some(event => event.keyId === binding.keyId)).flatMap(binding => binding.clipLayerId ? [binding.clipLayerId] : [])), [project.bindings, project.logicalSheet.events])
  const children = useMemo(() => {
    const result = new Map<string | null, ClipLayerNode[]>()
    for (const node of document.nodes) result.set(node.parentId, [...result.get(node.parentId) ?? [], node])
    return result
  }, [document.nodes])

  function apply(action: () => CutProject) {
    if (props.disabled) return false
    try { props.onChange(action()); setNotice(''); return true } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return false }
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
    const destination = clipLayerDropAtElement(document, window.document.elementFromPoint?.(detail.clientX, detail.clientY) ?? null, detail.clientY, detail.payload.layerId)
    if (!destination) { setDropTarget(null); return }
    try {
      if (destination.id === detail.payload.layerId) throw new Error('移動先を選んでください。')
      const next = moveClipLayer(project, detail.payload.layerId, destination.parentId, destination.beforeId)
      setInternalDragDropValidity(props.disabled ? 'invalid' : 'valid')
      setDropTarget({ ...destination, valid: !props.disabled })
      if (detail.phase === 'drop' && !props.disabled) { props.onChange(next); setNotice('レイヤーを移動しました。'); setInternalDragDropValidity(null); setDropTarget(null) }
    } catch (error) {
      setInternalDragDropValidity('invalid')
      setDropTarget({ ...destination, valid: false })
      if (detail.phase === 'drop') { setNotice(error instanceof Error ? error.message : String(error)); setDropTarget(null); setInternalDragDropValidity(null) }
    }
  }), [document, project, props, setDropTarget])

  useEffect(() => subscribeNativeLayerHover(destination => setDropTarget(destination ? { ...destination, valid: !props.disabled && clipLayerFileDropAllowed(document, destination) } : null)), [document, props.disabled, setDropTarget])

  useEffect(() => {
    if (!previewOpen || !selected || selected.kind === 'audio') return
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
          const layers = document.nodes.filter(child => descendantIds.has(child.id) && !['folder', 'animation', 'audio'].includes(child.kind)).slice(0, 24)
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
    const base = kind === 'folder' ? 'フォルダー' : kind === 'animation' ? 'A' : 'レイヤー'
    const names = new Set(document.nodes.filter(node => node.parentId === parentId).map(node => node.name))
    let name = base, suffix = 1
    while (names.has(name)) name = `${base} ${++suffix}`
    const node = createClipNode(name, kind, parentId)
    const beforeId = selected?.id === parentId ? children.get(parentId)?.[0]?.id : selected?.id
    if (apply(() => addClipLayers(project, [node], beforeId))) {
      setSelectedId(node.id)
      setCollapsed(current => { const next = new Set(current); if (parentId) next.delete(parentId); return next })
    }
  }

  function removeSelected() {
    if (selected && window.confirm(`「${selected.name}」と中のレイヤーを削除しますか？シート上の番号は残ります。`)) apply(() => deleteClipLayer(project, selected.id))
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
      const thumbnail = node.imageDataUrl ?? project.assets.find(asset => asset.assetId === node.assetId)?.thumbnailUrl
      const rgb = node.labelColor?.slice(1).match(/../g)?.map(value => parseInt(value, 16))
      const labelInk = rgb && (rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 < 140) ? '#fff' : '#303633'
      const drop = dropTarget?.id === node.id ? dropTarget : null
      const dropClass = drop ? `clipDrop${drop.placement === 'before' ? 'Before' : drop.placement === 'after' ? 'After' : 'Into'} ${drop.valid ? '' : 'clipDropInvalid'}` : ''
      return <div key={node.id} role="treeitem" aria-label={node.name} aria-selected={node.id === selectedId} aria-expanded={isFolder ? !collapsed.has(node.id) : undefined} className={`clipLayerItem ${dropClass}`} style={{ '--clip-layer-indent': `${depth * 12}px`, '--clip-label-color': node.labelColor ?? 'transparent', '--clip-label-ink': node.labelColor ? labelInk : '#303633' } as CSSProperties}>
        <div className={`clipLayerRow ${node.id === selectedId ? 'selected' : ''}`} data-clip-layer-id={node.id} data-clip-layer-parent={isFolder ? node.id : node.parentId ?? '__root__'}
          onClickCapture={event => { if (dragged.current) { event.preventDefault(); event.stopPropagation(); dragged.current = false } }}
          onClick={() => { select(node); panel.current?.focus({ preventScroll: true }) }}
          onPointerDown={event => {
            dragged.current = false
            startInternalPointerDrag(event, {
              interactiveTargetSelector: 'button:not(.clipLayerThumbnail),input,select,textarea,a,[contenteditable="true"]',
              begin: () => { if (props.disabled) return null; dragged.current = true; return { kind: 'clip-layer', layerId: node.id } },
              createPreview: () => ({ primaryText: node.name, secondaryText: clipNodePath(document, node.id), thumbnailUrl: thumbnail }),
            })
          }}>
          <button className="clipLayerEye" type="button" role="checkbox" aria-label={`${node.name}の表示`} aria-checked={node.visible} title={node.visible ? 'レイヤーを非表示' : 'レイヤーを表示'} disabled={props.disabled || node.locked} onClick={event => { event.stopPropagation(); apply(() => updateClipLayer(project, node.id, { visible: !node.visible })) }}><span className={node.visible ? '' : 'clipEyeHidden'}><ClipLayerIcon kind="eye" /></span></button>
          <span className="clipLayerLock" role={node.labelColor ? 'img' : undefined} aria-label={node.labelColor ? `${node.name}のラベルカラー ${node.labelColor}` : undefined} title={[node.locked ? '保護されたレイヤー' : '', node.labelColor ? `ラベルカラー ${node.labelColor}` : ''].filter(Boolean).join(' / ') || undefined}>{node.locked && <ClipLayerIcon kind="lock" />}</span>
          <span className="clipLayerIndent" />
          {isFolder ? <button className={`clipLayerDisclosure ${collapsed.has(node.id) ? '' : 'expanded'}`} type="button" aria-label={`${node.name}を${collapsed.has(node.id) ? '展開' : '折りたたむ'}`} onClick={event => { event.stopPropagation(); setCollapsed(current => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next }) }}><ClipLayerIcon kind="chevron" /></button> : <span className="clipDisclosureSpace" />}
          <button className={`clipLayerThumbnail ${thumbnail ? 'hasImage' : ''}`} type="button" aria-label={node.kind === 'audio' ? `${node.name}の音声操作` : `${node.name}をクイックルック`} title={`${clipLayerKindLabel[node.kind]} · ${node.kind === 'audio' ? 'シートとの対応から音声を取り込み' : node.kind === 'video' ? 'CLIP保存時の画像をクイックルック' : 'クイックルック（Space）'}`} onClick={event => { event.stopPropagation(); select(node); setPreviewOpen(node.kind !== 'audio') }}>{thumbnail ? <img src={thumbnail} alt="" draggable={false} loading="lazy" /> : <ClipLayerIcon kind={node.kind} />}</button>
          <div className="clipLayerCaption">
            <span className="clipLayerInfo"><span>{node.kind === 'audio' ? '音声レイヤー' : `${Math.round(node.opacity * 100)}% ${clipBlendLabel(node.blendMode)}${node.kind === 'video' ? ' · 動画' : ''}`}</span>{project.stackGuideLabels.some(label => label.clipLayerId === node.id) && <small title="シート上の表示フラグに対応">旗</small>}{ambiguous ? <small title="同名の下段セルがタイムラインで採用されます">同名</small> : cel?.id === node.id && <small title={isUsed ? '現在のタイムラインで使用中' : '現在のタイムラインで未使用'}>{isUsed ? '使用中' : '未使用'}</small>}</span>
            {renamingId === node.id ? <input aria-label="レイヤー名" autoFocus defaultValue={node.name} onFocus={event => event.target.select()} onClick={event => event.stopPropagation()} onBlur={event => { if (event.target.value !== node.name) apply(() => updateClipLayer(project, node.id, { name: event.target.value })); setRenamingId(null) }} onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.stopPropagation(); event.currentTarget.value = node.name; setRenamingId(null) } }} /> : <span className="clipLayerName" title={`${clipNodePath(document, node.id)} · ${clipLayerKindLabel[node.kind]}`} onDoubleClick={event => { event.stopPropagation(); if (!props.disabled && !node.locked) setRenamingId(node.id) }}>{node.name}</span>}
          </div>
        </div>
        {isFolder && !collapsed.has(node.id) && <div role="group">{renderNodes(node.id, depth + 1)}</div>}
      </div>
    })
  }

  const newLayersDisabled = props.disabled || Boolean(document.nodes.find(node => node.id === parentId)?.locked)
  return <section ref={panel} className="clipLayerPanel" data-workspace-keyboard-scope="editor" data-clip-layer-parent="__root__"
    onDragOver={event => {
      if (!event.dataTransfer.types.includes('Files') || isTauriHost()) return
      event.preventDefault()
      const destination = clipLayerDropAtElement(document, event.target as Element, event.clientY)
      const valid = Boolean(destination && !props.disabled && clipLayerFileDropAllowed(document, destination))
      event.dataTransfer.dropEffect = valid ? 'copy' : 'none'
      setDropTarget(destination ? { ...destination, valid } : null)
    }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null) }}
    onDrop={event => {
      event.preventDefault(); event.stopPropagation(); setDropTarget(null)
      if (props.disabled || isTauriHost()) return
      const destination = clipLayerDropAtElement(document, event.target as Element, event.clientY)
      if (!destination || !clipLayerFileDropAllowed(document, destination)) return
      const currentDocument = project
      void collectAssetFilesFromDrop(event.dataTransfer).then(files => { if (latestProject.current === currentDocument) props.onFiles(files, destination.parentId, destination.beforeId) }).catch(error => setNotice(String(error)))
    }} onKeyDown={event => {
      if ((event.target as Element).closest('input,select,button,summary')) return
      if (event.key === ' ' && selected) { event.preventDefault(); event.stopPropagation(); if (selected.kind !== 'audio') setPreviewOpen(current => !current) }
      if (event.key === 'F2' && selected && !props.disabled && !selected.locked) { event.preventDefault(); event.stopPropagation(); setRenamingId(selected.id) }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation()
        const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-clip-layer-id]'))
        const index = Math.max(0, Math.min(rows.length - 1, rows.findIndex(row => row.dataset.clipLayerId === selectedId) + (event.key === 'ArrowDown' ? 1 : -1)))
        const next = document.nodes.find(node => node.id === rows[index]?.dataset.clipLayerId)
        if (next) { select(next); rows[index]?.scrollIntoView?.({ block: 'nearest' }) }
      }
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && selected) {
        event.preventDefault(); event.stopPropagation()
        if (selected.kind === 'folder' || selected.kind === 'animation') setCollapsed(current => { const next = new Set(current); if (event.key === 'ArrowLeft') next.add(selected.id); else next.delete(selected.id); return next })
      }
    }} tabIndex={0}>
    <header className="clipPaletteTitle"><strong>レイヤー</strong><span title={selected ? clipNodePath(document, selected.id) : 'レイヤーを選択'}>{selected?.name ?? ''}</span>{selected && <details className="clipLayerMenu"><summary aria-label="レイヤーメニュー" title="レイヤーメニュー">≡</summary><fieldset className="clipLayerProperties" disabled={props.disabled || selected.locked}>
        <label>名前<input aria-label="選択レイヤー名" key={selected.id + selected.name} defaultValue={selected.name} onBlur={event => { if (event.target.value !== selected.name) apply(() => updateClipLayer(project, selected.id, { name: event.target.value })) }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur() }} /></label>
        <label>移動先<select aria-label="レイヤーの移動先" value={selected.parentId ?? ''} onChange={event => apply(() => moveClipLayer(project, selected.id, event.target.value || null))}><option value="">最上位</option>{document.nodes.filter(node => node.id !== selected.id && ['folder', 'animation'].includes(node.kind)).map(node => <option key={node.id} value={node.id}>{clipNodePath(document, node.id)}</option>)}</select></label>
      </fieldset></details>}</header>
    <ClipLayerAppearance key={`${selected?.id}:${selected?.opacity}`} node={selected} disabled={props.disabled} onChange={updates => { if (selected) apply(() => updateClipLayer(project, selected.id, updates)) }} />
    <div className="clipLayerCommandBar" role="toolbar" aria-label="レイヤー操作">
      <button type="button" title="新規ラスターレイヤー" aria-label="新規ラスターレイヤー" disabled={newLayersDisabled} onClick={() => add('raster')}><ClipLayerIcon kind="raster" add /></button>
      <button type="button" title="新規レイヤーフォルダー" aria-label="新規レイヤーフォルダー" disabled={newLayersDisabled} onClick={() => add('folder')}><ClipLayerIcon kind="folder" add /></button>
      <button type="button" title="新規アニメーションフォルダー" aria-label="新規アニメーションフォルダー" disabled={newLayersDisabled} onClick={() => add('animation')}><ClipLayerIcon kind="animation" add /></button>
      <span className="clipCommandDivider" />
      <button type="button" className="clipImageImport" title={`画像を追加：${parentId ? clipNodePath(document, parentId) : '最上位'}`} disabled={newLayersDisabled} onClick={() => input.current?.click()}><ClipLayerIcon kind="image" />画像を追加…</button>
      <button type="button" className="clipDeleteLayer" title="レイヤーを削除" aria-label="レイヤーを削除" disabled={props.disabled || !selected || selected.locked} onClick={removeSelected}><ClipLayerIcon kind="trash" /></button>
    </div>
    <input ref={input} type="file" accept="image/*" multiple hidden onChange={event => { const beforeId = selected?.id === parentId ? children.get(parentId)?.[0]?.id : selected?.id; props.onFiles(Array.from(event.target.files ?? []), parentId, beforeId); event.target.value = '' }} />
    <div className="clipLayerSearch"><ClipLayerIcon kind="search" /><input aria-label="レイヤーを検索" placeholder="レイヤーを検索" value={search} onChange={event => setSearch(event.target.value)} /><label title="現在のタイムラインで未使用のセルだけを表示"><input type="checkbox" checked={unusedOnly} onChange={event => setUnusedOnly(event.target.checked)} />未使用</label></div>
    <div className={`clipLayerTree ${dropTarget?.id === null ? dropTarget.valid ? 'clipRootDrop' : 'clipRootDrop clipDropInvalid' : ''}`} role="tree" aria-label="CLIPレイヤーツリー">{renderNodes(null)}</div>
    <p className="clipDropStatus" aria-live="polite">{dropTarget ? `${dropTarget.valid ? '' : '移動・追加不可：'}${dropTarget.id ? document.nodes.find(node => node.id === dropTarget.id)?.name : '最上位'}${dropTarget.placement === 'before' ? ' の上に挿入' : dropTarget.placement === 'after' ? ' の下に挿入' : ' の中へ'}` : `画像の追加先：${parentId ? clipNodePath(document, parentId) : '最上位'}`}</p>
    <div className="clipSheetConnection">
      {selected?.kind === 'audio' && <ClipAudioImport key={`${project.projectId}:${props.activeCutId}:${props.activeSheetRevisionId}:${selected.id}`} project={project} node={selected} activeCutId={props.activeCutId} revisionId={props.activeSheetRevisionId} disabled={props.disabled} onChange={props.onChange} />}
      <div className="clipSheetConnectionTitle"><strong>シートとの対応</strong><label><input type="checkbox" checked={props.filterProcess} onChange={event => props.onFilterProcess(event.target.checked)} />{project.logicalSheet.processTimings ? '工程差を表示' : 'シートは選択工程だけ表示'}</label></div>
      <div className="clipSheetMapping">
        <label>グループ<select aria-label="登録先工程" value={props.activeProcessId} onChange={event => props.onProcessChange(event.target.value)}>{project.correctionLayers.map(process => <option key={process.layerId} value={process.layerId}>{process.label}</option>)}</select></label>
        <label>セル列<select aria-label="登録先セル列" value={paperTrack} onChange={event => setPaperTrack(event.target.value)}>{project.logicalSheet.paperTracks.map(track => <option key={track.paperTrack} value={track.paperTrack}>{track.label}</option>)}</select></label>
      </div>
      <p className="clipTargetPath" title={targetLabel}>登録先：{targetLabel}</p>
      {project.logicalSheet.processTimings && <p className="clipProcessEditing">表示・編集：{project.correctionLayers.find(process => process.layerId === props.activeProcessId)?.label}（独立したタイミング）</p>}
      {project.logicalSheet.processTimings && <button type="button" disabled={props.disabled} onClick={() => setProcessSettingsOpen(true)}>グループ設定…</button>}
      {project.logicalSheet.processTimings && props.filterProcess && <ClipProcessComparison project={project} onProcessChange={props.onProcessChange} />}
      <details className="clipMappingDetails"><summary>登録先・シート表示を設定</summary>
        <fieldset className="clipLayerTargets" disabled={props.disabled}>
          <label>セル内フォルダー<input aria-label="セル内の画像登録先" placeholder="例：作監（空欄はセル直下）" value={cellPath} onChange={event => setPathDraft({ slotId: target?.slotId, value: event.target.value })} /></label>
          <button type="button" disabled={selected?.kind !== 'animation'} onClick={() => apply(() => {
            const slot = project.cspTrackSlots.find(item => item.paperTrack === paperTrack && item.correctionLayerId === props.activeProcessId)
            if (!slot || !selected) throw new Error('登録先のセル列を選択してください。')
            return setClipTarget(project, slot.slotId, selected.id, cellPath.split('/').map(value => value.trim()).filter(Boolean))
          })}>選択フォルダーを登録先にする</button>
          {target && <button type="button" onClick={() => { if (window.confirm('この工程・列の対応を解除します。シートの番号とCLIPのレイヤーは残ります。')) apply(() => unsetClipTarget(project, target.slotId)) }}>対応を解除</button>}
          <div className="clipLayerTools"><button type="button" onClick={props.onAddColumn}>セル列＋</button>{(['background', 'book', 'memo'] as const).map(kind => <button type="button" key={kind} onClick={() => addGuide(kind)}>{kind === 'background' ? 'BG' : kind === 'book' ? 'BOOK' : 'メモ'}表示＋</button>)}</div>
          <button type="button" onClick={props.onNormalizeNames}>一括リネーム</button>
        </fieldset>
      </details>

    </div>
    {notice && <p role="status" className="clipLayerNotice">{notice}</p>}
    {processSettingsOpen && <ProcessSettingsDialog project={project} onClose={() => setProcessSettingsOpen(false)} onApply={layers => { if (apply(() => updateCorrectionLayers(project, layers))) setProcessSettingsOpen(false) }} />}
    {previewOpen && preview?.request === previewRequest && <AssetFloatingPreview isDragPassthrough={false} payload={preview.payload} rect={previewRect} onRectChange={setPreviewRect} onClose={() => setPreviewOpen(false)} />}
  </section>
}
