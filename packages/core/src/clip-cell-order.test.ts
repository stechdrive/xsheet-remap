import { describe, expect, it } from 'vitest'
import { activeCutProjectFromDocument, addClipImages, addClipLayers, applyCommand, buildClipRegistrationPlan, clipChildren, clipEffectiveCel,
  commitHistory, createClipNode, createDefaultProject, createProjectDocumentFromCutProject, createProjectHistory, ensureClipDocument,
  moveClipLayer, parseProjectDocument, redoHistory, setClipTarget, sortClipCelsByName, synchronizeClipBindings, undoHistory, upsertBinding, type CutProject } from './index'

function setup() {
  const project = ensureClipDocument(createDefaultProject())
  const slot = project.cspTrackSlots.find(slot => slot.paperTrack === 'A')!
  const folderId = project.clipDocument!.targets.find(target => target.slotId === slot.slotId)!.folderId
  return { project, slot, folderId }
}
function register(project: CutProject, name: string, frame: number) {
  const next = applyCommand(project, { type: 'event.create', paperTrack: 'A', frame, displayLabel: name, sheetRole: 'cell' })
  const key = next.logicalSheet.keys.find(key => key.displayLabel === name)!
  return next.bindings.some(binding => binding.keyId === key.keyId) ? next
    : upsertBinding(next, { slotId: 'slot_A', keyId: key.keyId, cspCellName: name, materialState: 'unassigned' })
}
const enter = (project: CutProject, name: string, frame: number) => synchronizeClipBindings(register(project, name, frame))
const names = (project: CutProject, folderId: string) => clipChildren(project.clipDocument!, folderId).map(node => node.name)

describe('CLIP cel stack order', () => {
  it('stacks newly entered cels above existing manual order, independent of frame or name, and never moves reused cels', () => {
    const { project, folderId } = setup()
    let current = enter(enter(enter(project, '10', 20), '2', 4), '1', 12)
    expect(names(current, folderId)).toEqual(['1', '2', '10'])
    const ten = clipChildren(current.clipDocument!, folderId).find(node => node.name === '10')!
    current = moveClipLayer(current, ten.id, folderId, clipChildren(current.clipDocument!, folderId)[0].id)
    const reused = enter(current, '2', 30)
    expect(reused.clipDocument).toBe(current.clipDocument)
    const added = enter(reused, '3', 2)
    expect(names(added, folderId)).toEqual(['3', '10', '1', '2'])
    expect(clipChildren(added.clipDocument!, folderId).slice(1)).toEqual(clipChildren(current.clipDocument!, folderId))
    const history = commitHistory(createProjectHistory(reused), added)
    expect(undoHistory(history).present).toEqual(reused)
    expect(redoHistory(undoHistory(history)).present).toBe(added)
    expect(synchronizeClipBindings(added)).toBe(added)
    expect(ensureClipDocument(added)).toBe(added)
  })

  it('initializes legacy registrations in the same top-first order without reordering existing CLIP documents', () => {
    let legacy = createDefaultProject()
    for (const [index, displayLabel] of ['10', '2', '1'].entries()) legacy = register(legacy, displayLabel, index + 1)
    const migrated = synchronizeClipBindings(ensureClipDocument(legacy))
    const folderId = migrated.clipDocument!.targets.find(target => target.slotId === legacy.cspTrackSlots.find(slot => slot.paperTrack === 'A')!.slotId)!.folderId
    expect(names(migrated, folderId)).toEqual(['1', '2', '10'])
    expect(legacy.clipDocument).toBeUndefined()
    expect(migrated.logicalSheet).toBe(legacy.logicalSheet)
  })

  it.each([{ path: [] }, { path: ['作監', '線画'] }])('places a new sheet image above siblings while preserving its configured inner path $path', ({ path }) => {
    const { project, slot, folderId } = setup()
    const existing = createClipNode('existing', 'raster', folderId, 'existing')
    const before = setClipTarget(addClipLayers(project, [existing]), slot.slotId, folderId, path)
    const next = addClipImages(before, null, [{ name: '001.png', assetId: 'image', imageDataUrl: 'data:image/png;base64,AA==' }],
      { paperTrack: 'A', frame: 5, role: 'cell', processId: slot.correctionLayerId! })
    expect(names(next, folderId)).toEqual(['001', 'existing'])
    expect(next.clipDocument!.nodes.find(node => node.id === existing.id)).toBe(existing)
    let parentId = clipChildren(next.clipDocument!, folderId)[0].id
    for (const name of path) {
      const child = clipChildren(next.clipDocument!, parentId)[0]
      expect(child.name).toBe(name); parentId = child.id
    }
    expect(undoHistory(commitHistory(createProjectHistory(before), next)).present).toEqual(before)
  })

  it('sorts actual CLIP names naturally in either direction, retaining bindings, timing, persistence and Undo', () => {
    const { project, folderId } = setup()
    const source = enter(enter(enter(project, '2', 1), '1', 2), '10', 3)
    const asc = sortClipCelsByName(source, folderId, 'ascending')
    expect(names(asc, folderId)).toEqual(['1', '2', '10'])
    expect(asc.logicalSheet).toBe(source.logicalSheet)
    expect(asc.bindings).toBe(source.bindings)
    expect(asc.clipDocument!.nodes.every(node => source.clipDocument!.nodes.includes(node))).toBe(true)
    const document = createProjectDocumentFromCutProject(asc)
    expect(buildClipRegistrationPlan(document, 'cell').timelines).toEqual(buildClipRegistrationPlan(createProjectDocumentFromCutProject(source), 'cell').timelines)
    expect(names(activeCutProjectFromDocument(parseProjectDocument(JSON.parse(JSON.stringify(document)))), folderId)).toEqual(['1', '2', '10'])
    expect(sortClipCelsByName(asc, folderId, 'ascending')).toBe(asc)
    const desc = sortClipCelsByName(asc, folderId, 'descending')
    expect(names(desc, folderId)).toEqual(['10', '2', '1'])
    const history = commitHistory(createProjectHistory(source), asc)
    expect(undoHistory(history).present).toEqual(source)
    expect(redoHistory(undoHistory(history)).present).toBe(asc)
  })

  it('keeps equal-name adoption, numeric ties, inner cel stacks, media positions and unrelated folders intact', () => {
    const { project, folderId } = setup()
    const cels = [createClipNode('10', 'folder', folderId, 'ten'), createClipNode('2', 'raster', folderId, 'two'),
      createClipNode('sound', 'audio', folderId, 'sound'), createClipNode('01', 'raster', folderId, 'zero-one'),
      createClipNode('1', 'raster', folderId, 'one'), createClipNode('2', 'raster', folderId, 'bottom-two')]
    const inner = [createClipNode('線', 'raster', 'ten', 'line'), createClipNode('色', 'raster', 'ten', 'color')]
    const source = { ...project, clipDocument: { ...project.clipDocument!, nodes: [...project.clipDocument!.nodes, ...cels, ...inner] } }
    for (const [direction, expected] of [['ascending', ['zero-one', 'one', 'sound', 'two', 'bottom-two', 'ten']],
      ['descending', ['ten', 'two', 'sound', 'bottom-two', 'zero-one', 'one']]] as const) {
      const sorted = sortClipCelsByName(source, folderId, direction)
      expect(clipChildren(sorted.clipDocument!, folderId).map(node => node.id)).toEqual(expected)
      expect(clipEffectiveCel(sorted.clipDocument!, folderId, '2')?.id).toBe('bottom-two')
      expect(clipChildren(sorted.clipDocument!, 'ten')).toEqual(inner)
      expect(sorted.clipDocument!.nodes.filter(node => node.parentId !== folderId)).toEqual(source.clipDocument.nodes.filter(node => node.parentId !== folderId))
    }
    expect(clipChildren(source.clipDocument, folderId)).toEqual(cels)
  })

  it('rejects unrelated folders and protected targets or cells without changing the document', () => {
    const { project, folderId } = setup()
    expect(() => sortClipCelsByName(project, 'missing', 'ascending')).toThrow('アニメーション')
    expect(() => sortClipCelsByName(project, project.clipDocument!.nodes[0].id, 'ascending')).toThrow('アニメーション')
    const lockedFolder = { ...project, clipDocument: { ...project.clipDocument!, nodes: project.clipDocument!.nodes.map(node => node.id === folderId ? { ...node, locked: true } : node) } }
    expect(() => sortClipCelsByName(lockedFolder, folderId, 'ascending')).toThrow('追加できません')
    const lockedCel = addClipLayers(project, [{ ...createClipNode('2', 'raster', folderId), locked: true }, createClipNode('1', 'raster', folderId)])
    expect(() => sortClipCelsByName(lockedCel, folderId, 'ascending')).toThrow('保護されたセル')
  })
})
