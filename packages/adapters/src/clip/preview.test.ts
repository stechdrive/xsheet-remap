import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { unzlibSync } from 'fflate'
import { createCachedPreviewFixture, createPreviewFixture } from './fixtures/preview-fixture'
import { readClipLayerPreview, createClipLayerPreviewReader } from './preview'
import { maskPreview } from './material/preview-image'
import { clipImportFolders, openClipDocument, suggestClipProcessColumns, buildClipRegistrationPlan, activeCutProjectFromDocument, updateActiveCutProjectInDocument, updateClipLayer } from '@xsheet-remap/core'
import { readClip } from './reader'
import { writeClip } from './writer'
import { clipSourceDataUrl } from './document-data'

let SQL: SqlJsStatic
const require = createRequire(import.meta.url)
beforeAll(async () => { SQL = await initSqlJs({ wasmBinary: new Uint8Array(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer }) })

describe('CLIP Quick Look material decoding', () => {
  it('reuses an open source without changing pixels, including recovery after a missing layer', async () => {
    const { clip, vectorId } = await createCachedPreviewFixture(SQL, 'vector')
    const bytes = clip.bytes(); clip.close()
    const original = bytes.slice(), expected = await readClipLayerPreview(SQL, bytes, vectorId)
    const reader = createClipLayerPreviewReader(SQL, bytes)
    try {
      expect(await reader.read(vectorId)).toEqual(expected)
      await expect(reader.read(-1)).rejects.toThrow()
      expect(await reader.read(vectorId)).toEqual(expected)
      expect(bytes).toEqual(original)
    } finally { reader.close() }
  })

  it.each(['vector', '3d'] as const)('uses saved %s pixels without reconstructing, and preserves them through editing/export', async kind => {
    const { clip, vectorId } = await createCachedPreviewFixture(SQL, kind)
    const bytes = clip.bytes(); clip.close()
    const before = Buffer.from(bytes), preview = await readClipLayerPreview(SQL, bytes, vectorId)
    expect(preview).toMatchObject({ width: 2, height: 1, source: 'render', reconstructed: false, storedComposite: false, warnings: [] })
    const png = Buffer.from(preview.bytes), size = png.readUInt32BE(33)
    expect(Array.from(unzlibSync(png.subarray(41, 41 + size)))).toEqual([0, 24, 80, 160, 255, 160, 80, 24, 128])
    const data = await readClip(SQL, bytes, 'saved-material.clip')
    const columns = suggestClipProcessColumns(data, clipImportFolders(data.nodes).map(node => node.id))
    let document = openClipDocument(data, clipSourceDataUrl(bytes), { timelineIds: [data.currentTimelineId], role: 'action', columns, baseProcess: 'xsheet-remap／作画 ' })
    const project = activeCutProjectFromDocument(document), node = project.clipDocument!.nodes.find(item => item.sourceLayerId === vectorId)!
    document = updateActiveCutProjectInDocument(document, updateClipLayer(project, node.id, { name: 'renamed', opacity: .7 }))
    const saved = await writeClip(SQL, new Uint8Array(readFileSync(new URL('./blank.clip', import.meta.url))), { plan: buildClipRegistrationPlan(document, 'action'), canvas: document.clipDocument!.canvas, fit: 'crop', images: {} })
    const reopened = await readClip(SQL, saved.bytes, 'saved.clip')
    expect(reopened.layers!.find(item => item.id === node.id)).toMatchObject({ name: 'renamed', opacity: 179 / 256 })
    expect(Buffer.from((await readClipLayerPreview(SQL, saved.bytes, vectorId)).bytes).equals(png)).toBe(true)
    expect(Buffer.from(bytes).equals(before)).toBe(true)
  })
  it('prefers animation originals, and recovers from an invalid candidate without a false missing-material warning', async () => {
    const { clip, vectorId } = await createCachedPreviewFixture(SQL, 'vector')
    const row = clip.row('Layer', vectorId)
    clip.update('Layer', vectorId, { TimeLineOriginalMipmap: row.LayerRenderMipmap })
    expect((await readClipLayerPreview(SQL, clip.bytes(), vectorId)).source).toBe('timeline-original')
    const template = clip.rows('Layer').find(r => r.LayerName === '1')!
    const mip = clip.row('Mipmap', template.LayerRenderMipmap), info = clip.row('MipmapInfo', mip.BaseMipmapInfo)
    clip.update('Offscreen', info.Offscreen, { Attribute: new Uint8Array([1, 2, 3]) })
    clip.update('Layer', vectorId, { TimeLineOriginalMipmap: template.LayerRenderMipmap })
    expect(await readClipLayerPreview(SQL, clip.bytes(), vectorId)).toMatchObject({ source: 'render', warnings: [] })
    clip.close()
  })
  it.each([['vector', 1], ['3d', 1], ['3d', 0]] as const)('explains missing %s pixels with compatibility flag %i', async (kind, flag) => {
    const { clip, vectorId } = await createCachedPreviewFixture(SQL, kind, false)
    clip.db.run('UPDATE Canvas SET CanvasRenderMipmapForceSaved=?', [flag])
    const bytes = clip.bytes(); clip.close()
    const result = readClipLayerPreview(SQL, bytes, vectorId)
    await expect(result).rejects.toThrow('プレビューを表示できません')
    await expect(result).rejects.toThrow(flag ? '互換情報は保存されていますが' : '同じ名前・同じ場所への上書きもできます')
  })
  it('reports tone on saved leaf pixels without altering them', async () => {
    const { clip, vectorId } = await createCachedPreviewFixture(SQL, '3d')
    const before = await readClipLayerPreview(SQL, clip.bytes(), vectorId)
    const native = JSON.parse(readFileSync(new URL('./fixtures/native-effects.json', import.meta.url), 'utf8'))
    clip.update('Layer', vectorId, { LayerEffectAttached: 1, LayerEffectInfo: new Uint8Array(Buffer.from(native.options.tone, 'base64')) })
    const result = await readClipLayerPreview(SQL, clip.bytes(), vectorId); clip.close()
    expect(result.warnings?.join()).toContain('トーンには未対応')
    expect(result.source).toBe('render')
    expect(Buffer.from(result.bytes).equals(Buffer.from(before.bytes))).toBe(true)
  })
  it('does not reapply or diagnose effects on a saved folder composite', async () => {
    const { clip, vectorId } = await createCachedPreviewFixture(SQL, '3d')
    const layer = clip.row('Layer', vectorId), folder = clip.rows('Layer').find(row => row.LayerFirstChildIndex === vectorId)!
    const native = JSON.parse(readFileSync(new URL('./fixtures/native-effects.json', import.meta.url), 'utf8'))
    clip.update('Layer', folder.MainId, { LayerRenderMipmap: layer.LayerRenderMipmap, LayerEffectAttached: 1, LayerEffectInfo: new Uint8Array(Buffer.from(native.options.waterVivid, 'base64')) })
    const result = await readClipLayerPreview(SQL, clip.bytes(), Number(folder.MainId)); clip.close()
    expect(result).toMatchObject({ source: 'render', storedComposite: true, reconstructed: false, width: 2, height: 1, warnings: [] })
  })
  it('renders a vector through the real container path without changing source bytes, and identifies reconstruction', async () => {
    const { clip, vectorId } = await createPreviewFixture(SQL)
    const bytes = clip.bytes(); clip.close()
    const before = Buffer.from(bytes)
    const result = await readClipLayerPreview(SQL, bytes, vectorId)
    expect(result).toMatchObject({ width: 6, height: 6, storedComposite: false, reconstructed: true })
    expect(result.warnings?.join()).toContain('近似描画')
    const png = Buffer.from(result.bytes), size = png.readUInt32BE(33)
    const pixels = unzlibSync(png.subarray(41, 41 + size))
    // Unfiltered RGBA scanlines; saved red palette labels must not recolor black artwork.
    expect(Array.from(pixels.subarray(2 * 25 + 1 + 2 * 4, 2 * 25 + 1 + 3 * 4))).toEqual([0, 0, 0, 255])
    expect(Buffer.compare(before, Buffer.from(bytes))).toBe(0)
    expect(Buffer.compare(Buffer.from((await readClipLayerPreview(SQL, bytes, vectorId)).bytes), png)).toBe(0)
  })
  it('keeps saved disclosure and vector payloads when importing a whitespace-named base and editing/exporting', async () => {
    const { clip, vectorId } = await createPreviewFixture(SQL), bytes = clip.bytes(); clip.close()
    const data = await readClip(SQL, bytes, 'fixture.clip')
    const columns = suggestClipProcessColumns(data, clipImportFolders(data.nodes).map(node => node.id))
    let document = openClipDocument(data, clipSourceDataUrl(bytes), { timelineIds: [data.currentTimelineId], role: 'action', columns, baseProcess: 'xsheet-remap／作画 ' })
    const project = activeCutProjectFromDocument(document), vector = project.clipDocument!.nodes.find(node => node.sourceLayerId === vectorId)!
    document = updateActiveCutProjectInDocument(document, updateClipLayer(project, vector.id, { name: 'renamed' }))
    const saved = await writeClip(SQL, new Uint8Array(readFileSync(new URL('./blank.clip', import.meta.url))), { plan: buildClipRegistrationPlan(document, 'action'), canvas: document.clipDocument!.canvas, fit: 'crop', images: {} })
    const reopened = await readClip(SQL, saved.bytes, 'saved.clip')
    expect(reopened.layers!.filter(node => node.kind === 'animation').every(node => node.expanded === false)).toBe(true)
    expect(reopened.layers!.find(node => node.id === vector.id)?.name).toBe('renamed')
    expect(Buffer.compare(Buffer.from((await readClipLayerPreview(SQL, saved.bytes, vectorId)).bytes), Buffer.from((await readClipLayerPreview(SQL, bytes, vectorId)).bytes))).toBe(0)
  })
  it('aligns masks in document space with different dimensions, outside defaults and disabled masks', () => {
    const pixels = () => ({ width: 3, height: 1, left: 10, top: 20, rgba: new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, 200, 10, 20, 30, 255]) })
    const mask = { width: 1, height: 1, left: 11, top: 20, rgba: new Uint8ClampedArray([128, 128, 128, 255]), defaultColor: 0 }
    expect(Array.from(maskPreview(pixels(), mask).rgba.filter((_, i) => i % 4 === 3))).toEqual([0, 100, 0])
    expect(Array.from(maskPreview(pixels(), { ...mask, defaultColor: 255 }).rgba.filter((_, i) => i % 4 === 3))).toEqual([255, 100, 255])
    expect(maskPreview(pixels(), { ...mask, disabled: true }).rgba).toEqual(pixels().rgba)
  })
})
