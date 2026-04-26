// Shared DailyWarden data fetching - used by both WardenPanel and the daily_warden tool.

export type Contest = {
  name: string
  platform?: string
  potSize?: string
  startDate?: number
  endDate?: number
  url?: string
  description?: string
  [key: string]: unknown
}

export type WardenData = {
  active: Contest[]
  upcoming: Contest[]
  fetchedAt: number
}

export async function fetchDailyWardenContests(): Promise<WardenData> {
  const res = await fetch('https://www.dailywarden.com/', {
    headers: { 'User-Agent': 'forefy/agent' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching dailywarden.com`)

  const html = await res.text()
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match?.[1]) throw new Error('__NEXT_DATA__ not found in dailywarden.com response')

  let nextData: Record<string, unknown>
  try {
    nextData = JSON.parse(match[1]) as Record<string, unknown>
  } catch {
    throw new Error('Failed to parse __NEXT_DATA__ JSON from dailywarden.com')
  }

  const pageProps = (nextData['props'] as Record<string, unknown> | undefined)?.['pageProps'] as Record<string, unknown> | undefined
  if (!pageProps) throw new Error('pageProps not found in __NEXT_DATA__')

  const contests = (
    (pageProps['contests'] as Record<string, unknown> | undefined)?.['flattened'] ??
    (pageProps['contests'] as Contest[] | undefined) ??
    []
  ) as Contest[]

  const now = Date.now()
  const active: Contest[] = []
  const upcoming: Contest[] = []

  for (const c of contests) {
    const end = typeof c['endDate'] === 'number' ? c['endDate'] : Infinity
    const start = typeof c['startDate'] === 'number' ? c['startDate'] : 0
    if (end > now && start <= now) active.push(c)
    else if (start > now) upcoming.push(c)
  }

  return { active, upcoming, fetchedAt: now }
}
