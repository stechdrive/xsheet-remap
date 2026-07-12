export type AssetViewMode = 'grid' | 'list'
export type AssetThumbnailSize = 'normal' | 'large'
export type AssetSortDirection = 'asc' | 'desc'

export type AssetRegistrationSummary = {
  badgeLabel: string
  title: string
}

export type DropDiagnosticReport = {
  source: string
  type: string
  target?: string
  paths?: string[]
  fileCount?: number
  position?: { x: number; y: number }
  details?: string
}

export type AssetSelectionIntent = {
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}
