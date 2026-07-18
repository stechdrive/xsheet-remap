import type { CutGroupProjectDocument, ProjectExtensionPayload } from './types'

export const PROJECT_ARCHIVE_KIND = 'xsheet-remap-project-archive'
export const PROJECT_ARCHIVE_FORMAT_VERSION = 1

export const PROJECT_ARCHIVE_FEATURE_VERSIONS = {
  'project-core': 1,
  'sheet-revisions': 1,
  'asset-references': 1,
  'timeline-annotations': 1,
  'timed-range-cues': 1,
  'embedded-blobs': 1,
} as const

export interface ProjectArchiveBlobDescriptor {
  blobId: string
  path: string
  mediaType: string
  byteLength: number
  sha256: string
}

export interface ProjectArchiveManifest {
  archiveKind: typeof PROJECT_ARCHIVE_KIND
  formatVersion: typeof PROJECT_ARCHIVE_FORMAT_VERSION
  documentKind: CutGroupProjectDocument['documentKind']
  documentSchemaVersion: number
  projectEntry: 'project.json'
  projectByteLength: number
  projectSha256: string
  features: Record<string, number>
  requiredFeatures: string[]
  blobs: ProjectArchiveBlobDescriptor[]
  createdWith?: string
}

export interface BuildProjectArchiveManifestOptions {
  blobs?: ProjectArchiveBlobDescriptor[]
  createdWith?: string
  projectByteLength?: number
  projectSha256?: string
}

export function buildProjectArchiveManifest(
  document: CutGroupProjectDocument,
  options: BuildProjectArchiveManifestOptions = {},
): ProjectArchiveManifest {
  const features: Record<string, number> = {
    'project-core': PROJECT_ARCHIVE_FEATURE_VERSIONS['project-core'],
    'sheet-revisions': PROJECT_ARCHIVE_FEATURE_VERSIONS['sheet-revisions'],
  }
  const requiredFeatures = ['project-core', 'sheet-revisions']

  if (document.assets.length > 0 || document.assetRoot) {
    features['asset-references'] = PROJECT_ARCHIVE_FEATURE_VERSIONS['asset-references']
    requiredFeatures.push('asset-references')
  }
  if (document.cuts.some(cut => cut.revisions.some(revision => revision.annotations.length > 0 || revision.timelineMemos.length > 0))) {
    features['timeline-annotations'] = PROJECT_ARCHIVE_FEATURE_VERSIONS['timeline-annotations']
    requiredFeatures.push('timeline-annotations')
  }
  if (document.cuts.some(cut => cut.revisions.some(revision => revision.timedRangeCues.length > 0))) {
    features['timed-range-cues'] = PROJECT_ARCHIVE_FEATURE_VERSIONS['timed-range-cues']
    requiredFeatures.push('timed-range-cues')
  }
  if ((options.blobs?.length ?? 0) > 0) {
    features['embedded-blobs'] = PROJECT_ARCHIVE_FEATURE_VERSIONS['embedded-blobs']
    requiredFeatures.push('embedded-blobs')
  }

  for (const [namespace, extension] of Object.entries(document.extensions ?? {})) {
    const featureId = extensionFeatureId(namespace)
    features[featureId] = extension.schemaVersion
    if (extension.required) requiredFeatures.push(featureId)
  }

  return {
    archiveKind: PROJECT_ARCHIVE_KIND,
    formatVersion: PROJECT_ARCHIVE_FORMAT_VERSION,
    documentKind: document.documentKind,
    documentSchemaVersion: document.schemaVersion,
    projectEntry: 'project.json',
    projectByteLength: options.projectByteLength ?? 0,
    projectSha256: options.projectSha256 ?? 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    features,
    requiredFeatures: [...new Set(requiredFeatures)].sort(),
    blobs: options.blobs ?? [],
    createdWith: options.createdWith,
  }
}

export function parseProjectArchiveManifest(input: unknown): ProjectArchiveManifest {
  if (!isRecord(input)
    || input.archiveKind !== PROJECT_ARCHIVE_KIND
    || input.formatVersion !== PROJECT_ARCHIVE_FORMAT_VERSION
    || input.documentKind !== 'xsheet-remap-cut-group-project'
    || input.projectEntry !== 'project.json'
    || !Number.isInteger(input.documentSchemaVersion)
    || !Number.isSafeInteger(input.projectByteLength)
    || Number(input.projectByteLength) < 0
    || typeof input.projectSha256 !== 'string'
    || !/^sha256:[a-f0-9]{64}$/.test(input.projectSha256)
    || !isPositiveIntegerRecord(input.features)
    || !isStringArray(input.requiredFeatures)
    || !Array.isArray(input.blobs)) {
    throw new Error('プロジェクトコンテナのマニフェストが不正です。')
  }

  const blobs = input.blobs.map(parseBlobDescriptor)
  const requiredFeatures = [...new Set(input.requiredFeatures)]
  for (const featureId of requiredFeatures) {
    const version = input.features[featureId]
    if (!Number.isInteger(version)) {
      throw new Error(`必須機能のバージョンがありません: ${featureId}`)
    }
    assertRequiredFeatureSupported(featureId, version)
  }

  return {
    archiveKind: PROJECT_ARCHIVE_KIND,
    formatVersion: PROJECT_ARCHIVE_FORMAT_VERSION,
    documentKind: 'xsheet-remap-cut-group-project',
    documentSchemaVersion: Number(input.documentSchemaVersion),
    projectEntry: 'project.json',
    projectByteLength: Number(input.projectByteLength),
    projectSha256: input.projectSha256,
    features: { ...input.features },
    requiredFeatures,
    blobs,
    createdWith: typeof input.createdWith === 'string' ? input.createdWith : undefined,
  }
}

export function parseProjectExtensions(input: unknown): Record<string, ProjectExtensionPayload> | undefined {
  if (input === undefined) return undefined
  if (!isRecord(input)) throw new Error('プロジェクトの拡張データが不正です。')
  const entries = Object.entries(input).map(([namespace, value]) => {
    if (!isExtensionNamespace(namespace)
      || !isRecord(value)
      || !Number.isInteger(value.schemaVersion)
      || Number(value.schemaVersion) < 1
      || !Object.prototype.hasOwnProperty.call(value, 'data')
      || (value.required !== undefined && typeof value.required !== 'boolean')) {
      throw new Error(`プロジェクトの拡張データが不正です: ${namespace}`)
    }
    return [namespace, {
      schemaVersion: Number(value.schemaVersion),
      required: value.required === true ? true : undefined,
      data: value.data,
    }] as const
  })
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function assertRequiredFeatureSupported(featureId: string, version: number): void {
  if (featureId.startsWith('extension:')) {
    throw new Error(`このアプリが対応していない必須拡張機能です: ${featureId.slice('extension:'.length)}`)
  }
  const supportedVersion = PROJECT_ARCHIVE_FEATURE_VERSIONS[featureId as keyof typeof PROJECT_ARCHIVE_FEATURE_VERSIONS]
  if (!supportedVersion || version > supportedVersion) {
    throw new Error(`このアプリが対応していない必須プロジェクト機能です: ${featureId} v${version}`)
  }
}

function extensionFeatureId(namespace: string): string {
  return `extension:${namespace}`
}

function isExtensionNamespace(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9._-]{1,126}[a-z0-9])?$/i.test(value)
}

function parseBlobDescriptor(input: unknown): ProjectArchiveBlobDescriptor {
  if (!isRecord(input)
    || typeof input.blobId !== 'string'
    || !/^sha256:[a-f0-9]{64}$/.test(input.blobId)
    || typeof input.path !== 'string'
    || !/^blobs\/[a-f0-9]{64}$/.test(input.path)
    || typeof input.mediaType !== 'string'
    || !Number.isSafeInteger(input.byteLength)
    || Number(input.byteLength) < 0
    || input.sha256 !== input.blobId
    || input.path !== `blobs/${input.blobId.slice('sha256:'.length)}`) {
    throw new Error('プロジェクトコンテナのBlob定義が不正です。')
  }
  return {
    blobId: input.blobId,
    path: input.path,
    mediaType: input.mediaType,
    byteLength: Number(input.byteLength),
    sha256: input.sha256,
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function isPositiveIntegerRecord(input: unknown): input is Record<string, number> {
  return isRecord(input) && Object.values(input).every(value => Number.isInteger(value) && Number(value) > 0)
}

function isStringArray(input: unknown): input is string[] {
  return Array.isArray(input) && input.every(value => typeof value === 'string')
}
