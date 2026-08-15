import type { SheetTemplate } from '@xsheet-remap/core'
import { templateRegionAuthoringName, templateRegionKindLabel } from './templateRegionAuthoring'

export function templateWorkspaceNavigationItems(template: SheetTemplate, managedRegionIds?: ReadonlySet<string>) {
  return template.regions
    .filter(region => !managedRegionIds?.has(region.regionId))
    .map(region => ({
      regionId: region.regionId,
      label: templateRegionAuthoringName(region),
      kind: templateRegionKindLabel(region),
      group: region.type === 'exposure-grid'
        ? 'timeline' as const
        : region.type === 'decorative'
          ? 'support' as const
          : 'information' as const,
    }))
}
