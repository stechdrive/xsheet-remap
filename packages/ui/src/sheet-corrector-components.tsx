import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Tooltip } from './Tooltip'
import { LevelCorrectionFilterDefinition } from './LevelCorrectionFilter'
import { levelCorrectionFilterUrl, useLevelCorrectionFilterId } from './levelCorrectionFilterModel'
import { type LevelCorrectionSettings } from './levelCorrection'
import { DEFAULT_SHEET_IMPORT_RULE_PATTERN, activeSheetCorrectorImportPatterns, type SheetCorrectorImportRule } from './sheetCorrectorImportRules'
import type { QueueState, SheetCorrectionDraft, SheetCorrectorInput, SheetCorrectorProgressDialogState } from './sheet-corrector-types'
import { clampPreviewZoom, queueItemStateLabel } from './sheet-corrector-model'

type SheetCorrectorQueueIconName =
  | 'add'
  | 'export'
  | 'help'
  | 'remove'
  | 'stop'

export function SheetCorrectorQueueIcon({ name }: { name: SheetCorrectorQueueIconName }) {
  if (name === 'add') {
    return (
      <svg className="sheetCorrectorQueueIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    )
  }
  if (name === 'export') {
    return (
      <svg className="sheetCorrectorQueueIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 15v4h14v-4" />
      </svg>
    )
  }
  if (name === 'stop') {
    return (
      <svg className="sheetCorrectorQueueIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 7h10v10H7Z" />
      </svg>
    )
  }
  if (name === 'help') {
    return (
      <svg className="sheetCorrectorQueueIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
        <path d="M9.5 9a2.6 2.6 0 0 1 5 1c0 1.7-1.4 2.2-2.2 3.2-.3.3-.3.6-.3 1" />
        <path d="M12 17h.01" />
      </svg>
    )
  }
  if (name === 'remove') {
    return (
      <svg className="sheetCorrectorQueueIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
      </svg>
    )
  }
  return (
    <svg className="sheetCorrectorQueueIcon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h10v10H7Z" />
    </svg>
  )
}

export function SheetCorrectorHelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="sheetCorrectorModalBackdrop" role="dialog" aria-modal="true" aria-label="シートコレクターの使い方">
      <section className="sheetCorrectorHelpDialog">
        <header>
          <div>
            <strong>シートコレクターの使い方</strong>
            <span>バッチ処理とカット毎の確認処理で、触る場所が少し違います。</span>
          </div>
          <button type="button" onClick={onClose}>閉じる</button>
        </header>
        <div className="sheetCorrectorHelpWorkflows">
          <article className="sheetCorrectorHelpWorkflow">
            <h2>バッチ処理したい</h2>
            <p>フォルダ内のシート画像をまとめて拾い、自動補正してPSDを書き出す流れです。</p>
            <ol>
              <li>
                <strong>左の「取込条件」を決める</strong>
                <span>「条件を追加」でファイル名パターンを増やします。条件はフォルダ内画像だけに効きます。</span>
              </li>
              <li>
                <strong>自動で全部処理するなら、フォルダや画像をEXEへドロップ</strong>
                <span>エクスプローラーでカットフォルダや複数画像を「xsheet-corrector.exe」に重ねます。起動後に自動PSD出力が始まります。</span>
              </li>
              <li>
                <strong>画面で確認してから処理するなら、フォルダを画面へドロップ</strong>
                <span>左の「ファイル」に条件一致した画像が入ります。不要な行は右端の × で外します。</span>
              </li>
              <li>
                <strong>左上の「出力」から「全件を出力」</strong>
                <span>未補正の画像は自動検出してからPSD出力します。補正済みの画像はその補正を使います。</span>
              </li>
              <li>
                <strong>「要確認」が出た画像だけ直す</strong>
                <span>左の「ファイル」で画像を選び、右上の「画像補正」を開きます。通常補正とテンプレート適応補正が自動実行され、必要なら四隅を手動調整して「変形適用」します。</span>
              </li>
            </ol>
          </article>
          <article className="sheetCorrectorHelpWorkflow">
            <h2>カット毎のシートを処理したい</h2>
            <p>数枚ずつ見ながら、補正結果を確認してPSDを書き出す流れです。</p>
            <ol>
              <li>
                <strong>左上の +「キュー追加」または画面へ画像ドロップ</strong>
                <span>画像を直接追加した場合、取込条件は使われません。複数画像をまとめて追加できます。</span>
              </li>
              <li>
                <strong>左の「ファイル」から1枚選ぶ</strong>
                <span>選んだ画像が右のプレビューに出ます。Shiftクリックで範囲選択して、まとめて出力もできます。</span>
              </li>
              <li>
                <strong>右上でテンプレと表示を確認</strong>
                <span>「テンプレ」を選び、「表示」とスライダーで赤い罫線の重なりを見やすくします。必要なら「レベル補正」を切り替えます。</span>
              </li>
              <li>
                <strong>右上の「画像補正」で四隅を合わせる</strong>
                <span>開くと四隅検出からテンプレート適応補正まで自動実行されます。ずれていれば四隅の拡大枠をドラッグし、「変形適用」で補正を再実行します。</span>
              </li>
              <li>
                <strong>左上の「出力」から「選択を出力」</strong>
                <span>選択中の画像だけPSDにします。全部まとめてよければ「全件を出力」を使います。</span>
              </li>
            </ol>
          </article>
        </div>
        <footer>
          <p>PSDは元画像と同じフォルダへ作られます。同名PSDがある場合は番号付きの別名で保存されます。</p>
        </footer>
      </section>
    </div>
  )
}

export function SheetCorrectorImportRulesControl({
  rules,
  tooltipLabel,
  onAdd,
  onReset,
  onToggle,
  onChange,
  onRemove,
}: {
  rules: SheetCorrectorImportRule[]
  tooltipLabel: string
  onAdd: () => void
  onReset: () => void
  onToggle: (id: string, enabled: boolean) => void
  onChange: (id: string, pattern: string) => void
  onRemove: (id: string) => void
}) {
  const activePatterns = activeSheetCorrectorImportPatterns(rules)
  return (
    <section className="sheetCorrectorFolderFilter" aria-label="取込条件">
      <header className="sheetCorrectorFolderFilterHeader">
        <span>取込条件</span>
        <Tooltip label={tooltipLabel}>
          <span className="sheetCorrectorFolderFilterScope">フォルダ</span>
        </Tooltip>
      </header>
      <div className="sheetCorrectorImportRuleList">
        {rules.length === 0 ? (
          <p>フィルターなし</p>
        ) : rules.map((rule, index) => (
          <div className="sheetCorrectorImportRuleRow" key={rule.id}>
            <Tooltip label={rule.enabled ? '条件を無効化' : '条件を有効化'}>
              <label className="sheetCorrectorImportRuleToggle">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  aria-label={`取込条件 ${index + 1}を有効化`}
                  onChange={event => onToggle(rule.id, event.currentTarget.checked)}
                />
              </label>
            </Tooltip>
            <Tooltip label={tooltipLabel}>
              <input
                className="sheetCorrectorFolderFilterInput"
                value={rule.pattern}
                placeholder={DEFAULT_SHEET_IMPORT_RULE_PATTERN}
                aria-label={`取込条件 ${index + 1}`}
                onChange={event => onChange(rule.id, event.currentTarget.value)}
              />
            </Tooltip>
            <Tooltip label="削除">
              <button type="button" className="sheetCorrectorImportRuleRemove" aria-label={`取込条件 ${index + 1}を削除`} onClick={() => onRemove(rule.id)}>
                <SheetCorrectorQueueIcon name="remove" />
              </button>
            </Tooltip>
          </div>
        ))}
      </div>
      <div className="sheetCorrectorImportRuleActions">
        <button type="button" onClick={onAdd}>条件を追加</button>
        <button type="button" onClick={onReset}>初期条件</button>
      </div>
      <div className="sheetCorrectorImportSummary">
        <span>{activePatterns.length === 0 ? 'フィルターなし' : `${activePatterns.length}条件`}</span>
        {activePatterns.slice(0, 2).map((pattern, index) => (
          <span key={`${pattern}:${index}`}>{pattern}</span>
        ))}
        {activePatterns.length > 2 && <span>他 {activePatterns.length - 2}</span>}
      </div>
    </section>
  )
}

export function SheetCorrectorProgressDialog({
  state,
  queueRunning,
  onStop,
  onClose,
}: {
  state: SheetCorrectorProgressDialogState
  queueRunning: boolean
  onStop: () => void
  onClose: () => void
}) {
  return (
    <div className="sheetCorrectorModalBackdrop" role="dialog" aria-modal="true" aria-label={state.title}>
      <SheetCorrectorProgressPanel
        state={state}
        queueRunning={queueRunning}
        onStop={onStop}
        stopLabel="停止"
      >
        <button type="button" className="primary" disabled={!state.canClose} onClick={onClose}>
          閉じる
        </button>
      </SheetCorrectorProgressPanel>
    </div>
  )
}

export function SheetCorrectorBatchProgress({
  state,
  queueRunning,
  onStop,
  onClose,
  onOpenApp,
}: {
  state: SheetCorrectorProgressDialogState
  queueRunning: boolean
  onStop: () => void
  onClose: () => void
  onOpenApp: () => void
}) {
  const hasAttentionItems = state.review > 0 || state.error > 0
  return (
    <SheetCorrectorProgressPanel
      state={state}
      queueRunning={queueRunning}
      onStop={onStop}
      stopLabel="キャンセル"
    >
      {state.canClose && (
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      )}
      <button type="button" className="primary" disabled={!state.canClose} onClick={onOpenApp}>
        {hasAttentionItems ? 'アプリで確認' : 'アプリで開く'}
      </button>
    </SheetCorrectorProgressPanel>
  )
}

function SheetCorrectorProgressPanel({
  state,
  queueRunning,
  onStop,
  stopLabel,
  children,
}: {
  state: SheetCorrectorProgressDialogState
  queueRunning: boolean
  onStop: () => void
  stopLabel: string
  children: ReactNode
}) {
  const progressPercent = state.total > 0 ? Math.round((state.processed / state.total) * 100) : 0
  return (
    <section className="sheetCorrectorProgressDialog">
      <header>
        <div>
          <strong>{state.title}</strong>
          <span>{state.message}</span>
        </div>
      </header>
      <div className="sheetCorrectorProgressMeter" aria-label="処理進捗">
        <div>
          <span style={{ width: `${progressPercent}%` }} />
        </div>
        <strong>{state.total > 0 ? `${state.processed}/${state.total}` : '-'}</strong>
      </div>
      <dl className="sheetCorrectorProgressStats">
        <div>
          <dt>PSD出力</dt>
          <dd>{state.exported}</dd>
        </div>
        <div>
          <dt>要確認</dt>
          <dd>{state.review}</dd>
        </div>
        <div>
          <dt>エラー</dt>
          <dd>{state.error}</dd>
        </div>
      </dl>
      <footer>
        {queueRunning && (
          <button type="button" onClick={onStop}>{stopLabel}</button>
        )}
        {children}
      </footer>
    </section>
  )
}

export function SheetCorrectorItemList({
  items,
  selectedPaths,
  primarySelectedPath,
  queueStates,
  correctionDrafts,
  actionsDisabled,
  emptyText,
  onSelect,
  onExport,
  onRemove,
}: {
  items: SheetCorrectorInput[]
  selectedPaths: string[]
  primarySelectedPath: string | null
  queueStates: Record<string, QueueState>
  correctionDrafts: Record<string, SheetCorrectionDraft>
  actionsDisabled: boolean
  emptyText: string
  onSelect: (path: string, event: MouseEvent<HTMLButtonElement>) => void
  onExport: (path: string) => void
  onRemove: (path: string) => void
}) {
  return (
    <section className="sheetCorrectorList">
      <header>
        <strong>ファイル</strong>
        <span>{items.length}件</span>
      </header>
      {items.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <ol>
          {items.map(item => {
            const exportLabel = correctionDrafts[item.path]?.applied
              ? `PSD出力: ${item.name}`
              : `自動補正してPSD出力: ${item.name}`
            const exportAriaLabel = correctionDrafts[item.path]?.applied
              ? `${item.name}をPSD出力`
              : `${item.name}を自動補正してPSD出力`
            return (
              <li key={item.path}>
                <Tooltip label={`${item.name}を選択`}>
                  <button
                    type="button"
                    className={[
                      'sheetCorrectorQueueSelect',
                      selectedPaths.includes(item.path) ? 'selected' : '',
                      item.path === primarySelectedPath ? 'primary' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={event => onSelect(item.path, event)}
                  >
                    <span>{item.name}</span>
                    <em className={`sheetCorrectorQueueState ${queueStates[item.path] ?? 'idle'}`}>
                      {queueItemStateLabel(queueStates[item.path])}
                    </em>
                  </button>
                </Tooltip>
                <div className="sheetCorrectorQueueItemActions">
                  <Tooltip label={exportLabel}>
                    <button
                      type="button"
                      className="sheetCorrectorQueueItemAction"
                      disabled={actionsDisabled}
                      aria-label={exportAriaLabel}
                      onClick={() => onExport(item.path)}
                    >
                      <SheetCorrectorQueueIcon name="export" />
                    </button>
                  </Tooltip>
                  <Tooltip label={`${item.name}をキューから外す`}>
                    <button
                      type="button"
                      className="sheetCorrectorQueueItemAction"
                      disabled={actionsDisabled}
                      aria-label={`${item.name}をキューから外す`}
                      onClick={() => onRemove(item.path)}
                    >
                      <SheetCorrectorQueueIcon name="remove" />
                    </button>
                  </Tooltip>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

export function SheetCorrectorSourcePreview({
  imageUrl,
  viewKey,
  levelCorrection,
  templateImageUrl,
  overlayEnabled,
  overlayOpacity,
}: {
  imageUrl: string | null
  viewKey: string | null
  levelCorrection: LevelCorrectionSettings
  templateImageUrl: string | null
  overlayEnabled: boolean
  overlayOpacity: number
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const previewPanRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)
  const [previewZoomState, setPreviewZoomState] = useState<{ viewKey: string | null; zoom: number }>({ viewKey: null, zoom: 1 })
  const [isPreviewPanning, setIsPreviewPanning] = useState(false)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const previewZoom = previewZoomState.viewKey === viewKey ? previewZoomState.zoom : 1
  const levelCorrectionFilterId = useLevelCorrectionFilterId('sheetCorrectorLevelCorrection')
  const levelCorrectionFilter = levelCorrectionFilterUrl(levelCorrectionFilterId, levelCorrection)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined
    const updateSize = () => {
      setViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      })
    }
    updateSize()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }
    const observer = new ResizeObserver(updateSize)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const previewBaseSize = useMemo(() => {
    if (!imageSize || viewportSize.width <= 0 || viewportSize.height <= 0) return null
    const availableWidth = Math.max(1, viewportSize.width - 20)
    const availableHeight = Math.max(1, viewportSize.height - 20)
    const fitScale = Math.min(availableWidth / imageSize.width, availableHeight / imageSize.height)
    const scale = Math.min(1, Math.max(0.02, fitScale))
    return {
      width: imageSize.width * scale,
      height: imageSize.height * scale,
    }
  }, [imageSize, viewportSize.height, viewportSize.width])

  const handlePreviewWheel = useCallback((event: globalThis.WheelEvent) => {
    if (!imageUrl) return
    if (event.cancelable) event.preventDefault()
    event.stopPropagation()
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const anchor = {
      x: event.clientX - rect.left + viewport.scrollLeft,
      y: event.clientY - rect.top + viewport.scrollTop,
    }
    const cursor = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
    setPreviewZoomState(currentState => {
      const current = currentState.viewKey === viewKey ? currentState.zoom : 1
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
      const next = clampPreviewZoom(current * factor)
      if (next === current) return currentState.viewKey === viewKey ? currentState : { viewKey, zoom: current }
      window.requestAnimationFrame(() => {
        const ratio = next / current
        viewport.scrollLeft = anchor.x * ratio - cursor.x
        viewport.scrollTop = anchor.y * ratio - cursor.y
      })
      return { viewKey, zoom: next }
    })
  }, [imageUrl, viewKey])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined
    viewport.addEventListener('wheel', handlePreviewWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handlePreviewWheel)
  }, [handlePreviewWheel])

  function beginPreviewPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!imageUrl || event.button !== 0) return
    const viewport = viewportRef.current
    if (!viewport) return
    event.preventDefault()
    previewPanRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsPreviewPanning(true)
  }

  function movePreviewPan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = previewPanRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    const viewport = viewportRef.current
    if (!viewport) return
    event.preventDefault()
    viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX)
    viewport.scrollTop = pan.scrollTop - (event.clientY - pan.startY)
  }

  function endPreviewPan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = previewPanRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    previewPanRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsPreviewPanning(false)
  }

  return (
    <section className="sheetCorrectorPreviewPanel">
      <div
        ref={viewportRef}
        className={[
          'sheetCorrectorImageViewport',
          imageUrl ? 'panEnabled' : '',
          isPreviewPanning ? 'panning' : '',
        ].filter(Boolean).join(' ')}
        onDoubleClick={() => setPreviewZoomState({ viewKey, zoom: 1 })}
        onPointerDown={beginPreviewPan}
        onPointerMove={movePreviewPan}
        onPointerUp={endPreviewPan}
        onPointerCancel={endPreviewPan}
      >
        {imageUrl ? (
          <div
            className="sheetCorrectorPreviewStack"
            style={previewBaseSize ? {
              width: `${previewBaseSize.width * previewZoom}px`,
              height: `${previewBaseSize.height * previewZoom}px`,
            } : undefined}
          >
            {levelCorrectionFilter && (
              <svg className="levelCorrectionFilterSvg" aria-hidden="true">
                <defs>
                  <LevelCorrectionFilterDefinition id={levelCorrectionFilterId} settings={levelCorrection} />
                </defs>
              </svg>
            )}
            <img
              className="sheetCorrectorPreviewImage"
              src={imageUrl}
              alt=""
              draggable={false}
              style={levelCorrectionFilter ? { filter: levelCorrectionFilter } : undefined}
              onLoad={event => {
                const image = event.currentTarget
                const width = image.naturalWidth || image.width
                const height = image.naturalHeight || image.height
                if (width > 0 && height > 0) setImageSize({ width, height })
              }}
            />
            {overlayEnabled && templateImageUrl && (
              <svg
                className="sheetCorrectorTemplateOverlay"
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                style={{ opacity: overlayOpacity }}
                aria-hidden="true"
              >
                <defs>
                  <filter id="sheetCorrectorTemplateTint" colorInterpolationFilters="sRGB">
                    <feColorMatrix
                      in="SourceGraphic"
                      result="darknessMask"
                      type="matrix"
                      values="
                        0 0 0 0 0
                        0 0 0 0 0
                        0 0 0 0 0
                        -0.2126 -0.7152 -0.0722 0 1
                      "
                    />
                    <feComposite in="darknessMask" in2="SourceAlpha" operator="in" result="visibleDarkness" />
                    <feFlood floodColor="#ff1f12" result="overlayColor" />
                    <feComposite in="overlayColor" in2="visibleDarkness" operator="in" />
                  </filter>
                </defs>
                <image
                  href={templateImageUrl}
                  x="0"
                  y="0"
                  width="1"
                  height="1"
                  preserveAspectRatio="none"
                  filter="url(#sheetCorrectorTemplateTint)"
                />
              </svg>
            )}
          </div>
        ) : (
          <div className="sheetCorrectorPreviewPlaceholder">
            <strong>フォルダまたはシート画像をドロップ</strong>
            <span>フォルダは候補を確認してからキューに追加します。</span>
          </div>
        )}
      </div>
    </section>
  )
}
