import { useState } from 'react'

type TemplateHelpItem = {
  term: string
  description: string
}

type TemplateHelpSection = {
  title: string
  introduction?: string
  items: TemplateHelpItem[]
}

type TemplateHelpStep = {
  title: string
  description: string
}

type TemplateHelpChapter = {
  id: string
  number: string
  title: string
  summary: string
  steps?: TemplateHelpStep[]
  sections: TemplateHelpSection[]
}

const templateHelpChapters: TemplateHelpChapter[] = [
  {
    id: 'complete',
    number: '01',
    title: '完成までの手順',
    summary: 'この章を上から順番に進めると、新規作成からJSON保存と実機確認まで完了できます。',
    steps: [
      { title: '用途を決める', description: '印刷・スキャン・紙の罫線に合わせるなら紙タイムシート、横幅とフレーム数を柔軟に増やすならデジタルタイムシートを選びます。' },
      { title: '「新しいテンプレート」を開く', description: '紙は名前、用紙サイズ、向き、PPI、任意の参照画像を設定します。デジタルは名前、FPS、初期フレーム数、ACTIONとCELLで共有するセル列数を設定します。' },
      { title: '作成条件を確認する', description: '紙は表示される実ピクセル数と参照画像のPPIを確認します。デジタルは実運用のFPSと必要な共有セル列数を先に決め、「作成」を押します。' },
      { title: 'IDと名前を整える', description: '右の「概要」でIDと表示名を確認します。IDは他のテンプレートと重複しない英数字中心の名前、表示名は作業者が選べるわかりやすい名前にします。' },
      { title: '紙の参照画像を合わせる', description: '紙の場合は「参照画像」で画像、ピクセル数、PPI、配置を確認します。テンプレートと画像のPPIが異なるときは先に原画像側を見直します。デジタルではこの手順を飛ばします。' },
      { title: '必要な領域を追加する', description: '上部の「情報欄追加」「入力表を追加」「ACTION」「SOUND」「CELL」「CAMERA」「補助罫線」から必要なものだけを追加します。不要な領域は「概要」または「領域一覧」から個別に削除できます。' },
      { title: 'キャンバス上で位置を決める', description: '領域をクリックし、赤い辺またはハンドルをドラッグして大きさを合わせます。右の「概要」にあるX・Y・W・Hを数値入力すると、1px単位で仕上げられます。' },
      { title: '領域の中身を設定する', description: '「領域一覧」で領域名、情報の割当、文字サイズ、開始F、行数、列数を設定します。入力表は「概要」で編集方法、メモ対象、文字と内余白を設定します。' },
      { title: '表示ルールを整える', description: '「表示」で紙の下端セル列名と、ACTION・SOUND・CELL・CAMERAの見出し文字を確認します。空の見出しはシート上に表示されません。' },
      { title: '紙の補正基準枠を決める', description: '紙の「概要」で補正基準枠を編集対象にし、グリッド外接、A3標準枠、手入力のどれかで決めます。この枠がEditorとCorrectorの四隅補正の基準になります。' },
      { title: '工程と登録先を確認する', description: '「工程編集」を開き、CSP上の上下順、工程名、ファイル名接尾辞を整えます。一番下の工程が素材を直接登録したときのデフォルト登録先です。' },
      { title: '適用・保存・実機確認', description: '「全体表示」と「領域一覧」で最終確認し、「変更を適用」で現在の基準にしてから「シートテンプレ保存」でJSONを保存します。EditorまたはRemapでそのJSONを読み込み、クリック範囲、入力、ページ、紙補正をテストしたら完成です。' },
    ],
    sections: [
      {
        title: '完成判定のチェックリスト',
        items: [
          { term: '見た目', description: 'テンプレート画像、アプリ描画の罫線と文字が重ならず、全フレームをスクロールで確認できる。' },
          { term: '操作', description: '見た目の枠と領域選択・入力・メモのクリック可能範囲が一致し、必要な列と工程が表示される。' },
          { term: '再利用', description: '保存したJSONを読み直しても同じ配置になり、Editor・Remapで想定した尺とトラック数で開く。' },
        ],
      },
    ],
  },
  {
    id: 'screen',
    number: '02',
    title: '画面構成と下書き',
    summary: 'ヘッダー、上部ツールバー、キャンバス、詳細ドック、ステータスの役割を説明します。',
    sections: [
      {
        title: 'アプリ全体',
        items: [
          { term: 'ヘッダー', description: '左にアプリ名とバージョン、右にこのヘルプと「リセット」があります。リセットはテンプレートと工程をA3標準の初期状態へ戻すため、必要なら先にJSON保存します。' },
          { term: '上部ツールバー', description: '下書きの適用・取消、新規作成、JSON読込・保存、領域追加、工程編集、倍率を左から順にまとめています。' },
          { term: '中央キャンバス', description: '参照画像、罫線、見出し、領域を重ねた仕上がりプレビューです。ポインター下の領域が薄く強調され、クリックで編集対象になります。' },
          { term: '右の詳細ドック', description: '「概要」「表示」「参照画像」「領域一覧」「JSON」を切り替えます。参照画像は紙テンプレートにだけ表示されます。仕切りをドラッグすると幅を調整できます。' },
          { term: 'ステータスバー', description: '左下に現在のテンプレート名、右下にページのピクセル寸法が表示されます。' },
        ],
      },
      {
        title: '下書きの状態',
        items: [
          { term: '標準テンプレ保護中', description: '組み込みテンプレートは直接上書きされません。最初の編集でカスタム複製として扱われます。' },
          { term: '未適用の変更', description: '画面上の下書きと、最後に適用した基準が異なる状態です。「変更を適用」または「キャンセル」が使えます。' },
          { term: '適用済み', description: '現在の下書きが取消時の戻り先になった状態です。JSON保存前の区切りとして利用します。' },
        ],
      },
    ],
  },
  {
    id: 'create',
    number: '03',
    title: '新規作成・複製・読込',
    summary: '白紙に近い新規作成から、標準形の利用、既存JSONの継続編集までを扱います。',
    sections: [
      {
        title: '「新しいテンプレート」',
        items: [
          { term: '紙タイムシート', description: '用紙サイズと向きから、PPIに応じた実ピクセル数を作ります。参照画像は任意で、同一PPIなら拡大縮小せず中央配置して余剩部分だけをトリムします。' },
          { term: 'デジタルタイムシート', description: 'FPS、初期フレーム数、ACTIONとCELLで共有するセル列数から連続キャンバスを作ります。後からセル列やSOUND・CAMERAレーンを増やすと横幅も追従します。' },
        ],
      },
      {
        title: '「新規テンプレ作成」メニュー',
        items: [
          { term: '紙画像から作成', description: '選択した画像のサイズと密度情報を読み、参照画像付きの紙テンプレート下書きを作ります。' },
          { term: 'A3標準から作成', description: '現在のA3標準構成を作成元にします。紙の標準レイアウトを少し変える場合に適しています。' },
          { term: 'デジタル標準から作成', description: 'デジタル用の情報欄、メモ、ACTION、SOUND、CELL、CAMERAを備えた下書きを作ります。' },
          { term: '現在のテンプレートを複製', description: '現在の表示と領域を保ったまま、別IDのカスタム版として編集を始めます。' },
          { term: 'シートテンプレ読込', description: '既存のテンプレートJSONを読み、編集中の下書きとして開きます。現在の未保存内容は先に保存してください。' },
        ],
      },
    ],
  },
  {
    id: 'canvas',
    number: '04',
    title: 'キャンバス操作と座標',
    summary: '領域の選択、ドラッグ、ピクセル座標、ズームとスクロールを説明します。',
    sections: [
      {
        title: '領域を選択・変形する',
        items: [
          { term: 'ポインターで選択', description: '領域の上でポインターを動かすと範囲が強調されます。クリックすると赤い外枠と四辺のハンドルが表示されます。' },
          { term: '辺とハンドルをドラッグ', description: '左・右・上・下の辺をそれぞれ動かし、選択領域の大きさと位置をピクセル境界へ揃えます。下の読み出しにX・Y・W・H・R・Bが表示されます。' },
          { term: '数値で仕上げ', description: '右の「概要」にある選択領域座標X・Y・W・Hは実ピクセル単位です。元画像の罫線位置がわかる場合は数値入力が確実です。' },
        ],
      },
      {
        title: '表示移動と倍率',
        items: [
          { term: '倍率スライダー', description: '滑らかな全体確認から、3200%のピクセル編集まで調整できます。紙テンプレートは800%以上でピクセルグリッドを表示します。' },
          { term: 'プリセット', description: '100%、400%、800%、1600%、3200%へ直接切り替えられます。「全体表示」は現在のビューポートに収まる倍率を計算します。' },
          { term: 'マウス操作', description: 'ホイールで縦スクロール、Shift+ホイールで横スクロール、Ctrl+ホイールでポインター位置を基準に拡大縮小します。' },
        ],
      },
    ],
  },
  {
    id: 'forms',
    number: '05',
    title: '情報欄と入力表',
    summary: 'カット情報を表示する欄と、ユーザーが値を入力できる表を作ります。',
    sections: [
      {
        title: '情報欄',
        items: [
          { term: '追加と割当', description: '「情報欄追加」は、まだ使われていない作品名・話数・シーン・カット・尺・作業者名・ページ数などの候補を順に割り当てます。「領域一覧」の「情報」で別項目へ変更できます。' },
          { term: '文字レイアウト', description: '選択後の「概要」で文字サイズ、最小文字、行間、内余白を設定します。横・縦の欄外表示は「欄内で切る」と「ページ内へ許可」から選べます。' },
          { term: 'カット番号プレフィックス', description: '「概要」で保存名に付ける接頭辞を指定します。「数字カットだけ」をオンにするとOPなどの文字カットには付加しません。プレビューで結果を確認できます。' },
        ],
      },
      {
        title: '入力表',
        items: [
          { term: '初期構成', description: '「入力表を追加」は、2つの項目名とその入力欄を持つ2列の表を作ります。領域の外枠と欄は仕上がりに描画されます。' },
          { term: '編集方法', description: '選択した入力欄ごとに「その場で入力」または「ポップアップ」を選びます。長文ならその場で入力、狭い欄ならポップアップが向いています。' },
          { term: 'メモ対象', description: '「この欄」「表全体」「同じグループ」「メモ対象外」から選びます。グループは共通ID、各対象は任意の表示名を持てます。' },
          { term: '文字と自動縮小', description: '入力欄ごとに文字、最小文字、行間、内余白を設定します。複数行フィールドは、欄内に収まる範囲での自動縮小を切り替えられます。' },
        ],
      },
    ],
  },
  {
    id: 'timing-grids',
    number: '06',
    title: 'ACTION・SOUND・CELL・CAMERA',
    summary: '原画、動画、台詞・音響、撮影の各指示を記入する4種類の欄と、紙・デジタルの列数の考え方を説明します。',
    sections: [
      {
        title: '4種類の役割',
        items: [
          { term: 'ACTION', description: '原画工程でタイミング指示を記入する欄です。CELLと同じ論理セル列を使うため、列名・順序・列数は常に一致します。' },
          { term: 'SOUND', description: '台詞やSEなどの音響指示を、開始から終了までの区間として記入する欄です。「領域一覧」でテンプレートの初期列数を決め、実際のプロジェクトではEditor・Remapの列見出しを右クリックして追加・名前変更・削除します。' },
          { term: 'CELL', description: '動画工程で動画番号とタイミングを記入する欄です。ACTIONと同じ論理セル列を、動画用の記入欄として表示します。' },
          { term: 'CAMERA', description: 'カメラワークや撮影指示を、指定フレームの区間に記入する欄です。テンプレートでは初期列数を決め、実際のプロジェクトでは列見出しの右クリックから管理します。デジタルではSOUNDと同様に実際のレーン数に合わせて横方向へ増やせます。' },
        ],
      },
      {
        title: '行・列・開始フレーム',
        items: [
          { term: '開始F', description: '領域が担当する最初のフレームです。紙の左右ページや分割領域で開始位置をずらすときに使います。' },
          { term: '行数', description: 'その領域に描画するフレーム行の数です。紙では印刷面に収まる数、デジタルでは初期フレーム数と整合させます。' },
          { term: '列数', description: '紙は領域ごとに表示できる列数を設定し、入り切らない論理セル列はEditor・Remap側で欄外扱いになります。デジタルのACTIONとCELLは共有セル列数を一括変更し、片方だけ異なる列数にはできません。' },
          { term: 'デジタルの可変幅', description: 'デジタルは予備列を確保せず、共有セル列とSOUND・CAMERAレーンの実数に合わせてキャンバスの横幅を広げます。列数の変更後は全体表示で配置を再確認します。' },
        ],
      },
    ],
  },
  {
    id: 'decoration',
    number: '07',
    title: '補助罫線と表示設定',
    summary: '入力を受けない罫線と、シート共通の見出しを整えます。',
    sections: [
      {
        title: '補助罫線',
        items: [
          { term: '用途', description: '「補助罫線追加」は、区切り、チェック表、注記用のグリッドなど、描画だけに使う領域を作ります。シート入力や素材ドロップは受け付けません。' },
          { term: '行数と列数', description: '「概要」の補助罫線設定で、1〜64列と必要な行数を指定します。' },
          { term: '線の設定', description: '横罫線と縦罫線をそれぞれ無し・実線・破線・点線から選び、線幅、線色、外枠の有無を設定します。' },
        ],
      },
      {
        title: '「表示」タブ',
        items: [
          { term: '下端セル列名', description: '紙テンプレートのグリッド下端に、セル列名を表示するか切り替えます。デジタルにはこの項目は表示されません。' },
          { term: 'ヘッダー見出し', description: 'ACTION・SOUND・CELL・CAMERAごとに上部見出しの文字を指定します。空欄にするとその見出しだけを非表示にできます。' },
        ],
      },
    ],
  },
  {
    id: 'reference',
    number: '08',
    title: '参照画像と補正基準枠',
    summary: '紙テンプレートの元画像と、スキャンの四隅補正に使う枠を正しく設定します。',
    sections: [
      {
        title: '参照画像',
        items: [
          { term: '読込と解除', description: '紙テンプレートの「参照画像」タブで画像を読み込み、不要な場合は解除します。読み込んだ画像はテンプレートJSONへ埋め込まれます。' },
          { term: '元画像情報', description: '画像名、ピクセル寸法、PPI、ピクセル等倍・中央配置のオフセットを確認できます。テンプレートPPIと一致しないと警告されます。' },
          { term: '画像とアプリ描画', description: '参照画像の罫線に合わせて、アプリ描画の入力領域とクリック範囲を作ります。画像自体の文字とアプリのラベルが二重になっていないかも確認します。' },
        ],
      },
      {
        title: '補正基準枠',
        items: [
          { term: '編集対象にする', description: '「概要」の補正基準枠にあるボタンを押すと、キャンバス上の枠をドラッグまたはX・Y・W・Hで編集できます。' },
          { term: 'グリッド外接に合わせる', description: 'ACTION・SOUND・CELL・CAMERAグリッド全体の外接矩形を、四隅合わせの基準にします。' },
          { term: 'A3標準枠に戻す', description: 'A3標準で使っている紙補正用の枠へ戻します。A3以外や独自罫線では元画像に合わせて再設定します。' },
          { term: 'グリッド外接を使う', description: '明示的な枠を解除し、現在のグリッド外接から自動計算する状態へ戻します。' },
        ],
      },
    ],
  },
  {
    id: 'dock',
    number: '09',
    title: '概要・領域一覧・JSON',
    summary: '右の詳細ドックにある各タブの項目と、使い分けをまとめます。',
    sections: [
      {
        title: '概要',
        items: [
          { term: '共通情報', description: 'ID、名前、カット番号プレフィックス、保存名プレビュー、表示レイアウト、領域数、選択領域を確認します。' },
          { term: 'デジタル固有', description: 'FPS、初期フレーム数、ACTIONとCELLで共有するセル列数を変更できます。共有セル列を追加・削除すると、両欄の列名・順序・列数へ同時に反映されます。' },
          { term: '紙固有', description: '用紙種別、幅・高さpx、DPI、物理用紙フラグ、参照画像、補正基準枠を管理します。用紙寸法の変更は全領域の実ピクセル位置に影響します。' },
          { term: '選択領域', description: 'X・Y・W・H、文字レイアウト、入力表の欄設定、補助罫線の行列と線を、領域の種類に応じて表示します。不要な領域は「この領域を削除」で未適用の変更として取り除けます。' },
        ],
      },
      {
        title: '領域一覧とJSON',
        items: [
          { term: '領域一覧', description: '全領域を表で一度に確認します。行のクリックでキャンバスの選択と連動し、領域名、情報割当、文字、X・Y・W・H、開始F、行数、列数を直接編集できます。用途列は読み取り専用です。' },
          { term: 'JSON', description: '現在の下書きをスキーマ形式で確認する読み取り専用プレビューです。ここへ直接入力はできません。保存は上部の「シートテンプレ保存」を使います。' },
        ],
      },
    ],
  },
  {
    id: 'process',
    number: '10',
    title: '工程設定',
    summary: 'CSPレイヤー構成で使う工程名、ファイル名接尾辞、重ね順、デフォルト登録先を決めます。',
    sections: [
      {
        title: '工程編集ダイアログ',
        items: [
          { term: 'CSPの上下順', description: '上がCSP上で上に重なる工程、下が下に重なる工程です。左のドラッグハンドルで入れ替えます。' },
          { term: '名前', description: '作画、演出、監督、作監など、アプリとCSPで表示する工程名です。空欄と重複名は適用できません。' },
          { term: '接尾辞', description: '実ファイル名を一括リネームするときに付ける工程別の文字です。Windowsのファイル名に使えない記号は指定できません。' },
          { term: '直接登録', description: '表の一番下の工程が、素材を直接セルへ登録したときのデフォルト登録先になります。' },
          { term: '追加・削除・適用', description: '上限数まで新しい工程を追加でき、最後の1工程を除いて削除できます。ダイアログ内の変更は「適用」で確定します。' },
        ],
      },
    ],
  },
  {
    id: 'save',
    number: '11',
    title: '適用・保存・利用',
    summary: '編集中の下書きを確定し、JSONとして保存し、Editor・Remapで使います。',
    sections: [
      {
        title: '適用と取消',
        items: [
          { term: '変更を適用', description: '現在の下書きをこの作業中の基準にします。以後の「キャンセル」はこの状態へ戻ります。' },
          { term: 'キャンセル', description: '最後に適用した状態以降のテンプレート変更を破棄します。JSON読込やリセットとは異なります。' },
          { term: 'シートテンプレ保存', description: '画面上の現在の下書きを、他のアプリで読み込めるJSONとして保存します。保存漏れを防ぐため、運用上は「変更を適用」の直後に保存します。' },
        ],
      },
      {
        title: 'Editor・Remapでの確認',
        items: [
          { term: '読み込み', description: 'EditorまたはRemapのテンプレート操作から保存したJSONを読み込みます。新規プロジェクトで試すと安全です。' },
          { term: '入力テスト', description: '情報欄と入力表のクリック範囲、ACTIONの原画番号と中割り指示、CELLの動画番号、SOUND・CAMERAの区間指示、メモ対象を確認します。' },
          { term: '見た目のテスト', description: '最初のフレーム、24フレームの秒境界、最終フレーム、トラック数を増やした状態、倍率を変えた状態をスクロールして確認します。' },
          { term: '紙の補正テスト', description: '紙テンプレートは、実際のスキャン画像で四隅補正を開き、補正基準枠が意図した罫線へ合うことを確認します。' },
        ],
      },
    ],
  },
  {
    id: 'troubleshooting',
    number: '12',
    title: '困ったとき・制限事項',
    summary: 'データを失わずに戻る方法と、現状の編集UIで注意する点をまとめます。',
    sections: [
      {
        title: 'よくある状態',
        items: [
          { term: '不要な領域を削除したい', description: 'キャンバスで領域を選んで「概要」の「この領域を削除」を押すか、「領域一覧」の該当行にある「削除」を押します。削除は未適用の変更なので、確定前なら「キャンセル」で戻せます。' },
          { term: '元画像と罫線が合わない', description: '用紙サイズ、向き、ピクセル数、PPI、参照画像の元サイズと配置オフセットを確認します。100%と800%以上の両方で罫線境界を比較します。' },
          { term: '文字が切れる', description: '文字サイズ、最小文字、行間、内余白、自動縮小、欄外表示を確認します。見た目だけでなくEditor・Remapで実文字を入力して確認します。' },
          { term: 'デジタルの横幅が変わった', description: 'デジタルはトラック数とレーン数から横幅を再計算する設計です。不具合ではないため、全体表示へ戻して情報欄、メモ、タイミング欄の右端が揃っているかを確認します。' },
          { term: '未保存内容を戻したい', description: '未適用の変更は「キャンセル」で最後の適用状態へ戻せます。「リセット」や別JSONの読込は作業全体を入れ替えるため、先に現在のJSONを保存します。' },
        ],
      },
    ],
  },
]

export function TemplateEditorHelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="appHelpBackdrop" role="dialog" aria-modal="true" aria-label="xsheet-templateの使い方">
      <section className="appHelpDialog templateEditorHelpDialog">
        <header>
          <div>
            <strong>xsheet-template ヘルプ</strong>
            <span>テンプレートを最初から完成させる手順と、全機能を章別に説明します。</span>
          </div>
          <button type="button" onClick={onClose}>閉じる</button>
        </header>
        <div className="appHelpBody appHelpBodyDetailed">
          <TemplateEditorDetailedHelp />
        </div>
        <footer>
          <p>作業の区切りで「変更を適用」を押し、最後に「シートテンプレ保存」でJSONを保存してください。</p>
        </footer>
      </section>
    </div>
  )
}

export function TemplateEditorDetailedHelp() {
  const [activeChapterId, setActiveChapterId] = useState(templateHelpChapters[0].id)
  const activeChapterIndex = Math.max(0, templateHelpChapters.findIndex(chapter => chapter.id === activeChapterId))
  const activeChapter = templateHelpChapters[activeChapterIndex]

  function selectChapter(index: number) {
    const chapter = templateHelpChapters[index]
    if (chapter) setActiveChapterId(chapter.id)
  }

  return (
    <div className="editorHelpManual templateHelpManual">
      <aside className="editorHelpToc">
        <div className="editorHelpTocIntro">
          <strong>完成手順＋全機能</strong>
          <span>全{templateHelpChapters.length}章</span>
        </div>
        <nav aria-label="テンプレートEXEヘルプの目次">
          {templateHelpChapters.map(chapter => (
            <button
              key={chapter.id}
              type="button"
              className={chapter.id === activeChapter.id ? 'active' : ''}
              aria-current={chapter.id === activeChapter.id ? 'page' : undefined}
              onClick={() => setActiveChapterId(chapter.id)}
            >
              <span>{chapter.number}</span>
              {chapter.title}
            </button>
          ))}
        </nav>
      </aside>

      <article key={activeChapter.id} className="editorHelpChapter templateHelpChapter" aria-labelledby={`template-help-${activeChapter.id}`}>
        <header>
          <span>CHAPTER {activeChapter.number}</span>
          <h2 id={`template-help-${activeChapter.id}`}>{activeChapter.title}</h2>
          <p>{activeChapter.summary}</p>
        </header>

        {activeChapter.steps && (
          <section className="templateHelpSteps">
            <h3>上から順番に進める</h3>
            <ol>
              {activeChapter.steps.map((step, index) => (
                <li key={step.title}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {activeChapter.sections.map(section => (
          <section key={section.title}>
            <h3>{section.title}</h3>
            {section.introduction && <p>{section.introduction}</p>}
            <dl>
              {section.items.map(item => (
                <div key={item.term}>
                  <dt>{item.term}</dt>
                  <dd>{item.description}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        <footer className="editorHelpChapterNavigation" aria-label="章の移動">
          <button type="button" disabled={activeChapterIndex === 0} onClick={() => selectChapter(activeChapterIndex - 1)}>
            ← 前の章
          </button>
          <span>{activeChapterIndex + 1} / {templateHelpChapters.length}</span>
          <button type="button" disabled={activeChapterIndex === templateHelpChapters.length - 1} onClick={() => selectChapter(activeChapterIndex + 1)}>
            次の章 →
          </button>
        </footer>
      </article>
    </div>
  )
}
