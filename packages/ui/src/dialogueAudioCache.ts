import type { PcmAudio } from './dialogueAudioEngine'

type Asset = { assetId: string; audioDataUrl: string }
interface Entry { dataUrl: string; pending?: Promise<PcmAudio>; audio?: PcmAudio }

/** Derived PCM only: eviction never changes saved audio or editing history. */
export class DialogueAudioCache {
  private entries = new Map<string, Entry>()
  constructor(private readonly maxBytes = 64 * 1024 * 1024) {}

  getOrDecode(asset: Asset, decode: () => Promise<PcmAudio>): Promise<PcmAudio> {
    const cached = this.entries.get(asset.assetId)
    if (cached?.dataUrl === asset.audioDataUrl) {
      this.entries.delete(asset.assetId); this.entries.set(asset.assetId, cached)
      if (cached.audio) return Promise.resolve(cached.audio)
      if (cached.pending) return cached.pending
    }
    const entry: Entry = { dataUrl: asset.audioDataUrl }
    this.entries.set(asset.assetId, entry)
    entry.pending = Promise.resolve().then(decode).then(audio => {
      if (this.entries.get(asset.assetId) === entry) {
        entry.pending = undefined; entry.audio = audio
        this.trim()
      }
      return audio
    }, error => {
      if (this.entries.get(asset.assetId) === entry) this.entries.delete(asset.assetId)
      throw error
    })
    return entry.pending
  }

  set(assetId: string, value: { dataUrl: string; audio: PcmAudio }) {
    this.entries.delete(assetId); this.entries.set(assetId, value)
    this.trim()
  }

  retain(assets: readonly Asset[]) {
    const urls = new Map(assets.map(asset => [asset.assetId, asset.audioDataUrl]))
    for (const [id, entry] of this.entries) if (urls.get(id) !== entry.dataUrl) this.entries.delete(id)
  }

  clear() { this.entries.clear() }

  private trim() {
    let bytes = 0
    const size = (audio?: PcmAudio) => audio ? [...new Set([audio.samples, ...(audio.channels ?? [])])].reduce((total, samples) => total + samples.byteLength, 0) : 0
    for (const entry of this.entries.values()) bytes += size(entry.audio)
    for (const [id, entry] of this.entries) {
      if (bytes <= this.maxBytes) break
      if (!entry.audio) continue
      bytes -= size(entry.audio)
      this.entries.delete(id)
    }
  }
}
