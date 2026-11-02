import { ClipError } from 'celcodec-legacy'
import { codecMessage } from '../material/celcodec'

function errorMessage(error: unknown): never {
  if (error instanceof ClipError) throw new Error('CLIP: ' + codecMessage(error.diagnostic.code, error.diagnostic.data), { cause: error })
  throw error
}
export function codecCall<T>(run: () => T): T {
  try { const value = run(); return value instanceof Promise ? value.catch(errorMessage) as T : value }
  catch (error) { return errorMessage(error) }
}
export function codecFunction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  return (...args) => codecCall(() => fn(...args))
}
