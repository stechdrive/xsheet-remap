export function normalizeRecentValueHistory(values: readonly string[], limit: number): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const raw of values) {
    const value = raw.trim()
    const identity = value.toLocaleLowerCase('ja-JP')
    if (!value || seen.has(identity)) continue
    seen.add(identity)
    normalized.push(value)
    if (normalized.length >= Math.max(1, Math.round(limit))) break
  }
  return normalized
}

export function recordRecentValue(history: readonly string[], value: string, limit: number): string[] {
  return normalizeRecentValueHistory([value, ...history], limit)
}

export function recentValuesWithPinned(history: readonly string[], pinned: readonly string[], limit: number): string[] {
  return normalizeRecentValueHistory([...history, ...pinned], limit + pinned.length)
}

export function loadRecentValueHistory(storageKey: string, limit: number): string[] {
  try {
    const stored = window.localStorage.getItem(storageKey)
    return stored ? normalizeRecentValueHistory(JSON.parse(stored) as string[], limit) : []
  } catch {
    return []
  }
}

export function saveRecentValueHistory(storageKey: string, history: readonly string[], limit: number): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(normalizeRecentValueHistory(history, limit)))
  } catch {
    // Optional in restricted browser contexts.
  }
}
