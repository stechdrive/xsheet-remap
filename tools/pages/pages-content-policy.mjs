import ts from 'typescript'

const OCR_IDENTIFIER = /(?:@paddleocr|PaddleOCR|PP-OCRv5)/i
const normalizeNewlines = text => text.replaceAll('\r\n', '\n')

export function containsUnexpectedOcrIdentifier(fileName, content, thirdPartyNotices) {
  if (!OCR_IDENTIFIER.test(content)) return false
  if (!/\.(?:m?js)$/i.test(fileName)) return true

  const source = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  if (source.parseDiagnostics.length > 0) return true
  const expectedNotice = normalizeNewlines(thirdPartyNotices)
  const noticeRanges = []
  function visit(node) {
    // Exempt only the complete canonical notice as a literal. Other strings and
    // executable references must still be checked, even in the same bundle.
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      && normalizeNewlines(node.text) === expectedNotice) {
      noticeRanges.push([node.getStart(source), node.end])
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  let previousEnd = 0
  for (const [start, end] of noticeRanges.sort((left, right) => left[0] - right[0])) {
    if (OCR_IDENTIFIER.test(content.slice(previousEnd, start))) return true
    previousEnd = end
  }
  return OCR_IDENTIFIER.test(content.slice(previousEnd))
}
