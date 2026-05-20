/**
 * src/modules/chatbot-rag/index.ts
 *
 * Public surface of the chatbot RAG module.
 *
 * Consumers (BE only — FE never imports this module):
 *   - src/api/routes/copilotkit.ts  (qwen-runpod adapter wire-up; Stage 4)
 *   - tests/integration/**          (E2E chatbot path verification)
 *   - scripts/lora-chatbot/*        (SSOT mirror to Python — Stage 5)
 */

// Existing SSOT (untouched by CP474 Phase B initial commit)
export {
  buildQwenSystemPrompt,
  deriveTrainingLayer,
  ROLE_AND_RULES_KO,
  ROLE_AND_RULES_EN,
  LAYER_BLOCKS,
  type ChatLayer,
  type Lang,
  type V2Summary,
  type V2Core,
  type V2Analysis,
  type V2Segments,
  type V2Section,
  type V2Atom,
  type KeyConcept,
  type MandalaContext,
  type RegionContext,
  type MandalaFit,
  type BlockId,
  type BuildQwenSystemPromptParams,
} from './prompt-builder';

// NEW in CP474 Phase B — shared types
export {
  type UserContext,
  type TranscriptContext,
  type RAGSourceType,
  type RAGResult,
  type RAGContext,
  MAX_MANDALA_TITLES,
  RECENT_DAYS_WINDOW,
  TRANSCRIPT_PROMPT_MAX_CHARS,
} from './types';

// NEW in CP474 Phase B — loaders + retriever + adapter
export { loadUserContext, type LoadUserContextParams } from './user-context-loader';

export {
  loadVideoContext,
  summaryHasUsableContent,
  type VideoGroundingResult,
  type LoadVideoContextParams,
} from './video-context-loader';

export { retrieveRAGContext, type RetrieveRAGContextParams } from './retriever';

export { QwenRunpodAdapter, type QwenRunpodAdapterParams } from './qwen-runpod-adapter';
