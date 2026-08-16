import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { assignSheetSourceToPage, createDefaultProject, createOrSetEvent, createProjectDocumentFromCutProject, createTimedRangeCue, digitalStandardSheetTemplate, registerAsset, registerAssetRoot, registerSheetSource, resolveSheetTemplatePageSize, timelineLanesForLayout, upsertBinding, standardA3SheetTemplate, updateLogicalSheetSettings, updateSheetViewState } from '@xsheet-remap/core';
import { encodeProjectArchive, XSR_PROJECT_FILE_ACCEPT, XSR_PROJECT_MIME_TYPE } from '@xsheet-remap/adapters';
import { App, EditorApp, RemapApp } from './App';
import { APP_VERSION } from './appVersion';
import { uiText } from './i18n';
import { rememberSheetTemplatePreset } from './mainAppPreferences';
import { ASSET_DRAG_MIME } from './sheetConstants';
import { clickSheet, clickTemplateFrame, cspPaneTrackRow, dragCspPaneRow, dragInternalPointer, enterTimingValue, expectSelectedHit, expectStatusHint, formatTestFramePosition, getAssetCardByName, getZoomSlider, markMissingTauriPath, openAppNavigationMenu, openCutMetadataMenu, openDisplaySettingsMenu, openPaperSheetMenu, openSharedCutMenu, openTimingExportDialog, registeredCellIdentityText, selectAppPanel, selectCspCorrectionLayer, setSheetRect, sheetImageHrefs, stackGuideConnectorAnchorX, templateFramePoint } from './App.test-support'
import { SHEET_TEMPLATE_FILE_ACCEPT } from './app-template-import'
import { createDefaultDialogueAudioCutState, updateDialogueAudioCutStateInProject } from './dialogueAudioProject'

const originalUserAgentDataDescriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgentData')
afterEach(() => {
  if (originalUserAgentDataDescriptor) Object.defineProperty(navigator, 'userAgentData', originalUserAgentDataDescriptor)
  else Reflect.deleteProperty(navigator, 'userAgentData')
})
async function createXsrTestFile(document: Parameters<typeof encodeProjectArchive>[0], fileName = 'project.xsr'): Promise<File> {
  const archive = await encodeProjectArchive(document, { createdWith: 'test' })
  return new File([new Uint8Array(archive)], fileName, { type: XSR_PROJECT_MIME_TYPE })
}

async function createDigitalTemplateDraft() {
  fireEvent.click(screen.getByLabelText('テンプレートのその他の操作'))
  fireEvent.click(screen.getByRole('button', { name: '新しいテンプレート' }))
  const dialog = screen.getByRole('dialog', { name: '新しいテンプレート' })
  fireEvent.click(within(dialog).getByRole('tab', { name: 'デジタルタイムシート' }))
  fireEvent.click(within(dialog).getByRole('button', { name: '作成' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '新しいテンプレート' })).toBeNull())
}

function selectTemplateInspector(sectionId: string) {
  if (sectionId === 'region') {
    const selectedRegion = document.querySelector<HTMLButtonElement>('.templateRegionNavigatorSelect[aria-pressed="true"]')
    if (!selectedRegion) throw new Error('selected template region not found')
    const target = selectedRegion.closest('.paperTimeline') || selectedRegion.closest('.root')
      ? document.querySelector<HTMLButtonElement>('.templateRegionNavigatorItem:not(.paperTimeline):not(.root) .templateRegionNavigatorSelect')
      : selectedRegion
    if (!target) throw new Error('editable template region not found')
    fireEvent.click(target)
    return
  }
  const labels: Record<string, string> = {
    template: '用紙と見た目',
    display: '用紙と見た目',
    reference: '下絵',
  }
  if (sectionId === 'review') {
    fireEvent.click(screen.getByLabelText('テンプレートのその他の操作'))
    fireEvent.click(screen.getByRole('button', { name: '検証結果を表示' }))
    return
  }
  if (sectionId === 'json') {
    fireEvent.click(screen.getByLabelText('テンプレートのその他の操作'))
    fireEvent.click(screen.getByRole('button', { name: 'JSONを表示' }))
    return
  }
  const label = labels[sectionId]
  if (!label) throw new Error(`unknown template inspector section: ${sectionId}`)
  const structure = screen.getByRole('complementary', { name: 'テンプレート構成' })
  const button = within(structure).queryByRole('button', { name: label })
    ?? (sectionId === 'template' || sectionId === 'display'
      ? within(structure).queryByRole('button', { name: 'テンプレートと見た目' })
      : null)
  if (!button) throw new Error(`template inspector section not found: ${label}`)
  fireEvent.click(button)
}

describe('App: workspace and template', () => {
it('renders the main workspace shell', () => {
    render(<App />)
    expect(screen.getByText('xsheet-editor')).toBeTruthy()
    const appNavigationMenu = openAppNavigationMenu()
    expect(within(appNavigationMenu).getByText(`xsheet-editor v${APP_VERSION}`)).toBeTruthy()
    expect(within(appNavigationMenu).getByRole('button', { name: uiText.nav.sheet })).toBeTruthy()
    expect(within(appNavigationMenu).getByRole('button', { name: uiText.actions.xdts })).toBeTruthy()
    expect(within(appNavigationMenu).getByRole('button', { name: uiText.actions.aeJsx })).toBeTruthy()
    expect(within(appNavigationMenu).queryByRole('button', { name: uiText.actions.aeSend })).toBeNull()
    expect(within(appNavigationMenu).queryByRole('button', { name: '認識' })).toBeNull()
    expect(within(appNavigationMenu).queryByRole('button', { name: uiText.nav.sources })).toBeNull()
    expect(within(appNavigationMenu).queryByRole('button', { name: uiText.nav.assets })).toBeNull()
    expect(within(appNavigationMenu).getByRole('button', { name: uiText.nav.template })).toBeTruthy()
    expect(within(appNavigationMenu).queryByRole('button', { name: 'セル対応' })).toBeNull()
    expect(within(appNavigationMenu).queryByRole('button', { name: 'セル重ね順' })).toBeNull()
    expect(screen.queryByText('詳細スロット一覧')).toBeNull()
    fireEvent.click(within(appNavigationMenu).getByRole('button', { name: uiText.actions.exportMenu }))
    expect(within(appNavigationMenu).queryByText(/補正済み紙シート（全\d+ページ）/)).toBeNull()
    expect(screen.getByLabelText('紙シート')).toBeTruthy()
    expect(screen.getByLabelText(uiText.recognition.menu)).toBeTruthy()
    expect(screen.getByLabelText(uiText.sheet.displaySettingsMenu)).toBeTruthy()
    const paperMenu = openPaperSheetMenu()
    expect(within(paperMenu).getByRole('button', { name: uiText.sheet.imageCorrection })).toBeTruthy()
    expect(within(paperMenu).getByLabelText(uiText.actions.loadSheetSourceFiles)).toBeTruthy()
    expect(within(paperMenu).queryByLabelText(uiText.actions.correctedSheetImageExport)).toBeNull()
    expect(document.querySelector('.topBar .paperSheetTopGroup')).toBeNull()
    expect(document.querySelector('.sheetToolbar')).toBeNull()
    expect(screen.getByRole('toolbar', { name: 'シート表示と編集' })).toBeTruthy()
    expect(document.querySelector('.sheetWorkspace')).toBeTruthy()
    expect(document.querySelector('.sheetDockLeft .cspLayerTreeHeader strong')?.textContent).toBe('CSPレイヤー構成')
    expect(document.querySelector('.sheetDockRight h2')?.textContent).toBe(uiText.assets.title)
    expect(screen.queryByRole('tablist', { name: uiText.sheet.sideDock })).toBeNull()
  })

  it('shows direct After Effects send only in a Windows Tauri host', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { platform: 'Windows' } })
    render(<App />)

    expect(within(openAppNavigationMenu()).getByRole('button', { name: uiText.actions.aeSend })).toBeTruthy()
  })

  it('keeps hamburger flyouts mutually exclusive across click, hover, and focus', () => {
    render(<App />)
    const menu = openAppNavigationMenu()
    const projectTrigger = within(menu).getByRole('button', { name: 'プロジェクト' })
    const importTrigger = within(menu).getByRole('button', { name: '読み込み' })
    const exportTrigger = within(menu).getByRole('button', { name: uiText.actions.exportMenu })

    fireEvent.click(projectTrigger)
    expect(projectTrigger.getAttribute('aria-expanded')).toBe('true')
    expect(menu.querySelectorAll('.appNavFlyout.submenuOpen')).toHaveLength(1)

    fireEvent.pointerEnter(importTrigger)
    expect(projectTrigger.getAttribute('aria-expanded')).toBe('false')
    expect(importTrigger.getAttribute('aria-expanded')).toBe('true')
    expect(menu.querySelectorAll('.appNavFlyout.submenuOpen')).toHaveLength(1)

    fireEvent.focus(exportTrigger)
    expect(importTrigger.getAttribute('aria-expanded')).toBe('false')
    expect(exportTrigger.getAttribute('aria-expanded')).toBe('true')
    expect(menu.querySelectorAll('.appNavFlyout.submenuOpen')).toHaveLength(1)

    fireEvent.keyDown(exportTrigger, { key: 'Escape' })
    expect(exportTrigger.getAttribute('aria-expanded')).toBe('false')
    expect(menu.querySelectorAll('.appNavFlyout.submenuOpen')).toHaveLength(0)
    expect(document.querySelector('.actionMenuPortalContent.appNavMenu')).toBe(menu)
  })

  it('shows Editor-specific help instead of the Remap workflow', () => {
    render(<EditorApp />)
    fireEvent.click(screen.getByRole('button', { name: 'ヘルプ' }))

    const dialog = screen.getByRole('dialog', { name: 'xsheet-editorの使い方' })
    expect(within(dialog).getByRole('tab', { name: 'クイックガイド' }).getAttribute('aria-selected')).toBe('true')
    expect(within(dialog).getByRole('tab', { name: '詳しい使い方' })).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: 'タイムシートを作って保存する' })).toBeTruthy()
    expect(within(dialog).getByText(/ページ数と入力できる最終フレーム/)).toBeTruthy()
    expect(within(dialog).getByText(/\.xsrにはタイミング、指示、注釈、素材対応、テンプレート、音声編集/)).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: 'やりたいことに合わせて仕上げる' })).toBeTruthy()
    expect(within(dialog).getByText(/発話候補を選んで「音響指示へ割付…」/)).toBeTruthy()
    expect(within(dialog).getByText(/文字認識は候補を確認してから採用/)).toBeTruthy()
    expect(within(dialog).getByText(/csp-import\.xciを同梱のxsheet-importerで選び/)).toBeTruthy()
    expect(within(dialog).getByText(/After Effectsは1列なら列見出し/)).toBeTruthy()
    expect(within(dialog).queryByRole('heading', { name: '必ず先に準備すること' })).toBeNull()
  })

  it('keeps project and template file selectors on separate format contracts', () => {
    render(<App />)
    const menu = openAppNavigationMenu()
    const projectInput = within(menu).getByText(uiText.actions.loadProject).closest('label')?.querySelector<HTMLInputElement>('input[type="file"]')
    const templateInput = within(menu).getByText('シートテンプレートを読み込む…').closest('label')?.querySelector<HTMLInputElement>('input[type="file"]')
    expect(projectInput?.accept).toBe(XSR_PROJECT_FILE_ACCEPT)
    expect(templateInput?.accept).toBe(SHEET_TEMPLATE_FILE_ACCEPT)
  })

  it('opens the chapter-based Editor manual from help', () => {
    render(<EditorApp />)
    fireEvent.click(screen.getByRole('button', { name: 'ヘルプ' }))

    const dialog = screen.getByRole('dialog', { name: 'xsheet-editorの使い方' })
    fireEvent.click(within(dialog).getByRole('tab', { name: '詳しい使い方' }))

    expect(within(dialog).getByRole('tab', { name: '詳しい使い方' }).getAttribute('aria-selected')).toBe('true')
    expect(within(dialog).getByRole('navigation', { name: '詳しい使い方の目次' })).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: '画面の見方' })).toBeTruthy()
    expect(within(dialog).getByText('全13章')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: /04\s*ACTION・CELL入力/ }))
    expect(within(dialog).getByRole('heading', { name: 'ACTION・CELL入力' })).toBeTruthy()
    expect(within(dialog).getByText('ACTIONとCELLの共通列')).toBeTruthy()
    expect(within(dialog).getByText(/デジタルではACTION／CELLの通常列/)).toBeTruthy()
    expect(within(dialog).getByText('フレーム挿入・削除')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: /05\s*SOUND指示/ }))
    expect(within(dialog).getByRole('heading', { name: '音声トラックを準備する' })).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: '再生・位置確認・表示' })).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: '選択と非破壊編集' })).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: 'VAD候補をSOUNDへ割り付ける' })).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: 'リンクの同期と保存' })).toBeTruthy()
    expect(within(dialog).getByText(/波形だけ編集するなら「検出しない」/)).toBeTruthy()
    expect(within(dialog).getByText(/Ctrl\+Shift\+Vで挿入貼り付け/)).toBeTruthy()
    expect(within(dialog).getByText(/音声をSOUND位置へ揃える/)).toBeTruthy()
    expect(within(dialog).getByText('SOUND列の管理')).toBeTruthy()
    expect(within(dialog).getByText(/紙で欄数を超えた列は「欄外＋件数」/)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: /06\s*CAMERA指示/ }))
    expect(within(dialog).getByText('CAMERA列の管理')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: /12\s*読み込みと書き出し/ }))
    expect(within(dialog).getByRole('heading', { name: '読み込みと書き出し' })).toBeTruthy()
    expect(within(dialog).getByText('CSP自動登録データ')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: /09\s*素材・登録セル・CSP構成/ }))
    expect(within(dialog).getByText('ペイン下部の操作')).toBeTruthy()
    expect(within(dialog).getByText('ドラッグで並び替え')).toBeTruthy()
    expect(within(dialog).getByText('BG／BOOK・紙の欄外セル列')).toBeTruthy()
    expect(within(dialog).getByText(/デジタルでは追加セル列を通常のACTION／CELL列/)).toBeTruthy()
  })

it('guides Remap users from their available source through CSP registration', () => {
    render(<RemapApp />)
    fireEvent.click(screen.getByRole('button', { name: 'ヘルプ' }))

    const dialog = screen.getByRole('dialog', { name: 'xsheet-remapの使い方' })
    expect(within(dialog).getByRole('tab', { name: 'クイックガイド' }).getAttribute('aria-selected')).toBe('true')
    expect(within(dialog).getByRole('tab', { name: '詳しい使い方' })).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: '照合結果をCSPへ登録する' })).toBeTruthy()
    expect(within(dialog).getByText(/\.xsrを開きます。既存タイミングは.*XDTSを読み込む.*何もない場合/)).toBeTruthy()
    expect(within(dialog).getByText(/実際のカットフォルダを登録/)).toBeTruthy()
    expect(within(dialog).getByText(/下部の「登録先」が意図した工程/)).toBeTruthy()
    expect(within(dialog).getByText(/紙シート、タイミング、素材対応、CSP構成を作業ファイルへ保存/)).toBeTruthy()
    expect(within(dialog).getByText(/対象\.clipと保存先を選んで開始/)).toBeTruthy()
    expect(within(dialog).getByText(/素材がないキーは「キーのみ」/)).toBeTruthy()
    expect(within(dialog).queryByRole('heading', { name: '必ず先に準備すること' })).toBeNull()
  })

  it('opens the complete Remap manual without Editor-only audio or template authoring', () => {
    render(<RemapApp />)
    fireEvent.click(screen.getByRole('button', { name: 'ヘルプ' }))

    const dialog = screen.getByRole('dialog', { name: 'xsheet-remapの使い方' })
    fireEvent.click(within(dialog).getByRole('tab', { name: '詳しい使い方' }))

    expect(within(dialog).getByRole('tab', { name: '詳しい使い方' }).getAttribute('aria-selected')).toBe('true')
    expect(within(dialog).getByRole('navigation', { name: 'Remapの詳しい使い方の目次' })).toBeTruthy()
    expect(within(dialog).getByText('全13章')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: /05\s*SOUND指示/ }))
    expect(within(dialog).getByRole('heading', { name: 'SOUND指示' })).toBeTruthy()
    expect(within(dialog).getByText('SOUND列の管理')).toBeTruthy()
    expect(within(dialog).queryByRole('heading', { name: '音声トラックを準備する' })).toBeNull()
    expect(within(dialog).queryByText(/VAD/)).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: /07\s*メモと注釈/ }))
    expect(within(dialog).getByText('用紙のメモ欄')).toBeTruthy()
    expect(within(dialog).getByText('タイムラインメモ')).toBeTruthy()
    expect(within(dialog).getByText('ページ上の自由注釈')).toBeTruthy()
    expect(within(dialog).getByText('CSPレイヤー構成の「メモ」')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: /08\s*紙シート画像と認識/ }))
    expect(within(dialog).getByText(/ACTIONまたはCELLを選び、全ページを解析/)).toBeTruthy()
    expect(within(dialog).getByText(/既存イベント.*採用されない/)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: /09\s*素材・登録セル・CSP構成/ }))
    expect(within(dialog).getByText(/CSP自動登録は、このフォルダを素材の基準と出力先に使うため必須/)).toBeTruthy()
    expect(within(dialog).getByText(/現在の登録先は工程見出しの印とペイン下部/)).toBeTruthy()
    expect(within(dialog).getByText(/ディスク上の実ファイルが改名/)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: /11\s*表示テンプレート/ }))
    expect(within(dialog).getByText('xsheet-templateで作る')).toBeTruthy()
    expect(within(dialog).queryByRole('heading', { name: 'テンプレートを用意する' })).toBeNull()
    expect(within(dialog).queryByRole('heading', { name: 'レイアウトを編集する' })).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: /12\s*読み込みと書き出し/ }))
    expect(within(dialog).getByText(/「上書き」、空欄だけ補うなら「空きだけ」/)).toBeTruthy()
    expect(within(dialog).getByText('どのカットと修正シートが出るか')).toBeTruthy()
    expect(within(dialog).getByText(/グループ内の全カットをまとめて対象/)).toBeTruthy()
    expect(within(dialog).getByText(/現在画面に表示しているカットと初稿／修正シートだけ/)).toBeTruthy()
    expect(within(dialog).getByText(/csp-import\.xciをxsheet-importerへ選択またはドロップ/)).toBeTruthy()
    expect(within(dialog).getByText(/日本語版AE／英語版AE/)).toBeTruthy()
    expect(within(dialog).getByText('複数列をJSXで渡す')).toBeTruthy()
    expect(within(dialog).getByText('起動中のAEへ送る')).toBeTruthy()
  })

it('loads XDTS through the import menu with ACTION as the default destination', async () => {
    render(<App />)
    const xdts = `exchangeDigitalTimeSheet Save Data
{"version":10,"header":{"cut":"2","scene":"1"},"timeTables":[{"name":"main","duration":24,"frameRate":24,"timeTableHeaders":[{"fieldId":0,"names":["A"]}],"fields":[{"fieldId":0,"tracks":[{"trackNo":0,"frames":[{"frame":0,"data":[{"values":["A1"]}]}]}]}]}]}`
    const menu = openAppNavigationMenu()
    const input = within(menu).getByText('XDTSを読み込む…').closest('label')?.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).toBeTruthy()
    fireEvent.change(input!, { target: { files: [new File([xdts], 'sample.xdts', { type: 'text/plain' })] } })

    const dialog = await screen.findByRole('dialog', { name: 'XDTSを読み込む' })
    expect(within(dialog).getByRole('button', { name: 'ACTION' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(dialog).getByRole('button', { name: '読み込む' }))

    await waitFor(() => expect(document.querySelector('.eventText')?.textContent).toBe('A1'))
  })

it('validates and applies a sheet template loaded from the import menu', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)
    const importedTemplate = {
      ...structuredClone(standardA3SheetTemplate),
      templateId: 'test-imported-template',
      name: '読込テストテンプレート',
    }
    const menu = openAppNavigationMenu()
    const input = within(menu).getByText('シートテンプレートを読み込む…').closest('label')?.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).toBeTruthy()
    fireEvent.change(input!, { target: { files: [new File([JSON.stringify(importedTemplate)], 'template.json', { type: 'application/json' })] } })

    await waitFor(() => expect(confirm).toHaveBeenCalled())
    selectAppPanel(uiText.nav.template)
    selectTemplateInspector('template')
    await waitFor(() => expect((screen.getByLabelText(uiText.template.name) as HTMLInputElement).value).toBe('読込テストテンプレート'))
    confirm.mockRestore()
  })

it('provides a focused CSP remap shell without template authoring navigation', () => {
    render(<RemapApp />)
    expect(screen.getByText('xsheet-remap')).toBeTruthy()
    expect(document.querySelector('.cspLayerTree')).toBeTruthy()
    expect(screen.getByText('CSPレイヤー構成')).toBeTruthy()
    expect(screen.queryByText('パレット表示順')).toBeNull()
    expect(screen.queryByText('CSPパレット上端')).toBeNull()
    expect(screen.queryByText('CSPパレット下端')).toBeNull()
    const appNavigationMenu = openAppNavigationMenu()
    expect(within(appNavigationMenu).getByRole('button', { name: uiText.nav.sheet })).toBeTruthy()
    expect(within(appNavigationMenu).queryByRole('button', { name: 'セル対応' })).toBeNull()
    expect(within(appNavigationMenu).queryByRole('button', { name: 'セル重ね順' })).toBeNull()
    expect(within(appNavigationMenu).getByRole('button', { name: uiText.actions.xdts })).toBeTruthy()
    expect(within(appNavigationMenu).queryByRole('button', { name: uiText.nav.template })).toBeNull()
  })

it('adds an empty paper track and a material-unassigned card from the CSP layer pane', async () => {
    render(<RemapApp />)

    fireEvent.click(screen.getByLabelText('CSPレイヤー項目を追加'))
    fireEvent.click(screen.getByRole('button', { name: '追加セル列' }))
    const trackName = screen.getByRole('textbox', { name: '追加セル列名' }) as HTMLInputElement
    expect(trackName.value).toBe('J')
    fireEvent.click(screen.getByRole('button', { name: '追加セル列を作成' }))

    await waitFor(() => {
      expect(Array.from(document.querySelectorAll<HTMLElement>('.cspTreeTrackName')).map(label => label.textContent))
        .toContain('J')
    })
    const emptyTrack = Array.from(document.querySelectorAll<HTMLElement>('.cspTreeTrack'))
      .find(track => track.querySelector<HTMLElement>('.cspTreeTrackName')?.textContent === 'J')
    expect(emptyTrack?.querySelector('.cspTreeNoCels')?.textContent).toBe('カードなし')

    const jRow = cspPaneTrackRow('J', '作画')
    fireEvent.click(jRow)
    fireEvent.click(screen.getByLabelText('CSPレイヤー項目を追加'))
    fireEvent.click(screen.getByRole('button', { name: '登録セル' }))
    const cspNameInput = screen.getByLabelText('J（作画）に追加するCSPセル名') as HTMLInputElement
    expect(cspNameInput.value).toBe('J_01')
    fireEvent.click(screen.getByRole('button', { name: 'セルを追加' }))

    await waitFor(() => {
      const card = document.querySelector<HTMLElement>('.cspTreeCel[data-csp-key-id]')
      expect(card?.querySelector<HTMLElement>('.cspTreeCelName')?.textContent).toBe('J_01')
      expect(card?.classList.contains('assigned')).toBe(false)
      expect(card?.querySelector('.cspTreeSheetNameField')).toBeNull()
    })
  })

it('keeps the selected correction layer when placing a BG or BOOK track from the CSP pane', async () => {
    URL.createObjectURL = () => 'blob:csp-stack-guide-asset'
    render(<RemapApp />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    fireEvent.click(screen.getByText('演出', { selector: '.cspTreeSummaryLabel' }))
    fireEvent.click(screen.getByLabelText('CSPレイヤー項目を追加'))
    fireEvent.click(screen.getByRole('button', { name: 'BG／BOOK' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'BG／BOOK名' }), { target: { value: 'BG1' } })
    fireEvent.click(screen.getByRole('button', { name: 'BG／BOOKを作成' }))

    await waitFor(() => {
      const bgTrack = Array.from(document.querySelectorAll<HTMLElement>('.cspTreeTrackName'))
        .find(track => track.textContent === 'BG1')
      expect(bgTrack?.closest('.cspTreeLayer')?.querySelector(':scope > summary')?.textContent).toBe('演出')
    })
    const reserve = standardA3SheetTemplate.regions.find(item => item.regionId === 'left_action_reserve_grid')
    if (!reserve) throw new Error('action reserve region not found')
    expect(stackGuideConnectorAnchorX('BG1')).toBeCloseTo(reserve.rect.x, 6)

    const assetFile = new File(['bg'], 'BG1.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(screen.getByLabelText(uiText.actions.addAssets), { target: { files: [assetFile] } })
    expect(await screen.findByText('BG1.png')).toBeTruthy()
    const bgTrack = screen.getByLabelText('BG1（演出）へ画像素材を割り当て')
    dragInternalPointer(getAssetCardByName('BG1.png'), bgTrack)

    await waitFor(() => {
      const assignedTrack = screen.getByLabelText('BG1（演出）へ画像素材を割り当て').closest('.cspTreeTrack')
      expect(assignedTrack?.querySelector('.cspTreeCel.assigned')).toBeTruthy()
    })
  })

it('creates unplaced CSP cards by dropping multiple selected assets into a correction layer and avoids duplicates', async () => {
    URL.createObjectURL = file => `blob:csp-multi-${(file as File).name}`
    render(<RemapApp />)

    const firstFile = new File(['a1'], 'A1.png', { type: 'image/png', lastModified: 1 })
    const secondFile = new File(['a2'], 'A2.png', { type: 'image/png', lastModified: 2 })
    fireEvent.change(screen.getByLabelText(uiText.actions.addAssets), { target: { files: [firstFile, secondFile] } })
    expect(await screen.findByText('A1.png')).toBeTruthy()
    expect(await screen.findByText('A2.png')).toBeTruthy()

    const firstCard = getAssetCardByName('A1.png')
    const secondCard = getAssetCardByName('A2.png')
    fireEvent.click(firstCard)
    fireEvent.click(secondCard, { ctrlKey: true })

    const gap = screen.getByLabelText('作画のセル列挿入位置1')
    dragInternalPointer(firstCard, gap)
    expect((screen.getByLabelText('作画に追加するセル列名') as HTMLInputElement).value).toBe('A')
    fireEvent.click(screen.getByRole('button', { name: 'セル列を作成して素材を登録' }))

    await waitFor(() => {
      const track = screen.getByLabelText('A（作画）にカードを追加').closest('.cspTreeTrack')
      expect(track?.querySelectorAll('.cspTreeCel')).toHaveLength(2)
      expect(track?.querySelector('.cspTreeCelFrame')).toBeNull()
      expect(Array.from(track?.querySelectorAll<HTMLElement>('.cspTreeCelName') ?? []).map(label => label.textContent)).toEqual(['A2', 'A1'])
    })

    const addToTrack = screen.getByLabelText('A（作画）にカードを追加')
    const track = addToTrack.closest('.cspTreeTrack')
    if (!track) throw new Error('CSP track not found')
    const existingCard = track.querySelector<HTMLElement>('.cspTreeCel')
    if (!existingCard) throw new Error('registered CSP card not found')
    dragInternalPointer(firstCard, existingCard)
    await waitFor(() => {
      expect(track.querySelectorAll('.cspTreeCel')).toHaveLength(2)
      expect(screen.getByRole('status').textContent).toBe('複数素材はセル列の「カードを追加」へドロップしてください。')
    })

    dragInternalPointer(firstCard, addToTrack)
    await waitFor(() => {
      expect(track.querySelectorAll('.cspTreeCel')).toHaveLength(2)
      expect(screen.getByRole('status').textContent).toBe('0件追加 / 2件は登録済み')
    })

  })

it('registers a sheet-first key at the active CSP destination and assigns a material there', async () => {
    URL.createObjectURL = file => `blob:csp-unregistered-${(file as File).name}`
    render(<RemapApp />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    expect(screen.queryByLabelText(uiText.sheet.registrationProcess)).toBeNull()
    selectCspCorrectionLayer('演出')
    expect(screen.getByLabelText('現在の登録先: 演出')).toBeTruthy()
    clickTemplateFrame(sheet, 'action', 'A', 1)
    enterTimingValue('1')

    const registeredCard = screen.getByLabelText('A（演出）にカードを追加').closest('.cspTreeTrack')
      ?.querySelector<HTMLElement>('.cspTreeCel[data-csp-key-id]')
    if (!registeredCard) throw new Error('registered CSP card not found')
    expect(document.querySelector('.cspTreeCel.unregistered')).toBeNull()
    expect(registeredCard.querySelector('.cspTreeCelName')?.textContent).toBe('A1')
    expect(registeredCard.querySelector('.cspTreeCelFrame')).toBeNull()

    const file = new File(['fix'], 'scan_001.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(screen.getByLabelText(uiText.actions.addAssets), { target: { files: [file] } })
    expect(await screen.findByText('scan_001.png')).toBeTruthy()

    dragInternalPointer(getAssetCardByName('scan_001.png'), registeredCard)

    await waitFor(() => {
      expect(document.querySelector('.cspTreeCel.unregistered')).toBeNull()
      const track = screen.getByLabelText('A（演出）にカードを追加').closest('.cspTreeTrack')
      expect(track?.querySelector('.cspTreeCel.assigned')).toBeTruthy()
      expect(track?.querySelector('.cspTreeCelName')?.textContent).toBe('A1')
    })

    fireEvent.click(screen.getByRole('button', { name: uiText.nameNormalization.open }))
    expect(screen.getByRole('dialog', { name: uiText.nameNormalization.title })).toBeTruthy()
    expect((screen.getByLabelText(uiText.nameNormalization.target) as HTMLSelectElement).value).toBe('action')
    expect((screen.getByLabelText(uiText.nameNormalization.process) as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText(uiText.nameNormalization.includeAssetFiles) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(uiText.nameNormalization.description)).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: uiText.nameNormalization.headers.cspName })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: uiText.nameNormalization.headers.assetFileName })).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: uiText.nameNormalization.cancel })[0])
  })

it('keeps CSP track order and names synchronized with the paper sheet', async () => {
    render(<RemapApp />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'action', 'A', 1)
    enterTimingValue('1')
    clickTemplateFrame(sheet, 'action', 'B', 4)
    enterTimingValue('2')
    expect(document.querySelectorAll('.eventRect')).toHaveLength(3)
    expect(document.querySelectorAll('.eventBlankSymbol')).toHaveLength(1)
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toEqual(['1', '2'])

    await waitFor(() => {
      expect(Array.from(document.querySelectorAll<HTMLElement>('.cspTreeTrackName')).map(label => label.textContent))
        .toEqual(['B', 'A'])
    })

    const columnX = (label: string) => {
      const element = Array.from(document.querySelectorAll<SVGTextElement>('.templateColumnText'))
        .find(item => item.textContent === label)
      if (!element) throw new Error(`template column not found: ${label}`)
      return Number(element.getAttribute('x'))
    }
    expect(columnX('A')).toBeLessThan(columnX('B'))

    dragCspPaneRow(cspPaneTrackRow('A', '作画'), cspPaneTrackRow('B', '作画'), 'before')
    await waitFor(() => {
      expect(Array.from(document.querySelectorAll<HTMLElement>('.cspTreeTrackName')).map(label => label.textContent))
        .toEqual(['A', 'B'])
      expect(columnX('B')).toBeLessThan(columnX('A'))
    })

    const trackLabel = Array.from(document.querySelectorAll<HTMLElement>('.cspTreeTrackName')).find(label => label.textContent === 'A')
    if (!trackLabel) throw new Error('A track label not found')
    fireEvent.doubleClick(trackLabel)
    const trackName = screen.getByLabelText('Aのセル列名')
    fireEvent.change(trackName, { target: { value: 'LO' } })
    fireEvent.keyDown(trackName, { key: 'Enter' })
    await waitFor(() => {
      expect(Array.from(document.querySelectorAll<HTMLElement>('.cspTreeTrackName')).some(label => label.textContent === 'LO')).toBe(true)
      expect(Array.from(document.querySelectorAll('.templateColumnText')).map(element => element.textContent)).toContain('LO')
      expect(Array.from(document.querySelectorAll('.templateColumnText')).map(element => element.textContent)).not.toContain('A')
    })
  })

it('starts the editor with optional work panes collapsed and can reopen them', () => {
    render(<EditorApp />)
    const leftDock = document.querySelector<HTMLElement>('.sheetDockLeft')
    const rightDock = document.querySelector<HTMLElement>('.sheetDockRight')
    expect(leftDock?.hidden).toBe(true)
    expect(rightDock?.hidden).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'CSPレイヤー構成' }))
    fireEvent.click(screen.getByRole('button', { name: '画像素材' }))
    expect(leftDock?.hidden).toBe(false)
    expect(rightDock?.hidden).toBe(false)
    expect(screen.getByRole('button', { name: 'CSPレイヤー構成' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: '画像素材' }).getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('.sheetPaneVisibilityControls')).toBeNull()
    expect(document.querySelectorAll('.sheetPaneEdgeToggle')).toHaveLength(0)
    expect(document.querySelectorAll('.panelResizeRail')).toHaveLength(2)
    expect(document.querySelectorAll('.panelResizeRail > .panelResizeToggle')).toHaveLength(2)
  })

it('starts from the remembered template preset for each application', () => {
    rememberSheetTemplatePreset('editor', 'digital-standard')

    render(<EditorApp />)
    const displayMenu = openDisplaySettingsMenu()

    expect(within(displayMenu).getByRole('button', { name: 'デジタル標準' }).getAttribute('aria-pressed')).toBe('true')
    expect(Array.from(document.querySelectorAll('.templateHeaderText')).map(element => element.textContent)).toEqual(['ACTION', 'SOUND', 'CELL', 'CAMERA'])
  })

it('persists side-pane widths and resets a resized pane to its default width', async () => {
    window.localStorage.setItem('xsheet:remap:sheet-pane-layout', JSON.stringify({
      left: false,
      right: true,
      leftWidth: 318,
      rightWidth: 444,
    }))
    const firstRender = render(<RemapApp />)
    const workspace = document.querySelector<HTMLElement>('.sheetWorkspace')
    if (!workspace) throw new Error('sheet workspace not found')

    expect(document.querySelector<HTMLElement>('.sheetDockLeft')?.hidden).toBe(true)
    expect(workspace.style.getPropertyValue('--sheet-left-dock-width')).toBe('0px')
    expect(workspace.style.getPropertyValue('--sheet-right-dock-width')).toBe('444px')

    fireEvent.click(screen.getByRole('button', { name: 'CSPレイヤー構成' }))
    expect(workspace.style.getPropertyValue('--sheet-left-dock-width')).toBe('318px')
    const leftResizeHandle = screen.getByRole('separator', { name: uiText.layout.resizeCspLayerTreePane })
    fireEvent.doubleClick(leftResizeHandle)
    expect(workspace.style.getPropertyValue('--sheet-left-dock-width')).toBe('240px')

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('xsheet:remap:sheet-pane-layout') ?? '{}') as Record<string, unknown>
      expect(stored).toMatchObject({ left: true, right: true, leftWidth: 240, rightWidth: 444 })
    })

    firstRender.unmount()
    render(<RemapApp />)
    const restoredWorkspace = document.querySelector<HTMLElement>('.sheetWorkspace')
    expect(restoredWorkspace?.style.getPropertyValue('--sheet-left-dock-width')).toBe('240px')
    expect(restoredWorkspace?.style.getPropertyValue('--sheet-right-dock-width')).toBe('444px')
  })

it('opens remap XDTS export options from the export menu without adding a workspace tab', () => {
    render(<RemapApp />)
    const dialog = openTimingExportDialog()
    expect(within(dialog).getByRole('button', { name: 'ACTION' }).getAttribute('aria-pressed')).toBe('true')
    expect((within(dialog).getByLabelText('SOUNDを含める') as HTMLInputElement).checked).toBe(false)
    expect((within(dialog).getByLabelText('CAMERAを含める') as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByText('読込開始')).toBeNull()
    expect(screen.queryByText('読込終了')).toBeNull()
  })

it('opens remap After Effects JSX options without XDTS-only toggles', () => {
    render(<RemapApp />)
    const dialog = openTimingExportDialog('ae-jsx')
    expect(within(dialog).getByRole('button', { name: 'ACTION' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(dialog).getByRole('button', { name: 'CELL' })).toBeTruthy()
    expect(within(dialog).queryByLabelText('SOUNDを含める')).toBeNull()
    expect(within(dialog).queryByLabelText('CAMERAを含める')).toBeNull()
    expect(screen.queryByText('読込開始')).toBeNull()
    expect(screen.queryByText('読込終了')).toBeNull()
  })

it('keeps only one top action menu open at a time', () => {
    render(<App />)
    const projectSummary = screen.getByLabelText(uiText.nav.menu)
    const viewModeSummary = screen.getByLabelText(uiText.sheet.displaySettingsMenu)
    const projectMenu = projectSummary.closest('details')
    const viewModeMenu = viewModeSummary.closest('details')
    if (!projectMenu || !viewModeMenu) throw new Error('action menus not found')

    fireEvent.click(projectSummary)
    expect(projectMenu.open).toBe(true)
    expect(viewModeMenu.open).toBe(false)

    fireEvent.click(viewModeSummary)
    expect(viewModeMenu.open).toBe(true)
    expect(projectMenu.open).toBe(false)
  })

it('defaults OCR to the template-defined ACTION target', () => {
    render(<App />)
    const menu = screen.getByLabelText(uiText.recognition.menu)
    expect(menu.textContent).toContain('OCR')
    fireEvent.click(menu)

    const roleGroup = screen.getByRole('group', { name: uiText.recognition.targetField })
    expect(within(roleGroup).getByRole('button', { name: uiText.sheetRoles.action }).getAttribute('aria-pressed')).toBe('true')
    expect(within(roleGroup).getByRole('button', { name: uiText.sheetRoles.cell }).getAttribute('aria-pressed')).toBe('false')
    expect((screen.getByRole('button', { name: uiText.actions.runOcrAllPages }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText('濃さ')).toBeNull()
    expect(screen.queryByText('記入率')).toBeNull()
  })

it('separates template lines and labels in the display menu', () => {
    render(<App />)
    expect(document.querySelectorAll('.gridLine').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.templateHeaderText').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByLabelText(uiText.sheet.displaySettingsMenu))
    const menu = document.querySelector('.actionMenuPortalContent.sheetLayerMenu')
    if (!(menu instanceof HTMLElement)) throw new Error('sheet layer menu not found')
    const lines = within(menu).getByLabelText(uiText.sheet.templateGuides)
    const labels = within(menu).getByLabelText(uiText.sheet.templateLabels)

    fireEvent.click(lines)
    expect(document.querySelectorAll('.gridLine')).toHaveLength(0)
    expect(document.querySelectorAll('.templateHeaderText').length).toBeGreaterThan(0)

    fireEvent.click(labels)
    expect(document.querySelectorAll('.templateHeaderText')).toHaveLength(0)
  })

it('enables ACTION continuation lines by default and keeps the display toggle available', () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText(uiText.sheet.displaySettingsMenu))
    const menu = document.querySelector('.actionMenuPortalContent.sheetLayerMenu')
    if (!(menu instanceof HTMLElement)) throw new Error('sheet layer menu not found')
    const actionContinuation = within(menu).getByLabelText(uiText.sheet.actionContinuation) as HTMLInputElement

    expect(actionContinuation.checked).toBe(true)
    fireEvent.click(actionContinuation)
    expect(actionContinuation.checked).toBe(false)
  })

it('starts the pen tool at black and width 2', () => {
    render(<App />)
    expect((screen.getByLabelText(uiText.sheet.penColor) as HTMLInputElement).value).toBe('#000000')

    fireEvent.click(screen.getByRole('button', { name: uiText.sheet.penTool }))
    const widthControl = document.querySelector('.annotationActiveWidthControl')
    if (!(widthControl instanceof HTMLElement)) throw new Error('active pen width control not found')
    expect((within(widthControl).getByLabelText(uiText.sheet.penWidth) as HTMLInputElement).value).toBe('2')
    expect(widthControl.querySelector('output')?.textContent).toBe('2')
  })

it('edits cut metadata from a template-defined sheet region', () => {
    render(<App />)
    const editButton = screen.getByRole('button', { name: 'カットを編集' })
    expect(editButton.childElementCount).toBe(0)
    expect(editButton.getAttribute('title')).toBeNull()
    expect(editButton.getAttribute('aria-keyshortcuts')).toBe('Enter F2')
    fireEvent.click(editButton)
    expect(screen.queryByRole('dialog', { name: 'カットを編集' })).toBeNull()

    fireEvent.doubleClick(editButton)
    const dialog = screen.getByRole('dialog', { name: 'カットを編集' })
    expect(within(dialog).getAllByText('カット')).toHaveLength(1)
    const input = within(dialog).getByLabelText('カット')
    fireEvent.change(input, { target: { value: 'C042' } })

    expect(screen.getByLabelText(uiText.sheet.cutMetadata).textContent).toContain('C042')
    expect(Array.from(document.querySelectorAll('.metadataFieldText')).map(element => element.textContent)).toContain('C042')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByRole('dialog', { name: 'カットを編集' })).toBeNull()
    expect(document.activeElement).toBe(document.querySelector('.sheetViewport'))
  })

  it('keeps Ctrl+Enter metadata completion and the next timing entry in the sheet keyboard scope', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    fireEvent.doubleClick(screen.getByRole('button', { name: 'MEMOを編集' }))
    const memoEditor = screen.getByRole('textbox', { name: 'MEMO' })
    fireEvent.change(memoEditor, { target: { value: '確定済みメモ' } })
    fireEvent.keyDown(memoEditor, { key: 'Enter', ctrlKey: true })

    const viewport = document.querySelector<HTMLElement>('.sheetViewport')!
    expect(document.activeElement).toBe(viewport)
    clickTemplateFrame(sheet, 'cell', 'A', 1)
    expect(document.activeElement).toBe(viewport)

    fireEvent.keyDown(viewport, { key: '2' })
    expect(document.querySelector('.timingDraftText')?.textContent).toBe('2')
    fireEvent.keyDown(viewport, { key: 'Enter' })

    expect(screen.queryByRole('textbox', { name: 'MEMO' })).toBeNull()
    expect(document.querySelector('.timingDraftText')).toBeNull()
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toContain('2')
  })

  it('light-dismisses template-defined metadata editing', () => {
    render(<App />)
    const editButton = screen.getByRole('button', { name: 'カットを編集' })

    fireEvent.doubleClick(editButton)
    expect(screen.getByRole('dialog', { name: 'カットを編集' })).not.toBeNull()
    const outsideTarget = screen.getByLabelText(uiText.sheet.cutMetadata)
    fireEvent.pointerDown(outsideTarget)
    expect(screen.queryByRole('dialog', { name: 'カットを編集' })).toBeNull()

    fireEvent.doubleClick(editButton)
    fireEvent.focusIn(outsideTarget)
    expect(screen.queryByRole('dialog', { name: 'カットを編集' })).toBeNull()
  })

  it('opens template-defined metadata editing from the keyboard', () => {
    render(<App />)
    const editButton = screen.getByRole('button', { name: 'カットを編集' })

    editButton.focus()
    fireEvent.keyDown(editButton, { key: 'F2' })
    const dialog = screen.getByRole('dialog', { name: 'カットを編集' })
    fireEvent.keyDown(within(dialog).getByLabelText('カット'), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'カットを編集' })).toBeNull()
    expect(document.activeElement).toBe(editButton)

    fireEvent.keyDown(editButton, { key: 'Enter' })
    expect(screen.getByRole('dialog', { name: 'カットを編集' })).not.toBeNull()
  })

  it('shows one duration label and focuses the seconds input in inline editing', () => {
    render(<App />)
    fireEvent.doubleClick(screen.getByRole('button', { name: '尺を編集' }))

    const dialog = screen.getByRole('dialog', { name: '尺を編集' })
    expect(within(dialog).getAllByText('尺')).toHaveLength(1)
    expect(within(dialog).getByRole('group', { name: '尺' })).not.toBeNull()
    expect(document.activeElement).toBe(within(dialog).getByLabelText(uiText.sheet.durationSeconds))
  })

it('keeps the page badge menu focused on page navigation', async () => {
    const project = updateLogicalSheetSettings(createDefaultProject(), { durationFrames: 300 })
    const file = await createXsrTestFile(createProjectDocumentFromCutProject(project), 'multipage.xsr')
    render(<App />)
    const menu = openAppNavigationMenu()
    const input = within(menu).getByText(uiText.actions.loadProject).closest('label')?.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('project input not found')
    fireEvent.change(input, { target: { files: [file] } })

    const pageMenuTrigger = await screen.findByLabelText(uiText.sheet.activePage)
    fireEvent.click(pageMenuTrigger)
    const pageMenu = document.querySelector('.actionMenuPortalContent.pageJumpMenu')
    if (!(pageMenu instanceof HTMLElement)) throw new Error('page menu not found')
    await waitFor(() => expect(pageMenu.querySelectorAll('.pageJumpPageButton')).toHaveLength(3))
    expect(pageMenu.querySelectorAll('select')).toHaveLength(0)
  })

it('bulk-imports paper sheets from the active page without shortening the cut or filling surrounding gaps', async () => {
    URL.createObjectURL = file => `blob:${(file as File).name}`
    let project = updateLogicalSheetSettings(createDefaultProject(), { durationFrames: 576 })
    project = updateSheetViewState(project, { activePageId: 'page_2' })
    const file = await createXsrTestFile(createProjectDocumentFromCutProject(project), 'four-pages.xsr')
    render(<App />)

    const appMenu = openAppNavigationMenu()
    const projectInput = within(appMenu).getByText(uiText.actions.loadProject).closest('label')?.querySelector<HTMLInputElement>('input[type="file"]')
    if (!projectInput) throw new Error('project input not found')
    fireEvent.change(projectInput, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByLabelText(uiText.sheet.activePage).textContent).toContain('2P'))
    const paperMenu = openPaperSheetMenu()
    const sourceInput = within(paperMenu).getByLabelText(uiText.actions.loadSheetSourceFiles)
    const later = new File(['later'], 'scan_10.png', { type: 'image/png', lastModified: 10 })
    const earlier = new File(['earlier'], 'scan_2.png', { type: 'image/png', lastModified: 2 })
    fireEvent.change(sourceInput, { target: { files: [later, earlier] } })

    const assignmentGroup = await within(paperMenu).findByRole('region', { name: uiText.sources.assignmentSection })
    await waitFor(() => expect(within(assignmentGroup).getAllByRole('combobox')).toHaveLength(4))
    const selects = within(assignmentGroup).getAllByRole('combobox') as HTMLSelectElement[]
    expect(selects[0]?.value).toBe('')
    expect(selects[1]?.selectedOptions[0]?.textContent).toContain('scan_2.png')
    expect(selects[2]?.selectedOptions[0]?.textContent).toContain('scan_10.png')
    expect(selects[3]?.value).toBe('')

    fireEvent.click(within(paperMenu).getByRole('button', { name: uiText.sheet.pageJumpTitle(4) }))
    expect(within(paperMenu).getByRole('button', { name: uiText.sheet.pageJumpTitle(4) }).getAttribute('aria-current')).toBe('page')
  })

it('assigns a paper sheet to the active pre-roll display page and extends only the official duration', async () => {
    URL.createObjectURL = file => `blob:${(file as File).name}`
    let project = updateLogicalSheetSettings(createDefaultProject(), {
      durationFrames: 144,
      workRange: { preRollFrames: 24, postRollFrames: 0, showPreRoll: true, showPostRoll: true },
    })
    project = updateSheetViewState(project, { activePageId: 'page_2' })
    const file = await createXsrTestFile(createProjectDocumentFromCutProject(project), 'pre-roll-pages.xsr')
    render(<App />)

    const appMenu = openAppNavigationMenu()
    const projectInput = within(appMenu).getByText(uiText.actions.loadProject).closest('label')?.querySelector<HTMLInputElement>('input[type="file"]')
    if (!projectInput) throw new Error('project input not found')
    fireEvent.change(projectInput, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByLabelText(uiText.sheet.activePage).textContent).toContain('2P'))
    const paperMenu = openPaperSheetMenu()
    const sourceInput = within(paperMenu).getByLabelText(uiText.actions.loadSheetSourceFiles)
    fireEvent.change(sourceInput, { target: { files: [new File(['second page'], 'page_2.png', { type: 'image/png' })] } })

    const assignmentGroup = await within(paperMenu).findByRole('region', { name: uiText.sources.assignmentSection })
    await waitFor(() => expect(within(assignmentGroup).getAllByRole('combobox')).toHaveLength(2))
    const selects = within(assignmentGroup).getAllByRole('combobox') as HTMLSelectElement[]
    expect(selects[0]?.value).toBe('')
    expect(selects[1]?.selectedOptions[0]?.textContent).toContain('page_2.png')
    expect(screen.getByText('264F / 11s')).toBeTruthy()
  })

it('loads the compressed project container through the normal project command', async () => {
    const project = updateLogicalSheetSettings(createDefaultProject(), { durationFrames: 300 })
    const file = await createXsrTestFile(createProjectDocumentFromCutProject(project), 'multipage.xsr')
    render(<App />)
    const menu = openAppNavigationMenu()
    const input = within(menu).getByText(uiText.actions.loadProject).closest('label')?.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('project input not found')
    fireEvent.change(input, { target: { files: [file] } })

    const pageMenuTrigger = await screen.findByLabelText(uiText.sheet.activePage)
    fireEvent.click(pageMenuTrigger)
    const pageMenu = document.querySelector('.actionMenuPortalContent.pageJumpMenu')
    if (!(pageMenu instanceof HTMLElement)) throw new Error('page menu not found')
    await waitFor(() => expect(pageMenu.querySelectorAll('.pageJumpPageButton')).toHaveLength(3))
  })

it('closes the app navigation menu when a file picker item is selected', async () => {
    render(<App />)
    const trigger = screen.getByLabelText(uiText.nav.menu)
    const menu = openAppNavigationMenu()
    const details = trigger.closest('details')
    if (!details) throw new Error('app navigation details not found')

    const loadProjectLabel = within(menu).getByText(uiText.actions.loadProject).closest('label')
    if (!loadProjectLabel) throw new Error('load project file label not found')
    const loadProjectInput = loadProjectLabel.querySelector<HTMLInputElement>('input[type="file"]')
    if (!loadProjectInput) throw new Error('load project file input not found')

    fireEvent.click(loadProjectLabel)
    await new Promise(resolve => window.setTimeout(resolve, 0))
    expect(details.open).toBe(true)

    const file = await createXsrTestFile(createProjectDocumentFromCutProject(createDefaultProject()))
    fireEvent.change(loadProjectInput, { target: { files: [file] } })
    await waitFor(() => expect(details.open).toBe(false))
    expect(document.querySelector('.actionMenuPortalContent.appNavMenu')).toBeNull()
  })

it('restores a paper sheet image from a saved project file path', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    const sourcePath = 'D:\\cuts\\C001\\sheet_001.png'
    const registered = registerSheetSource(createDefaultProject(), {
      name: 'sheet_001.png',
      path: sourcePath,
      size: 1024,
      lastModified: 1,
    })
    const projectWithSheet = assignSheetSourceToPage(registered.project, 'page_1', registered.source.sourceId)
    const file = await createXsrTestFile(createProjectDocumentFromCutProject(projectWithSheet))

    render(<App />)
    const menu = openAppNavigationMenu()
    const loadProjectInput = within(menu)
      .getByText(uiText.actions.loadProject)
      .closest('label')
      ?.querySelector<HTMLInputElement>('input[type="file"]')
    if (!loadProjectInput) throw new Error('load project file input not found')

    fireEvent.change(loadProjectInput, { target: { files: [file] } })

    await waitFor(() => expect(sheetImageHrefs()).toContain('asset://D:/cuts/C001/sheet_001.png'))
  })

it('shows one corrected paper export group for every assigned page in the active cut', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    const firstSourcePath = 'D:\\cuts\\C001\\sheet_001.png'
    const secondSourcePath = 'D:\\cuts\\C001\\sheet_002.png'
    const first = registerSheetSource(createDefaultProject(), {
      name: 'sheet_001.png',
      path: firstSourcePath,
      size: 1024,
      lastModified: 1,
    })
    const second = registerSheetSource(first.project, {
      name: 'sheet_002.png',
      path: secondSourcePath,
      size: 1024,
      lastModified: 2,
    })
    const twoPageProject = updateLogicalSheetSettings(second.project, { durationFrames: 288 })
    const firstAssigned = assignSheetSourceToPage(twoPageProject, 'page_1', first.source.sourceId)
    const assignedProject = assignSheetSourceToPage(firstAssigned, 'page_2', second.source.sourceId)
    const projectWithSheet = { ...assignedProject, cut: { ...assignedProject.cut, cut: 'BATCH' } }
    const file = await createXsrTestFile(createProjectDocumentFromCutProject(projectWithSheet))

    render(<App />)
    const menu = openAppNavigationMenu()
    const loadProjectInput = within(menu)
      .getByText(uiText.actions.loadProject)
      .closest('label')
      ?.querySelector<HTMLInputElement>('input[type="file"]')
    if (!loadProjectInput) throw new Error('load project file input not found')

    fireEvent.change(loadProjectInput, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByLabelText(uiText.sheet.cutMetadata).textContent).toContain('BATCH'))
    expect(within(openPaperSheetMenu()).queryByText(uiText.actions.correctedSheetImageExport)).toBeNull()
    const exportMenu = openAppNavigationMenu()
    fireEvent.click(within(exportMenu).getByRole('button', { name: uiText.actions.exportMenu }))
    const correctedExport = within(exportMenu).getByRole('group', { name: uiText.actions.correctedSheetImageExportLabel(2) })
    for (const format of ['JPG', 'PNG', 'PSD']) {
      const accessibleLabel = uiText.actions.correctedSheetImageExportFormatTitle(format, 2)
      expect((within(correctedExport).getByRole('button', { name: accessibleLabel }) as HTMLButtonElement).disabled).toBe(false)
    }
  })

it('keeps corrected paper image export out of Remap even when a paper source is loaded', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    const sourcePath = 'D:\\cuts\\C001\\sheet_001.png'
    const registered = registerSheetSource(createDefaultProject(), {
      name: 'sheet_001.png',
      path: sourcePath,
      size: 1024,
      lastModified: 1,
    })
    const projectWithSheet = assignSheetSourceToPage(registered.project, 'page_1', registered.source.sourceId)
    const file = await createXsrTestFile(createProjectDocumentFromCutProject(projectWithSheet))

    render(<RemapApp />)
    const menu = openAppNavigationMenu()
    const loadProjectInput = within(menu)
      .getByText(uiText.actions.loadProject)
      .closest('label')
      ?.querySelector<HTMLInputElement>('input[type="file"]')
    if (!loadProjectInput) throw new Error('load project file input not found')

    fireEvent.change(loadProjectInput, { target: { files: [file] } })

    await waitFor(() => expect(sheetImageHrefs()).toContain('asset://D:/cuts/C001/sheet_001.png'))
    expect(within(openPaperSheetMenu()).queryByLabelText(uiText.actions.correctedSheetImageExport)).toBeNull()
    const exportMenu = openAppNavigationMenu()
    fireEvent.click(within(exportMenu).getByRole('button', { name: uiText.actions.exportMenu }))
    expect(within(exportMenu).queryByText(uiText.actions.correctedSheetImageExportLabel(1))).toBeNull()
  })

it('warns on project load when registered material files are missing on disk', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    const rootPath = 'D:\\cuts\\C001'
    const materialPath = 'D:\\cuts\\C001\\A_01.png'
    markMissingTauriPath(materialPath)
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const rooted = registerAssetRoot(created.project, {
      label: 'C001',
      path: rootPath,
      handleKind: 'directory',
    })
    const asset = registerAsset(rooted.project, {
      name: 'A_01.png',
      path: materialPath,
      relativePath: 'A_01.png',
      size: 100,
      lastModified: 1,
    }, {
      role: 'cell-material',
      relativePath: 'A_01.png',
    })
    const bound = upsertBinding(asset.project, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      cspCellName: 'A_01',
      materialState: 'assigned',
      assetId: asset.asset.assetId,
    })
    const file = await createXsrTestFile(createProjectDocumentFromCutProject(bound))

    render(<App />)
    const menu = openAppNavigationMenu()
    const loadProjectInput = within(menu)
      .getByText(uiText.actions.loadProject)
      .closest('label')
      ?.querySelector<HTMLInputElement>('input[type="file"]')
    if (!loadProjectInput) throw new Error('load project file input not found')

    fireEvent.change(loadProjectInput, { target: { files: [file] } })

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('登録素材: 1件')))
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining(materialPath))
  })

it('edits sheet template metadata and embeds a template reference image', async () => {
    render(<App />)
    selectAppPanel(uiText.nav.template)
    selectTemplateInspector('template')

    const nameInput = screen.getByDisplayValue('A3標準') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'スタジオA3' } })
    expect(nameInput.value).toBe('スタジオA3')

    selectTemplateInspector('reference')
    const referenceLabel = screen.getByText(uiText.actions.loadTemplateReferenceImage).closest('label')
    const referenceInput = referenceLabel?.querySelector('input[type="file"]') as HTMLInputElement | null
    if (!referenceInput) throw new Error('template reference image input not found')

    const referenceImage = new File(['reference'], 'studio_sheet.png', { type: 'image/png', lastModified: 1 })
    fireEvent.change(referenceInput, { target: { files: [referenceImage] } })

    await waitFor(() => expect(screen.getAllByText('studio_sheet.png')).toHaveLength(2))
    expect(screen.getByText(uiText.template.referenceImageEmbedded)).toBeTruthy()

    selectTemplateInspector('json')
    const json = document.querySelector('.jsonPreview') as HTMLTextAreaElement | null
    expect(json?.value).toContain('スタジオA3')
    expect(json?.value).toContain('studio_sheet.png')
    expect(json?.value).toContain('data:image/png')
  })

it('edits template grid header labels from the display tab', () => {
    render(<App />)
    selectAppPanel(uiText.nav.template)
    selectTemplateInspector('display')

    const secondCounter = screen.getByLabelText(uiText.template.secondCounter) as HTMLInputElement
    expect(secondCounter.checked).toBe(true)
    expect(Array.from(document.querySelectorAll('.gridSecondCounter')).map(element => element.textContent)).toEqual(['1', '2', '3', '4', '5', '6'])
    fireEvent.click(secondCounter)
    expect(document.querySelectorAll('.gridSecondCounter')).toHaveLength(0)
    fireEvent.click(secondCounter)

    const bottomTrackLabels = screen.getByLabelText(uiText.template.bottomTrackLabels) as HTMLInputElement
    expect(bottomTrackLabels.checked).toBe(true)
    expect(document.querySelectorAll('.gridBottomTrackLabel')).toHaveLength(36)
    fireEvent.click(bottomTrackLabels)
    expect(document.querySelectorAll('.gridBottomTrackLabel')).toHaveLength(0)
    fireEvent.click(bottomTrackLabels)

    const soundInput = screen.getByLabelText(uiText.template.gridHeaderLabelInput('SOUND')) as HTMLInputElement
    expect(soundInput.value).toBe('')

    fireEvent.change(soundInput, { target: { value: '台詞' } })
    expect(soundInput.value).toBe('台詞')
    expect(Array.from(document.querySelectorAll('.templateHeaderText')).map(element => element.textContent)).toContain('台詞')

    fireEvent.change(soundInput, { target: { value: '' } })
    expect(Array.from(document.querySelectorAll('.templateHeaderText')).map(element => element.textContent)).not.toContain('SOUND')
  })

it('uses the template header label for the OCR target name', () => {
    render(<App />)
    selectAppPanel(uiText.nav.template)
    selectTemplateInspector('display')
    fireEvent.change(screen.getByLabelText(uiText.template.gridHeaderLabelInput('ACTION')), { target: { value: '演技指示' } })
    fireEvent.click(screen.getByRole('button', { name: 'プロジェクトへ反映' }))

    selectAppPanel(uiText.nav.sheet)
    fireEvent.click(screen.getByLabelText(uiText.recognition.menu))
    const roleGroup = screen.getByRole('group', { name: uiText.recognition.targetField })
    expect(within(roleGroup).getByRole('button', { name: '演技指示' }).getAttribute('aria-pressed')).toBe('true')
  })

it('edits the cut duration as seconds and frames with stepper buttons', () => {
    render(<App />)
    const menu = openCutMetadataMenu()
    const secondsInput = screen.getByLabelText(uiText.sheet.durationSeconds) as HTMLInputElement
    const framesInput = screen.getByLabelText(uiText.sheet.durationFrames) as HTMLInputElement
    expect(within(menu).getByText(uiText.sheet.duration)).toBeTruthy()
    expect(within(menu).getByRole('group', { name: uiText.sheet.duration })).toBeTruthy()
    expect(screen.queryByText('シート設定')).toBeNull()
    expect(screen.queryByText('ページ画像')).toBeNull()
    expect(screen.queryByLabelText(uiText.sheet.fps)).toBeNull()
    expect(screen.queryByText('24fps')).toBeNull()
    expect(secondsInput.value).toBe('06')
    expect(framesInput.value).toBe('00')

    fireEvent.change(secondsInput, { target: { value: '7' } })
    fireEvent.change(framesInput, { target: { value: '12' } })
    expect(screen.getByText('180F / 7.5s')).toBeTruthy()
    expect((screen.getByLabelText(uiText.sheet.durationSeconds) as HTMLInputElement).value).toBe('07')
    expect((screen.getByLabelText(uiText.sheet.durationFrames) as HTMLInputElement).value).toBe('12')

    fireEvent.click(screen.getByRole('button', { name: uiText.sheet.durationFramesUp }))
    expect((screen.getByLabelText(uiText.sheet.durationSeconds) as HTMLInputElement).value).toBe('07')
    expect((screen.getByLabelText(uiText.sheet.durationFrames) as HTMLInputElement).value).toBe('13')

    fireEvent.click(screen.getByRole('button', { name: uiText.sheet.durationSecondsDown }))
    expect((screen.getByLabelText(uiText.sheet.durationSeconds) as HTMLInputElement).value).toBe('06')
    expect((screen.getByLabelText(uiText.sheet.durationFrames) as HTMLInputElement).value).toBe('13')
  })

it('restores a linked SOUND range when the duration expands over deferred audio', async () => {
    let project = createDefaultProject()
    const laneId = timelineLanesForLayout(project).sound![0].laneId
    const created = createTimedRangeCue(project, {
      role: 'sound',
      laneId,
      frameStart: 144,
      frameEnd: 144,
      label: '主人公',
      text: '尺外のセリフ',
    })
    project = created.project
    const audioState = createDefaultDialogueAudioCutState(1)
    audioState.assets = [{
      assetId: 'asset-1',
      audioDataUrl: 'data:audio/wav;base64,UklGRg==',
      durationFrames: 24,
      waveform: [],
    }]
    audioState.tracks[0].clips = [{
      clipId: 'clip-1',
      placementId: 'placement-1',
      assetId: 'asset-1',
      timelineStartFrame: 141,
      sourceOffsetFrames: 0,
      durationFrames: 24,
    }]
    audioState.tracks[0].dialogueRegions = [{
      regionId: 'dialogue-region-1',
      frameStart: 151,
      frameEnd: 159,
      candidateIds: [],
      anchors: [{
        anchorId: 'anchor-1',
        placementId: 'placement-1',
        assetId: 'asset-1',
        sourceFrameStart: 10,
        sourceFrameEnd: 18,
        candidateIds: [],
      }],
      headPaddingFrames: 0,
      tailPaddingFrames: 0,
      status: 'ready',
    }]
    audioState.soundBindings = [{
      bindingId: 'binding-1',
      cueId: created.cue.cueId,
      revisionId: 'sheet_revision_1',
      members: [{
        memberId: 'member-1',
        regionRef: { trackId: 'dialogue-1', regionId: 'dialogue-region-1' },
      }],
      headPaddingFrames: 0,
      tailPaddingFrames: 0,
      status: 'linked',
    }]
    project = updateDialogueAudioCutStateInProject(project, audioState, 1, project.logicalSheet.durationFrames)
    const file = await createXsrTestFile(createProjectDocumentFromCutProject(project), 'deferred-sound-range.xsr')

    render(<App />)
    const menu = openAppNavigationMenu()
    const input = within(menu)
      .getByText(uiText.actions.loadProject)
      .closest('label')
      ?.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('load project file input not found')
    fireEvent.change(input, { target: { files: [file] } })

    const cueSelector = `.soundCue[data-sound-cue-id="${created.cue.cueId}"]`
    await waitFor(() => expect(document.querySelector(cueSelector)?.getAttribute('data-frame-start')).toBe('144'))

    openCutMetadataMenu()
    fireEvent.change(screen.getByLabelText(uiText.sheet.durationSeconds), { target: { value: '8' } })

    await waitFor(() => {
      expect(document.querySelector(cueSelector)?.getAttribute('data-frame-start')).toBe('151')
      expect(document.querySelector(cueSelector)?.getAttribute('data-frame-end')).toBe('159')
    })
  })

it('dims visible paper rows outside the cut duration without creating post-roll state', () => {
    render(<App />)
    openCutMetadataMenu()

    expect(document.querySelectorAll('.inactiveFrameRect')).toHaveLength(0)

    fireEvent.change(screen.getByLabelText(uiText.sheet.durationSeconds), { target: { value: '3' } })

    expect(screen.queryByText(uiText.sheet.postRollFrames(72))).toBeNull()
    expect(document.querySelectorAll('.inactiveFrameRect')).toHaveLength(4)

    const displayMenu = openDisplaySettingsMenu()
    const preRoll = within(displayMenu).getByLabelText(uiText.sheet.preRoll) as HTMLInputElement
    fireEvent.click(preRoll)
    expect(preRoll.checked).toBe(true)
    expect(document.querySelectorAll('.inactiveFrameRect')).toHaveLength(8)

    fireEvent.click(preRoll)
    expect(preRoll.checked).toBe(false)
    expect(document.querySelectorAll('.inactiveFrameRect')).toHaveLength(4)
  })

it('renders the default paper template chrome and grid lines', () => {
    render(<App />)
    const paperTextTransform = `scale(${1 / standardA3SheetTemplate.page.widthPx} ${1 / standardA3SheetTemplate.page.heightPx})`
    expect(screen.getByLabelText(uiText.sheet.canvasLabel).getAttribute('preserveAspectRatio')).toBe('none')
    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(0)
    expect(document.querySelectorAll('.templateFormBox').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.gridOverlay-other')).toHaveLength(2)
    const headerLabels = Array.from(document.querySelectorAll('.templateHeaderText')).map(element => element.textContent)
    expect(headerLabels).toHaveLength(6)
    expect(headerLabels).not.toContain('SOUND')
    expect(document.querySelector('.templateHeaderBox')?.getAttribute('height')).toBe(String(48 / 2481))
    expect((document.querySelector('.templateHeaderBox') as SVGRectElement | null)?.style.fill).toBe('none')
    expect(document.querySelectorAll('.templateReferenceText')).toHaveLength(0)
    expect(document.querySelectorAll('.gridLine, .gridLineMajor').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.gridOverlay-action, .gridOverlay-cell, .gridOverlay-camera').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.gridOverlay-sound .gridLineCustom')).toHaveLength(4)
    expect(Array.from(document.querySelectorAll('.gridSecondCounter')).map(element => element.textContent)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(Array.from(document.querySelectorAll('.metadataFieldText')).map(element => element.textContent)).toEqual(['001', '06+00', '1/1'])
    expect(document.querySelector('.templateHeaderText')?.getAttribute('transform')).toBe(paperTextTransform)
    expect(document.querySelector('.templateColumnText')?.getAttribute('transform')).toBe(paperTextTransform)
    expect(document.querySelector('.gridActionFrameNumber')?.getAttribute('transform')).toBe(paperTextTransform)
    expect(document.querySelector('.metadataFieldText')?.getAttribute('transform')).toBe(paperTextTransform)
    expect(Array.from(document.querySelectorAll('.sheetSvg text')).every(element => element.getAttribute('transform') === paperTextTransform)).toBe(true)
  })

it('toggles shared cut numbers beside the cut switch even before another cut exists', () => {
    render(<App />)

    const menu = openSharedCutMenu()
    const initialToggle = within(menu).getByLabelText(uiText.sheet.sharedCutNumbers) as HTMLInputElement
    expect(initialToggle.disabled).toBe(false)
    expect(initialToggle.checked).toBe(true)
    fireEvent.click(initialToggle)
    expect(initialToggle.checked).toBe(false)
    expect(Array.from(document.querySelectorAll('.metadataFieldText')).map(element => element.textContent)).not.toContain('[]')

    fireEvent.click(within(menu).getByRole('button', { name: uiText.sheet.addSharedCutTitle }))
    const cutNameInput = within(menu).getByLabelText(uiText.sheet.addSharedCutName) as HTMLInputElement
    expect(cutNameInput.value).toBe('002')
    fireEvent.change(cutNameInput, { target: { value: 'BOOK別案' } })
    fireEvent.click(within(menu).getByRole('button', { name: uiText.sheet.addSharedCutConfirm }))
    const toggle = within(menu).getByLabelText(uiText.sheet.sharedCutNumbers) as HTMLInputElement
    expect(toggle.disabled).toBe(false)
    expect(toggle.checked).toBe(true)
    expect(Array.from(document.querySelectorAll('.metadataFieldText')).map(element => element.textContent)).toContain('[001]')
  })

it('deletes the selected shared cut after confirmation but keeps the last cut', async () => {
    render(<App />)
    const menu = openSharedCutMenu()
    const deleteButton = within(menu).getByRole('button', { name: uiText.sheet.deleteSharedCutTitle }) as HTMLButtonElement
    const addButton = within(menu).getByRole('button', { name: uiText.sheet.addSharedCutTitle }) as HTMLButtonElement
    expect(deleteButton.classList.contains('deleteIconButton')).toBe(true)
    expect(addButton.classList.contains('cutSwitchIconButton')).toBe(true)
    expect(deleteButton.textContent?.trim()).toBe('')
    expect(addButton.textContent?.trim()).toBe('')
    expect(deleteButton.disabled).toBe(true)

    fireEvent.click(addButton)
    const cutNameInput = within(menu).getByLabelText(uiText.sheet.addSharedCutName)
    fireEvent.change(cutNameInput, { target: { value: 'BOOK別案' } })
    fireEvent.click(within(menu).getByRole('button', { name: uiText.sheet.addSharedCutConfirm }))
    const cutSelect = within(menu).getByLabelText('兼用カット') as HTMLSelectElement
    expect(cutSelect.options).toHaveLength(2)
    expect(cutSelect.selectedOptions[0]?.textContent?.trim()).toBe('BOOK別案')
    expect(deleteButton.disabled).toBe(false)

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(deleteButton)
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1))
    expect(cutSelect.options).toHaveLength(2)

    fireEvent.click(deleteButton)
    await waitFor(() => expect(cutSelect.options).toHaveLength(1))
    expect(cutSelect.selectedOptions[0]?.textContent?.trim()).toBe('001')
    expect(deleteButton.disabled).toBe(true)
    expect(confirmSpy.mock.calls[1]?.[0]).toContain('兼用カット「BOOK別案」')
    confirmSpy.mockRestore()
  })

it('requires a unique arbitrary name before adding a shared cut', () => {
    render(<App />)
    const menu = openSharedCutMenu()
    fireEvent.click(within(menu).getByRole('button', { name: uiText.sheet.addSharedCutTitle }))

    const input = within(menu).getByLabelText(uiText.sheet.addSharedCutName) as HTMLInputElement
    expect(input.maxLength).toBe(-1)
    expect(input.value).toBe('002')

    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(within(menu).getByRole('button', { name: uiText.sheet.addSharedCutConfirm }))
    expect(within(menu).getByRole('alert').textContent).toBe(uiText.sheet.sharedCutNameRequired)

    fireEvent.change(input, { target: { value: '001' } })
    fireEvent.click(within(menu).getByRole('button', { name: uiText.sheet.addSharedCutConfirm }))
    expect(within(menu).getByRole('alert').textContent).toBe(uiText.sheet.sharedCutNameDuplicate('001'))

    fireEvent.change(input, { target: { value: '  BOOK_BACKGROUND_ALT  ' } })
    fireEvent.click(within(menu).getByRole('button', { name: uiText.sheet.addSharedCutConfirm }))
    const cutSelect = within(menu).getByLabelText('兼用カット') as HTMLSelectElement
    expect(cutSelect.options).toHaveLength(2)
    expect(cutSelect.selectedOptions[0]?.textContent?.trim()).toBe('BOOK_BACKGROUND_ALT')
    expect(within(menu).queryByLabelText(uiText.sheet.addSharedCutName)).toBeNull()
  })

it('keeps template creation as a draft until apply or cancel', async () => {
    render(<App />)
    selectAppPanel(uiText.nav.template)

    expect(screen.getByText(uiText.template.builtInProtected)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'プロジェクトへ反映' }) as HTMLButtonElement).disabled).toBe(true)

    await createDigitalTemplateDraft()

    expect(screen.getByText(uiText.template.draftChanged)).toBeTruthy()
    await waitFor(() => {
      expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(0)
      expect(document.querySelectorAll('.templateFormBox')).toHaveLength(14)
      expect(document.querySelectorAll('.gridOverlay-other')).toHaveLength(0)
      expect(document.querySelector('.gridOverlay-sound')).toBeTruthy()
    })
    const headerLabels = Array.from(document.querySelectorAll('.templateHeaderText')).map(element => element.textContent)
    expect(headerLabels).toEqual(['ACTION', 'SOUND', 'CELL', 'CAMERA'])

    selectTemplateInspector('json')
    const json = document.querySelector('.jsonPreview') as HTMLTextAreaElement | null
    expect(json?.value).toContain('"templateKind": "digital-native"')
    expect(json?.value).toContain('"name": "新しいデジタルタイムシート"')
    expect(json?.value).toMatch(/"templateId": "digital-template-[a-z0-9]+"/)

    fireEvent.click(screen.getByRole('button', { name: '変更を取り消す' }))
    expect(screen.getByText(uiText.template.builtInProtected)).toBeTruthy()
    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(0)
    expect(document.querySelectorAll('.templateFormBox').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.gridOverlay-sound .gridLineCustom')).toHaveLength(4)

    await createDigitalTemplateDraft()
    fireEvent.click(screen.getByRole('button', { name: 'プロジェクトへ反映' }))
    expect(screen.getByText(uiText.template.draftApplied)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'プロジェクトへ反映' }) as HTMLButtonElement).disabled).toBe(true)
    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(0)
    expect(document.querySelector('.gridOverlay-sound')).toBeTruthy()
  })

it('preserves an unapplied template draft while visiting another workspace panel', () => {
    render(<App />)
    selectAppPanel(uiText.nav.template)
    selectTemplateInspector('template')

    fireEvent.change(screen.getByLabelText(uiText.template.name), { target: { value: 'パネル移動中の下書き' } })
    expect(screen.getByText(uiText.template.draftChanged)).toBeTruthy()

    selectAppPanel(uiText.nav.sheet)
    expect(screen.queryByLabelText(uiText.template.name)).toBeNull()
    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)
    selectAppPanel(uiText.nav.template)
    selectTemplateInspector('template')

    expect((screen.getByLabelText(uiText.template.name) as HTMLInputElement).value).toBe('パネル移動中の下書き')
    expect(screen.getByText(uiText.template.draftChanged)).toBeTruthy()
  })

it('undoes and redoes an applied template with the synchronized project history', async () => {
    render(<App />)
    selectAppPanel(uiText.nav.template)

    await createDigitalTemplateDraft()
    fireEvent.click(screen.getByRole('button', { name: 'プロジェクトへ反映' }))
    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(0)

    const undo = screen.getByRole('button', { name: uiText.actions.undo }) as HTMLButtonElement
    const redo = screen.getByRole('button', { name: uiText.actions.redo }) as HTMLButtonElement
    expect(undo.disabled).toBe(false)
    fireEvent.click(undo)
    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(0)
    expect(document.querySelectorAll('.templateFormBox').length).toBeGreaterThan(0)

    expect(redo.disabled).toBe(false)
    fireEvent.click(redo)
    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(0)
    expect(document.querySelectorAll('.templateFormBox')).toHaveLength(14)
  })

it('edits selected template rectangles in source-image pixels', () => {
    render(<App />)
    selectAppPanel(uiText.nav.template)
    selectTemplateInspector('region')

    const xInput = screen.getByLabelText(`${uiText.template.selectedRegion} x px`) as HTMLInputElement
    const yInput = screen.getByLabelText(`${uiText.template.selectedRegion} y px`) as HTMLInputElement
    const widthInput = screen.getByLabelText(`${uiText.template.selectedRegion} w px`) as HTMLInputElement
    const heightInput = screen.getByLabelText(`${uiText.template.selectedRegion} h px`) as HTMLInputElement

    expect([xInput.value, yInput.value, widthInput.value, heightInput.value]).toEqual(['35', '47', '1598', '71'])
    fireEvent.change(xInput, { target: { value: '36' } })

    expect(Number(document.querySelector('.templateSelectedRegion')?.getAttribute('x')) * standardA3SheetTemplate.page.widthPx).toBeCloseTo(36)
    expect(screen.getByText(/X 36 \/ Y 47 \/ W 1598 \/ H 71/)).toBeTruthy()
  })

it('previews template edge drags locally and commits once on pointer up', async () => {
    render(<App />)
    selectAppPanel(uiText.nav.template)
    selectTemplateInspector('region')

    const editor = document.querySelector<SVGSVGElement>('.templateEditorSvg')
    if (!editor) throw new Error('template editor not found')
    const getEditorRect = vi.fn(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      toJSON: () => ({}),
    }))
    editor.getBoundingClientRect = getEditorRect
    const verticalEdges = document.querySelectorAll<HTMLDivElement>('.templateDomEdgeGuide.vertical')
    expect(verticalEdges).toHaveLength(2)
    const rightEdge = verticalEdges[1]
    Object.defineProperty(rightEdge, 'setPointerCapture', { configurable: true, value: vi.fn() })
    Object.defineProperty(rightEdge, 'releasePointerCapture', { configurable: true, value: vi.fn() })

    fireEvent.pointerDown(rightEdge, { pointerId: 41, pointerType: 'mouse', button: 0, clientX: 931, clientY: 100 })
    fireEvent.pointerMove(window, { pointerId: 41, pointerType: 'mouse', buttons: 1, clientX: 800, clientY: 100 })
    expect(getEditorRect).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      const previewWidth = Number(document.querySelector('.templateSelectedRegion')?.getAttribute('width')) * standardA3SheetTemplate.page.widthPx
      expect(previewWidth).toBeCloseTo(1368)
    })
    expect(screen.getByText(uiText.template.builtInProtected)).toBeTruthy()
    expect((screen.getByLabelText(`${uiText.template.selectedRegion} w px`) as HTMLInputElement).value).toBe('1598')

    fireEvent.pointerUp(window, { pointerId: 41, pointerType: 'mouse', button: 0, clientX: 800, clientY: 100 })

    await waitFor(() => expect(screen.getByText(uiText.template.draftChanged)).toBeTruthy())
    expect((screen.getByLabelText(`${uiText.template.selectedRegion} w px`) as HTMLInputElement).value).toBe('1368')
    expect(rightEdge.releasePointerCapture).toHaveBeenCalledWith(41)
  })

it('turns built-in standard template edits into a custom draft', () => {
    render(<App />)
    selectAppPanel(uiText.nav.template)
    selectTemplateInspector('template')

    fireEvent.change(screen.getByLabelText(uiText.template.name), { target: { value: 'A3標準 改' } })
    expect(screen.getByText(uiText.template.draftChanged)).toBeTruthy()

    selectTemplateInspector('json')
    const json = document.querySelector('.jsonPreview') as HTMLTextAreaElement | null
    expect(json?.value).toContain('"name": "A3標準 改"')
    expect(json?.value).not.toContain('"templateId": "standard-a3-timesheet-v2"')
    expect(json?.value).toMatch(/"templateId": "standard-a3-timesheet-v2-custom-[a-z0-9]+"/)
  })

it('shows context operation hints in the bottom status bar', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    expectStatusHint('ホイール', 'Ctrl+ホイール')

    const point = templateFramePoint('cell', 'A', 1)
    fireEvent.pointerMove(sheet, { clientX: point.x, clientY: point.y })
    expectStatusHint('A', formatTestFramePosition(1), '入力・ドロップ')

    fireEvent.pointerLeave(sheet)
    expectStatusHint('ホイール', 'Ctrl+ホイール')
  })

it('omits the fixed paper outer frame for the digital standard template', () => {
    render(<App />)
    const defaultProject = createDefaultProject()
    const digitalPageSize = resolveSheetTemplatePageSize(digitalStandardSheetTemplate, defaultProject.logicalSheet.durationFrames, {
      paperTracks: defaultProject.logicalSheet.paperTracks.map(track => track.paperTrack),
      timelineLanes: timelineLanesForLayout(defaultProject),
    })
    const digitalTextTransform = `scale(${1 / digitalPageSize.widthPx} ${1 / digitalPageSize.heightPx})`
    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(0)
    expect(document.querySelectorAll('.templateFormBox').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.gridOverlay-other')).toHaveLength(2)

    fireEvent.click(screen.getByLabelText(uiText.sheet.displaySettingsMenu))
    fireEvent.click(screen.getByRole('button', { name: 'デジタル標準' }))

    expect(document.querySelectorAll('.templateOuterFrame')).toHaveLength(0)
    expect(document.querySelectorAll('.templateFormBox')).toHaveLength(14)
    expect(document.querySelectorAll('.gridOverlay-other')).toHaveLength(0)
    expect(Array.from(document.querySelectorAll('.templateFormLabel')).map(element => element.textContent)).toEqual([
      'タイトル', '話数', 'シーン', 'カット', '尺', '作業者名', 'MEMO',
    ])
    const headerLabels = Array.from(document.querySelectorAll('.templateHeaderText')).map(element => element.textContent)
    expect(headerLabels).toEqual(['ACTION', 'SOUND', 'CELL', 'CAMERA'])
    expect(document.querySelector('.gridOverlay-sound')).toBeTruthy()
    expect(document.querySelectorAll('.gridOverlay-sound .gridLineRow')).toHaveLength(1)
    expect(document.querySelectorAll('.gridOverlay-sound .gridLineColumn')).toHaveLength(1)
    expect(document.querySelectorAll('.gridLineStrong').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.gridLineMedium').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.gridLineRegular').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.gridRowGuideLabel')).toHaveLength(0)
    expect(Array.from(document.querySelectorAll('.gridSecondCounter')).map(element => element.textContent)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(Array.from(document.querySelectorAll('.gridActionFrameNumber')).map(element => element.textContent)).toEqual(
      Array.from({ length: 72 }, (_, index) => String((index + 1) * 2)),
    )
    expect(document.querySelector('.templateHeaderText')?.getAttribute('transform')).toBe(digitalTextTransform)
    expect(document.querySelector('.templateColumnText')?.getAttribute('transform')).toBe(digitalTextTransform)
    expect(document.querySelector('.gridActionFrameNumber')?.getAttribute('transform')).toBe(digitalTextTransform)
    expect(document.querySelector('.gridSecondCounter')?.getAttribute('transform')).toBe(digitalTextTransform)
    expect(Array.from(document.querySelectorAll('.sheetSvg text')).every(element => element.getAttribute('transform') === digitalTextTransform)).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: uiText.actions.undo }))
    expect(document.querySelectorAll('.gridOverlay-other')).toHaveLength(2)
    expect(document.querySelectorAll('.templateFormBox').length).toBeGreaterThan(16)
  })

it('selects a CELL grid position and creates a key from explicit input', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    sheet.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      toJSON: () => ({}),
    })
    fireEvent.pointerMove(sheet, { clientX: 255, clientY: 290 })
    expect(document.querySelector('.hoverCellRect')).toBeTruthy()
    expect(document.querySelector('.sheetSvg .hoverCellRect')).toBeNull()
    clickSheet(sheet, 255, 290)
    expect(document.querySelector('.selectedCellRect')).toBeTruthy()
    expect(document.querySelector('.selectedCellCorners')).toBeTruthy()
    expect(document.querySelector('.hoverCellRect')).toBeNull()
    expectSelectedHit('cell', 'A', 1)
    expect(document.querySelectorAll('.eventRect')).toHaveLength(0)
    expect(screen.queryByText('1 (key_0001)')).toBeNull()

    enterTimingValue('1')
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)
    const registeredCell = document.querySelector<HTMLElement>('.cspTreeCel[data-csp-key-id]')
    expect(registeredCell).toBeTruthy()
    if (!registeredCell) throw new Error('registered cell card not found')
    expect(registeredCellIdentityText(registeredCell)).toBe('CELL A')
    expect(registeredCell?.querySelector('.cspTreeSheetLabel')?.textContent).toBe('シート: 1')
    expect(registeredCell?.querySelectorAll('input')).toHaveLength(0)
    expect(registeredCell.querySelector('.cspTreeCelName')?.textContent).toBe('A1')
    fireEvent.click(screen.getByRole('button', { name: uiText.nameNormalization.open }))
    expect(screen.getByRole('dialog', { name: uiText.nameNormalization.title })).toBeTruthy()
    expect((screen.getByLabelText(uiText.nameNormalization.target) as HTMLSelectElement).value).toBe('action')
    expect((screen.getByLabelText(uiText.nameNormalization.process) as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText(uiText.nameNormalization.includeAssetFiles) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(uiText.nameNormalization.targets.selectedColumn)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: uiText.nameNormalization.cancel })[0])
    const eventText = document.querySelector('.eventText')
    const eventRect = document.querySelector('.eventRect')
    if (!eventText || !eventRect) throw new Error('event text not found')
    const textX = Number(eventText.getAttribute('x'))
    const textY = Number(eventText.getAttribute('y'))
    const rectX = Number(eventRect.getAttribute('x'))
    const rectY = Number(eventRect.getAttribute('y'))
    const rectW = Number(eventRect.getAttribute('width'))
    const rectH = Number(eventRect.getAttribute('height'))
    expect(eventText.getAttribute('dominant-baseline')).toBe('central')
    expect(textX).toBeCloseTo((rectX + rectW / 2) * standardA3SheetTemplate.page.widthPx)
    expect(textY).toBeCloseTo((rectY + rectH / 2) * standardA3SheetTemplate.page.heightPx)
    expect(eventText.getAttribute('transform')).toBe(`scale(${1 / standardA3SheetTemplate.page.widthPx} ${1 / standardA3SheetTemplate.page.heightPx})`)
    const textFontSize = Number(eventText.getAttribute('font-size') ?? eventText.getAttribute('fontSize'))
    expect(textFontSize).toBe(18)
    const zoom = getZoomSlider()
    fireEvent.change(zoom, { target: { value: '200' } })
    const zoomedEventText = document.querySelector('.eventText')
    if (!zoomedEventText) throw new Error('event text not found after zoom')
    expect(Number(zoomedEventText.getAttribute('font-size') ?? zoomedEventText.getAttribute('fontSize'))).toBeCloseTo(textFontSize)
  })

it('commits an active text annotation on outside click without creating another editor', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    const textTool = screen.getByRole('button', { name: uiText.sheet.textTool })

    fireEvent.click(textTool)
    expect(textTool.getAttribute('aria-pressed')).toBe('true')
    expect(sheet.classList.contains('textAnnotationMode')).toBe(true)
    expect(sheet.classList.contains('textAnnotationPlacementMode')).toBe(true)
    fireEvent.pointerMove(sheet, { clientX: 300, clientY: 300 })
    expect(document.querySelector('.textCursorBadge')?.textContent).toBe('T+')

    clickSheet(sheet, 320, 320)
    const editor = document.querySelector<HTMLTextAreaElement>('.annotationTextEditor')
    expect(editor).toBeTruthy()
    if (!editor) throw new Error('text annotation editor not found')
    expect(document.querySelector('.textCursorBadge')).toBeNull()

    fireEvent.change(editor, { target: { value: 'memo' } })
    clickSheet(sheet, 420, 420)

    expect(document.querySelector('.annotationTextEditor')).toBeNull()
    const displays = document.querySelectorAll('.annotationTextDisplay')
    expect(displays).toHaveLength(1)
    expect(displays[0]?.textContent).toBe('memo')
    expect(displays[0]?.classList.contains('selected')).toBe(true)

    const display = displays[0] as HTMLButtonElement
    display.setPointerCapture = vi.fn()
    display.releasePointerCapture = vi.fn()
    const initialMaxWidth = display.style.maxWidth
    const initialFontSize = display.style.fontSize
    expect(initialFontSize).toBe('18px')
    const zoom = getZoomSlider()
    fireEvent.change(zoom, { target: { value: '200' } })
    const zoomedDisplay = document.querySelector<HTMLButtonElement>('.annotationTextDisplay')
    expect(zoomedDisplay).toBeTruthy()
    if (!zoomedDisplay) throw new Error('zoomed text annotation not found')
    expect(zoomedDisplay.style.fontSize).toBe('36px')
    expect(parseFloat(zoomedDisplay.style.maxWidth)).toBeCloseTo(parseFloat(initialMaxWidth) * 2)
    fireEvent.change(zoom, { target: { value: '100' } })
    const resetDisplay = document.querySelector<HTMLButtonElement>('.annotationTextDisplay')
    expect(resetDisplay).toBeTruthy()
    if (!resetDisplay) throw new Error('reset text annotation not found')
    resetDisplay.setPointerCapture = vi.fn()
    resetDisplay.releasePointerCapture = vi.fn()
    fireEvent.pointerDown(resetDisplay, { pointerId: 31, pointerType: 'mouse', button: 0, buttons: 1, clientX: 320, clientY: 320 })
    fireEvent.pointerMove(window, { pointerId: 31, pointerType: 'mouse', buttons: 1, clientX: 900, clientY: 320 })
    fireEvent.pointerUp(window, { pointerId: 31, pointerType: 'mouse', button: 0, buttons: 0, clientX: 930, clientY: 320 })
    fireEvent.pointerMove(window, { pointerId: 31, pointerType: 'mouse', buttons: 1, clientX: 500, clientY: 320 })
    expect(document.querySelector('.annotationTextEditor')).toBeNull()
    const movedDisplay = document.querySelector<HTMLButtonElement>('.annotationTextDisplay')
    expect(movedDisplay).toBeTruthy()
    if (!movedDisplay) throw new Error('moved text annotation not found')
    expect(movedDisplay.style.maxWidth).toBe(initialMaxWidth)

    fireEvent.doubleClick(movedDisplay)
    expect(document.querySelectorAll('.annotationTextEditor')).toHaveLength(1)
    clickSheet(sheet, 430, 430)
    expect(document.querySelector('.annotationTextEditor')).toBeNull()

    clickSheet(sheet, 520, 520)
    expect(document.querySelectorAll('.annotationTextEditor')).toHaveLength(1)
    expect(document.querySelectorAll('.annotationTextDisplay')).toHaveLength(1)
  })

it('resets the page text editor completion guard for every edit session', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    fireEvent.click(screen.getByRole('button', { name: uiText.sheet.textTool }))
    clickSheet(sheet, 320, 320)
    const firstEditor = document.querySelector<HTMLTextAreaElement>('.annotationTextEditor')!
    fireEvent.change(firstEditor, { target: { value: 'first' } })
    fireEvent.keyDown(firstEditor, { key: 'Enter', ctrlKey: true })

    const display = document.querySelector<HTMLButtonElement>('.annotationTextDisplay')!
    fireEvent.doubleClick(display)
    const secondEditor = document.querySelector<HTMLTextAreaElement>('.annotationTextEditor')!
    fireEvent.change(secondEditor, { target: { value: 'second' } })
    fireEvent.blur(secondEditor, { relatedTarget: document.querySelector('.sheetViewport') })

    expect(document.querySelector('.annotationTextEditor')).toBeNull()
    expect(document.querySelector('.annotationTextDisplay')?.textContent).toBe('second')
  })

it('reuses a registered cell when typing the same value in the same CELL column', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    enterTimingValue('1')
    clickTemplateFrame(sheet, 'cell', 'A', 5)
    enterTimingValue('1')

    expect(document.querySelectorAll('.eventRect')).toHaveLength(2)
    expect(document.querySelectorAll('.cspTreeCel[data-csp-key-id]')).toHaveLength(1)
    const registeredCell = document.querySelector('.cspTreeCel[data-csp-key-id]')
    expect(registeredCell).toBeTruthy()
    if (!registeredCell) throw new Error('registered cell card not found')
    expect(registeredCellIdentityText(registeredCell)).toBe('CELL A')
    expect(registeredCell.querySelector('.cspTreeSheetLabel')?.textContent).toBe('シート: 1')
    expect(registeredCell.querySelectorAll('input')).toHaveLength(0)
    expect(registeredCell.querySelector('.cspTreeCelName')?.textContent).toBe('A1')
  })

it('jumps to the first timeline use when selecting a CSP cell card', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 24)
    enterTimingValue('1')

    const registeredCell = document.querySelector<HTMLElement>('.cspTreeCel[data-csp-key-id]')
    expect(registeredCell).toBeTruthy()
    if (!registeredCell) throw new Error('registered cell card not found')
    expectSelectedHit('cell', 'A', 25)
    clickTemplateFrame(sheet, 'cell', 'B', 1)
    expectSelectedHit('cell', 'B', 1)
    fireEvent.click(registeredCell)
    expectSelectedHit('cell', 'A', 24)
  })

it('auto-scrolls the sheet viewport while dragging a registered asset near the edge', () => {
    render(<App />)
    const viewport = document.querySelector('.sheetViewport') as HTMLElement | null
    if (!viewport) throw new Error('sheet viewport not found')
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 400 })
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 1000 })
    viewport.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 200,
      width: 400,
      height: 200,
      toJSON: () => ({}),
    })
    viewport.scrollTop = 100
    const dataTransfer = {
      types: [ASSET_DRAG_MIME],
      dropEffect: 'none',
      getData: (type: string) => type === ASSET_DRAG_MIME ? 'asset_0001' : '',
    }

    const dragOver = createEvent.dragOver(viewport)
    Object.defineProperty(dragOver, 'clientX', { value: 200 })
    Object.defineProperty(dragOver, 'clientY', { value: 196 })
    Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer })
    fireEvent(viewport, dragOver)

    expect(viewport.scrollTop).toBeGreaterThan(100)
  })

it('deletes a selected registered cell from the fixed pane footer and restores it with undo', async () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    clickSheet(sheet, 255, 290)
    enterTimingValue('1')
    expect(document.querySelector('.cspTreeCel[data-csp-key-id]')).toBeTruthy()
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)

    const registeredCard = document.querySelector<HTMLElement>('.cspTreeCel[data-csp-key-id]')
    if (!registeredCard) throw new Error('registered cell card not found')
    fireEvent.click(registeredCard)
    fireEvent.click(screen.getByRole('button', { name: /1を削除$/ }))

    await waitFor(() => expect(document.querySelector('.cspTreeCel.unregistered')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /1を削除$/ }))
    await waitFor(() => expect(document.querySelector('.cspTreeCel[data-csp-key-id]')).toBeNull())
    expect(document.querySelectorAll('.eventRect')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: uiText.actions.undo }))
    await waitFor(() => expect(document.querySelector('.cspTreeCel.unregistered')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: uiText.actions.undo }))
    await waitFor(() => expect(document.querySelector('.cspTreeCel[data-csp-key-id]:not(.unregistered)')).toBeTruthy())
    expect(document.querySelectorAll('.eventRect')).toHaveLength(1)
  })
})
