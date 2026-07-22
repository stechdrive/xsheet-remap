import { describe, expect, it } from 'vitest'
import { positionMultilineTextLines } from './multilineTextLayout'

describe('multiline text positioning', () => {
  it('assigns an absolute position to every line including empty lines', () => {
    expect(positionMultilineTextLines(['first', '', 'third'], 12, 30, 18)).toEqual([
      { index: 0, text: 'first', xPx: 12, yPx: 30 },
      { index: 1, text: '', xPx: 12, yPx: 48 },
      { index: 2, text: 'third', xPx: 12, yPx: 66 },
    ])
  })

  it('preserves leading, trailing, and consecutive empty lines', () => {
    expect(positionMultilineTextLines(['', 'A', '', '', 'B', ''], 0, 5, 10))
      .toEqual([
        { index: 0, text: '', xPx: 0, yPx: 5 },
        { index: 1, text: 'A', xPx: 0, yPx: 15 },
        { index: 2, text: '', xPx: 0, yPx: 25 },
        { index: 3, text: '', xPx: 0, yPx: 35 },
        { index: 4, text: 'B', xPx: 0, yPx: 45 },
        { index: 5, text: '', xPx: 0, yPx: 55 },
      ])
  })
})
