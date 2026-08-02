import { useState } from 'react'

export type ChapterHelpItem = {
  term: string
  description: string
}

export type ChapterHelpSection = {
  title: string
  introduction?: string
  items: ChapterHelpItem[]
}

export type HelpChapter = {
  id: string
  number: string
  title: string
  summary: string
  sections: ChapterHelpSection[]
}

export function ChapteredHelp({
  chapters,
  tocTitle = '詳しい使い方',
  navigationLabel = '詳しい使い方の目次',
  idPrefix,
  className = '',
}: {
  chapters: HelpChapter[]
  tocTitle?: string
  navigationLabel?: string
  idPrefix: string
  className?: string
}) {
  const [activeChapterId, setActiveChapterId] = useState(chapters[0]?.id ?? '')
  const activeChapterIndex = Math.max(0, chapters.findIndex(chapter => chapter.id === activeChapterId))
  const activeChapter = chapters[activeChapterIndex]

  if (!activeChapter) return null

  function selectChapter(index: number) {
    const chapter = chapters[index]
    if (chapter) setActiveChapterId(chapter.id)
  }

  return (
    <div className={`editorHelpManual ${className}`.trim()}>
      <aside className="editorHelpToc">
        <div className="editorHelpTocIntro">
          <strong>{tocTitle}</strong>
          <span>全{chapters.length}章</span>
        </div>
        <nav aria-label={navigationLabel}>
          {chapters.map(chapter => (
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

      <article key={activeChapter.id} className="editorHelpChapter" aria-labelledby={`${idPrefix}-${activeChapter.id}`}>
        <header>
          <span>CHAPTER {activeChapter.number}</span>
          <h2 id={`${idPrefix}-${activeChapter.id}`}>{activeChapter.title}</h2>
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
          <span>{activeChapterIndex + 1} / {chapters.length}</span>
          <button type="button" disabled={activeChapterIndex === chapters.length - 1} onClick={() => selectChapter(activeChapterIndex + 1)}>
            次の章 →
          </button>
        </footer>
      </article>
    </div>
  )
}
