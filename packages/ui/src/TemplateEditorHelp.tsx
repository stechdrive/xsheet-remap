import { useState } from 'react'
import { ChapteredHelp, type HelpChapter } from './ChapteredHelp'

const templateHelpChapters: HelpChapter[] = [
  {
    id: 'start',
    number: '01',
    title: '作り方を選ぶ',
    summary: '作りたいシートに最も近い入口を選ぶと、配置を作り直す手間を減らせます。',
    sections: [
      {
        title: '開始画面の選び方',
        items: [
          { term: 'A3標準を調整', description: '一般的な紙タイムシートに近いものを作る入口です。標準配置を土台に、見出しや欄の位置だけを変えたいときに向いています。' },
          { term: '参照画像から作成', description: '手元の紙タイムシート画像を下敷きにして、罫線や入力範囲を合わせます。画像の密度情報を確認し、実際に使うスキャン画像と同じ大きさで作ると補正結果を合わせやすくなります。' },
          { term: 'デジタル標準から作成', description: '印刷用紙の大きさに縛られず、必要な尺や列数に応じて横幅が広がるシートを作ります。最初にFPS、フレーム数、セル列数を決めます。' },
          { term: '既存JSONを開く', description: '以前保存したテンプレートや受け取ったテンプレートを直すときに選びます。現在の配置と設定を保ったまま続きから編集できます。' },
          { term: '下書きを復元', description: '前回、保存せずに終了した編集があると表示されます。続けるなら復元し、不要なら破棄して新しく始めます。' },
        ],
      },
      {
        title: '最初に決めること',
        items: [
          { term: '紙かデジタルか', description: '紙の画像や印刷寸法に合わせるなら紙、尺や列数に応じてシートを伸ばしたいならデジタルを選びます。' },
          { term: '名前と識別用ID', description: '利用者に見せる名前を分かりやすくします。識別用IDは、別のテンプレートとして配布・併用したいときだけ既存のものと重ならない値にします。' },
          { term: '紙の補正基準', description: 'スキャンをまっすぐに補正して使う場合は、実際の用紙で四隅を見つけやすい外枠を補正基準にします。' },
        ],
      },
    ],
  },
  {
    id: 'screen',
    number: '02',
    title: '画面構成と下書き',
    summary: 'ヘッダー、上部ツールバー、キャンバス、設定パネル、ステータスの役割を説明します。',
    sections: [
      {
        title: 'アプリ全体',
        items: [
          { term: '開始画面', description: 'A3標準、参照画像、デジタル、既存JSONの4つの入口を表示します。未保存の下書きがあれば復元できます。' },
          { term: '上部ツールバー', description: '未保存状態、開始画面へ戻る、新規作成、JSON読込・保存、完成前確認、領域追加、倍率をまとめています。' },
          { term: '左の領域一覧', description: '領域の選択、表示／非表示、位置固定、複製、前面／背面、削除を管理します。' },
          { term: '中央キャンバス', description: '参照画像、罫線、見出し、領域を重ねた仕上がりプレビューです。ポインター下の領域が薄く強調され、クリックで編集対象になります。' },
          { term: '右のタスクナビゲーション', description: '「テンプレートを編集」には「基本設定」「領域」「見た目」と、紙の場合だけ「参照画像」が常に表示されます。「確認とデータ」には「確認・保存」「JSON」が表示されます。目的のボタンを直接押してください。' },
          { term: 'ステータスバー', description: '左下に現在のテンプレート名、右下にページのピクセル寸法が表示されます。' },
        ],
      },
      {
        title: 'このアプリで作れるもの',
        items: [
          { term: '保存されるもの', description: '用紙、領域、固定文字、入力項目、表示するカット情報、罫線、配色など、繰り返し使えるシートのひな形をJSONへ保存します。' },
          { term: 'プロジェクトごとに決めるもの', description: '実際のカット内容、素材、作画・演出・監督などの工程はここでは入力しません。保存したテンプレートをEditorまたはRemapで使い、プロジェクトごとに設定します。' },
        ],
      },
      {
        title: '下書きの状態',
        items: [
          { term: '標準テンプレ保護中', description: '組み込みテンプレートは直接上書きされません。最初の編集でカスタム複製として扱われます。' },
          { term: '未保存の変更', description: '最後の保存後に編集があります。別のテンプレートへ移る操作やアプリ終了時には破棄確認が表示され、下書きは自動復旧用にも保持されます。' },
          { term: '保存済み', description: '現在の下書きがJSONへ保存された状態です。さらに編集すると「未保存の変更」へ戻ります。' },
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
          { term: '紙タイムシート', description: '用紙サイズと向きから、PPIに応じた実ピクセル数を作ります。参照画像は任意で、同一PPIなら拡大縮小せず中央配置し、用紙からはみ出す部分だけを切り取ります。' },
          { term: 'デジタルタイムシート', description: 'FPS、初期フレーム数、ACTIONとCELLで共有するセル列数から連続キャンバスを作ります。後からセル列やSOUND・CAMERAレーンを増やすと横幅も追従します。' },
          { term: '現在から複製', description: 'いま編集中の配置と設定をそのまま引き継ぎ、別ID・別名の下書きを作ります。未保存の編集内容も複製へ含まれます。' },
        ],
      },
      {
        title: '開始画面と読込',
        items: [
          { term: '紙画像から作成', description: '選択した画像のサイズと密度情報を読み、参照画像付きの紙テンプレート下書きを作ります。' },
          { term: 'A3標準から作成', description: '現在のA3標準構成を作成元にします。紙の標準レイアウトを少し変える場合に適しています。' },
          { term: 'デジタル標準から作成', description: 'デジタル用の情報欄、メモ、ACTION、SOUND、CELL、CAMERAを備えた下書きを作ります。' },
          { term: '既存JSONを開く', description: '保存済みテンプレートの続きから編集します。編集中に別JSONを開く場合、未保存の変更があれば破棄確認が表示されます。' },
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
          { term: '辺とハンドルをドラッグ', description: '左・右・上・下の辺をそれぞれ動かし、領域の大きさと位置をピクセル境界へ揃えます。下の読み出しにX・Y・W・H・R・Bが表示されます。' },
          { term: '数値で仕上げ', description: '領域の詳細にあるX・Y・W・Hは実ピクセル単位です。元画像の罫線位置がわかる場合は数値入力が確実です。' },
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
    summary: '領域の名前、紙に印刷する文字、実データ、入力画面の名前を混同せずに設定します。',
    sections: [
      {
        title: '4種類の名前と文字',
        introduction: '領域の詳細では、次の4つを別々に設定します。変更したい場所に合う項目を選んでください。',
        items: [
          { term: '編集画面での名前', description: '領域を探すための管理名です。左の一覧、右の領域カード、詳細の見出しに使われ、完成したシートには印刷されません。例:「カット情報見出し」。' },
          { term: 'シート上の表示文字', description: '完成したシートへそのまま印刷・表示する固定文字です。TITLE、NO.、CUTなどを変えたいときは、領域の詳細にある「シート上の表示」を編集します。' },
          { term: '表示する情報', description: 'タイトル、話数、カット番号、尺など、Editor・Remapで扱う実データの割当です。シートごとに値が変わり、TITLEなどの固定文字とは別です。' },
          { term: '入力画面での項目名', description: '利用者が値を入力するときに、入力欄やポップアップへ表示される案内名です。入力表の領域で設定し、紙に印刷する固定見出しとは別にできます。' },
        ],
      },
      {
        title: '情報欄',
        items: [
          { term: '追加と割当', description: '「＋ 領域」の情報欄は、まだ使われていない作品名・話数・シーン・カット・尺・作業者名・ページ数などを順に割り当てます。「領域一覧」で別項目へ変更できます。' },
          { term: '文字レイアウト', description: '領域の詳細で文字サイズ、最小文字、行間、内余白を設定します。横・縦の欄外表示も選べます。' },
          { term: 'カット番号プレフィックス', description: '「基本設定」で保存名に付ける接頭辞を指定します。「数字カットだけ」をオンにするとOPなどの文字カットには付加しません。' },
        ],
      },
      {
        title: '入力表',
        items: [
          { term: '初期構成', description: '「入力表を追加」は、2つの項目名とその入力欄を持つ2列の表を作ります。領域の外枠と欄は仕上がりに描画されます。' },
          { term: '編集方法', description: '選択した入力欄ごとに「その場で入力」または「ポップアップ」を選びます。長文ならその場で入力、狭い欄ならポップアップが向いています。' },
          { term: '値の種類と共有範囲', description: '1行テキスト、複数行、数値、オン／オフ、選択肢、日付、尺から入力方法を選び、作品全体・カット・シート版・ページのどこで値を共有するかを設定します。用途が同じ欄は同じ範囲を選ぶと、ページをまたいでも入力し直さずに済みます。' },
          { term: '選択肢', description: '値の種類を「選択肢」にすると、候補を1行に1つずつ入力できます。入力画面ではその候補から選びます。' },
          { term: '未入力欄の初期値', description: '任意項目では、まだ値が保存されていない欄へ表示する初期値を設定できます。既存の入力値は上書きせず、値の種類や選択肢を変えて不正になった初期値は自動的に解除されます。' },
          { term: 'メモ対象', description: '「この欄」「表全体」「同じグループ」「メモ対象外」から選びます。グループは共通ID、各対象は任意の表示名を持てます。' },
          { term: '文字と自動縮小', description: '入力欄ごとに文字、最小文字、行間、内余白を設定します。複数行フィールドは、欄内に収まる範囲での自動縮小を切り替えられます。' },
          { term: '手書き注釈欄', description: '注釈欄は文字入力欄ではなく、手書きメモの対象範囲です。注釈レイヤーIDと用途を設定し、文字入力方法や文字サイズは設定しません。' },
        ],
      },
      {
        title: '表示する情報を結び付ける',
        items: [
          { term: '作品・カット情報', description: '作品名、話数、シーン、カット番号、尺、作業者名、ページ数など、シートごとに変わる値を表示したい領域へ割り当てます。標準項目にない情報は、同じ識別名を使う入力欄と結び付けられます。' },
          { term: '結合カットの表示', description: '複数カットを1枚で扱うときは、先頭・区切り・末尾のどの位置に表示する情報かを選びます。単独カット用なら通常の表示を選びます。' },
          { term: 'タイミング欄の役割', description: 'ACTION、SOUND、CELL、CAMERAのどの記入欄として使うかを選びます。同じ役割を複数箇所へ置く場合は、必要に応じて区別用のセクションIDをそろえます。' },
          { term: '標準情報との連動', description: '入力した値をタイトルやカット番号などの標準情報としても使いたい場合に選びます。用途を変えると既存データの見え方も変わるため、EditorまたはRemapで入力済みのテストデータを確認してください。' },
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
          { term: 'ACTION', description: '原画工程でタイミング指示を記入する欄です。CELLと同じセル列を共有するため、列名・順序・列数は常に一致します。' },
          { term: 'SOUND', description: '台詞やSEなどの音響指示を、開始から終了までの区間として記入する欄です。「見た目」で初期列名と列名表示を決め、開いた領域の「フレームと列」で初期列数を変更します。' },
          { term: 'CELL', description: '動画工程で動画番号とタイミングを記入する欄です。ACTIONと同じセル列を、動画用の記入欄として表示します。' },
          { term: 'CAMERA', description: 'カメラワークや撮影指示を、指定フレームの区間に記入する欄です。テンプレートでは初期列数・初期列名・列名表示を決め、実際のプロジェクトでは列見出しの右クリックから管理します。デジタルではSOUNDと同様に実際のレーン数に合わせて横方向へ増やせます。' },
        ],
      },
      {
        title: '行・列・開始フレーム',
        items: [
          { term: '開始F', description: '領域が担当する最初のフレームです。紙の左右ページや分割領域で開始位置をずらすときに使います。' },
          { term: '行数', description: 'その領域に描画するフレーム行の数です。紙では印刷面に収まる数、デジタルでは初期フレーム数と整合させます。' },
          { term: '列数', description: '紙は領域ごとに表示できる列数を設定し、入り切らないセル列はEditor・Remap側で欄外扱いになります。デジタルのACTIONとCELLは共有セル列数を一括変更し、片方だけ異なる列数にはできません。' },
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
          { term: '行数と列数', description: '領域の詳細にある補助罫線設定で、1〜64列と必要な行数を指定します。' },
          { term: '線の設定', description: '横罫線と縦罫線をそれぞれ無し・実線・破線・点線から選び、線幅、線色、外枠の有無を設定します。' },
        ],
      },
      {
        title: '用紙全体の配色',
        items: [
          { term: 'テーマ', description: 'まず用途に近い配色を選びます。個別の色を変更するとカスタムとして扱われるため、完成形を見ながら必要な箇所だけ調整できます。' },
          { term: '用紙色と背景帯', description: '用紙全体の色に加え、秒や一定区間を見分ける2種類目の背景帯の色と濃さを設定できます。記入内容より目立たない濃さにすると読みやすくなります。' },
          { term: '文字・参照線・罫線', description: '通常文字、フレーム番号などの参照表示、基本の罫線をまとめて調整します。印刷する場合は、薄い線が消えないかを実際の出力で確認してください。' },
          { term: 'SOUND・CAMERA', description: '列を見分けやすくするため、奇数列と偶数列の背景、線、文字を個別に設定できます。通常時とポインターを重ねたときの背景の濃さも調整できます。' },
        ],
      },
      {
        title: '見出しと列名',
        items: [
          { term: '下端セル列名', description: '紙テンプレートのグリッド下端に、セル列名を表示するか切り替えます。デジタルにはこの項目は表示されません。' },
          { term: 'ヘッダー見出し', description: 'ACTION・SOUND・CELL・CAMERAごとに上部見出しの文字を指定します。空欄にするとその見出しだけを非表示にできます。' },
          { term: '列名を表示', description: '各欄の列名をシート上へ描くかを役割ごとに切り替えます。非表示にしても列名と入力内容は保持されます。' },
          { term: 'SOUND・CAMERA初期列名', description: 'このテンプレートから新しいプロジェクトを作るときの初期値です。A3の左右欄のように同じレーンを複数箇所へ描く場合は、同じ初期列名が全箇所へ反映されます。既存プロジェクトの列名はテンプレートを切り替えても上書きされません。' },
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
          { term: '読込と解除', description: '紙テンプレートの「参照画像」で画像を読み込み、不要な場合は解除します。読み込んだ画像はテンプレートJSONへ埋め込まれます。' },
          { term: '元画像情報', description: '画像名、ピクセル寸法、PPI、ピクセル等倍・中央配置のオフセットを確認できます。テンプレートPPIと一致しないと警告されます。' },
          { term: '画像とアプリ描画', description: '参照画像の罫線に合わせて、アプリ描画の入力領域とクリック範囲を作ります。画像自体の文字とアプリのラベルが二重になっていないかも確認します。' },
        ],
      },
      {
        title: '補正基準枠',
        items: [
          { term: '編集対象にする', description: '「基本設定」の補正基準枠にあるボタンを押すと、キャンバス上の枠をドラッグまたはX・Y・W・Hで編集できます。' },
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
    title: '右のタスクナビゲーション',
    summary: '目的別のボタンと、「領域」から詳細を開いて戻る流れをまとめます。',
    sections: [
      {
        title: 'テンプレートを編集',
        items: [
          { term: '基本設定', description: 'テンプレート全体のID・名前・用紙・FPS・初期フレーム数などを編集します。領域ごとの内容はここでは変更しません。' },
          { term: '領域', description: 'すべての領域を縦のカードで確認します。管理名、種類、目的、現在の表示内容を手掛かりに、編集したい1件を開きます。' },
          { term: '領域の詳細', description: 'カードの「編集する」またはキャンバス上の領域を押すと開きます。名前と役割、固定文字、動的データ、入力項目、行列、配置、文字の見た目を縦に編集します。' },
          { term: '領域一覧へ戻る', description: '詳細の一番上にある「← 領域一覧へ」を押すとカード一覧へ戻ります。別の領域へ進むときの戻り道です。' },
          { term: '見た目', description: '用紙色、罫線、複数領域に共通するタイムライン見出しや初期列名を編集します。領域ごとの固定文字は各領域の詳細で変更します。' },
          { term: '参照画像', description: '紙テンプレートでだけ表示されます。元画像の読込、配置、PPIを確認します。' },
        ],
      },
      {
        title: '確認とデータ',
        items: [
          { term: '確認・保存', description: 'ID、名前、入力領域、ページ内配置、参照画像PPI、補正基準枠を検査します。問題から対象領域の詳細を直接開けます。' },
          { term: 'JSON', description: '現在の下書きに保存される内容を確認する読み取り専用表示です。ここへ直接入力はできないため、変更したい内容に対応する設定画面へ戻ります。' },
        ],
      },
    ],
  },
  {
    id: 'save',
    number: '10',
    title: '確認・保存・利用',
    summary: '編集中の下書きを検査し、JSONとして保存し、Editor・Remapで使います。',
    sections: [
      {
        title: '確認と保存',
        items: [
          { term: '確認', description: '保存できないエラーと、実機で確認すべき注意を一覧化します。対象領域がある問題はその領域へ移動できます。' },
          { term: '確認して保存', description: '検査を通った現在の下書きを、他のアプリで読み込めるJSONとして保存します。成功すると「保存済み」へ変わります。' },
          { term: '未保存保護', description: '別テンプレートへ移る操作と終了時に確認し、編集中の下書きは次回起動時に復元できます。' },
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
    number: '11',
    title: '困ったとき・制限事項',
    summary: 'データを失わずに戻る方法と、現状の編集UIで注意する点をまとめます。',
    sections: [
      {
        title: 'よくある状態',
        items: [
          { term: '不要な領域を削除したい', description: '左の領域一覧で該当領域の「削除」を押します。必要なら先に「複製」し、重なり順も同じ場所で調整できます。' },
          { term: '元画像と罫線が合わない', description: '用紙サイズ、向き、ピクセル数、PPI、参照画像の元サイズと配置オフセットを確認します。100%と800%以上の両方で罫線境界を比較します。' },
          { term: '文字が切れる', description: '文字サイズ、最小文字、行間、内余白、自動縮小、欄外表示を確認します。見た目だけでなくEditor・Remapで実文字を入力して確認します。' },
          { term: 'デジタルの横幅が変わった', description: '必要なACTION・CELL列とSOUND・CAMERA列をすべて見せるため、列数に合わせてシートが横へ広がります。「全体表示」へ戻し、情報欄、メモ、タイミング欄の右端が揃っているかを確認します。' },
          { term: '未保存内容を戻したい', description: '次回起動時の開始画面に「下書きを復元」が表示されます。不要なら「破棄」を選びます。' },
        ],
      },
    ],
  },
]

export function TemplateEditorHelpDialog({ onClose }: { onClose: () => void }) {
  const [helpView, setHelpView] = useState<'quick' | 'detailed'>('quick')

  return (
    <div className="appHelpBackdrop" role="dialog" aria-modal="true" aria-label="xsheet-templateの使い方">
      <section className="appHelpDialog appHelpDialogTabbed templateEditorHelpDialog">
        <header>
          <div>
            <strong>xsheet-template ヘルプ</strong>
            <span>{helpView === 'quick' ? '使えるテンプレートJSONを最短で作る順番です。' : '目的から探せるように、すべての設定と操作を章別に説明します。'}</span>
          </div>
          <button type="button" onClick={onClose}>閉じる</button>
        </header>

        <div className="appHelpTabs" role="tablist" aria-label="ヘルプの種類">
          <button type="button" role="tab" aria-selected={helpView === 'quick'} className={helpView === 'quick' ? 'active' : ''} onClick={() => setHelpView('quick')}>
            クイックガイド
          </button>
          <button type="button" role="tab" aria-selected={helpView === 'detailed'} className={helpView === 'detailed' ? 'active' : ''} onClick={() => setHelpView('detailed')}>
            詳しい使い方
          </button>
        </div>

        <div className={`appHelpBody ${helpView === 'detailed' ? 'appHelpBodyDetailed' : 'templateHelpQuickBody'}`}>
          {helpView === 'quick' ? <TemplateEditorQuickGuide /> : <TemplateEditorDetailedHelp />}
        </div>
        <footer>
          <p>{helpView === 'quick' ? '迷ったら、作りたいシートに最も近い標準形から始めてください。' : '保存後はEditorまたはRemapで、実際の入力と表示を一度確認してください。'}</p>
        </footer>
      </section>
    </div>
  )
}

function TemplateEditorQuickGuide() {
  const steps = [
    { title: '近い作り方を選ぶ', description: '紙の標準形なら「A3標準を調整」、手元の用紙に合わせるなら「参照画像から作成」、可変幅なら「デジタル標準から作成」、続きの編集なら「既存JSONを開く」を選びます。' },
    { title: 'キャンバスで違いを直す', description: '右の「領域」またはキャンバス上の欄を開き、見出し、入力欄、タイミング欄の位置と大きさを実物に合わせます。' },
    { title: '入力とタイミング欄を決める', description: '各欄で、表示するカット情報、入力方法、ACTION・SOUND・CELL・CAMERAの役割、開始フレームと列数を設定します。' },
    { title: '見た目と紙の基準を合わせる', description: '「見た目」で色・罫線・列名を整えます。紙の場合は「参照画像」と「基本設定」の補正基準枠を、実際の用紙に合わせます。' },
    { title: '確認してJSONを保存する', description: '「確認・保存」で指摘を解消し、「確認して保存」を押します。保存したJSONをEditorまたはRemapで読み込み、入力範囲と最初・最後のフレームを確認すれば完成です。' },
  ]

  return (
    <div className="templateHelpQuickGuide">
      <header>
        <span>QUICK GUIDE</span>
        <h2>最短でテンプレートを完成させる</h2>
        <p>完成すると、同じレイアウトと入力方法をEditor・Remapで繰り返し使えるテンプレートJSONが得られます。</p>
      </header>
      <section className="templateHelpSteps" aria-label="テンプレート完成までの手順">
        <ol>
          {steps.map((step, index) => (
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
      <aside>
        <strong>完成の目安</strong>
        <p>固定文字が二重にならず、クリックできる範囲が罫線と合い、保存したJSONを読み直しても同じ配置と列数になることを確認します。</p>
      </aside>
    </div>
  )
}

export function TemplateEditorDetailedHelp() {
  return (
    <ChapteredHelp
      chapters={templateHelpChapters}
      tocTitle="テンプレートの全機能"
      navigationLabel="xsheet-templateの詳しい使い方の目次"
      idPrefix="template-help"
      className="templateHelpManual"
    />
  )
}
