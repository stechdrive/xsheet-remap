import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ActionMenu } from './AppControls'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ActionMenu', () => {
  it('right-aligns a bottom menu when its preferred position would leave the viewport', async () => {
    vi.stubGlobal('innerWidth', 1000)
    vi.stubGlobal('innerHeight', 700)
    render(<ActionMenu label="設定" ariaLabel="設定メニュー"><button type="button">項目</button></ActionMenu>)
    const summary = screen.getByLabelText('設定メニュー')
    vi.spyOn(summary, 'getBoundingClientRect').mockReturnValue({
      x: 980,
      y: 20,
      left: 980,
      right: 1010,
      top: 20,
      bottom: 50,
      width: 30,
      height: 30,
      toJSON: () => ({}),
    })

    fireEvent.click(summary)

    const menu = await screen.findByText('項目')
    await waitFor(() => expect(menu.parentElement?.style.left).toBe('790px'))
  })
})
