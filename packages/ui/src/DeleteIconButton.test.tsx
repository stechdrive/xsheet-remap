import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DeleteIconButton } from './DeleteIconButton'

afterEach(() => cleanup())

describe('DeleteIconButton', () => {
  it('uses the shared outline trash icon and destructive button contract', () => {
    render(<DeleteIconButton label="工程を削除" />)
    const button = screen.getByRole('button', { name: '工程を削除' })
    const icon = button.querySelector('svg')

    expect(button.classList.contains('deleteIconButton')).toBe(true)
    expect(icon?.classList.contains('trashIcon')).toBe(true)
    expect(icon?.querySelectorAll('path')).toHaveLength(4)
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
  })
})
