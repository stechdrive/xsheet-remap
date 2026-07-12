import type { AssetRoot } from '@xsheet-remap/core'
import { isTauriHost } from '@xsheet-remap/adapters'
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

export function AssetCatalogToolbar({
  root,
  locationLabel,
  canNavigateUp,
  onOpenRoot,
  onNavigateUp,
  onRescan,
  dropActive,
}: {
  root: AssetRoot | null
  locationLabel: string
  canNavigateUp: boolean
  onOpenRoot: () => void
  onNavigateUp: () => void
  onRescan: () => void
  dropActive: boolean
}) {
  if (!isTauriHost()) return null
  return (
    <div className={dropActive ? 'assetCatalogToolbar assetCatalogToolbar-dropActive' : 'assetCatalogToolbar'}>
      <div className="assetCatalogToolbarRow">
        <Tooltip label={root ? uiText.assets.root.changeTitle : uiText.assets.root.addTitle}>
          <button type="button" className="iconOnlyButton" aria-label={root ? uiText.assets.root.change : uiText.assets.root.add} onClick={onOpenRoot}>
            <FolderPlusIcon />
          </button>
        </Tooltip>
        <Tooltip label={canNavigateUp ? uiText.assets.folder.up : uiText.assets.folder.rootHere}>
          <button type="button" className="iconOnlyButton" aria-label={uiText.assets.folder.up} disabled={!canNavigateUp} onClick={onNavigateUp}>
            <FolderUpIcon />
          </button>
        </Tooltip>
        <Tooltip label={locationLabel}>
          <div className="assetLocationText" aria-label={uiText.assets.folder.currentLocation}>{locationLabel}</div>
        </Tooltip>
        {root && (
          <Tooltip label={uiText.assets.root.rescanTitle}>
            <button type="button" className="iconOnlyButton" aria-label={uiText.assets.root.rescan} onClick={onRescan}>
              <RefreshIcon />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  )
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

function RefreshIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 7v5h-5" />
      <path d="M18.2 16a8 8 0 1 1 .5-8.5L20 12" />
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
