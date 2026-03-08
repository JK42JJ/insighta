import { cardRendererRegistry } from './CardRendererRegistry';
import { YouTubeRenderer } from './renderers/YouTubeRenderer';
import { ArticleRenderer } from './renderers/ArticleRenderer';
import { DefaultRenderer } from './renderers/DefaultRenderer';

let initialized = false;

export function initCardRenderers(): void {
  if (initialized) return;

  cardRendererRegistry.register('youtube', YouTubeRenderer);
  cardRendererRegistry.register('article', ArticleRenderer);
  cardRendererRegistry.register('podcast', DefaultRenderer);
  cardRendererRegistry.register('book', DefaultRenderer);
  cardRendererRegistry.setDefault(DefaultRenderer);

  initialized = true;
}
