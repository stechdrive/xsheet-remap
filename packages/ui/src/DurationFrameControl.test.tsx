import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DurationFrameControl } from './DurationFrameControl'

describe('DurationFrameControl', () => {
  it('uses centered SVG arrow marks instead of font glyphs', () => {
    render(<DurationFrameControl frames={25} fps={24} onChange={vi.fn()} label="尺" />)

    const up = screen.getByRole('button', { name: '尺を1秒増やす' })
    const down = screen.getByRole('button', { name: '尺を1秒減らす' })
    expect(up.textContent).toBe('')
    expect(down.textContent).toBe('')
    expect(up.querySelector('svg.durationArrowIcon.up')?.getAttribute('viewBox')).toBe('0 0 8 5')
    expect(down.querySelector('svg.durationArrowIcon.down')?.getAttribute('viewBox')).toBe('0 0 8 5')
  })
})
