import { useEffect, useId, useState } from 'react'
import { isTauriHost } from '@xsheet-remap/adapters'
import { EditorDetailedHelp } from './EditorDetailedHelp'
import { LicenseNotices, licenseHelpDescription } from './LicenseNotices'
import { TemplateEditorDetailedHelp, TemplateEditorQuickGuide } from './TemplateEditorHelp'
import { remapProcessHelp } from './remap-process-help'
import { openRemapHelp, readRemapHelpLocation, remapHelpUrl, type RemapHelpLocation, type RemapHelpTopic } from './remap-help-entry'

const topics = [
  { id: 'sheet', label: 'シート編集' },
  { id: 'clip', label: 'CLIP組み立て' },
  { id: 'template', label: 'テンプレート作成・編集' },
] as const

const views = [
  { id: 'quick', label: 'クイックガイド' },
  { id: 'detailed', label: '詳しい使い方' },
  { id: 'licenses', label: 'ライセンス・謝辞' },
] as const

export type { RemapHelpTopic } from './remap-help-entry'

export function RemapHelpDialog({
  appName = 'xsheet-remap',
  initialTopic = 'sheet',
  onClose,
}: {
  appName?: string
  initialTopic?: RemapHelpTopic
  onClose: () => void
}) {
  return <RemapHelp appName={appName} initialLocation={{ topic: initialTopic, view: 'quick' }} onClose={onClose} />
}

export function RemapHelpPage() {
  return <RemapHelp appName="xsheet-remap" initialLocation={readRemapHelpLocation(window.location.search)} />
}

function RemapHelp({ appName, initialLocation, onClose }: {
  appName: string
  initialLocation: RemapHelpLocation
  onClose?: () => void
}) {
  const id = useId()
  const [location, setLocation] = useState(initialLocation)
  const [openError, setOpenError] = useState('')
  const [opening, setOpening] = useState(false)
  const { topic, view: helpView, chapter } = location
  const detailed = helpView === 'detailed'
  const standalone = !onClose
  const setHelpView = (view: RemapHelpLocation['view']) => setLocation(current => ({ ...current, view }))
  const onChapterChange = (chapter: string) => setLocation(current => ({ ...current, chapter }))

  useEffect(() => {
    if (standalone) window.history.replaceState(null, '', remapHelpUrl(location))
  }, [standalone, location])

  async function detachHelp() {
    setOpenError('')
    setOpening(true)
    try {
      await openRemapHelp(location)
      onClose?.()
    } catch (error) {
      setOpenError(`ヘルプを開けませんでした。${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className={standalone ? 'remapHelpPage' : 'appHelpBackdrop'} role={standalone ? 'main' : 'dialog'}
      aria-modal={standalone ? undefined : true} aria-label={`${appName}の使い方`}>
      <section className="appHelpDialog appHelpDialogTabbed remapHelpDialog">
        <header>
          <div>
            <strong>{appName} ヘルプ</strong>
            <span>{helpView === 'licenses' ? licenseHelpDescription : 'シート編集、CLIP組み立て、テンプレート作成・編集の使い方を確認できます。'}</span>
          </div>
          {onClose && <div className="remapHelpActions">
            <button type="button" disabled={opening} onClick={() => { void detachHelp() }}>
              {isTauriHost() ? '別ウィンドウで開く' : '別タブで開く'}
            </button>
            <button type="button" onClick={onClose}>閉じる</button>
          </div>}
        </header>
        <div className="appHelpControls">
          {openError && <p role="alert" className="remapHelpOpenError">{openError}</p>}
          <div className="appHelpTabs appHelpTopics" role="group" aria-label="ヘルプの対象">
            {topics.map(item => (
              <button key={item.id} type="button" aria-pressed={topic === item.id}
                className={topic === item.id ? 'active' : ''}
                onClick={() => setLocation(current => ({
                  topic: item.id,
                  view: current.view === 'licenses' ? 'quick' : current.view,
                  chapter: current.topic === item.id ? current.chapter : undefined,
                }))}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="appHelpTabs" role="tablist" aria-label="ヘルプの種類">
            {views.map((view, index) => (
              <button key={view.id} type="button" role="tab" id={`${id}-${view.id}`}
                aria-controls={`${id}-panel`} aria-selected={helpView === view.id}
                tabIndex={helpView === view.id ? 0 : -1} className={helpView === view.id ? 'active' : ''}
                onClick={() => setHelpView(view.id)}
                onKeyDown={event => {
                  const next = event.key === 'ArrowRight' ? (index + 1) % views.length
                    : event.key === 'ArrowLeft' ? (index + views.length - 1) % views.length
                      : event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1 : null
                  if (next === null) return
                  event.preventDefault()
                  setHelpView(views[next].id)
                  document.getElementById(`${id}-${views[next].id}`)?.focus()
                }}>
                {view.label}
              </button>
            ))}
          </div>
        </div>
        <div key={`${topic}-${helpView}`} id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${helpView}`} tabIndex={0}
          className={`appHelpBody${detailed ? ' appHelpBodyDetailed' : topic === 'template' ? ' templateHelpQuickBody' : ' remapHelpQuickBody'}`}>
          {helpView === 'licenses' ? <LicenseNotices /> : topic === 'template'
            ? detailed ? <TemplateEditorDetailedHelp activeChapterId={chapter} onChapterChange={onChapterChange} /> : <TemplateEditorQuickGuide />
            : detailed ? <EditorDetailedHelp topic={topic} activeChapterId={chapter} onChapterChange={onChapterChange} />
              : topic === 'sheet' ? <SheetQuickGuide /> : <ClipQuickGuide />}
        </div>
        {helpView !== 'licenses' && <footer>
          <p>上の対象を選ぶと、ほかの機能の説明も読めます。細かな操作は「詳しい使い方」の目次から選んでください。</p>
        </footer>}
      </section>
    </div>
  )
}

function SheetQuickGuide() {
  return <>
    <article className="appHelpWorkflow">
      <h2>タイムシートを作って保存する</h2>
      <p>上部の「シート編集」で、カット情報・タイミング・指示を入力します。</p>
      <p>工程別のタイミングがあるCLIPでは、上部の「基準」で普段のタイムシートとして使う工程を選びます。「シート編集」とシート画像の書き出しには、この工程のタイミングを使います。</p>
      <ol>
        <li><strong>カット情報と尺を決める</strong><span>「カット情報」を開き、作品名、話数、カット番号、尺を入力します。続きの作業は「プロジェクト」から.xsrを開きます。</span></li>
        <li><strong>ACTIONまたはCELLへタイミングを入れる</strong><span>マスを選び、番号を入力してEnterで確定します。半角の x はカラセル、/ は中割記号○、. は中割記号●です。範囲をドラッグすると、右クリックまたは「…」からコピー・貼り付け・リピートを使えます。</span></li>
        <li><strong>必要な指示を加える</strong><span>台詞やSEはSOUND、撮影指示はCAMERAの区間を選んで入力します。メモは対象のコマ・指示・MEMO欄を選んでから、ペンやテキストで追加します。</span></li>
        <li><strong>全体を見直す</strong><span>「表示設定」で紙・デジタルの様式を選び、「全体表示」や連続表示で確認します。紙に収まらない列は、列数の多いテンプレートやデジタル表示へ切り替えて確認できます。</span></li>
        <li><strong>.xsrで保存する</strong><span>「プロジェクト」→「保存」で、シート、指示、メモ、素材、テンプレート、音声をまとめて保存します。</span></li>
      </ol>
    </article>
    <article className="appHelpWorkflow">
      <h2>音声・紙シート・他ソフトとつなぐ</h2>
      <ol>
        <li><strong>セリフ音声からSOUNDを作る</strong><span>下部の「音声」で録音・音声読込を行い、クリップの移動・分割・トリムで間を整えます。必要な発話区間を選び「音響指示へ割付…」でSOUNDにします。</span></li>
        <li><strong>紙タイムシートを転記する</strong><span>「紙シート」→「読込」でスキャン画像を入れ、「補正」で罫線を合わせます。「紙シートのAI読み取り」では外部AIへ画像と依頼文を渡し、返ってきたJSONを確認・修正してから反映できます。</span></li>
        <li><strong>素材をクリスタへ登録する</strong><span>上部で「CLIP組み立て」へ切り替えます。シート、音声、レイヤー構造、Undo履歴を引き継いで、右のレイヤーツリーから素材を扱えます。手順はこのヘルプの「CLIP組み立て」で確認できます。</span></li>
        <li><strong>確認や後工程へ渡す</strong><span>「書き出し」でPNG・JPG・レイヤーPSD、XDTS、After Effects用データを選びます。AEへ1列をコピーした場合は、貼り付け後にキーをHOLDにし、レイヤー尺を伸ばします。詳しい手順は「読み込みと書き出し」の章にあります。</span></li>
        <li><strong>スタジオの用紙に合わせる</strong><span>メニューの「テンプレートを作成・編集…」で専用画面を開きます。作り方とシートへの反映は、このヘルプの「テンプレート作成・編集」にまとめています。</span></li>
      </ol>
    </article>
  </>
}

function ClipQuickGuide() {
  return <>
    <article className="appHelpWorkflow appHelpWorkflowPrep">
      <h2>素材とタイミングからCLIPを作る</h2>
      <p>上部の「CLIP組み立て」へ切り替え、右のレイヤーツリーで素材を扱います。</p>
      <ol>
        <li><strong>始め方を選ぶ</strong><span>新規なら既定のレイヤー構造を使います。既存CLIPを使う場合は、作業の最初に「読み込み」→「CLIPを読み込む」で開きます。現在のシート、下敷き、Undo履歴がリセットされるため、残す作業は先に.xsrへ保存します。</span></li>
        <li><strong>基準・編集先と登録先を確認する</strong><span>上部の「基準」で普段のタイムシートに使う工程、「編集先」でいま登録・編集する工程を選びます。右のアニメーションフォルダーに工程・セル列の対応を設定します。ツリーからドラッグするセルは、そのフォルダーの工程へ登録されます。</span></li>
        <li><strong>画像を追加してシートへ置く</strong><span>右のフォルダーへ画像をまとめて追加します。クイックルックで絵を確認し、セルをACTION／CELLのコマへドラッグします。OSからシートへ直接落とす画像は、上部の編集先工程を使います。</span></li>
        <li><strong>既存番号への登録を確認する</strong><span>番号のあるコマや継続区間へ落としたときは、工程別の登録状況を確認し、その番号への登録・差し替え、または新しい番号としての配置を選びます。</span></li>
        <li><strong>CLIPを保存する</strong><span>右でセル名、フォルダー、重ね順、表示、不透明度、合成モードを確認します。「書き出し」→「CLIPを作成」でACTION／CELLと対象カットを選んで保存します。作業を再開できるよう.xsrも保存します。</span></li>
      </ol>
    </article>
    <article className="appHelpWorkflow">
      <h2>「基準」と「編集先」の使い分け</h2>
      <p>{remapProcessHelp.context}</p>
      <ol>
        <li><strong>基準</strong><span>{remapProcessHelp.base}</span></li>
        <li><strong>編集先</strong><span>{remapProcessHelp.editing}</span></li>
        <li><strong>使い分けの例</strong><span>{remapProcessHelp.example}</span></li>
        <li><strong>工程ごとのタイミングを保持する</strong><span>既存CLIPから読み込んだ工程別タイミングは個別に保持します。工程や作業モードを切り替えても、タイミングを統合・同期することはありません。新規作業の番号とタイミングは全工程共通です。</span></li>
      </ol>
      <h2>既存CLIPの整理と保存</h2>
      <ol>
        <li><strong>シート番号とセル名を整理する</strong><span>シート上の番号とCLIPのセル名は別々に管理します。右の「一括リネーム」で変更内容を確認して適用できます。</span></li>
        <li><strong>CLIPの音声を編集する</strong><span>音声レイヤーを選ぶと「CLIPの音声を使う」から取り込めます。配置・分割・トリム・ミュートはCLIPへ書き戻せます。未対応の音量変化などを含む音声は元CLIP内に保持します。</span></li>
        <li><strong>用紙サイズと描画を確認する</strong><span>既存CLIPの用紙サイズと未編集部分を保持します。新規CLIPでは必要なキャンバスサイズを指定します。追加画像は中央に配置し、用紙の外側を切り取ります。CSP固有の効果の再描画は行いません。</span></li>
      </ol>
    </article>
  </>
}
