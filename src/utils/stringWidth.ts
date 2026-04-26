// Unicode-safe string width and truncation utilities.
// Terminal columns ≠ string length when CJK / emoji chars are present.

// Simple East-Asian-Width aware width calculator.
// Returns the number of terminal columns a string occupies.
export function stringWidth(str: string): number {
  let width = 0
  for (const char of str) {
    const code = char.codePointAt(0) ?? 0
    if (isWideChar(code)) {
      width += 2
    } else if (isZeroWidthChar(code)) {
      // zero-width joiners, combining marks, etc.
    } else {
      width += 1
    }
  }
  return width
}

function isWideChar(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115F) ||  // Hangul Jamo
    (cp >= 0x2E80 && cp <= 0x303E) ||  // CJK Radicals
    (cp >= 0x3040 && cp <= 0x33FF) ||  // Japanese
    (cp >= 0x3400 && cp <= 0x4DBF) ||  // CJK Extension A
    (cp >= 0x4E00 && cp <= 0x9FFF) ||  // CJK Unified
    (cp >= 0xA000 && cp <= 0xA4CF) ||  // Yi
    (cp >= 0xAC00 && cp <= 0xD7AF) ||  // Hangul Syllables
    (cp >= 0xF900 && cp <= 0xFAFF) ||  // CJK Compatibility
    (cp >= 0xFE10 && cp <= 0xFE1F) ||  // Vertical forms
    (cp >= 0xFE30 && cp <= 0xFE6F) ||  // CJK Compatibility Forms
    (cp >= 0xFF00 && cp <= 0xFF60) ||  // Fullwidth Forms
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||  // Fullwidth Signs
    (cp >= 0x1F300 && cp <= 0x1F9FF)   // Emoji
  )
}

function isZeroWidthChar(cp: number): boolean {
  return (
    cp === 0x200B ||               // zero-width space
    cp === 0x200C ||               // zero-width non-joiner
    cp === 0x200D ||               // zero-width joiner
    cp === 0xFEFF ||               // BOM / zero-width no-break space
    (cp >= 0x300 && cp <= 0x36F)   // combining diacritical marks
  )
}

// Truncate a string to fit within maxCols terminal columns.
// Appends suffix (default '…') if truncated.
export function truncate(str: string, maxCols: number, suffix = '…'): string {
  if (stringWidth(str) <= maxCols) return str
  const suffixWidth = stringWidth(suffix)
  let width = 0
  let result = ''
  for (const char of str) {
    const cp = char.codePointAt(0) ?? 0
    const charWidth = isWideChar(cp) ? 2 : isZeroWidthChar(cp) ? 0 : 1
    if (width + charWidth + suffixWidth > maxCols) break
    result += char
    width += charWidth
  }
  return result + suffix
}

// Shorten an absolute path to a ~/relative path, then truncate to fit cols.
export function formatPath(absPath: string, maxCols: number): string {
  const home = process.env['HOME'] ?? ''
  const rel = home && absPath.startsWith(home)
    ? '~' + absPath.slice(home.length)
    : absPath
  return truncate(rel, maxCols)
}
