import { describe, expect, it } from 'vitest'
import { suggestClipBaseProcess, suggestClipProcessColumns } from './clip-process-import'
import { clipImportFolders, type ClipImportData, type ClipImportNode } from './clip-import'

const animation = (id: string, path: string[], visible = true): ClipImportNode => ({ id, name: path.at(-1)!, path, visible, animation: true, children: [] })
const group = (id: string, path: string[], visible: boolean, children: ClipImportNode[]): ClipImportNode => ({ id, name: path.at(-1)!, path, visible, animation: false, expanded: false, children })
const data = (nodes: ClipImportNode[]): ClipImportData => ({ fileName: 'test.clip', fileHash: '', currentTimelineId: '', timelines: [], nodes })
const columns = (source: ClipImportData) => suggestClipProcessColumns(source, clipImportFolders(source.nodes).map(node => node.id))

describe('initial CLIP sheet base', () => {
  it('prefers the lowest visible parent even when folded and its animation folder is hidden', () => {
    const source = data([
      group('top', ['上'], true, [animation('a', ['上', 'A'])]),
      group('middle', ['中'], true, [animation('b', ['中', 'A'], false)]),
      group('bottom', ['下'], false, [animation('c', ['下', 'A'])]),
    ])
    const before = structuredClone(source)
    expect(suggestClipBaseProcess(source, columns(source))).toBe('中')
    expect(source).toEqual(before)
    source.nodes[1].expanded = true
    expect(suggestClipBaseProcess(source, columns(source).reverse())).toBe('中')
  })
  it('checks every ancestor and only considers selected animation folders', () => {
    const source = data([
      group('top', ['上'], true, [animation('a', ['上', 'A'])]),
      group('hidden', ['非表示'], false, [group('local-on', ['非表示', '子'], true, [animation('b', ['非表示', '子', 'A'])])]),
    ])
    expect(suggestClipBaseProcess(source, columns(source))).toBe('上')
    expect(suggestClipBaseProcess(source, columns(source).filter(column => column.layerId === 'b'))).toBe('非表示／子')
    expect(suggestClipBaseProcess(source, [])).toBe('')
  })
  it('falls back to the lowest candidate when all parents are hidden', () => {
    const source = data([group('a', ['上'], false, [animation('a1', ['上', 'A'])]), group('b', ['下'], false, [animation('b1', ['下', 'A'])])])
    expect(suggestClipBaseProcess(source, columns(source))).toBe('下')
  })
  it('groups direct animation folders under the root without inventing a CLIP folder', () => {
    const source = data([animation('b', ['B']), animation('a', ['A'])])
    expect(columns(source)).toEqual([{ layerId: 'a', name: 'A', process: '最上位（ルート）' }, { layerId: 'b', name: 'B', process: '最上位（ルート）' }])
    expect(suggestClipBaseProcess(source, columns(source))).toBe('最上位（ルート）')
    expect(source.nodes).toHaveLength(2)
  })
})
