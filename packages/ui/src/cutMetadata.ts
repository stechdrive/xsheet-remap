import type { CutMetadataFieldId, CutProject } from '@xsheet-remap/core';

export function updateCutMetadata(
  project: CutProject,
  field: CutMetadataFieldId,
  value: string,
  customKey?: string,
): CutProject {
  if (field === 'duration' || field === 'page') return project;
  const nextValue = value.trim() ? value : undefined;

  if (field === 'custom') {
    if (!customKey) return project;
    const custom = { ...(project.cut.custom ?? {}) };
    if (nextValue === undefined) delete custom[customKey];
    else custom[customKey] = nextValue;
    return {
      ...project,
      cut: {
        ...project.cut,
        custom: Object.keys(custom).length > 0 ? custom : undefined,
      },
    };
  }

  return {
    ...project,
    cut: {
      ...project.cut,
      [field]: nextValue,
    },
  };
}
