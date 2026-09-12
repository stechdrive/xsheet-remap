import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { digitalStandardSheetTemplate, resolveSheetTemplateGridLayout } from '@xsheet-remap/core'
import { createAudioPlayheadStore } from './audioPlayheadStore'
import { SheetPlayheadOverlay } from './SheetPlayheadOverlay'

afterEach(cleanup)
it('updates only the playhead subscriber and suppresses repeated frames', () => {
  const store = createAudioPlayheadStore({ cutId: 'cut_1', frame: 1 })
  const listener = vi.fn(), stop = store.subscribe(listener), shell = vi.fn()
  const template = digitalStandardSheetTemplate
  const layout = resolveSheetTemplateGridLayout(template, template.regions.find(region => region.grid?.role === 'action')!)
  function Host() {
    shell()
    return <SheetPlayheadOverlay store={store} cutId="cut_1" frame={1} page={{ pageId: 'page_1', pageIndex: 0, frameStart: 1, frameEnd: 144 }} continuous layout={layout} />
  }
  const { container } = render(<Host />)
  const before = container.querySelector('line')!.getAttribute('y1')
  act(() => { store.publish({ cutId: 'cut_1', frame: 10 }); store.publish({ cutId: 'cut_1', frame: 10 }) })
  expect(listener).toHaveBeenCalledOnce()
  expect(shell).toHaveBeenCalledOnce()
  expect(container.querySelector('line')!.getAttribute('y1')).not.toBe(before)
  act(() => store.publish({ cutId: 'cut_2', frame: 40 }))
  expect(container.querySelector('line')!.getAttribute('y1')).toBe(before)
  stop()
})
