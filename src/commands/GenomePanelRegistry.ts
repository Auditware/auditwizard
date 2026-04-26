// GenomePanelRegistry - typed panel opener registry.
// Each genome module registers its panels here during App init.
// Commands open panels by name without knowing about React state.
// If a panel's genome is absent, the open() call is silently ignored.

export type PanelConfigs = {
  'model':      void
  'api-key':    void
  'pet':        void
  'skills':     void
}

export type PanelName = keyof PanelConfigs

// Per-App instance. Create via new GenomePanelRegistry() inside App.
export class GenomePanelRegistry {
  private readonly openers = new Map<string, (config?: unknown) => void>()

  register<K extends PanelName>(
    name: K,
    opener: PanelConfigs[K] extends void ? () => void : (config: PanelConfigs[K]) => void,
  ): void {
    this.openers.set(name, opener as (config?: unknown) => void)
  }

  open<K extends PanelName>(
    name: K,
    ...args: PanelConfigs[K] extends void ? [] : [PanelConfigs[K]]
  ): void {
    const fn = this.openers.get(name)
    if (!fn) return  // genome not active - no-op
    fn(args[0] as unknown)
  }

  has(name: PanelName): boolean {
    return this.openers.has(name)
  }
}
