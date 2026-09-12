import type { GrDirectContext } from 'canvaskit-wasm'

const contexts = new Map<GrDirectContext, SVGSVGElement>()
const TOTAL_CACHE_BYTES = 72 * 1024 * 1024
const MAX_CONTEXT_BYTES = 24 * 1024 * 1024

/** The cache budget belongs to the application, including template previews. */
export function registerPaperGpu(context: GrDirectContext, source: SVGSVGElement) {
  contexts.set(context, source)
  rebalance()
}
export function unregisterPaperGpu(context: GrDirectContext) {
  const source = contexts.get(context)
  if (source) source.dataset.canvaskitGpuCacheLimitBytes = '0'
  contexts.delete(context)
  rebalance()
}
function rebalance() {
  const bytes = Math.min(MAX_CONTEXT_BYTES, Math.floor(TOTAL_CACHE_BYTES / Math.max(1, contexts.size)))
  for (const [context, source] of contexts) {
    context.setResourceCacheLimitBytes(bytes)
    source.dataset.canvaskitGpuCacheLimitBytes = String(bytes)
  }
}
