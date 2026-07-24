import {
  cloneSheetTemplateTheme,
  sheetTemplateThemePreset,
  sheetTemplateThemePresets,
  type SheetTemplateTheme,
  type SheetTemplateTimedRangeCueTheme,
} from '@xsheet-remap/core'
import type { ReactNode } from 'react'

export function SheetThemeEditor({
  theme,
  onChange,
}: {
  theme: SheetTemplateTheme
  onChange: (theme: SheetTemplateTheme) => void
}) {
  function update(updater: (current: SheetTemplateTheme) => SheetTemplateTheme) {
    onChange({ ...updater(theme), presetId: undefined })
  }

  function applyPreset(presetId: string) {
    const preset = sheetTemplateThemePreset(presetId)
    if (preset) onChange(cloneSheetTemplateTheme(preset.theme))
  }

  function updateCue(role: 'sound' | 'camera', updates: Partial<SheetTemplateTimedRangeCueTheme>) {
    update(current => ({
      ...current,
      timedRangeCues: {
        ...current.timedRangeCues,
        [role]: { ...current.timedRangeCues[role], ...updates },
      },
    }))
  }

  return (
    <div className="sheetThemeEditor detailStack">
      <label>
        <span>用紙テーマ</span>
        <select aria-label="用紙テーマ" value={theme.presetId ?? ''} onChange={event => applyPreset(event.currentTarget.value)}>
          <option value="">カスタム</option>
          {sheetTemplateThemePresets.map(preset => <option key={preset.presetId} value={preset.presetId}>{preset.name}</option>)}
        </select>
      </label>

      <ThemeGroup title="用紙">
        <ColorInput label="用紙色" value={theme.paper.color} onChange={color => update(current => ({
          ...current,
          paper: { ...current.paper, color },
        }))} />
        <label className="compactControl">
          <input
            type="checkbox"
            aria-label="1秒ごとの背景帯"
            checked={theme.paper.secondBands.enabled}
            onChange={event => update(current => ({
              ...current,
              paper: {
                ...current.paper,
                secondBands: { ...current.paper.secondBands, enabled: event.currentTarget.checked },
              },
            }))}
          />
          <span>1秒ごとの背景帯</span>
        </label>
        <ColorInput
          label="秒背景帯の色"
          value={theme.paper.secondBands.color}
          disabled={!theme.paper.secondBands.enabled}
          onChange={color => update(current => ({
            ...current,
            paper: {
              ...current.paper,
              secondBands: { ...current.paper.secondBands, color },
            },
          }))}
        />
        <OpacityInput
          label="秒背景帯の濃度"
          value={theme.paper.secondBands.opacity}
          disabled={!theme.paper.secondBands.enabled}
          onChange={opacity => update(current => ({
            ...current,
            paper: {
              ...current.paper,
              secondBands: { ...current.paper.secondBands, opacity },
            },
          }))}
        />
      </ThemeGroup>

      <ThemeGroup title="文字・罫線">
        <ColorInput label="文字色" value={theme.ink.text} onChange={text => update(current => ({
          ...current,
          ink: { ...current.ink, text },
        }))} />
        <ColorInput label="参照枠色" value={theme.ink.reference} onChange={reference => update(current => ({
          ...current,
          ink: { ...current.ink, reference },
        }))} />
        {([
          ['細罫線色', 'thin'],
          ['通常罫線色', 'regular'],
          ['中罫線色', 'medium'],
          ['強罫線色', 'strong'],
          ['外枠色', 'outer'],
        ] as const).map(([label, key]) => (
          <ColorInput key={key} label={label} value={theme.ink.lines[key]} onChange={color => update(current => ({
            ...current,
            ink: { ...current.ink, lines: { ...current.ink.lines, [key]: color } },
          }))} />
        ))}
      </ThemeGroup>

      <CueThemeGroup
        title="SOUND列"
        ariaPrefix="SOUND"
        theme={theme.timedRangeCues.sound}
        onChange={updates => updateCue('sound', updates)}
      />
      <CueThemeGroup
        title="CAMERA列"
        ariaPrefix="CAMERA"
        theme={theme.timedRangeCues.camera}
        onChange={updates => updateCue('camera', updates)}
      />
    </div>
  )
}

function CueThemeGroup({
  title,
  ariaPrefix,
  theme,
  onChange,
}: {
  title: string
  ariaPrefix: string
  theme: SheetTemplateTimedRangeCueTheme
  onChange: (updates: Partial<SheetTemplateTimedRangeCueTheme>) => void
}) {
  return (
    <ThemeGroup title={title}>
      <ColorInput label={`${ariaPrefix} 奇数列色`} value={theme.columnColors[0]} onChange={color => onChange({
        columnColors: [color, theme.columnColors[1]],
      })} />
      <ColorInput label={`${ariaPrefix} 偶数列色`} value={theme.columnColors[1]} onChange={color => onChange({
        columnColors: [theme.columnColors[0], color],
      })} />
      <ColorInput label={`${ariaPrefix} 枠線色`} value={theme.strokeColor} onChange={strokeColor => onChange({ strokeColor })} />
      <ColorInput label={`${ariaPrefix} 文字色`} value={theme.textColor} onChange={textColor => onChange({ textColor })} />
      <OpacityInput label={`${ariaPrefix} 塗り濃度`} value={theme.fillOpacity} onChange={fillOpacity => onChange({
        fillOpacity,
        hoverOpacity: Math.max(fillOpacity, theme.hoverOpacity),
      })} />
      <OpacityInput label={`${ariaPrefix} ホバー濃度`} value={theme.hoverOpacity} onChange={hoverOpacity => onChange({
        hoverOpacity: Math.max(theme.fillOpacity, hoverOpacity),
      })} />
    </ThemeGroup>
  )
}

function ThemeGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="sheetThemeGroup">
      <legend>{title}</legend>
      <div className="sheetThemeGrid">{children}</div>
    </fieldset>
  )
}

function ColorInput({
  label,
  value,
  disabled = false,
  onChange,
}: {
  label: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="sheetThemeColorControl">
      <span>{label}</span>
      <input type="color" aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.currentTarget.value)} />
    </label>
  )
}

function OpacityInput({
  label,
  value,
  disabled = false,
  onChange,
}: {
  label: string
  value: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  const percentage = Math.round(value * 100)
  return (
    <label className="sheetThemeOpacityControl">
      <span>{label}</span>
      <input
        type="range"
        aria-label={label}
        min="0"
        max="50"
        value={percentage}
        disabled={disabled}
        onChange={event => onChange(Number(event.currentTarget.value) / 100)}
      />
      <output>{percentage}%</output>
    </label>
  )
}
