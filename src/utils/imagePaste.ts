// Image paste utilities - macOS clipboard + file path detection
import { execSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { extname, isAbsolute } from 'path'

export type ImageAttachment = {
  base64: string
  mediaType: string
  label: string  // display label for the [image] token
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i

/** Returns true if the text looks like an image file path */
export function isImageFilePath(text: string): boolean {
  const cleaned = text.trim().replace(/^["']|["']$/g, '')
  return IMAGE_EXT_RE.test(cleaned)
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** Detect magic bytes to determine actual image media type */
function detectMediaType(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif'
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp'
  return 'image/png'
}

/** Check if clipboard contains an image (macOS only) */
export function hasClipboardImage(): boolean {
  if (process.platform !== 'darwin') return false
  try {
    execSync(`osascript -e 'the clipboard as «class PNGf»'`, {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 2000,
    })
    return true
  } catch {
    return false
  }
}

/** Read image from macOS clipboard as base64. Returns null if no image. */
export async function getClipboardImage(): Promise<ImageAttachment | null> {
  if (process.platform !== 'darwin') return null
  const tmpPath = '/tmp/agent_clipboard_img.png'
  try {
    const saveScript = [
      `set png_data to (the clipboard as «class PNGf»)`,
      `set fp to open for access POSIX file "${tmpPath}" with write permission`,
      `write png_data to fp`,
      `close access fp`,
    ].map(s => `-e '${s}'`).join(' ')
    execSync(`osascript ${saveScript}`, { timeout: 3000 })
    const buf = readFileSync(tmpPath)
    if (buf.length === 0) return null
    try { execSync(`rm -f "${tmpPath}"`) } catch { /* ignore */ }
    return {
      base64: buf.toString('base64'),
      mediaType: 'image/png',
      label: 'clipboard image',
    }
  } catch {
    try { execSync(`rm -f "${tmpPath}"`) } catch { /* ignore */ }
    return null
  }
}

/** Check if text is an image file path and read it. Returns null if not. */
export function tryReadImagePath(text: string): ImageAttachment | null {
  const cleaned = text.trim().replace(/^["']|["']$/g, '')
  if (!isImageFilePath(cleaned)) return null

  try {
    const absPath = isAbsolute(cleaned)
      ? cleaned
      : null

    if (!absPath || !existsSync(absPath)) return null

    const buf = readFileSync(absPath)
    if (buf.length === 0) return null

    const ext = extname(absPath).slice(1).toLowerCase()
    const mediaType = MIME_BY_EXT[ext] ?? detectMediaType(buf)
    const filename = absPath.split('/').pop() ?? 'image'

    return {
      base64: buf.toString('base64'),
      mediaType,
      label: filename,
    }
  } catch {
    return null
  }
}
