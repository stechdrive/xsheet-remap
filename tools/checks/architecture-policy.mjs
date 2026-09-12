import ts from 'typescript'
import path from 'node:path'

const pointerOwners = new Set(['useDialogueAudioSegmentDrag.ts', 'sheet-panel-annotation.tsx', 'TimelineMemoLayer.tsx', 'useSheetCalibrationDrag.ts', 'PageAnnotationInputSurface.tsx'])
const keyboardOwners = new Set(['SoundCueDialog.tsx', 'CameraCueDialog.tsx', 'SheetHistoryRail.tsx'])
export function inspectSourceBoundaries(file, source) {
  const errors = []
  const normalized = file.replaceAll('\\', '/')
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  function inspectImport(specifier) {
    const resolved = specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(normalized), specifier)) : specifier
    if (normalized.startsWith('packages/core/') && /^(?:@xsheet-remap|packages)\/(?:ui|adapters|xdts)(?:\/|$)/.test(resolved)) errors.push('core must not depend on UI, adapters or XDTS')
    if (normalized.startsWith('packages/ui/') && specifier.startsWith('@tauri-apps/')) errors.push('UI must access Tauri through adapters')
    if (/^@xsheet-remap\/[^/]+\/src(?:\/|$)/.test(specifier)) errors.push('Workspace packages must use public exports')
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) inspectImport(node.moduleSpecifier.text)
    if (ts.isCallExpression(node)) {
      if ((node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') && ts.isStringLiteral(node.arguments[0])) inspectImport(node.arguments[0].text)
      if (ts.isPropertyAccessExpression(node.expression) && ['window', 'document'].includes(node.expression.expression.getText(tree)) && node.expression.name.text === 'addEventListener' && ts.isStringLiteral(node.arguments[0])) {
        const event = node.arguments[0].text, name = path.posix.basename(normalized)
        if (pointerOwners.has(name) && /^pointer(?:down|move|up|cancel)$/.test(event)) errors.push('Feature components must delegate the pointer lifecycle to its owner')
        if (keyboardOwners.has(name) && event === 'keydown') errors.push('Dialogs must delegate global keyboard ownership to their boundary')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return errors
}
