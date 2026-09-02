import { ChapteredHelp, type HelpChapter } from './ChapteredHelp'
import { editorHelpChapters } from './EditorDetailedHelp'

export const remapHelpChapters: HelpChapter[] = editorHelpChapters.map(chapter => {
  if (chapter.id === 'screen') {
    return {
      ...chapter,
      summary: 'タイムシート、必要に応じて使う紙・作画素材、CSPレイヤー構成を同じ画面で照合します。',
      sections: [
        {
          title: '上部の操作',
          items: [
            { term: '画面切替メニュー', description: '新規作成、.xsrの読込・保存、XDTSやテンプレートの読込、画像・XDTS・After Effects・CSP向けデータの書き出しを開きます。' },
            { term: 'カット情報', description: '作品名、話数、シーン、カット番号、作業者、尺を整えます。入力内容とページ数、書き出し名の基準になるため、素材を割り付ける前に確認します。' },
            { term: '元に戻す・やり直し・ヘルプ', description: '直前の編集を戻す／やり直す操作と、このクイックガイド・詳しい使い方を開きます。' },
          ],
        },
        {
          title: '照合作業の3領域',
          items: [
            { term: '左：CSPレイヤー構成', description: '工程、登録セル、BG／BOOK、撮影指示、メモをCSPへ積む順番で確認します。Remapでは初回から開いているため、素材を置く前に登録先工程を選べます。' },
            { term: '中央：タイムシート', description: '紙シートを下絵にしながら、ACTION・CELLのキー、SOUND・CAMERA指示、メモ・注釈を確認して修正します。左端のシート作業レールから紙シート、認識、表示、ページを操作します。' },
            { term: '右：画像素材', description: 'カットフォルダや画像を追加し、サムネイルと拡大表示で内容を確かめてから、シートのキーまたは左の登録先へ割り付けます。' },
            { term: '左右ペインの開閉', description: '中央シートの左右端にある細いボタンで開閉し、境界をドラッグして幅を変えます。開閉状態と幅はRemap用として次回も復元されます。' },
            { term: '下部ステータス', description: '現在ポインターがある場所や選択対象に対して、いま使える操作を短く表示します。ドロップ先に迷ったときに確認してください。' },
          ],
        },
      ],
    }
  }

  if (chapter.id === 'project') {
    return {
      ...chapter,
      sections: chapter.sections.map(section => ({
        ...section,
        items: section.items.map(item => {
          if (item.term === '名前を付けて保存') return { ...item, description: '現在の照合結果を別名または別の場所へ.xsrとして保存します。元のプロジェクトを残して別案を作るときに使います。' }
          if (item.term === '次回起動時の状態') return { ...item, description: 'ウィンドウの大きさ・最大化状態、左右ペインの開閉と幅、最後に選んだ組み込み表示テンプレートをRemap用として記憶します。' }
          return item
        }),
      })),
    }
  }

  if (chapter.id === 'timing') {
    return {
      ...chapter,
      summary: '原画側はACTION、動画・セル番号側はCELLを使い、キーや範囲を迷わず修正します。',
      sections: chapter.sections.map(section => ({
        ...section,
        items: section.items.map(item => {
          if (item.term === 'ACTIONとCELLの共通列') {
            return {
              ...item,
              description: 'ACTIONとCELLは同じ列名・並び順・列数を使います。列を追加、名前変更、削除すると両方へ反映されますが、入力したタイミングはACTIONとCELLで別々に保持されます。原画側の確認はACTION、動画・セル番号側の確認はCELLを選びます。',
            }
          }
          if (item.term === '追加セル列') {
            return {
              ...item,
              description: '左のCSPレイヤー構成にある＋で追加すると既存列の上へ、シート上の右クリックから追加すると選んだ列の後ろへ入ります。紙に収まらない列も削除されず欄外ラベルで確認でき、デジタル表示へ切り替えると通常の列として表示されます。',
            }
          }
          return item
        }),
      })),
    }
  }

  if (chapter.id === 'sound') {
    return {
      ...chapter,
      title: 'SOUND指示',
      summary: '台詞・SEなどの区間を作り、複数のSOUND列を使い分けます。',
      sections: chapter.sections.slice(0, 1),
    }
  }

  if (chapter.id === 'memo') {
    return {
      ...chapter,
      summary: '用紙のメモ欄、フレームに付くメモ、自由注釈、CSPへ渡すメモ素材を目的で使い分けます。',
      sections: [
        {
          title: 'シートに残すメモ',
          items: [
            { term: '用紙のメモ欄', description: 'テンプレートにMEMOや備考などの入力欄がある場合は、その欄をダブルクリックするか選択してEnterを押し、文章を入力します。ページごとの申し送りを、決められた欄へ読みやすく残したいときに使います。' },
            { term: 'タイムラインメモ', description: '対象フレーム、範囲、SOUND／CAMERA指示を右クリックまたは長押しして「メモを追加」を選びます。対象を動かしたときも関係を保てるため、特定のタイミングに対する修正理由や注意を書きたいときに使います。' },
            { term: '位置・内容・重なり', description: 'メモを選び、文字や手描き、色、線幅、背景を編集します。枠のドラッグで移動、ハンドルで大きさを変更し、右クリックから前面／背面の順序変更と削除を行います。' },
          ],
        },
        {
          title: '自由注釈とCSP用メモ素材',
          items: [
            { term: 'ページ上の自由注釈', description: 'ペンまたはテキストツールで、ページ上の任意の場所へ書き込みます。消しゴムは手描きだけを部分消去し、ごみ箱メニューは現在ページまたは全ページの注釈をまとめて消去します。表示設定の「注釈」をオフにすると、削除せず一時的に隠せます。' },
            { term: 'CSPレイヤー構成の「メモ」', description: '左ペインの「メモ」は、画像素材をCSPへ補助レイヤーとして渡すための項目です。シート上の文章や手描きメモとは別なので、CSPファイル内へ参考画像を積みたい場合だけ追加し、素材と重ね順を確認します。' },
          ],
        },
      ],
    }
  }

  if (chapter.id === 'paper') {
    return {
      ...chapter,
      sections: chapter.sections.map(section => ({
        ...section,
        items: section.items
          .filter(item => item.term !== 'PWA版でできること')
          .map(item => item.term === '文字認識（デスクトップ版）'
            ? {
                ...item,
                description: '「文字認識」でACTIONまたはCELLを選び、全ページを解析します。候補の文字はその場で直し、確かなものだけを個別または「すべて採用」で反映します。既存入力と異なる候補は「既存イベント」と表示されて採用されないため、候補を除外するかシート側を確認して手で直してください。',
              }
            : item),
      })),
    }
  }

  if (chapter.id === 'assets') {
    return {
      ...chapter,
      summary: 'カットフォルダを基準に画像を確認し、目的の工程とセルへ結び付けてCSPの重ね順を整えます。',
      sections: chapter.sections.map(section => ({
        ...section,
        items: [
          ...section.items.map(item => {
            if (item.term === 'カットフォルダ') {
              return {
                ...item,
                description: '右ペインのフォルダボタン、またはフォルダのドロップで実際のカットフォルダを登録します。デスクトップ版のCSP自動登録は、このフォルダを素材の基準と出力先に使うため必須です。別の場所へ移したときは「カットフォルダを変更」で選び直します。',
              }
            }
            if (item.term === 'ファイルを直接追加') {
              return {
                ...item,
                description: '画像ファイルだけを右ペインへドロップして補助的に追加できます。単一素材をシートのマスへ直接置くと、素材登録とキー配置を同時に行えます。ただし単体ファイルの追加だけではCSP書き出し先が決まらないため、CSPへ渡す場合は別途カットフォルダも登録します。',
              }
            }
            if (item.term === '登録先工程') {
              return {
                ...item,
                description: '素材や新しいキーを置く前に、左ペインで工程名またはその配下を選びます。選んだ工程が新しい素材の登録先になり、現在の登録先は工程見出しの印とペイン下部の表示で確認できます。意図しない工程へ入った場合は移動するか、元に戻して登録先を選び直します。',
              }
            }
            if (item.term === '一括リネーム') {
              return {
                ...item,
                description: 'CSP用のセル名を列名・工程・連番に合わせて整えます。素材ファイル名も変更する設定を選ぶとディスク上の実ファイルが改名されるため、対象と変更後の名前をプレビューしてから実行します。',
              }
            }
            return item
          }),
          ...(section.title === '画像素材'
            ? [{ term: '追加素材の再走査', description: 'カットフォルダへ後から画像を増やした場合は、右ペイン上部の再走査ボタンで一覧を更新します。サブフォルダへ移動して内容を確認し、ルートへ戻るボタンでカット全体へ戻れます。' }]
            : []),
        ],
      })),
    }
  }

  if (chapter.id === 'view') {
    return {
      ...chapter,
      sections: chapter.sections.map(section => ({
        ...section,
        items: section.items.map(item => item.term === '表示テンプレート'
          ? {
              ...item,
              description: 'シート作業レールの「表示設定」で紙の様式またはデジタル表示を選びます。入力済みのACTION・CELL、SOUND・CAMERAは残ったまま、デジタルではすべての列を表示し、紙では用紙に収まる列を欄内、残りを欄外表示で知らせます。',
            }
          : item),
      })),
    }
  }

  if (chapter.id === 'template') {
    return {
      ...chapter,
      title: '表示テンプレート',
      summary: '紙の様式またはデジタル表示を選び、データを失わず見え方を切り替えます。',
      sections: [
        {
          title: '作業に合う表示を選ぶ',
          items: [
            { term: '組み込みテンプレート', description: 'シート作業レールの「表示設定」から、紙の様式またはデジタルタイムシートを選びます。紙シートとの照合には罫線が合う紙テンプレート、列が多い確認には全列が見えるデジタルが向いています。' },
            { term: 'テンプレートJSONを読み込む', description: '画面切替メニューの「読み込み」から、xsheet-templateなどで作成したJSONを現在のプロジェクトへ適用します。用紙の欄だけでなくCSP工程の候補も変わる場合があるため、適用後は紙シートの四隅、入力欄、左ペインの登録先工程を確認してください。' },
            { term: '入力を残したまま切り替える', description: '入力済みのACTION・CELL、SOUND・CAMERAは保持されます。紙に収まらない列も削除されず、デジタルへ切り替えると通常の列として再表示されます。' },
          ],
        },
        {
          title: '独自様式が必要なとき',
          items: [
            { term: 'xsheet-templateで作る', description: '用紙、参照画像、情報欄、入力欄、罫線、文字、色を編集したい場合はxsheet-templateでJSONを作り、Remapへ読み込みます。Remapはテンプレートを使う側です。' },
            { term: '紙テンプレートの確認', description: '実際のスキャンdpi／PPI、補正基準枠、ページごとの画像割当が合っているか確認します。罫線が合わなければ素材対応を進める前に直します。' },
            { term: 'デジタルテンプレートの確認', description: '必要なセル列とSOUND・CAMERA列がすべて見え、右端までスクロールできるか確認します。列数に応じて横幅が広がるのは正常です。' },
          ],
        },
      ],
    }
  }

  if (chapter.id === 'io') {
    return {
      ...chapter,
      summary: '確認、他ソフト連携、CSP自動登録の目的に合う形式を選びます。',
      sections: [
        {
          title: '読み込むデータ',
          items: [
            { term: 'XDTS', description: '複数のタイムテーブルがある場合は対象を選び、キーの読み込み先をACTIONまたはCELLに決めます。既存入力を入れ替えるなら「上書き」、空欄だけ補うなら「空きだけ」を選びます。必要な場合だけSOUND／CAMERA、カット尺の延長、シーン・カット番号の反映をオンにし、表示される件数と注意を確認してから読み込みます。' },
            { term: 'シートテンプレートJSON', description: '独自の紙様式やデジタル表示を現在のプロジェクトへ適用します。入力済みタイミングは残りますが、欄の位置やCSP工程の候補が変わる場合があるため、適用後に表示と登録先を確認します。' },
            { term: '.xsrプロジェクト', description: '「プロジェクトを開く」から、紙シート、素材対応、CSP構成、注釈、修正履歴を含む作業一式を再開します。' },
          ],
        },
        {
          title: '書き出し先で選ぶ',
          items: [
            { term: 'JPG／PNG', description: '確認・共有しやすいページ画像です。紙シート、テンプレート、入力、注釈のうち見せたいレイヤーを選びます。' },
            { term: 'PSD', description: 'タイムシート画像をレイヤー付きで渡したいときに使います。あとから画像編集ソフトで表示を調整できます。' },
            { term: 'XDTS', description: 'タイミングを対応ソフトへ渡します。ACTIONかCELLを選び、SOUND／CAMERAは必要な場合だけ含めます。' },
            { term: 'CSP自動登録データ', description: 'CSPへセル素材とタイミングをまとめて登録するときに使います。デスクトップ版では実際のカットフォルダが必要で、その中のxsheet-csp-importへ出力されます。ACTION／CELL、出力先、画像付き／キーのみ件数を確認して書き出します。' },
            { term: 'シートテンプレートJSON', description: '現在の表示様式を別プロジェクトでも再利用したいときに保存します。' },
          ],
        },
        {
          title: 'どのカットと修正シートが出るか',
          items: [
            { term: '画像・PSD・XDTS・CSP', description: '兼用カットがある場合は、グループ内の全カットをまとめて対象にします。各カットは、そのカットで現在選んでいる初稿または修正シートの内容が出力されます。書き出す前に兼用カットを順に切り替え、使いたい修正シートが選ばれているか確認してください。' },
            { term: 'After Effects', description: '現在画面に表示しているカットと初稿／修正シートだけを対象にします。別の兼用カットも渡す場合は、そのカットへ切り替えて同じ操作を行います。' },
            { term: 'CSP書き出し後', description: '生成されたcsp-import.xciをxsheet-importerへ選択またはドロップし、登録先の.clipと保存先を選びます。内容と件数を確認して開始し、完了後にCSPでセル名、タイムライン、BG／BOOK、撮影指示、メモの順番を確認します。' },
          ],
        },
        {
          title: 'After Effectsへ渡す',
          items: [
            { term: 'セル画像を連番で読み込む', description: 'B0001.tga、B0002.tga…のように1セル1枚で並べ、AEへ画像シーケンスとして読み込みます。1列コピーを使う場合は、「フッテージを変換」で連番のフレームレートをタイムシートと同じ値（通常24fps）にします。JSXと直接送信は、割り当てた連番のフレームレートをAEから取得します。欠番や並び違いがないことも確認してください。' },
            { term: '1列をコピーして貼る', description: '列見出しを右クリックし、「AE用データをコピー」からAEの表示言語を選びます。AEでは対象の連番レイヤーを選び、現在時刻を0フレームへ移動します。タイムリマップを有効にしてレイヤー終端をカットの終わりまで伸ばし、貼り付けます。コピーされるのはキーだけなので、レイヤーの長さは自動では変わりません。' },
            { term: 'JSXで複数列を割り当てる', description: '書き出しメニューの「After Effects JSX」でACTIONまたはCELLを選びます。AEで対象コンポジションを開き、JSXを実行して各セル列の割り当て先を選びます。割り当てた連番のフレームレートでセル番号を換算し、タイムリマップを有効にしてレイヤーをカットの終わりまで自動で伸ばします。' },
            { term: '起動中のAEへ直接送る', description: 'Windowsデスクトップ版では、対象コンポジションを開いたAEへそのまま送信できます。割り当てと適用内容はAE側で確認します。タイムリマップの有効化とレイヤーの延長はJSXと同じく自動です。' },
            { term: '適用されるキー', description: 'セル番号が変わるコマに停止（HOLD）キーが入り、カラセルはブラインドで非表示になります。1列コピーは各コマにキーが入り、JSXと直接送信は変化したコマだけにキーが入ります。既存のタイムリマップやカラセル用効果を置き換える場合は確認が出ます。' },
            { term: '適用できないとき', description: 'まずコンポジションをタイムシート以上の長さにし、レイヤーのロックを解除します。「必要なソース時間がない」と表示された場合は、シートで使う最大セル番号まで連番画像がそろっているか確認してください。' },
          ],
        },
      ],
    }
  }

  if (chapter.id === 'shortcuts') {
    return {
      ...chapter,
      sections: chapter.sections.map(section => ({
        ...section,
        items: section.items.map(item => item.term === '保存できない'
          ? { ...item, description: '保存先の書込権限を確認し、「名前を付けて保存」で別の場所を選び直します。素材や紙シートの元ファイルとは別に、.xsrを保存できる場所が必要です。' }
          : item),
      })),
    }
  }

  return chapter
})

export function RemapDetailedHelp() {
  return (
    <ChapteredHelp
      chapters={remapHelpChapters}
      idPrefix="remap-help"
      navigationLabel="Remapの詳しい使い方の目次"
    />
  )
}
