import { useMemo } from 'react'
import type { CutProject, SheetTemplate } from '@xsheet-remap/core'
import { ActionMenu } from './AppControls'
import { hiddenSheetColumns, sheetColumnRoleLabel } from './sheetColumnModel'

export function SheetHiddenColumnsNotice({ project, template, onShowDigital }: {
  project: CutProject; template: SheetTemplate; onShowDigital?: () => void
}) {
  const hidden = useMemo(() => hiddenSheetColumns(project, template), [project, template])
  if (!hidden.length) return null
  return <div className="sheetHiddenColumnsNotice">
    <ActionMenu className="sheetHiddenColumnsMenu" label={`非表示 ${hidden.length}列`} ariaLabel={`このテンプレートでは${hidden.length}列が非表示`} placement="bottom-start" closeOnMenuItemClick>
      <p>このテンプレートに収まらない列があります。データは保持されています。</p>
      <ul>{hidden.map(column => <li key={`${column.role}:${column.id}`}>
        {sheetColumnRoleLabel(template, column.role)}：{column.label}
      </li>)}</ul>
      {onShowDigital && <button type="button" onClick={onShowDigital}>デジタル標準で表示</button>}
    </ActionMenu>
  </div>
}
