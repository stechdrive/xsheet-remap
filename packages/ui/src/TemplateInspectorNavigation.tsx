import type { TemplateDetailTab } from './appTypes'

export type TemplateInspectorSection = {
  id: TemplateDetailTab
  label: string
  navigationLabel?: string
  description: string
  group: 'edit' | 'manage'
  parentId?: TemplateDetailTab
}

export function TemplateInspectorNavigation({
  sections,
  activeSectionId,
  onSelect,
}: {
  sections: TemplateInspectorSection[]
  activeSectionId: TemplateDetailTab
  onSelect: (sectionId: TemplateDetailTab) => void
}) {
  const activeSection = sections.find(section => section.id === activeSectionId) ?? sections[0]
  if (!activeSection) return null
  const activeNavigationId = activeSection.parentId ?? activeSection.id
  const navigationSections = sections.filter(section => !section.parentId)

  return (
    <header className="templateInspectorNavigation">
      <nav className="templateInspectorSectionNavigation" aria-label="編集する内容">
        <TemplateInspectorSectionGroup
          label="テンプレートを編集"
          sections={navigationSections.filter(section => section.group === 'edit')}
          activeSectionId={activeNavigationId}
          onSelect={onSelect}
        />
        <TemplateInspectorSectionGroup
          label="確認とデータ"
          sections={navigationSections.filter(section => section.group === 'manage')}
          activeSectionId={activeNavigationId}
          onSelect={onSelect}
        />
      </nav>
      <div className="templateInspectorSectionIntro">
        <span>{activeSection.parentId ? '領域 / 詳細' : '設定パネル'}</span>
        <h2>{activeSection.label}</h2>
        <p>{activeSection.description}</p>
      </div>
    </header>
  )
}

function TemplateInspectorSectionGroup({
  label,
  sections,
  activeSectionId,
  onSelect,
}: {
  label: string
  sections: TemplateInspectorSection[]
  activeSectionId: TemplateDetailTab
  onSelect: (sectionId: TemplateDetailTab) => void
}) {
  if (sections.length === 0) return null
  return (
    <section className="templateInspectorSectionGroup" aria-label={label}>
      <span>{label}</span>
      <div>
        {sections.map(section => {
          const active = section.id === activeSectionId
          return (
            <button
              key={section.id}
              type="button"
              className={active ? 'active' : undefined}
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelect(section.id)}
            >
              {section.navigationLabel ?? section.label}
            </button>
          )
        })}
      </div>
    </section>
  )
}
