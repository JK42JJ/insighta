import type { SourceType } from './types';
import type { SourceAdapter } from './adapter';

class AdapterRegistryImpl {
  private adapters = new Map<SourceType, SourceAdapter>();

  register(adapter: SourceAdapter): void {
    this.adapters.set(adapter.sourceType, adapter);
  }

  get(sourceType: SourceType): SourceAdapter | undefined {
    return this.adapters.get(sourceType);
  }

  getForUrl(url: string): SourceAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      if (adapter.canHandle(url)) return adapter;
    }
    return undefined;
  }

  getAll(): SourceAdapter[] {
    return Array.from(this.adapters.values());
  }

  getSupportedTypes(): SourceType[] {
    return Array.from(this.adapters.keys());
  }
}

export const AdapterRegistry = new AdapterRegistryImpl();
