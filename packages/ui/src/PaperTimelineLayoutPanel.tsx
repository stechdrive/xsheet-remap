import type { NormalizedRect, SheetTemplate } from '@xsheet-remap/core'
import {
  detectPaperTimelineStructure,
  mmToPx,
  normalizePaperTimelineRows,
  paperTimelineColumnWidthMm,
  paperTimelineGapPx,
  paperTimelineRoleRegion,
  pxToMm,
  resizePaperTimelineColumns,
  setPaperTimelineGapPx,
  setPaperTimelineRoleWidthPx,
  transformPaperTimelineRect,
  type PaperTimelineRole,
  type PaperTimelineStructure,
} from './paperTimelineAuthoring'

export function PaperTimelineLayoutPanel({
  template,
  structure,
  onChange,
  onOpenReference,
}: {
  template: SheetTemplate
  structure: PaperTimelineStructure
  onChange: (updater: (template: SheetTemplate) => SheetTemplate) => void
  onOpenReference: () => void
}) {
  if (structure.status === 'incomplete') {
    return (
      <section className="paperTimelinePanel paperTimelineBlocked" aria-label="用紙レイアウト">
        <header>
          <span>6秒タイムライン表</span>
          <h2>表の必須領域が不足しています</h2>
          <p>ACTION・SOUND・CELL・CAMERAを左右3秒分そろえる必要があります。</p>
        </header>
        <div className="paperTimelineIssue" role="alert">
          <strong>不足している領域</strong>
          <span>{structure.missingLabels.join(' / ')}</span>
        </div>
        <button type="button" onClick={onOpenReference}>用紙画像から再構築する</button>
      </section>
    )
  }

  const tableRectPx = normalizedRectToPixels(structure.rect, template)
  const leftAction = paperTimelineRoleRegion(template, structure, 'action')!
  const leftSound = paperTimelineRoleRegion(template, structure, 'sound')!
  const leftCell = paperTimelineRoleRegion(template, structure, 'cell')!
  const leftCamera = paperTimelineRoleRegion(template, structure, 'camera')!
  const roleRegions: Array<{ role: PaperTimelineRole; region: typeof leftAction }> = [
    { role: 'action', region: leftAction },
    { role: 'sound', region: leftSound },
    { role: 'cell', region: leftCell },
    { role: 'camera', region: leftCamera },
  ]
  const sharedPaperTrackCount = template.defaults.paperTracks.length

  function changeTableRectMm(key: keyof NormalizedRect, mm: number) {
    if (!Number.isFinite(mm)) return
    onChange(current => {
      const currentStructure = detectPaperTimelineStructure(current)
      if (!currentStructure || currentStructure.status === 'incomplete') return current
      const currentRect = currentStructure.rect
      const normalizedValue = mmToPx(mm, current) / (key === 'x' || key === 'w' ? current.page.widthPx : current.page.heightPx)
      return transformPaperTimelineRect(current, currentStructure, { ...currentRect, [key]: normalizedValue })
    })
  }

  function changeRoleWidthMm(role: Exclude<PaperTimelineRole, 'camera'>, mm: number) {
    if (!Number.isFinite(mm)) return
    onChange(current => {
      const currentStructure = detectPaperTimelineStructure(current)
      return currentStructure
        ? setPaperTimelineRoleWidthPx(current, currentStructure, role, mmToPx(mm, current))
        : current
    })
  }

  function changeColumnCount(role: PaperTimelineRole, count: number) {
    onChange(current => {
      const currentStructure = detectPaperTimelineStructure(current)
      return currentStructure ? resizePaperTimelineColumns(current, currentStructure, role, count) : current
    })
  }

  return (
    <section className="paperTimelinePanel" aria-label="用紙レイアウト">
      <header>
        <span>用紙レイアウト</span>
        <h2>6秒タイムライン表</h2>
        <p>左右3秒・各72行の横罫線を共有したまま、表全体と列構成を調整します。</p>
      </header>

      {structure.status === 'misaligned' && (
        <div className="paperTimelineIssue" role="alert">
          <strong>横罫線が揃っていません</strong>
          <span>現在のACTION左3秒を基準に、全領域を同じ72行へ修復できます。</span>
          <button type="button" onClick={() => onChange(current => {
            const currentStructure = detectPaperTimelineStructure(current)
            return currentStructure ? normalizePaperTimelineRows(current, currentStructure) : current
          })}>72行へ揃える</button>
        </div>
      )}

      <section className="paperTimelineFixedContract" aria-label="固定された時間構成">
        <div><strong>左3秒</strong><span>1–72F</span></div>
        <div><strong>右3秒</strong><span>73–144F</span></div>
        <p>24fps / 72行 × 2ブロック。行数と左右の縦位置は変更できません。</p>
      </section>

      <fieldset className="paperTimelineFieldset">
        <legend>表全体の位置と大きさ</legend>
        <div className="paperTimelineCoordinateGrid">
          {([
            ['x', 'X', tableRectPx.x],
            ['y', 'Y', tableRectPx.y],
            ['w', '幅', tableRectPx.w],
            ['h', '高さ', tableRectPx.h],
          ] as const).map(([key, label, valuePx]) => (
            <label key={key}>
              <span>{label}</span>
              <span className="paperTimelineNumberInput"><input
                type="number"
                step="0.1"
                min={key === 'w' || key === 'h' ? '0.1' : undefined}
                aria-label={`6秒タイムライン表 ${label} mm`}
                value={formatNumber(pxToMm(valuePx, template))}
                onChange={event => changeTableRectMm(key, Number(event.currentTarget.value))}
              /><small>mm</small></span>
            </label>
          ))}
          <label>
            <span>左右間隔</span>
            <span className="paperTimelineNumberInput"><input
              type="number"
              step="0.1"
              min="0"
              aria-label="左右3秒ブロックの間隔 mm"
              value={formatNumber(pxToMm(paperTimelineGapPx(structure, template), template))}
              onChange={event => {
                const mm = Number(event.currentTarget.value)
                if (!Number.isFinite(mm)) return
                onChange(current => {
                  const currentStructure = detectPaperTimelineStructure(current)
                  return currentStructure ? setPaperTimelineGapPx(current, currentStructure, mmToPx(mm, current)) : current
                })
              }}
            /><small>mm</small></span>
          </label>
        </div>
        <p>キャンバスの外周ハンドルでも同じ表全体を調整できます。</p>
      </fieldset>

      <fieldset className="paperTimelineFieldset">
        <legend>列幅</legend>
        <div className="paperTimelineRoleList">
          {roleRegions.map(({ role, region }, index) => {
            const widthMm = pxToMm(region.rect.w * template.page.widthPx, template)
            const columnMm = paperTimelineColumnWidthMm(region, template)
            const editable = index < roleRegions.length - 1
            return (
              <label key={role} className={columnMm < 2.5 ? 'warning' : ''}>
                <span><strong>{role.toUpperCase()}</strong><small>{region.grid?.columns.length ?? 1}列 / 1列 {formatNumber(columnMm)}mm</small></span>
                <span className="paperTimelineNumberInput"><input
                  type="number"
                  step="0.1"
                  min="0.1"
                  disabled={!editable}
                  aria-label={`${role.toUpperCase()}幅 mm`}
                  value={formatNumber(widthMm)}
                  onChange={event => editable && changeRoleWidthMm(role as Exclude<PaperTimelineRole, 'camera'>, Number(event.currentTarget.value))}
                /><small>mm</small></span>
              </label>
            )
          })}
        </div>
        <p>変更した境界だけを動かし、対応する左右ブロックへ同じ差分を適用します。CAMERA幅は残り幅から決まります。</p>
      </fieldset>

      <fieldset className="paperTimelineFieldset">
        <legend>列数</legend>
        <div className="paperTimelineColumnCountGrid">
          <ColumnCountControl label="ACTION / CELL共有" value={sharedPaperTrackCount} onChange={count => changeColumnCount('cell', count)} />
          <ColumnCountControl label="SOUND" value={leftSound.grid?.columns.length ?? 1} onChange={count => changeColumnCount('sound', count)} />
          <ColumnCountControl label="CAMERA" value={leftCamera.grid?.columns.length ?? 1} onChange={count => changeColumnCount('camera', count)} />
        </div>
        <p>列数を変えても表全体や他の領域は自動縮小しません。1列幅が狭い場合は上の列境界を広げます。</p>
      </fieldset>

      <div className="paperTimelinePanelActions">
        <button type="button" onClick={onOpenReference}>参照画像に合わせる</button>
      </div>
    </section>
  )
}

function ColumnCountControl({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="paperTimelineColumnCount">
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`${label}の列数を減らす`} disabled={value <= 1} onClick={() => onChange(value - 1)}>−</button>
        <input type="number" min="1" max="64" aria-label={`${label}の列数`} value={value} onChange={event => onChange(Number(event.currentTarget.value))} />
        <button type="button" aria-label={`${label}の列数を増やす`} disabled={value >= 64} onClick={() => onChange(value + 1)}>＋</button>
      </div>
    </div>
  )
}

function normalizedRectToPixels(rect: NormalizedRect, template: SheetTemplate): NormalizedRect {
  return {
    x: rect.x * template.page.widthPx,
    y: rect.y * template.page.heightPx,
    w: rect.w * template.page.widthPx,
    h: rect.h * template.page.heightPx,
  }
}

function formatNumber(value: number): string {
  return Number(value.toFixed(1)).toString()
}
