import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { addClipLayers, buildClipRegistrationPlan, createClipNode, createKey, parseProjectDocument, setEvent, timingForProcess, timingHitForFrame } from '@xsheet-remap/core'
import { independentClipFixture } from '../../core/src/clip-workflows.fixture'
import { useAppController } from './app-shell-controller'
import { clipImageDataUrl } from './clipImageImport'

vi.mock('./clipImageImport', () => ({ clipImageDataUrl: vi.fn() }))
const pixels = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
beforeEach(() => {
  vi.mocked(clipImageDataUrl).mockResolvedValue(pixels)
  URL.createObjectURL = file => `blob:${(file as File).name}`
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
const image = (name: string) => new File(['pixels'], name, { type: 'image/png' })
function setup() {
  const { result } = renderHook(() => useAppController({ appKind: 'remap' }))
  const hit = (frame = 1) => timingHitForFrame(result.current.template, 'cell', 'A', frame)!
  const switchMode = (mode: 'sheet' | 'clip') => act(() => result.current.handleWorkModeChange(mode))
  const drop = async (name: string, frame = 1) => act(async () => result.current.handleClipImageFiles([image(name)], null, hit(frame)))
  return { result, hit, switchMode, drop }
}

it('commits an input draft once, preserves the complete document through mode switches, and undoes edits across modes', () => {
  const { result, hit, switchMode } = setup()
  expect(result.current.workMode).toBe('sheet')
  act(() => result.current.handleCellClick(hit()))
  act(() => result.current.handleTimingCharacterInput('2'))
  expect(result.current.valueDraftActive).toBe(true)
  switchMode('clip')
  const saved = result.current.projectDocumentSnapshot, depth = result.current.history.past.length
  expect(result.current.project.logicalSheet.events).toHaveLength(1)
  expect(result.current.valueDraftActive).toBe(false)
  act(() => result.current.handleNewImageProcessChange(result.current.project.correctionLayers[1].layerId))
  expect(result.current.activeCorrectionLayerId).toBe(result.current.project.correctionLayers[1].layerId)
  switchMode('sheet'); switchMode('clip'); switchMode('sheet')
  expect(result.current.projectDocumentSnapshot).toEqual(saved)
  expect(result.current.history.past).toHaveLength(depth)
  expect(buildClipRegistrationPlan(parseProjectDocument(JSON.parse(JSON.stringify(saved))), 'cell').timelines).toEqual(buildClipRegistrationPlan(saved, 'cell').timelines)
  act(() => result.current.handleUndo())
  expect(result.current.project.logicalSheet.events).toHaveLength(0)
  expect(result.current.workMode).toBe('sheet')
  act(() => result.current.handleRedo())
  expect(result.current.projectDocumentSnapshot).toEqual(saved)
})

it('returns to the fixed base, retains the assembly destination, and undoes a base change without rewriting timings', async () => {
  const { result, switchMode } = setup(), { document } = independentClipFixture()
  await act(async () => result.current.handleImportClip(document))
  const base = result.current.baseProcessId, other = result.current.project.correctionLayers.find(process => process.layerId !== base)!.layerId
  const original = result.current.projectDocumentSnapshot
  act(() => result.current.handleNewImageProcessChange(other))
  expect(result.current.activeCorrectionLayerId).toBe(other)
  expect(result.current.newImageProcessId).toBe(other)
  switchMode('sheet')
  expect(result.current.activeCorrectionLayerId).toBe(base)
  expect(result.current.projectDocumentSnapshot).toEqual(original)
  switchMode('clip')
  expect(result.current.activeCorrectionLayerId).toBe(other)
  const before = buildClipRegistrationPlan(original, 'cell').timelines
  switchMode('sheet')
  act(() => result.current.handleBaseProcessChange(other))
  expect(result.current.baseProcessId).toBe(other)
  expect(result.current.activeCorrectionLayerId).toBe(other)
  expect(buildClipRegistrationPlan(result.current.projectDocumentSnapshot, 'cell').timelines).toEqual(before)
  act(() => result.current.handleUndo())
  expect(result.current.baseProcessId).toBe(base)
  expect(result.current.activeCorrectionLayerId).toBe(base)
  act(() => result.current.handleRedo())
  expect(result.current.baseProcessId).toBe(other)
  expect(result.current.activeCorrectionLayerId).toBe(other)
})

it('registers tree material in its own process even when the OS destination differs', () => {
  const { result, hit, switchMode } = setup()
  switchMode('clip')
  const source = result.current.project, process = source.correctionLayers[1].layerId
  const slot = source.cspTrackSlots.find(slot => slot.paperTrack === 'A' && slot.correctionLayerId === process)!
  const folder = source.clipDocument!.targets.find(target => target.slotId === slot.slotId)!.folderId
  act(() => result.current.commitProject(addClipLayers(source, [createClipNode('fix', 'raster', folder, 'fix') ])))
  act(() => result.current.handleAssignClipLayer('fix', hit()))
  expect(result.current.project.bindings.find(binding => binding.clipLayerId === 'fix')?.slotId).toBe(slot.slotId)
  expect(result.current.newImageProcessId).toBe(process)
  switchMode('sheet')
  act(() => result.current.handleUndo())
  expect(result.current.project.logicalSheet.events).toHaveLength(0)
  expect(result.current.project.clipDocument!.nodes.some(node => node.id === 'fix')).toBe(true)
})

it('restores each cut and revision with its own base instead of the first process', async () => {
  const { result, switchMode } = setup(), { document } = independentClipFixture()
  await act(async () => result.current.handleImportClip(document))
  const firstCut = result.current.projectDocumentSnapshot.activeCutId
  const firstRevision = result.current.activeSheetRevision.revisionId
  const other = result.current.project.correctionLayers.find(process => process.layerId !== result.current.baseProcessId)!.layerId
  switchMode('sheet')
  act(() => result.current.handleBaseProcessChange(other))
  act(() => result.current.handleAddSheetRevision({ name: '確認版', mode: 'duplicate', showSourceReference: false }))
  expect(result.current.activeCorrectionLayerId).toBe(other)
  expect(result.current.newImageProcessId).toBe(other)
  act(() => result.current.handleSwitchSheetRevision(firstRevision))
  act(() => result.current.handleSwitchProjectCut(result.current.projectDocumentSnapshot.cuts.find(cut => cut.cutId !== firstCut)!.cutId))
  expect(result.current.activeCorrectionLayerId).toBe(result.current.baseProcessId)
  act(() => result.current.handleSwitchProjectCut(firstCut))
  expect(result.current.activeCorrectionLayerId).toBe(other)
  switchMode('clip')
  expect(result.current.newImageProcessId).toBe(other)
})

it('chooses an OS destination for existing numbers, cancels without orphan assets and replaces in one Undo step', async () => {
  const { result, switchMode, drop } = setup()
  switchMode('clip')
  await drop('base.png')
  const base = result.current.project, baseProcess = base.correctionLayers[0].layerId, other = base.correctionLayers[1].layerId
  await drop('cancel.png')
  expect(result.current.pendingClipImageDrop).not.toBeNull()
  expect(result.current.project).toBe(base)
  act(() => result.current.setPendingClipImageDrop(null))
  expect(result.current.project.assets).toEqual(base.assets)
  await drop('correction.png')
  act(() => result.current.applyClipImageDrop(other, false))
  const corrected = result.current.project
  expect(corrected.logicalSheet).toBe(base.logicalSheet)
  expect(corrected.bindings).toHaveLength(2)
  expect(result.current.newImageProcessId).toBe(other)
  await drop('replacement.png')
  act(() => result.current.applyClipImageDrop(other, false))
  const replacement = result.current.project
  expect(replacement.logicalSheet).toBe(corrected.logicalSheet)
  expect(replacement.clipDocument!.nodes.filter(node => ['base', 'correction', 'replacement'].includes(node.name))).toHaveLength(3)
  expect(replacement.bindings.find(binding => binding.cspCellName === 'replacement')?.keyId).toBe(base.logicalSheet.keys[0].keyId)
  switchMode('sheet')
  act(() => result.current.handleUndo())
  expect(result.current.project).toEqual(corrected)
  act(() => result.current.handleRedo())
  expect(result.current.project).toEqual(replacement)
  switchMode('clip')
  act(() => result.current.handleNewImageProcessChange(baseProcess))
  await drop('next.png', 5)
  act(() => result.current.applyClipImageDrop(baseProcess, true))
  expect(result.current.project.logicalSheet.keys.map(key => key.displayLabel)).toEqual(['1', '2'])
  expect(result.current.project.logicalSheet.events.map(event => event.frame)).toEqual([1, 5])
})

it('rejects image completion after switching away and back, and keeps pending choices out of sheet editing', async () => {
  const { result, switchMode, drop } = setup()
  await drop('in-sheet.png')
  expect(result.current.project.assets).toHaveLength(0)
  switchMode('clip')
  let complete!: (value: string) => void
  vi.mocked(clipImageDataUrl).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  let pending!: Promise<void>
  act(() => { pending = result.current.handleClipImageFiles([image('late.png')], null) })
  await waitFor(() => expect(complete).toBeTypeOf('function'))
  switchMode('sheet'); switchMode('clip')
  await act(async () => { complete(pixels); await pending })
  expect(result.current.project.assets).toHaveLength(0)
  expect(result.current.history.past).toHaveLength(0)
  await drop('first.png'); await drop('cancel-choice.png')
  expect(result.current.pendingClipImageDrop).not.toBeNull()
  switchMode('sheet'); switchMode('clip')
  expect(result.current.pendingClipImageDrop).toBeNull()
  expect(result.current.project.assets).toHaveLength(1)
})

it('keeps imported independent timings and native hierarchy in both modes, after ownership drops, serialization and Undo', async () => {
  const { result, switchMode } = setup()
  const { document } = independentClipFixture()
  await act(async () => result.current.handleImportClip(document))
  expect(result.current.workMode).toBe('clip')
  const imported = result.current.project, first = imported.cspTrackSlots.find(slot => slot.slotId === imported.clipDocument!.targets.find(target => target.folderId === 'a0')!.slotId)!.correctionLayerId!
  const other = imported.cspTrackSlots.find(slot => slot.slotId === imported.clipDocument!.targets.find(target => target.folderId === 'a1')!.slotId)!.correctionLayerId!
  act(() => result.current.handleActiveCorrectionLayerChange(other))
  act(() => result.current.handleNewImageProcessChange(other))
  const before = result.current.projectDocumentSnapshot
  switchMode('sheet'); switchMode('clip')
  expect(result.current.projectDocumentSnapshot).toEqual(before)
  const hit = { ...timingHitForFrame(result.current.template, 'cell', 'A', 13)!, paperTrack: '01', frame: 13, role: 'cell' as const }
  act(() => result.current.handleAssignClipLayer('cel0', hit))
  expect(result.current.activeCorrectionLayerId).toBe(first)
  expect(result.current.newImageProcessId).toBe(first)
  expect(timingForProcess(result.current.project.logicalSheet, other).events).toEqual(timingForProcess(imported.logicalSheet, other).events)
  expect(result.current.project.clipDocument).toEqual(imported.clipDocument)
  const saved = result.current.projectDocumentSnapshot
  expect(buildClipRegistrationPlan(parseProjectDocument(JSON.parse(JSON.stringify(saved))), 'cell').timelines).toEqual(buildClipRegistrationPlan(saved, 'cell').timelines)
  switchMode('sheet')
  act(() => result.current.handleUndo())
  expect(result.current.activeCorrectionLayerId).toBe(result.current.baseProcessId)
  expect(timingForProcess(result.current.project.logicalSheet, first).events).toEqual(timingForProcess(imported.logicalSheet, first).events)
  act(() => result.current.handleRedo())
  expect(result.current.projectDocumentSnapshot).toEqual(saved)
})

it('respects protection enabled while an image is still decoding', async () => {
  const { result, switchMode } = setup()
  switchMode('clip')
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
  let complete!: (value: string) => void
  vi.mocked(clipImageDataUrl).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  let pending!: Promise<void>
  act(() => { pending = result.current.handleClipImageFiles([image('protected.png')], null) })
  await waitFor(() => expect(complete).toBeTypeOf('function'))
  act(() => result.current.handleToggleSheetRevisionProtected(result.current.activeSheetRevision.revisionId, true))
  await act(async () => { complete(pixels); await pending })
  expect(result.current.project.assets).toHaveLength(0)
  expect(result.current.history.past).toHaveLength(0)
  expect(result.current.activeSheetRevision.protected).toBe(true)
  expect(alert).toHaveBeenCalledWith(expect.stringContaining('編集保護中'))
})

it('preserves typed sheet labels and rejects wrong-column tree drops without changing the document', () => {
  const { result, hit, switchMode } = setup()
  const created = createKey(result.current.project, 'A', '7', 'manual', '7', 'cell')
  act(() => result.current.commitProject(setEvent(created.project, 'A', 1, created.key.keyId, 'cell')))
  switchMode('clip')
  const source = result.current.project, folder = source.clipDocument!.targets.find(target => target.slotId === 'slot_B')!.folderId
  act(() => result.current.commitProject(addClipLayers(source, [createClipNode('wrong-column', 'raster', folder, 'wrong')])))
  const before = result.current.projectDocumentSnapshot
  act(() => result.current.handleAssignClipLayer('wrong', hit()))
  expect(result.current.projectDocumentSnapshot).toEqual(before)
  expect(result.current.statusHintText).toContain('セル列「B」')
})
