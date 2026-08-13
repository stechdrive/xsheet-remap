import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { assignAssetToStackGuideLabel, createDefaultProject, createOrSetEvent, createStackGuideLabel, upsertBinding } from '@xsheet-remap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CspLayerTree } from './CspLayerTree'
import { dispatchInternalDrag, subscribeInternalDrag, type InternalDragPayload } from './internalDrag'

afterEach(() => {
  window.dispatchEvent(new Event('blur'))
  cleanup()
  vi.useRealTimers()
})

describe('CspLayerTree', () => {
  it('adds a material-unassigned card from a process track with a normalized name proposal', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const project = upsertBinding(created.project, {
      slotId: 'slot_enshutsu_A',
      keyId: created.key.keyId,
      cspCellName: 'A_01_e',
      materialState: 'missing-ok',
    })
    const onCreateUnplacedCard = vi.fn(() => 'key_unplaced')
    const onSelectKey = vi.fn()

    render(
      <CspLayerTree
        project={project}
        exportProfileId="import-stack"
        selectedKeyId={null}
        onSelectKey={onSelectKey}
        onDeleteKey={vi.fn()}
        activeCorrectionLayerId="layer_enshutsu"
        onActiveCorrectionLayerChange={vi.fn()}
        onUpdateCspCellName={vi.fn()}
        onMoveKeyBindingProcess={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onUpdateStackGuideLabel={vi.fn()}
        onDeleteStackGuideLabel={vi.fn()}
        onRenamePaperTrack={vi.fn()}
        onReorderStackItem={vi.fn()}
        onReorderProductionStage={vi.fn()}
        onReorderCorrectionLayer={vi.fn()}
        onDeleteCorrectionLayer={vi.fn()}
        onDeleteOverlayPaperTrack={vi.fn()}
        onAssignAsset={vi.fn()}
        onAssignAssetsToStackGuideLabel={vi.fn()}
        onRegisterAssetsToTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterAssetsToNewTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onCreateUnplacedCard={onCreateUnplacedCard}
        onRegisterKeyToTrack={vi.fn(() => true)}
        onOpenNameNormalization={vi.fn()}
        onCreateDefaultOverlayPaperTrack={vi.fn()}
        onCreateDefaultStackGuideLabel={vi.fn()}
        onCreateStackGuideLabel={vi.fn()}
      />,
    )

    const trackRow = screen.getByLabelText('A（演出）にカードを追加').closest<HTMLElement>('.cspTreeTrack')
      ?.querySelector<HTMLElement>('.cspTreeTrackRow')
    if (!trackRow) throw new Error('A track row not found')
    fireEvent.click(trackRow)
    fireEvent.click(screen.getByLabelText('CSPレイヤー項目を追加'))
    fireEvent.click(screen.getByRole('button', { name: '登録セル' }))
    const input = screen.getByLabelText('A（演出）に追加するCSPセル名')
    expect((input as HTMLInputElement).value).toBe('A_02_e')
    fireEvent.change(input, { target: { value: 'A_missing_e' } })
    fireEvent.click(screen.getByRole('button', { name: 'セルを追加' }))

    expect(onCreateUnplacedCard).toHaveBeenCalledWith('slot_enshutsu_A', 'A_missing_e')
    expect(onSelectKey).toHaveBeenCalledWith('key_unplaced')
  })

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
    const onSelectKey = vi.fn()

    render(
      <CspLayerTree
        project={project}
        exportProfileId="import-stack"
        selectedKeyId={null}
        onSelectKey={onSelectKey}
        onDeleteKey={vi.fn()}
        activeCorrectionLayerId="layer_sakuga"
        onActiveCorrectionLayerChange={vi.fn()}
        onUpdateCspCellName={vi.fn()}
        onMoveKeyBindingProcess={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onUpdateStackGuideLabel={vi.fn()}
        onDeleteStackGuideLabel={vi.fn()}
        onRenamePaperTrack={onRenamePaperTrack}
        onReorderStackItem={vi.fn()}
        onReorderProductionStage={vi.fn()}
        onReorderCorrectionLayer={vi.fn()}
        onDeleteCorrectionLayer={vi.fn()}
        onDeleteOverlayPaperTrack={vi.fn()}
        onAssignAsset={vi.fn()}
        onAssignAssetsToStackGuideLabel={vi.fn()}
        onRegisterAssetsToTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterAssetsToNewTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterKeyToTrack={vi.fn(() => true)}
        onOpenNameNormalization={vi.fn()}
        onCreateDefaultOverlayPaperTrack={vi.fn()}
        onCreateDefaultStackGuideLabel={vi.fn()}
        onCreateStackGuideLabel={vi.fn()}
      />,
    )

    expect(Array.from(document.querySelectorAll<HTMLElement>('.cspTreeCelName')).map(item => item.textContent))
      .toEqual(['A2', 'A1'])
    expect(document.querySelector('.cspTreeCelNameInput')).toBeNull()
    expect(screen.queryByText('パレット表示順')).toBeNull()
    expect(screen.queryByText('CSPパレット上端')).toBeNull()
    expect(document.querySelector('.cspTreeTrackOrder')).toBeNull()

    const registeredCell = document.querySelector<HTMLElement>('.cspTreeCel')
    if (!registeredCell) throw new Error('CSP cell card not found')
    const droppedPayloads: InternalDragPayload[] = []
    const unsubscribe = subscribeInternalDrag(detail => {
      if (detail.phase === 'drop') droppedPayloads.push(detail.payload)
    })
    const registeredCellName = registeredCell.querySelector<HTMLElement>('.cspTreeCelName')
    if (!registeredCellName) throw new Error('CSP cell name not found')
    fireEvent.pointerDown(registeredCellName, { pointerId: 10, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { pointerId: 10, pointerType: 'mouse', buttons: 1, clientX: 13, clientY: 10 })
    expect(document.querySelector('.internalDragPreviewShell.pointerDragGhost')).toBeNull()
    fireEvent.pointerMove(window, { pointerId: 10, pointerType: 'mouse', buttons: 1, clientX: 20, clientY: 10 })
    expect(document.querySelector('.internalDragPreview')?.textContent).toBe(`${registeredCellName.textContent}作画`)
    fireEvent.pointerUp(window, { pointerId: 10, pointerType: 'mouse', button: 0, clientX: 30, clientY: 10 })
    fireEvent.click(registeredCellName)
    unsubscribe()
    expect(droppedPayloads).toEqual([{ kind: 'registered-cell', keyId: second.key.keyId, sourceSlotId: 'slot_A' }])
    expect(onSelectKey).toHaveBeenCalledWith(second.key.keyId)

    const trackLabel = document.querySelector<HTMLElement>('.cspTreeTrackName')
    if (!trackLabel) throw new Error('track label not found')
    fireEvent.doubleClick(trackLabel)
    const trackName = screen.getByLabelText('Aのセル列名')
    fireEvent.change(trackName, { target: { value: 'LO' } })
    fireEvent.keyDown(trackName, { key: 'Enter' })
    expect(onRenamePaperTrack).toHaveBeenCalledWith('A', 'LO')

    fireEvent.doubleClick(document.querySelector<HTMLElement>('.cspTreeTrackName')!)
    const cancelledTrackName = screen.getByLabelText('Aのセル列名')
    fireEvent.change(cancelledTrackName, { target: { value: 'CANCELLED' } })
    fireEvent.keyDown(cancelledTrackName, { key: 'Escape' })
    fireEvent.blur(cancelledTrackName)
    expect(onRenamePaperTrack).toHaveBeenCalledTimes(1)
  })

  it('renames stage, process, and CSP cell labels only after an explicit edit gesture', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const project = upsertBinding(created.project, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      cspCellName: 'A1',
      materialState: 'unassigned',
    })
    const onRenameProductionStage = vi.fn()
    const onRenameCorrectionLayer = vi.fn()
    const onUpdateCspCellName = vi.fn()
    const onSelectKey = vi.fn()
    const onActiveCorrectionLayerChange = vi.fn()

    render(
      <CspLayerTree
        project={project}
        exportProfileId="import-stack"
        selectedKeyId={created.key.keyId}
        onSelectKey={onSelectKey}
        onDeleteKey={vi.fn()}
        activeCorrectionLayerId="layer_sakuga"
        onActiveCorrectionLayerChange={onActiveCorrectionLayerChange}
        onUpdateCspCellName={onUpdateCspCellName}
        onMoveKeyBindingProcess={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onUpdateStackGuideLabel={vi.fn()}
        onDeleteStackGuideLabel={vi.fn()}
        onRenameProductionStage={onRenameProductionStage}
        onRenameCorrectionLayer={onRenameCorrectionLayer}
        onRenamePaperTrack={vi.fn()}
        onReorderStackItem={vi.fn()}
        onReorderProductionStage={vi.fn()}
        onReorderCorrectionLayer={vi.fn()}
        onDeleteCorrectionLayer={vi.fn()}
        onDeleteOverlayPaperTrack={vi.fn()}
        onAssignAsset={vi.fn()}
        onAssignAssetsToStackGuideLabel={vi.fn()}
        onRegisterAssetsToTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterAssetsToNewTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterKeyToTrack={vi.fn(() => true)}
        onOpenNameNormalization={vi.fn()}
        onCreateDefaultOverlayPaperTrack={vi.fn()}
        onCreateDefaultStackGuideLabel={vi.fn()}
        onCreateStackGuideLabel={vi.fn()}
      />,
    )

    const stageLabel = screen.getByText('LO', { selector: '.cspTreeSummaryLabel' })
    const stageDetails = stageLabel.closest('details')
    expect(stageDetails?.open).toBe(true)
    fireEvent.click(stageLabel)
    expect(stageDetails?.open).toBe(true)
    fireEvent.doubleClick(stageLabel)
    const stageInput = screen.getByLabelText('LOの制作段階名')
    expect(stageInput.closest('summary')).toBeNull()
    expect(stageInput.parentElement?.classList.contains('cspTreeSummaryEditor')).toBe(true)
    expect(stageLabel.classList.contains('isRenameActive')).toBe(true)
    expect(stageLabel.textContent).toBe('LO')
    fireEvent.change(stageInput, { target: { value: '原画' } })
    fireEvent.keyDown(stageInput, { key: 'Enter' })
    expect(onRenameProductionStage).toHaveBeenCalledWith('stage_lo', '原画')

    const processLabel = screen.getByText('作画', { selector: '.cspTreeSummaryLabel' })
    expect(screen.getByLabelText('現在の登録先: 作画')).toBeTruthy()
    expect(processLabel.closest('summary')?.classList.contains('cspRegistrationTarget')).toBe(true)
    const processDetails = processLabel.closest('details')
    expect(processDetails?.open).toBe(true)
    fireEvent.click(processLabel)
    expect(processDetails?.open).toBe(true)
    fireEvent.doubleClick(processLabel)
    const processInput = screen.getByLabelText('作画の工程名')
    expect(processInput.closest('summary')).toBeNull()
    expect(processInput.parentElement?.classList.contains('cspTreeSummaryEditor')).toBe(true)
    expect(processLabel.classList.contains('isRenameActive')).toBe(true)
    expect(processLabel.textContent).toBe('作画')
    fireEvent.change(processInput, { target: { value: '第一原画' } })
    const directorLabel = screen.getByText('監督', { selector: '.cspTreeSummaryLabel' })
    const directorDetails = directorLabel.closest('details')
    const directorSummary = directorDetails?.querySelector('summary')
    if (!directorSummary) throw new Error('director summary not found')
    expect(directorDetails?.open).toBe(true)
    fireEvent.pointerDown(directorSummary)
    fireEvent.click(directorSummary)
    expect(onActiveCorrectionLayerChange).toHaveBeenCalledWith('layer_kantoku')
    expect(onRenameCorrectionLayer).toHaveBeenCalledWith('layer_sakuga', '第一原画')
    expect(screen.queryByLabelText('作画の工程名')).toBeNull()
    expect(directorDetails?.open).toBe(true)

    const cellLabel = screen.getByText('A1', { selector: '.cspTreeCelName' })
    onSelectKey.mockClear()
    vi.useFakeTimers()
    fireEvent.click(cellLabel)
    fireEvent.click(cellLabel)
    fireEvent.doubleClick(cellLabel)
    act(() => vi.advanceTimersByTime(300))
    expect(onSelectKey).not.toHaveBeenCalled()
    expect(document.querySelector('.internalDragPreviewShell.pointerDragGhost')).toBeNull()
    vi.useRealTimers()
    const cellInput = screen.getByLabelText('AのCSPセル名')
    fireEvent.change(cellInput, { target: { value: 'A1_custom' } })
    fireEvent.keyDown(cellInput, { key: 'Enter' })
    expect(onUpdateCspCellName).toHaveBeenCalledWith(created.key.keyId, 'slot_A', 'A1_custom')

    const card = document.querySelector<HTMLElement>('.cspTreeCel[data-csp-key-id]')
    if (!card) throw new Error('CSP cell card not found')
    fireEvent.click(card)
    expect(onSelectKey).toHaveBeenCalledWith(created.key.keyId)
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
        onDeleteKey={vi.fn()}
        activeCorrectionLayerId="layer_sakuga"
        onActiveCorrectionLayerChange={vi.fn()}
        onUpdateCspCellName={vi.fn()}
        onMoveKeyBindingProcess={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onUpdateStackGuideLabel={vi.fn()}
        onDeleteStackGuideLabel={vi.fn()}
        onRenamePaperTrack={vi.fn()}
        onReorderStackItem={vi.fn()}
        onReorderProductionStage={vi.fn()}
        onReorderCorrectionLayer={vi.fn()}
        onDeleteCorrectionLayer={vi.fn()}
        onDeleteOverlayPaperTrack={vi.fn()}
        onAssignAsset={vi.fn()}
        onAssignAssetsToStackGuideLabel={vi.fn()}
        onRegisterAssetsToTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterAssetsToNewTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterKeyToTrack={onRegisterKeyToTrack}
        onOpenNameNormalization={onOpenNameNormalization}
        onCreateDefaultOverlayPaperTrack={vi.fn()}
        onCreateDefaultStackGuideLabel={vi.fn()}
        onCreateStackGuideLabel={vi.fn()}
      />,
    )

    const unregisteredCard = document.querySelector<HTMLElement>('.cspTreeCel.unregistered')
    if (!unregisteredCard) throw new Error('unregistered CSP card not found')
    expect(screen.getByText('未登録')).toBeTruthy()
    expect(unregisteredCard.querySelector('.cspTreeCelName')?.textContent).toBe('A1')
    expect(unregisteredCard.querySelector('.cspTreeSheetLabel')?.textContent).toBe('シート: 1')
    expect(unregisteredCard.querySelector('.cspTreeCelFrame')).toBeNull()

    const track = screen.getByLabelText('A（作画）にカードを追加')
    dropInternalOn(track, { kind: 'registered-cell', keyId: created.key.keyId })
    expect(onRegisterKeyToTrack).toHaveBeenCalledWith(created.key.keyId, 'slot_A')

    fireEvent.click(screen.getByRole('button', { name: '一括リネーム' }))
    expect(onOpenNameNormalization).toHaveBeenCalledTimes(1)
  })

  it('creates pane additions at semantic defaults and keeps auxiliary tracks on the selected layer', () => {
    const onCreateDefaultOverlayPaperTrack = vi.fn()
    const onCreateDefaultStackGuideLabel = vi.fn()
    const onCreateStackGuideLabel = vi.fn()

    render(
      <CspLayerTree
        project={createDefaultProject()}
        exportProfileId="import-stack"
        selectedKeyId={null}
        onSelectKey={vi.fn()}
        onDeleteKey={vi.fn()}
        activeCorrectionLayerId="layer_sakuga"
        onActiveCorrectionLayerChange={vi.fn()}
        onUpdateCspCellName={vi.fn()}
        onMoveKeyBindingProcess={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onUpdateStackGuideLabel={vi.fn()}
        onDeleteStackGuideLabel={vi.fn()}
        onRenamePaperTrack={vi.fn()}
        onReorderStackItem={vi.fn()}
        onReorderProductionStage={vi.fn()}
        onReorderCorrectionLayer={vi.fn()}
        onDeleteCorrectionLayer={vi.fn()}
        onDeleteOverlayPaperTrack={vi.fn()}
        onAssignAsset={vi.fn()}
        onAssignAssetsToStackGuideLabel={vi.fn()}
        onRegisterAssetsToTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterAssetsToNewTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterKeyToTrack={vi.fn(() => true)}
        onOpenNameNormalization={vi.fn()}
        onCreateDefaultOverlayPaperTrack={onCreateDefaultOverlayPaperTrack}
        onCreateDefaultStackGuideLabel={onCreateDefaultStackGuideLabel}
        onCreateStackGuideLabel={onCreateStackGuideLabel}
      />,
    )

    fireEvent.click(screen.getByLabelText('CSPレイヤー項目を追加'))
    fireEvent.click(screen.getByRole('button', { name: '追加セル列' }))
    const overlayName = screen.getByRole('textbox', { name: '追加セル列名' })
    expect((overlayName as HTMLInputElement).value).toBe('J')
    fireEvent.change(overlayName, { target: { value: 'CUSTOM_CELL' } })
    fireEvent.click(screen.getByRole('button', { name: '追加セル列を作成' }))
    expect(onCreateDefaultOverlayPaperTrack).toHaveBeenCalledWith({ paperTrack: 'CUSTOM_CELL' })

    fireEvent.click(screen.getByLabelText('CSPレイヤー項目を追加'))
    fireEvent.click(screen.getByRole('button', { name: 'BG／BOOK' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'BG／BOOK名' }), { target: { value: 'BOOK_DEFAULT' } })
    fireEvent.click(screen.getByRole('button', { name: 'BG／BOOKを作成' }))
    expect(onCreateDefaultStackGuideLabel).toHaveBeenCalledWith({
      label: 'BOOK_DEFAULT',
      correctionLayerId: 'layer_sakuga',
    })

    fireEvent.click(screen.getByLabelText('CSPレイヤー項目を追加'))
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

  it('shows the selected card in one row with a read-only sheet label, asset state, and delete action', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const project = upsertBinding({
      ...created.project,
      assets: [{
        assetId: 'asset_a1',
        binId: 'asset_bin_root',
        originalFileName: 'A1.png',
        displayName: 'A1 reference.png',
        role: 'cell-material',
        source: { kind: 'unresolved' },
      }],
    }, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      cspCellName: 'A1',
      assetId: 'asset_a1',
      materialState: 'assigned',
    })
    const onDeleteKey = vi.fn()
    const onAssignAsset = vi.fn()

    render(
      <CspLayerTree
        project={project}
        exportProfileId="import-stack"
        selectedKeyId={created.key.keyId}
        onSelectKey={vi.fn()}
        onDeleteKey={onDeleteKey}
        activeCorrectionLayerId="layer_sakuga"
        onActiveCorrectionLayerChange={vi.fn()}
        onUpdateCspCellName={vi.fn()}
        onMoveKeyBindingProcess={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onUpdateStackGuideLabel={vi.fn()}
        onDeleteStackGuideLabel={vi.fn()}
        onRenamePaperTrack={vi.fn()}
        onReorderStackItem={vi.fn()}
        onReorderProductionStage={vi.fn()}
        onReorderCorrectionLayer={vi.fn()}
        onDeleteCorrectionLayer={vi.fn()}
        onDeleteOverlayPaperTrack={vi.fn()}
        onAssignAsset={onAssignAsset}
        onAssignAssetsToStackGuideLabel={vi.fn()}
        onRegisterAssetsToTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterAssetsToNewTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterKeyToTrack={vi.fn(() => true)}
        onOpenNameNormalization={vi.fn()}
        onCreateDefaultOverlayPaperTrack={vi.fn()}
        onCreateDefaultStackGuideLabel={vi.fn()}
        onCreateStackGuideLabel={vi.fn()}
      />,
    )

    const card = document.querySelector<HTMLElement>('.cspTreeCel[data-csp-key-id]')
    if (!card) throw new Error('CSP cell card not found')
    expect(card.querySelector('[role="textbox"]')).toBeNull()
    expect(card.querySelector('.cspTreeSheetLabel')?.textContent).toBe('シート: 1')
    expect(card.querySelector('.cspTreeAssetState')?.getAttribute('aria-label')).toBe('素材: A1 reference.png')
    expect(card.querySelector('[title]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'A1を削除' }))
    expect(onDeleteKey).toHaveBeenCalledWith(created.key.keyId, project.bindings[0]?.bindingId)

    moveInternalOver(card, { kind: 'asset', assetIds: ['asset_replacement'] })
    expect(card.classList.contains('assetDragOver')).toBe(true)
    expect(card.textContent).toContain('A1の素材を差し替え')
    dropInternalOn(card, { kind: 'asset', assetIds: ['asset_replacement'] })
    expect(onAssignAsset).toHaveBeenCalledWith('asset_replacement', created.key.keyId, 'slot_A')

    moveInternalOver(card, { kind: 'asset', assetIds: ['asset_1', 'asset_2'] })
    expect(card.classList.contains('assetDropInvalid')).toBe(true)
    expect(card.textContent).toContain('複数素材は「A列にカードを追加」へ')
    dropInternalOn(card, { kind: 'asset', assetIds: ['asset_1', 'asset_2'] })
    expect(onAssignAsset).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toBe('複数素材はセル列の「カードを追加」へドロップしてください。')
  })

  it('moves a registered card between correction layers through the shared drag contract', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const project = upsertBinding(created.project, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      cspCellName: 'A1',
      materialState: 'missing-ok',
    })
    const onMoveKeyBindingProcess = vi.fn()

    render(
      <CspLayerTree
        project={project}
        exportProfileId="import-stack"
        selectedKeyId={null}
        onSelectKey={vi.fn()}
        onDeleteKey={vi.fn()}
        activeCorrectionLayerId="layer_sakuga"
        onActiveCorrectionLayerChange={vi.fn()}
        onUpdateCspCellName={vi.fn()}
        onMoveKeyBindingProcess={onMoveKeyBindingProcess}
        onUpdateStackGuideRegistration={vi.fn()}
        onUpdateStackGuideLabel={vi.fn()}
        onDeleteStackGuideLabel={vi.fn()}
        onRenamePaperTrack={vi.fn()}
        onReorderStackItem={vi.fn()}
        onReorderProductionStage={vi.fn()}
        onReorderCorrectionLayer={vi.fn()}
        onDeleteCorrectionLayer={vi.fn()}
        onDeleteOverlayPaperTrack={vi.fn()}
        onAssignAsset={vi.fn()}
        onAssignAssetsToStackGuideLabel={vi.fn()}
        onRegisterAssetsToTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterAssetsToNewTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterKeyToTrack={vi.fn(() => true)}
        onOpenNameNormalization={vi.fn()}
        onCreateDefaultOverlayPaperTrack={vi.fn()}
        onCreateDefaultStackGuideLabel={vi.fn()}
        onCreateStackGuideLabel={vi.fn()}
      />,
    )

    const target = screen.getByText('演出')
    dropInternalOn(target, { kind: 'registered-cell', keyId: created.key.keyId, sourceSlotId: 'slot_A' })
    expect(onMoveKeyBindingProcess).toHaveBeenCalledWith(created.key.keyId, 'slot_A', 'layer_enshutsu')
  })

  it('assigns an image asset dropped on a BG or BOOK track to its correction layer', () => {
    const created = createStackGuideLabel(createDefaultProject(), {
      label: 'BG1',
      kind: 'background',
      gapIndex: 0,
      correctionLayerId: 'layer_enshutsu',
    })
    const onAssignAssetsToStackGuideLabel = vi.fn()
    const onSelectStackGuideLabel = vi.fn()

    render(
      <CspLayerTree
        project={created.project}
        exportProfileId="import-stack"
        selectedKeyId={null}
        onSelectKey={vi.fn()}
        onSelectStackGuideLabel={onSelectStackGuideLabel}
        onDeleteKey={vi.fn()}
        activeCorrectionLayerId="layer_sakuga"
        onActiveCorrectionLayerChange={vi.fn()}
        onUpdateCspCellName={vi.fn()}
        onMoveKeyBindingProcess={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onUpdateStackGuideLabel={vi.fn()}
        onDeleteStackGuideLabel={vi.fn()}
        onRenamePaperTrack={vi.fn()}
        onReorderStackItem={vi.fn()}
        onReorderProductionStage={vi.fn()}
        onReorderCorrectionLayer={vi.fn()}
        onDeleteCorrectionLayer={vi.fn()}
        onDeleteOverlayPaperTrack={vi.fn()}
        onAssignAsset={vi.fn()}
        onAssignAssetsToStackGuideLabel={onAssignAssetsToStackGuideLabel}
        onRegisterAssetsToTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterAssetsToNewTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterKeyToTrack={vi.fn(() => true)}
        onOpenNameNormalization={vi.fn()}
        onCreateDefaultOverlayPaperTrack={vi.fn()}
        onCreateDefaultStackGuideLabel={vi.fn()}
        onCreateStackGuideLabel={vi.fn()}
      />,
    )

    const track = screen.getByLabelText('BG1（演出）へ画像素材を割り当て')
    const card = track.closest('.cspTreeTrack')?.querySelector<HTMLElement>('.cspTreeCel')
    if (!card) throw new Error('BG1 card not found')
    fireEvent.click(card)
    expect(onSelectStackGuideLabel).toHaveBeenCalledWith(created.label.labelId)

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

  it('shows only the Clip Studio cel name on an assigned BG or BOOK card', () => {
    const projectWithAsset = {
      ...createDefaultProject(),
      assets: [{
        assetId: 'asset_bg',
        binId: 'asset_bin_root',
        originalFileName: 'K000042.png',
        displayName: 'K000042.png',
        role: 'cell-material' as const,
        source: { kind: 'unresolved' as const },
      }],
    }
    const created = createStackGuideLabel(projectWithAsset, {
      label: 'BG1',
      kind: 'background',
      gapIndex: 0,
      correctionLayerId: 'layer_enshutsu',
      cspCellName: '_BG1',
    })
    const project = assignAssetToStackGuideLabel(created.project, created.label.labelId, 'asset_bg', 'layer_enshutsu')

    render(
      <CspLayerTree
        project={project}
        exportProfileId="import-stack"
        selectedKeyId={null}
        onSelectKey={vi.fn()}
        onDeleteKey={vi.fn()}
        activeCorrectionLayerId="layer_sakuga"
        onActiveCorrectionLayerChange={vi.fn()}
        onUpdateCspCellName={vi.fn()}
        onMoveKeyBindingProcess={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onUpdateStackGuideLabel={vi.fn()}
        onDeleteStackGuideLabel={vi.fn()}
        onRenamePaperTrack={vi.fn()}
        onReorderStackItem={vi.fn()}
        onReorderProductionStage={vi.fn()}
        onReorderCorrectionLayer={vi.fn()}
        onDeleteCorrectionLayer={vi.fn()}
        onDeleteOverlayPaperTrack={vi.fn()}
        onAssignAsset={vi.fn()}
        onAssignAssetsToStackGuideLabel={vi.fn()}
        onRegisterAssetsToTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterAssetsToNewTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterKeyToTrack={vi.fn(() => true)}
        onOpenNameNormalization={vi.fn()}
        onCreateDefaultOverlayPaperTrack={vi.fn()}
        onCreateDefaultStackGuideLabel={vi.fn()}
        onCreateStackGuideLabel={vi.fn()}
      />,
    )

    const track = screen.getByLabelText('BG1（演出）へ画像素材を割り当て')
    const card = track.closest('.cspTreeTrack')?.querySelector<HTMLElement>('.cspTreeCel')
    if (!card) throw new Error('assigned BG1 card not found')
    expect(card.querySelector('.cspTreeCelName')?.textContent).toBe('_BG1')
    expect(card.querySelector('.cspTreeSheetLabel')).toBeNull()
    expect(card.textContent).not.toContain('K000042.png')
    expect(card.querySelector('.cspTreeAssetState')?.getAttribute('aria-label')).toBe('素材: K000042.png')
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
        onDeleteKey={vi.fn()}
        activeCorrectionLayerId="layer_sakuga"
        onActiveCorrectionLayerChange={vi.fn()}
        onUpdateCspCellName={vi.fn()}
        onMoveKeyBindingProcess={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onUpdateStackGuideLabel={vi.fn()}
        onDeleteStackGuideLabel={vi.fn()}
        onRenamePaperTrack={vi.fn()}
        onReorderStackItem={vi.fn()}
        onReorderProductionStage={vi.fn()}
        onReorderCorrectionLayer={vi.fn()}
        onDeleteCorrectionLayer={vi.fn()}
        onDeleteOverlayPaperTrack={vi.fn()}
        onAssignAsset={vi.fn()}
        onAssignAssetsToStackGuideLabel={onAssignAssetsToStackGuideLabel}
        onRegisterAssetsToTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterAssetsToNewTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterKeyToTrack={vi.fn(() => true)}
        onOpenNameNormalization={vi.fn()}
        onCreateDefaultOverlayPaperTrack={vi.fn()}
        onCreateDefaultStackGuideLabel={vi.fn()}
        onCreateStackGuideLabel={vi.fn()}
      />,
    )

    dropInternalOn(screen.getByLabelText('SL1（作画）へ画像素材を割り当て'), { kind: 'asset', assetIds: ['asset_sl1'] })
    dropInternalOn(screen.getByLabelText('MEMO1（作画）へ画像素材を割り当て'), { kind: 'asset', assetIds: ['asset_memo1'] })
    expect(onAssignAssetsToStackGuideLabel).toHaveBeenNthCalledWith(1, camera.label.labelId, ['asset_sl1'], 'layer_sakuga')
    expect(onAssignAssetsToStackGuideLabel).toHaveBeenNthCalledWith(2, memo.label.labelId, ['asset_memo1'], 'layer_sakuga')

    dropInternalOn(screen.getByLabelText('SL1（作画）へ画像素材を割り当て'), { kind: 'asset', assetIds: ['asset_a', 'asset_b'] })
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
        onDeleteKey={vi.fn()}
        activeCorrectionLayerId="layer_sakuga"
        onActiveCorrectionLayerChange={vi.fn()}
        onUpdateCspCellName={vi.fn()}
        onMoveKeyBindingProcess={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onUpdateStackGuideLabel={vi.fn()}
        onDeleteStackGuideLabel={vi.fn()}
        onRenamePaperTrack={vi.fn()}
        onReorderStackItem={vi.fn()}
        onReorderProductionStage={vi.fn()}
        onReorderCorrectionLayer={vi.fn()}
        onDeleteCorrectionLayer={vi.fn()}
        onDeleteOverlayPaperTrack={vi.fn()}
        onAssignAsset={vi.fn()}
        onAssignAssetsToStackGuideLabel={vi.fn()}
        onRegisterAssetsToTrack={onRegisterAssetsToTrack}
        onRegisterAssetsToNewTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterKeyToTrack={vi.fn(() => true)}
        onOpenNameNormalization={vi.fn()}
        onCreateDefaultOverlayPaperTrack={vi.fn()}
        onCreateDefaultStackGuideLabel={vi.fn()}
        onCreateStackGuideLabel={vi.fn()}
      />,
    )

    const track = screen.getByLabelText('A（作画）にカードを追加')
    moveInternalOver(track, { kind: 'asset', assetIds: ['asset_A1', 'asset_A2'] })
    expect(track.classList.contains('assetDragOver')).toBe(true)
    expect(track.textContent).toBe('A列に2件のカードを追加')
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
        onDeleteKey={vi.fn()}
        activeCorrectionLayerId="layer_sakuga"
        onActiveCorrectionLayerChange={vi.fn()}
        onUpdateCspCellName={vi.fn()}
        onMoveKeyBindingProcess={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onUpdateStackGuideLabel={vi.fn()}
        onDeleteStackGuideLabel={vi.fn()}
        onRenamePaperTrack={vi.fn()}
        onReorderStackItem={vi.fn()}
        onReorderProductionStage={vi.fn()}
        onReorderCorrectionLayer={vi.fn()}
        onDeleteCorrectionLayer={vi.fn()}
        onDeleteOverlayPaperTrack={vi.fn()}
        onAssignAsset={vi.fn()}
        onAssignAssetsToStackGuideLabel={vi.fn()}
        onRegisterAssetsToTrack={vi.fn(() => ({ addedCount: 0, duplicateCount: 0, missingCount: 0 }))}
        onRegisterAssetsToNewTrack={onRegisterAssetsToNewTrack}
        onRegisterKeyToTrack={vi.fn(() => true)}
        onOpenNameNormalization={vi.fn()}
        onCreateDefaultOverlayPaperTrack={vi.fn()}
        onCreateDefaultStackGuideLabel={vi.fn()}
        onCreateStackGuideLabel={vi.fn()}
      />,
    )

    const gap = screen.getByLabelText('作画のセル列挿入位置1')
    moveInternalOver(gap, { kind: 'asset', assetIds: ['asset_A1', 'asset_A2'] })
    expect(gap.classList.contains('assetDragOver')).toBe(true)
    expect(gap.textContent).toContain('ここに新しいセル列を作成（2件）')
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
