import { describe, expect, it } from 'vitest'
import { createDefaultProject, createProjectDocumentFromCutProject, createUnplacedCspCard, registerAssetRoot } from '@xsheet-remap/core'
import type { BrowserCspImportPackage } from './browserCspImportPackage'
import { createCspImportExportPlan, publicNativePath } from './cspImportExportPlan'

describe('createCspImportExportPlan', () => {
  it('uses the verified cut folder as a deterministic native package destination', async () => {
    const created = createUnplacedCspCard(createDefaultProject(), {
      slotId: 'slot_A',
      cspCellName: 'A1',
      sheetRole: 'action',
    })
    const rooted = registerAssetRoot(created.project, { label: 'C001', path: 'D:\\cuts\\C001' })
    const plan = await createCspImportExportPlan(createProjectDocumentFromCutProject(rooted.project), {}, {
      nativeHost: true,
      statPaths: async paths => paths.map((path, index) => ({ path, exists: true, isDirectory: index === 0, isFile: index > 0 })),
    })

    expect(plan.target).toEqual({
      mode: 'native-cut-folder',
      rootPath: 'D:\\cuts\\C001',
      outputDirectoryPath: 'D:\\cuts\\C001\\xsheet-csp-import',
      manifestPath: 'D:\\cuts\\C001\\xsheet-csp-import\\csp-import.xci',
    })
    expect(plan.materialSummary).toMatchObject({ availableCount: 0, keyOnlyCount: 0, unavailableAssignedCount: 0 })
    expect(plan.advisories).toEqual([])
  })

  it('requires reconnection when a desktop project root is unavailable', async () => {
    const rooted = registerAssetRoot(createDefaultProject(), { label: 'C001', path: 'D:\\offline\\C001' })
    const plan = await createCspImportExportPlan(createProjectDocumentFromCutProject(rooted.project), {}, {
      nativeHost: true,
      statPaths: async paths => paths.map(path => ({ path, exists: false, isDirectory: false, isFile: false })),
    })

    expect(plan.target).toMatchObject({ mode: 'native-root-unavailable', rootPath: 'D:\\offline\\C001' })
    expect(plan.blockingIssues.some(issue => issue.code === 'cspImport.assetRoot.unavailable')).toBe(true)
  })

  it('uses a portable ZIP target in the browser without requiring a native root', async () => {
    const packageBuild = {
      outputDirectoryName: 'xsheet-csp-import',
      manifestFileName: 'csp-import.xci',
      manifest: { schemaVersion: 4, createdBy: { app: 'xsheet-remap' }, assetRoot: '..', cuts: [] },
      cutOutputs: [],
      materialSummary: { withMaterialCount: 0, keyOnlyCount: 0, unavailableAssignedCount: 0 },
      issues: [],
    } as BrowserCspImportPackage['packageBuild']
    const plan = await createCspImportExportPlan(createProjectDocumentFromCutProject(createDefaultProject()), {}, {
      nativeHost: false,
      buildPortable: async () => ({
        packageBuild,
        archiveBytes: new Uint8Array([1, 2, 3]),
        archiveFileName: 'xsheet-csp-import.zip',
      }),
    })

    expect(plan.target).toEqual({ mode: 'portable-zip', archiveFileName: 'xsheet-csp-import.zip' })
    expect(plan.blockingIssues).toEqual([])
  })

  it('removes Windows device namespace prefixes from display paths', () => {
    expect(publicNativePath('\\\\?\\C:\\cuts\\C001')).toBe('C:\\cuts\\C001')
    expect(publicNativePath('\\\\?\\UNC\\server\\share\\C001')).toBe('\\\\server\\share\\C001')
  })
})
