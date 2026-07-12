import { useEffect, useMemo, useReducer, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from 'react'
import type { AssetRoot, CutAsset, FileRef } from '@xsheet-remap/core'
import { collectAssetPathDrop, isTauriHost, listAssetDirectory, openAssetRootDirectory, type AssetDirectoryEntry, type AssetDirectoryListing, type AssetRootCandidate } from '@xsheet-remap/adapters'
import { uiText } from './i18n'
import { collectAssetFilesFromDrop, compareAssetNames } from './assetFiles'
import { AssetFloatingPreview } from './assetPreview'
import { embeddedAssetPreviewPayload, initialAssetPreviewRect, openNativeAssetPreview, updateNativeAssetPreviewIfOpen, updateNativeAssetPreviewPayloadIfOpen, writeAssetPreviewRect, clampAssetPreviewRect, type AssetPreviewPayload, type AssetPreviewRect } from './assetPreviewModel'
import { Tooltip } from './Tooltip'
import { assetContextMenuStyle, assetDirectoryAssetKey, assetForDirectoryEntry, assetSelectionFromIntent, fileRefFromDirectoryEntry, previewPayloadForDirectoryEntry } from './asset-browser-model'
import { AssetFileBrowser, AssetViewControls, isPathInsideRoot } from './asset-browser-controls'
import { AssetCard, AssetDirectoryCard } from './asset-browser-cards'
import type { AssetRegistrationSummary, AssetSelectionIntent, AssetSortDirection, AssetThumbnailSize, AssetViewMode, DropDiagnosticReport } from './asset-browser-types'

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
