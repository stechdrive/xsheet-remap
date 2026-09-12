// Paste this entire file into the target browser/WebView developer console on
// the actual device. Then reproduce the issue and call xsheetInputEvidence.save().
// No text values, clipboard contents or network requests are recorded.
/* global window, Element, HTMLInputElement, HTMLTextAreaElement, performance, document, navigator, innerWidth, innerHeight, devicePixelRatio, location, URL, Blob, setTimeout */
(() => {
  window.xsheetInputEvidence?.stop()
  const events = []
  const startedAt = new Date().toISOString()
  const types = ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input', 'keydown', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'focusin', 'focusout']
  const record = event => {
    if (event.type === 'pointermove' && !event.buttons && event.pointerType === 'mouse') return
    const target = event.target instanceof Element ? event.target : null
    const editor = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : null
    events.push({ time: performance.now(), type: event.type, trusted: event.isTrusted, inputType: event.inputType,
      isComposing: event.isComposing, pointerType: event.pointerType, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, key: ['Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Process'].includes(event.key) ? event.key : undefined,
      tag: target?.tagName, label: target?.getAttribute('aria-label'), focused: document.activeElement === target,
      valueLength: editor?.value.length, selectionStart: editor?.selectionStart, selectionEnd: editor?.selectionEnd })
    if (events.length > 10000) events.shift()
  }
  types.forEach(type => document.addEventListener(type, record, true))
  const stop = () => types.forEach(type => document.removeEventListener(type, record, true))
  const snapshot = () => ({ schemaVersion: 1, startedAt, userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    app: document.title, path: location.pathname,
    evidenceType: 'manually-operated-device; trusted events alone do not prove OS IME use or successful behavior',
    compositionObserved: events.some(event => event.type === 'compositionstart' && event.trusted), events: [...events] })
  window.xsheetInputEvidence = { stop, snapshot, save: () => {
    stop()
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'xsheet-input-evidence.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } }
})()
