import { type CutProject, sheetTimingRoleForKey, upsertBinding } from '@xsheet-remap/core'
import { materialStateLabels, uiText } from './i18n'
import { sheetRoleLabel } from './sheetInteraction'

export function BindingPanel({ project, commitProject, selectedKeyId }: { project: CutProject; commitProject: (project: CutProject) => void; selectedKeyId: string | null }) {
  const keys = selectedKeyId ? project.logicalSheet.keys.filter(key => key.keyId === selectedKeyId) : project.logicalSheet.keys
  return (
    <section className="panel">
      <div className="bindingTableWrap">
        <table className="bindingTable">
          <thead>
            <tr>
              <th>{uiText.bindings.key}</th>
              {project.cspTrackSlots.map(slot => <th key={slot.slotId}>{slotDisplayLabel(project, slot)}</th>)}
            </tr>
          </thead>
          <tbody>
            {keys.map(key => (
              <tr key={key.keyId}>
                <th>{sheetRoleLabel(sheetTimingRoleForKey(key))} {key.paperTrack}-{key.displayLabel}</th>
                {project.cspTrackSlots.map(slot => {
                  const binding = project.bindings.find(item => item.keyId === key.keyId && item.slotId === slot.slotId)
                  return (
                    <td key={slot.slotId}>
                      <input
                        value={binding?.cspCellName ?? ''}
                        placeholder={`${slot.paperTrack}${key.displayLabel}`}
                        onChange={event => commitProject(upsertBinding(project, { slotId: slot.slotId, keyId: key.keyId, cspCellName: event.target.value, materialState: binding?.materialState ?? 'unassigned' }))}
                      />
                      <select
                        value={binding?.materialState ?? 'unassigned'}
                        onChange={event => commitProject(upsertBinding(project, { slotId: slot.slotId, keyId: key.keyId, materialState: event.target.value as 'assigned' | 'unassigned' | 'missing-ok' }))}
                      >
                        <option value="unassigned">{materialStateLabels.unassigned}</option>
                        <option value="assigned">{materialStateLabels.assigned}</option>
                        <option value="missing-ok">{materialStateLabels['missing-ok']}</option>
                      </select>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function slotDisplayLabel(project: CutProject, slot: CutProject['cspTrackSlots'][number]): string {
  const layer = slot.correctionLayerId
    ? project.correctionLayers.find(item => item.layerId === slot.correctionLayerId)
    : undefined
  return [layer?.label, slot.paperTrack].filter(Boolean).join('/')
}
