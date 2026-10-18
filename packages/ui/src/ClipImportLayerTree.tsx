import { useEffect, useMemo, useRef, useState } from 'react'
import { clipImportFolders, clipProcessName, type ClipImportColumn, type ClipImportData, type ClipImportNode, type ClipLayerNode } from '@xsheet-remap/core'
import { ClipLayerTreeItem } from './ClipLayerTreeItem'

function SelectionCheckbox({ label, checked, mixed, onChange }: { label: string; checked: boolean; mixed: boolean; onChange: (checked: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed }, [mixed])
  return <label className="clipLayerEye clipImportCheck" onClick={event => event.stopPropagation()}><input ref={ref} type="checkbox" aria-label={label} checked={checked} onChange={event => onChange(event.currentTarget.checked)} /></label>
}

export function ClipImportLayerTree({ data, selected, columns, baseProcess, focusedId, onFocus, onToggle, onAll }: {
  data: ClipImportData; selected: string[]; columns: ClipImportColumn[]; baseProcess: string; focusedId: string
  onFocus: (node: ClipImportNode) => void; onToggle: (ids: string[], checked: boolean) => void; onAll: (checked: boolean) => void
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const ids = new Set<string>()
    function visit(nodes: ClipImportNode[]) { for (const node of nodes) { if (node.expanded === false) ids.add(node.id); visit(node.children) } }
    visit(data.nodes); return ids
  })
  const [search, setSearch] = useState('')
  const layers = useMemo(() => new Map(data.layers?.map(node => [node.id, node])), [data.layers])
  const selectedIds = new Set(selected), byId = new Map(columns.map(column => [column.layerId, column]))
  const matches = (node: ClipImportNode): boolean => node.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) || node.children.some(matches)
  function renderNodes(nodes: ClipImportNode[], parentId: string | null = null, depth = 0, insideCel = false): React.ReactNode {
    return nodes.filter(node => !search || matches(node)).map(node => {
      const layer: ClipLayerNode = layers.get(node.id) ?? { id: node.id, parentId, name: node.name, kind: node.animation ? 'animation' : node.children.length ? 'folder' : 'raster', visible: node.visible, opacity: 1, blendMode: 0 }
      const targets = insideCel ? [] : clipImportFolders([node]).map(item => item.id)
      const count = targets.filter(id => selectedIds.has(id)).length
      const base = node.animation ? false : node.children.some(child => child.animation && byId.has(child.id) && clipProcessName(byId.get(child.id)!) === baseProcess)
      const expanded = !collapsed.has(node.id)
      return <ClipLayerTreeItem key={node.id} node={layer} depth={depth} path={node.path.join(' / ')} selected={focusedId === node.id} expanded={expanded}
        rowProps={{ onClick: () => onFocus(node) }} onToggle={() => setCollapsed(current => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next })}
        leading={targets.length ? <SelectionCheckbox label={`${node.path.join(' / ')}のセル指定を取り込む`} checked={count > 0 && count === targets.length} mixed={count > 0 && count < targets.length} onChange={checked => onToggle(targets, checked)} /> : <span className="clipLayerEye" />}
        thumbnailLabel={`${node.path.join(' / ')}の読み込み設定`} onThumbnail={() => onFocus(node)}
        badges={<>{base && <small>シートの基準</small>}{!node.visible && <small>非表示</small>}</>}>
        {expanded && renderNodes(node.children, node.id, depth + 1, insideCel || node.animation)}
      </ClipLayerTreeItem>
    })
  }
  const rootBase = data.nodes.some(node => node.animation && byId.has(node.id) && clipProcessName(byId.get(node.id)!) === baseProcess)
  return <aside className="clipLayerPanel clipImportPalette" aria-label="読み込むCLIPのレイヤー">
    <div className="clipPaletteTitle"><strong>シートに取り込むセル指定</strong>{rootBase && <span>最上位（ルート）：シートの基準</span>}</div>
    <div className="clipImportSelectionActions"><button type="button" onClick={() => onAll(true)}>すべて選択</button><button type="button" onClick={() => onAll(false)}>すべて解除</button></div>
    <div className="clipLayerSearch"><input aria-label="読み込むレイヤーを検索" placeholder="レイヤーを検索" value={search} onChange={event => setSearch(event.target.value)} /></div>
    <div className="clipLayerTree clipImportTree" role="tree" aria-label="読み込むCLIPのレイヤーツリー">{renderNodes(data.nodes)}</div>
  </aside>
}
