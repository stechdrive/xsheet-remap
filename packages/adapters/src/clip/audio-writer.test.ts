import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { buildClipRegistrationPlan, openClipDocument, type ClipAudioTimeline } from '@xsheet-remap/core'
import { ClipContainer } from './container'
import { createMediaFixture } from './fixtures/media-fixture'
import { readAudioTiming, readClipAudio } from './audio'
import { writeAudioTimeline } from './audio-writer'
import { normalizedUuid } from './layer-metadata'
import { unzlibSync } from 'fflate'
import { Mixer } from './animation'
import { audioMixer } from './audio-writer'
import { writeClip } from './writer'
import { readClip } from './reader'
import { clipSourceDataUrl } from './document-data'
let SQL: SqlJsStatic
const seedBytes = new Uint8Array(readFileSync(new URL('./blank.clip', import.meta.url)))
beforeAll(async () => { SQL = await initSqlJs() })

describe('native audio writing', () => {
  it('writes through both application export paths and keeps other cuts explicitly silent', async () => {
    const source = createMediaFixture(SQL)
    const asset = readClipAudio(SQL, source.clip.bytes(), source.audioId, source.timelineId).assets[0]
    const audio: ClipAudioTimeline = { replacedLayerIds: [], assets: [{ id: 'wave', name: 'voice', dataUrl: `data:audio/wav;base64,${Buffer.from(asset.bytes).toString('base64')}`, durationFrames: 72 }], tracks: [{ id: 'voice', name: 'voice', muted: false, clips: [{ id: 'one', assetId: 'wave', startFrame: 12, sourceOffsetFrames: 6, durationFrames: 24 }] }] }
    const canvas = { width: 32, height: 24, dpi: 150, basisWidth: 32, basisHeight: 24, offsetX: 0, offsetY: 0 }
    source.clip.close()
    const fresh = await writeClip(SQL, seedBytes, { plan: { projectId: 'audio', folders: [], timelines: [
      { id: 'one', name: 'One', fps: 24, duration: 72, tracks: [], audio },
      { id: 'two', name: 'Two', fps: 30, duration: 90, tracks: [] },
    ] }, canvas, fit: 'crop', images: {} })
    const first = new ClipContainer(SQL, fresh.bytes)
    const layer = first.rows('Layer').find(row => row.AudioLayer === 1)!, timelines = first.rows('TimeLine')
    expect(readClipAudio(SQL, fresh.bytes, Number(layer.MainId), normalizedUuid(timelines[0].TimeLineUuid)).clips[0]).toMatchObject({ startFrame: 12, sourceOffsetFrames: 6, durationFrames: 24 })
    const silent = first.rows('Track').find(row => row.TrackKind === 4001 && row.ItemId === timelines[1].MainId)!
    expect(readAudioTiming(first.body(silent.TrackActionMixer)!, Number(silent.TrackActionMixerSize), 30, 0)).toEqual([])
    const imported = await readClip(SQL, fresh.bytes, 'audio.clip')
    const document = openClipDocument(imported, clipSourceDataUrl(fresh.bytes), { role: 'action', columns: [], timelineIds: [imported.timelines[0].id] })
    document.clipDocument!.timelineIds = { [document.activeCutId]: imported.timelines[0].id }
    const plan = buildClipRegistrationPlan(document, 'action')
    plan.timelines[0].audio = { ...audio, replacedLayerIds: [Number(layer.MainId)], tracks: [{ ...audio.tracks[0], sourceLayerId: Number(layer.MainId), clips: [{ ...audio.tracks[0].clips[0], startFrame: 18 }] }] }
    const rewritten = await writeClip(SQL, seedBytes, { plan, canvas, fit: 'crop', images: {} })
    expect(readClipAudio(SQL, rewritten.bytes, Number(layer.MainId), normalizedUuid(timelines[0].TimeLineUuid)).clips[0]).toMatchObject({ startFrame: 18, sourceOffsetFrames: 6, durationFrames: 24 })
    first.close()
  })
  it('matches independently captured CSP primary and double-precision secondary action trees', () => {
    const primary = JSON.parse(readFileSync(new URL('./fixtures/native-media.json', import.meta.url), 'utf8')).mixer
    const secondary = JSON.parse(readFileSync(new URL('./fixtures/native-audio-secondary.json', import.meta.url), 'utf8'))
    for (const [index, capture] of [primary, secondary].entries()) {
      const bytes = Uint8Array.from(Buffer.from(capture.hex, 'hex')), native = new Mixer(unzlibSync(bytes.subarray(4)))
      let objectId = '', name = ''
      native.walk(node => { if (node.name === 'ActionNodeClip') name = node.attrs.Name; if (node.name === 'Param' && node.attrs.Name === 'AudioPlayer') objectId = node.attrs.Tag })
      const written = new Mixer(audioMixer(bytes, [{ objectId, name, startFrame: 0, sourceOffsetFrames: 0, durationFrames: 72 }], 24, index === 1))
      expect(written.secondary).toBe(native.secondary)
      // CSP writes signed zero in one blend field; it has no timing meaning.
      expect(JSON.parse(JSON.stringify(written.root))).toEqual(JSON.parse(JSON.stringify(native.root)))
    }
  })
  it('moves, splits and trims the original layer without duplicating media or audio tracks', async () => {
    const { clip, audioId, timelineId } = createMediaFixture(SQL), seed = new ClipContainer(SQL, seedBytes)
    try {
      const original = readClipAudio(SQL, clip.bytes(), audioId, timelineId), asset = original.assets[0]
      const timeline = clip.rows('TimeLine')[0]
      const audio: ClipAudioTimeline = { replacedLayerIds: [audioId], assets: [{ id: 'wave', sourceItemId: asset.id, name: asset.name, dataUrl: `data:audio/wav;base64,${Buffer.from(asset.bytes).toString('base64')}`, durationFrames: 72 }], tracks: [{ id: 'voice', name: 'セリフ', sourceLayerId: audioId, muted: false, clips: [
        { id: 'left', assetId: 'wave', startFrame: 12, sourceOffsetFrames: 6, durationFrames: 18 },
        { id: 'right', assetId: 'wave', startFrame: 42, sourceOffsetFrames: 24, durationFrames: 30 },
      ] }] }
      const originalBinaries = clip.rows('CanvasItemBinary'), originalItems = clip.rows('CanvasItem')
      await writeAudioTimeline(clip, seed, timeline, audio, 'test')
      const result = readClipAudio(SQL, clip.bytes(), audioId, timelineId)
      expect(result.clips.map(({ startFrame, sourceOffsetFrames, durationFrames }) => ({ startFrame, sourceOffsetFrames, durationFrames }))).toEqual(audio.tracks[0].clips.map(({ startFrame, sourceOffsetFrames, durationFrames }) => ({ startFrame, sourceOffsetFrames, durationFrames })))
      expect(result.assets[0].bytes).toEqual(asset.bytes)
      expect(clip.rows('CanvasItemBinary').map(row => row.ItemBinaryData)).toEqual(originalBinaries.map(row => row.ItemBinaryData))
      expect(clip.rows('CanvasItem').map(row => row.ItemUuid)).toEqual(originalItems.map(row => row.ItemUuid))
      expect(clip.rows('Track').filter(row => row.TrackKind === 4001)).toHaveLength(1)
      await writeAudioTimeline(clip, seed, timeline, { ...audio, tracks: [] }, 'test')
      const track = clip.rows('Track').find(row => row.TrackKind === 4001)!
      expect(readAudioTiming(clip.body(track.TrackActionMixer)!, Number(track.TrackActionMixerSize), 24, 0)).toEqual([])
    } finally { clip.close(); seed.close() }
  })

  it('adds 32 tracks and places overlapping clips in separate native layers with exact embedded media', async () => {
    const source = createMediaFixture(SQL), original = readClipAudio(SQL, source.clip.bytes(), source.audioId, source.timelineId)
    const clip = new ClipContainer(SQL, seedBytes), seed = new ClipContainer(SQL, seedBytes)
    try {
      const asset = original.assets[0], timeline = clip.rows('TimeLine')[0]
      const audio: ClipAudioTimeline = { replacedLayerIds: [], assets: [{ id: 'wave', name: 'stereo original', dataUrl: `data:audio/wav;base64,${Buffer.from(asset.bytes).toString('base64')}`, durationFrames: 72 }], tracks: Array.from({ length: 32 }, (_, index) => ({ id: `voice-${index}`, name: `音声 ${index + 1}`, muted: index === 31,
        clips: [{ id: 'first', assetId: 'wave', startFrame: 6, sourceOffsetFrames: 12, durationFrames: 24 }, ...(index === 0 ? [{ id: 'overlap', assetId: 'wave', startFrame: 12, sourceOffsetFrames: 6, durationFrames: 24 }] : [])] })) }
      await writeAudioTimeline(clip, seed, timeline, audio, 'test')
      const saved = new ClipContainer(SQL, clip.bytes())
      try {
        const layers = saved.rows('Layer').filter(row => row.AudioLayer === 1)
        expect(layers).toHaveLength(33)
        const results = layers.map(layer => readClipAudio(SQL, saved.bytes(), Number(layer.MainId), normalizedUuid(timeline.TimeLineUuid)))
        expect(results.every(result => result.assets[0].bytes.length === asset.bytes.length)).toBe(true)
        expect(results.reduce((count, result) => count + result.clips.length, 0)).toBe(33)
        expect(results.filter(result => result.clips[0].muted)).toHaveLength(1)
        expect(saved.rows('CanvasItem').filter(row => row.ItemType === 'Audio')).toHaveLength(1)
      } finally { saved.close() }
    } finally { clip.close(); seed.close(); source.clip.close() }
  })
})
