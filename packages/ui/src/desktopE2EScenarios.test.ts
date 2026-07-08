import { describe, expect, it } from 'vitest'
import {
  buildFullDefaultA3Scenario,
  createFullDefaultA3FixtureRefs,
  FULL_DEFAULT_A3_ASSET_NAMES,
} from './desktopE2EScenarios'

describe('desktop e2e scenarios', () => {
  it('builds the full default A3 project and validates normalized XDTS output', () => {
    const initial = buildFullDefaultA3Scenario(createFullDefaultA3FixtureRefs('C:\\e2e\\assets'))
    const renameResults = initial.normalizationPlan.assetRenames.map(rename => ({
      assetId: rename.assetId,
      renamed: true,
      nextPath: rename.nextPath,
      nextFileName: rename.nextFileName,
    }))
    const scenario = buildFullDefaultA3Scenario(createFullDefaultA3FixtureRefs('C:\\e2e\\assets'), renameResults)

    expect(scenario.project.correctionLayers.map(layer => layer.label)).toEqual(['作画', '演出', '監督', '作監', '料理', '総作監'])
    expect(scenario.project.logicalSheet.paperTracks.map(track => track.paperTrack)).toEqual(['A', 'B', 'C', 'J', 'K', 'L', 'D', 'E', 'F', 'G', 'H', 'I'])
    expect(scenario.project.stackGuideLabels.map(label => label.label)).toEqual(['BG', 'BOOK1', 'BOOK2,3', 'SL1', 'PAN1', 'MEMO1'])
    expect(scenario.project.assetRoots).toHaveLength(1)
    expect(scenario.project.assets.every(asset => asset.rootId === scenario.project.assetRoots[0].rootId)).toBe(true)
    expect(scenario.project.assets.every(asset => Boolean(asset.relativePath))).toBe(true)
    expect(scenario.initialXdts).toContain('A1_ss')
    expect(scenario.normalizedXdts).toContain('A_01_ss')
    expect(scenario.normalizedXdts).toContain('MEMO1_01_ss')
    expect(scenario.normalizedProject.assets.find(asset => asset.originalFileName === 'A1.png')?.relativePath).toBe('A_01.png')
    expect(scenario.report.renameCount).toBe(FULL_DEFAULT_A3_ASSET_NAMES.length)
    expect(scenario.report.checks.length).toBeGreaterThan(1)
  })
})
