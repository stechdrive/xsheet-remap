import { useSyncExternalStore } from 'react'
import { ToolbarGroup } from './AppControls'
import { FloatingHoverPalette } from './FloatingHoverPalette'
import { uiText } from './i18n'
import { Tooltip } from './Tooltip'
import { TEMPLATE_ZOOM_SLIDER_MAX, TEMPLATE_ZOOM_SLIDER_MIN, templateZoomFromSliderValue, templateZoomToSliderValue } from './templateZoom'
import type { TemplateEditorViewStore } from './templateEditorViewStore'

export function TemplateEditorViewControls({
  store,
  hasReferenceImage,
  onFit,
}: {
  store: TemplateEditorViewStore
  hasReferenceImage: boolean
  onFit: () => void
}) {
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const zoomPercent = Math.round(view.zoom * 100)
  const zoomPreset = [100, 400, 800, 1600, 3200].includes(zoomPercent) ? String(zoomPercent) : ''

  return (
    <ToolbarGroup className="templateViewToolbarGroup">
      {hasReferenceImage && (
        <label className="compactControl templateReferenceOpacityControl">
          下絵
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            aria-label="下絵の不透明度"
            value={Math.round(view.referenceOpacity * 100)}
            onInput={event => store.setReferenceOpacity(Number(event.currentTarget.value) / 100)}
            onChange={event => store.setReferenceOpacity(Number(event.currentTarget.value) / 100)}
          />
          <span className="zoomValue">{Math.round(view.referenceOpacity * 100)}%</span>
        </label>
      )}
      <FloatingHoverPalette
        className="templateZoomFloatingPalette"
        label={uiText.sheet.zoomTitle}
        valueLabel={`${zoomPercent}%`}
      >
        <label className="compactControl templateZoomSliderControl">
          {uiText.sheet.zoom}
          <input
            type="range"
            min={TEMPLATE_ZOOM_SLIDER_MIN}
            max={TEMPLATE_ZOOM_SLIDER_MAX}
            step="1"
            aria-label={uiText.sheet.zoom}
            value={templateZoomToSliderValue(view.zoom)}
            aria-valuetext={`${zoomPercent}%`}
            onInput={event => store.setZoom(templateZoomFromSliderValue(Number(event.currentTarget.value)))}
            onChange={event => store.setZoom(templateZoomFromSliderValue(Number(event.currentTarget.value)))}
          />
        </label>
        <label className="compactControl templateZoomPresetControl">
          倍率
          <select
            aria-label="ズーム倍率"
            value={zoomPreset}
            onChange={event => store.setZoom(Number(event.currentTarget.value) / 100)}
          >
            <option value="" disabled>選択</option>
            <option value="100">100%</option>
            <option value="400">400%</option>
            <option value="800">800%</option>
            <option value="1600">1600%</option>
            <option value="3200">3200%</option>
          </select>
        </label>
        <Tooltip label={uiText.actions.zoomFitTitle}>
          <button onClick={onFit}>{uiText.actions.zoomFit}</button>
        </Tooltip>
      </FloatingHoverPalette>
    </ToolbarGroup>
  )
}
