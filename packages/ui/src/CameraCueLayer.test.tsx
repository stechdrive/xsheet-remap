import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultProject, createSheetPages, standardA3SheetTemplate, type TimedRangeCue } from '@xsheet-remap/core'
import { CameraCueLayer } from './CameraCueLayer'

describe('CameraCueLayer', () => {
  it('renders all four semantic instruction shapes and an editable overlap pivot', () => {
    const rangeCue = cameraCue('cue_1', 'camera_lane_1', 1, 12, 'range')
    rangeCue.camera = {
      ...rangeCue.camera!,
      points: [{ pointId: 'mid', role: 'intermediate', frameOffset: 5, label: 'B' }],
    }
    const cues: TimedRangeCue[] = [
      rangeCue,
      cameraCue('cue_2', 'camera_lane_2', 13, 24, 'fade-in'),
      cameraCue('cue_3', 'camera_lane_3', 25, 36, 'fade-out'),
      cameraCue('cue_4', 'camera_lane_4', 37, 48, 'overlap', 43),
    ]
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const { container } = render(
      <svg>
        <CameraCueLayer
          cues={cues}
          template={standardA3SheetTemplate}
          page={page}
          paperTracks={createDefaultProject().logicalSheet.paperTracks.map(track => track.paperTrack)}
          pageSize={{ widthPx: 1754, heightPx: 2481 }}
          surface={{ widthPx: 1000, heightPx: 1000 }}
          selectedCueId="cue_4"
          onPointerDown={vi.fn()}
          onPointerMove={vi.fn()}
          onPointerUp={vi.fn()}
          onPointerCancel={vi.fn()}
          onDoubleClick={vi.fn()}
          onPointerEnter={vi.fn()}
          onPointerLeave={vi.fn()}
        />
      </svg>,
    )
    expect(container.querySelectorAll('.cameraCue.range .cameraCueStroke')).toHaveLength(2)
    expect(container.querySelectorAll('.cameraCue.fade-in .cameraCueFade')).toHaveLength(1)
    expect(container.querySelectorAll('.cameraCue.fade-out .cameraCueFade')).toHaveLength(1)
    expect(container.querySelectorAll('.cameraCue.overlap .cameraCueStroke')).toHaveLength(2)
    expect(container.querySelectorAll('.cameraCue.overlap .cameraCueOverlapFill')).toHaveLength(2)
    expect(container.querySelectorAll('.cameraCueShapeHit')).toHaveLength(6)
    expect(container.querySelector('.cameraCueHitBody')).toBeNull()
    expect(container.querySelector('.cameraCuePivotHandle')).toBeTruthy()
    expect(container.querySelectorAll('.cameraCue.overlap .cameraCuePivotMarkHalo')).toHaveLength(1)
    expect(container.querySelectorAll('.cameraCue.overlap .cameraCuePivotMark')).toHaveLength(1)
    expect(container.querySelectorAll('.cameraCuePoint.intermediate .cameraCuePivotMarkHalo')).toHaveLength(1)
    expect(container.querySelectorAll('.cameraCuePoint.intermediate .cameraCuePivotMark')).toHaveLength(1)
    expect(container.querySelectorAll('.cameraCue.range .cameraCueMarker.start')).toHaveLength(1)
    expect(container.querySelectorAll('.cameraCue.range .cameraCueMarker.end')).toHaveLength(1)
    expect(container.querySelectorAll('.cameraCue.fade-in .cameraCueMarker, .cameraCue.fade-out .cameraCueMarker, .cameraCue.overlap .cameraCueMarker')).toHaveLength(0)
    expect(container.querySelectorAll('.cameraCueLabelHit')).toHaveLength(4)
    expect(container.querySelectorAll('.cameraCueLabelBody')).toHaveLength(4)
    expect(container.querySelector('.cameraCueLabelResizeHandle.sheetTransformHandle.resize')).toBeTruthy()
    expect(container.querySelector('.cameraCueLabelResizeHandle .sheetTransformHandleResizeVisual')).toBeTruthy()
    expect(container.querySelectorAll('.cameraCueLabel defs rect')).toHaveLength(4)
    expect(container.querySelectorAll('.cameraCueLabel[data-camera-label-overflow="false"]')).toHaveLength(4)
    expect(container.querySelectorAll('.cameraCueLabelText[clip-path]')).toHaveLength(0)
    expect(container.querySelectorAll('.cameraCueLabel [clip-path] .cameraCueLabelText')).toHaveLength(4)
  })

  it('colors adjacent CAMERA columns while keeping cue and label colors stable within a lane', () => {
    const cues = [
      cameraCue('cue_later', 'camera_lane_1', 20, 24, 'fade-out'),
      cameraCue('cue_first', 'camera_lane_1', 1, 6, 'fade-in'),
      cameraCue('cue_middle', 'camera_lane_1', 10, 14, 'range'),
      cameraCue('cue_adjacent', 'camera_lane_2', 1, 6, 'range'),
    ]
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const { container } = render(
      <svg><CameraCueLayer
        cues={cues}
        template={standardA3SheetTemplate}
        page={page}
        paperTracks={createDefaultProject().logicalSheet.paperTracks.map(track => track.paperTrack)}
        pageSize={{ widthPx: 1754, heightPx: 2481 }}
        surface={{ widthPx: 1000, heightPx: 1000 }}
        selectedCueId={null}
        onPointerDown={vi.fn()} onPointerMove={vi.fn()} onPointerUp={vi.fn()} onPointerCancel={vi.fn()}
        onDoubleClick={vi.fn()} onPointerEnter={vi.fn()} onPointerLeave={vi.fn()}
      /></svg>,
    )

    expect(container.querySelector('.cameraCue[data-camera-cue-id="cue_first"]')?.getAttribute('data-cue-column-index')).toBe('0')
    expect(container.querySelector('.cameraCue[data-camera-cue-id="cue_middle"]')?.getAttribute('data-cue-column-index')).toBe('0')
    expect(container.querySelector('.cameraCue[data-camera-cue-id="cue_later"]')?.getAttribute('data-cue-column-index')).toBe('0')
    expect(container.querySelector('.cameraCue[data-camera-cue-id="cue_adjacent"]')?.getAttribute('data-cue-column-index')).toBe('1')
    expect(container.querySelector('.cameraCueLabel[data-camera-cue-id="cue_middle"]')?.getAttribute('data-cue-column-index')).toBe('0')
    expect(container.querySelector('.cameraCueLabel[data-camera-cue-id="cue_adjacent"]')?.getAttribute('data-cue-column-index')).toBe('1')
  })

  it('marks an unavoidably overflowing label while clipping it to the CAMERA region', () => {
    const cue = cameraCue('cue_overflow', 'camera_lane_1', 1, 24, 'range')
    cue.label = '非常に長いCAMERA指示'.repeat(100)
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const { container } = render(
      <svg>
        <CameraCueLayer
          cues={[cue]}
          template={standardA3SheetTemplate}
          page={page}
          paperTracks={createDefaultProject().logicalSheet.paperTracks.map(track => track.paperTrack)}
          pageSize={{ widthPx: 1754, heightPx: 2481 }}
          surface={{ widthPx: 1000, heightPx: 1000 }}
          selectedCueId="cue_overflow"
          onPointerDown={vi.fn()}
          onPointerMove={vi.fn()}
          onPointerUp={vi.fn()}
          onPointerCancel={vi.fn()}
          onDoubleClick={vi.fn()}
          onPointerEnter={vi.fn()}
          onPointerLeave={vi.fn()}
        />
      </svg>,
    )
    const label = container.querySelector('.cameraCueLabel[data-camera-label-overflow="true"]')
    expect(label?.classList.contains('overflow')).toBe(true)
    expect(label?.querySelector('title')?.textContent).toContain('アンカー付きメモ')
    expect(label?.querySelector('[clip-path]')).toBeTruthy()
  })

  it('renders mixed interval kinds in one cue and distinguishes an active transform', () => {
    const cue: TimedRangeCue = {
      cueId: 'cue_mixed', role: 'camera', laneId: 'camera_lane_1', frameStart: 1, frameEnd: 24,
      label: 'MIX', text: '', source: 'manual',
      camera: {
        shape: 'range',
        points: [
          { pointId: 'p1', role: 'intermediate', frameOffset: 6, label: '' },
          { pointId: 'p2', role: 'intermediate', frameOffset: 12, label: 'B' },
          { pointId: 'p3', role: 'intermediate', frameOffset: 18, label: 'C' },
        ],
        segments: [
          { endPointId: 'p1', kind: 'straight' },
          { endPointId: 'p2', kind: 'wave' },
          { endPointId: 'p3', kind: 'fade-in' },
          { endPointId: 'cue-end', kind: 'overlap', pivotAnchorFrame: 20 },
        ],
      },
    }
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const { container } = render(
      <svg><CameraCueLayer
        cues={[cue]}
        template={standardA3SheetTemplate}
        page={page}
        paperTracks={createDefaultProject().logicalSheet.paperTracks.map(track => track.paperTrack)}
        pageSize={{ widthPx: 1754, heightPx: 2481 }}
        surface={{ widthPx: 1000, heightPx: 1000 }}
        selectedCueId="cue_mixed"
        draggingCueId="cue_mixed"
        onPointerDown={vi.fn()} onPointerMove={vi.fn()} onPointerUp={vi.fn()} onPointerCancel={vi.fn()}
        onDoubleClick={vi.fn()} onPointerEnter={vi.fn()} onPointerLeave={vi.fn()}
      /></svg>,
    )
    expect(container.querySelector('.cameraCue.transforming')).toBeTruthy()
    expect(container.querySelector('.cameraCueRangePath.straight')).toBeTruthy()
    expect(container.querySelector('.cameraCueRangePath.wave')).toBeTruthy()
    expect(container.querySelector('.cameraCueFade')).toBeTruthy()
    expect(container.querySelectorAll('.cameraCueOverlapFill')).toHaveLength(2)
    expect(container.querySelectorAll('.cameraCueMarker.start')).toHaveLength(1)
    expect(container.querySelectorAll('.cameraCueMarker.end')).toHaveLength(0)
    expect(container.querySelectorAll('.cameraCuePivotHandle')).toHaveLength(1)
  })
})

function cameraCue(cueId: string, laneId: string, frameStart: number, frameEnd: number, shape: 'range' | 'fade-in' | 'fade-out' | 'overlap', pivotAnchorFrame?: number): TimedRangeCue {
  return { cueId, role: 'camera', laneId, frameStart, frameEnd, label: shape, text: '', source: 'manual', camera: { shape, startLabel: 'A', endLabel: 'B', pivotAnchorFrame } }
}
