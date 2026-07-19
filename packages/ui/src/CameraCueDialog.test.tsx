import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CameraCueDialog } from './CameraCueDialog'

afterEach(cleanup)

function renderDialog(onSubmit = vi.fn()) {
  return {
    onSubmit,
    ...render(
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
    ),
  }
}

function openSegmentPicker(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name }))
}

describe('CameraCueDialog', () => {
  it('uses one compact outgoing-segment selector instead of a global shape row', () => {
    const { onSubmit, container } = renderDialog()
    expect(container.querySelector('.cameraShapePicker')).toBeNull()
    expect(screen.getByRole('button', { name: /開始から次の点まで：直線/ })).toBeTruthy()

    openSegmentPicker(/開始から次の点まで：直線/)
    expect(screen.getByRole('radiogroup', { name: '開始から次の点までの図形' })).toBeTruthy()
    const overlap = screen.getByRole('radio', { name: '開始から次の点までをオーバーラップ' })
    expect(overlap.querySelector('path')?.getAttribute('d')).toBe('M7 3H29L18 12Z M7 21H29L18 12Z')
    fireEvent.click(overlap)
    expect(screen.getByLabelText('開始から次の点までの交差フレーム')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      camera: expect.objectContaining({
        shape: 'overlap',
        segments: [expect.objectContaining({ endPointId: 'cue-end', kind: 'overlap' })],
      }),
    }))
  })

  it('stores optional labels, duration, and a local OL pivot on its interval', () => {
    const { onSubmit } = renderDialog()
    fireEvent.change(screen.getByLabelText('CAMERA指示'), { target: { value: 'OL' } })
    fireEvent.change(screen.getByLabelText('CAMERA開始ラベル'), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText('CAMERA終了ラベル'), { target: { value: 'B' } })
    fireEvent.change(screen.getByLabelText('長さ 秒'), { target: { value: '00' } })
    fireEvent.change(screen.getByLabelText('長さ コマ'), { target: { value: '12' } })
    openSegmentPicker(/開始から次の点まで：オーバーラップ/)
    fireEvent.change(screen.getByLabelText('開始から次の点までの交差フレーム'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: '＋ 中間ラベル' }))
    fireEvent.change(screen.getByLabelText('CAMERA中間ラベル1'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      laneId: 'camera_lane_1', frameStart: 1, frameEnd: 12, label: 'OL',
      camera: expect.objectContaining({
        points: [
          { pointId: 'point_start', role: 'start', frameOffset: 0, label: 'A' },
          { pointId: 'point_1', role: 'intermediate', frameOffset: 5, label: '' },
          { pointId: 'point_end', role: 'end', frameOffset: 11, label: 'B' },
        ],
        segments: [
          expect.objectContaining({ endPointId: 'point_1', kind: 'overlap' }),
          expect.objectContaining({ endPointId: 'cue-end', kind: 'overlap' }),
        ],
      }),
    }))
  })

  it('allows every interval to independently use all five drawing kinds', () => {
    const { onSubmit, container } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '＋ 中間ラベル' }))
    fireEvent.click(screen.getByRole('button', { name: '＋ 中間ラベル' }))
    expect(container.querySelectorAll('.cameraSegmentKindControl')).toHaveLength(3)

    openSegmentPicker(/開始から次の点まで：直線/)
    fireEvent.click(screen.getByRole('radio', { name: '開始から次の点までを波線の区間指示' }))
    openSegmentPicker(/中間ラベル1から次の点まで：直線/)
    fireEvent.click(screen.getByRole('radio', { name: '中間ラベル1から次の点までをフェードイン・ワイプイン' }))
    openSegmentPicker(/中間ラベル2から次の点まで：直線/)
    fireEvent.click(screen.getByRole('radio', { name: '中間ラベル2から次の点までをオーバーラップ' }))
    fireEvent.click(screen.getByRole('button', { name: '追加' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      camera: expect.objectContaining({
        segments: [
          expect.objectContaining({ endPointId: 'point_1', kind: 'wave' }),
          expect.objectContaining({ endPointId: 'point_2', kind: 'fade-in' }),
          expect.objectContaining({ endPointId: 'cue-end', kind: 'overlap' }),
        ],
      }),
    }))
  })

  it('splits a segment by inheritance and keeps the following segment kind when a point is removed', () => {
    const { onSubmit } = renderDialog()
    openSegmentPicker(/開始から次の点まで：直線/)
    fireEvent.click(screen.getByRole('radio', { name: '開始から次の点までを波線の区間指示' }))
    fireEvent.click(screen.getByRole('button', { name: '＋ 中間ラベル' }))
    expect(screen.getAllByRole('button', { name: /：波線の区間指示/ })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '中間ラベル1を削除' }))
    expect(screen.getAllByRole('button', { name: /：波線の区間指示/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(onSubmit.mock.calls[0]?.[0].camera.segments).toEqual([
      { endPointId: 'cue-end', kind: 'wave', pivotAnchorFrame: undefined },
    ])
  })
})
