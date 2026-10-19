import type { SheetTemplate } from '@xsheet-remap/core'
import { sheetColumnRoleLabel, type SheetColumnAddKind, type SheetColumnRole } from './sheetColumnModel'
import { uiText } from './i18n'

export function SheetColumnAddMenuItems({ template, role, regionId, onAdd }: {
  template: SheetTemplate
  role?: SheetColumnRole
  regionId?: string
  onAdd: (kind: SheetColumnAddKind) => void
}) {
  return <>
    <div className="sheetContextMenuTitle">追加</div>
    {(!role || role === 'action' || role === 'cell') && <>
      <button type="button" role="menuitem" onClick={() => onAdd('label-editor')}>{uiText.stackGuides.add}</button>
      <button type="button" role="menuitem" onClick={() => onAdd('overlay-track')}>{uiText.stackGuides.addOverlayTrack}</button>
    </>}
    {(['sound', 'camera'] as const).filter(candidate => (!role || role === candidate)
      && template.regions.some(region => region.grid?.role === candidate)).map(candidate => <button
      key={candidate} type="button" role="menuitem" onClick={() => onAdd(candidate)}
    >{sheetColumnRoleLabel(template, candidate, regionId)}列を追加</button>)}
  </>
}
