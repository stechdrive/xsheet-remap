import { useMemo } from 'react'
import type { CutProject, SheetTemplate } from '@xsheet-remap/core'
import { ColumnInsertionSurface } from './ColumnInsertionSurface'
import { newlyHiddenAfterLaneInsertion, sheetColumnRoleLabel, timelineLaneInsertionTargets, type TimelineColumnRole, type TimelineLaneAddition } from './sheetColumnModel'

export interface TimelineLaneInsertRequest {
  role: TimelineColumnRole
  pageId: string
  regionId?: string
  afterLaneId?: string
}

export function TimelineLaneInsertionOverlay({ project, template, request, onAdd, onCancel }: {
  project: CutProject
  template: SheetTemplate
  request: TimelineLaneInsertRequest
  onAdd: (input: TimelineLaneAddition) => void
  onCancel: () => void
}) {
  const targets = useMemo(() => timelineLaneInsertionTargets(project, template, request.role), [project, template, request.role])
  const descriptions = useMemo(() => new Map(targets.map(target => {
    const hidden = newlyHiddenAfterLaneInsertion(project, template, target.value)
    return [target.id, hidden.length ? `追加すると ${hidden.map(column => column.label).join('、')} がこのテンプレートでは非表示になります。データは保持されます。` : '列名は自動で付けます。後から変更できます。']
  })), [project, template, targets])
  const initial = targets.find(target => (!request.regionId || target.id.startsWith(`${request.regionId}:`))
    && (!request.afterLaneId || target.value.insertAfterLaneId === request.afterLaneId))
  return <ColumnInsertionSurface targets={targets} initialId={initial?.id}
    label={sheetColumnRoleLabel(template, request.role, request.regionId)}
    describe={target => descriptions.get(target.id) ?? ''}
    onConfirm={target => { onAdd(target.value); onCancel() }} onCancel={onCancel} />
}
