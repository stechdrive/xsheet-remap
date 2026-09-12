import { createElement, useCallback, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { paperModelReady, registerPaperModel, setPaperModelPrinting, subscribePaperModel, type DirectPaperModel } from './canvasKitDirectModel'

let printListenersInstalled = false
function installPrintListeners() {
  if (printListenersInstalled) return
  printListenersInstalled = true
  window.addEventListener('beforeprint', () => flushSync(() => setPaperModelPrinting(true)))
  window.addEventListener('afterprint', () => flushSync(() => setPaperModelPrinting(false)))
}

/** Only interactive SVG targets remain large; dense paper graphics use a direct geometry model. */
export function CanvasKitModelLayer({ model, className, ariaHidden, fallback, preserveNative = false }: {
  model: DirectPaperModel; className: string; ariaHidden?: boolean; fallback: () => ReactNode; preserveNative?: boolean
}) {
  const [element, setElement] = useState<SVGGElement | null>(null)
  const source = element?.ownerSVGElement ?? null
  const subscribe = useCallback((listener: () => void) => subscribePaperModel(source, listener), [source])
  const ready = useSyncExternalStore(subscribe, () => paperModelReady(source), () => false)
  const accessibleText = useMemo(() => ariaHidden ? '' : model.primitives.flatMap(item => item.text?.value ?? []).join(' '), [ariaHidden, model])
  const supported = typeof SVGGraphicsElement !== 'undefined' && typeof SVGGraphicsElement.prototype.getScreenCTM === 'function'
  useLayoutEffect(() => {
    if (!element || !supported) return
    installPrintListeners()
    return registerPaperModel(element, model)
  }, [element, model, supported])
  return <g ref={setElement} className={className} aria-hidden={ariaHidden}
    data-paper-primitive-count={model.primitives.length}
    role={ready && accessibleText ? 'img' : undefined} aria-label={ready ? accessibleText || undefined : undefined}
    data-paper-direct-model={ready ? 'active' : undefined}>
    {supported && <g data-paper-style-samples="true" aria-hidden="true" pointerEvents="none">
      {Object.entries(model.styles).map(([key, sample]) => createElement('g', { key, className: sample.contextClassName }, createElement(sample.tag, {
        'data-paper-style': sample.textSpan ? undefined : key, className: sample.className, style: sample.style,
        strokeWidth: sample.strokeWidth, dominantBaseline: sample.baseline,
      }, sample.textSpan ? createElement('tspan', { 'data-paper-style': key }) : undefined)))}
    </g>}
    {(!ready || preserveNative) && fallback()}
  </g>
}
