import { describe, expect, it } from 'vitest'
import {
  activeCutProjectFromDocument,
  addBlankSharedCutToProjectDocument,
  buildCspImportPackage,
  createDefaultProject,
  createOrSetEvent,
  createProjectDocumentFromCutProject,
  registerAsset,
  registerAssetRoot,
  setEvent,
  updateActiveCutProjectInDocument,
  upsertBinding,
} from '@xsheet-remap/core'
import { cspImportPackageTextOutputs } from './cspImportPackageOutputs'

describe('cspImportPackageTextOutputs', () => {
  it('includes the setup XDTS referenced by multi-cut CSP import manifests', () => {
    const created = createOrSetEvent({ ...createDefaultProject(), cut: { cut: 'C001', cspTimelineName: '001' } }, 'A', 1, 'action')
    const withRoot = registerAssetRoot(created.project, {
      label: 'materials',
      path: 'D:\\cuts\\shared',
      handleKind: 'directory',
    })
    const withAsset = registerAsset(withRoot.project, {
      name: 'A_01.png',
      path: 'D:\\cuts\\shared\\materials\\A_01.png',
      relativePath: 'materials/A_01.png',
    }, {
      role: 'cell-material',
      relativePath: 'materials/A_01.png',
    })
    const firstCut = upsertBinding(withAsset.project, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      cspCellName: 'A_01',
      materialState: 'assigned',
      assetId: withAsset.asset.assetId,
    })
    let document = createProjectDocumentFromCutProject(firstCut)

    document = addBlankSharedCutToProjectDocument(document, firstCut, { cut: { cut: 'C002', cspTimelineName: '002' } })
    const secondCut = setEvent(activeCutProjectFromDocument(document), 'A', 12, created.key.keyId, 'action')
    document = updateActiveCutProjectInDocument(document, secondCut)

    const packageBuild = buildCspImportPackage(document, { appVersion: 'test' })
    const outputs = cspImportPackageTextOutputs(packageBuild)
    const manifest = JSON.parse(outputs[0]?.contents ?? '{}') as { setup?: { xdts?: string } }

    expect(packageBuild.setupOutput?.xdtsFileName).toBe('_setup.xdts')
    expect(manifest.setup?.xdts).toBe('_setup.xdts')
    expect(outputs.map(output => output.relativePath)).toEqual([
      'csp-import.xci',
      '_setup.xdts',
      'C001.xdts',
      'C002.xdts',
    ])
    expect(outputs.find(output => output.relativePath === '_setup.xdts')?.contents).toContain('A')
  })
})
