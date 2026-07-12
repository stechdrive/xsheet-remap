import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAssetBrowserNativeDropTarget, nativeCspDropTarget } from './nativeFileDropTargets'

afterEach(() => {
  document.body.innerHTML = ''
  Reflect.deleteProperty(document, 'elementFromPoint')
  vi.restoreAllMocks()
})

function mockElementFromPoint(...elements: Element[]) {
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn()
      .mockReturnValueOnce(elements[0] ?? null)
      .mockReturnValueOnce(elements[1] ?? elements[0] ?? null),
  })
}

describe('native file drop targets', () => {
  it('recognizes an asset browser descendant', () => {
    document.body.innerHTML = '<section class="assetBrowser"><div id="target"></div></section>'
    const target = document.querySelector('#target')!
    mockElementFromPoint(target)

    expect(isAssetBrowserNativeDropTarget([{ x: 10, y: 20 }])).toBe(true)
  })

  it('prioritizes an existing CSP card over its track', () => {
    document.body.innerHTML = `
      <div class="cspTreeTrack" data-csp-native-drop-kind="paper-track" data-csp-slot-id="slot-a">
        <div id="target" data-csp-drop-kind="cel" data-csp-key-id="key-a" data-csp-slot-id="slot-a"></div>
      </div>
    `
    const target = document.querySelector('#target')!
    mockElementFromPoint(target)

    expect(nativeCspDropTarget([{ x: 10, y: 20 }])).toEqual({
      kind: 'cel',
      keyId: 'key-a',
      slotId: 'slot-a',
    })
  })

  it('recognizes CSP paper and stack-guide tracks', () => {
    document.body.innerHTML = `
      <div id="paper" class="cspTreeTrack" data-csp-native-drop-kind="paper-track" data-csp-slot-id="slot-a"></div>
      <div id="guide" class="cspTreeTrack" data-csp-native-drop-kind="stack-guide" data-csp-stack-guide-label-id="guide-a" data-csp-correction-layer-id="layer-a"></div>
    `
    const paper = document.querySelector('#paper')!
    const guide = document.querySelector('#guide')!
    mockElementFromPoint(paper, guide)

    expect(nativeCspDropTarget([{ x: 10, y: 20 }])).toEqual({ kind: 'paper-track', slotId: 'slot-a' })
    expect(nativeCspDropTarget([{ x: 30, y: 40 }])).toEqual({
      kind: 'stack-guide',
      labelId: 'guide-a',
      correctionLayerId: 'layer-a',
    })
  })
})
