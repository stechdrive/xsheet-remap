import type { SqlJsStatic } from 'sql.js'
import type { ClipImportData, ClipImportNode, ClipImportTimeline, ClipLayerNode } from '@xsheet-remap/core'
import { ClipContainer, type Row } from './container'
import { check } from './binary'
import { readAnimation } from './read-animation'
import { inspectCanvas } from './canvas'
import { clipLabelColor, clipLayerKind, normalizedUuid, optionalRows } from './layer-metadata'

function uuid(value: Row[string]): string {
  const result = value instanceof Uint8Array ? Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('') : String(value).replaceAll('-', '').toLowerCase()
  check(/^[a-f0-9]{32}$/.test(result), 'レイヤーまたはタイムラインIDが不正です。')
  return result
}
function chain(rows: Row[], first: Row[string], nextField: string): Row[] {
  const byId = new Map(rows.map(row => [row.MainId, row])), result: Row[] = [], seen = new Set()
  let next = first
  while (next) {
    const row = byId.get(next)
    check(row && !seen.has(next), 'ツリーまたはタイムラインの参照が破損しています。')
    seen.add(next); result.push(row); next = row[nextField]
  }
  return result
}

export async function readClip(SQL: SqlJsStatic, bytes: Uint8Array, fileName: string): Promise<ClipImportData> {
  const clip = new ClipContainer(SQL, bytes)
  try {
    const layers = clip.rows('Layer'), canvas = clip.rows('Canvas')[0]
    const items = new Map(optionalRows(clip, 'CanvasItem').map(item => [normalizedUuid(item.ItemUuid), item]))
    const root = layers.find(layer => layer.MainId === canvas.CanvasRootFolder)
    check(root, 'ルートフォルダーがありません。')
    const seen = new Set<Row[string]>([root.MainId]), layerIds = new Set<string>(), fullLayers: ClipLayerNode[] = []
    function tree(first: Row[string], path: string[], parentVisible: boolean, parentId: string | null = null): ClipImportNode[] {
      check(path.length < 100, 'フォルダー階層が深すぎます。')
      // CSP links siblings from the bottom (paper) upwards; display palette order.
      return chain(layers, first, 'LayerNextIndex').reverse().flatMap(layer => {
        check(!seen.has(layer.MainId), 'レイヤーの親子関係が循環しています。'); seen.add(layer.MainId)
        const id = uuid(layer.LayerUuid), name = String(layer.LayerName), animation = Boolean(layer.AnimationFolder)
        check(!layerIds.has(id), 'レイヤーIDが重複しています。'); layerIds.add(id)
        const visible = parentVisible && Boolean(Number(layer.LayerVisibility ?? 1) & 1)
        const fullPath = [...path, name]
        fullLayers.push({ id, parentId, name, kind: clipLayerKind(layer, items), labelColor: clipLabelColor(layer),
          sourceLayerId: Number(layer.MainId), visible: Boolean(Number(layer.LayerVisibility ?? 1) & 1), opacity: Number(layer.LayerOpacity ?? 256) / 256,
          blendMode: Number(layer.LayerComposite ?? 0), locked: layer.LayerType === 1584 || Boolean(layer.LayerLock) })
        const children = layer.LayerFolder ? tree(layer.LayerFirstChildIndex, fullPath, visible, id) : []
        return [{ id, name, path: fullPath, animation, visible, children }]
      })
    }
    const nodes = tree(root.LayerFirstChildIndex, [], true)
    const bank = clip.rows('AnimationCutBank').find(row => row.MainId === clip.rows('Project')[0]?.ProjectCutBank) ?? clip.rows('AnimationCutBank')[0]
    const timelineRows = bank ? chain(clip.rows('TimeLine').filter(row => row.BankId === bank.MainId), bank.FirstTimeLine, 'NextTimeLine') : []
    const tracks = clip.rows('Track')
    const timelines: ClipImportTimeline[] = timelineRows.map(row => {
      const fps = Number(row.FrameRate), startFrame = Number(row.StartFrame), endFrame = Number(row.EndFrame)
      check(Number.isFinite(fps) && fps >= 1 && fps <= 120 && Number.isInteger(startFrame) && Number.isInteger(endFrame) && endFrame > startFrame && endFrame - startFrame <= 1_000_000, 'FPSまたは再生範囲が範囲外です。')
      const layerTracks = chain(tracks.filter(track => track.BankId === bank.MainId && track.ItemId === row.MainId), row.FirstTrack, 'TrackNextIndex').filter(track => track.TrackKind === 2000)
      const used = new Set<string>()
      return { id: uuid(row.TimeLineUuid), name: String(row.TimeLineName), fps, startFrame, endFrame, tracks: layerTracks.map(track => {
        const layerId = uuid(track.LayerUuidWithTrack)
        check(!used.has(layerId), '同じタイムラインにレイヤーのトラックが重複しています。'); used.add(layerId)
        try {
          const field = clip.body(track.TrackActionMixer) ? 'TrackActionMixer' : 'TrackActionMixer2'
          const body = clip.body(track[field])
          check(body, 'セル指定のデータがありません。')
          return { layerId, frames: readAnimation(body, Number(track[`${field}Size`]), fps, startFrame, endFrame) }
        } catch (error) { return { layerId, frames: [], error: error instanceof Error ? error.message : String(error) } }
      }) }
    })
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))
    return { fileName, fileHash: Array.from(digest, value => value.toString(16).padStart(2, '0')).join(''), nodes, layers: fullLayers, canvas: inspectCanvas(clip), timelines, currentTimelineId: timelines[Number(bank?.CurrentIndex)]?.id ?? timelines[0]?.id ?? '' }
  } finally { clip.close() }
}
