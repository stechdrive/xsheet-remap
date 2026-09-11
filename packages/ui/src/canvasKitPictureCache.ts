import type { Canvas, SkPicture } from 'canvaskit-wasm'
import type { SceneNode } from './canvasKitScene'

/** Bounded CPU display lists; GPU targets can still be replaced for WebKit resizing. */
export class CanvasKitPictureCache {
  private entries = new Map<SceneNode, { picture: SkPicture; bytes: number }>()
  private used = new Set<SceneNode>()
  private bytes = 0
  private identity = ''
  reusedPictures = 0
  recordedPictures = 0
  constructor(private maxBytes = 8 * 1024 * 1024, private maxEntries = 256) {}
  begin(width: number, height: number, fontRevision: number) {
    const identity = `${width}:${height}:${fontRevision}`
    if (identity !== this.identity) { this.clear(); this.identity = identity }
    this.used.clear(); this.reusedPictures = 0; this.recordedPictures = 0
  }
  draw(node: SceneNode, canvas: Canvas, record: () => SkPicture) {
    this.used.add(node)
    const cached = this.entries.get(node)
    if (cached) { this.reusedPictures++; canvas.drawPicture(cached.picture); return }
    const picture = record()
    this.recordedPictures++
    const bytes = picture.approximateBytesUsed()
    try {
      canvas.drawPicture(picture)
      if (bytes > this.maxBytes) return
      while (this.entries.size && (this.bytes + bytes > this.maxBytes || this.entries.size >= this.maxEntries)) {
        this.remove(this.entries.keys().next().value!)
      }
      this.entries.set(node, { picture, bytes }); this.bytes += bytes
    } finally { if (!this.entries.has(node)) picture.delete() }
  }
  finish() { for (const node of this.entries.keys()) if (!this.used.has(node)) this.remove(node) }
  private remove(node: SceneNode) {
    const entry = this.entries.get(node)!
    entry.picture.delete(); this.bytes -= entry.bytes; this.entries.delete(node)
  }
  clear() {
    for (const entry of this.entries.values()) entry.picture.delete()
    this.entries.clear(); this.used.clear(); this.bytes = 0
  }
}
