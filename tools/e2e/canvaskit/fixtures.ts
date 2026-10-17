import { test as base, expect, type Page } from '@playwright/test'
export { expect }
export type { Page } from '@playwright/test'

export const test = base.extend<{ browserDiagnostics: void }>({
  browserDiagnostics: [async ({ context }, runWithDiagnostics, info) => {
    const errors: string[] = []
    const failedRequests: Array<{ url: string; resourceType: string; error: string | null }> = []
    const observed = new WeakSet<Page>()
    const observePage = (target: Page) => {
      if (observed.has(target)) return
      observed.add(target)
      target.on('pageerror', error => errors.push(`[${target.url()}] ${error.message}`))
      target.on('requestfailed', request => failedRequests.push({ url: request.url(), resourceType: request.resourceType(), error: request.failure()?.errorText ?? null }))
    }
    context.pages().forEach(observePage)
    context.on('page', observePage)
    await context.addInitScript(() => {
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
    try { await runWithDiagnostics() } finally {
      context.off('page', observePage)
      if (info.status !== info.expectedStatus || errors.length) {
        const page = context.pages().find(candidate => !candidate.isClosed())
        let timer: ReturnType<typeof setTimeout> | undefined
        const state = await Promise.race([
          page ? page.evaluate(() => ({ diagnostics: Reflect.get(window, '__xsheetBrowserDiagnostics'), visibility: document.visibilityState,
            focused: document.activeElement?.outerHTML.slice(0, 500),
            undo: Array.from(document.querySelectorAll('button[aria-label="元に戻す"]')).map(button => {
              const box = button.getBoundingClientRect()
              return { disabled: button.matches(':disabled'), box: box.toJSON(),
                hit: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.outerHTML.slice(0, 500) }
            }) })).catch(error => ({ diagnosticError: String(error) })) : Promise.resolve({ diagnosticError: 'all pages closed' }),
          new Promise(resolve => { timer = setTimeout(() => resolve({ diagnosticError: 'page did not answer within 2s' }), 2_000) }),
        ]).finally(() => clearTimeout(timer))
        await info.attach('input-and-frame-state', { body: JSON.stringify({ state, errors, failedRequests }, null, 2), contentType: 'application/json' })
      }
      if (info.status === info.expectedStatus) expect(errors, 'unhandled application errors').toEqual([])
    }
  }, { auto: true }],
})
