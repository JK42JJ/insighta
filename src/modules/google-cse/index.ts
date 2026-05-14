/**
 * Google Custom Search Engine (CSE) module — public API.
 *
 * CP458 T4-1 PoC: web search fallback for sparse-domain mandalas.
 */

export { loadGoogleCseConfig, googleCseConfig } from './config';
export type { GoogleCseConfig } from './config';
export { createGoogleCseClient } from './client';
export type { CseItem, CseSearchResult, SearchWebOptions } from './client';
