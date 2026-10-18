import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { unzlibSync } from 'fflate'
import { createPreviewFixture } from './fixtures/preview-fixture'
import { readClipLayerPreview } from './preview'
import { maskPreview } from './material/preview-image'
import { clipImportFolders, openClipDocument, suggestClipProcessColumns, buildClipRegistrationPlan, activeCutProjectFromDocument, updateActiveCutProjectInDocument, updateClipLayer } from '@xsheet-remap/core'
import { readClip } from './reader'
import { writeClip } from './writer'
import { clipSourceDataUrl } from './document-data'

let SQL: SqlJsStatic
const require = createRequire(import.meta.url)
beforeAll(async () => { SQL = await initSqlJs({ wasmBinary: new Uint8Array(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer }) })

describe('CLIP Quick Look material decoding', () => {
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
