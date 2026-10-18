import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { unzlibSync } from 'fflate'
import { clipImportFolders, type ClipRegistrationPlan } from '@xsheet-remap/core'
import { readAnimation } from './read-animation'
import { readClip } from './reader'
import { ClipContainer } from './container'
import { writeClip } from './writer'
import { Mixer, animationMixer, packedMixer } from './animation'
const native = JSON.parse(readFileSync(new URL('./fixtures/native-timelines.json', import.meta.url), 'utf8')) as {
  tracks: { fps: number; start: number; end: number; mixers: Record<'TrackActionMixer' | 'TrackActionMixer2', { size: number; hex: string }> }[]
}

const require = createRequire(import.meta.url)
const seed = new Uint8Array(readFileSync(new URL('./blank.clip', import.meta.url)))
let SQL: SqlJsStatic
beforeAll(async () => { SQL = await initSqlJs({ wasmBinary: new Uint8Array(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer }) })
const nativeMixer = () => new Mixer(unzlibSync(Buffer.from(native.tracks[1].mixers.TrackActionMixer.hex, 'hex').subarray(4)))
function read(mixer: Mixer, start = 0, end = 120) { const raw = mixer.encode(); return readAnimation(packedMixer(raw), raw.length, 24, start, end) }

describe('CSP cell timing evaluation', () => {
  it('reads independently captured native primary and secondary chunks for three timelines', () => {
    for (const [index, track] of native.tracks.entries()) for (const value of Object.values(track.mixers)) {
      const frames = readAnimation(Buffer.from(value.hex, 'hex'), value.size, track.fps, track.start, track.end)
      expect(frames).toEqual(index === 0 ? [{ frame: 0, value: '1' }] : [{ frame: 0, value: null }, { frame: 6, value: '1' }])
    }
  })
  it('evaluates trimmed source motion and retains keys around a nonzero playback range', () => {
    const mixer = nativeMixer()
    mixer.walk((node, parent) => {
      if (parent?.name === 'MotionClip' && node.name === 'Start') node.values = [5]
      if (parent?.name === 'MotionClip' && node.name === 'End') node.values = [290]
      if (parent?.name === 'FCurve') {
        if (node.name === 'Frame') node.values = [0, 10, 20]
        if (node.name === 'Tag') node.values = ['001', '001', '']
        if (node.name === 'Interp') node.values = ['Constant', 'Constant', 'Constant']
      }
    })
    expect(read(mixer)).toEqual([{ frame: 0, value: null }, { frame: 6, value: '001' }, { frame: 8, value: '001' }, { frame: 12, value: null }])
    expect(read(mixer, 9, 30)).toEqual([{ frame: -3, value: '001' }, { frame: -1, value: '001' }, { frame: 3, value: null }])
  })
  it('retains negative and end-boundary keys in both mixer formats without adding a key at playback start', () => {
    const keys = [{ frame: -30, value: '001' }, { frame: 4, value: '001' }, { frame: 24, value: null }, { frame: 36, value: '002' }]
    for (const chunk of Object.values(native.tracks[1].mixers)) {
      const raw = animationMixer(Buffer.from(chunk.hex, 'hex'), keys, 1296, 24)
      expect(readAnimation(packedMixer(raw), raw.length, 24, 0, 24)).toEqual(keys)
    }
  })
  it('preserves disjoint clip gaps and rejects overlapping clips or unsupported interpolation', () => {
    const mixer = nativeMixer()
    mixer.walk((node, parent) => { if ((parent?.name === 'TimeClip' || parent?.name === 'MotionClip') && node.name === 'End') node.values = [parent.name === 'TimeClip' ? 30 : 15] })
    let original: Mixer['root'] | undefined, parent: Mixer['root'] | undefined
    mixer.walk((node, owner) => { if (node.name === 'ActionNodeClip') { original = node; parent = owner } })
    const second = structuredClone(original)
    const time = second!.children.find(node => node.name === 'TimeClip')!
    time.children.find(node => node.name === 'Start')!.values = [45]
    time.children.find(node => node.name === 'End')!.values = [60]
    parent!.children.push(second!)
    expect(read(mixer, 0, 36)).toEqual([{ frame: 0, value: null }, { frame: 6, value: '1' }, { frame: 12, value: null }, { frame: 18, value: '1' }, { frame: 24, value: null }])
    expect(read(mixer, 13, 17)).toEqual([{ frame: -7, value: '1' }, { frame: -1, value: null }, { frame: 5, value: '1' }])
    time.children.find(node => node.name === 'Start')!.values = [25]
    expect(() => read(mixer)).toThrow('重なった')
    const unsupported = nativeMixer()
    unsupported.walk(node => { if (node.name === 'Interp') node.values = ['Linear'] })
    expect(() => read(unsupported)).toThrow('未対応')
  })
  it('rejects truncation and forged decompressed sizes', () => {
    const chunk = native.tracks[1].mixers.TrackActionMixer
    const bytes = Buffer.from(chunk.hex, 'hex')
    expect(() => readAnimation(bytes.subarray(0, bytes.length - 1), chunk.size, 24, 0, 120)).toThrow()
    expect(() => readAnimation(bytes, 20, 24, 0, 120)).toThrow()
  })
  it('rejects a dummy range too large to represent safely', () => {
    const chunk = native.tracks[1].mixers.TrackActionMixer
    const raw = animationMixer(Buffer.from(chunk.hex, 'hex'), [{ frame: -1_000_000, value: '1' }], 24, 24)
    expect(() => readAnimation(packedMixer(raw), raw.length, 24, 0, 24)).toThrow('範囲が広すぎます')
  })
})

const plan: ClipRegistrationPlan = { projectId: 'import', folders: [
  { id: 'bottom', name: 'A', path: ['原画'], cels: [{ name: '001' }] },
  { id: 'top', name: 'A', path: ['修正', '担当者'], cels: [{ name: '2' }] },
], timelines: [
  { id: 'one', name: 'C001', fps: 24, duration: 24, tracks: [{ folderId: 'bottom', frames: [{ frame: 0, value: '001' }, { frame: 3, value: null }, { frame: 7, value: '001' }] }] },
  { id: 'two', name: 'C002', fps: 30, duration: 60, tracks: [{ folderId: 'bottom', frames: [{ frame: 6, value: '001' }] }, { folderId: 'top', frames: [{ frame: 0, value: '2' }] }] },
] }
describe('CLIP document import', () => {
  it('reads arbitrary folder hierarchy in palette order, hidden animation folders, shared layer identity and distinct timelines', async () => {
    const written = await writeClip(SQL, seed, { plan, canvas: { width: 32, height: 24, dpi: 150, basisWidth: 24, basisHeight: 16, offsetX: 0, offsetY: 0 }, fit: 'expand', images: {} })
    const clip = new ClipContainer(SQL, written.bytes)
    clip.db.run("UPDATE Layer SET LayerVisibility = 0 WHERE LayerName = '修正'")
    clip.db.run("UPDATE Layer SET LayerFolder = LayerFolder | 16 WHERE LayerName IN ('修正', 'A')")
    const bytes = clip.bytes(); clip.close()
    const before = bytes.slice()
    const result = await readClip(SQL, bytes, 'source.clip')
    expect(bytes).toEqual(before)
    expect(result.fileHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.nodes[0].children.map(node => node.name)).toEqual(['修正', '原画'])
    expect(result.nodes[0].children.map(node => node.expanded)).toEqual([false, true])
    expect(result.layers!.filter(node => node.kind === 'animation').every(node => node.expanded === false)).toBe(true)
    expect(result.layers!.filter(node => node.kind === 'raster').every(node => node.expanded === undefined)).toBe(true)
    const folders = clipImportFolders(result.nodes)
    expect(folders.map(folder => [folder.path, folder.visible])).toEqual([[['xsheet-remap', '原画', 'A'], true], [['xsheet-remap', '修正', '担当者', 'A'], false]])
    expect(result.timelines.map(timeline => [timeline.name, timeline.fps, timeline.endFrame])).toEqual([['C001', 24, 24], ['C002', 30, 60]])
    expect(result.timelines[0].tracks.find(track => track.layerId === folders[0].id)?.frames).toEqual(plan.timelines[0].tracks[0].frames)
    expect(result.timelines[1].tracks.find(track => track.layerId === folders[0].id)?.frames).toEqual([{ frame: 0, value: null }, { frame: 6, value: '001' }])
    expect(result.timelines.flatMap(timeline => timeline.tracks).every(track => !track.error)).toBe(true)
  })
})
