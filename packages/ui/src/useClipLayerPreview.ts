import { useEffect, useMemo, useState } from 'react'
import { clipEffectiveCel, clipNodePath, timingForProcess, type ClipLayerNode, type CutProject, type SheetHit } from '@xsheet-remap/core'
import { createClipPreviewSession } from '@xsheet-remap/adapters'
import type { AssetPreviewPayload } from './assetPreviewModel'

interface LayerImage {
  id: string; label: string; path: string; imageUrl?: string; sourceLayerId?: number
}
interface PreviewPlan {
  node: LayerImage; folder: boolean; layers: LayerImage[]; source?: string; error?: string
}
interface LoadedImage { id: string; imageUrl?: string; suffix?: string; error?: string; notices?: string[] }
interface PreviewResult { images: LoadedImage[]; gallery?: boolean; error?: string }

function previewPlan(project: CutProject, selected: ClipLayerNode, cutId: string, hit: SheetHit | null): PreviewPlan {
  const document = project.clipDocument!
  let node = selected, error: string | undefined
  if (node.kind === 'animation') {
    const mapped = document.targets.find(item => item.folderId === node.id)
    const slot = project.cspTrackSlots.find(item => item.slotId === mapped?.slotId)
    const frame = hit?.frame ?? project.logicalSheet.frameOrigin
    const event = timingForProcess(project.logicalSheet, slot?.correctionLayerId ?? '').events.filter(item => item.paperTrack === slot?.paperTrack && item.frame <= frame && item.sheetRole === (hit?.role === 'cell' ? 'cell' : 'action') && ['cell', 'blank'].includes(item.valueKind)).sort((a, b) => b.frame - a.frame)[0]
    const binding = event && project.bindings.find(item => item.keyId === event.keyId && item.slotId === slot?.slotId)
    const sourceId = document.timelineIds?.[cutId]
    const nativeFrames = document.sourceTimelines?.find(item => item.id === sourceId)?.tracks.find(item => item.layerId === node.id)?.frames
    const nativeValue = nativeFrames?.filter(item => item.frame <= frame - project.logicalSheet.frameOrigin).at(-1)?.value
    const cel = clipEffectiveCel(document, node.id, mapped ? binding?.cspCellName ?? '' : nativeValue ?? '')
    if (cel) node = cel
    else error = 'このフレームにセル指定はありません。'
  }
  const describe = (layer: ClipLayerNode): LayerImage => ({ id: layer.id, label: layer.name, path: clipNodePath(document, layer.id),
    sourceLayerId: layer.sourceLayerId, imageUrl: layer.imageDataUrl ?? project.assets.find(asset => asset.assetId === layer.assetId)?.thumbnailUrl })
  const layers: LayerImage[] = []
  if (node.kind === 'folder') {
    const children = new Map<string | null, string[]>()
    for (const child of document.nodes) { const siblings = children.get(child.parentId) ?? []; siblings.push(child.id); children.set(child.parentId, siblings) }
    const descendants = new Set<string>(), queue = [node.id]
    for (let i = 0; i < queue.length; i += 1) for (const id of children.get(queue[i]) ?? []) if (!descendants.has(id)) { descendants.add(id); queue.push(id) }
    for (const child of document.nodes) if (descendants.has(child.id) && !['folder', 'animation', 'audio'].includes(child.kind) && layers.length < 24) layers.push(describe(child))
  }
  return { node: describe(node), folder: node.kind === 'folder', layers, source: document.source?.dataUrl, error }
}

function sameImages(a: PreviewPlan | null, b: PreviewPlan | null): boolean {
  if (!a || !b) return a === b
  const same = (a: LayerImage, b: LayerImage) => a.id === b.id && a.sourceLayerId === b.sourceLayerId && a.imageUrl === b.imageUrl
  return a.source === b.source && a.error === b.error && a.folder === b.folder && same(a.node, b.node)
    && a.layers.length === b.layers.length && a.layers.every((layer, index) => same(layer, b.layers[index]))
}

/** Image identity is independent of labels, selection coordinates and other edits. */
export function useClipLayerPreview(project: CutProject, selected: ClipLayerNode | undefined, cutId: string, hit: SheetHit | null, open: boolean): { payload: AssetPreviewPayload; notices?: string[] } | null {
  const plan = useMemo(() => open && selected && selected.kind !== 'audio' ? previewPlan(project, selected, cutId, hit) : null, [project, selected, cutId, hit, open])
  const [state, setState] = useState<{ request: { plan: PreviewPlan }; result?: PreviewResult } | null>(() => plan ? { request: { plan } } : null)
  // Adjust during render so a different cel never displays the preceding cel's image.
  // Closing also drops references to the source and embedded image strings.
  if (!sameImages(state?.request.plan ?? null, plan)) setState(plan ? { request: { plan } } : null)
  const request = state?.request
  useEffect(() => {
    if (!request) return
    const plan = request.plan, controller = new AbortController(), urls: string[] = []
    const reader = plan.source ? createClipPreviewSession(plan.source, controller.signal) : undefined
    const read = async (layer: LayerImage): Promise<LoadedImage> => {
      if (layer.imageUrl || layer.sourceLayerId === undefined || !reader) return { id: layer.id, imageUrl: layer.imageUrl }
      const result = await reader.read(layer.sourceLayerId)
      controller.signal.throwIfAborted()
      const imageUrl = URL.createObjectURL(new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
      urls.push(imageUrl)
      const suffix = ` / ${result.width} × ${result.height}px${result.storedComposite ? ' / CLIP保存時の合成画像（編集は未反映）' : ''}`
        + (result.reconstructed ? ' / CLIPの素材情報から描画' : !result.storedComposite ? ' / CLIP内のレイヤー画像' : '')
      return { id: layer.id, imageUrl, suffix, notices: result.warnings }
    }
    const load = async (): Promise<PreviewResult> => {
      if (plan.error) throw new Error(plan.error)
      if (plan.folder) {
        try { const saved = await read(plan.node); if (saved.imageUrl) return { images: [saved] } }
        catch { controller.signal.throwIfAborted() }
        const images: LoadedImage[] = []
        for (const layer of plan.layers) {
          try { images.push(await read(layer)) }
          catch (error) { controller.signal.throwIfAborted(); images.push({ id: layer.id, error: error instanceof Error ? error.message : String(error) }) }
        }
        return { images, gallery: true }
      }
      const image = await read(plan.node)
      if (!image.imageUrl) throw new Error('画像のないレイヤーです。')
      return { images: [image] }
    }
    void load().catch(error => ({ images: [], error: error instanceof Error ? error.message : String(error) })).then(result => {
      if (!controller.signal.aborted) setState(current => current?.request === request ? { request, result } : current)
    }).finally(() => reader?.dispose())
    return () => { controller.abort(); reader?.dispose(); urls.forEach(url => URL.revokeObjectURL(url)) }
  }, [request])
  if (!plan || !sameImages(state?.request.plan ?? null, plan) || !state?.result) return null
  const { result } = state
  const notices = result.error ? [result.error] : result.images.flatMap(image => image.error ? [`「${plan.layers.find(layer => layer.id === image.id)?.label ?? plan.node.label}」: ${image.error}`] : image.notices ?? [])
  const items = result.images.map(image => {
    const layer = plan.layers.find(layer => layer.id === image.id) ?? plan.node
    return { label: layer.label, imageUrl: image.imageUrl, detailText: image.error ?? layer.path + (image.suffix ?? '') }
  })
  return { payload: result.gallery ? { displayName: plan.node.label, detailText: 'フォルダー内の画像（最大24枚・個別表示）', items }
    : { displayName: plan.node.label, ...(items[0] ?? { detailText: plan.node.path }) }, notices }
}
