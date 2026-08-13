import { useId, type ChangeEvent } from 'react'

export type TemplateStartScreenProps = {
  onCreateA3Standard: () => void
  onCreatePaperFromImage: (file: File) => void | Promise<void>
  onCreateDigital: () => void
  onOpenTemplateJson: (file: File) => void | Promise<void>
  recovery?: {
    templateName: string
    savedAtLabel: string
    onRestore: () => void
    onDiscard: () => void | Promise<void>
  } | null
}

export function TemplateStartScreen({
  onCreateA3Standard,
  onCreatePaperFromImage,
  onCreateDigital,
  onOpenTemplateJson,
  recovery,
}: TemplateStartScreenProps) {
  const headingId = useId()
  const paperImageInputId = useId()
  const jsonInputId = useId()

  function handleFileSelection(
    event: ChangeEvent<HTMLInputElement>,
    callback: (file: File) => void | Promise<void>,
  ) {
    const file = event.currentTarget.files?.[0]
    if (file) void callback(file)
    event.currentTarget.value = ''
  }

  return (
    <section className="templateStartScreen" aria-labelledby={headingId}>
      <div className="templateStartScreenContent">
        <header className="templateStartScreenHeader">
          <p className="templateStartScreenEyebrow">SHEET TEMPLATE</p>
          <h1 id={headingId}>テンプレート作成を始める</h1>
          <p>
            まず作り方を選びます。作成後にレイアウトを調整し、最後にJSONとして保存します。
          </p>
        </header>

        {recovery && (
          <section className="templateStartRecovery" aria-label="復旧できる下書き">
            <div>
              <strong>未保存の下書きがあります</strong>
              <span>{recovery.templateName} · {recovery.savedAtLabel}</span>
            </div>
            <div>
              <button type="button" className="primary" onClick={recovery.onRestore}>下書きを復元</button>
              <button type="button" onClick={() => void recovery.onDiscard()}>破棄</button>
            </div>
          </section>
        )}

        <ol className="templateStartScreenSteps" aria-label="テンプレート作成の流れ">
          <li className="active" aria-current="step">
            <span className="templateStartScreenStepNumber">1</span>
            <span><strong>作り方</strong><small>いまここ</small></span>
          </li>
          <li>
            <span className="templateStartScreenStepNumber">2</span>
            <span><strong>用紙レイアウト</strong><small>6秒表と要素を調整</small></span>
          </li>
          <li>
            <span className="templateStartScreenStepNumber">3</span>
            <span><strong>確認・保存</strong><small>JSONを書き出す</small></span>
          </li>
        </ol>

        <section className="templateStartScreenChoiceSection" aria-labelledby={`${headingId}-create`}>
          <div className="templateStartScreenSectionHeading">
            <h2 id={`${headingId}-create`}>新しく作る</h2>
            <p>用途に近い土台を選ぶと、必要な項目だけを調整できます。</p>
          </div>
          <div className="templateStartScreenOptionGrid">
            <StartButton
              className="recommended"
              title="標準用紙を調整"
              badge="おすすめ"
              description="3秒×2の6秒タイムライン表を保ったまま、列幅やシート情報を変更します。"
              actionLabel="A3標準から始める"
              onClick={onCreateA3Standard}
            />

            <StartFileOption
              inputId={paperImageInputId}
              accept="image/*"
              title="用紙画像から作成"
              description="画像上で6秒表の外周と列境界を合わせ、シート情報を追加します。"
              actionLabel="画像を選択"
              onChange={event => handleFileSelection(event, onCreatePaperFromImage)}
            />

            <StartButton
              title="デジタルシートを作成"
              description="FPS、初期フレーム数、セル列数を決めて連続キャンバスを作ります。"
              actionLabel="デジタル用を作る"
              onClick={onCreateDigital}
            />
          </div>
        </section>

        <section className="templateStartScreenOpenSection" aria-labelledby={`${headingId}-open`}>
          <div className="templateStartScreenSectionHeading">
            <h2 id={`${headingId}-open`}>続きから編集する</h2>
            <p>以前保存したテンプレートJSONを開きます。</p>
          </div>
          <StartFileOption
            inputId={jsonInputId}
            accept=".json,application/json"
            title="既存JSONを開く"
            description="保存済みの設定とレイアウトを読み込み、続きから編集します。"
            actionLabel="JSONを選択"
            compact
            onChange={event => handleFileSelection(event, onOpenTemplateJson)}
          />
        </section>
      </div>
    </section>
  )
}

function StartButton({
  title,
  description,
  actionLabel,
  badge,
  className = '',
  onClick,
}: {
  title: string
  description: string
  actionLabel: string
  badge?: string
  className?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`templateStartScreenOption ${className}`.trim()}
      aria-label={badge ? `${title}（${badge}）` : title}
      onClick={onClick}
    >
      <StartOptionContent title={title} description={description} actionLabel={actionLabel} badge={badge} />
    </button>
  )
}

function StartFileOption({
  inputId,
  accept,
  title,
  description,
  actionLabel,
  compact = false,
  onChange,
}: {
  inputId: string
  accept: string
  title: string
  description: string
  actionLabel: string
  compact?: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div className={`templateStartScreenFileOption ${compact ? 'compact' : ''}`.trim()}>
      <input
        id={inputId}
        className="templateStartScreenFileInput"
        type="file"
        accept={accept}
        aria-label={title}
        onChange={onChange}
      />
      <label className="templateStartScreenOption" htmlFor={inputId}>
        <StartOptionContent title={title} description={description} actionLabel={actionLabel} />
      </label>
    </div>
  )
}

function StartOptionContent({
  title,
  description,
  actionLabel,
  badge,
}: {
  title: string
  description: string
  actionLabel: string
  badge?: string
}) {
  return (
    <>
      <span className="templateStartScreenOptionHeading">
        <strong>{title}</strong>
        {badge && <span className="templateStartScreenBadge">{badge}</span>}
      </span>
      <span className="templateStartScreenOptionDescription">{description}</span>
      <span className="templateStartScreenOptionAction">{actionLabel}<span aria-hidden="true"> →</span></span>
    </>
  )
}
