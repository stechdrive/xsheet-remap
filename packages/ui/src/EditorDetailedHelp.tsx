import { useState } from 'react'

type HelpItem = {
  term: string
  description: string
}

type HelpSection = {
  title: string
  introduction?: string
  items: HelpItem[]
}

type HelpChapter = {
  id: string
  number: string
  title: string
  summary: string
  sections: HelpSection[]
}

const editorHelpChapters: HelpChapter[] = [
  {
    id: 'screen',
    number: '01',
    title: '画面の見方',
    summary: 'メニュー、上部バー、シート作業レール、左右のペインの役割を把握します。',
    sections: [
      {
        title: '上部の操作',
        items: [
          { term: '画面切替メニュー', description: '新規作成、プロジェクトの読込・保存、外部データの読込、各形式への書き出し、シート入力／シートテンプレのワークスペース切替を行います。' },
          { term: 'カット情報', description: '作品名、話数、シーン、カット番号、作業者などの項目と尺を編集します。尺は秒＋コマ、または総フレーム数として扱われます。' },
          { term: '元に戻す・やり直し・ヘルプ', description: '編集履歴の移動、クイックガイドとこの詳細ヘルプを開きます。シート固有の操作は中央左端のシート作業レールへまとめられています。' },
        ],
      },
      {
        title: 'シート入力ワークスペース',
        items: [
          { term: '左：CSPレイヤー構成', description: '登録工程、セル、BG／BOOK、撮影指示、メモの構成、登録先工程、CSP上の重ね順を管理します。行やカードを選択し、最下部に固定された一括リネーム、追加、削除の各操作を使います。' },
          { term: '中央：タイムシート', description: 'ACTION、CELL、SOUND、CAMERAの各欄へ入力します。左端のシート作業レールから兼用カット、紙シート、OCR、表示・テンプレート、入力文字、ページを操作します。倍率と注釈はシート上のフローティング操作を使います。' },
          { term: '右：画像素材', description: 'カットフォルダを参照し、画像の登録、選択、プレビュー、並べ替え、シートや登録セルへの割当を行います。' },
          { term: 'シート作業レール中央：履歴', description: '初稿と修正シートを切り替えます。操作アイコンの間だけがスクロールし、名前変更、保護、前シートの下敷き表示、追加、削除ができます。' },
          { term: '下部ステータス', description: '現在の選択対象と、その場で使えるマウス・キーボード操作を表示します。操作に迷ったときの短い案内として利用できます。' },
        ],
      },
    ],
  },
  {
    id: 'project',
    number: '02',
    title: 'プロジェクトと保存',
    summary: '作業を新しく始め、.xsrプロジェクトを開いて保存します。',
    sections: [
      {
        title: '作成・読込・保存',
        items: [
          { term: '新規プロジェクト', description: '現在の作業状態を初期化します。未保存の変更がある場合は、先に保存してください。' },
          { term: 'プロジェクトを開く', description: '.xsrプロジェクトを開きます。シートテンプレートJSONやCSP自動登録ファイルはここでは開きません。別PCで素材パスが見つからない場合は、画像素材のカットフォルダを選び直すと、相対位置または内容が同じ素材へ既存カードを再接続します。' },
          { term: '保存', description: 'デスクトップ版では、初回に決めた.xsrファイルへ上書きします。保存先が未決定のときは保存先を選びます。' },
          { term: '名前を付けて保存', description: '現在の内容を別名または別の場所へ.xsrとして保存します。PWA版ではブラウザのダウンロードとして保存されます。' },
        ],
      },
      {
        title: 'プロジェクトに含まれるもの',
        items: [
          { term: '保持される編集内容', description: 'カット情報、タイミング、登録セル、素材対応、紙シート設定、注釈、テンプレート、兼用カット、シート履歴を一つのプロジェクトとして管理します。' },
          { term: '外部ファイルとの関係', description: 'デスクトップ版の画像素材は元ファイルの場所も参照します。元ファイルを移動したときは、書き出し前にカットフォルダと素材の状態を確認してください。' },
          { term: '元に戻す／やり直し', description: '上部のボタンまたはCtrl+Z／Ctrl+Yで編集履歴を移動します。ファイル保存や確認ダイアログを伴う一部の外部操作は履歴の対象外です。' },
        ],
      },
    ],
  },
  {
    id: 'cut',
    number: '03',
    title: 'カット情報・兼用・履歴',
    summary: 'カットの基本情報、兼用カット、修正シートを整理します。',
    sections: [
      {
        title: 'カット情報と尺',
        items: [
          { term: '作品情報', description: '上部の「カット情報」で作品名、話数、シーン、カット番号、作業者、テンプレート固有の追加項目を入力します。作品名・話数・カット番号は出力ファイル名にも使われます。' },
          { term: '尺', description: '秒とコマを直接入力するか、上下ボタンで調整します。尺を変更すると有効なフレーム範囲と必要ページ数が更新されます。' },
          { term: 'プリロール', description: 'シート作業レールの「表示設定」にある「前置き」で、本編前に表示する固定のダミーコマを切り替えます。本編のカット尺そのものには含まれません。' },
        ],
      },
      {
        title: '兼用カットと修正シート',
        items: [
          { term: '兼用カット', description: 'シート作業レール最上部の「兼用カット」メニューを開き、一覧から切り替えます。＋を押すと追加する兼用カット名を入力でき、チェックまたはEnterで作成します。名前は番号以外も使用できます。登録セルと素材を共有しながら、タイミング、メモ、紙シート画像、修正履歴はカットごとに管理されます。' },
          { term: '兼用カット名の表示', description: '同じ「兼用」メニューの「シートに兼用カット名を表示」をオンにすると、同じグループのほかの兼用カット名をシートと画像出力へ表示します。メニュー下端の削除ボタンで現在のカットを削除できますが、最後に残った1カットは削除できません。' },
          { term: '修正シートを追加', description: 'シート作業レールの履歴欄にある＋から、現在のシートを引き継ぐか、空のシートを追加します。名前を付け、必要なら一つ前のシートを下敷きとして表示します。' },
          { term: '履歴の管理', description: 'シート履歴タブの右クリックメニューから名前変更、編集保護、下敷き表示の切替、削除を行います。保護中のシートは意図しない編集を防ぎます。' },
        ],
      },
    ],
  },
  {
    id: 'timing',
    number: '04',
    title: 'ACTION・CELL入力',
    summary: 'キー入力、範囲編集、記号、フレームの挿入と削除を扱います。',
    sections: [
      {
        title: 'セルへ入力する',
        items: [
          { term: '選択と文字入力', description: 'ACTIONまたはCELLのマスをクリックし、セル名や番号を入力してEnterで確定します。矢印キーで移動し、Shift＋矢印キーで範囲を広げられます。' },
          { term: '範囲選択', description: 'マスをドラッグして同じ欄内の範囲を選びます。列見出しのクリックまたは右クリックメニューでは、そのセル列全体を選べます。' },
          { term: 'キーの移動', description: '入力済みキーをAlt＋ドラッグすると、別のフレームまたは対応するセル列へ移動できます。タッチ操作では長押ししてからドラッグします。' },
          { term: '追加セル列', description: 'CSPレイヤー構成の最下部にある＋から追加すると、既存セル列より上へ自動配置されます。シート上の正確な位置を先に指定する場合は、シート上を右クリックして追加します。作成後はクリックで入力先にし、ラベルのドラッグで位置移動、右クリックで名前とXDTS挿入位置を編集します。' },
        ],
      },
      {
        title: '右クリックと範囲編集',
        items: [
          { term: 'コピー／切り取り／貼り付け', description: '選択範囲を通常貼り付け、挿入貼り付け、選択範囲内へのリピート、末尾までのリピートで再利用します。リップル切り取りは後続のタイミングを前へ詰めます。' },
          { term: 'タイミング記号', description: '右クリックメニューからカラセル、中割記号、逆シート記号を入力できます。選択したキーはDeleteまたはBackspaceで削除します。' },
          { term: 'フレーム挿入・削除', description: '右クリックの「フレームを挿入／削除」で対象フレーム数と対象欄を指定します。「カット全体」では全欄をずらし、尺も同じフレーム数だけ伸縮します。' },
          { term: 'ショートカット貼り付け', description: 'Ctrl+C、Ctrl+X、Ctrl+Vでコピー、切り取り、上書き貼り付けを行います。Ctrl+Shift+Vは選択範囲へのリピート貼り付けです。' },
        ],
      },
    ],
  },
  {
    id: 'sound',
    number: '05',
    title: 'SOUND指示',
    summary: '台詞や音の開始・終了範囲と表示内容を入力します。',
    sections: [
      {
        title: '作成と編集',
        items: [
          { term: '範囲から作成', description: 'SOUND欄をドラッグして範囲を選び、ダブルクリックまたはEnterで編集ダイアログを開きます。話者・ラベルと本文を入力し、Ctrl+Enterで確定できます。' },
          { term: '既存指示を編集', description: '表示されたSOUND指示をダブルクリックするか、選択してEnterで内容を編集します。端のハンドルで開始・終了を調整し、中央をドラッグして範囲ごと移動します。' },
          { term: 'コピーと削除', description: '選択範囲または既存指示を右クリックし、コピー、切り取り、上書き貼り付け、挿入貼り付けを使えます。Deleteで選択中の指示を削除します。' },
          { term: 'XDTS連携', description: 'XDTS読込時にSOUND指示を取り込むか選択できます。書き出し時のSOUND／CAMERAは既定でオフなので、必要な項目だけ書き出し設定でオンにします。名称は適用中のテンプレートへ追従します。' },
        ],
      },
    ],
  },
  {
    id: 'camera',
    number: '06',
    title: 'CAMERA指示',
    summary: '撮影指示の種類、範囲、始点・終点ラベル、配置を編集します。',
    sections: [
      {
        title: '作成と内容',
        items: [
          { term: '範囲から作成', description: 'CAMERA欄をドラッグして範囲を選び、ダブルクリックまたはEnterで編集します。指示名、補足、図形、開始／終了ラベルなどを設定します。' },
          { term: '点・範囲・変化', description: '1フレームの点指示、期間を持つ範囲指示、始点から終点へ変化する指示を用途に応じて使い分けます。' },
          { term: 'タイミング調整', description: '指示の端をドラッグして範囲を伸縮し、中央をドラッグして移動します。ピボットを持つ指示では変化の基準フレームも調整できます。' },
        ],
      },
      {
        title: '表示位置と再利用',
        items: [
          { term: 'ラベル配置', description: '自動配置のほか、ラベル枠をドラッグして手動位置へ移せます。ハンドルで大きさを調整し、Escでドラッグ中の変更を取り消します。' },
          { term: 'コピーと削除', description: '右クリックメニューでコピー、切り取り、上書き貼り付け、挿入貼り付けを行います。Deleteで選択中の指示を削除します。' },
          { term: 'CSPレイヤー構成の撮影指示', description: '左ペインの「撮影指示」はCSPへ渡す補助トラックです。シート上のCAMERAタイミング指示とは用途が異なるため、必要に応じて併用します。' },
        ],
      },
    ],
  },
  {
    id: 'memo',
    number: '07',
    title: 'メモと注釈',
    summary: 'フレームに結び付くメモと、ページ上の自由な注記を使い分けます。',
    sections: [
      {
        title: 'タイムラインメモ',
        items: [
          { term: 'メモを追加', description: 'シート上を右クリックして「メモを追加」を選びます。フレームや範囲、選択したSOUND／CAMERA指示に結び付けて配置できます。' },
          { term: '内容を編集', description: 'メモを選択し、テキスト、手描き、文字色、線幅、文字サイズを編集します。見た目メニューで手描き・文字・背景の不透明度と背景色を調整できます。' },
          { term: '位置と大きさ', description: 'メモ枠をドラッグして移動し、ハンドルで大きさを変更します。メモの右クリックメニューから前面／背面への順序変更と削除ができます。' },
        ],
      },
      {
        title: 'ページ注釈',
        items: [
          { term: 'ペン', description: 'Pキーまたはペンボタンで開始し、シート上をドラッグして描きます。色と線幅を選べます。' },
          { term: 'テキスト', description: 'テキストツールで位置をクリックして入力します。Ctrl+Enterで確定、Escでキャンセルし、既存文字はEnterまたはF2で再編集できます。' },
          { term: '消しゴムと消去', description: '消しゴムで手描きを部分消去します。ごみ箱メニューから現在ページの注釈、または全ページの注釈をまとめて消去できます。' },
          { term: '表示切替', description: 'シート作業レールの「表示設定」にある「注釈」で、内容を削除せず一時的に非表示にできます。' },
        ],
      },
    ],
  },
  {
    id: 'paper',
    number: '08',
    title: '紙シート画像と認識',
    summary: 'スキャン画像をページへ割り当て、補正して下絵として使います。',
    sections: [
      {
        title: '画像の読込とページ割当',
        items: [
          { term: '紙シートを読み込む', description: 'シート作業レールの「紙シート」から「読込」を選びます。複数画像はファイル名順にページへ割り当てられ、必要に応じてページ数と尺が更新されます。' },
          { term: '素材画像を紙シートに使う', description: '右の画像素材で画像を選び、「紙シートとして使用」から下絵へ登録することもできます。' },
          { term: 'ページごとの割当', description: 'ページメニューから、各ページに使う画像の変更または割当解除を行います。紙シート画像はページ単位で保持されます。' },
        ],
      },
      {
        title: '位置・濃度・認識',
        items: [
          { term: '四隅補正', description: '「補正」で拡大ルーペを使って対応点を指定し、必要なら4点自動検出を実行します。変形適用後も四隅を調整でき、リセットで元へ戻せます。' },
          { term: '不透明度とレベル補正', description: '不透明度で下絵の濃さを変えます。レベル補正では黒点、白点、ガンマなどを調整し、薄い線や文字を読みやすくします。' },
          { term: '文字認識（デスクトップ版）', description: '認識対象の欄を選び、全ページを解析します。候補の文字を修正し、個別または「すべて採用」でタイミングへ反映します。OCRは補助機能なので、採用前に必ず結果を確認してください。' },
          { term: 'PWA版でできること', description: '画像の読込、表示、四隅補正、レベル補正、手入力は利用できます。OCRとネイティブファイルパスを必要とする処理はデスクトップ版専用です。' },
        ],
      },
    ],
  },
  {
    id: 'assets',
    number: '09',
    title: '素材・登録セル・CSP構成',
    summary: '画像素材とセルを結び付け、CSPへ渡すレイヤー構成を整えます。',
    sections: [
      {
        title: '画像素材',
        items: [
          { term: 'カットフォルダ', description: '右ペインでカットフォルダを追加または変更します。フォルダをペインへドロップして登録することもでき、フォルダ単位または配下を再帰的に画像素材へ追加できます。' },
          { term: 'ファイルを直接追加', description: '画像ファイルを右ペインへドロップして外部素材として登録できます。単一素材をシートのマスへ直接ドロップすると、素材登録とキー配置を同時に行います。' },
          { term: '選択とプレビュー', description: 'クリックで選択、Ctrl＋クリックで追加／解除、Shift＋クリックで連続選択します。カードから拡大プレビューを開き、登録済みか未登録かを確認できます。' },
          { term: '複数素材の登録', description: '選択した複数素材を既存トラックまたは新しいトラックへまとめて登録できます。セルへ直接置けるのは単一素材です。' },
        ],
      },
      {
        title: '登録セルとCSPレイヤー構成',
        items: [
          { term: '登録先工程', description: 'CSPレイヤー構成で工程名またはその配下の項目を選ぶと、その工程が新規入力キーやシートへ直接ドロップした素材の登録先になります。現在の登録先は工程見出しの印と固定フッターで確認できます。テンプレート側の工程設定では工程名、接尾辞、CSP上の上下順を管理します。' },
          { term: '登録セル', description: 'シート上のキーと画像素材を結び付ける単位です。CSPレイヤー構成でセル名、工程ごとの素材、並び順を確認し、素材未割当のセルも先に作成できます。' },
          { term: 'ペイン下部の操作', description: '対象の行またはカードを選択し、スクロールしても消えない最下部のボタンを使います。左から「一括リネーム」「項目を追加」、右端が選択項目の削除です。削除できない項目ではごみ箱が無効になります。' },
          { term: 'ペインの＋から追加', description: '追加セル列、BG／BOOK、撮影指示、メモ、選択中のセル列に対する登録セルを作成できます。追加セル列は既存セル列より上、BG／BOOKは既存セル列より下かつ既存BG／BOOKより上へ自動配置されます。名前はEnterまたは✓で確定し、Escまたは×で取り消します。' },
          { term: 'シート上から追加', description: 'シート上を右クリックして追加する場合は、シート上の挿入位置を先に選んでから名前を入力します。自動配置ではなく、物理的な位置を明示したいときに使います。' },
          { term: 'ドラッグで並び替え', description: '制作段階、工程、セル列、BG／BOOK、撮影指示、メモの行をドラッグし、同じ階層・種別帯に表示される挿入ラインへドロップします。この順序がCSPへ渡すレイヤーの重ね順になります。' },
          { term: '個別リネーム', description: '制作段階、工程、セル列、BG／BOOK、撮影指示、メモ、CSPセル名は、ペイン内の名前をダブルクリックして編集します。' },
          { term: '一括リネーム', description: '最下部の「一括リネーム」から、登録セル名、CSPセル名、実ファイル名をまとめて正規化できます。実ファイル名の変更を伴うため、実行前に対象と保存場所を確認してください。' },
          { term: 'BG／BOOK・追加セル列のラベル', description: 'シート上では、テンプレートの物理幅に収まる限り名前を文字数で省略せず表示します。ラベル同士の重なりは上下へ自動で逃がされ、支柱が実際の挿入位置を示します。ラベルをドラッグすると位置を変更できます。' },
          { term: '削除と元に戻す', description: '登録セルや追加セル列を削除すると、使用中のキーや素材割当も対象になる場合があります。確認内容を確認して実行してください。追加、並び替え、名前変更、削除は上部の元に戻す、またはCtrl＋Zで戻せます。' },
        ],
      },
    ],
  },
  {
    id: 'view',
    number: '10',
    title: '表示・移動・ページ',
    summary: 'ページの並べ方、倍率、描画レイヤーを作業に合わせます。',
    sections: [
      {
        title: 'ページと倍率',
        items: [
          { term: '表示方式', description: '単ページ、連続、見開きから選びます。単ページ表示ではページボタンから表示ページを切り替えます。' },
          { term: '倍率', description: '倍率スライダー、100%、全体表示を使います。Ctrl＋ホイールでポインター位置を中心に拡大縮小し、Zキーでホイールをズーム専用に切り替えられます。' },
          { term: 'スクロールと表示移動', description: 'ホイールで縦、Shift＋ホイールで横へスクロールします。Space＋ドラッグまたは中ボタンドラッグでシート表示を移動します。' },
        ],
      },
      {
        title: '描画レイヤーとテンプレート',
        items: [
          { term: '描画レイヤー', description: '紙シート画像、テンプレート罫線、テンプレート文字、入力内容、ACTION／CELLの継続表示、注釈を個別に表示・非表示にします。' },
          { term: '表示テンプレート', description: 'シート作業レールの「表示設定」で、プロジェクトに適用する表示様式を選びます。テンプレート変更は欄の位置、ページ寸法、印刷表現に影響します。' },
          { term: '左右ペイン', description: 'ペイン表示ボタンでCSPレイヤー構成と画像素材の表示を切り替え、中央シートの作業領域を広げられます。' },
        ],
      },
    ],
  },
  {
    id: 'template',
    number: '11',
    title: 'シートテンプレート',
    summary: '紙用・デジタル用のシート様式、欄、罫線、工程を編集します。',
    sections: [
      {
        title: 'テンプレートを用意する',
        items: [
          { term: '新しいテンプレート', description: '紙タイムシートまたはデジタルタイムシートを選びます。紙用は用紙、向き、PPI、参照画像、デジタル用はFPS、初期フレーム数、CELLトラック数を設定します。' },
          { term: '作成元', description: '紙画像、A3標準、デジタル標準、現在のテンプレートの複製から下書きを作れます。組み込みテンプレートは保護され、編集すると複製として扱われます。' },
          { term: '読込と書き出し', description: 'テンプレートJSONを読み込み、現在の下書きをJSONとして保存できます。プロジェクトメニューの読込／書き出しからも同じ形式を扱えます。' },
        ],
      },
      {
        title: 'レイアウトを編集する',
        items: [
          { term: '領域', description: '情報欄、入力表、ACTION、SOUND、CELL、CAMERA、入力を受けない補助罫線を追加し、キャンバス上のドラッグまたは数値で位置と大きさを調整します。' },
          { term: '詳細設定', description: '領域の列数、トラック名、行・列罫線、文字、情報欄の割当、メモ対象、補正基準枠、ページ寸法、見出し表示を編集します。' },
          { term: '参照画像と補正枠', description: '紙テンプレートの基準画像を読み込み、画像密度を確認しながら欄を合わせます。補正基準枠はグリッド外周、標準位置、手動数値から設定できます。' },
          { term: '工程設定', description: '登録工程の追加、名称、ファイル名接尾辞、CSP上の上下順を編集します。一番下の工程が素材を直接登録したときの既定先です。' },
          { term: '適用と取消', description: '編集内容は下書きとして保持されます。「変更を適用」でシートへ反映し、「変更を取り消す」で適用中のテンプレートへ戻します。' },
        ],
      },
    ],
  },
  {
    id: 'io',
    number: '12',
    title: '読み込みと書き出し',
    summary: 'XDTS、画像、PSD、CSP自動登録データを用途別に出力します。',
    sections: [
      {
        title: '外部データを読み込む',
        items: [
          { term: 'XDTS', description: 'XDTSのキーをACTIONまたはCELLのどちらへ取り込むか選び、必要に応じてSOUND／CAMERA指示も読み込みます。既存内容への影響をダイアログで確認してから確定します。' },
          { term: 'シートテンプレートJSON', description: '検証済みのテンプレートを現在のプロジェクトへ適用します。現在の欄構成と合わない場合は、適用後に表示とトラック対応を確認してください。' },
        ],
      },
      {
        title: '書き出し形式',
        items: [
          { term: 'JPG／PNG', description: '確認・共有用の1枚画像としてページごとに書き出します。紙シート画像、テンプレート画像、アプリ描画を含めるか選択できます。' },
          { term: 'PSD', description: '編集用にレイヤーを保ったタイムシート画像を書き出します。出力レイヤーの選択は画像書き出しダイアログで行います。' },
          { term: 'XDTS', description: 'タイミングを対応ソフトへ渡す交換形式です。SOUND／CAMERA指示は既定で書き出さず、必要な場合だけオンにします。項目名はテンプレートに追従し、指定がなければSOUND／CAMERAを使います。' },
          { term: 'CSP自動登録データ', description: '書き出し前に出力先、XDTS、画像付き／キーのみの件数を表示します。画像なしは通常のキーのみ登録として扱います。デスクトップ版ではカットフォルダ内のxsheet-csp-importへcsp-import.xciとXDTSを安全に更新し、csp-import.xciを同梱のxsheet-importerで選択またはドロップします。' },
          { term: 'シートテンプレートJSON', description: '現在適用中のテンプレートを別プロジェクトで再利用できるJSONとして保存します。' },
        ],
      },
      {
        title: 'デスクトップ版とPWA版',
        items: [
          { term: 'デスクトップ版', description: '通常の保存では保存先を選べます。CSP自動登録データだけはカットフォルダ内のxsheet-csp-importへ固定して書き込み、過去の同フォルダを安全に置き換えます。素材のネイティブパス、OCR、実ファイル参照を利用できます。' },
          { term: 'PWA版', description: 'プロジェクトや出力物はブラウザのダウンロードとして保存されます。CSP自動登録データは取得できた画像素材を含むZIPになり、展開後のcsp-import.xciをxsheet-importerで使います。OCRとネイティブパス前提の処理は利用できません。' },
        ],
      },
    ],
  },
  {
    id: 'shortcuts',
    number: '13',
    title: 'ショートカットと困ったとき',
    summary: '頻繁に使うキー操作と、安全に確認するための要点をまとめます。',
    sections: [
      {
        title: '主なキーボード操作',
        items: [
          { term: 'Ctrl+Z／Ctrl+Y', description: '元に戻す／やり直し。タイミング入力のほか、CSPレイヤー構成での追加、並び替え、名前変更、削除にも使えます。' },
          { term: 'Ctrl+C／Ctrl+X／Ctrl+V', description: '選択範囲または選択テキスト注釈をコピー／切り取り／上書き貼り付け。Ctrl+Shift+Vはタイミングのリピート貼り付け。' },
          { term: '矢印／Shift+矢印', description: '選択セルの移動／範囲の拡張。' },
          { term: 'Enter／F2', description: 'タイミング入力の確定、または選択したテキスト注釈や指示の編集開始。ダイアログやテキスト入力ではCtrl+Enterが確定に使われます。' },
          { term: 'Delete／Backspace', description: '選択したキー、指示、テキスト注釈を削除。文字入力途中のBackspaceは入力文字を1文字戻します。' },
          { term: 'P／Z／Esc', description: 'ペンツール／ホイールズームモードの切替／現在の入力やドラッグ、ツール、メニューの終了・取消。' },
          { term: 'Space+ドラッグ／中ボタン', description: 'シート表示の移動。Ctrl+ホイールで拡大縮小、Shift+ホイールで横スクロール。' },
        ],
      },
      {
        title: '確認ポイント',
        items: [
          { term: '保存できない', description: 'デスクトップ版では保存先の書込権限、PWA版ではブラウザのダウンロード設定を確認します。別名保存を試すと保存先を選び直せます。' },
          { term: '素材が見つからない', description: '別PCや移動後のフォルダでプロジェクトを開いた場合は、右ペインまたはCSP自動登録の確認画面で、同じ素材一式が入ったカットフォルダを選び直します。相対位置が変わっていても内容が同じ素材を再接続し、見つからない素材だけをキーのみ登録として表示します。' },
          { term: '紙シートがずれる', description: 'ページに正しい画像が割り当てられているか、テンプレートとスキャンdpi／PPIが合っているかを確認し、四隅補正をやり直します。' },
          { term: '入力できない', description: '修正シートが保護されていないか、注釈・補正ツールが選択中でないか、追加セル列では目的の列が入力先になっているかを確認します。' },
          { term: '書き出し前の確認', description: 'カット情報と尺、全ページ、修正シート、CSPセル名、紙シートを出力へ含める設定を確認します。CSP自動登録では確認画面の出力先と画像付き／キーのみ件数を確認し、画像を付けない運用はそのまま許容します。' },
        ],
      },
    ],
  },
]

export function EditorDetailedHelp() {
  const [activeChapterId, setActiveChapterId] = useState(editorHelpChapters[0].id)
  const activeChapterIndex = Math.max(0, editorHelpChapters.findIndex(chapter => chapter.id === activeChapterId))
  const activeChapter = editorHelpChapters[activeChapterIndex]

  function selectChapter(index: number) {
    const chapter = editorHelpChapters[index]
    if (chapter) setActiveChapterId(chapter.id)
  }

  return (
    <div className="editorHelpManual">
      <aside className="editorHelpToc">
        <div className="editorHelpTocIntro">
          <strong>詳しい使い方</strong>
          <span>全{editorHelpChapters.length}章</span>
        </div>
        <nav aria-label="詳しい使い方の目次">
          {editorHelpChapters.map(chapter => (
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

      <article key={activeChapter.id} className="editorHelpChapter" aria-labelledby={`editor-help-${activeChapter.id}`}>
        <header>
          <span>CHAPTER {activeChapter.number}</span>
          <h2 id={`editor-help-${activeChapter.id}`}>{activeChapter.title}</h2>
          <p>{activeChapter.summary}</p>
        </header>

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
          <span>{activeChapterIndex + 1} / {editorHelpChapters.length}</span>
          <button type="button" disabled={activeChapterIndex === editorHelpChapters.length - 1} onClick={() => selectChapter(activeChapterIndex + 1)}>
            次の章 →
          </button>
        </footer>
      </article>
    </div>
  )
}
