import { TooltipTarget } from './Tooltip'

export type TemplateRegionNavigationItem = {
  regionId: string
  label: string
  kind: string
}

export function TemplateRegionNavigator({
  items,
  groupItem,
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
  groupItem?: TemplateRegionNavigationItem
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
          <strong>{groupItem ? '用紙構成' : '領域'}</strong>
          <span>{items.length + (groupItem ? 1 : 0)}件</span>
        </div>
        <p>{groupItem ? '6秒表と、個別に配置するシート情報・補助要素を選びます。' : '選択、重なり順、編集時だけの表示・位置固定を管理します。'}</p>
      </header>
      <div className="templateRegionNavigatorList">
        {groupItem && (
          <section className={`templateRegionNavigatorItem paperTimeline ${selectedRegionId === groupItem.regionId ? 'selected' : ''}`.trim()}>
            <button
              type="button"
              className="templateRegionNavigatorSelect"
              aria-label={groupItem.label}
              aria-pressed={selectedRegionId === groupItem.regionId}
              onClick={() => onSelect(groupItem.regionId)}
            >
              <span className="templateRegionNavigatorText">
                <strong>{groupItem.label}</strong>
                <span>{groupItem.kind}</span>
              </span>
              <span className="templateRegionNavigatorState"><span>行を共有</span><span>必須構造</span></span>
            </button>
          </section>
        )}
        {items.map((item, index) => {
          const hidden = hiddenRegionIds.has(item.regionId)
          const locked = positionLockedRegionIds.has(item.regionId)
          const selected = selectedRegionId === item.regionId
          const alreadyFront = index === items.length - 1
          const alreadyBack = index === 0
          const cannotDelete = items.length <= 1
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
                <TooltipTarget label="保存内容は変えず、編集中のキャンバス表示だけを切り替えます">
                  {tooltipProps => (
                    <button type="button" aria-label={`${item.label}を編集画面で${hidden ? '表示' : '非表示'}`} aria-pressed={!hidden} onClick={() => onToggleHidden(item.regionId)} {...tooltipProps}>
                      {hidden ? '表示する' : '編集時非表示'}
                    </button>
                  )}
                </TooltipTarget>
                <TooltipTarget label="保存内容は変えず、誤操作防止のため編集中だけ位置を固定します">
                  {tooltipProps => (
                    <button type="button" aria-label={`${item.label}の位置を一時的に${locked ? '固定解除' : '固定'}`} aria-pressed={locked} onClick={() => onTogglePositionLocked(item.regionId)} {...tooltipProps}>
                      {locked ? '固定を解除' : '位置を一時固定'}
                    </button>
                  )}
                </TooltipTarget>
                <TooltipTarget label="配置と表示設定を複製します。入力項目やデータ割当は元の領域と共有します">
                  {tooltipProps => <button type="button" aria-label={`${item.label}を複製`} onClick={() => onDuplicate(item.regionId)} {...tooltipProps}>複製</button>}
                </TooltipTarget>
                <TooltipTarget label={alreadyFront ? 'すでに最前面です' : '重なり順を1段前面へ移動します'}>
                  {tooltipProps => <button type="button" aria-label={`${item.label}を前面へ`} aria-disabled={alreadyFront || undefined} onClick={alreadyFront ? undefined : () => onMove(item.regionId, 1)} {...tooltipProps}>前面</button>}
                </TooltipTarget>
                <TooltipTarget label={alreadyBack ? 'すでに最背面です' : '重なり順を1段背面へ移動します'}>
                  {tooltipProps => <button type="button" aria-label={`${item.label}を背面へ`} aria-disabled={alreadyBack || undefined} onClick={alreadyBack ? undefined : () => onMove(item.regionId, -1)} {...tooltipProps}>背面</button>}
                </TooltipTarget>
                <TooltipTarget label={cannotDelete ? '最後の領域は削除できません' : 'この領域をテンプレートから削除します'}>
                  {tooltipProps => <button type="button" className="danger" aria-label={`${item.label}を削除`} aria-disabled={cannotDelete || undefined} onClick={cannotDelete ? undefined : () => onDelete(item.regionId)} {...tooltipProps}>削除</button>}
                </TooltipTarget>
              </div>}
            </section>
          )
        })}
      </div>
    </aside>
  )
}
