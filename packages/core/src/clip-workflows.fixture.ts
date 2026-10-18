import { createClipNode, openClipDocument, suggestClipProcessColumns, type ClipImportData } from './index'

export function independentClipFixture() {
  const data: ClipImportData = {
    fileName: 'tracks.clip', fileHash: 'fixture', currentTimelineId: 't1',
    layers: ['あ', 'い'].flatMap((name, i) => [createClipNode(name, 'folder', null, `p${i}`), createClipNode('テスト', 'folder', `p${i}`, `g${i}`), createClipNode(i ? 'AA' : '01', 'animation', `g${i}`, `a${i}`), createClipNode('001', 'raster', `a${i}`, `cel${i}`)]),
    nodes: ['あ', 'い'].map((name, i) => ({ id: `p${i}`, name, path: [name], animation: false, visible: true, children: [{ id: `g${i}`, name: 'テスト', path: [name, 'テスト'], animation: false, visible: true, children: [{ id: `a${i}`, name: i ? 'AA' : '01', path: [name, 'テスト', i ? 'AA' : '01'], animation: true, visible: true, children: [] }] }] })),
    timelines: ['t1', 't2'].map((id, i) => ({ id, name: id, fps: 24, startFrame: 0, endFrame: 24, tracks: [{ layerId: 'a0', frames: [{ frame: i, value: '001' }, { frame: 8, value: null }] }, { layerId: 'a1', frames: [{ frame: 4 + i, value: '001' }] }] })),
  }
  const columns = suggestClipProcessColumns(data, ['a0', 'a1'])
  return { data, columns, document: openClipDocument(data, 'data:application/octet-stream;base64,AA==', { timelineIds: ['t1', 't2'], columns, role: 'cell' }) }
}

