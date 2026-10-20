import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cameraInstructionIntervals, type TimedRangeCue } from '@xsheet-remap/core'
import { CameraCueDialog } from './CameraCueDialog'

afterEach(cleanup)

function renderDialog({ duration = 72, cue = null as TimedRangeCue | null } = {}) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  return { onSubmit, onCancel, ...render(<CameraCueDialog
    state={{ mode: cue ? 'edit' : 'create', cueId: cue?.cueId, laneId: 'camera_lane_1', frameStart: 1, frameEnd: duration }}
    cue={cue} fps={24} frameMin={1} frameMax={144} instructionHistory={[]} pointLabelHistory={[]}
    onSubmit={onSubmit} onCancel={onCancel} />) }
}

function applyOperation(action: string, value: number, target = 'all') {
  const details = document.querySelector('details')!
  if (!details.open) fireEvent.click(screen.getByText('区間の分割・尺変更', { selector: 'summary' }))
  fireEvent.change(screen.getByLabelText('区間操作'), { target: { value: action } })
  fireEvent.change(screen.getByLabelText('区間操作の対象'), { target: { value: target } })
  fireEvent.change(screen.getByLabelText('区間操作の値'), { target: { value: String(value) } })
  fireEvent.click(screen.getByRole('button', { name: '適用' }))
}

function durations() {
  return [...document.querySelectorAll<HTMLInputElement>('.cameraIntervalRow .compactDurationFrameControl input')].map(input => input.value)
}

describe('CameraCueDialog', () => {
  it('owns Escape at the modal boundary with a button focused and does not submit a draft', () => {
    const { onCancel, onSubmit } = renderDialog()
    const escaped = vi.fn()
    window.addEventListener('keydown', escaped)
    const button = screen.getByRole('button', { name: '区間1の分割・尺変更' })
    button.focus()
    fireEvent.keyDown(button, { key: 'Escape' })
    window.removeEventListener('keydown', escaped)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(escaped).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('creates a single editable FI/OL sequence with aligned duration and drawing controls', () => {
    const { onSubmit } = renderDialog()
    fireEvent.change(screen.getByLabelText('CAMERA指示'), { target: { value: 'OL' } })
    applyOperation('frames', 12)
    fireEvent.click(screen.getByRole('radio', { name: '区間1をフェードイン・ワイプイン' }))
    fireEvent.change(screen.getByLabelText('CAMERA区間2の尺'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('CAMERA境界ラベル2'), { target: { value: '中間' } })
    expect(durations()).toEqual(['0+12', '8', '0+16', '0+12', '0+12', '0+12'])
    expect(screen.getAllByRole('radiogroup')).toHaveLength(6)
    expect(document.querySelectorAll('.cameraIntervalRow .compactDurationFrameControl')).toHaveLength(6)
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    const input = onSubmit.mock.calls[0]![0]
    expect(cameraInstructionIntervals(input).map(item => item.durationFrames)).toEqual([12, 8, 16, 12, 12, 12])
    expect(input.camera.segments.map((item: { kind: string }) => item.kind)).toEqual(['fade-in', ...Array(5).fill('overlap')])
    expect(input.camera.points).toContainEqual(expect.objectContaining({ label: '中間', frameOffset: 20 }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('previews fixed-size remainder and equal division, and preserves a one-frame tail on submit', () => {
    const { onSubmit } = renderDialog({ duration: 73 })
    applyOperation('frames', 12)
    expect(durations()).toEqual([...Array(6).fill('0+12'), '0+1'])
    fireEvent.change(screen.getByLabelText('CAMERA開始ラベル'), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText('CAMERA終了ラベル'), { target: { value: 'B' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(cameraInstructionIntervals(onSubmit.mock.calls[0]![0]).at(-1)!.durationFrames).toBe(1)
  })

  it('divides only a selected interval and can merge it using the following drawing kind', () => {
    renderDialog()
    applyOperation('at', 6)
    fireEvent.click(screen.getByRole('radio', { name: '区間1をフェードイン・ワイプイン' }))
    fireEvent.click(screen.getByRole('radio', { name: '区間2をオーバーラップ' }))
    applyOperation('frames', 12, 'cue-end')
    expect(durations()).toEqual(['0+6', ...Array(5).fill('0+12'), '0+6'])
    fireEvent.click(screen.getByRole('button', { name: '区間1と次を結合' }))
    expect(durations()[0]).toBe('0+18')
    expect(screen.getByRole('radio', { name: '区間1をオーバーラップ' }).getAttribute('aria-checked')).toBe('true')
  })

  it('keeps ordinary resize at the last boundary and exposes explicit ripple and proportional changes', () => {
    renderDialog({ duration: 36 })
    applyOperation('frames', 12)
    fireEvent.change(screen.getByLabelText('全体の長さ 秒'), { target: { value: '0' } })
    expect(durations()).toEqual(['0+12', '0+12', '0+1'])
    applyOperation('ripple', 14, 'point_1')
    expect(durations()).toEqual(['0+14', '0+12', '0+1'])
    applyOperation('scale', 54)
    expect(durations()).toEqual(['1+4', '1+0', '0+2'])
  })

  it('reopens saved uneven intervals without redistributing them', () => {
    const cue: TimedRangeCue = { cueId: 'saved', role: 'camera', laneId: 'camera_lane_1', frameStart: 1, frameEnd: 20, label: '「コーヒー。」', text: '',
      camera: { shape: 'fade-in', points: [{ pointId: 'boundary', role: 'intermediate', frameOffset: 7, label: 'B' }],
        segments: [{ endPointId: 'boundary', kind: 'fade-in' }, { endPointId: 'cue-end', kind: 'overlap', pivotAnchorFrame: 14 }] } }
    const { onSubmit } = renderDialog({ cue })
    expect(durations()).toEqual(['0+7', '0+13'])
    fireEvent.click(screen.getByRole('button', { name: '更新' }))
    expect(cameraInstructionIntervals(onSubmit.mock.calls[0]![0]).map(item => item.durationFrames)).toEqual([7, 13])
    expect(onSubmit.mock.calls[0]![0].label).toBe(cue.label)
  })
})
