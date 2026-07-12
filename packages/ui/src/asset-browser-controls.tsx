import type { AssetRoot } from '@xsheet-remap/core'
import { isTauriHost, type AssetDirectoryListing } from '@xsheet-remap/adapters'
import { uiText } from './i18n'
import { Tooltip } from './Tooltip'
import type { AssetSortDirection, AssetThumbnailSize, AssetViewMode } from './asset-browser-types'

export function AssetViewControls({
  viewMode,
  thumbnailSize,
  sortDirection,
  onViewModeChange,
  onThumbnailSizeChange,
  onSortDirectionToggle,
}: {
  viewMode: AssetViewMode
  thumbnailSize: AssetThumbnailSize
  sortDirection: AssetSortDirection
  onViewModeChange: (mode: AssetViewMode) => void
  onThumbnailSizeChange: (size: AssetThumbnailSize) => void
  onSortDirectionToggle: () => void
}) {
  return (
    <div className="assetBrowserControls">
      <div className="iconSegmentedControl" role="group" aria-label={uiText.assets.viewMode}>
        <Tooltip label={uiText.assets.view.gridTitle}>
          <button
            type="button"
            className={viewMode === 'grid' ? 'active' : ''}
            aria-label={uiText.assets.view.gridTitle}
            onClick={() => onViewModeChange('grid')}
          >
            <GridViewIcon />
          </button>
        </Tooltip>
        <Tooltip label={uiText.assets.view.listTitle}>
          <button
            type="button"
            className={viewMode === 'list' ? 'active' : ''}
            aria-label={uiText.assets.view.listTitle}
            onClick={() => onViewModeChange('list')}
          >
            <ListViewIcon />
          </button>
        </Tooltip>
      </div>
      <div className="iconSegmentedControl" role="group" aria-label={uiText.assets.thumbnailSize}>
        <Tooltip label={uiText.assets.size.normalTitle}>
          <button
            type="button"
            className={thumbnailSize === 'normal' ? 'active' : ''}
            aria-label={uiText.assets.size.normalTitle}
            onClick={() => onThumbnailSizeChange('normal')}
          >
            <ThumbnailNormalIcon />
          </button>
        </Tooltip>
        <Tooltip label={uiText.assets.size.largeTitle}>
          <button
            type="button"
            className={thumbnailSize === 'large' ? 'active' : ''}
            aria-label={uiText.assets.size.largeTitle}
            onClick={() => onThumbnailSizeChange('large')}
          >
            <ThumbnailLargeIcon />
          </button>
        </Tooltip>
      </div>
      <Tooltip label={sortDirection === 'asc' ? uiText.assets.sort.ascendingTitle : uiText.assets.sort.descendingTitle}>
        <button
          type="button"
          className="assetSortButton"
          aria-label={sortDirection === 'asc' ? uiText.assets.sort.toDescending : uiText.assets.sort.toAscending}
          onClick={onSortDirectionToggle}
        >
          <SortDirectionIcon direction={sortDirection} />
        </button>
      </Tooltip>
    </div>
  )
}

export function AssetFileBrowser({
  roots,
  activeRoot,
  listing,
  loading,
  error,
  onRootChange,
  onOpenRoot,
  onNavigate,
  onImportCurrent,
  dropActive,
}: {
  roots: AssetRoot[]
  activeRoot: AssetRoot | null
  listing: AssetDirectoryListing | null
  loading: boolean
  error: string | null
  onRootChange: (rootId: string) => void
  onOpenRoot: () => void
  onNavigate: (path: string) => void
  onImportCurrent: (recursive: boolean) => void
  dropActive: boolean
}) {
  if (!isTauriHost()) return null
  const crumbs = listing ? breadcrumbParts(listing.rootPath, listing.currentPath) : []
  return (
    <div className={dropActive ? 'assetFileBrowser assetFileBrowser-dropActive' : 'assetFileBrowser'}>
      <div className="assetFileBrowserToolbar">
        <Tooltip label={uiText.assets.root.addTitle}>
          <button type="button" className="iconOnlyButton" aria-label={uiText.assets.root.add} onClick={onOpenRoot}>
            <FolderPlusIcon />
          </button>
        </Tooltip>
        {roots.length > 0 && (
          <Tooltip label={uiText.assets.root.selectTitle}>
            <label className="assetRootSelectLabel">
              <FolderIcon />
              <select aria-label={uiText.assets.root.selectTitle} value={activeRoot?.rootId ?? ''} onChange={event => onRootChange(event.currentTarget.value)}>
                {roots.map(root => (
                  <option key={root.rootId} value={root.rootId}>{root.label}</option>
                ))}
              </select>
            </label>
          </Tooltip>
        )}
        {listing && (
          <div className="assetFileBrowserActions">
            <Tooltip label={uiText.assets.folder.importCurrent}>
              <button type="button" className="iconOnlyButton" aria-label={uiText.assets.folder.importCurrent} onClick={() => onImportCurrent(false)}>
                <ImageImportIcon />
              </button>
            </Tooltip>
            <Tooltip label={uiText.assets.folder.importRecursive}>
              <button type="button" className="iconOnlyButton" aria-label={uiText.assets.folder.importRecursive} onClick={() => onImportCurrent(true)}>
                <RecursiveImportIcon />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
      {listing && (
        <div className="assetLocationBar">
          <Tooltip label={listing.parentPath ? uiText.assets.folder.up : uiText.assets.folder.rootHere}>
            <button
              type="button"
              className="iconOnlyButton"
              aria-label={uiText.assets.folder.up}
              disabled={!listing.parentPath}
              onClick={() => {
                if (listing.parentPath) onNavigate(listing.parentPath)
              }}
            >
              <FolderUpIcon />
            </button>
          </Tooltip>
          <div className="assetBreadcrumb" aria-label={uiText.assets.folder.breadcrumb}>
            {crumbs.map((crumb, index) => (
              <Tooltip key={`${crumb.path}:${index}`} label={uiText.assets.folder.breadcrumbTitle(crumb.label)}>
                <button
                  type="button"
                  disabled={index === crumbs.length - 1}
                  onClick={() => onNavigate(crumb.path)}
                >
                  {crumb.label}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>
      )}
      {loading && <p className="muted assetFileBrowserMessage">{uiText.assets.folder.loading}</p>}
      {error && <p className="assetFileBrowserError">{error}</p>}
    </div>
  )
}

function breadcrumbParts(rootPath: string, currentPath: string): Array<{ label: string; path: string }> {
  const rootLabel = fileNameFromPath(rootPath) || rootPath
  const normalizedRoot = normalizePathForDisplay(rootPath)
  const normalizedCurrent = normalizePathForDisplay(currentPath)
  if (normalizedCurrent === normalizedRoot) return [{ label: rootLabel, path: rootPath }]
  const suffix = normalizedCurrent.startsWith(`${normalizedRoot}/`) ? normalizedCurrent.slice(normalizedRoot.length + 1) : ''
  const parts = suffix.split('/').filter(Boolean)
  const crumbs = [{ label: rootLabel, path: rootPath }]
  let path = rootPath
  for (const part of parts) {
    path = `${path.replace(/[\\/]+$/, '')}\\${part}`
    crumbs.push({ label: part, path })
  }
  return crumbs
}

function normalizePathForDisplay(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function isPathInsideRoot(path: string, rootPath: string): boolean {
  const normalizedPath = normalizePathForDisplay(path)
  const normalizedRoot = normalizePathForDisplay(rootPath)
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function fileNameFromPath(path: string): string {
  return normalizePathForDisplay(path).split('/').filter(Boolean).pop() ?? ''
}

function SortDirectionIcon({ direction }: { direction: AssetSortDirection }) {
  return (
    <svg className="assetSortIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={direction === 'asc' ? 'M8 18V6m0 0L4.5 9.5M8 6l3.5 3.5' : 'M8 6v12m0 0l-3.5-3.5M8 18l3.5-3.5'} />
      <path d="M14 7h6M14 12h4.5M14 17h3" />
    </svg>
  )
}

function GridViewIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </svg>
  )
}

function ListViewIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  )
}

function ThumbnailNormalIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <path d="m8 16 2.2-2.5 2 2 1.2-1.3L16 17" />
    </svg>
  )
}

function ThumbnailLargeIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m7 17 3.2-3.7 2.7 2.8 1.8-2 3.3 3.9" />
    </svg>
  )
}

function FolderPlusIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7.5h7l2 2h9v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M15 13h5M17.5 10.5v5" />
    </svg>
  )
}

function FolderUpIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7.5h7l2 2h9v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="m12 16 3-3 3 3M15 13v6" />
    </svg>
  )
}

function ImageImportIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="12" height="14" rx="2" />
      <path d="m7 16 2.5-3 2 2.2 1.2-1.4 2.3 2.2" />
      <path d="M18 8v8M15 13l3 3 3-3" />
    </svg>
  )
}

function RecursiveImportIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6.5h6l1.7 2H20v4" />
      <path d="M4 10h7l1.7 2H20v6H4Z" />
      <path d="m15 15 2 2 2-2" />
    </svg>
  )
}

export function FolderIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7h7l2 2h9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  )
}

export function ImageFileIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <path d="m8 16 2.5-3 2 2.2 1.2-1.4L17 17" />
      <path d="M9 8h.01" />
    </svg>
  )
}

export function GenericFileIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h7l4 4v14H7Z" />
      <path d="M14 3v5h4" />
    </svg>
  )
}
