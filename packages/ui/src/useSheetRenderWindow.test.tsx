import { useRef } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sheetRenderWindow, useSheetRenderWindow } from './useSheetRenderWindow'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('sheet page virtualization', () => {
  it('retains page slots, focused editors, capture owners and all print pages', () => {
    let notify: IntersectionObserverCallback
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { notify = callback }
      observe() {} unobserve() {} disconnect() {}
    })
    const pages = Array.from({ length: 100 }, (_, pageIndex) => ({ pageId: `page_${pageIndex + 1}`, pageIndex, frameStart: 144 * pageIndex + 1, frameEnd: 144 * (pageIndex + 1) }))
    function Harness() {
      const viewportRef = useRef<HTMLDivElement>(null)
      const window = useSheetRenderWindow({ pages, mode: 'continuous', activePageIndex: 0, continuous: false, viewportRef, width: 1000, height: 1400 })
      return <div ref={viewportRef}>{window.displayPages.map(page => <div key={page.pageId} data-sheet-page-slot={page.pageId} ref={window.pageRef(page.pageId)}>
        {window.mountedPageIds.has(page.pageId) && <input aria-label={page.pageId} />}
      </div>)}</div>
    }
    const { container } = render(<Harness />)
    const slots = container.querySelectorAll('[data-sheet-page-slot]')
    const report = (index: number, isIntersecting: boolean) => act(() => notify!([{ target: slots[index]!, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(slots).toHaveLength(100)
    expect(container.querySelectorAll('input')).toHaveLength(2)
    report(1, false); report(50, true)
    const editor = container.querySelector<HTMLInputElement>('[aria-label="page_51"]')!
    act(() => editor.focus())
    return act(async () => {
      await Promise.resolve()
      report(50, false)
      expect(container.querySelector('[aria-label="page_51"]')).toBe(editor)
      const capture = new Event('gotpointercapture', { bubbles: true })
      Object.defineProperty(capture, 'pointerId', { value: 1 })
      fireEvent(editor, capture)
      editor.blur(); await Promise.resolve()
      expect(container.querySelector('[aria-label="page_51"]')).toBe(editor)
      const release = new Event('lostpointercapture', { bubbles: true })
      Object.defineProperty(release, 'pointerId', { value: 1 })
      fireEvent(editor, release)
      globalThis.dispatchEvent(new Event('beforeprint'))
      expect(container.querySelectorAll('input')).toHaveLength(100)
      globalThis.dispatchEvent(new Event('afterprint'))
      expect(container.querySelectorAll('input')).toHaveLength(1)
    })
  })
  it('keeps small scrolls in one model window and advances on block boundaries', () => {
    expect(sheetRenderWindow(1100, 1900, 100_000)).toEqual(sheetRenderWindow(1120, 1920, 100_000))
    expect(sheetRenderWindow(4000, 4800, 100_000)).not.toEqual(sheetRenderWindow(1100, 1900, 100_000))
    expect(sheetRenderWindow(0, 800, 1000)).toBeNull()
  })
})
