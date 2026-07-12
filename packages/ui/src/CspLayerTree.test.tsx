import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createDefaultProject, createOrSetEvent, createStackGuideLabel, upsertBinding } from '@xsheet-remap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CspLayerTree } from './CspLayerTree'
import { dispatchInternalDrag, subscribeInternalDrag, type InternalDragPayload } from './internalDrag'

afterEach(cleanup)

describe('CspLayerTree', () => {
  it('shows later first-use cels above earlier cels and commits paper-track names', () => {
    const first = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const second = createOrSetEvent(first.project, 'A', 8, 'action')
    let project = upsertBinding(second.project, {
      slotId: 'slot_A',
      keyId: first.key.keyId,
      cspCellName: 'A1',
      materialState: 'missing-ok',
    })
    project = upsertBinding(project, {
      slotId: 'slot_A',
      keyId: second.key.keyId,
      cspCellName: 'A2',
      materialState: 'missing-ok',
    })
    const onRenamePaperTrack = vi.fn()

    render(
      <CspLayerTree
        project={project}
        exportProfileId="import-stack"
        selectedKeyId={null}
        onSelectKey={vi.fn()}
        onJumpToFirstUse={vi.fn()}
        activeCorrectionLayerId="layer_sakuga"
        onUpdateCspCellName={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onRenamePaperTrack={onRenamePaperTrack}
        onMoveStackItem={vi.fn()}
        onAssignAsset={vi.fn()}
        onAssignAssetsToStackGuideLabel={vi.fn()}
        onRegisterAssetsToTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterAssetsToNewTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterKeyToTrack={vi.fn(() => true)}
        onOpenNameNormalization={vi.fn()}
        onRequestOverlayPaperTrack={vi.fn()}
        onRequestStackGuideInsert={vi.fn()}
        onCreateStackGuideLabel={vi.fn()}
      />,
    )

    expect(Array.from(document.querySelectorAll<HTMLInputElement>('.cspTreeCel input')).map(input => input.value))
      .toEqual(['A2', 'A1'])
    expect(screen.queryByText('パレット表示順')).toBeNull()
    expect(screen.queryByText('CSPパレット上端')).toBeNull()
    expect(document.querySelector('.cspTreeTrackOrder')).toBeNull()

    const registeredCell = document.querySelector<HTMLElement>('.cspTreeCel')
    if (!registeredCell) throw new Error('CSP cell card not found')
    const droppedPayloads: InternalDragPayload[] = []
    const unsubscribe = subscribeInternalDrag(detail => {
      if (detail.phase === 'drop') droppedPayloads.push(detail.payload)
    })
    fireEvent.pointerDown(registeredCell, { pointerId: 10, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { pointerId: 10, pointerType: 'mouse', buttons: 1, clientX: 20, clientY: 10 })
    fireEvent.pointerUp(window, { pointerId: 10, pointerType: 'mouse', button: 0, clientX: 30, clientY: 10 })
    unsubscribe()
    expect(droppedPayloads).toEqual([{ kind: 'registered-cell', keyId: second.key.keyId }])

    const trackName = screen.getByLabelText('Aのセル列名')
    fireEvent.change(trackName, { target: { value: 'LO' } })
    fireEvent.blur(trackName)
    expect(onRenamePaperTrack).toHaveBeenCalledWith('A', 'LO')
  })

  it('shows timeline-only keys as compact unregistered cards and registers them by track drop', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const onRegisterKeyToTrack = vi.fn(() => true)
    const onOpenNameNormalization = vi.fn()

    render(
      <CspLayerTree
        project={created.project}
        exportProfileId="import-stack"
        selectedKeyId={null}
        onSelectKey={vi.fn()}
        onJumpToFirstUse={vi.fn()}
        activeCorrectionLayerId="layer_sakuga"
        onUpdateCspCellName={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onRenamePaperTrack={vi.fn()}
        onMoveStackItem={vi.fn()}
        onAssignAsset={vi.fn()}
        onAssignAssetsToStackGuideLabel={vi.fn()}
        onRegisterAssetsToTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterAssetsToNewTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterKeyToTrack={onRegisterKeyToTrack}
        onOpenNameNormalization={onOpenNameNormalization}
        onRequestOverlayPaperTrack={vi.fn()}
        onRequestStackGuideInsert={vi.fn()}
        onCreateStackGuideLabel={vi.fn()}
      />,
    )

    const unregisteredCard = document.querySelector<HTMLElement>('.cspTreeCel.unregistered')
    if (!unregisteredCard) throw new Error('unregistered CSP card not found')
    expect(screen.getByText('未登録')).toBeTruthy()
    expect(unregisteredCard.querySelector('.cspTreeCelName')?.textContent).toBe('A1')
    expect(unregisteredCard.querySelector('.cspTreeSheetLabel')).toBeNull()
    expect(unregisteredCard.querySelector('.cspTreeCelFrame')).toBeNull()

    const track = screen.getByLabelText('A（作画）へ画像素材を登録')
    dropInternalOn(track, { kind: 'registered-cell', keyId: created.key.keyId })
    expect(onRegisterKeyToTrack).toHaveBeenCalledWith(created.key.keyId, 'slot_A')

    fireEvent.click(screen.getByRole('button', { name: '名前を正規化' }))
    expect(onOpenNameNormalization).toHaveBeenCalledTimes(1)
  })

  it('offers paper placement globally and auxiliary tracks on each correction layer', () => {
    const onRequestOverlayPaperTrack = vi.fn()
    const onRequestStackGuideInsert = vi.fn()
    const onCreateStackGuideLabel = vi.fn()

    render(
      <CspLayerTree
        project={createDefaultProject()}
        exportProfileId="import-stack"
        selectedKeyId={null}
        onSelectKey={vi.fn()}
        onJumpToFirstUse={vi.fn()}
        activeCorrectionLayerId="layer_sakuga"
        onUpdateCspCellName={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onRenamePaperTrack={vi.fn()}
        onMoveStackItem={vi.fn()}
        onAssignAsset={vi.fn()}
        onAssignAssetsToStackGuideLabel={vi.fn()}
        onRegisterAssetsToTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterAssetsToNewTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterKeyToTrack={vi.fn(() => true)}
        onOpenNameNormalization={vi.fn()}
        onRequestOverlayPaperTrack={onRequestOverlayPaperTrack}
        onRequestStackGuideInsert={onRequestStackGuideInsert}
        onCreateStackGuideLabel={onCreateStackGuideLabel}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'セル列を追加' }))
    expect(onRequestOverlayPaperTrack).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByLabelText('作画にトラックを追加'))
    fireEvent.click(screen.getByRole('button', { name: 'BG／BOOK' }))
    expect(onRequestStackGuideInsert).toHaveBeenCalledWith('layer_sakuga')

    fireEvent.click(screen.getByLabelText('作画にトラックを追加'))
    fireEvent.click(screen.getByRole('button', { name: '撮影指示' }))
    fireEvent.change(screen.getByRole('textbox', { name: '追加トラック名' }), { target: { value: 'PAN1' } })
    fireEvent.click(screen.getByRole('button', { name: '追加を確定' }))
    expect(onCreateStackGuideLabel).toHaveBeenCalledWith({
      label: 'PAN1',
      kind: 'camera-note',
      gapIndex: 9,
      correctionLayerId: 'layer_sakuga',
    })
  })

  it('assigns an image asset dropped on a BG or BOOK track to its correction layer', () => {
    const created = createStackGuideLabel(createDefaultProject(), {
      label: 'BG1',
      kind: 'background',
      gapIndex: 0,
      correctionLayerId: 'layer_enshutsu',
    })
    const onAssignAssetsToStackGuideLabel = vi.fn()

    render(
      <CspLayerTree
        project={created.project}
        exportProfileId="import-stack"
        selectedKeyId={null}
        onSelectKey={vi.fn()}
        onJumpToFirstUse={vi.fn()}
        activeCorrectionLayerId="layer_sakuga"
        onUpdateCspCellName={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onRenamePaperTrack={vi.fn()}
        onMoveStackItem={vi.fn()}
        onAssignAsset={vi.fn()}
        onAssignAssetsToStackGuideLabel={onAssignAssetsToStackGuideLabel}
        onRegisterAssetsToTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterAssetsToNewTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterKeyToTrack={vi.fn(() => true)}
        onOpenNameNormalization={vi.fn()}
        onRequestOverlayPaperTrack={vi.fn()}
        onRequestStackGuideInsert={vi.fn()}
        onCreateStackGuideLabel={vi.fn()}
      />,
    )

    const track = screen.getByLabelText('BG1（演出）へ画像素材を登録')
    moveInternalOver(track, { kind: 'asset', assetIds: ['asset_bg'] })
    expect(track.classList.contains('assetDragOver')).toBe(true)
    dropInternalOn(track, { kind: 'asset', assetIds: ['asset_bg'] })

    expect(onAssignAssetsToStackGuideLabel).toHaveBeenCalledWith(
      created.label.labelId,
      ['asset_bg'],
      'layer_enshutsu',
    )
    expect(track.classList.contains('assetDragOver')).toBe(false)
  })

  it('uses the same pointer drop contract for camera notes and memos and rejects multiple assets', () => {
    const camera = createStackGuideLabel(createDefaultProject(), {
      label: 'SL1',
      kind: 'camera-note',
      gapIndex: 9,
      correctionLayerId: 'layer_sakuga',
    })
    const memo = createStackGuideLabel(camera.project, {
      label: 'MEMO1',
      kind: 'memo',
      gapIndex: 9,
      correctionLayerId: 'layer_sakuga',
    })
    const onAssignAssetsToStackGuideLabel = vi.fn()
    render(
      <CspLayerTree
        project={memo.project}
        exportProfileId="import-stack"
        selectedKeyId={null}
        onSelectKey={vi.fn()}
        onJumpToFirstUse={vi.fn()}
        activeCorrectionLayerId="layer_sakuga"
        onUpdateCspCellName={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onRenamePaperTrack={vi.fn()}
        onMoveStackItem={vi.fn()}
        onAssignAsset={vi.fn()}
        onAssignAssetsToStackGuideLabel={onAssignAssetsToStackGuideLabel}
        onRegisterAssetsToTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterAssetsToNewTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterKeyToTrack={vi.fn(() => true)}
        onOpenNameNormalization={vi.fn()}
        onRequestOverlayPaperTrack={vi.fn()}
        onRequestStackGuideInsert={vi.fn()}
        onCreateStackGuideLabel={vi.fn()}
      />,
    )

    dropInternalOn(screen.getByLabelText('SL1（作画）へ画像素材を登録'), { kind: 'asset', assetIds: ['asset_sl1'] })
    dropInternalOn(screen.getByLabelText('MEMO1（作画）へ画像素材を登録'), { kind: 'asset', assetIds: ['asset_memo1'] })
    expect(onAssignAssetsToStackGuideLabel).toHaveBeenNthCalledWith(1, camera.label.labelId, ['asset_sl1'], 'layer_sakuga')
    expect(onAssignAssetsToStackGuideLabel).toHaveBeenNthCalledWith(2, memo.label.labelId, ['asset_memo1'], 'layer_sakuga')

    dropInternalOn(screen.getByLabelText('SL1（作画）へ画像素材を登録'), { kind: 'asset', assetIds: ['asset_a', 'asset_b'] })
    expect(onAssignAssetsToStackGuideLabel).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status').textContent).toContain('1件だけ選択')
  })

  it('registers a multi-selection on an existing paper track', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'cell')
    const project = upsertBinding(created.project, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      cspCellName: 'A1',
      materialState: 'unassigned',
    })
    const onRegisterAssetsToTrack = vi.fn(() => ({ addedCount: 2, duplicateCount: 0, missingCount: 0 }))

    render(
      <CspLayerTree
        project={project}
        exportProfileId="import-stack"
        selectedKeyId={null}
        onSelectKey={vi.fn()}
        onJumpToFirstUse={vi.fn()}
        activeCorrectionLayerId="layer_sakuga"
        onUpdateCspCellName={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onRenamePaperTrack={vi.fn()}
        onMoveStackItem={vi.fn()}
        onAssignAsset={vi.fn()}
        onAssignAssetsToStackGuideLabel={vi.fn()}
        onRegisterAssetsToTrack={onRegisterAssetsToTrack}
        onRegisterAssetsToNewTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterKeyToTrack={vi.fn(() => true)}
        onOpenNameNormalization={vi.fn()}
        onRequestOverlayPaperTrack={vi.fn()}
        onRequestStackGuideInsert={vi.fn()}
        onCreateStackGuideLabel={vi.fn()}
      />,
    )

    const track = screen.getByLabelText('A（作画）へ画像素材を登録')
    moveInternalOver(track, { kind: 'asset', assetIds: ['asset_A1', 'asset_A2'] })
    expect(track.classList.contains('assetDragOver')).toBe(true)
    dropInternalOn(track, { kind: 'asset', assetIds: ['asset_A1', 'asset_A2'] })

    expect(onRegisterAssetsToTrack).toHaveBeenCalledWith('slot_A', ['asset_A1', 'asset_A2'])
    expect(screen.getByRole('status').textContent).toBe('2件追加')
  })

  it('opens an inline track-name form when assets are dropped between tracks', () => {
    const onRegisterAssetsToNewTrack = vi.fn(() => ({ addedCount: 1, duplicateCount: 1, missingCount: 0 }))
    render(
      <CspLayerTree
        project={createDefaultProject()}
        exportProfileId="import-stack"
        selectedKeyId={null}
        onSelectKey={vi.fn()}
        onJumpToFirstUse={vi.fn()}
        activeCorrectionLayerId="layer_sakuga"
        onUpdateCspCellName={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onRenamePaperTrack={vi.fn()}
        onMoveStackItem={vi.fn()}
        onAssignAsset={vi.fn()}
        onAssignAssetsToStackGuideLabel={vi.fn()}
        onRegisterAssetsToTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterAssetsToNewTrack={onRegisterAssetsToNewTrack}
        onRegisterKeyToTrack={vi.fn(() => true)}
        onOpenNameNormalization={vi.fn()}
        onRequestOverlayPaperTrack={vi.fn()}
        onRequestStackGuideInsert={vi.fn()}
        onCreateStackGuideLabel={vi.fn()}
      />,
    )

    const gap = screen.getByLabelText('作画のセル列挿入位置1')
    moveInternalOver(gap, { kind: 'asset', assetIds: ['asset_A1', 'asset_A2'] })
    expect(gap.classList.contains('assetDragOver')).toBe(true)
    dropInternalOn(gap, { kind: 'asset', assetIds: ['asset_A1', 'asset_A2'] })

    const input = screen.getByLabelText('作画に追加するセル列名')
    expect((input as HTMLInputElement).value).toBe('A')
    fireEvent.change(input, { target: { value: 'LO' } })
    fireEvent.click(screen.getByRole('button', { name: 'セル列を作成して素材を登録' }))

    expect(onRegisterAssetsToNewTrack).toHaveBeenCalledWith({
      correctionLayerId: 'layer_sakuga',
      gapIndex: 0,
      assetIds: ['asset_A1', 'asset_A2'],
      paperTrack: 'LO',
      insertAfterPaperTrack: undefined,
    })
    expect(screen.getByRole('status').textContent).toBe('1件追加 / 1件は登録済み')
  })
})

function moveInternalOver(target: Element, payload: InternalDragPayload) {
  dispatchInternalOn(target, 'move', payload)
}

function dropInternalOn(target: Element, payload: InternalDragPayload) {
  dispatchInternalOn(target, 'drop', payload)
}

function dispatchInternalOn(target: Element, phase: 'move' | 'drop', payload: InternalDragPayload) {
  const original = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => target) })
  act(() => dispatchInternalDrag({ sessionId: 'test', phase, payload, clientX: 20, clientY: 20 }))
  if (original) Object.defineProperty(document, 'elementFromPoint', original)
  else Reflect.deleteProperty(document, 'elementFromPoint')
}
