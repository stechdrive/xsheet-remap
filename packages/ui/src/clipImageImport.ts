import { browserAssetDataUrl } from '@xsheet-remap/adapters'
import type { FileRef } from '@xsheet-remap/core'
import { loadImage } from './sheetImages'

/** Embed new pixels so tree materials survive moving the source files and saving XSR. */
export async function clipImageDataUrl(ref: FileRef): Promise<string> {
  if (!ref.objectUrl) throw new Error(`画像を読み込めません: ${ref.name}`)
  const embedded = await browserAssetDataUrl(ref.objectUrl)
  if (embedded) return embedded
  // Native asset URLs have a different origin in WebView2. The shared loader
  // requests CORS access before setting src so embedding pixels stays readable.
  const image = await loadImage(ref.objectUrl)
  if (image.naturalWidth * image.naturalHeight > 100_000_000) throw new Error('画像が大きすぎます。')
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('画像を展開できません。')
  context.drawImage(image, 0, 0)
  return canvas.toDataURL('image/png')
}
