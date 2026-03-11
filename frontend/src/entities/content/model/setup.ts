import { AdapterRegistry } from './registry';
import { YouTubeAdapter } from './adapters/youtube';
import { ArticleAdapter } from './adapters/article';

let initialized = false;

export function initAdapters(): void {
  if (initialized) return;
  AdapterRegistry.register(YouTubeAdapter);
  AdapterRegistry.register(ArticleAdapter);
  initialized = true;
}
