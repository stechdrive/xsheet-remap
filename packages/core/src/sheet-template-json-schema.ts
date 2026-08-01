/**
 * JSON Schema 2020-12 cannot compare one instance property with the items of
 * another instance property. This extension keeps the portable schema and the
 * runtime parser aligned without changing the version 6 document shape.
 */
export const SHEET_TEMPLATE_CHOICE_DEFAULT_JSON_SCHEMA_KEYWORD = 'x-choiceDefaultInChoices' as const

export interface SheetTemplateJsonSchemaKeywordDefinition {
  keyword: typeof SHEET_TEMPLATE_CHOICE_DEFAULT_JSON_SCHEMA_KEYWORD
  schemaType: 'boolean'
  type: 'object'
  errors: false
  validate: (enabled: boolean, data: unknown) => boolean
}

export interface SheetTemplateJsonSchemaKeywordRegistry {
  addKeyword(definition: SheetTemplateJsonSchemaKeywordDefinition): unknown
}

/** Validate the cross-property rule represented by x-choiceDefaultInChoices. */
export function validateSheetTemplateChoiceDefaultInChoices(enabled: boolean, data: unknown): boolean {
  if (!enabled || !isRecord(data) || data.valueType !== 'choice' || data.defaultValue === undefined) return true
  return typeof data.defaultValue === 'string'
    && Array.isArray(data.choices)
    && data.choices.includes(data.defaultValue)
}

export const sheetTemplateJsonSchemaKeywordDefinitions: readonly SheetTemplateJsonSchemaKeywordDefinition[] = Object.freeze([
  Object.freeze({
    keyword: SHEET_TEMPLATE_CHOICE_DEFAULT_JSON_SCHEMA_KEYWORD,
    schemaType: 'boolean',
    type: 'object',
    errors: false,
    validate: validateSheetTemplateChoiceDefaultInChoices,
  }),
])

/**
 * Register every required sheet-template schema extension on an Ajv-compatible
 * validator before compiling schemas/sheet-template.schema.json.
 */
export function registerSheetTemplateJsonSchemaKeywords(registry: SheetTemplateJsonSchemaKeywordRegistry): void {
  for (const definition of sheetTemplateJsonSchemaKeywordDefinitions) registry.addKeyword(definition)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
