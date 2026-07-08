import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { uiText } from './i18n'
import {
  ASSET_PREVIEW_REFRESH_EVENT,
  ASSET_PREVIEW_UPDATE_EVENT,
  assetPreviewItems,
  assetPreviewPayloadFromUnknown,
  assetPreviewSingleDetail,
  readStoredAssetPreviewPayload,
  type AssetPreviewPayload,
  type AssetPreviewRect,
} from './assetPreviewModel'
import { Tooltip, TooltipTarget } from './Tooltip'

type AssetPreviewInteraction = {
  mode: 'move' | 'resize'
  pointerId: number
  startX: number
  startY: number
  startRect: AssetPreviewRect
}

export function AssetPreviewWindow() {
  const [payload, setPayload] = useState<AssetPreviewPayload | null>(() => readStoredAssetPreviewPayload())
  const singleDetailText = assetPreviewSingleDetail(payload)
  const shouldShowDetail = Boolean(singleDetailText && singleDetailText !== payload?.displayName)

  useEffect(() => {
    let isMounted = true

    function setPreviewPayload(nextPayload: unknown) {
      const parsedPayload = assetPreviewPayloadFromUnknown(nextPayload)
      if (parsedPayload && isMounted) setPayload(parsedPayload)
    }

    function updateFromStorage() {
      setPayload(readStoredAssetPreviewPayload())
    }

    function updateFromNativeState() {
      void readCurrentNativePayload()
    }

    function readCurrentNativePayload() {
      return import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke<unknown>('current_asset_preview_payload'))
        .then(setPreviewPayload)
        .catch(() => undefined)
    }

    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen<AssetPreviewPayload>(ASSET_PREVIEW_UPDATE_EVENT, event => {
        setPreviewPayload(event.payload)
      }))
      .then(nextUnlisten => {
        unlisten = nextUnlisten
        void readCurrentNativePayload()
      })
      .catch(() => {
        void readCurrentNativePayload()
      })

    window.addEventListener('storage', updateFromStorage)
    window.addEventListener(ASSET_PREVIEW_REFRESH_EVENT, updateFromNativeState)
    return () => {
      isMounted = false
      window.removeEventListener('storage', updateFromStorage)
      window.removeEventListener(ASSET_PREVIEW_REFRESH_EVENT, updateFromNativeState)
      unlisten?.()
    }
  }, [])

  return (
    <main className="assetPreviewWindow">
      <header className="assetPreviewWindowHeader">
        <strong>{payload?.displayName ?? uiText.assets.previewWindowTitle}</strong>
      </header>
      <AssetPreviewContent payload={payload} frameClassName="assetPreviewWindowImageFrame" />
      {shouldShowDetail && singleDetailText && (
        <footer className="assetPreviewWindowMeta">
          <Tooltip label={singleDetailText}>
            <span>{singleDetailText}</span>
          </Tooltip>
        </footer>
      )}
    </main>
  )
}

export function AssetFloatingPreview({
  payload,
  rect,
  isDragPassthrough,
  onRectChange,
  onClose,
}: {
  payload: AssetPreviewPayload
  rect: AssetPreviewRect
  isDragPassthrough: boolean
  onRectChange: (rect: AssetPreviewRect) => void
  onClose: () => void
}) {
  const detailText = assetPreviewSingleDetail(payload)
  const shouldShowDetail = Boolean(detailText && detailText !== payload.displayName)
  const interactionRef = useRef<AssetPreviewInteraction | null>(null)

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  function beginInteraction(mode: AssetPreviewInteraction['mode'], event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    interactionRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRect: rect,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function updateInteraction(event: PointerEvent<HTMLElement>) {
    const interaction = interactionRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return
    const deltaX = event.clientX - interaction.startX
    const deltaY = event.clientY - interaction.startY
    if (interaction.mode === 'move') {
      onRectChange({
        ...interaction.startRect,
        left: interaction.startRect.left + deltaX,
        top: interaction.startRect.top + deltaY,
      })
      return
    }
    onRectChange({
      ...interaction.startRect,
      width: interaction.startRect.width + deltaX,
      height: interaction.startRect.height + deltaY,
    })
  }

  function endInteraction(event: PointerEvent<HTMLElement>) {
    const interaction = interactionRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return
    interactionRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  return (
    <aside
      className={['assetFloatingPreview', isDragPassthrough ? 'dragPassthrough' : ''].filter(Boolean).join(' ')}
      style={{
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      }}
      role="dialog"
      aria-modal="false"
      aria-label={uiText.assets.previewDialog(payload.displayName)}
    >
      <div
        className="assetFloatingPreviewHeader"
        onPointerDown={event => beginInteraction('move', event)}
        onPointerMove={updateInteraction}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
      >
        <strong>{payload.displayName}</strong>
        <Tooltip label={uiText.assets.closePreview}>
          <button
            type="button"
            className="assetFloatingPreviewClose"
            aria-label={uiText.assets.closePreview}
            onPointerDown={event => event.stopPropagation()}
            onClick={onClose}
          >
            ×
          </button>
        </Tooltip>
      </div>
      <AssetPreviewContent payload={payload} frameClassName="assetFloatingPreviewImageFrame" />
      {shouldShowDetail && detailText && (
        <div className="assetFloatingPreviewMeta">
          <Tooltip label={detailText}>
            <span>{detailText}</span>
          </Tooltip>
        </div>
      )}
      <TooltipTarget label={uiText.assets.resizePreview}>
        {tooltipProps => (
          <div
            {...tooltipProps}
            className="assetFloatingPreviewResize"
            role="separator"
            aria-label={uiText.assets.resizePreview}
            onPointerDown={event => {
              tooltipProps.onPointerDown()
              beginInteraction('resize', event)
            }}
            onPointerMove={updateInteraction}
            onPointerUp={endInteraction}
            onPointerCancel={endInteraction}
          />
        )}
      </TooltipTarget>
    </aside>
  )
}

function AssetPreviewContent({
  payload,
  frameClassName,
}: {
  payload: AssetPreviewPayload | null
  frameClassName: string
}) {
  const items = assetPreviewItems(payload)
  const isMultiple = items.length > 1
  const className = [frameClassName, isMultiple ? 'multi' : ''].filter(Boolean).join(' ')
  if (items.length === 0) {
    return (
      <section className={className}>
        <div className="assetPreviewPlaceholder">{uiText.app.noPreview}</div>
      </section>
    )
  }
  if (items.length === 1) {
    const item = items[0]
    return (
      <section className={className}>
        {item.imageUrl
          ? <img src={item.imageUrl} alt="" />
          : <div className="assetPreviewPlaceholder">{uiText.app.noPreview}</div>}
      </section>
    )
  }
  return (
    <section className={className}>
      <div className="assetPreviewItemGrid">
        {items.map((item, index) => (
          <TooltipTarget key={`${item.processLabel ?? ''}:${item.label}:${index}`} label={[item.processLabel, item.label, item.detailText].filter(Boolean).join('\n')}>
            {tooltipProps => (
              <article
                {...tooltipProps}
                className="assetPreviewItem"
              >
                <div className="assetPreviewItemHeader">
                  {item.processLabel && <span>{item.processLabel}</span>}
                  <strong>{item.label}</strong>
                </div>
                <div className="assetPreviewItemImage">
                  {item.imageUrl
                    ? <img src={item.imageUrl} alt="" />
                    : <div className="assetPreviewPlaceholder">{uiText.app.noPreview}</div>}
                </div>
              </article>
            )}
          </TooltipTarget>
        ))}
      </div>
    </section>
  )
}
