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
        <p>選択、重なり順、編集時だけの表示・位置固定を管理します。</p>
      </header>
      <div className="templateRegionNavigatorList">
        {items.map((item, index) => {
          const hidden = hiddenRegionIds.has(item.regionId)
          const locked = positionLockedRegionIds.has(item.regionId)
          const selected = selectedRegionId === item.regionId
          const kindDescriptionId = `template-region-kind-${index}`
          const stateDescriptionId = `template-region-state-${index}`
          return (
            <section key={item.regionId} className={`templateRegionNavigatorItem ${selected ? 'selected' : ''} ${hidden ? 'hidden' : ''}`.trim()}>
              <button
                type="button"
                className="templateRegionNavigatorSelect"
                aria-label={item.label}
                aria-describedby={`${kindDescriptionId} ${stateDescriptionId}`}
                aria-pressed={selected}
                onClick={() => onSelect(item.regionId)}
              >
                <span className="templateRegionNavigatorText">
                  <strong>{item.label}</strong>
                  <span id={kindDescriptionId}>{item.kind}</span>
                </span>
                <span id={stateDescriptionId} className="templateRegionNavigatorState">
                  <span>{hidden ? '編集時非表示' : '表示中'}</span>
                  <span>{locked ? '一時固定' : '移動可'}</span>
                </span>
              </button>
              {selected && <div className="templateRegionNavigatorActions" role="group" aria-label={`${item.label}の操作`}>
                <button type="button" title="保存内容は変えず、編集中のキャンバス表示だけを切り替えます" aria-label={`${item.label}を編集画面で${hidden ? '表示' : '非表示'}`} aria-pressed={!hidden} onClick={() => onToggleHidden(item.regionId)}>
                  {hidden ? '表示する' : '編集時非表示'}
                </button>
                <button type="button" title="保存内容は変えず、誤操作防止のため編集中だけ位置を固定します" aria-label={`${item.label}の位置を一時的に${locked ? '固定解除' : '固定'}`} aria-pressed={locked} onClick={() => onTogglePositionLocked(item.regionId)}>
                  {locked ? '固定を解除' : '位置を一時固定'}
                </button>
                <button type="button" title="配置と表示設定を複製します。入力項目やデータ割当は元の領域と共有します" aria-label={`${item.label}を複製`} onClick={() => onDuplicate(item.regionId)}>複製</button>
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
