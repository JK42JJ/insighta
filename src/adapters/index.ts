/**
 * DataSourceAdapter Module Exports
 *
 * Central export point for all adapter-related functionality.
 *
 * @version 1.0.0
 * @since 2025-12-17
 */

// ============================================================================
// Core Interfaces and Types
// ============================================================================

export * from './DataSourceAdapter';

// ============================================================================
// Adapter Implementations
// ============================================================================

export { YouTubeAdapter } from './YouTubeAdapter';

// ============================================================================
// Registry and Factory
// ============================================================================

export { AdapterRegistry, getAdapterRegistry } from './AdapterRegistry';
export {
  createAdapter,
  createAndInitializeAdapter,
  registerAdapterConstructor,
  unregisterAdapterConstructor,
  getSupportedSourceTypes,
  isAdapterSupported,
  clearAdapterConstructors,
} from './AdapterFactory';
