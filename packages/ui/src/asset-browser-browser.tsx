import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { assetRelativePath, assetSourceDisplayPath, type AssetRoot, type CutAsset } from '@xsheet-remap/core'
import { collectAssetPathDrop, isTauriHost, openAssetRootDirectory, type AssetRootCandidate } from '@xsheet-remap/adapters'
import { uiText } from './i18n'
import { collectAssetFilesFromDrop, compareAssetNames } from './assetFiles'
import { AssetFloatingPreview } from './assetPreview'
import { embeddedAssetPreviewPayload, initialAssetPreviewRect, openNativeAssetPreview, updateNativeAssetPreviewIfOpen, writeAssetPreviewRect, clampAssetPreviewRect, type AssetPreviewPayload, type AssetPreviewRect } from './assetPreviewModel'
import { Tooltip } from './Tooltip'
import { assetContextMenuStyle, assetIdFromSelectionKey, assetSelectionFromIntent, assetSelectionKey } from './asset-browser-model'
import { AssetCatalogToolbar, AssetViewControls, FolderIcon } from './asset-browser-controls'
import { AssetCard } from './asset-browser-cards'
import type { AssetRegistrationSummary, AssetSelectionIntent, AssetSortDirection, AssetThumbnailSize, AssetViewMode, DropDiagnosticReport } from './asset-browser-types'

type AssetDragWindow = Window & {
  __xsheetRemapAssetDragIds?: string[]
}

type AssetBrowserProps = {
  assetRoot?: AssetRoot
  assets: CutAsset[]
  registrationSummaries: Map<string, AssetRegistrationSummary>
  onAssets: (files: FileList | File[] | null) => void
  onAssetRoots: (roots: AssetRootCandidate[]) => void | Promise<void>
  onAssetSheetSources?: (assetIds: string[]) => void
  canUseAssetsAsSheetSources?: boolean
  onDropDiagnostic?: (report: DropDiagnosticReport) => void
}

type AssetContextMenuState = {
  x: number
  y: number
  assetIds: string[]
}

type CatalogLocation =
  | { kind: 'root'; relativeDirectory: string }
  | { kind: 'external' }
  | { kind: 'unresolved' }

type CatalogFolder = {
  id: string
  name: string
  count: number
  location: CatalogLocation
}

export function AssetTray(props: AssetBrowserProps) {
  return <AssetBrowser {...props} />
}

function AssetBrowser({
  assets,
  assetRoot,
  registrationSummaries,
  onAssets,
  onAssetRoots,
  onAssetSheetSources,
  canUseAssetsAsSheetSources = false,
  onDropDiagnostic,
}: AssetBrowserProps) {
  const [viewMode, setViewMode] = useState<AssetViewMode>('grid')
  const [thumbnailSize, setThumbnailSize] = useState<AssetThumbnailSize>('normal')
  const [sortDirection, setSortDirection] = useState<AssetSortDirection>('asc')
  const [location, setLocation] = useState<CatalogLocation>(() => initialCatalogLocation(assetRoot, assets))
  const [selectedItemKeys, setSelectedItemKeys] = useState<string[]>([])
  const [selectionAnchorKey, setSelectionAnchorKey] = useState<string | null>(null)
  const [draggingAssetIds, setDraggingAssetIds] = useState<string[]>([])
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null)
  const [embeddedPreviewOpen, setEmbeddedPreviewOpen] = useState(false)
  const [embeddedPreviewPayload, setEmbeddedPreviewPayload] = useState<AssetPreviewPayload | null>(null)
  const [previewRect, setPreviewRect] = useState<AssetPreviewRect>(() => initialAssetPreviewRect())
  const [isNativeDropActive, setIsNativeDropActive] = useState(false)
  const [contextMenu, setContextMenu] = useState<AssetContextMenuState | null>(null)
  const [inputModality, setInputModality] = useState<'mouse' | 'pen' | 'touch'>('mouse')
  const [touchAdditiveSelection, setTouchAdditiveSelection] = useState(false)
  const lastDropDiagnosticOverRef = useRef(0)
  const knownAssetIdsRef = useRef(new Set(assets.map(asset => asset.assetId)))
  const previousRootPathRef = useRef(assetRoot?.path)
  const sortedAssets = useMemo(() => {
    const nextAssets = [...assets].sort(compareAssetNames)
    return sortDirection === 'asc' ? nextAssets : nextAssets.reverse()
  }, [assets, sortDirection])
  const catalog = useMemo(() => buildCatalogView(sortedAssets, location, assetRoot), [assetRoot, location, sortedAssets])
  const visibleSelectionKeys = useMemo(() => catalog.assets.map(asset => assetSelectionKey(asset.assetId)), [catalog.assets])
  const visibleSelectionKeySet = useMemo(() => new Set(visibleSelectionKeys), [visibleSelectionKeys])
  const activeSelectedItemKeys = useMemo(
    () => selectedItemKeys.filter(selectionKey => visibleSelectionKeySet.has(selectionKey)),
    [selectedItemKeys, visibleSelectionKeySet],
  )
  const selectedItemKeySet = useMemo(() => new Set(activeSelectedItemKeys), [activeSelectedItemKeys])
  const availableAssetIdSet = useMemo(() => new Set(sortedAssets.map(asset => asset.assetId)), [sortedAssets])
  const activeDraggingAssetIds = useMemo(() => draggingAssetIds.filter(assetId => availableAssetIdSet.has(assetId)), [availableAssetIdSet, draggingAssetIds])
  const draggingAssetIdSet = useMemo(() => new Set(activeDraggingAssetIds), [activeDraggingAssetIds])
  const activeSelectedAssetIds = useMemo(
    () => activeSelectedItemKeys.flatMap(selectionKey => assetIdFromSelectionKey(selectionKey) ?? []),
    [activeSelectedItemKeys],
  )
  const selectedPreviewAsset = previewAssetId ? sortedAssets.find(item => item.assetId === previewAssetId) ?? null : null
  const activeEmbeddedPreviewPayload = embeddedPreviewOpen && selectedPreviewAsset
    ? embeddedAssetPreviewPayload(selectedPreviewAsset)
    : embeddedPreviewPayload
  const canOpenSheetSourceContextMenu = Boolean(canUseAssetsAsSheetSources && onAssetSheetSources)

  useEffect(() => {
    if (previousRootPathRef.current === assetRoot?.path) return
    previousRootPathRef.current = assetRoot?.path
    clearAssetSelection()
    setLocation({ kind: 'root', relativeDirectory: '' })
  }, [assetRoot?.path])

  useEffect(() => {
    const previousIds = knownAssetIdsRef.current
    const addedAssets = assets.filter(asset => !previousIds.has(asset.assetId))
    knownAssetIdsRef.current = new Set(assets.map(asset => asset.assetId))
    if (addedAssets.length === 0) return
    clearAssetSelection()
    if (addedAssets.some(asset => asset.source.kind === 'external-file')) setLocation({ kind: 'external' })
    else if (addedAssets.some(asset => asset.source.kind === 'root-relative')) setLocation({ kind: 'root', relativeDirectory: '' })
    else setLocation({ kind: 'unresolved' })
  }, [assets])

  async function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setIsNativeDropActive(false)
    const droppedFiles = Array.from(event.dataTransfer.files ?? [])
    const nativePaths = droppedFiles
      .map(file => (file as File & { path?: string }).path)
      .filter((path): path is string => Boolean(path))
    onDropDiagnostic?.({
      source: 'asset-browser-dom',
      type: 'drop',
      target: 'asset-browser',
      paths: nativePaths,
      fileCount: droppedFiles.length,
      position: { x: event.clientX, y: event.clientY },
      details: nativePaths.length > 0 ? 'DataTransfer.files pathあり' : 'DataTransfer.files pathなし',
    })
    if (nativePaths.length > 0 && isTauriHost()) {
      const collection = await collectAssetPathDrop(nativePaths, { recursive: false })
      const roots = collection.roots.filter(root => root.fromDirectoryDrop)
      if (roots.length > 0) await onAssetRoots(roots)
      if (droppedFiles.length > roots.length) onAssets(droppedFiles)
      return
    }
    const files = await collectAssetFilesFromDrop(event.dataTransfer)
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
    if (roots.length > 0) await onAssetRoots(roots)
  }

  async function handleRescanAssetRoot() {
    if (!assetRoot) return
    await onAssetRoots([{ label: assetRoot.label, path: assetRoot.path, fromDirectoryDrop: true }])
  }

  function navigateTo(nextLocation: CatalogLocation) {
    clearAssetSelection()
    setLocation(nextLocation)
  }

  function navigateUp() {
    if (location.kind !== 'root') {
      navigateTo({ kind: 'root', relativeDirectory: '' })
      return
    }
    const parts = normalizeRelativePath(location.relativeDirectory).split('/').filter(Boolean)
    parts.pop()
    navigateTo({ kind: 'root', relativeDirectory: parts.join('/') })
  }

  function selectAsset(assetId: string, intent: AssetSelectionIntent = {}) {
    const selectionKey = assetSelectionKey(assetId)
    const nextSelection = assetSelectionFromIntent(activeSelectedItemKeys, visibleSelectionKeys, selectionAnchorKey, selectionKey, intent)
    setSelectedItemKeys(nextSelection.assetIds)
    setSelectionAnchorKey(nextSelection.anchorAssetId)
    setPreviewAssetId(assetId)
  }

  function openAssetContextMenu(event: MouseEvent<HTMLElement>, assetId: string) {
    if (!canOpenSheetSourceContextMenu) return
    event.preventDefault()
    event.stopPropagation()
    openAssetContextMenuAt(assetId, event.clientX, event.clientY)
  }

  function openAssetContextMenuAt(assetId: string, clientX: number, clientY: number) {
    const selectionKey = assetSelectionKey(assetId)
    const assetIds = selectedItemKeySet.has(selectionKey) ? activeSelectedAssetIds : [assetId]
    if (!selectedItemKeySet.has(selectionKey)) {
      setSelectedItemKeys([selectionKey])
      setSelectionAnchorKey(selectionKey)
    }
    setPreviewAssetId(assetId)
    setContextMenu({ x: clientX, y: clientY, assetIds })
  }

  function handleInputPointerDownCapture(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen' && event.pointerType !== 'touch') return
    setInputModality(event.pointerType)
    if (event.pointerType !== 'touch') setTouchAdditiveSelection(false)
  }

  function applyContextMenuSheetSources() {
    if (!contextMenu || contextMenu.assetIds.length === 0) return
    onAssetSheetSources?.(contextMenu.assetIds)
    setContextMenu(null)
  }

  function openAssetPreview(assetId: string) {
    const selectionKey = assetSelectionKey(assetId)
    if (!selectedItemKeySet.has(selectionKey)) {
      setSelectedItemKeys([selectionKey])
      setSelectionAnchorKey(selectionKey)
    }
    setPreviewAssetId(assetId)
    const asset = sortedAssets.find(item => item.assetId === assetId)
    if (asset) void openPreviewForAsset(asset)
  }

  function beginAssetDrag(assetId: string): string[] {
    const selectionKey = assetSelectionKey(assetId)
    const assetIds = selectedItemKeySet.has(selectionKey) ? activeSelectedAssetIds : [assetId]
    if (!selectedItemKeySet.has(selectionKey)) {
      setSelectedItemKeys([selectionKey])
      setSelectionAnchorKey(selectionKey)
    }
    setPreviewAssetId(assetId)
    setDraggingAssetIds(assetIds)
    return assetIds
  }

  function clearAssetSelection() {
    setSelectedItemKeys([])
    setSelectionAnchorKey(null)
    setContextMenu(null)
  }

  function handleAssetBrowserItemClick(event: MouseEvent<HTMLDivElement>) {
    if (event.currentTarget !== event.target) return
    clearAssetSelection()
  }

  function handleAssetBrowserKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    if (contextMenu) setContextMenu(null)
    else clearAssetSelection()
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
    if (isDragging && assetIds.length > 0) dragWindow.__xsheetRemapAssetDragIds = assetIds
    else delete dragWindow.__xsheetRemapAssetDragIds
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
    if (asset) void updateNativeAssetPreviewIfOpen(asset)
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
      data-input-modality={inputModality}
      onPointerDownCapture={handleInputPointerDownCapture}
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
      <AssetCatalogToolbar
        root={assetRoot ?? null}
        locationLabel={catalog.locationLabel}
        canNavigateUp={location.kind !== 'root' || Boolean(location.relativeDirectory)}
        onOpenRoot={() => void handleOpenAssetRootDirectory()}
        onNavigateUp={navigateUp}
        onRescan={() => void handleRescanAssetRoot()}
        dropActive={isNativeDropActive}
      />
      {activeSelectedItemKeys.length > 0 && (
        <div className="assetSelectionControls">
          <span>{uiText.assets.selectedCount(activeSelectedItemKeys.length)}</span>
          {inputModality === 'touch' && (
            <button
              type="button"
              aria-label="素材を追加選択"
              aria-pressed={touchAdditiveSelection}
              className={touchAdditiveSelection ? 'active' : ''}
              onClick={() => setTouchAdditiveSelection(current => !current)}
            >
              追加
            </button>
          )}
          {inputModality === 'touch' && canOpenSheetSourceContextMenu && activeSelectedAssetIds[0] && (
            <button
              type="button"
              aria-label="選択中の素材操作メニュー"
              onClick={event => {
                const rect = event.currentTarget.getBoundingClientRect()
                openAssetContextMenuAt(activeSelectedAssetIds[0]!, rect.left, rect.bottom)
              }}
            >
              …
            </button>
          )}
          <Tooltip label={uiText.assets.clearSelectionTitle}>
            <button type="button" onClick={clearAssetSelection}>{uiText.assets.clearSelection}</button>
          </Tooltip>
        </div>
      )}
      <div className="assetBrowserItems" onClick={handleAssetBrowserItemClick}>
        {catalog.folders.map(folder => (
          <CatalogFolderCard key={folder.id} folder={folder} viewMode={viewMode} onOpen={() => navigateTo(folder.location)} />
        ))}
        {catalog.folders.length === 0 && catalog.assets.length === 0 && <p className="muted">{uiText.assets.empty}</p>}
        {catalog.assets.map(asset => (
          <AssetCard
            key={asset.assetId}
            asset={asset}
            registration={registrationSummaries.get(asset.assetId)}
            viewMode={viewMode}
            isSelected={selectedItemKeySet.has(assetSelectionKey(asset.assetId))}
            isDragging={draggingAssetIdSet.has(asset.assetId)}
            onSelect={event => selectAsset(asset.assetId, { ctrlKey: event.ctrlKey || touchAdditiveSelection, metaKey: event.metaKey, shiftKey: event.shiftKey })}
            onKeyboardSelect={event => selectAsset(asset.assetId, { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey })}
            onDragStateChange={setDragState}
            onDragStart={() => {
              const assetIds = beginAssetDrag(asset.assetId)
              onDropDiagnostic?.({
                source: 'asset-browser-drag',
                type: 'dragstart',
                target: 'registered-asset',
                fileCount: assetIds.length,
                paths: [assetSourceDisplayPath(asset)],
                details: assetIds.length > 0 ? `assetId ${assetIds.join(', ')}` : 'assetIdなし',
              })
              return assetIds
            }}
            onContextMenu={event => openAssetContextMenu(event, asset.assetId)}
            onPreview={() => openAssetPreview(asset.assetId)}
          />
        ))}
      </div>
      {contextMenu && canOpenSheetSourceContextMenu && (
        <div className="sheetContextMenu assetContextMenu" role="menu" style={assetContextMenuStyle(contextMenu.x, contextMenu.y)} onContextMenu={event => event.preventDefault()}>
          <button type="button" role="menuitem" onClick={applyContextMenuSheetSources}>{uiText.assets.useAsPaperSheetSource}</button>
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

function CatalogFolderCard({ folder, viewMode, onOpen }: { folder: CatalogFolder; viewMode: AssetViewMode; onOpen: () => void }) {
  return (
    <article
      className={['assetCard', 'assetCatalogFolderCard', 'directory', viewMode === 'list' ? 'list' : ''].filter(Boolean).join(' ')}
      tabIndex={0}
      draggable={false}
      onClick={onOpen}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onOpen()
      }}
    >
      <div className="assetThumb"><FolderIcon /></div>
      <div className="assetCardMeta">
        <strong>{folder.name}</strong>
        <span className="assetFolderCount">{folder.count}件</span>
      </div>
    </article>
  )
}

function initialCatalogLocation(root: AssetRoot | undefined, assets: CutAsset[]): CatalogLocation {
  if (root) return { kind: 'root', relativeDirectory: '' }
  if (assets.some(asset => asset.source.kind === 'external-file')) return { kind: 'external' }
  if (assets.some(asset => asset.source.kind === 'unresolved')) return { kind: 'unresolved' }
  return { kind: 'root', relativeDirectory: '' }
}

function buildCatalogView(sortedAssets: CutAsset[], location: CatalogLocation, root?: AssetRoot): { folders: CatalogFolder[]; assets: CutAsset[]; locationLabel: string } {
  if (location.kind === 'external') {
    return {
      folders: [],
      assets: sortedAssets.filter(asset => asset.source.kind === 'external-file'),
      locationLabel: uiText.assets.catalog.external,
    }
  }
  if (location.kind === 'unresolved') {
    return {
      folders: [],
      assets: sortedAssets.filter(asset => asset.source.kind === 'unresolved'),
      locationLabel: uiText.assets.catalog.unresolved,
    }
  }

  const currentDirectory = normalizeRelativePath(location.relativeDirectory)
  const prefix = currentDirectory ? `${currentDirectory}/` : ''
  const childFolderCounts = new Map<string, number>()
  const visibleAssets: CutAsset[] = []
  for (const asset of sortedAssets) {
    const relativePath = assetRelativePath(asset)
    if (!relativePath) continue
    const normalizedPath = normalizeRelativePath(relativePath)
    if (prefix && !normalizedPath.toLowerCase().startsWith(prefix.toLowerCase())) continue
    const remainder = prefix ? normalizedPath.slice(prefix.length) : normalizedPath
    if (!remainder || remainder.startsWith('../')) continue
    const slashIndex = remainder.indexOf('/')
    if (slashIndex < 0) {
      visibleAssets.push(asset)
      continue
    }
    const folderName = remainder.slice(0, slashIndex)
    childFolderCounts.set(folderName, (childFolderCounts.get(folderName) ?? 0) + 1)
  }

  const direction = sortedAssets.length >= 2 && compareAssetNames(sortedAssets[0]!, sortedAssets[1]!) > 0 ? -1 : 1
  const folders: CatalogFolder[] = [...childFolderCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ja') * direction)
    .map(([name, count]) => ({
      id: `root:${prefix}${name}`,
      name,
      count,
      location: { kind: 'root', relativeDirectory: `${prefix}${name}` },
    }))

  if (!currentDirectory) {
    const externalCount = sortedAssets.filter(asset => asset.source.kind === 'external-file').length
    const unresolvedCount = sortedAssets.filter(asset => asset.source.kind === 'unresolved').length
    if (externalCount > 0) folders.push({ id: 'external', name: uiText.assets.catalog.external, count: externalCount, location: { kind: 'external' } })
    if (unresolvedCount > 0) folders.push({ id: 'unresolved', name: uiText.assets.catalog.unresolved, count: unresolvedCount, location: { kind: 'unresolved' } })
  }

  const rootLabel = root?.label || uiText.assets.catalog.root
  return {
    folders,
    assets: visibleAssets,
    locationLabel: currentDirectory ? `${rootLabel} / ${currentDirectory.split('/').join(' / ')}` : rootLabel,
  }
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '')
}
