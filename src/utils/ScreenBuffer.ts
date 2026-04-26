export class ScreenBuffer {
  private lines: string[] = []
  private row = 0
  private col = 0
  private pendingWrap = false  // deferred wrap: set when char placed in last col
  private savedRow = 0
  private savedCol = 0
  private height: number
  private width: number

  constructor(width = 220, height = 60) {
    this.width = width
    this.height = height
    this.lines = Array(height).fill('')
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = Math.max(height + 10, this.lines.length)
  }

  process(chunk: string | Buffer): void {
    const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    let i = 0
    while (i < s.length) {
      const ch = s[i]!
      if (ch === '\x1b') {
        const len = this.parseEscape(s, i)
        i += len
        continue
      }
      if (ch === '\r') { this.col = 0; this.pendingWrap = false; i++; continue }
      if (ch === '\n') { this.row = Math.min(this.row + 1, this.height - 1); this.col = 0; this.pendingWrap = false; i++; continue }
      const code = ch.codePointAt(0)!
      if (code >= 0x20 && code !== 0x7f) this.putChar(ch)
      i++
    }
  }

  private parseEscape(s: string, start: number): number {
    if (start + 1 >= s.length) return 1
    const next = s[start + 1]
    if (next === '7') { this.savedRow = this.row; this.savedCol = this.col; return 2 }
    if (next === '8') { this.row = this.savedRow; this.col = this.savedCol; return 2 }
    if (next !== '[') return 2
    // CSI: collect up to final byte (0x40-0x7e)
    let i = start + 2
    while (i < s.length && (s.charCodeAt(i) < 0x40 || s.charCodeAt(i) > 0x7e)) i++
    if (i >= s.length) return i - start
    const final = s[i]!
    const params = s.slice(start + 2, i)
    if (!params.startsWith('?')) this.handleCSI(params, final)
    return i - start + 1
  }

  private handleCSI(params: string, cmd: string): void {
    const parts = params.split(';')
    const n0 = parseInt(parts[0] ?? '0') || 0
    const n1 = parseInt(parts[1] ?? '0') || 0
    switch (cmd) {
      case 'H': case 'f':
        this.row = Math.max(0, Math.min(this.height - 1, (n0 || 1) - 1))
        this.col = Math.max(0, Math.min(this.width - 1, (n1 || 1) - 1))
        this.pendingWrap = false
        break
      case 'A': this.row = Math.max(0, this.row - (n0 || 1)); this.pendingWrap = false; break
      case 'B': this.row = Math.min(this.height - 1, this.row + (n0 || 1)); this.pendingWrap = false; break
      case 'C': this.col = Math.min(this.width - 1, this.col + (n0 || 1)); this.pendingWrap = false; break
      case 'D': this.col = Math.max(0, this.col - (n0 || 1)); this.pendingWrap = false; break
      case 'J':
        if (n0 === 2 || n0 === 3) { this.lines = Array(this.height).fill(''); this.pendingWrap = false; }
        break
      case 'K': {
        const line = this.lines[this.row] ?? ''
        if (n0 === 0) this.lines[this.row] = line.slice(0, this.col)
        else if (n0 === 2) this.lines[this.row] = ''
        break
      }
    }
  }

  private putChar(ch: string): void {
    // Apply deferred wrap before writing new character
    if (this.pendingWrap) {
      this.col = 0
      this.row = Math.min(this.row + 1, this.height - 1)
      this.pendingWrap = false
    }
    while (this.lines.length <= this.row) this.lines.push('')
    const line = this.lines[this.row] ?? ''
    const padded = line.padEnd(this.col, ' ')
    this.lines[this.row] = padded.slice(0, this.col) + ch + padded.slice(this.col + 1)
    this.col++
    if (this.col >= this.width) this.pendingWrap = true
  }

  /** Extract plain text from row range (1-indexed, matching SGR mouse coords) */
  getRows(startRow: number, endRow: number): string {
    const result: string[] = []
    for (let r = startRow - 1; r <= endRow - 1; r++) {
      result.push((this.lines[r] ?? '').trimEnd())
    }
    return result.join('\n').trim()
  }

  /** Extract text within a precise character selection (1-indexed rows and cols) */
  getSelectedText(startRow: number, startCol: number, endRow: number, endCol: number): string {
    // Normalise direction - handle drag going upward or leftward
    let sRow = startRow, sCol = startCol, eRow = endRow, eCol = endCol
    if (sRow > eRow || (sRow === eRow && sCol > eCol)) {
      ;[sRow, eRow] = [eRow, sRow]
      ;[sCol, eCol] = [eCol, sCol]
    }

    const result: string[] = []
    for (let r = sRow; r <= eRow; r++) {
      const line = (this.lines[r - 1] ?? '').trimEnd()
      if (sRow === eRow) {
        result.push(line.slice(sCol - 1, eCol))
      } else if (r === sRow) {
        result.push(line.slice(sCol - 1))
      } else if (r === eRow) {
        result.push(line.slice(0, eCol))
      } else {
        result.push(line)
      }
    }
    return result.join('\n')
  }

  /** Get a single row's content padded to full width (for overlay inversion) */
  getLine(row: number): string {
    return (this.lines[row - 1] ?? '').padEnd(this.width, ' ')
  }
}

export const screenBuffer = new ScreenBuffer()
