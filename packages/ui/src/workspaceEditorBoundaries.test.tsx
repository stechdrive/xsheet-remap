import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaperTrackEditorPopover } from './stack-guides-paper-track'
import { TimelineLaneEditorPopover } from './TimelineLaneEditorPopover'

afterEach(cleanup)

describe('workspace floating editor boundaries', () => {
  it('cancels a paper-track editor on Escape without leaking the key', () => {
    const onCancel = vi.fn()
    const escapedToWorkspace = vi.fn()
    render(
      <PaperTrackEditorPopover
        state={{ x: 20, y: 30, mode: 'add', initialName: 'A' }}
        paperTracks={[]}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    )
    window.addEventListener('keydown', escapedToWorkspace)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    window.removeEventListener('keydown', escapedToWorkspace)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(escapedToWorkspace).not.toHaveBeenCalled()
  })

  it('cancels a timeline-lane editor when the next pointer action is outside', () => {
    const onCancel = vi.fn()
    render(
      <TimelineLaneEditorPopover
        state={{ x: 20, y: 30, role: 'sound', laneId: 'sound-1', label: 'SOUND', mode: 'rename', initialName: '台詞' }}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    )

    fireEvent.pointerDown(document.body)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
