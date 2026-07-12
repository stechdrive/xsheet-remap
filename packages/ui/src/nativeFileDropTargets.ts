export type NativeCspDropTarget =
  | { kind: 'cel'; keyId: string; slotId?: string }
  | { kind: 'paper-track'; slotId: string }
  | { kind: 'stack-guide'; labelId: string; correctionLayerId: string }

export function isAssetBrowserNativeDropTarget(points: Array<{ x: number; y: number }>): boolean {
  if (document.querySelector('.assetBrowser-dropActive')) return true
  const browsers = Array.from(document.querySelectorAll<HTMLElement>('.assetBrowser'))
  return points.some(point => {
    const target = document.elementFromPoint(point.x, point.y)
    if (target instanceof Element && target.closest('.assetBrowser')) return true
    return browsers.some(browser => {
      const rect = browser.getBoundingClientRect()
      return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
    })
  })
}

export function nativeCspDropTarget(points: Array<{ x: number; y: number }>): NativeCspDropTarget | null {
  for (const point of points) {
    const element = document.elementFromPoint(point.x, point.y)
    if (!(element instanceof Element)) continue
    const cel = element.closest<HTMLElement>('[data-csp-drop-kind="cel"][data-csp-key-id]')
    if (cel) {
      const keyId = cel.dataset.cspKeyId
      if (keyId) return { kind: 'cel', keyId, slotId: cel.dataset.cspSlotId }
    }
    const track = element.closest<HTMLElement>('.cspTreeTrack[data-csp-native-drop-kind]')
    if (!track) continue
    if (track.dataset.cspNativeDropKind === 'paper-track') {
      const slotId = track.dataset.cspSlotId
      if (slotId) return { kind: 'paper-track', slotId }
    }
    if (track.dataset.cspNativeDropKind === 'stack-guide') {
      const labelId = track.dataset.cspStackGuideLabelId
      const correctionLayerId = track.dataset.cspCorrectionLayerId
      if (labelId && correctionLayerId) return { kind: 'stack-guide', labelId, correctionLayerId }
    }
  }
  return null
}
