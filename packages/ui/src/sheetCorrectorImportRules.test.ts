import { describe, expect, it } from 'vitest'
import {
  defaultSheetCorrectorImportRules,
  matchSheetCorrectorImportCandidates,
  parseStoredSheetCorrectorImportRules,
  sheetCorrectorImportRule,
  sheetCorrectorImportRuleSummary,
  wildcardMatch,
} from './sheetCorrectorImportRules'

describe('sheet corrector import rules', () => {
  it('uses sheet and ts jpg patterns by default', () => {
    expect(defaultSheetCorrectorImportRules()).toEqual([
      { id: 'rule-1', pattern: '*sheet*.jpg', enabled: true },
      { id: 'rule-2', pattern: '*_ts*.jpg', enabled: true },
    ])
  })

  it('matches wildcard patterns case-insensitively', () => {
    expect(wildcardMatch('*sheet?.jpg', 'Cut_SHEET1.JPG')).toBe(true)
    expect(wildcardMatch('*sheet?.jpg', 'Cut_SHEET10.JPG')).toBe(false)
  })

  it('imports direct files without applying folder rules', () => {
    const result = matchSheetCorrectorImportCandidates([
      { name: 'memo.png', sourceKind: 'file' },
      { name: 'cut_ts_001.jpg', sourceKind: 'file' },
      { name: 'memo.png', sourceKind: 'directory-entry' },
      { name: 'cut_sheet.jpg', sourceKind: 'directory-entry' },
      { name: 'cut_ts_001.jpg', sourceKind: 'directory-entry' },
    ], [
      sheetCorrectorImportRule('rule-1', '*sheet*.jpg'),
    ])

    expect(result.targets.map(item => `${item.sourceKind}:${item.name}`)).toEqual([
      'file:memo.png',
      'file:cut_ts_001.jpg',
      'directory-entry:cut_sheet.jpg',
    ])
    expect(result.skippedDirectoryEntries.map(item => item.name)).toEqual(['memo.png', 'cut_ts_001.jpg'])
  })

  it('matches ts jpg folder entries with default rules', () => {
    const result = matchSheetCorrectorImportCandidates([
      { name: 'cut_ts_001.jpg', sourceKind: 'directory-entry' },
      { name: 'cut_ref.jpg', sourceKind: 'directory-entry' },
    ], defaultSheetCorrectorImportRules())

    expect(result.targets.map(item => item.name)).toEqual(['cut_ts_001.jpg'])
    expect(result.skippedDirectoryEntries.map(item => item.name)).toEqual(['cut_ref.jpg'])
  })

  it('treats empty active rules as no filter for folder entries', () => {
    const result = matchSheetCorrectorImportCandidates([
      { name: 'a.png', sourceKind: 'directory-entry' },
      { name: 'b.tif', sourceKind: 'directory-entry' },
    ], [
      sheetCorrectorImportRule('rule-1', ''),
      sheetCorrectorImportRule('rule-2', '*sheet*', false),
    ])

    expect(result.targets.map(item => item.name)).toEqual(['a.png', 'b.tif'])
    expect(sheetCorrectorImportRuleSummary([])).toBe('フィルターなし')
  })

  it('loads new stored rules and migrates legacy single pattern values', () => {
    const stored = JSON.stringify([
      { id: 'a', pattern: '*A*.png', enabled: true },
      { id: 'b', pattern: '*B*.tif', enabled: false },
    ])

    expect(parseStoredSheetCorrectorImportRules(stored)).toEqual([
      { id: 'a', pattern: '*A*.png', enabled: true },
      { id: 'b', pattern: '*B*.tif', enabled: false },
    ])
    expect(parseStoredSheetCorrectorImportRules(null, '*old*.jpg')).toEqual([
      { id: 'rule-1', pattern: '*old*.jpg', enabled: true },
    ])
    expect(parseStoredSheetCorrectorImportRules('[]')).toEqual([])
  })

  it('migrates the legacy default rule without changing custom rules', () => {
    const legacyDefault = JSON.stringify([
      { id: 'rule-1', pattern: '*sheet*.jpg', enabled: true },
    ])
    const custom = JSON.stringify([
      { id: 'rule-1', pattern: '*sheet*.jpg', enabled: true },
      { id: 'custom', pattern: '*main*.jpg', enabled: true },
    ])

    expect(parseStoredSheetCorrectorImportRules(legacyDefault)).toEqual(defaultSheetCorrectorImportRules())
    expect(parseStoredSheetCorrectorImportRules(custom)).toEqual([
      { id: 'rule-1', pattern: '*sheet*.jpg', enabled: true },
      { id: 'custom', pattern: '*main*.jpg', enabled: true },
    ])
  })
})
