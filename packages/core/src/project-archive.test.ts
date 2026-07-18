import { describe, expect, it } from 'vitest'
import {
  buildProjectArchiveManifest,
  createDefaultProjectDocument,
  parseProjectArchiveManifest,
  parseProjectDocument,
} from './index'

describe('project archive contract', () => {
  it('preserves namespaced optional extension payloads', () => {
    const source = createDefaultProjectDocument()
    source.extensions = {
      'studio.example.review': {
        schemaVersion: 2,
        data: { note: 'opaque', flags: [1, 2] },
      },
    }

    expect(parseProjectDocument(source).extensions).toEqual(source.extensions)
    expect(buildProjectArchiveManifest(source).features['extension:studio.example.review']).toBe(2)
  })

  it('rejects malformed extension namespaces', () => {
    const source = createDefaultProjectDocument()
    source.extensions = {
      'invalid namespace': { schemaVersion: 1, data: {} },
    }
    expect(() => parseProjectDocument(source)).toThrow('拡張データ')
  })

  it('refuses unknown required features instead of silently losing them', () => {
    const manifest = buildProjectArchiveManifest(createDefaultProjectDocument())
    manifest.features['future-required-feature'] = 1
    manifest.requiredFeatures.push('future-required-feature')
    expect(() => parseProjectArchiveManifest(manifest)).toThrow('対応していない必須プロジェクト機能')
  })
})
