import { describe, test, expect } from 'bun:test'
import { isImageFilePath, tryReadImagePath } from '../utils/imagePaste.js'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('isImageFilePath', () => {
  test('detects common image extensions', () => {
    expect(isImageFilePath('/path/to/image.png')).toBe(true)
    expect(isImageFilePath('/path/to/photo.jpg')).toBe(true)
    expect(isImageFilePath('/path/to/photo.jpeg')).toBe(true)
    expect(isImageFilePath('/path/to/anim.gif')).toBe(true)
    expect(isImageFilePath('/path/to/logo.webp')).toBe(true)
  })

  test('case-insensitive extension match', () => {
    expect(isImageFilePath('/path/to/image.PNG')).toBe(true)
    expect(isImageFilePath('/path/to/image.JPG')).toBe(true)
    expect(isImageFilePath('/path/to/image.WEBP')).toBe(true)
  })

  test('rejects non-image extensions', () => {
    expect(isImageFilePath('/path/to/file.ts')).toBe(false)
    expect(isImageFilePath('/path/to/file.txt')).toBe(false)
    expect(isImageFilePath('/path/to/file.pdf')).toBe(false)
    expect(isImageFilePath('/path/to/file')).toBe(false)
    expect(isImageFilePath('')).toBe(false)
  })

  test('strips surrounding quotes before checking', () => {
    expect(isImageFilePath('"image.png"')).toBe(true)
    expect(isImageFilePath("'image.jpg'")).toBe(true)
  })

  test('trims whitespace', () => {
    expect(isImageFilePath('  /path/to/image.png  ')).toBe(true)
  })
})

describe('tryReadImagePath', () => {
  test('returns null for non-image text', () => {
    const result = tryReadImagePath('hello world')
    expect(result).toBeNull()
  })

  test('returns null for image path that does not exist', () => {
    const result = tryReadImagePath('/tmp/nonexistent-abc123.png')
    expect(result).toBeNull()
  })

  test('reads a real image file and returns base64', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agent-img-'))
    try {
      // Create a minimal 1x1 PNG (smallest valid PNG)
      const minimalPng = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk length + type
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // width=1, height=1
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // bit depth, color type, etc
        0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT
        0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, // compressed data
        0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, // CRC
        0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND
        0x44, 0xae, 0x42, 0x60, 0x82,                   // IEND CRC
      ])
      const imgPath = join(tmpDir, 'test.png')
      writeFileSync(imgPath, minimalPng)

      const result = tryReadImagePath(imgPath)
      expect(result).not.toBeNull()
      expect(result?.mediaType).toBe('image/png')
      expect(result?.label).toBe('test.png')
      expect(result?.base64).toBeTruthy()
      expect(typeof result?.base64).toBe('string')
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
