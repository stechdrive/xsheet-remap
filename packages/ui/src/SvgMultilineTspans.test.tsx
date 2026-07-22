import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SvgMultilineTspans } from './SvgMultilineTspans'

describe('SvgMultilineTspans', () => {
  it('uses absolute y coordinates so an empty tspan cannot collapse the next line', () => {
    const { container } = render(
      <svg>
        <text>
          <SvgMultilineTspans lines={['first', '', 'third']} xPx={20} yPx={40} lineHeightPx={16} />
        </text>
      </svg>,
    )
    const lines = [...container.querySelectorAll('tspan')]

    expect(lines.map(line => line.textContent)).toEqual(['first', '', 'third'])
    expect(lines.map(line => line.getAttribute('x'))).toEqual(['20', '20', '20'])
    expect(lines.map(line => line.getAttribute('y'))).toEqual(['40', '56', '72'])
    expect(lines.every(line => !line.hasAttribute('dy'))).toBe(true)
  })
})
