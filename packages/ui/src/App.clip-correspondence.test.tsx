import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createClipNode, type ClipImportData } from '@xsheet-remap/core'
import { readClipFile } from '@xsheet-remap/adapters'
import { RemapApp } from './App'
import { openAppNavigationMenu } from './App.test-support'

vi.mock('@xsheet-remap/adapters', async importOriginal => ({ ...await importOriginal<typeof import('@xsheet-remap/adapters')>(), readClipFile: vi.fn() }))

it('imports independent tracks, previews correspondence collisions, commits and undoes the full document', async () => {
  const data: ClipImportData = { fileName: 'test.clip', fileHash: 'fixture', currentTimelineId: 't',
    layers: ['A', 'B'].flatMap((name, i) => [createClipNode(`group${i}`, 'folder', null, `g${i}`), createClipNode(name, 'animation', `g${i}`, `a${i}`), createClipNode('001', 'raster', `a${i}`, `c${i}`)]),
    nodes: ['A', 'B'].map((name, i) => ({ id: `g${i}`, name: `group${i}`, path: [`group${i}`], animation: false, visible: true, children: [{ id: `a${i}`, name, path: [`group${i}`, name], animation: true, visible: true, children: [] }] })),
    timelines: [{ id: 't', name: 'timeline', fps: 24, startFrame: 0, endFrame: 24, tracks: [0, 1].map(i => ({ layerId: `a${i}`, frames: [{ frame: i * 4, value: '001' }] })) }],
  }
  vi.mocked(readClipFile).mockResolvedValue(data)
  render(<RemapApp />)
  openAppNavigationMenu()
  fireEvent.click(screen.getByRole('button', { name: '読み込み' }))
  const file = new File(['clip'], 'test.clip')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(4) })
  fireEvent.change(document.querySelector('input[accept=".clip"]')!, { target: { files: [file] } })
  fireEvent.click(await screen.findByRole('button', { name: 'group0 / Aの読み込み設定' }))
  fireEvent.click(screen.getByRole('button', { name: 'CELL' }))
  fireEvent.change(screen.getByLabelText('シートの基準にする工程を選択'), { target: { value: 'group0' } })
  fireEvent.click(screen.getByRole('button', { name: 'タイムシートに読み込む' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'CLIPを読み込む' })).toBeNull())
  const process = screen.getByLabelText('編集先の工程') as HTMLSelectElement
  const group0 = Array.from(process.options).find(option => option.text === 'group0')!.value
  const group1 = Array.from(process.options).find(option => option.text === 'group1')!.value
  fireEvent.change(process, { target: { value: group0 } })
  const events = (track: string, frame: number) => document.querySelector(`[data-timeline-event-track="${track}"][data-timeline-event-frame="${frame}"] .eventText`)
  expect(events('A', 1)?.textContent).toBe('001')
  fireEvent.click(screen.getByRole('button', { name: 'CLIPとシートの対応…' }))
  fireEvent.change(screen.getByLabelText('group0 / Aのセル列'), { target: { value: 'B' } })
  fireEvent.change(screen.getByLabelText('group0 / Aの表示グループ'), { target: { value: group1 } })
  expect(screen.getByRole('alert').textContent).toContain('複数')
  expect((screen.getByRole('button', { name: '対応を変更' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('group0 / Aの表示グループ'), { target: { value: group0 } })
  fireEvent.click(screen.getByRole('button', { name: '対応を変更' }))
  expect(events('A', 1)).toBeNull()
  expect(events('B', 1)?.textContent).toBe('001')
  expect(document.querySelector('[data-clip-layer-id="a0"] .clipLayerName')?.textContent).toBe('A')
  fireEvent.click(screen.getByRole('checkbox', { name: '工程差を表示' }))
  fireEvent.click(screen.getByLabelText('基準シートと比較'))
  expect(screen.getByRole('region', { name: '工程別タイミング差分' }).textContent).toContain('1–4')
  fireEvent.click(screen.getByLabelText('基準シートと比較'))
  fireEvent.change(process, { target: { value: group1 } })
  expect(events('B', 5)?.textContent).toBe('001')
  expect(events('B', 1)).toBeNull()
  fireEvent.change(process, { target: { value: group0 } })
  fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
  expect(events('A', 1)?.textContent).toBe('001')
  expect(events('B', 1)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'やり直し' }))
  expect(events('B', 1)?.textContent).toBe('001')
})
