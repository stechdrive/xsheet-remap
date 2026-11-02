import { validateClipDocument, type ClipCanvasSettings } from '@xsheet-remap/core'
import type { DocumentSession, EditOperation, LayerAttributes, TimelineView } from 'celcodec/document'
import type { ClipRegistrationPlan } from '@xsheet-remap/core'
import { flattenLayers } from './session'
import { nativeAudio, nativeId, namespace } from './celcodec-plan'
import { check } from './binary'
import type { ClipWriteOptions } from './writer'

/** Project edits are converted to public operations; native preservation belongs to celcodec. */
export async function documentEdits(session: DocumentSession, options: ClipWriteOptions, canvas: ClipCanvasSettings, progress: (message: string) => void): Promise<EditOperation[]> {
  const state = validateClipDocument(options.plan.document!), edits: EditOperation[] = [], source = flattenLayers(session.document.layers)
  const originals = new Map(source.map(layer => [layer.id, layer]))
  const ids = new Map<string, string>()
  for (const node of state.nodes) {
    if (node.sourceLayerId !== undefined) check(originals.get(node.id)?.nativeId === node.sourceLayerId, '元レイヤーと編集対象が一致しません。')
    ids.set(node.id, node.sourceLayerId === undefined ? await nativeId(options.plan.projectId, node.id) : node.id)
  }
  const parents = new Map(source.map(layer => [layer.id, layer.parentId]))
  const children = new Map<string | null, string[]>([[null, session.document.layers.map(layer => layer.id)]])
  for (const layer of source) children.set(layer.id, layer.children.map(child => child.id))
  const pending = [...state.nodes], done = new Set<string>()
  while (pending.length) {
    const at = pending.findIndex(node => node.parentId === null || done.has(node.parentId))
    check(at >= 0, 'CLIPレイヤーの親子関係が不正です。')
    const node = pending.splice(at, 1)[0], id = ids.get(node.id)!, parentId = node.parentId === null ? null : ids.get(node.parentId)!
    const original = originals.get(id)
    if (!original) {
      check(node.kind === 'folder' || node.kind === 'animation' || node.kind === 'raster', '新規作成できないレイヤー種類です。')
      const image = options.images[node.id] ?? (node.assetId ? options.images[node.assetId] : undefined)
      edits.push({ type: 'addLayer', id, parentId, name: node.name, kind: node.kind,
        ...(image ? { pixels: image, left: Math.ceil((canvas.width - image.width) / 2), top: Math.ceil((canvas.height - image.height) / 2) } : {}) })
      parents.set(id, parentId); children.set(id, []); children.get(parentId)!.unshift(id)
      progress('レイヤーを作成しています: ' + node.name)
    } else if (original.name !== node.name) edits.push({ type: 'renameLayer', layerId: id, name: node.name })
    const attributes: LayerAttributes = {}
    if (node.visible !== (original?.visible ?? true)) attributes.visible = node.visible
    const opacity = Math.round(node.opacity * 256) / 256
    if (opacity !== (original?.opacity ?? 1)) attributes.opacity = opacity
    if (node.blendMode !== (original?.blendMode ?? 0)) attributes.blendMode = node.blendMode
    if (node.locked !== undefined && original?.stored.type !== 1584 && node.locked !== (original?.locked ?? false)) attributes.locked = node.locked
    if (node.expanded !== undefined && node.expanded !== (original?.expanded ?? true)) attributes.expanded = node.expanded
    if (node.labelColor !== undefined && node.labelColor !== original?.labelColor) attributes.labelColor = node.labelColor
    if (Object.keys(attributes).length) edits.push({ type: 'setLayerAttributes', layerId: id, attributes })
    done.add(node.id)
  }
  // Simulate ordering as each public move takes effect, including newly added parents.
  for (const parent of [null, ...state.nodes.filter(node => node.kind === 'folder' || node.kind === 'animation').map(node => node.id)]) {
    const parentId = parent === null ? null : ids.get(parent)!, desired = state.nodes.filter(node => node.parentId === parent).map(node => ids.get(node.id)!)
    desired.forEach((id, index) => {
      const currentParent = parents.get(id)!, siblings = children.get(currentParent)!, currentIndex = siblings.indexOf(id)
      if (currentParent === parentId && currentIndex === index) return
      edits.push({ type: 'moveLayer', layerId: id, parentId, index, celReferences: 'follow-layer-order', crossAnimationTracks: 'detach' })
      siblings.splice(currentIndex, 1); children.get(parentId)!.splice(index, 0, id); parents.set(id, parentId)
    })
  }
  if (state.source) {
    const kept = new Set(ids.values()), removed = new Set(source.filter(layer => !kept.has(layer.id)).map(layer => layer.id))
    for (const id of removed) if (!removed.has(parents.get(id)!)) edits.push({ type: 'removeLayer', layerId: id, recursive: true })
  }
  const newAnimations = state.nodes.filter(node => node.kind === 'animation' && node.sourceLayerId === undefined)
  const times: { id: string; definition?: ClipRegistrationPlan['timelines'][number]; existing?: TimelineView }[] = session.document.timelines.map(time => ({ id: time.id, definition: options.plan.timelines.find(definition => definition.sourceTimelineId === time.id), existing: time }))
  for (const definition of options.plan.timelines.filter(time => !time.sourceTimelineId)) {
    if (state.source && !definition.tracks.some(track => track.frames.length) && !definition.audio?.tracks.some(track => track.clips.length)) continue
    const id = await nativeId(options.plan.projectId, `timeline:${definition.id}`)
    edits.push({ type: 'createTimeline', id, name: definition.name, fps: definition.fps, startFrame: 0, endFrame: definition.duration })
    times.push({ id, definition })
  }
  for (const { id, definition, existing } of times) {
    progress('タイムラインを作成しています: ' + (definition?.name ?? existing!.name))
    if (existing && definition && (existing.fps !== definition.fps || existing.endFrame !== existing.startFrame + definition.duration))
      edits.push({ type: 'setTimeline', timelineId: id, fps: definition.fps, endFrame: existing.startFrame + definition.duration, timingPolicy: 'preserve-time' })
    for (const node of state.nodes.filter(node => node.kind === 'animation')) {
      const layerId = ids.get(node.id)!, target = definition?.tracks.find(track => track.folderId === node.id)
      if (target && !target.preserve) {
        const keys = target.frames.map(key => ({ ...key }))
        if (!existing?.tracks.some(track => track.layerId === layerId) && (!keys.length || keys[0].frame > 0)) keys.unshift({ frame: 0, value: null })
        edits.push({ type: 'setCelKeys', timelineId: id, layerId, keys })
        for (const label of target.labels ?? []) edits.push({ type: 'setTrackLabel', timelineId: id, layerId, ...label })
      } else if ((!existing || newAnimations.includes(node)) && !existing?.tracks.some(track => track.layerId === layerId))
        edits.push({ type: 'setCelKeys', timelineId: id, layerId, keys: [{ frame: 0, value: null }] })
    }
    if (definition?.audio) edits.push({ type: 'replaceAudio', timelineId: id, audio: nativeAudio(definition.audio), namespace: namespace(options.plan.projectId) })
  }
  return edits
}
