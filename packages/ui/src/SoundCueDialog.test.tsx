import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SoundCueDialog } from './SoundCueDialog'

afterEach(() => cleanup())

describe('SoundCueDialog', () => {
  it('edits a single label plus dialogue and converts seconds + frames to an inclusive range', () => {
    const onSubmit = vi.fn()
    render(
      <SoundCueDialog
        state={{ mode: 'create', laneId: 'sound_lane_1', frameStart: 10, frameEnd: 12 }}
        cue={null}
        sectionLabel="SOUND"
        fps={24}
        frameMin={1}
        frameMax={144}
        labelHistory={['アキラ', 'SE']}
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />,
    )
    fireEvent.change(screen.getByLabelText('SOUNDラベル'), { target: { value: 'SE' } })
    fireEvent.change(screen.getByLabelText('SOUND内容'), { target: { value: 'ドン！' } })
    expect(screen.getByRole('dialog', { name: 'SOUND指示' })).toBeTruthy()
    expect(screen.queryByLabelText('SOUND開始フレーム')).toBeNull()
    expect(screen.getByLabelText('SOUND内容').getAttribute('placeholder')).toBeNull()
    expect(screen.getByText('Ctrl+Enterで確定')).toBeTruthy()
    expect(screen.queryByText(/ラベル履歴/)).toBeNull()
    fireEvent.change(screen.getByLabelText('長さ 秒'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('長さ コマ'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    expect(onSubmit).toHaveBeenCalledWith({
      cueId: undefined,
      laneId: 'sound_lane_1',
      frameStart: 10,
      frameEnd: 39,
      label: 'SE',
      text: 'ドン！',
    })
  })

  it('keeps Enter for line breaks and confirms textarea input with Ctrl+Enter', () => {
    const onSubmit = vi.fn()
    render(
      <SoundCueDialog
        state={{ mode: 'edit', cueId: 'cue_1', laneId: 'sound_lane_1', frameStart: 1, frameEnd: 24 }}
        cue={{ cueId: 'cue_1', role: 'sound', laneId: 'sound_lane_1', frameStart: 1, frameEnd: 24, label: 'アキラ', text: 'はい', source: 'manual' }}
        sectionLabel="セリフ"
        fps={24}
        frameMin={1}
        frameMax={144}
        labelHistory={[]}
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'セリフ指示' })).toBeTruthy()
    const textarea = screen.getByLabelText('セリフ内容')
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('allows a template SOUND-equivalent instruction with content and no label', () => {
    const onSubmit = vi.fn()
    render(
      <SoundCueDialog
        state={{ mode: 'create', laneId: 'sound_lane_1', frameStart: 1, frameEnd: 6 }}
        cue={null}
        sectionLabel="効果"
        fps={24}
        frameMin={1}
        frameMax={144}
        labelHistory={['人物名']}
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />,
    )
    const label = screen.getByLabelText('効果ラベル')
    expect(label.hasAttribute('required')).toBe(false)
    fireEvent.change(screen.getByLabelText('効果内容'), { target: { value: '  SE  ' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    expect(onSubmit).toHaveBeenCalledWith({
      cueId: undefined,
      laneId: 'sound_lane_1',
      frameStart: 1,
      frameEnd: 6,
      label: '',
      text: 'SE',
    })
  })
})
