export type SheetCorrectorImportSourceKind = 'file' | 'directory-entry' | 'browser-file'

export type SheetCorrectorImportRule = {
  id: string
  pattern: string
  enabled: boolean
}

export type SheetCorrectorImportCandidate = {
  name: string
  sourceKind: SheetCorrectorImportSourceKind
}

export type SheetCorrectorImportMatchResult<T extends SheetCorrectorImportCandidate> = {
  targets: T[]
  directFiles: T[]
  matchedDirectoryEntries: T[]
  skippedDirectoryEntries: T[]
}

export const DEFAULT_SHEET_IMPORT_RULE_PATTERN = '*sheet*.jpg'
export const DEFAULT_SHEET_IMPORT_RULE_PATTERNS = [DEFAULT_SHEET_IMPORT_RULE_PATTERN, '*_ts*.jpg'] as const
export const SHEET_CORRECTOR_IMPORT_RULES_STORAGE_KEY = 'xsheet-remap.sheet-corrector.importRules'
export const LEGACY_SHEET_CORRECTOR_PATTERN_STORAGE_KEY = 'xsheet-remap.sheet-corrector.matchPattern'

export function defaultSheetCorrectorImportRules(): SheetCorrectorImportRule[] {
  return DEFAULT_SHEET_IMPORT_RULE_PATTERNS.map((pattern, index) => sheetCorrectorImportRule(`rule-${index + 1}`, pattern))
}

export function sheetCorrectorImportRule(id: string, pattern = '', enabled = true): SheetCorrectorImportRule {
  return { id, pattern, enabled }
}

export function parseStoredSheetCorrectorImportRules(value: string | null, legacyValue: string | null = null): SheetCorrectorImportRule[] {
  if (value) {
    try {
      const parsed = JSON.parse(value) as unknown
      const rules = normalizeSheetCorrectorImportRules(parsed)
      if (Array.isArray(parsed) || rules.length > 0) return migrateDefaultSheetCorrectorImportRules(rules)
    } catch {
      return migrateDefaultSheetCorrectorImportRules(normalizeSheetCorrectorImportRules(value))
    }
  }
  if (legacyValue !== null) return migrateDefaultSheetCorrectorImportRules(normalizeSheetCorrectorImportRules(legacyValue))
  return defaultSheetCorrectorImportRules()
}

export function normalizeSheetCorrectorImportRules(value: unknown): SheetCorrectorImportRule[] {
  if (typeof value === 'string') {
    return [sheetCorrectorImportRule('rule-1', value)]
  }
  if (!Array.isArray(value)) return []
  const rules = value
    .map((item, index): SheetCorrectorImportRule | null => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const id = typeof record.id === 'string' && record.id.trim()
        ? record.id
        : `rule-${index + 1}`
      const pattern = typeof record.pattern === 'string' ? record.pattern : ''
      const enabled = typeof record.enabled === 'boolean' ? record.enabled : true
      return sheetCorrectorImportRule(id, pattern, enabled)
    })
    .filter((rule): rule is SheetCorrectorImportRule => Boolean(rule))
  return dedupeRuleIds(rules)
}

export function activeSheetCorrectorImportPatterns(rules: SheetCorrectorImportRule[]): string[] {
  return rules
    .filter(rule => rule.enabled)
    .map(rule => rule.pattern.trim())
    .filter(Boolean)
}

export function sheetCorrectorImportRuleSummary(rules: SheetCorrectorImportRule[]): string {
  const patterns = activeSheetCorrectorImportPatterns(rules)
  return patterns.length === 0 ? 'フィルターなし' : patterns.join(' / ')
}

export function matchSheetCorrectorImportCandidates<T extends SheetCorrectorImportCandidate>(
  inputs: T[],
  rules: SheetCorrectorImportRule[],
): SheetCorrectorImportMatchResult<T> {
  const directFiles: T[] = []
  const matchedDirectoryEntries: T[] = []
  const skippedDirectoryEntries: T[] = []

  for (const input of inputs) {
    if (input.sourceKind !== 'directory-entry') {
      directFiles.push(input)
      continue
    }
    if (matchesSheetCorrectorImportRules(input.name, rules)) {
      matchedDirectoryEntries.push(input)
    } else {
      skippedDirectoryEntries.push(input)
    }
  }

  return {
    targets: [...directFiles, ...matchedDirectoryEntries],
    directFiles,
    matchedDirectoryEntries,
    skippedDirectoryEntries,
  }
}

export function matchesSheetCorrectorImportRules(name: string, rules: SheetCorrectorImportRule[]): boolean {
  const patterns = activeSheetCorrectorImportPatterns(rules)
  return patterns.length === 0 || patterns.some(pattern => wildcardMatch(pattern, name))
}

export function wildcardMatch(pattern: string, text: string): boolean {
  const patternChars = pattern.toLowerCase().split('')
  const textChars = text.toLowerCase().split('')
  let previous = Array(textChars.length + 1).fill(false) as boolean[]
  previous[0] = true
  for (const patternChar of patternChars) {
    const current = Array(textChars.length + 1).fill(false) as boolean[]
    if (patternChar === '*') current[0] = previous[0]
    for (let index = 0; index < textChars.length; index += 1) {
      if (patternChar === '*') {
        current[index + 1] = previous[index + 1] || current[index]
      } else if (patternChar === '?' || patternChar === textChars[index]) {
        current[index + 1] = previous[index]
      }
    }
    previous = current
  }
  return previous[textChars.length]
}

function dedupeRuleIds(rules: SheetCorrectorImportRule[]): SheetCorrectorImportRule[] {
  const seen = new Set<string>()
  return rules.map((rule, index) => {
    if (!seen.has(rule.id)) {
      seen.add(rule.id)
      return rule
    }
    let id = `rule-${index + 1}`
    while (seen.has(id)) id = `rule-${index + 1}-${seen.size + 1}`
    seen.add(id)
    return { ...rule, id }
  })
}

function migrateDefaultSheetCorrectorImportRules(rules: SheetCorrectorImportRule[]): SheetCorrectorImportRule[] {
  if (rules.length !== 1) return rules
  const [rule] = rules
  if (!rule.enabled || rule.pattern.trim() !== DEFAULT_SHEET_IMPORT_RULE_PATTERN) return rules
  return defaultSheetCorrectorImportRules()
}
