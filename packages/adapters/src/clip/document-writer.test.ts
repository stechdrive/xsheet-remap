import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { activeCutProjectFromDocument, addClipLayers, buildClipRegistrationPlan, clipImportFolders, createClipNode, deleteClipLayer, openClipDocument, setEvent, updateActiveCutProjectInDocument, updateClipLayer, type CutGroupProjectDocument, type ClipRegistrationPlan } from '@xsheet-remap/core'
import { ClipContainer } from './container'
import { readClip } from './reader'
import { writeClip } from './writer'
import { clipSourceDataUrl } from './document-data'
import { readLayerPixels } from './layers'
import { readClipLayerPreview } from './preview'
import { ensureTrackLabelStorage } from './track-labels'
import { addClipImages, addOverlayPaperTrack, createDefaultProject, createProjectDocumentFromCutProject, ensureClipDocument } from '@xsheet-remap/core'
import { remapClipTracks, selectTimingProcess, suggestClipProcessColumns } from '@xsheet-remap/core'

const require = createRequire(import.meta.url)
const seed = new Uint8Array(readFileSync(new URL('./blank.clip', import.meta.url)))
let SQL: SqlJsStatic
beforeAll(async () => { SQL = await initSqlJs({ wasmBinary: new Uint8Array(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer }) })
const canvas = { width: 32, height: 24, dpi: 150, basisWidth: 24, basisHeight: 16, offsetX: 0, offsetY: 0 }
const legacy: ClipRegistrationPlan = { projectId: 'preserve', folders: [{ id: 'A', name: 'A', path: ['LO'], cels: [{ name: '001', assetId: 'red' }, { name: '002' }] }],
  timelines: [24, 30].map((fps, i) => ({ id: `cut${i}`, name: `C00${i + 1}`, fps, duration: fps, tracks: [{ folderId: 'A', frames: [{ frame: 0, value: '001' }, { frame: 6, value: '002' }] }] })) }
const pixels = { width: 2, height: 2, channels: 4 as const, data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]) }
async function setup() {
  const original = await writeClip(SQL, seed, { plan: legacy, canvas, fit: 'crop', images: { red: pixels } })
  const data = await readClip(SQL, original.bytes, 'original.clip')
  const folder = clipImportFolders(data.nodes)[0]
  const document = openClipDocument(data, clipSourceDataUrl(original.bytes), { role: 'action', timelineIds: [data.timelines[0].id], columns: [{ layerId: folder.id, name: 'A' }] })
  return { original, document, data, folder }
}
function save(document: CutGroupProjectDocument, images = {}) { return writeClip(SQL, seed, { plan: buildClipRegistrationPlan(document, 'action'), canvas: document.clipDocument!.canvas, fit: 'crop', images }) }
function change(document: CutGroupProjectDocument, fn: (project: ReturnType<typeof activeCutProjectFromDocument>) => ReturnType<typeof activeCutProjectFromDocument>) { return updateActiveCutProjectInDocument(document, fn(activeCutProjectFromDocument(document))) }

describe('editable CLIP document preservation', () => {
  it('writes only assigned correction images on the common sheet and reopens their sparse exposures', async () => {
    let project = ensureClipDocument(createDefaultProject())
    const base = project.correctionLayers[0].layerId, correction = project.correctionLayers[1].layerId
    for (let i = 1; i <= 3; i++) project = addClipImages(project, null, [{ name: `scan-${i}.png`, assetId: 'red', imageDataUrl: 'data:image/png;base64,AA==' }], { paperTrack: 'A', frame: 1 + (i - 1) * 4, role: 'action', processId: base })
    project = addClipImages(project, null, [{ name: 'fix.png', assetId: 'red', imageDataUrl: 'data:image/png;base64,AA==' }], { paperTrack: 'A', frame: 5, role: 'action', processId: correction })
    project = { ...project, clipDocument: { ...project.clipDocument!, canvas } }
    const result = await save(createProjectDocumentFromCutProject(project), { red: pixels })
    const data = await readClip(SQL, result.bytes, 'sparse.clip')
    const folder = clipImportFolders(data.nodes).find(folder => folder.name === 'A' && folder.path.includes('演出'))!
    expect(data.layers!.filter(node => node.parentId === folder.id).map(node => node.name)).toEqual(['fix'])
    expect(data.timelines[0].tracks.find(track => track.layerId === folder.id)!.frames).toEqual([{ frame: 0, value: null }, { frame: 4, value: 'fix' }, { frame: 8, value: null }])
    const reopened = openClipDocument(data, clipSourceDataUrl(result.bytes), { role: 'action', timelineIds: [data.timelines[0].id], columns: suggestClipProcessColumns(data, clipImportFolders(data.nodes).map(folder => folder.id)) })
    expect((await save(reopened)).bytes).toEqual(result.bytes)
  })

  it('exports the default process palette and inserts new columns in native stacking order', async () => {
    const project = addOverlayPaperTrack(ensureClipDocument(createDefaultProject()), { paperTrack: 'J', insertAfterPaperTrack: 'I' }).project
    const result = await save(createProjectDocumentFromCutProject({ ...project, clipDocument: { ...project.clipDocument!, canvas } }))
    const data = await readClip(SQL, result.bytes, 'defaults.clip')
    const expected = [undefined, '#fbece6', '#dce4f1', '#fcf9cf', '#eaf6d5', '#ffddaa']
    for (const [index, process] of project.correctionLayers.entries()) {
      const folder = data.layers!.find(node => node.name === process.label)!
      expect(folder.labelColor).toBe(expected[index])
      const children = data.layers!.filter(node => node.parentId === folder.id)
      expect(children.map(node => node.name)).toEqual('JIHGFEDCBA'.split(''))
      expect(children.every(node => node.kind === 'animation' && node.labelColor === undefined)).toBe(true)
    }
    const reopened = openClipDocument(data, clipSourceDataUrl(result.bytes), { role: 'action', timelineIds: [], columns: [] })
    expect((await save(reopened)).bytes).toEqual(result.bytes)
  })

  it('adds a column inside imported process parents without moving source folders or changing their timing', async () => {
    const plan: ClipRegistrationPlan = { ...legacy, folders: ['作画', '修正'].map((name, index) => ({ ...legacy.folders[0], id: `a${index}`, path: ['LO', name] })), timelines: legacy.timelines.map(timeline => ({ ...timeline, tracks: [0, 1].map(index => ({ ...timeline.tracks[0], folderId: `a${index}` })) })) }
    const original = await writeClip(SQL, seed, { plan, canvas, fit: 'crop', images: { red: pixels } })
    const data = await readClip(SQL, original.bytes, 'nested.clip'), folders = clipImportFolders(data.nodes)
    const document = openClipDocument(data, clipSourceDataUrl(original.bytes), { timelineIds: [data.timelines[0].id], role: 'action', columns: suggestClipProcessColumns(data, folders.map(folder => folder.id)) })
    const added = change(document, project => addOverlayPaperTrack(project, { paperTrack: 'J', insertAfterPaperTrack: 'A' }).project)
    const parsed = await readClip(SQL, (await save(added)).bytes, 'added.clip')
    expect(parsed.layers!.filter(node => data.layers!.some(original => original.id === node.id))).toEqual(data.layers)
    for (const folder of folders) {
      const originalFolder = data.layers!.find(node => node.id === folder.id)!
      expect(parsed.layers!.filter(node => node.parentId === originalFolder.parentId).map(node => node.name)).toEqual(['J', 'A'])
      expect(parsed.timelines.map(timeline => timeline.tracks.find(track => track.layerId === folder.id)))
        .toEqual(data.timelines.map(timeline => timeline.tracks.find(track => track.layerId === folder.id)))
    }
  })

  it('round trips nested process folders on one paper column with independent timing and untouched tracks', async () => {
    const plan: ClipRegistrationPlan = { ...legacy, folders: ['作画', '修正'].map((name, index) => ({ ...legacy.folders[0], id: `a${index}`, path: ['LO', name] })), timelines: legacy.timelines.map(timeline => ({ ...timeline, tracks: [0, 1].map(index => ({ folderId: `a${index}`, frames: [{ frame: 0, value: '001' }, { frame: index ? 8 : 4, value: '002' }] })) })) }
    const original = await writeClip(SQL, seed, { plan, canvas, fit: 'crop', images: { red: pixels } })
    const data = await readClip(SQL, original.bytes, 'nested.clip'), folders = clipImportFolders(data.nodes)
    const columns = suggestClipProcessColumns(data, folders.map(folder => folder.id))
    const document = openClipDocument(data, clipSourceDataUrl(original.bytes), { timelineIds: [data.timelines[0].id], role: 'action', columns })
    expect((await save(document)).bytes).toEqual(original.bytes)
    const [first, second] = document.clipDocument!.targets
    const remapped = remapClipTracks(document, [{ folderId: first.folderId, slotId: second.slotId }, { folderId: second.folderId, slotId: first.slotId }])
    expect((await save(remapped)).bytes).toEqual(original.bytes)
    const project = activeCutProjectFromDocument(document), process = project.correctionLayers.find(layer => layer.label === 'xsheet-remap／LO／作画')!
    const selected = selectTimingProcess(project, process.layerId)
    const changed = updateActiveCutProjectInDocument(document, setEvent(selected, 'A', 13, selected.logicalSheet.events[0].keyId, 'action'))
    const edited = await save(changed), parsed = await readClip(SQL, edited.bytes, 'edited.clip')
    const folder = folders.find(folder => folder.path.join('／') === 'xsheet-remap／LO／作画／A')!
    const other = folders.find(item => item.id !== folder.id)!
    expect(parsed.timelines[0].tracks.find(track => track.layerId === folder.id)!.frames).toEqual([{ frame: 0, value: '001' }, { frame: 4, value: '002' }, { frame: 12, value: '001' }])
    expect(parsed.timelines[0].tracks.find(track => track.layerId === other.id)).toEqual(data.timelines[0].tracks.find(track => track.layerId === other.id))
    expect(parsed.timelines[1]).toEqual(data.timelines[1])
    expect(parsed.layers).toEqual(data.layers)
    const reopened = openClipDocument(parsed, clipSourceDataUrl(edited.bytes), { timelineIds: [parsed.timelines[0].id], role: 'action', columns })
    expect((await save(reopened)).bytes).toEqual(edited.bytes)
  })
  it('creates a complete new document from the bundled seed, including pixels, static layers and timing', async () => {
    const project = ensureClipDocument(createDefaultProject())
    const slot = project.cspTrackSlots.find(slot => slot.slotId === project.clipDocument!.targets[0].slotId)!
    const input = [{ name: '001.png', assetId: 'red', imageDataUrl: 'data:image/png;base64,AA==' }]
    const withCel = addClipImages(project, null, input, { paperTrack: slot.paperTrack, frame: 1, role: 'action', processId: slot.correctionLayerId! })
    const withBook = addClipImages(withCel, null, [{ ...input[0], name: 'BOOK.png' }])
    const document = createProjectDocumentFromCutProject({ ...withBook, clipDocument: { ...withBook.clipDocument!, canvas } })
    const result = await save(document, { red: pixels })
    const data = await readClip(SQL, result.bytes, 'new.clip')
    expect(data.canvas).toEqual(canvas)
    expect(data.layers!.find(layer => layer.name === 'BOOK')).toMatchObject({ kind: 'raster', parentId: null })
    expect(data.timelines[0].tracks.some(track => track.frames.some(frame => frame.value === '001'))).toBe(true)
  })
  it('preserves native labels through timing changes and merges new sheet markers without overwriting unknown labels', async () => {
    const { original, folder } = await setup()
    const clip = new ClipContainer(SQL, original.bytes)
    let source: Uint8Array, trackId: number, labelId: number
    try {
      ensureTrackLabelStorage(clip)
      const track = clip.rows('Track').find(row => row.TrackKind === 2000)!
      trackId = Number(track.MainId)
      const label = clip.insert('TimeLineLabel', {}, { BankId: track.BankId, ItemId: track.ItemId, TrackId: track.MainId, LabelNextIndex: 0, LabelName: 'native note', LabelFrame: 3, LabelType: 99, LabelLength: 2 })
      labelId = Number(label.MainId)
      clip.update('Track', track.MainId, { TrackLabelFirstIndex: label.MainId }); source = clip.bytes()
    } finally { clip.close() }
    const data = await readClip(SQL, source!, 'labels.clip')
    const document = openClipDocument(data, clipSourceDataUrl(source!), { role: 'action', timelineIds: [data.timelines[0].id], columns: [{ layerId: folder.id, name: 'A' }] })
    const changed = change(document, project => setEvent(project, 'A', project.logicalSheet.frameOrigin + 12, project.bindings[0].keyId, 'action'))
    const saved = await save(changed), before = new ClipContainer(SQL, source!), after = new ClipContainer(SQL, saved.bytes)
    try { expect(after.rows('TimeLineLabel')).toEqual(before.rows('TimeLineLabel')) } finally { before.close(); after.close() }
    const plan = buildClipRegistrationPlan(changed, 'action')
    plan.timelines[0].tracks[0].labels = [{ frame: 5, kind: 'reverse' }]
    const merged = await writeClip(SQL, seed, { plan, canvas, fit: 'crop', images: {} }), result = new ClipContainer(SQL, merged.bytes)
    try {
      expect(result.row('Track', trackId!).TrackLabelFirstIndex).toBe(labelId!)
      const native = result.row('TimeLineLabel', labelId!)
      expect(native).toMatchObject({ LabelName: 'native note', LabelFrame: 3, LabelType: 99, LabelLength: 2 })
      expect(result.row('TimeLineLabel', native.LabelNextIndex)).toMatchObject({ LabelFrame: 5, LabelType: 2, LabelNextIndex: 0 })
    } finally { result.close() }
    plan.timelines[0].tracks[0].labels = [{ frame: 3, kind: 'reverse' }]
    await expect(writeClip(SQL, seed, { plan, canvas, fit: 'crop', images: {} })).rejects.toThrow('既存ラベル')
  })
  it('retains mask visibility bits when changing the eye flag', async () => {
    const clip = new ClipContainer(SQL, seed)
    let bytes: Uint8Array, sourceId: number
    try {
      const row = clip.rows('Layer').find(layer => layer.LayerType === 1)!
      sourceId = Number(row.MainId); clip.update('Layer', sourceId, { LayerVisibility: 7 }); bytes = clip.bytes()
    } finally { clip.close() }
    const data = await readClip(SQL, bytes!, 'mask.clip')
    const document = openClipDocument(data, clipSourceDataUrl(bytes!), { timelineIds: [], role: 'action', columns: [] })
    const layer = data.layers!.find(layer => layer.sourceLayerId === sourceId!)!
    const result = await save(change(document, project => updateClipLayer(project, layer.id, { visible: false })))
    const edited = new ClipContainer(SQL, result.bytes)
    try { expect(edited.row('Layer', sourceId!).LayerVisibility).toBe(6) } finally { edited.close() }
    expect((await readClip(SQL, result.bytes, 'edited.clip')).layers!.find(node => node.id === layer.id)?.visible).toBe(false)
  })
  it('maps selected timeline IDs in native order regardless of checkbox selection order', async () => {
    const { original, data, folder } = await setup()
    const document = openClipDocument(data, clipSourceDataUrl(original.bytes), { timelineIds: data.timelines.map(timeline => timeline.id).reverse(), role: 'action', columns: [{ layerId: folder.id, name: 'A' }] })
    expect(document.cuts.map(cut => document.clipDocument!.timelineIds![cut.cutId])).toEqual(data.timelines.map(timeline => timeline.id))
    expect((await save(document)).bytes).toEqual(original.bytes)
  })
  it('returns byte-identical source when opened and saved without edits, including unselected timelines', async () => {
    const { original, document } = await setup()
    expect((await save(document)).bytes).toEqual(original.bytes)
  })
  it('preserves original raster bytes and all tracks when only folder appearance changes', async () => {
    const { original, document, folder } = await setup()
    const result = await save(change(document, project => updateClipLayer(project, folder.id, { opacity: .5, blendMode: 2, visible: false })))
    const before = new ClipContainer(SQL, original.bytes), after = new ClipContainer(SQL, result.bytes)
    try {
      expect(after.rows('Track')).toEqual(before.rows('Track'))
      expect(after.rows('TimeLine')).toEqual(before.rows('TimeLine'))
      const layer = before.rows('Layer').find(row => row.LayerName === '001')!
      expect(readLayerPixels(after, after.row('Layer', layer.MainId))).toEqual(readLayerPixels(before, layer))
      expect((await readClip(SQL, result.bytes, 'edited.clip')).layers!.find(node => node.id === folder.id)).toMatchObject({ opacity: .5, blendMode: 2, visible: false })
    } finally { before.close(); after.close() }
  })
  it('inserts a normal static material with pixels without generating an animation folder', async () => {
    const { document, folder } = await setup()
    const materialFolder = createClipNode('BOOK', 'folder', null), image = { ...createClipNode('book', 'raster', materialFolder.id), assetId: 'book' }
    const result = await save(change(document, project => addClipLayers(project, [materialFolder, image])), { [image.id]: pixels })
    const parsed = await readClip(SQL, result.bytes, 'edited.clip')
    expect(clipImportFolders(parsed.nodes).map(node => node.id)).toEqual([folder.id])
    const clip = new ClipContainer(SQL, result.bytes)
    try {
      const layer = clip.rows('Layer').find(row => row.LayerName === 'book')!
      expect(layer.AnimationFolder).toBe(0)
      const actual = readLayerPixels(clip, layer)
      expect(Array.from(actual.data.subarray((11 * 32 + 15) * 4, (11 * 32 + 15) * 4 + 8))).toEqual(Array.from(pixels.data.subarray(0, 8)))
      const preview = await readClipLayerPreview(SQL, result.bytes, Number(layer.MainId))
      expect(preview.bytes.subarray(0, 8)).toEqual(new Uint8Array([137,80,78,71,13,10,26,10]))
    } finally { clip.close() }
  })
  it('updates the selected sheet timeline and preserves the other timeline mixer', async () => {
    const { original, document } = await setup()
    const result = await save(change(document, project => setEvent(project, 'A', project.logicalSheet.frameOrigin + 12, project.bindings[0].keyId, 'action')))
    const parsed = await readClip(SQL, result.bytes, 'edited.clip')
    expect(parsed.timelines[0].tracks[0].frames).toContainEqual({ frame: 12, value: '001' })
    expect(parsed.timelines[1].tracks[0].frames).toEqual([{ frame: 0, value: '001' }, { frame: 6, value: '002' }])
    const before = new ClipContainer(SQL, original.bytes), after = new ClipContainer(SQL, result.bytes)
    try {
      const timeline = before.rows('TimeLine')[1]
      const track = before.rows('Track').find(row => row.ItemId === timeline.MainId && row.TrackKind === 2000)!
      expect(after.row('Track', track.MainId)).toEqual(track)
    } finally { before.close(); after.close() }
  })
  it('renames a cel across preserved native timelines without changing sheet notation', async () => {
    const { document } = await setup()
    const binding = document.registeredCells.bindings[0]
    const changed = change(document, project => updateClipLayer(project, binding.clipLayerId!, { name: '003' }))
    const parsed = await readClip(SQL, (await save(changed)).bytes, 'renamed.clip')
    expect(parsed.timelines.every(timeline => timeline.tracks[0].frames[0].value === '003')).toBe(true)
    expect(changed.registeredCells.keys[0].displayLabel).toBe('001')
  })
  it('removes an animation subtree and its tracks while keeping the other document rows', async () => {
    const { document, folder, data } = await setup()
    const result = await save(change(document, project => deleteClipLayer(project, folder.id)))
    const parsed = await readClip(SQL, result.bytes, 'deleted.clip')
    expect(clipImportFolders(parsed.nodes)).toHaveLength(0)
    expect(parsed.timelines.every(timeline => timeline.tracks.length === 0)).toBe(true)
    for (const layer of data.layers!.filter(layer => layer.locked)) expect(parsed.layers).toContainEqual(layer)
  })
  it('opens an illustration without timelines and retains its bytes', async () => {
    const clip = new ClipContainer(SQL, seed)
    let bytes: Uint8Array
    try { clip.db.run('DELETE FROM Track'); clip.db.run('DELETE FROM TimeLine'); clip.db.run('DELETE FROM AnimationCutBank'); bytes = clip.bytes() } finally { clip.close() }
    const data = await readClip(SQL, bytes!, 'illustration.clip')
    expect(data.timelines).toEqual([])
    const document = openClipDocument(data, clipSourceDataUrl(bytes!), { timelineIds: [], role: 'action', columns: [] })
    expect((await save(document)).bytes).toEqual(bytes!)
  })
})
