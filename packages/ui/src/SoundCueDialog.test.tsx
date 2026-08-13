import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SoundCueDialog } from './SoundCueDialog'

afterEach(() => cleanup())

describe('SoundCueDialog', () => {
  it('owns Escape at the modal boundary and does not leak it to the workspace', () => {
    const onCancel = vi.fn()
    render(
      <SoundCueDialog
        state={{ mode: 'create', laneId: 'sound_lane_1', frameStart: 1, frameEnd: 12 }}
        cue={null}
        sectionLabel="SOUND"
        fps={24}
        frameMin={1}
        frameMax={144}
        labelHistory={[]}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    )
    const escapedToWorkspace = vi.fn()
    window.addEventListener('keydown', escapedToWorkspace)
    const cancel = screen.getByRole('button', { name: 'キャンセル' })
    cancel.focus()
    fireEvent.keyDown(cancel, { key: 'Escape' })
    window.removeEventListener('keydown', escapedToWorkspace)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(escapedToWorkspace).not.toHaveBeenCalled()
  })

  it('assigns an audio region to any existing cue and exposes an explicit alignment choice', () => {
    const onSubmit = vi.fn()
    render(
      <SoundCueDialog
        state={{
          mode: 'create',
          laneId: 'sound_lane_1',
          frameStart: 20,
          frameEnd: 28,
          audioCandidate: { trackId: 'dialogue-2', candidateIds: ['vad-1'], revisionId: 'revision-1', cueId: 'cue-2' },
        }}
        cue={null}
        sectionLabel="セリフ"
        fps={24}
        frameMin={1}
        frameMax={144}
        labelHistory={[]}
        soundLanes={[
          { laneId: 'sound_lane_1', label: '声', order: 0 },
          { laneId: 'sound_lane_2', label: '効果', order: 1 },
        ]}
        soundCues={[
          { cueId: 'cue-2', role: 'sound', laneId: 'sound_lane_2', frameStart: 40, frameEnd: 52, label: '主人公', text: 'はい' },
        ]}
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />,
    )
    expect((screen.getByLabelText('音響指示の割付先') as HTMLSelectElement).value).toBe('cue-2')
    expect((screen.getByLabelText('位置の合わせ方') as HTMLSelectElement).value).toBe('keep-offset')
    expect(screen.getByRole('option', { name: '現在位置のまま追加' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('位置の合わせ方'), { target: { value: 'move-audio-to-cue' } })
    fireEvent.click(screen.getByRole('button', { name: '割り付け' }))
    expect(onSubmit).toHaveBeenCalledWith({
      cueId: undefined,
      laneId: 'sound_lane_1',
      frameStart: 20,
      frameEnd: 28,
      label: '',
      text: '',
      existingCueId: 'cue-2',
      alignment: 'move-audio-to-cue',
    })
  })

  it('creates a new cue in a user-selected logical sound lane', () => {
    const onSubmit = vi.fn()
    render(
      <SoundCueDialog
        state={{
          mode: 'create',
          laneId: 'sound_lane_1',
          frameStart: 10,
          frameEnd: 12,
          audioCandidate: { trackId: 'dialogue-1', candidateIds: ['vad-1'], revisionId: 'revision-1' },
        }}
        cue={null}
        sectionLabel="SOUND"
        fps={24}
        frameMin={1}
        frameMax={144}
        labelHistory={[]}
        soundLanes={[
          { laneId: 'sound_lane_1', label: 'A', order: 0 },
          { laneId: 'sound_lane_2', label: 'B', order: 1 },
        ]}
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />,
    )
    fireEvent.change(screen.getByLabelText('SOUND列'), { target: { value: 'sound_lane_2' } })
    fireEvent.change(screen.getByLabelText('SOUNDラベル'), { target: { value: 'B用' } })
    fireEvent.click(screen.getByRole('button', { name: '作成して割り付け' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ laneId: 'sound_lane_2', label: 'B用' }))
  })

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
