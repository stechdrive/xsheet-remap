import { type KeyboardEvent, type MouseEvent } from 'react'
import type { CutAsset } from '@xsheet-remap/core'
import { type AssetDirectoryEntry } from '@xsheet-remap/adapters'
import { uiText } from './i18n'
import { Tooltip, TooltipTarget } from './Tooltip'
import { startInternalPointerDrag } from './internalDrag'
import type { AssetRegistrationSummary, AssetViewMode } from './asset-browser-types'
import { createAssetDragImage } from './asset-browser-model'
import { FolderIcon, GenericFileIcon, ImageFileIcon } from './asset-browser-controls'

export function AssetDirectoryCard({
  entry,
  asset,
  registration,
  viewMode,
  isSelected,
  isDragging,
  onNavigate,
  onEnsureAsset,
  onSelect,
  onKeyboardSelect,
  onDragStateChange,
  onDragStart,
  onContextMenu,
  onPreview,
}: {
  entry: AssetDirectoryEntry
  asset: CutAsset | null
  registration?: AssetRegistrationSummary
  viewMode: AssetViewMode
  isSelected: boolean
  isDragging: boolean
  onNavigate: (path: string) => void
  onEnsureAsset: () => CutAsset | null
  onSelect: (event: MouseEvent<HTMLElement>) => void
  onKeyboardSelect: (event: KeyboardEvent<HTMLElement>) => void
  onDragStateChange: (isDragging: boolean, assetIds: string[]) => void
  onDragStart: () => string[]
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void
  onPreview: () => void
}) {
  const isFileAsset = entry.kind === 'file' && entry.isSupportedImage
  const isUnsupportedFile = entry.kind === 'file' && !entry.isSupportedImage
  const title = [entry.relativePath || entry.name, registration?.title].filter(Boolean).join('\n')
  const displayName = asset?.displayName ?? entry.name

  return (
    <article
      className={[
        'assetCard',
        'assetDirectoryCard',
        viewMode === 'list' ? 'list' : '',
        entry.kind === 'directory' ? 'directory' : '',
        isUnsupportedFile ? 'unsupported' : '',
        isSelected ? 'selected' : '',
        isDragging ? 'dragging' : '',
      ].filter(Boolean).join(' ')}
      tabIndex={0}
      draggable={false}
      aria-selected={isSelected}
      onPointerDown={event => {
        const dragSource = event.currentTarget
        if (!isFileAsset) return
        startInternalPointerDrag(event, {
          begin: () => {
            const draggedAssetIds = onDragStart()
            return draggedAssetIds.length > 0 ? { kind: 'asset', assetIds: draggedAssetIds } : null
          },
          onStarted: payload => {
            if (payload.kind === 'asset') onDragStateChange(true, payload.assetIds)
          },
          onFinished: payload => {
            if (payload.kind === 'asset') onDragStateChange(false, payload.assetIds)
          },
          createDragGhost: () => createAssetDragImage(dragSource),
          sourceScrollElement: dragSource.closest<HTMLElement>('.assetBrowserItems'),
        })
      }}
      onClick={event => {
        if (entry.kind === 'directory') {
          onNavigate(entry.path)
          return
        }
        onSelect(event)
      }}
      onDoubleClick={() => {
        if (entry.kind === 'directory') return
        if (isFileAsset) onEnsureAsset()
      }}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        if (entry.kind === 'directory') {
          onNavigate(entry.path)
          return
        }
        onKeyboardSelect(event)
      }}
      onContextMenu={onContextMenu}
    >
      {isFileAsset && (
        <TooltipTarget label={uiText.assets.quickPreview}>
          {tooltipProps => (
            <button
              {...tooltipProps}
              type="button"
              className="assetQuickPreviewButton"
              aria-label={uiText.assets.quickPreview}
              draggable={false}
              onPointerDown={event => {
                event.stopPropagation()
                tooltipProps.onPointerDown()
              }}
              onClick={event => {
                event.stopPropagation()
                onPreview()
              }}
              onDragStart={event => {
                event.preventDefault()
                event.stopPropagation()
              }}
            >
              <span className="assetQuickPreviewIcon" aria-hidden="true" />
            </button>
          )}
        </TooltipTarget>
      )}
      <div className="assetThumb">
        {entry.kind === 'directory'
          ? <FolderIcon />
          : entry.objectUrl
            ? <img src={entry.objectUrl} alt="" draggable={false} />
            : entry.isSupportedImage
              ? <ImageFileIcon />
              : <GenericFileIcon />}
      </div>
      <div className="assetCardMeta">
        <Tooltip label={title}>
          <strong>{displayName}</strong>
        </Tooltip>
        {registration
          ? (
            <Tooltip label={registration.title}>
              <span className="assetRegistrationBadge">{registration.badgeLabel}</span>
            </Tooltip>
            )
          : isFileAsset
            ? <span className="assetRegistrationBadge assetRegistrationBadge-unregistered">{uiText.assets.unregistered}</span>
            : null}
      </div>
    </article>
  )
}

export function AssetCard({
  asset,
  registration,
  viewMode,
  isSelected,
  isDragging,
  onSelect,
  onKeyboardSelect,
  onDragStateChange,
  onDragStart,
  onContextMenu,
  onPreview,
}: {
  asset: CutAsset
  registration?: AssetRegistrationSummary
  viewMode: AssetViewMode
  isSelected: boolean
  isDragging: boolean
  onSelect: (event: MouseEvent<HTMLElement>) => void
  onKeyboardSelect: (event: KeyboardEvent<HTMLElement>) => void
  onDragStateChange: (isDragging: boolean, assetIds: string[]) => void
  onDragStart: () => string[]
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void
  onPreview: () => void
}) {
  const title = [asset.relativePath ?? asset.currentPath ?? asset.originalFileName, registration?.title].filter(Boolean).join('\n')
  return (
    <article
      className={[
        'assetCard',
        viewMode === 'list' ? 'list' : '',
        isSelected ? 'selected' : '',
        isDragging ? 'dragging' : '',
      ].filter(Boolean).join(' ')}
      tabIndex={0}
      draggable={false}
      aria-selected={isSelected}
      onPointerDown={event => {
        const dragSource = event.currentTarget
        startInternalPointerDrag(event, {
          begin: () => {
            const draggedAssetIds = onDragStart()
            return draggedAssetIds.length > 0 ? { kind: 'asset', assetIds: draggedAssetIds } : null
          },
          onStarted: payload => {
            if (payload.kind === 'asset') onDragStateChange(true, payload.assetIds)
          },
          onFinished: payload => {
            if (payload.kind === 'asset') onDragStateChange(false, payload.assetIds)
          },
          createDragGhost: () => createAssetDragImage(dragSource),
          sourceScrollElement: dragSource.closest<HTMLElement>('.assetBrowserItems'),
        })
      }}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onKeyboardSelect(event)
      }}
    >
      <TooltipTarget label={uiText.assets.quickPreview}>
        {tooltipProps => (
          <button
            {...tooltipProps}
            type="button"
            className="assetQuickPreviewButton"
            aria-label={uiText.assets.quickPreview}
            draggable={false}
            onPointerDown={event => {
              event.stopPropagation()
              tooltipProps.onPointerDown()
            }}
            onClick={event => {
              event.stopPropagation()
              onPreview()
            }}
            onDragStart={event => {
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            <span className="assetQuickPreviewIcon" aria-hidden="true" />
          </button>
        )}
      </TooltipTarget>
      <div className="assetThumb">
        {asset.thumbnailUrl
          ? <img src={asset.thumbnailUrl} alt="" draggable={false} />
          : <div className="assetPreviewPlaceholder">{uiText.app.noPreview}</div>}
      </div>
      <div className="assetCardMeta">
        <Tooltip label={title}>
          <strong>{asset.displayName}</strong>
        </Tooltip>
        {registration && (
          <Tooltip label={registration.title}>
            <span className="assetRegistrationBadge">{registration.badgeLabel}</span>
          </Tooltip>
        )}
      </div>
    </article>
  )
}
