import { assetAbsolutePath, type CutGroupProjectDocument, type ClipRegistrationPlan } from '@xsheet-remap/core'
import { isTauriHost, nativeFileSource, retainBrowserFiles, type ClipImagePixels } from '@xsheet-remap/adapters'
import { loadImage } from './sheetImages'
export async function loadClipImages(document: CutGroupProjectDocument, plan: ClipRegistrationPlan, signal: AbortSignal): Promise<Record<string, ClipImagePixels>> {
  const release = retainBrowserFiles([document, plan])
  try { return await loadRetainedClipImages(document, plan, signal) } finally { release() }
}

async function loadRetainedClipImages(document: CutGroupProjectDocument, plan: ClipRegistrationPlan, signal: AbortSignal): Promise<Record<string, ClipImagePixels>> {
  const result: Record<string, ClipImagePixels> = {}
  const requests = plan.document ? plan.document.nodes.filter(node => node.sourceLayerId === undefined && node.kind === 'raster' && (node.assetId || node.imageDataUrl)).map(node => ({ id: node.id, assetId: node.assetId, imageDataUrl: node.imageDataUrl }))
    : [...new Set(plan.folders.flatMap(folder => folder.cels.flatMap(cel => cel.assetId ? [cel.assetId] : [])))].map(id => ({ id, assetId: id, imageDataUrl: undefined }))
  let totalBytes = 0
  for (const { id, assetId, imageDataUrl } of requests) {
    signal.throwIfAborted()
    const asset = document.assets.find(asset => asset.assetId === assetId)
    if (!asset && !imageDataUrl) throw new Error(`割り当て済みの画像が見つかりません: ${id}`)
    const path = asset && assetAbsolutePath(asset, document.assetRoot)
    const url = imageDataUrl ?? (isTauriHost() && path ? await nativeFileSource(path) : asset?.thumbnailUrl)
    if (!url) throw new Error(`画像を読み込めません。素材を再接続してください: ${asset?.displayName ?? id}`)
    let image: HTMLImageElement
    try { image = await loadImage(url) } catch { throw new Error(`画像を読み込めません: ${asset?.displayName ?? id}。PNG・JPEGなどブラウザーで表示できる画像を使用し、素材の接続を確認してください。`) }
    signal.throwIfAborted()
    const width = image.naturalWidth, height = image.naturalHeight
    totalBytes += width * height * 4
    if (!width || !height || width * height > 100_000_000 || totalBytes > 512 * 1024 * 1024) throw new Error('登録画像の展開サイズが大きすぎます。登録する素材を分けてください。')
    const canvas = window.document.createElement('canvas'); canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('画像を読み込めませんでした。')
    context.drawImage(image, 0, 0)
    result[id] = { width, height, channels: 4, data: new Uint8Array(context.getImageData(0, 0, width, height).data) }
    canvas.width = 0; canvas.height = 0
  }
  return result
}
