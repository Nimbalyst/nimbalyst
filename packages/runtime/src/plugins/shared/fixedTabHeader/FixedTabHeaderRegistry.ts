import type { FixedTabHeaderProvider, TabContext } from './types';

export class FixedTabHeaderRegistry {
  private static instance: FixedTabHeaderRegistry;
  private providers: Map<string, FixedTabHeaderProvider> = new Map();

  private constructor() {}

  static getInstance(): FixedTabHeaderRegistry {
    if (!FixedTabHeaderRegistry.instance) {
      FixedTabHeaderRegistry.instance = new FixedTabHeaderRegistry();
    }
    return FixedTabHeaderRegistry.instance;
  }

  register(provider: FixedTabHeaderProvider): void {
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): void {
    this.providers.delete(id);
  }

  getProviders(context: TabContext): FixedTabHeaderProvider[] {
    const activeProviders = Array.from(this.providers.values())
      .filter(provider => provider.shouldRender(context))
      .sort((a, b) => b.priority - a.priority);

    return activeProviders;
  }

  clear(): void {
    this.providers.clear();
  }
}
