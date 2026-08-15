import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ActionMenu } from './AppControls'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ActionMenu', () => {
  it('closes another menu without scheduling an update from inside a state updater', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <>
        <ActionMenu label="1" ariaLabel="1番目のメニュー"><button type="button">1番目の項目</button></ActionMenu>
        <ActionMenu label="2" ariaLabel="2番目のメニュー"><button type="button">2番目の項目</button></ActionMenu>
      </>,
    )

    fireEvent.click(screen.getByLabelText('1番目のメニュー'))
    expect(await screen.findByRole('button', { name: '1番目の項目' })).toBeTruthy()
    fireEvent.click(screen.getByLabelText('2番目のメニュー'))

    expect(await screen.findByRole('button', { name: '2番目の項目' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '1番目の項目' })).toBeNull()
    expect(consoleError).not.toHaveBeenCalled()
  })

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

  it('repositions an open menu when its content grows', async () => {
    vi.stubGlobal('innerWidth', 1000)
    vi.stubGlobal('innerHeight', 700)
    let notifyResize: () => void = () => undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notifyResize = callback }
      observe() {}
      disconnect() {}
    })
    render(<ActionMenu label="紙" ariaLabel="紙シート" placement="right-start"><button type="button">項目</button></ActionMenu>)
    const summary = screen.getByLabelText('紙シート')
    vi.spyOn(summary, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 600, left: 100, right: 130, top: 600, bottom: 630, width: 30, height: 30, toJSON: () => ({}),
    })
    fireEvent.click(summary)

    const content = (await screen.findByText('項目')).parentElement!
    Object.defineProperty(content, 'offsetHeight', { configurable: true, value: 400 })
    notifyResize()

    await waitFor(() => expect(content.style.top).toBe('292px'))
  })

  it('moves keyboard focus into portaled content and restores it on Escape', async () => {
    render(<ActionMenu label="紙" ariaLabel="紙シート"><button type="button">画像を追加</button></ActionMenu>)
    const summary = screen.getByLabelText('紙シート')
    summary.focus()
    fireEvent.click(summary)
    const item = await screen.findByRole('button', { name: '画像を追加' })
    await waitFor(() => expect(document.activeElement).toBe(item))
    const escapedAtWindow = vi.fn()
    window.addEventListener('keydown', escapedAtWindow)

    fireEvent.keyDown(item, { key: 'Escape' })

    await waitFor(() => expect(document.activeElement).toBe(summary))
    expect(screen.queryByRole('button', { name: '画像を追加' })).toBeNull()
    expect(escapedAtWindow).not.toHaveBeenCalled()
    window.removeEventListener('keydown', escapedAtWindow)
  })

  it('intercepts Escape before focus has moved into the portaled content', async () => {
    render(<ActionMenu label="紙" ariaLabel="紙シート"><button type="button">画像を追加</button></ActionMenu>)
    const summary = screen.getByLabelText('紙シート')
    const escapedAtWindow = vi.fn()
    window.addEventListener('keydown', escapedAtWindow)

    fireEvent.click(summary)
    expect(await screen.findByRole('button', { name: '画像を追加' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => expect(document.activeElement).toBe(summary))
    expect(screen.queryByRole('button', { name: '画像を追加' })).toBeNull()
    expect(escapedAtWindow).not.toHaveBeenCalled()
    window.removeEventListener('keydown', escapedAtWindow)
  })
})
