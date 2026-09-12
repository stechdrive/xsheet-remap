import type { CanvasKit, Image as SkImage } from 'canvaskit-wasm'
import { sceneImageKey, type CanvasKitScene, type SceneNode } from './canvasKitScene'
import { filterPaperImage } from './canvasKitImageFilter'

/** Per-surface resource lifetime: pictures are disposed before their image cache. */
export class CanvasKitImages {
  private images = new Map<string, SkImage>()
  private sources = new Map<string, { data: ArrayBuffer; pixels?: ImageData }>()
  private disposed = false
  constructor(private kit: CanvasKit) {}
  get(image: NonNullable<SceneNode['image']>): SkImage | undefined { return this.images.get(sceneImageKey(image)) }
  async ensure(scene: CanvasKitScene): Promise<void> {
    if (this.disposed) return
    const wanted = new Map<string, NonNullable<SceneNode['image']>>()
    const visit = (node: SceneNode) => {
      if (node.image?.url) wanted.set(sceneImageKey(node.image), node.image)
      node.children.forEach(visit)
    }
    scene.nodes.forEach(visit)
    const urls = new Set([...wanted.values()].map(image => image.url))
    for (const url of this.sources.keys()) if (!urls.has(url)) this.sources.delete(url)
    for (const [key, image] of wanted) {
      if (this.images.has(key)) continue
      let source = this.sources.get(image.url)
      if (!source) {
        const response = await fetch(image.url)
        if (!response.ok) throw new Error(`Paper image HTTP ${response.status}`)
        source = { data: await response.arrayBuffer() }
        if (this.disposed) return
        this.sources.set(image.url, source)
      }
      let decoded: SkImage | null
      if (!image.filters.length) decoded = this.kit.MakeImageFromEncoded(source.data)
      else {
        if (!source.pixels) {
          const bitmap = await createImageBitmap(new Blob([source.data]))
          const canvas = document.createElement('canvas')
          canvas.width = bitmap.width; canvas.height = bitmap.height
          const context = canvas.getContext('2d', { willReadFrequently: true })
          if (!context) { bitmap.close(); throw new Error('Image correction context is unavailable') }
          context.drawImage(bitmap, 0, 0)
          bitmap.close()
          source.pixels = context.getImageData(0, 0, canvas.width, canvas.height)
          canvas.width = canvas.height = 1
        }
        const pixels = source.pixels
        const filtered = await filterPaperImage(pixels.data, image.filters)
        if (this.disposed) return
        decoded = this.kit.MakeImage({
          width: pixels.width, height: pixels.height, colorType: this.kit.ColorType.RGBA_8888,
          alphaType: this.kit.AlphaType.Unpremul, colorSpace: this.kit.ColorSpace.SRGB,
        }, filtered, pixels.width * 4)
      }
      if (!decoded) throw new Error('CanvasKit could not decode a paper image')
      this.images.set(key, decoded)
      // Keep correction-slider reuse bounded even for very large scanned pages.
      while (this.sourceBytes > 64 * 1024 * 1024) this.sources.delete(this.sources.keys().next().value!)
    }
    for (const [key, image] of this.images) {
      if (!wanted.has(key)) { image.delete(); this.images.delete(key) }
    }
  }
  get sourceBytes() { return [...this.sources.values()].reduce((bytes, source) => bytes + source.data.byteLength + (source.pixels?.data.byteLength ?? 0), 0) }
  get imageBytes() { return [...this.images.values()].reduce((bytes, image) => bytes + image.width() * image.height() * 4, 0) }
  dispose() { this.disposed = true; for (const image of this.images.values()) image.delete(); this.images.clear(); this.sources.clear() }
}
