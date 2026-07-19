import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CameraCueDialog } from './CameraCueDialog'

afterEach(cleanup)

describe('CameraCueDialog', () => {
  it('allows a shape-only instruction without native validation or shape tooltips', () => {
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

    const instruction = screen.getByLabelText('CAMERA指示')
    const submit = screen.getByRole('button', { name: '追加' }) as HTMLButtonElement
    expect(instruction.hasAttribute('required')).toBe(false)
    expect(submit.disabled).toBe(false)
    expect(document.querySelector('.cameraShapePicker .appTooltipTrigger')).toBeNull()
    expect(screen.getByRole('radio', { name: 'オーバーラップ' }).querySelector('path')?.getAttribute('d'))
      .toBe('M7 3H29L18 12Z M7 21H29L18 12Z')

    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ label: '' }))
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
    fireEvent.change(screen.getByLabelText('CAMERA開始ラベル'), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText('CAMERA終了ラベル'), { target: { value: 'B' } })
    fireEvent.change(screen.getByLabelText('長さ コマ'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: '＋ 中間ラベル' }))
    fireEvent.change(screen.getByLabelText('CAMERA中間ラベル1'), { target: { value: 'MID' } })
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

  it('places the intermediate label before its frame and stores compact per-segment line styles', () => {
    const onSubmit = vi.fn()
    const { container } = render(
      <CameraCueDialog
        state={{ mode: 'create', laneId: 'camera_lane_1', frameStart: 1, frameEnd: 24 }}
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

    const waveOption = screen.getByRole('radio', { name: '波線の区間指示' })
    fireEvent.click(waveOption)
    expect(waveOption.getAttribute('aria-checked')).toBe('true')
    const icon = waveOption.querySelector('.cameraRangeShapeIcon')!
    expect(icon.querySelectorAll('polygon')).toHaveLength(2)
    expect(icon.querySelector('path')?.getAttribute('d')).toBe(
      'M18 7C24 7.833 24 8.667 18 9.5C12 10.333 12 11.167 18 12C24 12.833 24 13.667 18 14.5C12 15.333 12 16.167 18 17',
    )

    fireEvent.click(screen.getByRole('button', { name: '＋ 中間ラベル' }))
    const row = container.querySelector('.cameraIntermediatePointRow')!
    const labelInput = screen.getByLabelText('CAMERA中間ラベル1')
    const frameInput = screen.getByLabelText('CAMERA中間ラベル1位置')
    expect([...row.querySelectorAll('input')].indexOf(labelInput as HTMLInputElement))
      .toBeLessThan([...row.querySelectorAll('input')].indexOf(frameInput as HTMLInputElement))
    expect(row.querySelector('output')).toBeNull()

    fireEvent.change(labelInput, { target: { value: 'B' } })
    fireEvent.click(screen.getByRole('radio', { name: '中間ラベル1までを直線' }))
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      camera: expect.objectContaining({
        shape: 'range',
        pathStyle: 'wave',
        segmentStyles: [
          { endPointId: 'point_1', style: 'straight' },
          { endPointId: 'cue-end', style: 'wave' },
        ],
      }),
    }))
  })
})
