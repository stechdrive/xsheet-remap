import { useState } from 'react'
import { type CutProject, type PaperTrack } from '@xsheet-remap/core'
import { uiText } from './i18n'
import { compareNaturalFileNameText } from './naturalSort'
import { Tooltip } from './Tooltip'
import { PaperTrackEditorState, floatingEditorStyle } from './app-foundation'

export function PaperTrackEditorPopover({
  state,
  paperTracks,
  onSubmit,
  onCancel,
}: {
  state: PaperTrackEditorState
  paperTracks: PaperTrack[]
  onSubmit: (name: string, exportAfterPaperTrack?: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(state.initialName)
  const [exportAfterPaperTrack, setExportAfterPaperTrack] = useState(state.exportAfterPaperTrack ?? '')
  const exportAfterOptions = exportAfterOptionsForPaperTrack(paperTracks, state.paperTrack)
  return (
    <form
      className="paperTrackEditorPopover"
      style={floatingEditorStyle(state.x, state.y)}
      onSubmit={event => {
        event.preventDefault()
        onSubmit(name, exportAfterPaperTrack || undefined)
      }}
      onPointerDown={event => event.stopPropagation()}
    >
      <label>
        <span>{state.mode === 'add' ? uiText.sheet.addOverlayTrackName : uiText.sheet.renameTrackName}</span>
        <input autoFocus value={name} onChange={event => setName(event.currentTarget.value)} />
      </label>
      {state.isOverlay && (
        <label>
          <span>{uiText.sheet.exportOrderAfter}</span>
          <select value={exportAfterPaperTrack} onChange={event => setExportAfterPaperTrack(event.currentTarget.value)}>
            <option value="">{uiText.sheet.exportInsertAtStart}</option>
            {exportAfterOptions.map(track => (
              <option key={track.paperTrack} value={track.paperTrack}>{uiText.sheet.exportInsertAfterTrack(track.label || track.paperTrack)}</option>
            ))}
          </select>
        </label>
      )}
      <div>
        <Tooltip label={uiText.stackGuides.confirm}>
          <button type="submit" aria-label={uiText.stackGuides.confirm}>✓</button>
        </Tooltip>
        <Tooltip label={uiText.stackGuides.cancel}>
          <button type="button" aria-label={uiText.stackGuides.cancel} onClick={onCancel}>×</button>
        </Tooltip>
      </div>
    </form>
  )
}

function exportAfterOptionsForPaperTrack(paperTracks: PaperTrack[], currentPaperTrack?: string): PaperTrack[] {
  return exportOrderedPaperTracks(paperTracks).filter(track => track.paperTrack !== currentPaperTrack)
}

export function exportPreviousPaperTrackName(paperTracks: PaperTrack[], paperTrackName: string): string {
  const ordered = exportOrderedPaperTracks(paperTracks)
  const index = ordered.findIndex(track => track.paperTrack === paperTrackName)
  return index > 0 ? ordered[index - 1]?.paperTrack ?? '' : ''
}

export function defaultExportAfterTrackForInsertAfter(paperTracks: PaperTrack[], insertAfterPaperTrack?: string): string {
  const directTrack = insertAfterPaperTrack ? paperTracks.find(track => track.paperTrack === insertAfterPaperTrack) : null
  if (directTrack?.source === 'overlay') return directTrack.paperTrack
  const gapKey = insertAfterPaperTrack ?? ''
  const lastOverlayInGap = exportOrderedPaperTracks(paperTracks)
    .filter(track => track.source === 'overlay' && (track.exportPlacement?.insertAfterPaperTrack ?? '') === gapKey)
    .at(-1)
  return lastOverlayInGap?.paperTrack ?? insertAfterPaperTrack ?? ''
}

export function overlayExportPlacementAfterTrack(
  paperTracks: PaperTrack[],
  exportAfterPaperTrack: string | undefined,
  currentPaperTrack?: string,
): NonNullable<PaperTrack['exportPlacement']> {
  const candidates = paperTracks.filter(track => track.paperTrack !== currentPaperTrack)
  const afterTrack = exportAfterPaperTrack ? candidates.find(track => track.paperTrack === exportAfterPaperTrack) : null
  if (!afterTrack) {
    return { insertAfterPaperTrack: undefined, orderInGap: -1 }
  }
  if (afterTrack.source === 'overlay') {
    return {
      insertAfterPaperTrack: afterTrack.exportPlacement?.insertAfterPaperTrack,
      orderInGap: (afterTrack.exportPlacement?.orderInGap ?? 0) + 0.5,
    }
  }
  return {
    insertAfterPaperTrack: afterTrack.paperTrack,
    orderInGap: -1,
  }
}

function exportOrderedPaperTracks(paperTracks: PaperTrack[]): PaperTrack[] {
  return [...paperTracks].sort((a, b) =>
    a.order - b.order
    || compareNaturalFileNameText(a.paperTrack, b.paperTrack),
  )
}

export function deleteRegisteredCellKey(project: CutProject, keyId: string): CutProject {
  return {
    ...project,
    logicalSheet: {
      ...project.logicalSheet,
      keys: project.logicalSheet.keys.filter(key => key.keyId !== keyId),
      events: project.logicalSheet.events.filter(event => event.keyId !== keyId),
    },
    bindings: project.bindings.filter(binding => binding.keyId !== keyId),
  }
}

export function isInteractiveKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'))
}
