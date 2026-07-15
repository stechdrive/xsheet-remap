import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculateTooltipPosition, TooltipTarget } from './Tooltip'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('calculateTooltipPosition', () => {
  it('uses the measured tooltip size when choosing a vertical placement', () => {
    const position = calculateTooltipPosition(
      rect({ left: 80, top: 50, width: 40, height: 20 }),
      { width: 120, height: 80 },
      { width: 240, height: 200 },
    )

    expect(position).toEqual({
      left: 40,
      top: 79,
      placement: 'bottom',
      arrowOffset: 60,
    })
  })

  it('falls back to a horizontal side when a wrapped tooltip cannot fit above or below', () => {
    const position = calculateTooltipPosition(
      rect({ left: 100, top: 20, width: 20, height: 20 }),
      { width: 100, height: 60 },
      { width: 400, height: 80 },
    )

    expect(position).toEqual({
      left: 129,
      top: 8,
      placement: 'right',
      arrowOffset: 22,
    })
  })

  it('keeps the bubble and arrow inside the viewport near a corner', () => {
    const position = calculateTooltipPosition(
      rect({ left: 190, top: 60, width: 10, height: 20 }),
      { width: 100, height: 30 },
      { width: 200, height: 140 },
    )

    expect(position).toEqual({
      left: 92,
      top: 21,
      placement: 'top',
      arrowOffset: 91,
    })
  })
})

describe('TooltipTarget', () => {
  it('portals a measured tooltip, associates it with the trigger, and dismisses it with Escape', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getBoundingClientRect(this: HTMLElement) {
      if (this.classList.contains('appTooltip')) return domRect(0, 0, 120, 48)
      return domRect(4, 4, 24, 20)
    })
    const { container } = render(
      <TooltipTarget label="画面端でも折り返される共通ツールチップ" delayMs={0}>
        {tooltipProps => <button type="button" {...tooltipProps}>対象</button>}
      </TooltipTarget>,
    )
    const trigger = screen.getByRole('button', { name: '対象' })

    fireEvent.pointerEnter(trigger)
    act(() => vi.runAllTimers())

    const tooltip = screen.getByRole('tooltip')
    expect(container.contains(tooltip)).toBe(false)
    expect(tooltip.parentElement).toBe(document.body)
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id)
    expect(tooltip.classList.contains('appTooltip-bottom')).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(trigger.hasAttribute('aria-describedby')).toBe(false)
  })

  it('does not open after the pointer leaves during the delay', () => {
    vi.useFakeTimers()
    render(
      <TooltipTarget label="遅延表示">
        {tooltipProps => <button type="button" {...tooltipProps}>対象</button>}
      </TooltipTarget>,
    )
    const trigger = screen.getByRole('button', { name: '対象' })

    fireEvent.pointerEnter(trigger)
    fireEvent.pointerLeave(trigger)
    act(() => vi.runAllTimers())

    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

function rect({ left, top, width, height }: { left: number; top: number; width: number; height: number }) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  }
}

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    ...rect({ left, top, width, height }),
    x: left,
    y: top,
    toJSON: () => ({}),
  }
}
