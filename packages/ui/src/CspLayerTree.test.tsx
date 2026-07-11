import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createDefaultProject, createOrSetEvent, createStackGuideLabel, upsertBinding } from '@xsheet-remap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CspLayerTree } from './CspLayerTree'
import { ASSET_DRAG_MIME, ASSET_MULTI_DRAG_MIME, REGISTERED_CELL_DRAG_MIME } from './sheetConstants'

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

    const dragData: Record<string, string> = {}
    const registeredCell = document.querySelector<HTMLElement>('.cspTreeCel')
    if (!registeredCell) throw new Error('CSP cell card not found')
    fireEvent.dragStart(registeredCell, {
      dataTransfer: {
        effectAllowed: 'none',
        setData: (type: string, value: string) => { dragData[type] = value },
      },
    })
    expect(dragData[REGISTERED_CELL_DRAG_MIME]).toBe(second.key.keyId)

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
    const dataTransfer = {
      types: [REGISTERED_CELL_DRAG_MIME],
      dropEffect: 'none',
      getData: vi.fn((type: string) => type === REGISTERED_CELL_DRAG_MIME ? created.key.keyId : ''),
    }
    fireEvent.dragOver(track, { dataTransfer })
    fireEvent.drop(track, { dataTransfer })
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
    const dataTransfer = {
      types: [ASSET_DRAG_MIME],
      dropEffect: 'none',
      getData: vi.fn((type: string) => type === ASSET_DRAG_MIME ? 'asset_bg' : ''),
    }
    fireEvent.dragOver(track, { dataTransfer })
    expect(track.classList.contains('assetDragOver')).toBe(true)
    fireEvent.drop(track, { dataTransfer })

    expect(onAssignAssetsToStackGuideLabel).toHaveBeenCalledWith(
      created.label.labelId,
      ['asset_bg'],
      'layer_enshutsu',
    )
    expect(track.classList.contains('assetDragOver')).toBe(false)
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
    const dataTransfer = multiAssetDataTransfer(['asset_A1', 'asset_A2'])
    fireEvent.dragOver(track, { dataTransfer })
    expect(track.classList.contains('assetDragOver')).toBe(true)
    fireEvent.drop(track, { dataTransfer })

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
    const dataTransfer = multiAssetDataTransfer(['asset_A1', 'asset_A2'])
    fireEvent.dragOver(gap, { dataTransfer })
    expect(gap.classList.contains('assetDragOver')).toBe(true)
    fireEvent.drop(gap, { dataTransfer })

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

function multiAssetDataTransfer(assetIds: string[]) {
  return {
    types: [ASSET_MULTI_DRAG_MIME],
    dropEffect: 'none',
    getData: vi.fn((type: string) => type === ASSET_MULTI_DRAG_MIME ? JSON.stringify(assetIds) : ''),
  }
}
