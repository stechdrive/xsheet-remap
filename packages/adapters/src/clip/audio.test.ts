import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { unzlibSync } from 'fflate'
import { activeCutProjectFromDocument, buildClipRegistrationPlan, openClipDocument, updateActiveCutProjectInDocument, updateClipLayer } from '@xsheet-remap/core'
import { readAudioTiming, readClipAudio } from './audio'
import { blob, ClipContainer, type Row } from './container'
import { Mixer, packedMixer } from './animation'
import { readClip } from './reader'
import { createMediaFixture } from './fixtures/media-fixture'
import { normalizedUuid } from './layer-metadata'
import { clipSourceDataUrl } from './document-data'
import { writeClip } from './writer'
import { readClipLayerPreview } from './preview'
import { mipmapChain } from './layers'
import { encodeRaster } from './raster'

const require = createRequire(import.meta.url), seed = new Uint8Array(readFileSync(new URL('./blank.clip', import.meta.url)))
const native = JSON.parse(readFileSync(new URL('./fixtures/native-media.json', import.meta.url), 'utf8')) as { audioLayer: Row; videoLayer: Row; items: Row[]; objects: Row[]; mixer: { size: number; hex: string } }
let SQL: SqlJsStatic
beforeAll(async () => { SQL = await initSqlJs({ wasmBinary: new Uint8Array(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer }) })
const audioMixer = () => new Mixer(unzlibSync(Buffer.from(native.mixer.hex, 'hex').subarray(4)))
const read = (mixer: Mixer, start = 0) => { const raw = mixer.encode(); return readAudioTiming(packedMixer(raw), raw.length, 24, start) }


describe('CLIP native media metadata and audio timing', () => {
  it('does not invent a blank movie preview when the source has no saved pixels', () => {
    const { clip, videoId } = createMediaFixture(SQL)
    try {
      const surface = mipmapChain(clip, clip.row('Layer', videoId).LayerRenderMipmap)[0].off
      clip.update('Offscreen', surface.MainId, { BlockData: new TextEncoder().encode('missing-movie-preview') })
      expect(() => readClipLayerPreview(SQL, clip.bytes(), videoId)).toThrow('この動画レイヤーには保存済み画像がありません')
      const encoded = encodeRaster({ width: 2, height: 1, channels: 4, data: new Uint8Array([0, 0, 255, 255, 0, 0, 255, 255]) }, blob(surface.Attribute))
      clip.update('Offscreen', surface.MainId, { Attribute: encoded.attribute, BlockData: clip.addExternal(encoded.body) })
      expect(readClipLayerPreview(SQL, clip.bytes(), videoId)).toMatchObject({ width: 2, height: 1, storedComposite: true })
    } finally { clip.close() }
  })
  it('reads native full-length placement and evaluates a trimmed, moved clip relative to a nonzero playback start', () => {
    const expected = { objectId: normalizedUuid(native.objects[0].ObjectUuid), startFrame: 0, sourceOffsetFrames: 0, durationFrames: 72 }
    expect(readAudioTiming(Buffer.from(native.mixer.hex, 'hex'), native.mixer.size, 24, 0)).toEqual([expected])
    const mixer = audioMixer()
    mixer.walk((node, parent) => {
      if (parent?.name === 'TimeClip' && node.name === 'Start') node.values = [45]
      if (parent?.name === 'TimeClip' && node.name === 'End') node.values = [135]
      if (parent?.name === 'MotionClip' && node.name === 'Start') node.values = [30]
      if (parent?.name === 'MotionClip' && node.name === 'End') node.values = [120]
    })
    expect(read(mixer, 6)).toEqual([{ ...expected, startFrame: 12, sourceOffsetFrames: 12, durationFrames: 36 }])
  })
  it('rejects automation, changing source, malformed curves, speed changes and oversized compressed data', () => {
    const changed = (mutate: (node: Mixer['root'], parent?: Mixer['root']) => void) => { const mixer = audioMixer(); mixer.walk(mutate); return () => read(mixer) }
    expect(changed(node => { if (node.name === 'Param' && node.attrs.Name === 'AudioVolume') node.values = [50] })).toThrow('音量')
    expect(changed((node, parent) => { if (parent?.attrs.Type === 'PlayTime' && node.name === 'Value') node.values = [0, 6] })).toThrow('速度')
    expect(changed((node, parent) => { if (parent?.attrs.Type === 'AudioPlayer' && node.name === 'Tag') node.values.push('other') })).toThrow('切り替わる')
    expect(changed((node, parent) => { if (parent?.attrs.Type === 'PlayTime' && node.name === 'Frame') node.values = [0, 0] })).toThrow()
    expect(() => readAudioTiming(Buffer.from(native.mixer.hex, 'hex'), 16_000_000, 24, 0)).toThrow('展開サイズ')
  })
  it('identifies audio and movies without confusing static file objects, and decodes unsigned label channels', async () => {
    const { clip, audioId, videoId } = createMediaFixture(SQL)
    try {
      const data = await readClip(SQL, clip.bytes(), 'media.clip')
      expect(data.layers!.find(node => node.sourceLayerId === audioId)?.kind).toBe('audio')
      expect(data.layers!.find(node => node.sourceLayerId === videoId)).toMatchObject({ kind: 'video', labelColor: '#ffaa82' })
      clip.db.run("UPDATE CanvasItem SET ItemType='Image' WHERE ItemType='Movie'")
      clip.update('Layer', videoId, { LayerUsePaletteColor: 0 })
      const changed = (await readClip(SQL, clip.bytes(), 'static.clip')).layers!.find(node => node.sourceLayerId === videoId)!
      expect(changed.kind).toBe('other'); expect(changed.labelColor).toBeUndefined()
    } finally { clip.close() }
  })
  it('extracts only media referenced by the selected layer and fails on missing embedded media', () => {
    const { clip, audioId, timelineId } = createMediaFixture(SQL)
    try {
      const result = readClipAudio(SQL, clip.bytes(), audioId, timelineId)
      expect(result.clips[0]).toMatchObject({ startFrame: 0, sourceOffsetFrames: 0, durationFrames: 72 })
      expect(result.assets).toHaveLength(1); expect(result.assets[0].mimeType).toBe('audio/wav')
      clip.db.run('UPDATE LayerObject SET LayerId=999')
      expect(() => readClipAudio(SQL, clip.bytes(), audioId, timelineId)).toThrow('素材参照')
      clip.db.run('UPDATE LayerObject SET LayerId=?', [audioId]); clip.db.run('DELETE FROM CanvasItemBinary')
      expect(() => readClipAudio(SQL, clip.bytes(), audioId, timelineId)).toThrow('外部参照')
    } finally { clip.close() }
  })
  it('retains media, label metadata and audio playback when saving an unrelated layer change', async () => {
    const { clip, audioId } = createMediaFixture(SQL)
    const source = clip.bytes(), data = await readClip(SQL, source, 'media.clip')
    let document = openClipDocument(data, clipSourceDataUrl(source), { role: 'action', columns: [], timelineIds: [] })
    const project = activeCutProjectFromDocument(document), video = data.layers!.find(item => item.kind === 'video')!
    document = updateActiveCutProjectInDocument(document, updateClipLayer(project, video.id, { name: 'renamed movie', visible: false }))
    const written = await writeClip(SQL, seed, { plan: buildClipRegistrationPlan(document, 'action'), canvas: data.canvas!, fit: 'crop', images: {} })
    const saved = new ClipContainer(SQL, written.bytes)
    try {
      for (const table of ['CanvasItem', 'CanvasItemBinary', 'LayerObject']) expect(saved.rows(table)).toEqual(clip.rows(table))
      expect(saved.rows('Track').find(item => item.TrackKind === 4001)).toEqual(clip.rows('Track').find(item => item.TrackKind === 4001))
      expect(saved.row('Layer', video.sourceLayerId!).LayerPaletteGreen).toBe(native.videoLayer.LayerPaletteGreen)
      expect(saved.row('Layer', audioId).AudioLayer).toBe(1)
      for (const [id, bytes] of clip.external) expect(saved.external.get(id)).toEqual(bytes)
    } finally { clip.close(); saved.close() }
  })
})
