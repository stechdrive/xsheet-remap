import type { ReactNode } from 'react'
import { ActionMenu } from './AppControls'
import { TooltipTarget } from './Tooltip'

export type TemplateRegionNavigationGroup = 'timeline' | 'information' | 'support'

export type TemplateRegionNavigationItem = {
  regionId: string
  label: string
  kind: string
  group?: TemplateRegionNavigationGroup
}

export type TemplateRootNavigationItem = {
  targetId: string
  label: string
  description: string
}

const GROUP_LABELS: Record<TemplateRegionNavigationGroup, string> = {
  timeline: 'タイムライン',
  information: 'シート情報',
  support: '補助要素',
}

export function TemplateRegionNavigator({
  items,
  rootItems = [],
  groupItem,
  selectedRegionId,
  hiddenRegionIds,
  positionLockedRegionIds,
  addControl,
  onSelect,
  onToggleHidden,
  onTogglePositionLocked,
  onDuplicate,
  onDelete,
  onMove,
}: {
  items: TemplateRegionNavigationItem[]
  rootItems?: TemplateRootNavigationItem[]
  groupItem?: TemplateRegionNavigationItem
  selectedRegionId: string | null
  hiddenRegionIds: ReadonlySet<string>
  positionLockedRegionIds: ReadonlySet<string>
  addControl?: ReactNode
  onSelect: (regionId: string) => void
  onToggleHidden: (regionId: string) => void
  onTogglePositionLocked: (regionId: string) => void
  onDuplicate: (regionId: string) => void
  onDelete: (regionId: string) => void
  onMove: (regionId: string, direction: -1 | 1) => void
}) {
  const totalCount = rootItems.length + items.length + (groupItem ? 1 : 0)
  const groupedItems = (['timeline', 'information', 'support'] as const)
    .map(group => ({ group, items: items.filter(item => (item.group ?? 'support') === group) }))
    .filter(entry => entry.items.length > 0 || (entry.group === 'timeline' && groupItem))

  return (
    <aside className="templateRegionNavigator" aria-label="テンプレート構成">
      <header>
        <div>
          <strong>構成</strong>
          <span>{totalCount}件</span>
        </div>
        <p>左で編集対象を選び、右でその内容を設定します。</p>
      </header>
      <div className="templateRegionNavigatorList">
        <section className="templateRegionNavigatorGroup" aria-label="テンプレート全体">
          <h3>テンプレート</h3>
          {rootItems.map(item => (
            <section key={item.targetId} className={`templateRegionNavigatorItem root ${selectedRegionId === item.targetId ? 'selected' : ''}`.trim()}>
              <button
                type="button"
                className="templateRegionNavigatorSelect"
                aria-label={item.label}
                aria-pressed={selectedRegionId === item.targetId}
                onClick={() => onSelect(item.targetId)}
              >
                <span className="templateRegionNavigatorText">
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </span>
              </button>
            </section>
          ))}
        </section>
        {groupedItems.map(entry => (
          <section key={entry.group} className="templateRegionNavigatorGroup" aria-label={GROUP_LABELS[entry.group]}>
            <h3>{GROUP_LABELS[entry.group]}</h3>
            {entry.group === 'timeline' && groupItem && (
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
            {entry.items.map(item => {
              const index = items.findIndex(candidate => candidate.regionId === item.regionId)
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
                          {hidden ? '表示' : '非表示'}
                        </button>
                      )}
                    </TooltipTarget>
                    <TooltipTarget label="保存内容は変えず、誤操作防止のため編集中だけ位置を固定します">
                      {tooltipProps => (
                        <button type="button" aria-label={`${item.label}の位置を一時的に${locked ? '固定解除' : '固定'}`} aria-pressed={locked} onClick={() => onTogglePositionLocked(item.regionId)} {...tooltipProps}>
                          {locked ? '固定解除' : '固定'}
                        </button>
                      )}
                    </TooltipTarget>
                    <ActionMenu label="その他" ariaLabel={`${item.label}のその他の操作`} tooltipLabel={`${item.label}の複製、重なり順、削除`} closeOnMenuItemClick>
                      <TooltipTarget label="配置と表示設定を複製します。入力項目やデータ割当は元の領域と共有します">
                        {tooltipProps => <button type="button" aria-label={`${item.label}を複製`} onClick={() => onDuplicate(item.regionId)} {...tooltipProps}>複製</button>}
                      </TooltipTarget>
                      <TooltipTarget label={alreadyFront ? 'すでに最前面です' : '重なり順を1段前面へ移動します'}>
                        {tooltipProps => <button type="button" aria-label={`${item.label}を前面へ`} aria-disabled={alreadyFront || undefined} onClick={alreadyFront ? undefined : () => onMove(item.regionId, 1)} {...tooltipProps}>前面へ</button>}
                      </TooltipTarget>
                      <TooltipTarget label={alreadyBack ? 'すでに最背面です' : '重なり順を1段背面へ移動します'}>
                        {tooltipProps => <button type="button" aria-label={`${item.label}を背面へ`} aria-disabled={alreadyBack || undefined} onClick={alreadyBack ? undefined : () => onMove(item.regionId, -1)} {...tooltipProps}>背面へ</button>}
                      </TooltipTarget>
                      <TooltipTarget label={cannotDelete ? '最後の領域は削除できません' : 'この領域をテンプレートから削除します'}>
                        {tooltipProps => <button type="button" className="danger" aria-label={`${item.label}を削除`} aria-disabled={cannotDelete || undefined} onClick={cannotDelete ? undefined : () => onDelete(item.regionId)} {...tooltipProps}>削除</button>}
                      </TooltipTarget>
                    </ActionMenu>
                  </div>}
                </section>
              )
            })}
          </section>
        ))}
      </div>
      {addControl && <footer className="templateRegionNavigatorFooter">{addControl}</footer>}
    </aside>
  )
}
