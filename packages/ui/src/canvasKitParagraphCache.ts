import type { Paragraph } from 'canvaskit-wasm'

/** Owns shaped text, bounded by both entry count and UTF-16 input bytes. */
export class CanvasKitParagraphCache {
  private entries = new Map<string, { paragraph: Paragraph; bytes: number }>()
  private bytes = 0
  private revision = -1
  built = 0
  reused = 0
  constructor(private maxEntries = 1024, private maxBytes = 1024 * 1024) {}
  begin(revision: number) {
    if (this.revision !== revision) { this.clear(); this.revision = revision }
    this.built = 0; this.reused = 0
  }
  use(key: string, build: () => Paragraph, draw: (paragraph: Paragraph) => void) {
    const existing = this.entries.get(key)
    if (existing) {
      this.entries.delete(key); this.entries.set(key, existing)
      this.reused++; draw(existing.paragraph); return
    }
    const paragraph = build(), bytes = key.length * 2
    this.built++
    try {
      draw(paragraph)
      if (bytes > this.maxBytes || this.maxEntries < 1) return
      while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
        const oldest = this.entries.entries().next().value!
        oldest[1].paragraph.delete(); this.bytes -= oldest[1].bytes; this.entries.delete(oldest[0])
      }
      this.entries.set(key, { paragraph, bytes }); this.bytes += bytes
    } finally { if (!this.entries.has(key)) paragraph.delete() }
  }
  get size() { return this.entries.size }
  get inputBytes() { return this.bytes }
  clear() { for (const entry of this.entries.values()) entry.paragraph.delete(); this.entries.clear(); this.bytes = 0 }
}
