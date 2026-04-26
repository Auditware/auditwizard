// Theme: semantic color tokens used throughout audit-wizard's TUI.
// Every color that animates has a shimmer pair (~20-30 lightness points lighter).
// Values chosen for both dark and light terminal backgrounds.

export interface Theme {
  // Brand
  brand: string
  brandShimmer: string

  // Semantic states
  success: string
  error: string
  warning: string
  suggestion: string // selection highlight, hints, matched chars

  // Permission / self-fix interaction
  permission: string
  permissionShimmer: string

  // Prompt input
  promptBorder: string
  promptBorderShimmer: string

  // Structure / text
  inactive: string // dimmed / secondary
  subtle: string   // hints-below-hints
  text: string
  inverseText: string

  // Diff colors
  diffAdded: string
  diffAddedDimmed: string
  diffAddedWord: string
  diffRemoved: string
  diffRemovedDimmed: string
  diffRemovedWord: string

  // Mode-specific (each mode gets a unique color)
  modeAgent: string    // normal agent mode
  modeSession: string  // session picker / manager

  // Reload notification
  reload: string
}

export const darkTheme: Theme = {
  brand: '#7C3AED',         // violet
  brandShimmer: '#A78BFA',

  success: '#22C55E',
  error: '#EF4444',
  warning: '#F59E0B',
  suggestion: '#38BDF8',    // sky blue - selection, matched chars

  permission: '#F59E0B',
  permissionShimmer: '#FCD34D',

  promptBorder: '#4B5563',
  promptBorderShimmer: '#9CA3AF',

  inactive: '#6B7280',
  subtle: '#374151',
  text: '#F9FAFB',
  inverseText: '#111827',

  diffAdded: '#166534',
  diffAddedDimmed: '#14532D',
  diffAddedWord: '#4ADE80',
  diffRemoved: '#7F1D1D',
  diffRemovedDimmed: '#450A0A',
  diffRemovedWord: '#F87171',

  modeAgent: '#7C3AED',    // violet = normal
  modeSession: '#0EA5E9',  // sky = session browser

  reload: '#A78BFA',
}

export const lightTheme: Theme = {
  brand: '#6D28D9',
  brandShimmer: '#8B5CF6',

  success: '#16A34A',
  error: '#DC2626',
  warning: '#D97706',
  suggestion: '#0284C7',

  permission: '#D97706',
  permissionShimmer: '#F59E0B',

  promptBorder: '#9CA3AF',
  promptBorderShimmer: '#4B5563',

  inactive: '#9CA3AF',
  subtle: '#E5E7EB',
  text: '#111827',
  inverseText: '#F9FAFB',

  diffAdded: '#DCFCE7',
  diffAddedDimmed: '#F0FDF4',
  diffAddedWord: '#16A34A',
  diffRemoved: '#FEE2E2',
  diffRemovedDimmed: '#FFF5F5',
  diffRemovedWord: '#DC2626',

  modeAgent: '#6D28D9',
  modeSession: '#0369A1',

  reload: '#8B5CF6',
}

// Detect terminal background preference. Default dark.
function detectTheme(): Theme {
  const colorfgbg = process.env['COLORFGBG']
  if (colorfgbg) {
    const bg = parseInt(colorfgbg.split(';').pop() ?? '0')
    if (bg >= 8) return lightTheme
  }
  return darkTheme
}

export const theme: Theme = detectTheme()
