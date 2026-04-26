import { describe, test, expect, beforeEach } from 'bun:test'
import { ScreenBuffer } from '../utils/ScreenBuffer.js'

describe('ScreenBuffer', () => {
  let buf: ScreenBuffer

  beforeEach(() => {
    buf = new ScreenBuffer(10, 5)
  })

  // ── Basic text writing ──────────────────────────────────────────────────────

  test('writes plain text to row 1', () => {
    buf.process('hello')
    expect(buf.getLine(1).trimEnd()).toBe('hello')
  })

  test('\\r resets column without advancing row', () => {
    buf.process('hello\rXX')
    expect(buf.getLine(1).trimEnd()).toBe('XXllo')
  })

  test('\\n advances row and resets column', () => {
    buf.process('ab\ncd')
    expect(buf.getLine(1).trimEnd()).toBe('ab')
    expect(buf.getLine(2).trimEnd()).toBe('cd')
  })

  // ── pendingWrap (the critical double-row bug fix) ──────────────────────────

  test('filling exactly to width sets pendingWrap, does NOT advance row yet', () => {
    // Write exactly 10 chars (width=10), then a newline
    // The newline should only advance by 1 row (not 2)
    buf.process('0123456789\nX')
    expect(buf.getLine(1).trimEnd()).toBe('0123456789')
    expect(buf.getLine(2).trimEnd()).toBe('X')
  })

  test('char after full line triggers wrap to next row', () => {
    buf.process('0123456789A')
    expect(buf.getLine(1).trimEnd()).toBe('0123456789')
    expect(buf.getLine(2).trimEnd()).toBe('A')
  })

  test('\\n after full-width line does NOT double-advance', () => {
    // width=10, write 10 chars, then \n, then 1 char
    // Should land on row 2, NOT row 3
    buf.process('0123456789\nZ')
    expect(buf.getLine(2).trimEnd()).toBe('Z')
    expect(buf.getLine(3).trimEnd()).toBe('')
  })

  test('\\r clears pendingWrap', () => {
    buf.process('0123456789\rX')
    // \r resets col to 0, clears pendingWrap - next char at col 0 of same row
    expect(buf.getLine(1).slice(0, 1)).toBe('X')
  })

  // ── getSelectedText ─────────────────────────────────────────────────────────

  test('single-row selection', () => {
    buf.process('hello world')
    // rows and cols are 1-indexed
    expect(buf.getSelectedText(1, 1, 1, 5)).toBe('hello')
  })

  test('multi-row selection includes full middle rows', () => {
    buf.process('aaa\nbbb\nccc')
    const text = buf.getSelectedText(1, 1, 3, 3)
    expect(text).toBe('aaa\nbbb\nccc')
  })

  test('multi-row selection with partial start and end', () => {
    buf.process('hello\nworld')
    // from col 3 on row 1 to col 3 on row 2
    const text = buf.getSelectedText(1, 3, 2, 3)
    expect(text).toBe('llo\nwor')
  })

  test('reversed selection is normalised', () => {
    buf.process('hello\nworld')
    // drag from bottom-right to top-left
    const text = buf.getSelectedText(2, 3, 1, 3)
    expect(text).toBe('llo\nwor')
  })

  // ── getLine ─────────────────────────────────────────────────────────────────

  test('getLine pads to full width', () => {
    buf.process('hi')
    expect(buf.getLine(1).length).toBe(10)
    expect(buf.getLine(1)).toBe('hi        ')
  })

  test('getLine returns spaces for empty row', () => {
    expect(buf.getLine(1)).toBe('          ')
  })

  // ── CSI cursor movement ─────────────────────────────────────────────────────

  test('CSI H positions cursor', () => {
    buf.process('\x1b[3;4H' + 'X')
    expect(buf.getLine(3).slice(3, 4)).toBe('X')
  })

  test('CSI 2J clears screen', () => {
    buf.process('hello\nworld')
    buf.process('\x1b[2J')
    expect(buf.getLine(1).trimEnd()).toBe('')
    expect(buf.getLine(2).trimEnd()).toBe('')
  })
})
