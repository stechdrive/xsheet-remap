import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { CutProject, SheetTemplate, TimelineEvent } from '@xsheet-remap/core'
import type { SheetSelection } from './appTypes'
import type { CueTextSizeStyle } from './cueTextSizing'
import { applySheetTextSize, defaultNextTimingSize, selectedSheetTextTargets, sheetTextSizeValues, stepTextFontSize, type TextSizeOperation } from './sheetTextSizing'
import { clampTextFontSizePx } from './sheetTextLayout'
import type { SheetTextSizeControlModel } from './SheetTextSizeControl'
import { sheetTextFitStatus } from './sheetTextFitStatus'

export type NextCueTextSizes = Partial<Record<'sound' | 'camera', CueTextSizeStyle>>

export function useSheetTextSizing({ project, template, selection, nextSize, setNextSize, nextCueSizesRef, protectedSheet, commitProject, commitDraft, scopeKey, pageSize }: {
  project: CutProject; template: SheetTemplate; selection: SheetSelection; nextSize: number; setNextSize: (value: number) => void
  nextCueSizesRef: RefObject<NextCueTextSizes>; protectedSheet: boolean
  commitProject: (project: CutProject) => unknown; commitDraft: () => CutProject
  scopeKey: string; pageSize: { widthPx: number; heightPx: number }
}) {
  const [nextInput, setNextInput] = useState<{ template: SheetTemplate; mode: TimelineEvent['fontSizeMode'] }>({ template, mode: undefined })
  if (nextInput.template !== template) setNextInput({ template, mode: undefined })
  const nextMode = nextInput.template === template ? nextInput.mode : undefined
  useEffect(() => { nextCueSizesRef.current = {} }, [template, nextCueSizesRef])
  const targets = useMemo(() => selectedSheetTextTargets(project, selection), [project, selection])
  const values = sheetTextSizeValues(template, targets, nextSize, pageSize)
  const notice = useMemo(() => sheetTextFitStatus(project, template, targets), [project, template, targets])
  function apply(operation: TextSizeOperation) {
    if (protectedSheet || values.disabled) return
    const source = commitDraft()
    const currentTargets = selectedSheetTextTargets(source, selection)
    const next = applySheetTextSize(source, template, currentTargets, operation, pageSize)
    if (next !== source) commitProject(next)
    if (currentTargets.cues.length) {
      for (const role of ['sound', 'camera'] as const) {
        const id = currentTargets.cues.find(cue => cue.role === role)?.cueId
        const cue = next.timedRangeCues.find(cue => cue.cueId === id)
        if (cue) nextCueSizesRef.current[role] = { fontSizePx: cue.fontSizePx, secondaryFontSizePx: cue.secondaryFontSizePx, fontSizeMode: cue.fontSizeMode }
      }
    } else {
      const first = currentTargets.events[0]
      const changed = first && next.logicalSheet.events.find(event => event.eventId === first.eventId)
      const size = operation.kind === 'reset' ? defaultNextTimingSize(template, selection)
        : changed?.fontSizePx ?? (operation.kind === 'set' ? clampTextFontSizePx(operation.value)
          : operation.kind === 'step' ? stepTextFontSize(nextSize, operation.direction) : nextSize)
      setNextSize(size)
      setNextInput({ template, mode: operation.kind === 'reset' ? undefined : operation.kind === 'fit' ? 'fit' : 'fixed' })
    }
  }
  const targetKey = `${scopeKey}:${protectedSheet}:${JSON.stringify(selection)}`
  const model: SheetTextSizeControlModel = { ...values, targetKey, notice, label: targets.label, disabled: protectedSheet || values.disabled, onApply: apply }
  const selectedEvent = selection.kind === 'cell' ? targets.events[0] : undefined
  return { model, apply, inputMode: selectedEvent ? selectedEvent.fontSizeMode : nextMode }
}
