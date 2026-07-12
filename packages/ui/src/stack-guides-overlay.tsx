import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent, type PointerEvent } from 'react'
import { type CutProject, type SheetPage, type SheetTemplate, type SheetTimingRole, type StackGuideLabel, resolveSheetTemplateGridLayout, resolveSheetTemplatePageSize, resolveSheetTemplateRegionRect, stackGuideStackBand, logicalSheetDisplayDurationFrames } from '@xsheet-remap/core'
import { uiText } from './i18n'
import { clampNumber } from './sheetInteraction'
import { Tooltip, TooltipTarget } from './Tooltip'
import { StackGuideDropPreviewState, StackGuideInsertContext, StackGuideInsertRequest, StackGuideInsertTarget } from './app-foundation'
import { stackGuideAnchorRegions, stackGuideClampedEditorBottomPx, stackGuideColumnHeaderHitPx, stackGuideEditorBottomPx, stackGuideEditorShiftPx, stackGuideGapWidthPx, stackGuideGuideHeightPx, stackGuideHeaderReachPx, stackGuideInsertionTargets, stackGuidePlacementsByGap } from './stack-guides-geometry'
import { defaultStackGuideInsertTarget, stackGuideInsertTargetFromPoint } from './stack-guides-interaction'

export function HoverCellOverlay({ rect }: { rect: { x: number; y: number; w: number; h: number } }) {
  return (
    <div
      className="hoverCellRect"
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.w * 100}%`,
        height: `${rect.h * 100}%`,
      }}
    />
  )
}

export function StackGuideOverlay({
  project,
  template,
  page,
  pageWidth,
  pageHeight,
  insertRequest,
  insertTool,
  dropPreview,
  onInsertRequestConsumed,
  onInsertToolConsumed,
  onCreate,
  onCreateOverlayPaperTrack,
}: {
  project: CutProject
  template: SheetTemplate
  page: SheetPage
  pageWidth: number
  pageHeight: number
  insertRequest?: StackGuideInsertRequest | null
  insertTool?: StackGuideInsertContext | null
  dropPreview?: StackGuideDropPreviewState | null
  onInsertRequestConsumed?: () => void
  onInsertToolConsumed?: () => void
  onCreate: (input: { label: string; gapIndex: number; insertAfterPaperTrack?: string; displayRole?: SheetTimingRole; viewSnapIndex?: number; kind?: StackGuideLabel['kind']; correctionLayerId?: string }) => void
  onCreateOverlayPaperTrack: (input: { x: number; y: number; insertAfterPaperTrack?: string; snapIndex: number; sheetRole: SheetTimingRole }) => void
}) {
  const editorInputRef = useRef<HTMLInputElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const [requestInsertTool, setRequestInsertTool] = useState<StackGuideInsertContext | null>(null)
  const [insertToolTarget, setInsertToolTarget] = useState<StackGuideInsertTarget | null>(null)
  const [insertMenu, setInsertMenu] = useState<{
    regionId: string
    gapIndex: number
    insertAfterPaperTrack?: string
    displayRole: SheetTimingRole
    snapIndex: number
  } | null>(null)
  const [editor, setEditor] = useState<{
    regionId: string
    gapIndex: number
    insertAfterPaperTrack?: string
    displayRole: SheetTimingRole
    snapIndex: number
    value: string
    correctionLayerId?: string
  } | null>(null)
  const displayDurationFrames = logicalSheetDisplayDurationFrames(project.logicalSheet)
  const pageSize = resolveSheetTemplatePageSize(template, displayDurationFrames, {
    paperTracks: project.logicalSheet.paperTracks.map(track => track.paperTrack),
    layoutOverrides: project.sheetView.layoutOverrides,
  })
  const anchorRegions = stackGuideAnchorRegions(template, page, project.logicalSheet.frameOrigin)
  const activeInsertContext = insertTool ?? requestInsertTool
  const activeInsertTool = activeInsertContext?.mode
  const currentInsertToolTarget = activeInsertContext
    ? insertToolTarget ?? defaultStackGuideInsertTarget(template, project, page, activeInsertContext?.preferredSnapIndex)
    : null

  useEffect(() => {
    if (!insertRequest || insertRequest.pageId !== page.pageId) return
    const timer = window.setTimeout(() => {
      setInsertMenu(null)
      setEditor(null)
      setRequestInsertTool({
        mode: insertRequest.mode,
        correctionLayerId: insertRequest.correctionLayerId,
        preferredSnapIndex: insertRequest.preferredSnapIndex,
      })
      setInsertToolTarget(insertRequest)
      onInsertRequestConsumed?.()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [insertRequest, onInsertRequestConsumed, page.pageId])

  useEffect(() => {
    if (!editor && !insertMenu) return undefined
    const cancelFloatingUi = () => {
      setInsertMenu(null)
      setEditor(current => current && current.value.trim() === '' ? null : current)
    }
    window.addEventListener('pointerdown', cancelFloatingUi)
    return () => window.removeEventListener('pointerdown', cancelFloatingUi)
  }, [editor, insertMenu])

  useLayoutEffect(() => {
    if (!activeInsertTool) return undefined
    function handleOutsidePointer(event: globalThis.PointerEvent) {
      const target = event.target as Element | null
      if (target?.closest('.stackGuideOverlay, .stackGuideInsertHandle, .stackGuideEditor, .stackGuideInsertMenu, .actionMenu')) return
      setRequestInsertTool(null)
      onInsertToolConsumed?.()
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setRequestInsertTool(null)
      onInsertToolConsumed?.()
    }
    window.addEventListener('pointerdown', handleOutsidePointer)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('pointerdown', handleOutsidePointer)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [activeInsertTool, onInsertToolConsumed])

  if (anchorRegions.length === 0) return null

  function stackGuideInsertTargetFromClientPoint(clientX: number, clientY: number): StackGuideInsertTarget | null {
    const box = overlayRef.current?.getBoundingClientRect()
    if (!box || box.width <= 0 || box.height <= 0) return null
    return stackGuideInsertTargetFromPoint(template, project, page, {
      x: clampNumber((clientX - box.left) / box.width, 0, 1),
      y: clampNumber((clientY - box.top) / box.height, 0, 1),
    }, 'page')
  }

  function updateInsertToolTargetFromEvent(event: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>): StackGuideInsertTarget | null {
    if (!activeInsertTool) return null
    const target = stackGuideInsertTargetFromClientPoint(event.clientX, event.clientY)
    if (target) setInsertToolTarget(target)
    return target
  }

  function clearActiveInsertTool() {
    setRequestInsertTool(null)
    setInsertToolTarget(null)
    onInsertToolConsumed?.()
  }

  function confirmInsertTool(event: MouseEvent<HTMLDivElement>, fallbackTarget?: StackGuideInsertTarget | null) {
    if (!activeInsertTool) return
    const target = stackGuideInsertTargetFromClientPoint(event.clientX, event.clientY) ?? fallbackTarget ?? currentInsertToolTarget
    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    setInsertToolTarget(target)
    if (activeInsertTool === 'label-editor') {
      openEditor(target.regionId, target.gapIndex, target.insertAfterPaperTrack, target.displayRole, target.snapIndex, activeInsertContext?.correctionLayerId)
      clearActiveInsertTool()
      return
    }
    onCreateOverlayPaperTrack({
      x: event.clientX,
      y: event.clientY,
      insertAfterPaperTrack: target.insertAfterPaperTrack,
      snapIndex: target.snapIndex,
      sheetRole: target.displayRole,
    })
    clearActiveInsertTool()
  }

  function openEditor(
    regionId: string,
    gapIndex: number,
    insertAfterPaperTrack: string | undefined,
    displayRole: SheetTimingRole,
    snapIndex: number,
    correctionLayerId?: string,
  ) {
    setInsertMenu(null)
    setEditor({ regionId, gapIndex, insertAfterPaperTrack, displayRole, snapIndex, value: '', correctionLayerId })
  }

  function openInsertMenu(regionId: string, gapIndex: number, insertAfterPaperTrack: string | undefined, displayRole: SheetTimingRole, snapIndex: number) {
    setEditor(null)
    setInsertMenu({ regionId, gapIndex, insertAfterPaperTrack, displayRole, snapIndex })
  }

  function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor) return
    const formInput = event.currentTarget.elements.namedItem('stackGuideLabel') as HTMLInputElement | null
    const label = (formInput?.value ?? editorInputRef.current?.value ?? editor.value).trim()
    if (!label) {
      formInput?.focus()
      return
    }
    onCreate({
      label,
      gapIndex: editor.gapIndex,
      insertAfterPaperTrack: editor.insertAfterPaperTrack,
      displayRole: editor.displayRole,
      viewSnapIndex: editor.snapIndex,
      correctionLayerId: editor.correctionLayerId,
    })
    setEditor(null)
  }

  return (
    <div
      ref={overlayRef}
      className={editor || insertMenu || activeInsertTool ? 'stackGuideOverlay editing' : 'stackGuideOverlay'}
      aria-label={uiText.stackGuides.overlayLabel}
      onPointerMove={event => {
        updateInsertToolTargetFromEvent(event)
      }}
      onClick={event => {
        confirmInsertTool(event)
      }}
    >
      {anchorRegions.map(region => {
        const layout = resolveSheetTemplateGridLayout(template, region, {
          paperTracks: project.logicalSheet.paperTracks.map(track => track.paperTrack),
          durationFrames: displayDurationFrames,
          layoutOverrides: project.sheetView.layoutOverrides,
        })
        const columns = layout?.columns ?? []
        const displayRole = region.grid?.role as SheetTimingRole
        const rect = layout?.rect ?? resolveSheetTemplateRegionRect(template, region, displayDurationFrames)
        const anchorY = rect.y
        const headerReachPx = stackGuideHeaderReachPx(template, rect, pageHeight)
        const columnHeaderHitPx = stackGuideColumnHeaderHitPx(template, pageHeight)
        const gapWidthPx = stackGuideGapWidthPx(template, rect, columns, pageSize.widthPx)
        const labelsForRegion = project.stackGuideLabels.filter(label => (label.displayRole ?? 'action') === displayRole && stackGuideStackBand(label) === 'cell-interleave')
        const placementsByGap = stackGuidePlacementsByGap(template, project, labelsForRegion, gapWidthPx, columns)
        return (
          <div key={region.regionId}>
            {stackGuideInsertionTargets(template, project, displayRole, region.regionId, rect, columns).map(target => {
              const { gapIndex, insertAfterPaperTrack, snapIndex, x } = target
              const placements = placementsByGap.get(snapIndex) ?? []
              const activeEditor = editor?.regionId === region.regionId && editor.gapIndex === gapIndex
                && editor.snapIndex === snapIndex
              const activeInsertMenu = insertMenu?.regionId === region.regionId && insertMenu.gapIndex === gapIndex
                && insertMenu.snapIndex === snapIndex
              const activeDropPreview = dropPreview?.regionId === region.regionId
                && dropPreview.gapIndex === gapIndex
                && dropPreview.displayRole === displayRole
                && dropPreview.snapIndex === snapIndex
              const activeInsertToolTarget = activeInsertTool
                && currentInsertToolTarget?.regionId === region.regionId
                && currentInsertToolTarget.gapIndex === gapIndex
                && currentInsertToolTarget.displayRole === displayRole
                && currentInsertToolTarget.snapIndex === snapIndex
              const maxLane = placements.reduce((max, placement) => Math.max(max, placement.lane), 0)
              const guideHeight = stackGuideGuideHeightPx(maxLane)
              const preferredEditorBottomPx = headerReachPx + stackGuideEditorBottomPx(maxLane)
              const editorShiftPx = stackGuideEditorShiftPx(x, pageWidth)
              const className = [
                'stackGuideGap',
                placements.length > 0 ? 'hasLabels' : '',
                activeEditor || activeInsertMenu ? 'editing' : '',
                activeDropPreview ? 'preview' : '',
                activeInsertToolTarget ? 'insertToolActive' : '',
              ].filter(Boolean).join(' ')
              return (
                <div
                  key={`${region.regionId}-${snapIndex}`}
                  className={className}
                  data-region-id={region.regionId}
                  data-stack-guide-role={displayRole}
                  data-stack-guide-gap-index={gapIndex}
                  data-stack-guide-snap-index={snapIndex}
                  style={{
                    left: `${x * 100}%`,
                    top: `${anchorY * 100}%`,
                    '--stack-guide-guide-height': `${guideHeight}px`,
                    '--stack-guide-header-reach': `${headerReachPx}px`,
                    '--stack-guide-column-header-hit': `${columnHeaderHitPx}px`,
                    '--stack-guide-editor-bottom': `${stackGuideClampedEditorBottomPx(anchorY, pageHeight, preferredEditorBottomPx)}px`,
                    '--stack-guide-editor-shift': `${editorShiftPx}px`,
                  } as CSSProperties}
                >
                  <TooltipTarget label={uiText.stackGuides.insertHandleTitle} disabled={activeInsertMenu}>
                    {tooltipProps => (
                      <button
                        {...tooltipProps}
                        type="button"
                        className="stackGuideInsertHandle"
                        aria-label={uiText.stackGuides.addAtGap(gapIndex)}
                        onClick={event => {
                          event.preventDefault()
                          event.stopPropagation()
                          const target = { pageId: page.pageId, regionId: region.regionId, gapIndex, insertAfterPaperTrack, displayRole, snapIndex }
                          if (activeInsertTool === 'label-editor') {
                            openEditor(
                              region.regionId,
                              gapIndex,
                              insertAfterPaperTrack,
                              displayRole,
                              snapIndex,
                              activeInsertContext?.correctionLayerId,
                            )
                            clearActiveInsertTool()
                            return
                          }
                          if (activeInsertTool === 'overlay-track') {
                            setInsertToolTarget(target)
                            onCreateOverlayPaperTrack({
                              x: event.clientX,
                              y: event.clientY,
                              insertAfterPaperTrack,
                              snapIndex,
                              sheetRole: displayRole,
                            })
                            clearActiveInsertTool()
                            return
                          }
                          openInsertMenu(region.regionId, gapIndex, insertAfterPaperTrack, displayRole, snapIndex)
                        }}
                        onPointerDown={event => {
                          tooltipProps.onPointerDown()
                          event.stopPropagation()
                        }}
                      />
                    )}
                  </TooltipTarget>
                  {activeInsertMenu && (
                    <div
                      className="stackGuideInsertMenu"
                      role="menu"
                      aria-label={uiText.stackGuides.insertMenuLabel}
                      onPointerDown={event => event.stopPropagation()}
                      onClick={event => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => openEditor(region.regionId, gapIndex, insertAfterPaperTrack, displayRole, snapIndex)}
                      >
                        {uiText.stackGuides.add}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={event => {
                          onCreateOverlayPaperTrack({
                            x: event.clientX,
                            y: event.clientY,
                            insertAfterPaperTrack,
                            snapIndex,
                            sheetRole: displayRole,
                          })
                          setInsertMenu(null)
                        }}
                      >
                        {uiText.stackGuides.addOverlayTrack}
                      </button>
                    </div>
                  )}
                  {activeEditor && (
                    <form
                      className="stackGuideEditor"
                      onSubmit={submitEditor}
                      onPointerDown={event => event.stopPropagation()}
                      onClick={event => event.stopPropagation()}
                    >
                      <input
                        ref={editorInputRef}
                        name="stackGuideLabel"
                        autoFocus
                        aria-label={uiText.stackGuides.inputLabel}
                        value={editor.value}
                        placeholder={uiText.stackGuides.placeholder}
                        onInput={event => {
                          const value = event.currentTarget.value
                          setEditor(current => current ? { ...current, value } : current)
                        }}
                        onChange={event => {
                          const value = event.currentTarget.value
                          setEditor(current => current ? { ...current, value } : current)
                        }}
                        onKeyDown={event => {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setEditor(null)
                          }
                        }}
                      />
                      <Tooltip label={uiText.stackGuides.confirm}>
                        <button type="submit" className="stackGuideEditorIconButton" aria-label={uiText.stackGuides.confirm}>✓</button>
                      </Tooltip>
                      <Tooltip label={uiText.stackGuides.cancel}>
                        <button type="button" className="stackGuideEditorIconButton" aria-label={uiText.stackGuides.cancel} onClick={() => setEditor(null)}>×</button>
                      </Tooltip>
                    </form>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
