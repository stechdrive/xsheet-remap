import type { SqlJsStatic } from 'sql.js'
import { clipImagePlacement, normalizeClipName, validateClipCanvas, type ClipCanvasSettings, type ClipImageFit, type ClipRegistrationPlan, type ClipTimeline } from '@xsheet-remap/core'
import { check, identity, layerUuid } from './binary'
import { animationMixer, packedMixer, trackValueMap } from './animation'
import { inspectCanvas, resizeCanvas } from './canvas'
import { ClipContainer, type Row } from './container'
import { createLayer, refreshCaches, writeMipmap } from './layers'
import { placePixels, png, type Pixels } from './raster'
export interface ClipWriteOptions {
  plan: ClipRegistrationPlan
  canvas: ClipCanvasSettings
  fit: ClipImageFit
  images: Record<string, Pixels>
  template?: Uint8Array
}
export interface ClipWriteResult { bytes: Uint8Array; canvas: ClipCanvasSettings; layers: number; timelines: number }

export async function writeClip(SQL: SqlJsStatic, seedBytes: Uint8Array, options: ClipWriteOptions, progress: (message: string) => void = () => {}): Promise<ClipWriteResult> {
  const clip = new ClipContainer(SQL, options.template ?? seedBytes)
  let seed: ClipContainer | undefined
  try {
    seed = new ClipContainer(SQL, seedBytes)
    const prototypes = seed
    const fresh = !options.template, { plan } = options
    check(plan.timelines.length > 0 && plan.timelines.length <= 1000 && plan.folders.length <= 2000, 'タイムラインまたはフォルダー数が範囲外です。')
    let settings = fresh ? { ...options.canvas } : inspectCanvas(clip)
    validateClipCanvas(settings)
    const dimensions = new Set(Object.values(options.images).map(image => `${image.width}x${image.height}`))
    check(dimensions.size <= 1, '登録画像のピクセル寸法を揃えてください。')
    for (const image of Object.values(options.images)) {
      check(image.channels === 4 && image.width > 0 && image.height > 0 && image.width * image.height <= 100_000_000 && image.data.length === image.width * image.height * 4, '登録画像が不正です。')
      const placement = clipImagePlacement(settings, image, options.fit)
      settings = { ...settings, width: placement.width, height: placement.height }
    }
    const root = clip.rows('Layer').find(layer => layer.MainId === clip.rows('Canvas')[0].CanvasRootFolder)!
    if (fresh) {
      const paper = clip.rows('Layer').find(layer => layer.LayerType === 1584)!
      clip.db.run('DELETE FROM Layer WHERE MainId NOT IN (?,?)', [root.MainId, paper.MainId])
      clip.update('Layer', paper.MainId, { LayerNextIndex: 0 })
      clip.db.run('DELETE FROM Track'); clip.db.run('DELETE FROM TimeLine')
      clip.update('AnimationCutBank', clip.rows('AnimationCutBank')[0].MainId, { FirstTimeLine: 0, CurrentIndex: 0 })
    }
    const old = inspectCanvas(clip)
    if (fresh || old.width !== settings.width || old.height !== settings.height) {
      progress('キャンバスを準備しています…'); resizeCanvas(clip, settings, fresh)
    }
    const newLayerIds = new Set<Row[string]>()
    const parentById = new Map<Row[string], Row[string]>()
    for (const parent of clip.rows('Layer').filter(row => row.LayerFirstChildIndex)) {
      let next = parent.LayerFirstChildIndex
      const visited = new Set<Row[string]>()
      while (next) {
        check(!visited.has(next), 'レイヤーの参照が循環しています。'); visited.add(next)
        parentById.set(next, parent.MainId); next = clip.row('Layer', next).LayerNextIndex
      }
    }
    const ensureLayer = async (key: string, name: string, parentId: Row[string], kind: 'folder' | 'animation' | 'raster', pixels?: Pixels): Promise<Row> => {
      const uuid = layerUuid(await identity(plan.projectId, key))
      const existing = clip.rows('Layer').find(layer => layer.LayerUuid === uuid)
      if (existing) {
        check(Boolean(existing.LayerFolder) === (kind !== 'raster') && Boolean(existing.AnimationFolder) === (kind === 'animation'), '以前の出力のレイヤー構造が変更されています。')
        check(parentById.get(existing.MainId) === parentId, '以前の出力のフォルダーが移動されています。元のテンプレートを選択してください。')
        if (pixels) {
          const template = prototypes.rows('Layer').find(layer => layer.LayerType === 1)!
          const mip = writeMipmap(clip, existing, pixels, prototypes, template)
          clip.update('Layer', existing.MainId, { LayerRenderMipmap: mip, LayerOffsetX: 0, LayerOffsetY: 0, LayerRenderOffscrOffsetX: 0, LayerRenderOffscrOffsetY: 0 })
        }
        clip.update('Layer', existing.MainId, { LayerName: name })
        return clip.row('Layer', existing.MainId)
      }
      const created = createLayer(clip, prototypes, { name, uuid, parentId, kind, width: settings.width, height: settings.height, pixels })
      newLayerIds.add(created.MainId); parentById.set(created.MainId, parentId)
      return created
    }
    const managed = await ensureLayer('root', 'xsheet-remap', root.MainId, 'folder')
    const folderLayers = new Map<string, Row>()
    for (const folder of plan.folders) {
      progress(`セルを準備しています: ${[...folder.path, folder.name].join(' / ')}`)
      let parent = managed
      for (let i = 0; i < folder.path.length; i++) parent = await ensureLayer(`path:${JSON.stringify(folder.path.slice(0, i + 1).map(normalizeClipName))}`, folder.path[i], parent.MainId, 'folder')
      const animation = await ensureLayer(`folder:${folder.id}`, folder.name, parent.MainId, 'animation')
      folderLayers.set(folder.id, animation)
      for (const cel of folder.cels) {
        const image = cel.assetId ? options.images[cel.assetId] : undefined
        const placement = image && clipImagePlacement(settings, image, 'crop')
        const pixels = image && placement ? placePixels(image, settings.width, settings.height, placement.x, placement.y) : undefined
        await ensureLayer(`cel:${folder.id}:${cel.name}`, cel.name, animation.MainId, 'raster', pixels)
      }
    }
    let bank = clip.rows('AnimationCutBank')[0]
    if (!bank) {
      bank = clip.insert('AnimationCutBank', seed.rows('AnimationCutBank')[0], { FirstTimeLine: 0, CurrentIndex: 0, Enable: 1 })
      clip.db.run('UPDATE Project SET ProjectCutBank=?', [bank.MainId])
    }
    const trackTemplate = seed.rows('Track').find(track => track.TrackKind === 2000)!
    const staticTrackTemplate = seed.rows('Track').find(track => track.TrackKind === 2003)!
    const orderedLayers: Row[] = []
    const visit = (id: Row[string], visited = new Set<Row[string]>()) => {
      let next = id
      while (next) {
        check(!visited.has(next), 'レイヤーの参照が循環しています。'); visited.add(next)
        const layer = clip.row('Layer', next); orderedLayers.push(layer)
        if (layer.LayerFolder && !layer.AnimationFolder) visit(layer.LayerFirstChildIndex, visited)
        next = layer.LayerNextIndex
      }
    }
    visit(clip.row('Layer', root.MainId).LayerFirstChildIndex)
    const originalTimelines = clip.rows('TimeLine')
    const generatedRows = new Set<Row[string]>()
    const definitions: { timeline: ClipTimeline; existing?: Row }[] = plan.timelines.map(timeline => ({ timeline }))
    // New animation folders otherwise show their first cel on older timelines.
    // Extend those timelines with blank tracks without replacing their content.
    for (const row of originalTimelines) definitions.push({ existing: row, timeline: { id: `existing:${row.MainId}`, name: String(row.TimeLineName), fps: Number(row.FrameRate), duration: Number(row.EndFrame), tracks: [] } })
    for (const { timeline, existing: original } of definitions) {
      if (original && generatedRows.has(original.MainId)) continue
      check(Number.isInteger(timeline.duration) && timeline.duration > 0 && timeline.duration <= 1_000_000 && Number.isFinite(timeline.fps) && timeline.fps >= 1 && timeline.fps <= 120, 'FPSまたはデュレーションが範囲外です。')
      progress(`タイムラインを作成しています: ${timeline.name}`)
      const uuid = await identity(plan.projectId, `timeline:${timeline.id}`)
      const oldTimeline = clip.rows('TimeLine').find(row => row.TimeLineUuid instanceof Uint8Array && row.TimeLineUuid.every((byte, i) => uuid[i] === byte))
      const spec = { BankId: bank.MainId, TimeLineUuid: uuid, TimeLineName: timeline.name, CurrentFrame: 0, FrameRate: timeline.fps, StartFrame: 0, EndFrame: timeline.duration, SmallestStartFrame: 0, BiggestEndFrame: timeline.duration, FirstTrack: 0 }
      let row: Row
      if (original) row = clip.row('TimeLine', original.MainId)
      else if (oldTimeline) {
        clip.db.run('DELETE FROM Track WHERE ItemId=? AND BankId=?', [oldTimeline.MainId, bank.MainId])
        clip.update('TimeLine', oldTimeline.MainId, spec); row = clip.row('TimeLine', oldTimeline.MainId)
      } else {
        row = clip.insert('TimeLine', seed.rows('TimeLine')[0], { ...spec, NextTimeLine: 0 })
        const last = clip.rows('TimeLine').find(item => item.MainId !== row.MainId && item.BankId === bank.MainId && item.NextTimeLine === 0)
        if (last) clip.update('TimeLine', last.MainId, { NextTimeLine: row.MainId })
        else clip.update('AnimationCutBank', bank.MainId, { FirstTimeLine: row.MainId })
      }
      if (!original) generatedRows.add(row.MainId)
      let previous: Row | undefined = original ? clip.rows('Track').find(track => track.ItemId === row.MainId && track.BankId === row.BankId && track.TrackNextIndex === 0) : undefined
      // Every shared animation folder gets a track in every generated timeline.
      // Absent tracks explicitly display no cel instead of leaking the previous cut.
      for (const layer of orderedLayers) {
        if (original && !newLayerIds.has(layer.MainId)) continue
        const folderId = [...folderLayers].find(([, item]) => item.MainId === layer.MainId)?.[0]
        const input = timeline.tracks.find(track => track.folderId === folderId)?.frames ?? []
        const frames = input.slice().sort((a, b) => a.frame - b.frame)
        check(frames.every((frame, i) => Number.isInteger(frame.frame) && frame.frame >= 0 && frame.frame < timeline.duration && (!i || frame.frame > frames[i - 1].frame)), 'セル指定のフレームが重複または範囲外です。')
        if (!frames.length || frames[0].frame > 0) frames.unshift({ frame: 0, value: null })
        const sourceTrack = layer.AnimationFolder ? trackTemplate : staticTrackTemplate
        const layerId = String(layer.LayerUuid).replaceAll('-', '')
        check(/^[a-fA-F0-9]{32}$/.test(layerId), 'レイヤーUUIDが不正です。')
        const track: Row = { ...sourceTrack, BankId: bank.MainId, ItemId: row.MainId, TrackNextIndex: 0, TrackOpen: 1,
          TrackKind: layer.AnimationFolder ? 2000 : layer.LayerFolder ? 1000 : 2003,
          TrackUuid: await identity(plan.projectId, `track:${timeline.id}:${layerId}`),
          LayerUuidWithTrack: Uint8Array.from(layerId.match(/../g)!, hex => parseInt(hex, 16)),
          ...(layer.AnimationFolder ? { TrackValueMap: trackValueMap(frames[0].value) } : {}) }
        for (const field of ['TrackActionMixer', 'TrackActionMixer2']) {
          const raw = animationMixer(seed.body(sourceTrack[field])!, layer.AnimationFolder ? frames : [{ frame: 0, value: null }], timeline.duration, timeline.fps)
          track[field] = clip.addExternal(packedMixer(raw)); track[`${field}Size`] = raw.length
        }
        const inserted = clip.insert('Track', track)
        if (previous) clip.update('Track', previous.MainId, { TrackNextIndex: inserted.MainId })
        else clip.update('TimeLine', row.MainId, { FirstTrack: inserted.MainId })
        previous = inserted
      }
    }
    let currentIndex = 0, current = clip.row('AnimationCutBank', bank.MainId).FirstTimeLine
    const visitedTimelines = new Set<Row[string]>()
    while (current && !generatedRows.has(current)) {
      check(!visitedTimelines.has(current), 'タイムラインの参照が循環しています。'); visitedTimelines.add(current)
      current = clip.row('TimeLine', current).NextTimeLine; currentIndex++
    }
    clip.update('AnimationCutBank', bank.MainId, { Enable: 1, CurrentIndex: currentIndex })
    clip.update('Canvas', clip.rows('Canvas')[0].MainId, { CanvasCurrentLayer: managed.MainId })
    refreshCaches(clip, settings.width, settings.height)
    // CSP regenerates folder composites on opening. Avoid retaining a misleading
    // preview of the previous cut; publish an empty preview at the correct size.
    const preview = new Uint8Array(settings.width * settings.height * 4)
    if (clip.rows('Layer').some(layer => layer.LayerType === 1584 && layer.LayerVisibility)) preview.fill(255)
    const previewBytes = png({ ...settings, channels: 4, data: preview })
    clip.db.run('UPDATE CanvasPreview SET ImageWidth=?,ImageHeight=?,ImageData=?', [settings.width, settings.height, previewBytes])
    return { bytes: clip.bytes(), canvas: settings, layers: clip.rows('Layer').length, timelines: clip.rows('TimeLine').length }
  } finally { clip.close(); seed?.close() }
}
export function inspectClip(SQL: SqlJsStatic, bytes: Uint8Array): ClipCanvasSettings {
  const clip = new ClipContainer(SQL, bytes)
  try { return inspectCanvas(clip) } finally { clip.close() }
}
