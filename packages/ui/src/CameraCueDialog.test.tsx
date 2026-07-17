import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CameraCueDialog } from './CameraCueDialog'

describe('CameraCueDialog', () => {
  it('submits shape, endpoint cues, duration, and overlap pivot in logical frames', () => {
    const onSubmit = vi.fn()
    render(
      <CameraCueDialog
        state={{ mode: 'create', laneId: 'camera_lane_1', frameStart: 1, frameEnd: 6 }}
        cue={null}
        lane={{ laneId: 'camera_lane_1', label: 'CAM1', order: 0 }}
        fps={24}
        frameMin={1}
        frameMax={144}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('CAMERA描画種別'), { target: { value: 'overlap' } })
    fireEvent.change(screen.getByLabelText('CAMERA指示'), { target: { value: 'OL' } })
    fireEvent.change(screen.getByLabelText('CAMERA開始キュー'), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText('CAMERA終了キュー'), { target: { value: 'B' } })
    fireEvent.change(screen.getByLabelText('CAMERAデュレーションコマ'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('CAMERA交差フレーム'), { target: { value: '8' } })
    expect(screen.queryByLabelText('CAMERA補足')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      laneId: 'camera_lane_1', frameStart: 1, frameEnd: 12, label: 'OL',
      camera: expect.objectContaining({ shape: 'overlap', startLabel: 'A', endLabel: 'B', pivotAnchorFrame: 8 }),
    }))
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('text')
  })
})
