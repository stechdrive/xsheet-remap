import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SheetWorkRangeControls } from './SheetWorkRangeControls'

afterEach(cleanup)

it('retains imported dummy ranges longer than 24 frames when independently hiding and showing them', () => {
  const changed = vi.fn()
  function Controls() {
    const [workRange, setWorkRange] = useState({ preRollFrames: 60, postRollFrames: 72, showPreRoll: true, showPostRoll: true })
    return <SheetWorkRangeControls workRange={workRange} onChange={next => { changed(next); setWorkRange(next) }} />
  }
  render(<Controls />)
  for (const label of ['開始前ダミー', '終了後ダミー', '開始前ダミー', '終了後ダミー']) fireEvent.click(screen.getByRole('checkbox', { name: label }))
  expect(changed.mock.calls.map(([range]) => range)).toEqual([
    { preRollFrames: 60, postRollFrames: 72, showPreRoll: false, showPostRoll: true },
    { preRollFrames: 60, postRollFrames: 72, showPreRoll: false, showPostRoll: false },
    { preRollFrames: 60, postRollFrames: 72, showPreRoll: true, showPostRoll: false },
    { preRollFrames: 60, postRollFrames: 72, showPreRoll: true, showPostRoll: true },
  ])
})
