export type TemplateRegionNavigationItem = {
  regionId: string
  label: string
  kind: string
}

export function TemplateRegionNavigator({
  items,
  selectedRegionId,
  hiddenRegionIds,
  positionLockedRegionIds,
  onSelect,
  onToggleHidden,
  onTogglePositionLocked,
  onDuplicate,
  onDelete,
  onMove,
}: {
  items: TemplateRegionNavigationItem[]
  selectedRegionId: string | null
  hiddenRegionIds: ReadonlySet<string>
  positionLockedRegionIds: ReadonlySet<string>
  onSelect: (regionId: string) => void
  onToggleHidden: (regionId: string) => void
  onTogglePositionLocked: (regionId: string) => void
  onDuplicate: (regionId: string) => void
  onDelete: (regionId: string) => void
  onMove: (regionId: string, direction: -1 | 1) => void
}) {
  return (
    <aside className="templateRegionNavigator" aria-label="領域一覧">
      <header>
        <div>
          <strong>領域</strong>
          <span>{items.length}件</span>
        </div>
        <p>選択、位置ロック、表示、重なり順を管理します。</p>
      </header>
      <div className="templateRegionNavigatorList">
        {items.map((item, index) => {
          const hidden = hiddenRegionIds.has(item.regionId)
          const locked = positionLockedRegionIds.has(item.regionId)
          const selected = selectedRegionId === item.regionId
          return (
            <section key={item.regionId} className={`templateRegionNavigatorItem ${selected ? 'selected' : ''} ${hidden ? 'hidden' : ''}`.trim()}>
              <button
                type="button"
                className="templateRegionNavigatorSelect"
                aria-label={item.label}
                aria-pressed={selected}
                onClick={() => onSelect(item.regionId)}
              >
                <strong>{item.label}</strong>
                <span>{item.kind}</span>
              </button>
              {selected && <div className="templateRegionNavigatorActions">
                <button type="button" aria-label={`${item.label}を表示${hidden ? '' : 'しない'}`} aria-pressed={!hidden} onClick={() => onToggleHidden(item.regionId)}>
                  {hidden ? '表示' : '非表示'}
                </button>
                <button type="button" aria-label={`${item.label}の位置を${locked ? 'ロック解除' : 'ロック'}`} aria-pressed={locked} onClick={() => onTogglePositionLocked(item.regionId)}>
                  {locked ? '解除' : '位置固定'}
                </button>
                <button type="button" aria-label={`${item.label}を複製`} onClick={() => onDuplicate(item.regionId)}>複製</button>
                <button type="button" aria-label={`${item.label}を前面へ`} disabled={index === items.length - 1} onClick={() => onMove(item.regionId, 1)}>前面</button>
                <button type="button" aria-label={`${item.label}を背面へ`} disabled={index === 0} onClick={() => onMove(item.regionId, -1)}>背面</button>
                <button type="button" className="danger" aria-label={`${item.label}を削除`} disabled={items.length <= 1} onClick={() => onDelete(item.regionId)}>削除</button>
              </div>}
            </section>
          )
        })}
      </div>
    </aside>
  )
}
