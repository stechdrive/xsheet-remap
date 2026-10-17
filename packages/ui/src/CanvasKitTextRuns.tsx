import { useContext, useMemo, type ReactNode } from 'react'
import { CanvasKitModelLayer } from './CanvasKitModelLayer'
import type { DirectPaperModel } from './canvasKitDirectModel'
import { SheetRenderWindowContext } from './useSheetRenderWindow'
import { verticalGlyph } from './verticalTextLayout'

export type PaperTextRun = { value: string; xPx: number; yPx: number; size: number; className?: string; fill?: string
  anchor?: 'start' | 'middle' | 'end'; baseline?: string; vertical?: boolean; weight?: number }
const pixelSpace = { widthPx: 1, heightPx: 1 }

/** Layout is already known by the cue/memo model; avoid measuring every SVG glyph again. */
export function CanvasKitTextRuns({ runs, className, children, pageSize = pixelSpace, preserveNative, viewportHeightPx, textSpans = false }: {
  runs: PaperTextRun[]; className: string; children: ReactNode
  pageSize?: { widthPx: number; heightPx: number }; preserveNative?: boolean; viewportHeightPx?: number; textSpans?: boolean
}) {
  const window = useContext(SheetRenderWindowContext)
  const height = viewportHeightPx ?? (pageSize === pixelSpace ? undefined : pageSize.heightPx)
  const signature = JSON.stringify(runs)
  const model = useMemo<DirectPaperModel>(() => {
    const styles: DirectPaperModel['styles'] = {}
    const visibleRuns = window && height ? runs.filter(run => run.yPx + run.size * 2 >= window.top * height && run.yPx - run.size * 2 <= window.bottom * height) : runs
    const primitives: DirectPaperModel['primitives'] = visibleRuns.map(run => {
      const glyph = run.vertical ? verticalGlyph(run.value, run.weight) : undefined
      const key = `${run.className ?? ''}:${run.fill ?? ''}:${run.baseline ?? 'alphabetic'}:${Boolean(glyph)}`
      // Sample the same SVG text hierarchy: tspan baseline inheritance differs across engines.
      styles[key] = { tag: glyph ? 'path' : 'text', className: run.className ?? '', style: { ...(run.fill ? { fill: run.fill } : {}), ...(glyph ? { vectorEffect: 'non-scaling-stroke' } : {}) },
        baseline: run.baseline ?? 'alphabetic', textSpan: glyph ? false : textSpans }
      if (glyph) return { style: key, coordinateSpace: 'page-pixels', accessibleText: run.value,
        transform: [run.size, 0, 0, run.size, run.xPx - glyph.advance * run.size / 2, run.yPx],
        shape: { kind: 'path', d: glyph.path } }
      return { style: key, text: { value: run.value, x: run.xPx / pageSize.widthPx, y: run.yPx / pageSize.heightPx,
        size: run.size, anchor: run.anchor ?? 'start' } }
    })
    return { pageSize, styles, primitives }
    // Equal text layouts remain stable when pointer handlers or selection change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize, signature, window, height, textSpans])
  return <CanvasKitModelLayer model={model} className={className} preserveNative={preserveNative} fallback={() => children} />
}
