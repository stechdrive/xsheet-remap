import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FloatingHoverPalette } from './FloatingHoverPalette'

afterEach(() => cleanup())

describe('FloatingHoverPalette', () => {
  it('opens from pointer or focus and closes after leaving or pressing Escape', () => {
    render(
      <FloatingHoverPalette label="ズーム" valueLabel="100%">
        <input aria-label="ズームスライダー" type="range" />
      </FloatingHoverPalette>,
    )
    const palette = screen.getByRole('group', { name: 'ズーム' })
    const trigger = screen.getByRole('button', { name: 'ズーム 100%' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(palette.classList.contains('open')).toBe(false)

    fireEvent.pointerEnter(palette, { pointerType: 'mouse' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(palette.classList.contains('open')).toBe(true)

    fireEvent.pointerLeave(palette, { pointerType: 'mouse' })
    expect(palette.classList.contains('open')).toBe(false)

    fireEvent.focus(trigger)
    expect(palette.classList.contains('open')).toBe(true)
    fireEvent.keyDown(palette, { key: 'Escape' })
    expect(palette.classList.contains('open')).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('stays open while a control has focus and closes after an outside pointer action', () => {
    render(
      <>
        <FloatingHoverPalette label="ズーム" valueLabel="400%">
          <input aria-label="ズームスライダー" type="range" />
        </FloatingHoverPalette>
        <button type="button">外側</button>
      </>,
    )
    const palette = screen.getByRole('group', { name: 'ズーム' })
    const slider = screen.getByRole('slider', { name: 'ズームスライダー' })
    slider.focus()
    fireEvent.focus(slider)
    fireEvent.pointerLeave(palette, { pointerType: 'mouse' })
    expect(palette.classList.contains('open')).toBe(true)

    fireEvent.pointerDown(screen.getByRole('button', { name: '外側' }))
    expect(palette.classList.contains('open')).toBe(false)
  })
})
