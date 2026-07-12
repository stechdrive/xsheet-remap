import { useEffect, useMemo, useReducer, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from 'react'
import type { AssetRoot, CutAsset, FileRef } from '@xsheet-remap/core'
import { collectAssetPathDrop, isTauriHost, listAssetDirectory, openAssetRootDirectory, type AssetDirectoryEntry, type AssetDirectoryListing, type AssetRootCandidate } from '@xsheet-remap/adapters'
import { uiText } from './i18n'
import { collectAssetFilesFromDrop, compareAssetNames, dedupeStringList } from './assetFiles'
import {
  AssetFloatingPreview,
} from './assetPreview'
import {
  embeddedAssetPreviewPayload,
  initialAssetPreviewRect,
  openNativeAssetPreview,
  updateNativeAssetPreviewIfOpen,
  updateNativeAssetPreviewPayloadIfOpen,
  writeAssetPreviewRect,
  clampAssetPreviewRect,
  type AssetPreviewPayload,
  type AssetPreviewRect,
} from './assetPreviewModel'
import { Tooltip, TooltipTarget } from './Tooltip'
import { startInternalPointerDrag } from './internalDrag'

type AssetViewMode = 'grid' | 'list'
type AssetThumbnailSize = 'normal' | 'large'
type AssetSortDirection = 'asc' | 'desc'

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

type AssetSelectionIntent = {
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

type AssetDragWindow = Window & {
  __xsheetRemapAssetDragIds?: string[]
}

type AssetBrowserProps = {
  assetRoots: AssetRoot[]
  assets: CutAsset[]
  registrationSummaries: Map<string, AssetRegistrationSummary>
  onAssets: (files: FileList | File[] | null) => void
  onAssetRefs: (refs: FileRef[]) => void
  onAssetRoots: (roots: AssetRootCandidate[]) => void
  onEnsureAssetRef: (ref: FileRef) => string | null
  onAssetSheetSources?: (assetIds: string[]) => void
  canUseAssetsAsSheetSources?: boolean
  onDropDiagnostic?: (report: DropDiagnosticReport) => void
}

type AssetContextMenuState = {
  x: number
  y: number
  assetIds: string[]
}

type DirectoryBrowserState = {
  listing: AssetDirectoryListing | null
  loading: boolean
  error: string | null
}

type DirectoryBrowserAction =
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'loaded'; listing: AssetDirectoryListing | null }
  | { type: 'error'; message: string }

const emptyDirectoryBrowserState: DirectoryBrowserState = {
  listing: null,
  loading: false,
  error: null,
}

function directoryBrowserReducer(state: DirectoryBrowserState, action: DirectoryBrowserAction): DirectoryBrowserState {
  switch (action.type) {
    case 'idle':
      return state.loading || state.listing || state.error ? emptyDirectoryBrowserState : state
    case 'loading':
      return { listing: null, loading: true, error: null }
    case 'loaded':
      return { listing: action.listing, loading: false, error: null }
    case 'error':
      return { listing: null, loading: false, error: action.message }
  }
}

export function AssetTray(props: AssetBrowserProps) {
  return <AssetBrowser {...props} />
}

function AssetBrowser({
  assets,
  assetRoots,
  registrationSummaries,
  onAssets,
  onAssetRefs,
  onAssetRoots,
  onEnsureAssetRef,
  onAssetSheetSources,
  canUseAssetsAsSheetSources = false,
  onDropDiagnostic,
}: AssetBrowserProps) {
  const [viewMode, setViewMode] = useState<AssetViewMode>('grid')
  const [thumbnailSize, setThumbnailSize] = useState<AssetThumbnailSize>('normal')
  const [sortDirection, setSortDirection] = useState<AssetSortDirection>('asc')
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const [selectionAnchorAssetId, setSelectionAnchorAssetId] = useState<string | null>(null)
  const [draggingAssetIds, setDraggingAssetIds] = useState<string[]>([])
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null)
  const [embeddedPreviewOpen, setEmbeddedPreviewOpen] = useState(false)
  const [embeddedPreviewPayload, setEmbeddedPreviewPayload] = useState<AssetPreviewPayload | null>(null)
  const [previewRect, setPreviewRect] = useState<AssetPreviewRect>(() => initialAssetPreviewRect())
  const [activeRootId, setActiveRootId] = useState<string | null>(assetRoots[0]?.rootId ?? null)
  const [requestedDirectoryPath, setRequestedDirectoryPath] = useState<string | null>(assetRoots[0]?.path ?? null)
  const [directoryState, dispatchDirectoryState] = useReducer(directoryBrowserReducer, emptyDirectoryBrowserState)
  const [isNativeDropActive, setIsNativeDropActive] = useState(false)
  const [contextMenu, setContextMenu] = useState<AssetContextMenuState | null>(null)
  const lastDropDiagnosticOverRef = useRef(0)
  const sortedAssets = useMemo(() => {
    const nextAssets = [...assets].sort(compareAssetNames)
    return sortDirection === 'asc' ? nextAssets : nextAssets.reverse()
  }, [assets, sortDirection])
  const sortedAssetIds = useMemo(() => sortedAssets.map(asset => asset.assetId), [sortedAssets])
  const assetsByRootRelativePath = useMemo(() => {
    const map = new Map<string, CutAsset>()
    for (const asset of sortedAssets) {
      if (!asset.rootId || !asset.relativePath) continue
      map.set(assetDirectoryAssetKey(asset.rootId, asset.relativePath), asset)
    }
    return map
  }, [sortedAssets])
  const availableAssetIdSet = useMemo(() => new Set(sortedAssetIds), [sortedAssetIds])
  const activeSelectedAssetIds = useMemo(() => selectedAssetIds.filter(assetId => availableAssetIdSet.has(assetId)), [availableAssetIdSet, selectedAssetIds])
  const activeDraggingAssetIds = useMemo(() => draggingAssetIds.filter(assetId => availableAssetIdSet.has(assetId)), [availableAssetIdSet, draggingAssetIds])
  const selectedAssetIdSet = useMemo(() => new Set(activeSelectedAssetIds), [activeSelectedAssetIds])
  const draggingAssetIdSet = useMemo(() => new Set(activeDraggingAssetIds), [activeDraggingAssetIds])
  const selectedPreviewAsset = previewAssetId ? sortedAssets.find(item => item.assetId === previewAssetId) ?? null : null
  const activeEmbeddedPreviewPayload = embeddedPreviewOpen && selectedPreviewAsset
    ? embeddedAssetPreviewPayload(selectedPreviewAsset)
    : embeddedPreviewPayload
  const activeRoot = useMemo(
    () => assetRoots.find(root => root.rootId === activeRootId) ?? assetRoots[0] ?? null,
    [activeRootId, assetRoots],
  )
  const activeRootAssetVersion = useMemo(
    () => assets
      .filter(asset => asset.rootId === activeRoot?.rootId)
      .sort((a, b) => a.assetId.localeCompare(b.assetId))
      .map(asset => [
        asset.assetId,
        asset.displayName,
        asset.currentPath ?? '',
        asset.relativePath ?? '',
      ].join('\u0000'))
      .join('\u0001'),
    [activeRoot?.rootId, assets],
  )
  const currentDirectoryPath = useMemo(() => {
    if (!activeRoot?.path) return null
    if (!requestedDirectoryPath) return activeRoot.path
    return isPathInsideRoot(requestedDirectoryPath, activeRoot.path) ? requestedDirectoryPath : activeRoot.path
  }, [activeRoot, requestedDirectoryPath])
  const directoryListing = directoryState.listing
  const directoryLoading = directoryState.loading
  const directoryError = directoryState.error
  const canOpenSheetSourceContextMenu = Boolean(canUseAssetsAsSheetSources && onAssetSheetSources)
  const visibleDirectoryEntries = useMemo(() => {
    const entries = directoryListing?.entries ?? []
    const nextEntries = [...entries].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return compareAssetNames({ displayName: a.name } as CutAsset, { displayName: b.name } as CutAsset)
    })
    return sortDirection === 'asc' ? nextEntries : nextEntries.reverse()
  }, [directoryListing?.entries, sortDirection])

  useEffect(() => {
    if (!activeRoot?.path || !currentDirectoryPath) {
      dispatchDirectoryState({ type: 'idle' })
      return undefined
    }
    let cancelled = false
    dispatchDirectoryState({ type: 'loading' })
    void listAssetDirectory(activeRoot.path, currentDirectoryPath)
      .then(listing => {
        if (cancelled) return
        dispatchDirectoryState({ type: 'loaded', listing })
        if (listing && listing.currentPath !== currentDirectoryPath) setRequestedDirectoryPath(listing.currentPath)
      })
      .catch(error => {
        if (cancelled) return
        dispatchDirectoryState({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      cancelled = true
    }
  }, [activeRoot?.path, activeRootAssetVersion, currentDirectoryPath])

  async function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setIsNativeDropActive(false)
    const nativePaths = Array.from(event.dataTransfer.files ?? [])
      .map(file => (file as File & { path?: string }).path)
      .filter((path): path is string => Boolean(path))
    onDropDiagnostic?.({
      source: 'asset-browser-dom',
      type: 'drop',
      target: 'asset-browser',
      paths: nativePaths,
      fileCount: event.dataTransfer.files?.length ?? 0,
      position: { x: event.clientX, y: event.clientY },
      details: nativePaths.length > 0 ? 'DataTransfer.files pathあり' : 'DataTransfer.files pathなし',
    })
    if (nativePaths.length > 0 && isTauriHost()) {
      const collection = await collectAssetPathDrop(nativePaths, { recursive: false })
      const droppedDirectories = collection.roots.filter(root => root.fromDirectoryDrop)
      if (droppedDirectories.length > 0) onAssetRoots(droppedDirectories)
      return
    }
    const files = await collectAssetFilesFromDrop(event.dataTransfer)
    if (isTauriHost()) {
      onDropDiagnostic?.({
        source: 'asset-browser-dom',
        type: 'drop-fallback',
        target: 'asset-browser',
        fileCount: files.length,
        position: { x: event.clientX, y: event.clientY },
        details: files.length > 0 ? 'DOMファイルを素材登録' : 'DOMファイルなし。フォルダはTauri native pathが必要',
      })
    }
    onAssets(files)
  }

  function reportDomDropDiagnostic(event: DragEvent<HTMLElement>, type: string) {
    const now = performance.now()
    if (type === 'dragover' && now - lastDropDiagnosticOverRef.current < 250) return
    if (type === 'dragover') lastDropDiagnosticOverRef.current = now
    onDropDiagnostic?.({
      source: 'asset-browser-dom',
      type,
      target: 'asset-browser',
      fileCount: event.dataTransfer.files?.length ?? event.dataTransfer.items?.length ?? 0,
      position: { x: event.clientX, y: event.clientY },
      details: isTauriHost() ? 'DOM側イベント' : 'Web側イベント',
    })
  }

  function handleFileInput(files: FileList | null, input: HTMLInputElement) {
    onAssets(files)
    input.value = ''
  }

  async function handleOpenAssetRootDirectory() {
    const path = await openAssetRootDirectory()
    if (!path) return
    const collection = await collectAssetPathDrop([path], { recursive: false })
    const roots = collection.roots.filter(root => root.fromDirectoryDrop)
    if (roots.length > 0) onAssetRoots(roots)
  }

  function handleImportCurrentDirectory(recursive: boolean) {
    if (!directoryListing) return
    void collectAssetPathDrop([directoryListing.currentPath], { recursive, rootPath: activeRoot?.path })
      .then(collection => onAssetRefs(collection.files))
  }

  function handleRootChange(rootId: string) {
    const root = assetRoots.find(item => item.rootId === rootId) ?? null
    setActiveRootId(root?.rootId ?? null)
    setRequestedDirectoryPath(root?.path ?? null)
  }

  function selectAsset(assetId: string, intent: AssetSelectionIntent = {}) {
    const nextSelection = assetSelectionFromIntent(activeSelectedAssetIds, sortedAssetIds, selectionAnchorAssetId, assetId, intent)
    setSelectedAssetIds(nextSelection.assetIds)
    setSelectionAnchorAssetId(nextSelection.anchorAssetId)
    setPreviewAssetId(assetId)
  }

  function previewDirectoryEntryIfOpen(entry: AssetDirectoryEntry) {
    const payload = previewPayloadForDirectoryEntry(entry)
    if (!payload) return
    setPreviewAssetId(null)
    void updateNativeAssetPreviewPayloadIfOpen(payload).then(updated => {
      if (updated || !embeddedPreviewOpen) return
      setEmbeddedPreviewPayload(payload)
    })
  }

  function openAssetContextMenu(event: MouseEvent<HTMLElement>, assetId: string) {
    if (!canOpenSheetSourceContextMenu) return
    event.preventDefault()
    event.stopPropagation()
    const assetIds = selectedAssetIdSet.has(assetId) ? activeSelectedAssetIds : [assetId]
    if (!selectedAssetIdSet.has(assetId)) {
      setSelectedAssetIds([assetId])
      setSelectionAnchorAssetId(assetId)
    }
    setPreviewAssetId(assetId)
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      assetIds,
    })
  }

  function applyContextMenuSheetSources() {
    if (!contextMenu || contextMenu.assetIds.length === 0) return
    onAssetSheetSources?.(contextMenu.assetIds)
    setContextMenu(null)
  }

  function openAssetPreview(assetId: string) {
    if (!selectedAssetIdSet.has(assetId)) {
      setSelectedAssetIds([assetId])
      setSelectionAnchorAssetId(assetId)
    }
    setPreviewAssetId(assetId)
    const asset = sortedAssets.find(item => item.assetId === assetId)
    if (asset) void openPreviewForAsset(asset)
  }

  function beginAssetDrag(assetId: string): string[] {
    const assetIds = selectedAssetIdSet.has(assetId) ? activeSelectedAssetIds : [assetId]
    if (!selectedAssetIdSet.has(assetId)) {
      setSelectedAssetIds(assetIds)
      setSelectionAnchorAssetId(assetId)
    }
    setPreviewAssetId(assetId)
    setDraggingAssetIds(assetIds)
    return assetIds
  }

  function ensureDirectoryAsset(entry: AssetDirectoryEntry): CutAsset | null {
    const existing = assetForDirectoryEntry(entry, activeRoot, assetsByRootRelativePath)
    if (existing) return existing
    const ref = fileRefFromDirectoryEntry(entry, activeRoot)
    if (!ref) return null
    const assetId = onEnsureAssetRef(ref)
    return assetId ? sortedAssets.find(asset => asset.assetId === assetId) ?? {
      assetId,
      originalFileName: ref.name,
      displayName: ref.name,
      role: 'cell-material',
      rootId: activeRoot?.rootId,
      relativePath: ref.relativePath,
      currentPath: ref.path,
      fileSize: ref.size,
      modifiedAt: ref.lastModified === undefined ? undefined : new Date(ref.lastModified).toISOString(),
      thumbnailUrl: ref.objectUrl,
    } : null
  }

  function beginDirectoryAssetDrag(entry: AssetDirectoryEntry): string[] {
    const asset = ensureDirectoryAsset(entry)
    if (!asset) return []
    return beginAssetDrag(asset.assetId)
  }

  function clearAssetSelection() {
    setSelectedAssetIds([])
    setSelectionAnchorAssetId(null)
    setContextMenu(null)
  }

  function handleAssetBrowserItemClick(event: MouseEvent<HTMLDivElement>) {
    if (event.currentTarget !== event.target) return
    clearAssetSelection()
  }

  function handleAssetBrowserKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    if (contextMenu) {
      setContextMenu(null)
      return
    }
    clearAssetSelection()
  }

  useEffect(() => {
    if (!contextMenu) return undefined
    function closeContextMenu(event: globalThis.PointerEvent) {
      const target = event.target
      if (target instanceof Element && target.closest('.assetContextMenu')) return
      setContextMenu(null)
    }
    window.addEventListener('pointerdown', closeContextMenu)
    return () => window.removeEventListener('pointerdown', closeContextMenu)
  }, [contextMenu])

  function setDragState(isDragging: boolean, assetIds: string[]) {
    setDraggingAssetIds(isDragging ? assetIds : [])
    const dragWindow = window as AssetDragWindow
    if (isDragging && assetIds.length > 0) {
      dragWindow.__xsheetRemapAssetDragIds = assetIds
    } else {
      delete dragWindow.__xsheetRemapAssetDragIds
    }
  }

  async function openPreviewForAsset(asset: CutAsset) {
    if (await openNativeAssetPreview(asset)) {
      setEmbeddedPreviewOpen(false)
      setEmbeddedPreviewPayload(null)
      return
    }
    setEmbeddedPreviewPayload(embeddedAssetPreviewPayload(asset))
    setEmbeddedPreviewOpen(true)
  }

  useEffect(() => {
    if (!previewAssetId) return
    const asset = sortedAssets.find(item => item.assetId === previewAssetId)
    if (!asset) return
    void updateNativeAssetPreviewIfOpen(asset)
  }, [previewAssetId, sortedAssets])

  function updatePreviewRect(rect: AssetPreviewRect) {
    const nextRect = clampAssetPreviewRect(rect)
    setPreviewRect(nextRect)
    writeAssetPreviewRect(nextRect)
  }

  const rootClassName = [
    'assetTray',
    'assetBrowser',
    viewMode === 'list' ? 'assetBrowser-list' : 'assetBrowser-grid',
    thumbnailSize === 'large' ? 'assetThumb-large' : 'assetThumb-normal',
    isNativeDropActive ? 'assetBrowser-dropActive' : '',
  ].join(' ')

  return (
    <section
      className={rootClassName}
      onKeyDown={handleAssetBrowserKeyDown}
      onDragOver={event => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setIsNativeDropActive(true)
        reportDomDropDiagnostic(event, 'dragover')
      }}
      onDragLeave={event => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        setIsNativeDropActive(false)
        reportDomDropDiagnostic(event, 'dragleave')
      }}
      onDrop={event => void handleDrop(event)}
    >
      <div className="assetBrowserHeader">
        <h2>{uiText.assets.title}</h2>
        <div className="assetBrowserHeaderActions">
          {!isTauriHost() && (
            <label className="fileButton">
              {uiText.actions.addAssets}
              <input type="file" accept="image/*" multiple onChange={event => handleFileInput(event.currentTarget.files, event.currentTarget)} />
            </label>
          )}
          <AssetViewControls
            viewMode={viewMode}
            thumbnailSize={thumbnailSize}
            sortDirection={sortDirection}
            onViewModeChange={setViewMode}
            onThumbnailSizeChange={setThumbnailSize}
            onSortDirectionToggle={() => setSortDirection(current => current === 'asc' ? 'desc' : 'asc')}
          />
        </div>
      </div>
      <AssetFileBrowser
        roots={assetRoots}
        activeRoot={activeRoot}
        listing={directoryListing}
        loading={directoryLoading}
        error={directoryError}
        onRootChange={handleRootChange}
        onOpenRoot={() => void handleOpenAssetRootDirectory()}
        dropActive={isNativeDropActive}
        onNavigate={setRequestedDirectoryPath}
        onImportCurrent={handleImportCurrentDirectory}
      />
      {activeSelectedAssetIds.length > 0 && (
        <div className="assetSelectionControls">
          <span>{uiText.assets.selectedCount(activeSelectedAssetIds.length)}</span>
          <Tooltip label={uiText.assets.clearSelectionTitle}>
            <button type="button" onClick={clearAssetSelection}>{uiText.assets.clearSelection}</button>
          </Tooltip>
        </div>
      )}
      <div className="assetBrowserItems" onClick={handleAssetBrowserItemClick}>
        {directoryListing
          ? (
            <>
              {visibleDirectoryEntries.length === 0 && <p className="muted">{uiText.assets.folder.empty}</p>}
              {visibleDirectoryEntries.map(entry => {
                const asset = assetForDirectoryEntry(entry, activeRoot, assetsByRootRelativePath)
                return (
                  <AssetDirectoryCard
                    key={entry.path}
                    entry={entry}
                    asset={asset}
                    registration={asset ? registrationSummaries.get(asset.assetId) : undefined}
                    viewMode={viewMode}
                    isSelected={Boolean(asset && selectedAssetIdSet.has(asset.assetId))}
                    isDragging={Boolean(asset && draggingAssetIdSet.has(asset.assetId))}
                    onNavigate={setRequestedDirectoryPath}
                    onEnsureAsset={() => ensureDirectoryAsset(entry)}
                    onSelect={event => {
                      if (!asset) {
                        previewDirectoryEntryIfOpen(entry)
                        clearAssetSelection()
                        return
                      }
                      selectAsset(asset.assetId, { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey })
                    }}
                    onKeyboardSelect={() => {
                      const ensured = asset ?? ensureDirectoryAsset(entry)
                      if (ensured) selectAsset(ensured.assetId)
                      else previewDirectoryEntryIfOpen(entry)
                    }}
                    onDragStateChange={setDragState}
                    onDragStart={() => {
                      const assetIds = beginDirectoryAssetDrag(entry)
                      onDropDiagnostic?.({
                        source: 'asset-browser-drag',
                        type: 'dragstart',
                        target: 'directory-file',
                        fileCount: assetIds.length,
                        paths: [entry.path],
                        details: assetIds.length > 0 ? `assetId ${assetIds.join(', ')}` : 'assetIdなし',
                      })
                      return assetIds
                    }}
                    onContextMenu={event => {
                      if (!entry.isSupportedImage) return
                      const ensured = asset ?? ensureDirectoryAsset(entry)
                      if (ensured) openAssetContextMenu(event, ensured.assetId)
                    }}
                    onPreview={() => {
                      const ensured = asset ?? ensureDirectoryAsset(entry)
                      if (ensured) openAssetPreview(ensured.assetId)
                    }}
                  />
                )
              })}
            </>
            )
          : (
            <>
              {sortedAssets.length === 0 && <p className="muted">{uiText.assets.empty}</p>}
              {sortedAssets.map(asset => (
                <AssetCard
                  key={asset.assetId}
                  asset={asset}
                  registration={registrationSummaries.get(asset.assetId)}
                  viewMode={viewMode}
                  isSelected={selectedAssetIdSet.has(asset.assetId)}
                  isDragging={draggingAssetIdSet.has(asset.assetId)}
                  onSelect={event => selectAsset(asset.assetId, { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey })}
                  onKeyboardSelect={() => selectAsset(asset.assetId)}
                  onDragStateChange={setDragState}
                  onDragStart={() => {
                    const assetIds = beginAssetDrag(asset.assetId)
                    onDropDiagnostic?.({
                      source: 'asset-browser-drag',
                      type: 'dragstart',
                      target: 'registered-asset',
                      fileCount: assetIds.length,
                      paths: [asset.currentPath ?? asset.originalFileName],
                      details: assetIds.length > 0 ? `assetId ${assetIds.join(', ')}` : 'assetIdなし',
                    })
                    return assetIds
                  }}
                  onContextMenu={event => openAssetContextMenu(event, asset.assetId)}
                  onPreview={() => openAssetPreview(asset.assetId)}
                />
              ))}
            </>
            )}
      </div>
      {contextMenu && canOpenSheetSourceContextMenu && (
        <div
          className="sheetContextMenu assetContextMenu"
          role="menu"
          style={assetContextMenuStyle(contextMenu.x, contextMenu.y)}
          onContextMenu={event => event.preventDefault()}
        >
          <button type="button" role="menuitem" onClick={applyContextMenuSheetSources}>
            {uiText.assets.useAsPaperSheetSource}
          </button>
        </div>
      )}
      {embeddedPreviewOpen && activeEmbeddedPreviewPayload && (
        <AssetFloatingPreview
          payload={activeEmbeddedPreviewPayload}
          rect={previewRect}
          isDragPassthrough={activeDraggingAssetIds.length > 0}
          onRectChange={updatePreviewRect}
          onClose={() => setEmbeddedPreviewOpen(false)}
        />
      )}
    </section>
  )
}

function AssetViewControls({
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

function AssetFileBrowser({
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

function isPathInsideRoot(path: string, rootPath: string): boolean {
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

function FolderIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7h7l2 2h9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  )
}

function ImageFileIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <path d="m8 16 2.5-3 2 2.2 1.2-1.4L17 17" />
      <path d="M9 8h.01" />
    </svg>
  )
}

function GenericFileIcon() {
  return (
    <svg className="assetBrowserIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h7l4 4v14H7Z" />
      <path d="M14 3v5h4" />
    </svg>
  )
}

function AssetDirectoryCard({
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
  onKeyboardSelect: () => void
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
        onKeyboardSelect()
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

function AssetCard({
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
  onKeyboardSelect: () => void
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
        onKeyboardSelect()
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

function assetSelectionFromIntent(
  currentAssetIds: string[],
  sortedAssetIds: string[],
  anchorAssetId: string | null,
  targetAssetId: string,
  intent: AssetSelectionIntent,
): { assetIds: string[]; anchorAssetId: string } {
  const isToggle = Boolean(intent.ctrlKey || intent.metaKey)
  if (intent.shiftKey && anchorAssetId && sortedAssetIds.includes(anchorAssetId)) {
    const rangeAssetIds = assetRange(sortedAssetIds, anchorAssetId, targetAssetId)
    if (isToggle) return { assetIds: dedupeStringList([...currentAssetIds, ...rangeAssetIds]), anchorAssetId }
    return { assetIds: rangeAssetIds, anchorAssetId }
  }
  if (isToggle) {
    const assetIds = currentAssetIds.includes(targetAssetId)
      ? currentAssetIds.filter(assetId => assetId !== targetAssetId)
      : [...currentAssetIds, targetAssetId]
    return { assetIds, anchorAssetId: targetAssetId }
  }
  return { assetIds: [targetAssetId], anchorAssetId: targetAssetId }
}

function assetForDirectoryEntry(entry: AssetDirectoryEntry, root: AssetRoot | null, assetsByRootRelativePath: Map<string, CutAsset>): CutAsset | null {
  if (entry.kind !== 'file' || !root) return null
  return assetsByRootRelativePath.get(assetDirectoryAssetKey(root.rootId, entry.relativePath)) ?? null
}

function assetDirectoryAssetKey(rootId: string, relativePath: string): string {
  return `${rootId}:${relativePath.replace(/\\/g, '/').toLocaleLowerCase()}`
}

function assetContextMenuStyle(x: number, y: number): { left: number; top: number } {
  const width = 220
  const height = 40
  return {
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  }
}

function fileRefFromDirectoryEntry(entry: AssetDirectoryEntry, root: AssetRoot | null): FileRef | null {
  if (entry.kind !== 'file' || !entry.isSupportedImage) return null
  return {
    name: entry.name,
    size: entry.size,
    lastModified: entry.lastModified,
    path: entry.path,
    rootPath: root?.path,
    relativePath: entry.relativePath,
    objectUrl: entry.objectUrl,
  }
}

function previewPayloadForDirectoryEntry(entry: AssetDirectoryEntry): AssetPreviewPayload | null {
  if (entry.kind !== 'file' || !entry.isSupportedImage) return null
  const detailText = entry.relativePath || entry.path
  return {
    displayName: entry.name,
    imageUrl: entry.objectUrl,
    detailText,
    items: [{
      label: entry.name,
      imageUrl: entry.objectUrl,
      detailText,
    }],
  }
}

function assetRange(sortedAssetIds: string[], anchorAssetId: string, targetAssetId: string): string[] {
  const anchorIndex = sortedAssetIds.indexOf(anchorAssetId)
  const targetIndex = sortedAssetIds.indexOf(targetAssetId)
  if (anchorIndex < 0 || targetIndex < 0) return [targetAssetId]
  const startIndex = Math.min(anchorIndex, targetIndex)
  const endIndex = Math.max(anchorIndex, targetIndex)
  return sortedAssetIds.slice(startIndex, endIndex + 1)
}

function createAssetDragImage(source: HTMLElement) {
  const shell = document.createElement('div')
  shell.className = 'assetDragImageShell'

  const preview = document.createElement('div')
  preview.className = 'assetDragImagePreview'

  const sourceImage = source.querySelector<HTMLImageElement>('img')
  if (sourceImage) {
    const image = sourceImage.cloneNode(true) as HTMLImageElement
    image.alt = ''
    preview.append(image)
  } else {
    const placeholder = document.createElement('div')
    placeholder.className = 'assetDragImagePlaceholder'
    placeholder.textContent = uiText.app.noPreview
    preview.append(placeholder)
  }

  shell.append(preview)
  return shell
}
