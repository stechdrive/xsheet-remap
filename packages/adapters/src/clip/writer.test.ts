import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { unzlibSync } from 'fflate'
import type { ClipRegistrationPlan } from '@xsheet-remap/core'
import { ClipContainer } from './container'
import { writeClip } from './writer'
import { Mixer } from './animation'
import { mipmapChain, readLayerPixels } from './layers'
const nativeLabels = JSON.parse(readFileSync(new URL('./fixtures/native-track-labels.json', import.meta.url), 'utf8')) as {
  labels: { LabelName: string; LabelFrame: number; LabelType: number; LabelLength: null }[]
}
const require = createRequire(import.meta.url)
const seed = new Uint8Array(readFileSync(new URL('./blank.clip', import.meta.url)))
let SQL: SqlJsStatic
beforeAll(async () => { SQL = await initSqlJs({ wasmBinary: new Uint8Array(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer }) })
const canvas = { width: 32, height: 24, dpi: 150, basisWidth: 24, basisHeight: 16, offsetX: 2, offsetY: -1 }
const plan: ClipRegistrationPlan = {
  projectId: 'writer-regression', folders: [{ id: 'A', path: ['LO', '作画'], name: 'A', cels: [{ name: '1', assetId: 'one' }, { name: '2' }] }],
  timelines: [
    { id: 'c1', name: 'C001', fps: 24, duration: 24, tracks: [{ folderId: 'A', frames: [{ frame: 0, value: '1' }, { frame: 4, value: '2' }, { frame: 8, value: null }, { frame: 12, value: '1' }] }] },
    { id: 'c2', name: 'C002', fps: 30, duration: 30, tracks: [{ folderId: 'A', frames: [{ frame: 6, value: '2' }] }] },
  ],
}
describe('direct CLIP writer', () => {
  it.each([24, 30])('writes the native circle/filled-circle label chain at frame positions independent of %s fps', async fps => {
    const labeled = { ...plan, timelines: [{ ...plan.timelines[0], fps, tracks: [{ ...plan.timelines[0].tracks[0], labels: [{ frame: 6, kind: 'reverse' as const }, { frame: 2, kind: 'inbetween' as const }] }] }] }
    const result = await writeClip(SQL, seed, { plan: labeled, canvas, fit: 'crop', images: {} })
    const clip = new ClipContainer(SQL, result.bytes)
    try {
      const track = clip.rows('Track').find(row => row.TrackKind === 2000)!
      const labels = clip.rows('TimeLineLabel')
      expect(labels).toHaveLength(2)
      expect(track.TrackLabelFirstIndex).toBe(labels[0].MainId)
      expect(labels.map(({ LabelName, LabelFrame, LabelType, LabelLength }) => ({ LabelName, LabelFrame, LabelType, LabelLength })))
        .toEqual(nativeLabels.labels.map(({ LabelName, LabelFrame, LabelType, LabelLength }) => ({ LabelName, LabelFrame, LabelType, LabelLength })))
      expect(labels.map(row => row.LabelNextIndex)).toEqual([labels[1].MainId, 0])
      for (const label of labels) expect(label).toMatchObject({ TrackId: track.MainId, BankId: track.BankId, ItemId: track.ItemId })
      const original = await writeClip(SQL, seed, { plan: { ...labeled, timelines: [{ ...labeled.timelines[0], tracks: plan.timelines[0].tracks }] }, canvas, fit: 'crop', images: {} })
      const comparison = new ClipContainer(SQL, original.bytes)
      try {
        const originalTrack = comparison.rows('Track').find(row => row.TrackKind === 2000)!
        for (const field of ['TrackActionMixer', 'TrackActionMixer2']) expect(clip.body(track[field])).toEqual(comparison.body(originalTrack[field]))
      } finally { comparison.close() }
      const preserved = await writeClip(SQL, seed, { plan: { ...plan, projectId: 'other' }, canvas, fit: 'crop', images: {}, template: result.bytes })
      const other = new ClipContainer(SQL, preserved.bytes)
      try { expect(other.rows('TimeLineLabel')).toEqual(labels) } finally { other.close() }
      const removed = await writeClip(SQL, seed, { plan, canvas, fit: 'crop', images: {}, template: result.bytes })
      const updated = new ClipContainer(SQL, removed.bytes)
      try {
        expect(updated.rows('TimeLineLabel')).toEqual([])
        expect(updated.rows('Track').every(row => !row.TrackLabelFirstIndex)).toBe(true)
      } finally { updated.close() }
    } finally { clip.close() }
  })
  it('stores valid transparent raster surfaces for unassigned cels', async () => {
    const result = await writeClip(SQL, seed, { plan, canvas, fit: 'crop', images: {} })
    const clip = new ClipContainer(SQL, result.bytes)
    try {
      for (const layer of clip.rows('Layer').filter(row => row.LayerType === 1)) {
        expect(readLayerPixels(clip, layer).data.every(byte => byte === 0)).toBe(true)
        for (const { off } of mipmapChain(clip, layer.LayerRenderMipmap)) expect(clip.body(off.BlockData)?.length).toBeGreaterThan(0)
      }
    } finally { clip.close() }
  })
  it('creates image-free shared cels and two complete timelines from the clean seed', async () => {
    const result = await writeClip(SQL, seed, { plan, canvas, fit: 'expand', images: {} })
    const clip = new ClipContainer(SQL, result.bytes)
    try {
      expect(clip.rows('TimeLine').map(row => [row.TimeLineName, row.FrameRate, row.EndFrame])).toEqual([['C001', 24, 24], ['C002', 30, 30]])
      expect(clip.rows('Layer').filter(row => row.LayerType === 1).map(row => row.LayerName)).toEqual(['1', '2'])
      expect(clip.rows('Canvas')[0]).toMatchObject({ CanvasWidth: 32, CanvasHeight: 24, CanvasResolution: 150, CropFrameInnerWidth: 24, CropFrameInnerOffsetX: 2 })
      const track = clip.rows('Track').find(row => row.TrackKind === 2000)!
      for (const field of ['TrackActionMixer', 'TrackActionMixer2']) {
        const mixer = new Mixer(unzlibSync(clip.body(track[field])!.subarray(4)))
        const arrays: Record<string, (number | string)[]> = {}
        mixer.walk((node, parent) => { if (parent?.name === 'FCurve') arrays[node.name] = node.values })
        expect(arrays.Tag).toEqual(['1', '2', '', '1'])
        expect(arrays.Frame).toEqual([0, 10, 20, 30])
      }
      const uuids = clip.rows('Track').filter(row => row.TrackKind === 2000).map(row => Array.from(row.LayerUuidWithTrack as Uint8Array))
      expect(uuids[0]).toEqual(uuids[1])
    } finally { clip.close() }
  })
  it.each(['crop', 'expand'] as const)('retains exact source pixels with %s and integer centering', async fit => {
    const image = { width: 35, height: 27, channels: 4 as const, data: Uint8Array.from({ length: 35 * 27 * 4 }, (_, i) => i % 4 === 3 ? 255 : i % 251) }
    const result = await writeClip(SQL, seed, { plan, canvas, fit, images: { one: image } })
    const clip = new ClipContainer(SQL, result.bytes)
    try {
      const decoded = readLayerPixels(clip, clip.rows('Layer').find(row => row.LayerName === '1')!)
      const width = fit === 'crop' ? 32 : 35, height = fit === 'crop' ? 24 : 27, offset = fit === 'crop' ? 1 : 0
      expect([decoded.width, decoded.height]).toEqual([width, height])
      for (let y = 0; y < height; y++) expect(decoded.data.slice(y * width * 4, (y + 1) * width * 4)).toEqual(image.data.slice(((y + offset) * 35 + offset) * 4, ((y + offset) * 35 + offset + width) * 4))
    } finally { clip.close() }
  })
  it('keeps canvas settings and reuses owned cells on repeat registration', async () => {
    const first = await writeClip(SQL, seed, { plan, canvas, fit: 'expand', images: {} })
    const second = await writeClip(SQL, seed, { plan, canvas: { ...canvas, width: 1 }, fit: 'crop', images: {}, template: first.bytes })
    const a = new ClipContainer(SQL, first.bytes), b = new ClipContainer(SQL, second.bytes)
    try {
      expect(b.rows('Canvas')[0]).toEqual(a.rows('Canvas')[0])
      expect(b.rows('Layer').length).toBe(a.rows('Layer').length)
      expect(b.rows('TimeLine').length).toBe(2)
    } finally { a.close(); b.close() }
  })
  it('accepts CSP saved templates and retains their external-data cleanup triggers', async () => {
    const first = await writeClip(SQL, seed, { plan, canvas, fit: 'expand', images: {} })
    const saved = new ClipContainer(SQL, first.bytes)
    let template: Uint8Array
    let oldMixers: unknown[]
    try {
      for (const [table, column] of [['Offscreen', 'BlockData'], ['Track', 'TrackActionMixer'], ['Track', 'TrackActionMixer2']]) {
        for (const operation of ['Update', 'Delete']) {
          const event = operation === 'Update' ? `UPDATE OF ${column}` : 'DELETE'
          saved.db.run(`CREATE TRIGGER External${operation}Of${column}On${table} ${event} ON ${table} BEGIN INSERT INTO RemovedExternal(ExternalID) VALUES(OLD.${column}); END`)
        }
      }
      oldMixers = saved.rows('Track').flatMap(row => [row.TrackActionMixer, row.TrackActionMixer2])
      template = saved.bytes()
    } finally { saved.close() }
    const result = await writeClip(SQL, seed, { plan, canvas, fit: 'crop', images: {}, template })
    const clip = new ClipContainer(SQL, result.bytes)
    try {
      expect(clip.rows('TimeLine').map(row => row.TimeLineName)).toEqual(['C001', 'C002'])
      expect(clip.rows('Layer').filter(row => row.LayerType === 1)).toHaveLength(2)
      expect(clip.db.exec("SELECT name FROM sqlite_master WHERE type='trigger'")[0].values).toHaveLength(6)
      expect(clip.rows('RemovedExternal').map(row => row.ExternalID)).toEqual(expect.arrayContaining(oldMixers))
    } finally { clip.close() }
  })
  it.each(['unrecognized', 'ExternalDeleteOfTrackActionMixerOnTrack'])('rejects the nonstandard trigger %s before changing the template', name => {
    const source = new ClipContainer(SQL, seed)
    try {
      source.db.run(`CREATE TRIGGER ${name} DELETE ON Track BEGIN DELETE FROM Canvas; END`)
      const bytes = source.bytes()
      expect(() => new ClipContainer(SQL, bytes)).toThrow('トリガー')
      expect(source.rows('Canvas')).toHaveLength(1)
    } finally { source.close() }
  })
  it('rejects malformed containers and differently sized registered images', async () => {
    expect(() => new ClipContainer(SQL, seed.subarray(0, 100))).toThrow()
    await expect(writeClip(SQL, seed, { plan, canvas, fit: 'expand', images: {
      one: { width: 1, height: 1, channels: 4, data: new Uint8Array(4) },
      two: { width: 2, height: 1, channels: 4, data: new Uint8Array(8) },
    } })).rejects.toThrow('寸法を揃えて')
  })
  it('isolates newly registered cels from original timelines and preserves their mixer data', async () => {
    const first = await writeClip(SQL, seed, { plan, canvas, fit: 'expand', images: {} })
    const second = await writeClip(SQL, seed, { plan: { ...plan, projectId: 'another-project' }, canvas, fit: 'crop', images: {}, template: first.bytes })
    const a = new ClipContainer(SQL, first.bytes), b = new ClipContainer(SQL, second.bytes)
    try {
      expect(b.rows('TimeLine')).toHaveLength(4)
      expect(b.rows('AnimationCutBank')[0].CurrentIndex).toBe(2)
      for (const original of a.rows('Track')) {
        const retained = b.row('Track', original.MainId)
        expect({ ...retained, TrackNextIndex: original.TrackNextIndex }).toEqual(original)
        for (const field of ['TrackActionMixer', 'TrackActionMixer2']) expect(b.body(retained[field])).toEqual(a.body(original[field]))
      }
      const originalIds = new Set(a.rows('Track').map(row => row.MainId))
      const originalTimelines = new Set(a.rows('TimeLine').map(row => row.MainId))
      const additions = b.rows('Track').filter(row => !originalIds.has(row.MainId) && originalTimelines.has(row.ItemId) && row.TrackKind === 2000)
      expect(additions).toHaveLength(2)
      for (const track of additions) {
        const mixer = new Mixer(unzlibSync(b.body(track.TrackActionMixer)!.subarray(4)))
        mixer.walk((node, parent) => { if (parent?.name === 'FCurve' && node.name === 'Tag') expect(node.values).toEqual(['']) })
      }
    } finally { a.close(); b.close() }
  })
})
