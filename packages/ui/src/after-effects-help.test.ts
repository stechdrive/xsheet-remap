import { describe, expect, it } from 'vitest'
import { editorHelpChapters } from './EditorDetailedHelp'

describe.each([
  ['Remap', editorHelpChapters],
] as const)('%s After Effects help', (_name, chapters) => {
  const chapter = chapters.find(item => item.id === 'io')
  const section = chapter?.sections.find(item => item.title.includes('After Effects'))
  const terms = section?.items.map(item => item.term) ?? []
  const text = section?.items.map(item => item.description).join('\n') ?? ''

  it('explains the image-sequence workflow in operating order', () => {
    expect(terms).toEqual([
      'セル画像を連番で読み込む',
      '1列をコピーして貼る',
      '貼り付けたキーをHOLDにする',
      'レイヤー尺を延長する',
      'JSXで複数列を割り当てる',
      '起動中のAEへ直接送る',
      '適用されるキー',
      '適用できないとき',
    ])
  })

  it('distinguishes clipboard preparation from JSX and direct send', () => {
    expect(text).toMatch(/1列コピー.*タイムシートと同じ値（通常24fps）/)
    expect(text).toMatch(/JSXと直接送信.*フレームレートをAEから取得/)
    expect(text).toMatch(/現在時刻を0フレーム.*貼り付け.*タイムリマップが自動で有効/)
    expect(text).toContain('貼り付けだけではレイヤーの長さは自動では変わりません')
    expect(text).toMatch(/カットの最終フレーム.*Alt\+\].*Option\+\].*アウトポイントを延長/)
    expect(text).toMatch(/「タイムリマップ」.*全キー.*停止したキーフレームの切り替え.*HOLD/)
    expect(text).toMatch(/ブラインドの「変換終了」のキーにも同じ操作/)
    expect(text).toMatch(/タイムリマップの有効化とレイヤーの延長はJSXと同じく自動/)
  })

  it('explains key density, blanks, and missing source cells', () => {
    expect(text).toMatch(/キーは先頭と値の変化点だけ/)
    expect(text).toMatch(/1列コピー・JSX・直接送信はいずれも変化点にキー/)
    expect(text).toMatch(/JSXと直接送信はHOLD設定も自動/)
    expect(text).toMatch(/カラセルはブラインドで非表示/)
    expect(text).toMatch(/最大セル番号まで連番画像がそろっている/)
  })
})
