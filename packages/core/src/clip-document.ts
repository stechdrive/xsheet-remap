import type { ClipCanvasSettings, ClipTimeline } from './clip-export'
import type { ClipImportTimeline } from './clip-import'
import type { CutProject, SheetTimingRole } from './types'
import { createKey, setEvent } from './project-timing'
import { nextAssetSheetLabel } from './sheet-label-normalization'
import { selectTimingProcess } from './process-timing'

export interface ClipLayerNode {
  id: string
  parentId: string | null
  name: string
  kind: 'folder' | 'animation' | 'raster' | 'audio' | 'video' | 'other'
  visible: boolean
  opacity: number
  blendMode: number
  sourceLayerId?: number
  assetId?: string
  imageDataUrl?: string
  locked?: boolean
  /** CSP palette label, independent of the image's layer-color effect. */
  labelColor?: string
}

export interface ClipLayerTarget { slotId: string; folderId: string; cellPath?: string[] }

/** Nodes are in palette order, top to bottom. Source payloads are immutable. */
export interface ClipDocumentState {
  version: 1
  nodes: ClipLayerNode[]
  targets: ClipLayerTarget[]
  canvas: ClipCanvasSettings
  source?: { fileName: string; fileHash: string; dataUrl: string }
  sourceTimelines?: ClipImportTimeline[]
  timelineIds?: Record<string, string>
  baselineTracks?: Record<string, string>
  /** Explicitly deleted animation folders retain their paper notation but no longer export a track. */
  deletedTargetSlotIds?: string[]
}

export const DEFAULT_CLIP_CANVAS: ClipCanvasSettings = { width: 1754, height: 1240, dpi: 150, basisWidth: 1536, basisHeight: 864, offsetX: 0, offsetY: 0 }

export function validateClipDocument(value: ClipDocumentState): ClipDocumentState {
  if (value.version !== 1 || !Array.isArray(value.nodes) || value.nodes.length > 100_000 || !Array.isArray(value.targets)) throw new Error('CLIPレイヤー構造が不正です。')
  const nodes = new Map(value.nodes.map(node => [node.id, node]))
  if (nodes.size !== value.nodes.length) throw new Error('CLIPレイヤーIDが重複しています。')
  for (const node of value.nodes) {
    if (!node.id || typeof node.name !== 'string' || !['folder', 'animation', 'raster', 'audio', 'video', 'other'].includes(node.kind)
      || typeof node.visible !== 'boolean' || !Number.isFinite(node.opacity) || node.opacity < 0 || node.opacity > 1 || !Number.isInteger(node.blendMode)) throw new Error('CLIPレイヤー属性が不正です。')
    if (node.labelColor !== undefined && !/^#[0-9a-f]{6}$/i.test(node.labelColor)) throw new Error('レイヤーのラベルカラーが不正です。')
    const seen = new Set([node.id]); let parentId = node.parentId
    while (parentId !== null) {
      const parent = nodes.get(parentId)
      if (!parent || seen.has(parentId) || seen.size > 100 || !['folder', 'animation'].includes(parent.kind)) throw new Error('CLIPレイヤーの親子関係が不正です。')
      if (node.kind === 'animation' && parent.kind === 'animation') throw new Error('アニメーションフォルダーは入れ子にできません。')
      seen.add(parentId); parentId = parent.parentId
    }
  }
  if (new Set(value.targets.map(target => target.slotId)).size !== value.targets.length) throw new Error('CLIP登録先が重複しています。')
  if (value.deletedTargetSlotIds && (!Array.isArray(value.deletedTargetSlotIds) || value.deletedTargetSlotIds.some(id => typeof id !== 'string' || value.targets.some(target => target.slotId === id)))) throw new Error('削除済みCLIP登録先が不正です。')
  if (new Set(value.targets.map(target => target.folderId)).size !== value.targets.length) throw new Error('同じCLIPフォルダーを複数の工程・列へ対応づけることはできません。')
  for (const target of value.targets) {
    if (nodes.get(target.folderId)?.kind !== 'animation' || target.cellPath?.some(name => !name.trim())) throw new Error('CLIP登録先が不正です。')
  }
  return value
}

export function clipChildren(document: ClipDocumentState, parentId: string | null): ClipLayerNode[] {
  return document.nodes.filter(node => node.parentId === parentId)
}

export function clipEffectiveCel(document: ClipDocumentState, folderId: string, name: string): ClipLayerNode | undefined {
  return clipChildren(document, folderId).reverse().find(node => node.name === name)
}

export function clipCelRoot(document: ClipDocumentState, nodeId: string): ClipLayerNode | undefined {
  let node = document.nodes.find(item => item.id === nodeId)
  if (node?.kind === 'audio' || node?.kind === 'video') return undefined
  while (node?.parentId) {
    const parent = document.nodes.find(item => item.id === node!.parentId)
    if (parent?.kind === 'animation') return node
    node = parent
  }
  return undefined
}

export function clipNodePath(document: ClipDocumentState, id: string): string {
  const names: string[] = []; let node = document.nodes.find(item => item.id === id)
  while (node) { names.unshift(node.name); node = document.nodes.find(item => item.id === node!.parentId) }
  return names.join(' / ')
}

export function createClipNode(name: string, kind: ClipLayerNode['kind'], parentId: string | null, id = `layer_${crypto.randomUUID()}`): ClipLayerNode {
  return { id, parentId, name, kind, visible: true, opacity: 1, blendMode: 0 }
}

const defaultProcessLabelColors: Record<string, string> = {
  layer_enshutsu: '#fbece6', layer_kantoku: '#dce4f1', layer_sakkan: '#fcf9cf',
  layer_sousakkan: '#eaf6d5', layer_other: '#ffddaa',
}

/** Upgrade legacy registration without discarding unused cels or static material. */
export function ensureClipDocument(project: CutProject): CutProject {
  if (project.clipDocument) return project
  const nodes: ClipLayerNode[] = [], targets: ClipLayerTarget[] = []
  for (const stage of [...project.productionStages].sort((a, b) => b.order - a.order)) {
    nodes.push(createClipNode(stage.label, 'folder', null, `stage:${stage.stageId}`))
    for (const process of project.correctionLayers.filter(item => item.stageId === stage.stageId).sort((a, b) => b.order - a.order)) {
      const parentId = `process:${process.layerId}`
      nodes.push({ ...createClipNode(process.label, 'folder', `stage:${stage.stageId}`, parentId), visible: process.defaultVisible, labelColor: defaultProcessLabelColors[process.layerId] })
      for (const slot of project.cspTrackSlots.filter(item => item.correctionLayerId === process.layerId).sort((a, b) => b.trackNo - a.trackNo)) {
        const folderId = `slot:${slot.slotId}`
        const track = project.logicalSheet.paperTracks.find(item => item.paperTrack === slot.paperTrack)
        nodes.push(createClipNode(track?.label || slot.paperTrack, 'animation', parentId, folderId))
        targets.push({ slotId: slot.slotId, folderId })
        for (const binding of project.bindings.filter(item => item.slotId === slot.slotId)) {
          if (!nodes.some(node => node.parentId === folderId && node.name === binding.cspCellName)) {
            nodes.push({ ...createClipNode(binding.cspCellName, 'raster', folderId, `binding:${binding.bindingId}`), assetId: binding.assetId })
          }
        }
      }
      for (const guide of project.stackGuideLabels) for (const registration of guide.registrations ?? []) {
        if (registration.correctionLayerId !== process.layerId) continue
        const id = `guide:${registration.registrationId}`
        nodes.push(createClipNode(guide.label, 'folder', parentId, id))
        for (const assetId of registration.assetIds) {
          const asset = project.assets.find(item => item.assetId === assetId)
          nodes.push({ ...createClipNode(asset?.displayName || guide.label, 'raster', id, `${id}:${assetId}`), assetId })
        }
      }
    }
  }
  const placedAssets = new Set(nodes.flatMap(node => node.assetId ? [node.assetId] : []))
  const unplaced = project.assets.filter(asset => (asset.role ?? 'cell-material') === 'cell-material' && !placedAssets.has(asset.assetId))
  if (unplaced.length) {
    const folder = createClipNode('未配置の素材', 'folder', null, 'legacy:unplaced')
    nodes.push(folder, ...unplaced.map(asset => ({ ...createClipNode(asset.displayName.replace(/\.[^.]+$/, ''), 'raster', folder.id, `asset:${asset.assetId}`), assetId: asset.assetId })))
  }
  return { ...project, logicalSheet: !project.logicalSheet.keys.length && !project.logicalSheet.events.length ? { ...project.logicalSheet, processTimings: { activeProcessId: project.correctionLayers.find(layer => layer.role === 'base')?.layerId ?? project.correctionLayers[0]!.layerId, inactive: {} } } : project.logicalSheet, clipDocument: { version: 1, nodes, targets, canvas: { ...DEFAULT_CLIP_CANVAS } } }
}

/** Insert only the new column. Existing CLIP hierarchy and sibling order remain authoritative. */
export function addClipPaperTrackFolders(project: CutProject, paperTrack: string): CutProject {
  return placeClipPaperTrackFolders(project, paperTrack, true)
}

export function reorderClipPaperTrackFolders(project: CutProject, paperTrack: string): CutProject {
  return placeClipPaperTrackFolders(project, paperTrack, false)
}

function placeClipPaperTrackFolders(project: CutProject, paperTrack: string, create: boolean): CutProject {
  if (!project.clipDocument) return project
  let next = project
  for (const slot of project.cspTrackSlots.filter(item => item.paperTrack === paperTrack)) {
    const document = next.clipDocument!
    const target = document.targets.find(target => target.slotId === slot.slotId)
    const current = document.nodes.find(node => node.id === target?.folderId)
    if (create ? current : !current) continue
    const neighbors = project.cspTrackSlots.filter(item => item.correctionLayerId === slot.correctionLayerId && item.slotId !== slot.slotId)
      .sort((a, b) => a.trackNo - b.trackNo)
      .flatMap(item => {
        const target = document.targets.find(target => target.slotId === item.slotId)
        const node = document.nodes.find(node => node.id === target?.folderId)
        return node && (!current || node.parentId === current.parentId) ? [{ slot: item, node }] : []
      })
    const below = neighbors.filter(item => item.slot.trackNo < slot.trackNo).at(-1)?.node
    const above = neighbors.find(item => item.slot.trackNo > slot.trackNo)?.node
    const anchor = below ?? above
    if (current && !anchor) continue
    const presetParent = document.nodes.find(node => node.id === `process:${slot.correctionLayerId}` && node.kind === 'folder')
    // An unmapped imported group has no known insertion parent. Leave it explicitly unmapped.
    if (!anchor && !presetParent) continue
    const parentId = anchor ? anchor.parentId : presetParent!.id
    const siblings = clipChildren(document, parentId).filter(node => node.id !== current?.id)
    const beforeId = below?.id ?? (above ? siblings[siblings.findIndex(node => node.id === above.id) + 1]?.id : siblings[0]?.id)
    if (current) next = moveClipLayer(next, current.id, current.parentId, beforeId)
    else {
      const name = project.logicalSheet.paperTracks.find(track => track.paperTrack === paperTrack)?.label || paperTrack
      const folder = createClipNode(name, 'animation', parentId)
      next = setClipTarget(addClipLayers(next, [folder], beforeId), slot.slotId, folder.id)
    }
  }
  return next
}

function requireEditableParent(document: ClipDocumentState, parentId: string | null): void {
  if (parentId === null) return
  const parent = document.nodes.find(node => node.id === parentId)
  if (!parent || !['animation', 'folder'].includes(parent.kind) || parent.locked) throw new Error('このレイヤーには追加できません。')
}

function checkCelName(document: ClipDocumentState, node: ClipLayerNode): void {
  if (!node.name.trim()) throw new Error('レイヤー名を入力してください。')
  const parent = document.nodes.find(item => item.id === node.parentId)
  if (parent?.kind === 'animation' && document.nodes.some(item => item.id !== node.id && item.parentId === node.parentId && item.name === node.name)) throw new Error(`同じアニメーションフォルダーに「${node.name}」が存在します。別名を指定してください。`)
}

export function addClipLayers(projectInput: CutProject, layers: ClipLayerNode[], beforeId?: string): CutProject {
  const project = ensureClipDocument(projectInput); let document = project.clipDocument!
  for (const node of layers) {
    requireEditableParent(document, node.parentId); checkCelName(document, node)
    const index = beforeId ? document.nodes.findIndex(item => item.id === beforeId && item.parentId === node.parentId) : document.nodes.length
    if (index < 0) throw new Error('挿入先が見つかりません。')
    const nodes = [...document.nodes]; nodes.splice(index, 0, node)
    document = { ...document, nodes }
  }
  validateClipDocument(document)
  return { ...project, clipDocument: document }
}

export function updateClipLayer(projectInput: CutProject, id: string, updates: Partial<Pick<ClipLayerNode, 'name' | 'visible' | 'opacity' | 'blendMode'>>): CutProject {
  const project = ensureClipDocument(projectInput), document = project.clipDocument!
  const original = document.nodes.find(node => node.id === id)
  if (!original || original.locked) throw new Error('このレイヤーは編集できません。')
  const changed = { ...original, ...updates }
  if (updates.name !== undefined && updates.name !== original.name) checkCelName(document, changed)
  const next = validateClipDocument({ ...document, nodes: document.nodes.map(node => node.id === id ? changed : node) })
  return { ...project, clipDocument: next, bindings: project.bindings.map(binding => binding.clipLayerId === id ? { ...binding, cspCellName: changed.name } : binding) }
}

export function moveClipLayer(projectInput: CutProject, id: string, parentId: string | null, beforeId?: string): CutProject {
  const project = ensureClipDocument(projectInput), document = project.clipDocument!
  const original = document.nodes.find(node => node.id === id)
  if (!original || original.locked) throw new Error('このレイヤーは移動できません。')
  requireEditableParent(document, parentId)
  const node = { ...original, parentId }
  if (original.parentId !== parentId) checkCelName(document, node)
  const bound = project.bindings.some(binding => binding.clipLayerId === id)
  if (bound && original.parentId !== parentId) throw new Error('シートで使用するセルは、登録先の対応を解除してから移動してください。')
  const nodes = document.nodes.filter(item => item.id !== id)
  const index = beforeId ? nodes.findIndex(item => item.id === beforeId && item.parentId === parentId) : nodes.length
  if (index < 0) throw new Error('移動先が見つかりません。')
  nodes.splice(index, 0, node)
  // Moving a folder containing media into a cel would delete its native track.
  // Preserve imported unusual hierarchies, but never create this situation.
  const nextDocument = validateClipDocument({ ...document, nodes })
  for (const media of nodes.filter(item => item.kind === 'audio' || item.kind === 'video')) {
    const ancestors = (value: ClipDocumentState) => {
      let parent = value.nodes.find(item => item.id === media.id)?.parentId
      const result: string[] = []
      while (parent) { const entry = value.nodes.find(item => item.id === parent)!; if (entry.kind === 'animation') result.push(entry.id); parent = entry.parentId }
      return result.join('/')
    }
    if (ancestors(document) !== ancestors(nextDocument)) throw new Error('音声・動画はアニメーションフォルダーへ出し入れできません。通常のフォルダーを選んでください。')
  }
  if (document.nodes.find(item => item.id === parentId)?.kind === 'animation' && original.parentId === parentId && document.nodes.some(item => item.id !== id && item.parentId === parentId && item.name === node.name)
    && clipEffectiveCel({ ...document, nodes }, parentId!, node.name)?.id !== clipEffectiveCel(document, parentId!, node.name)?.id) throw new Error('同名セルの採用対象が変わります。先にセル名を変更してください。')
  return { ...project, clipDocument: nextDocument }
}

export function deleteClipLayer(projectInput: CutProject, id: string): CutProject {
  const project = ensureClipDocument(projectInput), document = project.clipDocument!
  const removed = new Set([id]); let count = 0
  while (count !== removed.size) { count = removed.size; for (const node of document.nodes) if (node.parentId && removed.has(node.parentId)) removed.add(node.id) }
  if (document.nodes.some(node => removed.has(node.id) && node.locked)) throw new Error('保護されたレイヤーを含むため削除できません。')
  for (const node of document.nodes.filter(node => removed.has(node.id))) {
    if (node.parentId && !removed.has(node.parentId) && document.nodes.find(parent => parent.id === node.parentId)?.kind === 'animation'
      && clipEffectiveCel(document, node.parentId, node.name)?.id === node.id
      && document.nodes.some(other => !removed.has(other.id) && other.parentId === node.parentId && other.name === node.name)) throw new Error('同名セルの採用対象が変わります。先にセル名を変更してください。')
  }
  const bindings = project.bindings.filter(binding => !binding.clipLayerId || !removed.has(binding.clipLayerId))
  const deletedTargetSlotIds = [...new Set([...document.deletedTargetSlotIds ?? [], ...document.targets.filter(target => removed.has(target.folderId)).map(target => target.slotId)])]
  return { ...project, bindings, clipDocument: { ...document, deletedTargetSlotIds, nodes: document.nodes.filter(node => !removed.has(node.id)), targets: document.targets.filter(target => !removed.has(target.folderId)) } }
}

export function setClipTarget(projectInput: CutProject, slotId: string, folderId: string, cellPath?: string[]): CutProject {
  const project = ensureClipDocument(projectInput), document = project.clipDocument!
  if (!project.cspTrackSlots.some(slot => slot.slotId === slotId)) throw new Error('シートの登録先がありません。')
  if (document.targets.some(target => target.folderId === folderId && target.slotId !== slotId)) throw new Error('このフォルダーは別のセル列・工程に対応しています。先に対応を解除してください。')
  const old = document.targets.find(target => target.slotId === slotId)
  if (old && old.folderId !== folderId && project.bindings.some(binding => binding.slotId === slotId)) throw new Error('素材が登録されているセル列の対応は変更できません。空の工程・セル列を選択してください。')
  return { ...project, clipDocument: validateClipDocument({ ...document, deletedTargetSlotIds: document.deletedTargetSlotIds?.filter(id => id !== slotId), targets: [...document.targets.filter(target => target.slotId !== slotId), { slotId, folderId, ...(cellPath?.length ? { cellPath } : {}) }] }) }
}

export function unsetClipTarget(project: CutProject, slotId: string): CutProject {
  if (!project.clipDocument) return project
  return { ...project, bindings: project.bindings.filter(binding => binding.slotId !== slotId), clipDocument: { ...project.clipDocument, targets: project.clipDocument.targets.filter(target => target.slotId !== slotId) } }
}

export function bindClipCel(projectInput: CutProject, nodeId: string, paperTrack: string, frame: number, role: SheetTimingRole, processId: string): CutProject {
  let project = selectTimingProcess(ensureClipDocument(projectInput), processId)
  const { cel, slot } = clipCelDropTarget(project, nodeId, paperTrack, processId)
  let binding = project.bindings.find(item => item.slotId === slot.slotId && item.clipLayerId === cel.id && project.logicalSheet.keys.some(key => key.keyId === item.keyId && (key.sheetRole ?? 'action') === role))
  if (!binding) {
    const label = nextAssetSheetLabel(project, paperTrack, role)
    const created = createKey(project, paperTrack, label, 'asset-drop', label, role); project = created.project
    binding = { bindingId: `binding_${crypto.randomUUID()}`, slotId: slot.slotId, keyId: created.key.keyId, cspCellName: cel.name, clipLayerId: cel.id, assetId: cel.assetId, materialState: 'assigned' }
    project = { ...project, bindings: [...project.bindings, binding] }
  }
  return setEvent(project, paperTrack, frame, binding.keyId, role)
}

export function clipCelDropTarget(project: CutProject, nodeId: string, paperTrack: string, processId: string) {
  const document = project.clipDocument
  if (!document) throw new Error('CLIPレイヤー構造がありません。')
  if (document.nodes.some(node => node.id === nodeId && (node.kind === 'audio' || node.kind === 'video'))) throw new Error('音声・動画は画像セルとして登録できません。音声は「セリフ音声へ取り込む」を使用してください。')
  const cel = clipCelRoot(document, nodeId)
  if (!cel) throw new Error('通常レイヤーをセルとして使うには、先にアニメーションフォルダーへ移動してください。')
  if (clipEffectiveCel(document, cel.parentId!, cel.name)?.id !== cel.id) throw new Error('同名セルが下段にあります。CSPで再生されるセルを選ぶか、別名にしてください。')
  const slot = project.cspTrackSlots.find(item => item.paperTrack === paperTrack && item.correctionLayerId === processId)
  const target = document.targets.find(item => item.slotId === slot?.slotId)
  if (!slot || target?.folderId !== cel.parentId) throw new Error('このセルとシート列の登録先が一致しません。登録先の対応を確認してください。')
  return { cel, slot }
}

export function addClipImages(project: CutProject, parentId: string | null, images: { name: string; assetId: string; imageDataUrl: string }[], sheet?: { paperTrack: string; frame: number; role: SheetTimingRole; processId: string }, beforeId?: string): CutProject {
  let next = ensureClipDocument(project)
  const target = next.clipDocument!.targets.find(item => sheet ? item.slotId === next.cspTrackSlots.find(slot => slot.paperTrack === sheet.paperTrack && slot.correctionLayerId === sheet.processId)?.slotId : item.folderId === parentId)
  if (sheet && !target) throw new Error('この工程・セル列の登録先アニメーションフォルダーを指定してください。')
  if (sheet && images.length !== 1) throw new Error('シートには画像を1枚ずつ配置してください。複数画像はレイヤーツリーへ追加できます。')
  for (const image of images) {
    const destination = target?.folderId ?? parentId
    const name = image.name.replace(/\.[^.]+$/, '') || '画像'
    let cel = createClipNode(name, target?.cellPath?.length ? 'folder' : 'raster', destination)
    if (target?.cellPath?.length) {
      next = addClipLayers(next, [cel], beforeId)
      let parent = cel.id
      for (const path of target.cellPath) { const folder = createClipNode(path, 'folder', parent); next = addClipLayers(next, [folder]); parent = folder.id }
      next = addClipLayers(next, [{ ...createClipNode(name, 'raster', parent), assetId: image.assetId, imageDataUrl: image.imageDataUrl }])
    } else { cel = { ...cel, assetId: image.assetId, imageDataUrl: image.imageDataUrl }; next = addClipLayers(next, [cel], beforeId) }
    if (sheet) next = bindClipCel(next, cel.id, sheet.paperTrack, sheet.frame, sheet.role, sheet.processId)
  }
  return next
}

/** Reconcile explicit legacy sheet edits, never rebuild an imported hierarchy. */
export function synchronizeClipBindings(project: CutProject): CutProject {
  if (!project.clipDocument) return project
  let document = project.clipDocument
  const targets = document.targets.filter(target => project.cspTrackSlots.some(slot => slot.slotId === target.slotId))
  if (targets.length !== document.targets.length) document = { ...document, targets }
  const bindings = project.bindings.map(binding => {
    const target = document.targets.find(item => item.slotId === binding.slotId)
    if (!target) return binding
    let node = binding.clipLayerId ? document.nodes.find(item => item.id === binding.clipLayerId) : clipEffectiveCel(document, target.folderId, binding.cspCellName)
    if (!node) {
      if (document.source && project.logicalSheet.keys.find(key => key.keyId === binding.keyId)?.createdFrom === 'import') return binding
      node = { ...createClipNode(binding.cspCellName, 'raster', target.folderId, `binding:${binding.bindingId}`), assetId: binding.assetId }
      document = { ...document, nodes: [...document.nodes, node] }
    } else if (!node.sourceLayerId && binding.assetId && binding.assetId !== node.assetId) {
      node = { ...node, assetId: binding.assetId }; document = { ...document, nodes: document.nodes.map(item => item.id === node!.id ? node! : item) }
    }
    return binding.clipLayerId === node.id ? binding : { ...binding, clipLayerId: node.id }
  })
  return document === project.clipDocument && bindings.every((binding, i) => binding === project.bindings[i]) ? project : { ...project, clipDocument: document, bindings }
}

export function clipTrackSignature(timeline: Pick<ClipTimeline, 'fps' | 'duration'>, frames: ClipTimeline['tracks'][number]['frames'], labels: ClipTimeline['tracks'][number]['labels'] = []): string {
  return JSON.stringify([timeline.fps, timeline.duration, frames, labels])
}
