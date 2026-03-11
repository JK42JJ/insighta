import type { ComponentType } from 'react';
import type { SourceType } from '../model/types';

export type CardView = 'grid' | 'list' | 'compact' | 'detail';

export interface CardRendererProps {
  card: {
    id: string;
    title: string;
    thumbnail: string;
    sourceUrl: string;
    userNote: string;
    createdAt: Date;
    sourceType: SourceType;
    metadata?: Record<string, unknown> | null;
  };
  view: CardView;
}

export type CardRendererComponent = ComponentType<CardRendererProps>;

class CardRendererRegistryImpl {
  private renderers = new Map<SourceType, CardRendererComponent>();
  private defaultRenderer: CardRendererComponent | null = null;

  register(sourceType: SourceType, renderer: CardRendererComponent): void {
    this.renderers.set(sourceType, renderer);
  }

  setDefault(renderer: CardRendererComponent): void {
    this.defaultRenderer = renderer;
  }

  get(sourceType: SourceType): CardRendererComponent | null {
    return this.renderers.get(sourceType) ?? this.defaultRenderer;
  }

  has(sourceType: SourceType): boolean {
    return this.renderers.has(sourceType);
  }

  getRegisteredTypes(): SourceType[] {
    return [...this.renderers.keys()];
  }
}

export const cardRendererRegistry = new CardRendererRegistryImpl();
