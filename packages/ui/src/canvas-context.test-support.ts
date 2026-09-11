/** Vitest infers only the final overload after CanvasKit adds WebGPU's overload. */
export function canvasContextPrototype(): {
  getContext(contextId: string, options?: unknown): RenderingContext | GPUCanvasContext | null
} {
  return HTMLCanvasElement.prototype
}
