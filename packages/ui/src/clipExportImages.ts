import { assetAbsolutePath, type CutGroupProjectDocument, type ClipRegistrationPlan } from '@xsheet-remap/core'
import { isTauriHost, nativeFileSource, type ClipImagePixels } from '@xsheet-remap/adapters'
import { loadImage } from './sheetImages'
export async function loadClipImages(document: CutGroupProjectDocument, plan: ClipRegistrationPlan, signal: AbortSignal): Promise<Record<string, ClipImagePixels>> {
  const result: Record<string, ClipImagePixels> = {}, ids = new Set(plan.folders.flatMap(folder => folder.cels.flatMap(cel => cel.assetId ? [cel.assetId] : [])))
  let totalBytes = 0
  for (const id of ids) {
    signal.throwIfAborted()
    const asset = document.assets.find(asset => asset.assetId === id)
    if (!asset) throw new Error(`割り当て済みの画像が見つかりません: ${id}`)
    const path = assetAbsolutePath(asset, document.assetRoot)
    const url = isTauriHost() && path ? await nativeFileSource(path) : asset.thumbnailUrl
    if (!url) throw new Error(`画像を読み込めません。素材を再接続してください: ${asset.displayName}`)
    let image: HTMLImageElement
    try { image = await loadImage(url) } catch { throw new Error(`画像を読み込めません: ${asset.displayName}。PNG・JPEGなどブラウザーで表示できる画像を使用し、素材の接続を確認してください。`) }
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
