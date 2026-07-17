import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CameraCueDialog } from './CameraCueDialog'

afterEach(cleanup)

describe('CameraCueDialog', () => {
  it('disables submission without using native required validation when the instruction is blank', () => {
    render(
      <CameraCueDialog
        state={{ mode: 'create', laneId: 'camera_lane_1', frameStart: 1, frameEnd: 6 }}
        cue={null}
        fps={24}
        frameMin={1}
        frameMax={144}
        instructionHistory={[]}
        pointLabelHistory={[]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const instruction = screen.getByLabelText('CAMERA指示')
    const submit = screen.getByRole('button', { name: '追加' }) as HTMLButtonElement
    expect(instruction.hasAttribute('required')).toBe(false)
    expect(submit.disabled).toBe(true)

    fireEvent.change(instruction, { target: { value: '   ' } })
    expect(submit.disabled).toBe(true)
    fireEvent.change(instruction, { target: { value: 'PAN' } })
    expect(submit.disabled).toBe(false)
  })

  it('submits shape, endpoint cues, duration, and overlap pivot in logical frames', () => {
    const onSubmit = vi.fn()
    render(
      <CameraCueDialog
        state={{ mode: 'create', laneId: 'camera_lane_1', frameStart: 1, frameEnd: 6 }}
        cue={null}
        fps={24}
        frameMin={1}
        frameMax={144}
        instructionHistory={[]}
        pointLabelHistory={[]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: 'オーバーラップ' }))
    fireEvent.change(screen.getByLabelText('CAMERA指示'), { target: { value: 'OL' } })
    fireEvent.change(screen.getByLabelText('CAMERA開始点'), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText('CAMERA終了点'), { target: { value: 'B' } })
    fireEvent.change(screen.getByLabelText('尺 コマ'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: '＋ 中間点' }))
    fireEvent.change(screen.getByLabelText('CAMERA中間点1'), { target: { value: 'MID' } })
    fireEvent.change(screen.getByLabelText('CAMERA交差フレーム'), { target: { value: '8' } })
    expect(screen.queryByLabelText('CAMERA補足')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      laneId: 'camera_lane_1', frameStart: 1, frameEnd: 12, label: 'OL',
      camera: expect.objectContaining({
        shape: 'overlap',
        points: [
          { pointId: 'point_start', role: 'start', frameOffset: 0, label: 'A' },
          { pointId: 'point_1', role: 'intermediate', frameOffset: 5, label: 'MID' },
          { pointId: 'point_end', role: 'end', frameOffset: 11, label: 'B' },
        ],
        pivotAnchorFrame: 8,
      }),
    }))
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('text')
  })
})
