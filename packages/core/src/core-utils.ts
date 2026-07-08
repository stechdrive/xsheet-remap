export function clampNumberForCore(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>
}

export function nextId(prefix: string, existing: string[]): string {
  const used = new Set(existing)
  let index = existing.length + 1
  let id = `${prefix}_${String(index).padStart(4, '0')}`
  while (used.has(id)) {
    index += 1
    id = `${prefix}_${String(index).padStart(4, '0')}`
  }
  return id
}
