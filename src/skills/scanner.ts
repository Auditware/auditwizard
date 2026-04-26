// Security scanner for SKILL.md files.
// Runs on invocation (not load); results cached by content hash.
// Categories: Prompt Injection, Jailbreak, Token Smuggling,
//             External Fetch Coercion, Secret Grabbing, Obfuscation.

import { createHash } from 'crypto'
import { join } from 'path'
import { agentsDir, ensureAgentsDir } from '../config/agentsDir.js'

const CACHE_PATH = agentsDir('skill-scan-cache.json')

export type GuardrailViolation = {
  snippet: string
  line: number
}

export type GuardrailCheck = {
  category: string
  passed: boolean
  violations: GuardrailViolation[]
}

export type ScanResult = {
  checks: GuardrailCheck[]
  allPassed: boolean
}

type CacheEntry = { hash: string; result: ScanResult; scannedAt: number }
type ScanCache = Record<string, CacheEntry>

// ─── Pattern groups ───────────────────────────────────────────────────────────

type PatternGroup = { category: string; patterns: RegExp[] }

const GROUPS: PatternGroup[] = [
  {
    category: 'Prompt Injection',
    patterns: [
      /ignore\s+(all\s+)?(previous|prior)\s+(instructions?|prompts?|context|rules?)/i,
      /disregard\s+(all|your|the)\s+(instructions?|guidelines?|rules?|constraints?|system\s+prompt)/i,
      /forget\s+(all\s+)?(previous|prior|your)\s+(instructions?|guidelines?|rules?|context)/i,
      /your\s+new\s+(instructions?|system\s+prompt)\s+(is|are)/i,
      /###\s*SYSTEM\s*###/i,
      /\bdo\s+anything\s+now\b/i,
      /\bdan\s+mode\b/i,
      /override\s+(your\s+)?(safety|instructions?|guidelines?|rules?|constraints?)/i,
      /you\s+must\s+comply/i,
      /new\s+system\s+prompt[:\s]/i,
      /end\s+of\s+(system\s+)?prompt/i,
      /(new|updat\w+|additional|important)\s+(instructions?|rules?|guidelines?|directives?)\s*(:|\bto\s+(ignore|bypass|disregard|override|forget|circumvent)\b)/i,
      /include\s+.{0,60}\s+in\s+your\s+(response|reply|answer|output)/i,
    ],
  },
  {
    category: 'Jailbreak',
    patterns: [
      /you\s+are\s+no\s+longer\s+(bound|restricted|limited|an\s+ai|a\s+language\s+model|constrained)/i,
      /(act|behave|respond)\s+without\s+(restrictions?|limits?|guidelines?|safety|filters?)/i,
      /you\s+(are|have\s+been)\s+(freed|released|unlocked)\s+from\s+(your\s+)?(restrictions?|guidelines?|safety)/i,
      /developer\s+mode\s+(enabled|activated|on)/i,
      /jailbreak\s+(mode|prompt|yourself)/i,
      /from\s+now\s+on\s+(ignore|disregard|forget)\s+(your|all)\s+(safety|guidelines?|restrictions?|rules?)/i,
      /(disable|remove|turn\s+off)\s+(your\s+)?(safety|filters?|restrictions?|guidelines?)/i,
      /bypass\s+your\s+(safety|filters?|restrictions?|guidelines?)/i,
    ],
  },
  {
    category: 'Token Smuggling',
    patterns: [
      /<\|[^|]{0,60}\|>/,
      /<<SYS>>[\s\S]{0,500}?<<\/SYS>>/i,
      /<\s*\/?\s*(system|user|assistant|instruction)\s*>/i,
      /\[\[SYSTEM\]\]/,
      /\[INST\]/i,
      /\[\/INST\]/i,
    ],
  },
  {
    category: 'External Fetch Coercion',
    patterns: [
      /you\s+are\s+(not\s+using\s+the\s+latest|(using\s+)?(an?\s+)?(old|outdated|deprecated|stale)\s+version)/i,
      /(a\s+)?(newer|new|latest|updated)\s+version\s+(of\s+\w+\s+)?(is\s+)?(now\s+)?(available|released|out\b)/i,
      /please\s+(upgrade|update)\s+(to\s+)?(the\s+)?(latest|newest|current)\s+(version|release|build)/i,
      /(upgrade|update)\s+(is\s+)?(required|necessary|needed|recommended)\s+to\s+(continue|proceed|work\s+properly)/i,
      /(run|execute|install)\s+(the\s+)?(latest|newest|updated?)\s+(version|package|release)/i,
      /\b(npm|yarn|pnpm)\s+(install|i|add|update|upgrade)\s+[a-zA-Z@\-/]/i,
      /\b(pip|pip3|pipx)\s+(install|install\s+--upgrade|-U)\s+\S/i,
      /\b(cargo\s+install|go\s+get|brew\s+install|apt(-get)?\s+install)\s+\S/i,
      /(fetch|download|pull|get)\s+(the\s+)?(latest|newest|current|updated?)\s+(script|package|module|dependency|code)\s+(from|at|via)\s+\S/i,
      /(curl|wget)\s+(--?\w+\s+)*https?:\/\/\S+/i,
      /import\s+.*\bfrom\s+["']?(https?:\/\/|unpkg\.|cdn\.jsdelivr\.|skypack\.|esm\.sh|deno\.land\/x\/)/i,
      /(load|fetch|import)\s+(from\s+)?(unpkg|jsdelivr|skypack|esm\.sh|cdnjs|rawgit|raw\.githubusercontent)/i,
      /https?:\/\/registry\.npmjs\.org\/\S+/i,
      /https?:\/\/raw\.githubusercontent\.com\/\S+/i,
      /https?:\/\/pypi\.org\/simple\/\S+/i,
    ],
  },
  {
    category: 'Secret Grabbing',
    patterns: [
      /~\/\.ssh\/(id_rsa|id_ed25519|id_dsa|id_ecdsa|authorized_keys|known_hosts)/i,
      /~\/\.aws\/(credentials|config)\b/i,
      /~\/\.kube\/config\b/i,
      /~\/\.docker\/config\.json\b/i,
      /~\/\.gnupg\//i,
      /~\/\.netrc\b/i,
      /~\/\.npmrc\b/i,
      /~\/\.pypirc\b/i,
      /~\/\.(bash_history|zsh_history|sh_history)\b/i,
      /\/etc\/(passwd|shadow|sudoers)\b/i,
      /(^|[\s"'/])\.env(\.[a-zA-Z]+)?\b/im,
      /~\/\.foundry\/keystores\//i,
      /~\/\.ethereum\/keystore\//i,
      /~\/\.config\/solana\/id\.json\b/i,
      /~\/\.brownie\/accounts\//i,
      /~\/\.bitcoin\/wallet\.dat\b/i,
      /nkbihfbeogaeaoehlefnkodbefgpgknn/,
      /process\.env\.(secret|api_?key|token|password|private_?key|auth|credential|access_?key|github_token|aws_)/i,
      /os\.environ(\[|\.get\()["'](secret|api_?key|token|password|private_?key|auth|credential|access_?key|aws_)/i,
      /getenv\(["'](secret|api_?key|token|password|private_?key|auth|credential|access_?key)/i,
      /ENV\[["'](secret|api_?key|token|password|private_?key|auth|credential|access_?key)/i,
      /\$\{?(SECRET|API_KEY|PRIVATE_KEY|ACCESS_KEY|PASSWORD|AUTH_TOKEN|GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY|DATABASE_URL|DB_PASSWORD|MNEMONIC|SEED_PHRASE|DEPLOYER_PRIVATE_KEY|WALLET_PRIVATE_KEY)\}?/,
      /System\.getenv\(["'](secret|api_?key|token|password|private_?key|auth|credential|access_?key)/i,
      /env::var\(["'](secret|api_?key|token|password|private_?key|auth|credential|access_?key)/i,
      /Environment\.GetEnvironmentVariable\(["'](secret|api_?key|token|password|private_?key|auth|credential|access_?key)/i,
    ],
  },
  {
    category: 'Obfuscation',
    patterns: [
      // Zero-width / invisible chars
      /[\u200B\u200C\u200D\u00AD\uFEFF\u2060\u180E\u034F]/,
      // Fullwidth ASCII lookalikes
      /[\uFF01-\uFF5E]/,
      // Cyrillic homoglyphs of Latin letters
      /[\u0430\u0435\u043E\u0440\u0441\u0445\u0443\u0456\u0455\u0501]/,
      // Greek homoglyphs
      /[\u03B1\u03BF\u03C1\u03BD\u03B5\u03BA]/,
      // Dotless i
      /\u0131/,
      // !`command` execution hint in markdown (but not Rust/macro backtick like vec!` or msg!`)
      /(?:^|[^a-zA-Z0-9_])!`[^`\n]+`/,
      // Mathematical bold/italic/script Unicode alphanumerics (astral plane)
      /[\u{1D400}-\u{1D7FF}]/u,
      // Tags block
      /[\u{E0000}-\u{E007F}]/u,
    ],
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLineNumber(content: string, offset: number): number {
  return content.slice(0, offset).split('\n').length
}

function truncate(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

async function loadCache(): Promise<ScanCache> {
  try {
    const text = await Bun.file(CACHE_PATH).text()
    return JSON.parse(text) as ScanCache
  } catch { return {} }
}

async function saveCache(cache: ScanCache): Promise<void> {
  ensureAgentsDir()
  await Bun.write(CACHE_PATH, JSON.stringify(cache, null, 2))
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scan skill content against security guardrails. Cached by SHA-256 hash.
 * Called at invocation time only - never at load time.
 */
export async function scanSkill(content: string): Promise<ScanResult> {
  const hash = hashContent(content)
  const cache = await loadCache()

  if (cache[hash]) return cache[hash].result

  const checks: GuardrailCheck[] = GROUPS.map(group => {
    const violations: GuardrailViolation[] = []
    for (const pattern of group.patterns) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0
      const globalPat = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
      let match: RegExpExecArray | null
      while ((match = globalPat.exec(content)) !== null) {
        violations.push({
          snippet: truncate(match[0].trim() || match[0]),
          line: getLineNumber(content, match.index),
        })
      }
    }
    return { category: group.category, passed: violations.length === 0, violations }
  })

  const result: ScanResult = { checks, allPassed: checks.every(c => c.passed) }
  cache[hash] = { hash, result, scannedAt: Date.now() }
  await saveCache(cache)
  return result
}

