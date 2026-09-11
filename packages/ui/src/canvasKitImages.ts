import type { CanvasKit, Image as SkImage } from 'canvaskit-wasm'
import { applySceneFilters, sceneImageKey, type CanvasKitScene, type SceneNode } from './canvasKitScene'

/** Per-surface resource lifetime: pictures are disposed before their image cache. */
export class CanvasKitImages {
  private images = new Map<string, SkImage>()
  constructor(private kit: CanvasKit) {}
  get(image: NonNullable<SceneNode['image']>): SkImage | undefined { return this.images.get(sceneImageKey(image)) }
  async ensure(scene: CanvasKitScene): Promise<void> {
    const wanted = new Map<string, NonNullable<SceneNode['image']>>()
    const visit = (node: SceneNode) => {
      if (node.image?.url) wanted.set(sceneImageKey(node.image), node.image)
      node.children.forEach(visit)
    }
    scene.nodes.forEach(visit)
    for (const [key, image] of wanted) {
      if (this.images.has(key)) continue
      const response = await fetch(image.url)
      if (!response.ok) throw new Error(`Paper image HTTP ${response.status}`)
      const data = await response.arrayBuffer()
      let decoded: SkImage | null
      if (!image.filters.length) decoded = this.kit.MakeImageFromEncoded(data)
      else {
        const bitmap = await createImageBitmap(new Blob([data]))
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width; canvas.height = bitmap.height
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) { bitmap.close(); throw new Error('Image correction context is unavailable') }
        context.drawImage(bitmap, 0, 0)
        bitmap.close()
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
        applySceneFilters(pixels.data, image.filters)
        decoded = this.kit.MakeImage({
          width: pixels.width, height: pixels.height, colorType: this.kit.ColorType.RGBA_8888,
          alphaType: this.kit.AlphaType.Unpremul, colorSpace: this.kit.ColorSpace.SRGB,
        }, pixels.data, pixels.width * 4)
        canvas.width = canvas.height = 1
      }
      if (!decoded) throw new Error('CanvasKit could not decode a paper image')
      this.images.set(key, decoded)
    }
    for (const [key, image] of this.images) {
      if (!wanted.has(key)) { image.delete(); this.images.delete(key) }
    }
  }
  dispose() { for (const image of this.images.values()) image.delete(); this.images.clear() }
}
