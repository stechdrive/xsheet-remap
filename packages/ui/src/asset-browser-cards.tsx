import { type KeyboardEvent, type MouseEvent } from 'react'
import { assetSourceDisplayPath, type CutAsset } from '@xsheet-remap/core'
import { uiText } from './i18n'
import { Tooltip, TooltipTarget } from './Tooltip'
import { startInternalPointerDrag } from './internalDrag'
import type { AssetRegistrationSummary, AssetViewMode } from './asset-browser-types'
import { createAssetDragImage } from './asset-browser-model'

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
  const title = [assetSourceDisplayPath(asset), registration?.title].filter(Boolean).join('\n')
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
