import { describe, expect, it } from 'vitest'
import { editorHelpChapters } from './EditorDetailedHelp'
import { remapHelpChapters } from './RemapDetailedHelp'

describe.each([
  ['Editor', editorHelpChapters],
  ['Remap', remapHelpChapters],
] as const)('%s After Effects help', (_name, chapters) => {
  const chapter = chapters.find(item => item.id === 'io')
  const section = chapter?.sections.find(item => item.title.includes('After Effects'))
  const terms = section?.items.map(item => item.term) ?? []
  const text = section?.items.map(item => item.description).join('\n') ?? ''

  it('explains the image-sequence workflow in operating order', () => {
    expect(terms).toEqual([
      'セル画像を連番で読み込む',
      '1列をコピーして貼る',
      'JSXで複数列を割り当てる',
      '起動中のAEへ直接送る',
      '適用されるキー',
      '適用できないとき',
    ])
  })

  it('distinguishes clipboard preparation from JSX and direct send', () => {
    expect(text).toMatch(/1列コピー.*タイムシートと同じ値（通常24fps）/)
    expect(text).toMatch(/JSXと直接送信.*フレームレートをAEから取得/)
    expect(text).toMatch(/現在時刻を0フレーム.*レイヤー終端をカットの終わりまで/)
    expect(text).toContain('コピーされるのはキーだけなので、レイヤーの長さは自動では変わりません')
    expect(text).toMatch(/タイムリマップの有効化とレイヤーの延長はJSXと同じく自動/)
  })

  it('explains key density, blanks, and missing source cells', () => {
    expect(text).toMatch(/1列コピーは各コマにキー.*JSXと直接送信は変化したコマだけ/)
    expect(text).toMatch(/カラセルはブラインドで非表示/)
    expect(text).toMatch(/最大セル番号まで連番画像がそろっている/)
  })
})
