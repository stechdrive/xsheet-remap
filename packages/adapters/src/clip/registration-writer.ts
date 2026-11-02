import { normalizeClipName, clipImagePlacement, type ClipCanvasSettings } from '@xsheet-remap/core'
import type { DocumentSession, EditOperation, Pixels } from 'celcodec/document'
import { flattenLayers } from './session'
import { nativeAudio, nativeId, namespace } from './celcodec-plan'
import { check } from './binary'
import type { ClipWriteOptions } from './writer'

/** The application's managed registration names become UUIDs and explicit edits. */
export async function registrationEdits(session: DocumentSession, options: ClipWriteOptions, canvas: ClipCanvasSettings, progress: (message: string) => void): Promise<EditOperation[]> {
  const { plan } = options, edits: EditOperation[] = [], source = flattenLayers(session.document.layers)
  const layers = new Map(source.map(layer => [layer.id, { parentId: layer.parentId, kind: layer.animation ? 'animation' : layer.folder ? 'folder' : layer.kind, name: layer.name }]))
  const animations = new Set(source.filter(layer => layer.animation).map(layer => layer.id)), added = new Set<string>()
  async function ensure(key: string, name: string, parentId: string | null, kind: 'folder' | 'animation' | 'raster', pixels?: Pixels) {
    const id = await nativeId(plan.projectId, key), existing = layers.get(id)
    const placement = pixels ? clipImagePlacement(canvas, pixels, 'crop') : undefined
    if (existing) {
      check(existing.kind === kind && existing.parentId === parentId, '既存レイヤーの種類・親が一致しません。')
      if (existing.name !== name) edits.push({ type: 'renameLayer', layerId: id, name })
      if (pixels && placement) edits.push({ type: 'replaceRasterPixels', layerId: id, pixels, left: placement.x, top: placement.y })
    } else {
      edits.push({ type: 'addLayer', id, name, parentId, kind, ...(pixels && placement ? { pixels, left: placement.x, top: placement.y } : {}) })
      layers.set(id, { parentId, kind, name }); added.add(id)
      if (kind === 'animation') animations.add(id)
    }
    return id
  }
  const managed = await ensure('root', 'xsheet-remap', null, 'folder'), folders = new Map<string, string>()
  for (const folder of plan.folders) {
    progress('レイヤーを作成しています: ' + folder.name)
    let parent = managed
    for (let i = 0; i < folder.path.length; i++) parent = await ensure(`path:${JSON.stringify(folder.path.slice(0, i + 1).map(normalizeClipName))}`, folder.path[i], parent, 'folder')
    const animation = await ensure(`folder:${folder.id}`, folder.name, parent, 'animation')
    folders.set(folder.id, animation)
    for (const cel of folder.cels) await ensure(`cel:${folder.id}:${cel.name}`, cel.name, animation, 'raster', cel.assetId ? options.images[cel.assetId] : undefined)
  }
  const selected = new Set<string>(), audioEdits: EditOperation[] = []
  for (const time of plan.timelines) {
    progress('タイムラインを作成しています: ' + time.name)
    const id = await nativeId(plan.projectId, `timeline:${time.id}`), existing = session.document.timelines.find(timeline => timeline.id === id)
    selected.add(id)
    if (!existing) edits.push({ type: 'createTimeline', id, name: time.name, fps: time.fps, startFrame: 0, endFrame: time.duration })
    else edits.push({ type: 'setTimeline', timelineId: id, name: time.name, fps: time.fps, startFrame: 0, endFrame: time.duration, timingPolicy: 'preserve-time' })
    for (const animation of animations) {
      const definition = time.tracks.find(track => folders.get(track.folderId) === animation)
      const keys = (definition?.frames ?? []).slice().sort((a, b) => a.frame - b.frame)
      check(keys.every((key, i) => Number.isInteger(key.frame) && key.frame >= 0 && key.frame < time.duration && (!i || key.frame > keys[i - 1].frame)), 'セル指定の順序または値が不正です。')
      if (!keys.length || keys[0].frame > 0) keys.unshift({ frame: 0, value: null })
      edits.push({ type: 'setCelKeys', timelineId: id, layerId: animation, keys })
      const oldTrack = existing?.tracks.find(track => track.layerId === animation)
      for (const label of oldTrack?.labels ?? []) if ([1, 2].includes(label.type) && !label.name)
        edits.push({ type: 'removeTrackLabel', trackId: oldTrack!.id, labelId: label.id })
      for (const label of [...definition?.labels ?? []].sort((a, b) => a.frame - b.frame))
        edits.push({ type: 'setTrackLabel', timelineId: id, layerId: animation, ...label })
    }
    if (time.audio) audioEdits.push({ type: 'replaceAudio', timelineId: id, audio: nativeAudio(time.audio), namespace: namespace(plan.projectId) })
  }
  for (const time of session.document.timelines) if (!selected.has(time.id)) {
    for (const animation of animations) if (added.has(animation)) edits.push({ type: 'setCelKeys', timelineId: time.id, layerId: animation, keys: [{ frame: 0, value: null }] })
  }
  // Audio also installs explicit silence in other cuts, so every timeline must exist first.
  edits.push(...audioEdits, { type: 'setActiveTimeline', timelineId: selected.values().next().value! })
  return edits
}
