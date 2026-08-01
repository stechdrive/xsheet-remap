import type { CutGroupProjectDocument } from '@xsheet-remap/core'

/**
 * Compares immutable project documents without serializing every unchanged
 * stroke point. Shared subtrees return at the identity check, while a complete
 * structural comparison still lets Undo return the document to a clean state.
 */
export function projectDocumentsEqual(
  left: CutGroupProjectDocument,
  right: CutGroupProjectDocument,
): boolean {
  return jsonValuesEqual(left, right)
}

export function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right || Object.is(left, right)) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => jsonValuesEqual(value, right[index]))
  }

  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = jsonObjectKeys(leftRecord)
  const rightKeys = jsonObjectKeys(rightRecord)
  if (leftKeys.length !== rightKeys.length) return false

  const rightKeySet = new Set(rightKeys)
  for (const key of leftKeys) {
    if (!rightKeySet.has(key) || !jsonValuesEqual(leftRecord[key], rightRecord[key])) return false
  }
  return true
}

function jsonObjectKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter(key => value[key] !== undefined)
}
