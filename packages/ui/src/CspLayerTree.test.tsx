import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createDefaultProject, createOrSetEvent, upsertBinding } from '@xsheet-remap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CspLayerTree } from './CspLayerTree'

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
        onUpdateCspCellName={vi.fn()}
        onUpdateStackGuideRegistration={vi.fn()}
        onRenamePaperTrack={onRenamePaperTrack}
        onMoveStackItem={vi.fn()}
        onAssignAsset={vi.fn()}
      />,
    )

    expect(Array.from(document.querySelectorAll<HTMLInputElement>('.cspTreeCel input')).map(input => input.value))
      .toEqual(['A2', 'A1'])
    expect(screen.queryByText('パレット表示順')).toBeNull()
    expect(screen.queryByText('CSPパレット上端')).toBeNull()
    expect(document.querySelector('.cspTreeTrackOrder')).toBeNull()

    const trackName = screen.getByLabelText('Aのセル列名')
    fireEvent.change(trackName, { target: { value: 'LO' } })
    fireEvent.blur(trackName)
    expect(onRenamePaperTrack).toHaveBeenCalledWith('A', 'LO')
  })
})
