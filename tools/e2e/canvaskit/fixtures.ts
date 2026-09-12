import { test as base, expect } from '@playwright/test'
export { expect }
export type { Page } from '@playwright/test'

export const test = base.extend({
  page: async ({ page }, runWithPage, info) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      const diagnostics = { requested: 0, completed: 0, lastFrame: 0, events: [] as unknown[] }
      Object.assign(window, { __xsheetBrowserDiagnostics: diagnostics })
      const request = window.requestAnimationFrame.bind(window)
      window.requestAnimationFrame = callback => {
        diagnostics.requested++
        return request(time => { diagnostics.completed++; diagnostics.lastFrame = performance.now(); callback(time) })
      }
      for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture', 'focusin', 'focusout', 'compositionstart', 'compositionend']) {
        document.addEventListener(type, event => {
          const target = event.target instanceof Element ? event.target : null
          diagnostics.events.push({ type, time: performance.now(), trusted: event.isTrusted,
            pointerType: (event as PointerEvent).pointerType, label: target?.getAttribute('aria-label'), tag: target?.tagName })
          if (diagnostics.events.length > 80) diagnostics.events.shift()
        }, true)
      }
    })
    try { await runWithPage(page) } finally {
      if (info.status !== info.expectedStatus) {
        let timer: ReturnType<typeof setTimeout> | undefined
        const state = await Promise.race([
          page.evaluate(() => ({ diagnostics: Reflect.get(window, '__xsheetBrowserDiagnostics'), visibility: document.visibilityState,
            focused: document.activeElement?.outerHTML.slice(0, 500),
            undo: Array.from(document.querySelectorAll('button[aria-label="元に戻す"]')).map(button => {
              const box = button.getBoundingClientRect()
              return { disabled: button.matches(':disabled'), box: box.toJSON(),
                hit: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.outerHTML.slice(0, 500) }
            }) })).catch(error => ({ diagnosticError: String(error) })),
          new Promise(resolve => { timer = setTimeout(() => resolve({ diagnosticError: 'page did not answer within 2s' }), 2_000) }),
        ]).finally(() => clearTimeout(timer))
        await info.attach('input-and-frame-state', { body: JSON.stringify({ state, errors }, null, 2), contentType: 'application/json' })
      }
      if (info.status === info.expectedStatus) expect(errors, 'unhandled application errors').toEqual([])
    }
  },
})
