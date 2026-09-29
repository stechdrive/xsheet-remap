import { DEFAULT_POST_ROLL_FRAMES, DEFAULT_PRE_ROLL_FRAMES, type LogicalSheetWorkRange } from '@xsheet-remap/core'
import { TooltipTarget } from './Tooltip'
import { uiText } from './i18n'

export function SheetWorkRangeControls({ workRange, supportsPreRoll, supportsPostRoll, onChange }: {
  workRange: LogicalSheetWorkRange
  supportsPreRoll?: boolean
  supportsPostRoll?: boolean
  onChange: (workRange: LogicalSheetWorkRange) => void
}) {
  return <>
    <TooltipTarget label={`${uiText.sheet.preRollTitle}\n${uiText.sheet.preRollFixedTitle(DEFAULT_PRE_ROLL_FRAMES)}`}>
      {tooltipProps => (
        <label className="compactControl dummyKControl" {...tooltipProps}>
          <input type="checkbox" checked={workRange.showPreRoll} disabled={supportsPreRoll === false}
            onChange={event => onChange({ ...workRange, preRollFrames: DEFAULT_PRE_ROLL_FRAMES, showPreRoll: event.currentTarget.checked })} />
          {uiText.sheet.preRoll}
        </label>
      )}
    </TooltipTarget>
    <TooltipTarget label={`${uiText.sheet.postRollTitle}\n${uiText.sheet.postRollMinimumTitle(DEFAULT_POST_ROLL_FRAMES)}`}>
      {tooltipProps => (
        <label className="compactControl dummyKControl" {...tooltipProps}>
          <input type="checkbox" checked={workRange.showPostRoll && workRange.postRollFrames > 0} disabled={supportsPostRoll === false}
            onChange={event => onChange({ ...workRange, showPostRoll: event.currentTarget.checked,
              postRollFrames: event.currentTarget.checked ? Math.max(DEFAULT_POST_ROLL_FRAMES, workRange.postRollFrames) : workRange.postRollFrames })} />
          {uiText.sheet.postRoll}
        </label>
      )}
    </TooltipTarget>
    {workRange.showPostRoll && workRange.postRollFrames > 0 && <span className="muted workRangeMeta">{uiText.sheet.postRollFrames(workRange.postRollFrames)}</span>}
  </>
}
