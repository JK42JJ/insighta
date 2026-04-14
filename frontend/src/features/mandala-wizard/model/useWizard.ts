import { useState, useCallback, useRef, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/shared/config/query-client';

import { apiClient } from '@/shared/lib/api-client';
import { useAuth } from '@/features/auth/model/useAuth';
import { useMandalaStore } from '@/stores/mandalaStore';
import { trackMandalaCreated } from '@/shared/lib/posthog';
import {
  LINKED_SKILL_TOGGLES,
  type WizardState,
  type WizardTemplate,
  type SkillType,
  type MandalaSearchResult,
  type GeneratedMandala,
} from '@/shared/types/mandala-ux';

// ─── Language detection — detect from goal text, not UI locale ───

function detectGoalLanguage(goal: string): 'ko' | 'en' {
  const koreanCharCount = (goal.match(/[\uAC00-\uD7AF\u3130-\u318F]/g) || []).length;
  return koreanCharCount > 0 ? 'ko' : 'en';
}

// ─── API helpers (follows useEditor.ts pattern) ───

async function fetchWithAuth<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  await apiClient.tokenReady;
  const token = apiClient.getAccessToken();
  const baseUrl = (apiClient as unknown as { baseUrl: string }).baseUrl;
  const url = `${baseUrl}/api/v1${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Wizard API error: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

// ─── API response types ───

interface ExploreResponse {
  mandalas: Array<{
    id: string;
    title: string;
    shareSlug: string | null;
    likeCount: number;
    rootLevel: {
      centerGoal: string;
      subjects: string[];
      subjectLabels?: string[];
    };
  }>;
  total: number;
  page: number;
  limit: number;
}

interface PublicMandalaResponse {
  mandala: {
    id: string;
    title: string;
    shareSlug: string | null;
    likeCount: number;
    levels: Array<{
      levelKey: string;
      centerGoal: string;
      subjects: string[];
      depth: number;
      position: number;
    }>;
  };
}

interface CreateFromTemplateResponse {
  mandalaId: string;
}

// ─── Default skill state ───

// Default skill state for a brand-new mandala. SSOT keys live in
// shared/types/mandala-ux.ts. Six user-visible skills default ON; the
// linked system skill (video_discover) is also ON via setSkill linkage
// when "recommend" lands. trend_collector + iks_scorer are cron-only
// system plugins; they have no per-mandala row, so they're omitted.
const DEFAULT_SKILLS: Record<SkillType, boolean> = {
  newsletter: true,
  report: true,
  alert: true,
  recommend: true,
  script: true,
  blog: true,
  video_discover: true,
  trend_collector: false,
  iks_scorer: false,
};

// ─── Hook ───

export function useWizard() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  useTranslation(); // i18n context required by child components

  const templateSlug = searchParams.get('template');

  const [state, setState] = useState<WizardState>({
    currentStep: 1,
    selectedDomain: null,
    selectedTemplate: null,
    skills: { ...DEFAULT_SKILLS },
    goalInput: '',
    focusTags: [],
    targetLevel: 'standard',
  });

  // Fetch templates for selected domain
  const { data: templates, isLoading: isLoadingTemplates } = useQuery({
    queryKey: ['wizard', 'templates', state.selectedDomain],
    queryFn: () =>
      fetchWithAuth<ExploreResponse>(
        `/mandalas/explore?source=template&domain=${state.selectedDomain}`
      ),
    enabled: !!state.selectedDomain,
    staleTime: 5 * 60 * 1000,
    select: (data): WizardTemplate[] =>
      data.mandalas.map((m) => ({
        id: m.id,
        title: m.title,
        shareSlug: m.shareSlug,
        likeCount: m.likeCount,
        centerGoal: m.rootLevel.centerGoal,
        subjects: m.rootLevel.subjects,
        subDetails: {},
      })),
  });

  // Fetch full template detail when selected (for sub-details)
  const selectedSlug = state.selectedTemplate?.shareSlug;
  const { data: templateDetail, isLoading: isLoadingDetail } = useQuery({
    queryKey: ['wizard', 'template-detail', selectedSlug],
    queryFn: () => fetchWithAuth<PublicMandalaResponse>(`/mandalas/public/${selectedSlug}`),
    enabled: !!selectedSlug,
    staleTime: 10 * 60 * 1000,
  });

  // When template detail loads, merge sub-details into selected template
  const detailLevels = templateDetail?.mandala?.levels;
  useEffect(() => {
    if (!detailLevels || !state.selectedTemplate) return;

    const rootLevel = detailLevels.find((l) => l.depth === 0);
    if (!rootLevel) return;

    const subDetails: Record<number, string[]> = {};
    const subjects = rootLevel.subjects;

    // depth=1 levels correspond to each subject
    const childLevels = detailLevels
      .filter((l) => l.depth === 1)
      .sort((a, b) => a.position - b.position);

    childLevels.forEach((child, idx) => {
      subDetails[idx] = child.subjects;
    });

    setState((prev) => {
      if (!prev.selectedTemplate) return prev;
      return {
        ...prev,
        selectedTemplate: {
          ...prev.selectedTemplate,
          centerGoal: rootLevel.centerGoal,
          subjects,
          subDetails,
        },
      };
    });
  }, [detailLevels]); // eslint-disable-line react-hooks/exhaustive-deps

  // URL-based template loading (skip to step 2)
  const { data: urlTemplateDetail } = useQuery({
    queryKey: ['wizard', 'url-template', templateSlug],
    queryFn: () => fetchWithAuth<PublicMandalaResponse>(`/mandalas/public/${templateSlug}`),
    enabled: !!templateSlug,
    staleTime: 10 * 60 * 1000,
  });

  const urlTemplateMandala = urlTemplateDetail?.mandala;
  const urlInitRef = useRef(false);
  useEffect(() => {
    if (!urlTemplateMandala || urlInitRef.current) return;
    urlInitRef.current = true;

    const rootLevel = urlTemplateMandala.levels.find((l) => l.depth === 0);
    if (!rootLevel) return;

    const subDetails: Record<number, string[]> = {};
    const childLevels = urlTemplateMandala.levels
      .filter((l) => l.depth === 1)
      .sort((a, b) => a.position - b.position);

    childLevels.forEach((child, idx) => {
      subDetails[idx] = child.subjects;
    });

    setState((prev) => ({
      ...prev,
      currentStep: 3,
      selectedTemplate: {
        id: urlTemplateMandala.id,
        title: urlTemplateMandala.title,
        shareSlug: urlTemplateMandala.shareSlug,
        likeCount: urlTemplateMandala.likeCount ?? 0,
        centerGoal: rootLevel.centerGoal,
        subjects: rootLevel.subjects,
        subDetails,
      },
    }));
  }, [urlTemplateMandala]);

  // AbortController for canceling in-flight search + generate requests.
  // Stored in a ref so cancel() can reach the current controller across renders.
  const goalAbortRef = useRef<AbortController | null>(null);

  // ─── Tier 1: Embedding search (instant) ───
  const searchMutation = useMutation({
    mutationFn: (goal: string) =>
      apiClient.searchMandalasByGoal(goal, {
        limit: 3,
        language: detectGoalLanguage(goal),
        signal: goalAbortRef.current?.signal,
      }),
  });

  // ─── Tier 2: LoRA AI generation (background, ~80s) ───
  const generateMutation = useMutation({
    mutationFn: (goal: string) =>
      apiClient.generateMandala(goal, {
        language: detectGoalLanguage(goal),
        signal: goalAbortRef.current?.signal,
      }),
  });

  // ─── Delay detection — CP361 Issue #375 ───
  //
  // Soft timeouts that signal "this is taking longer than usual" without
  // canceling the in-flight request. The request may still complete
  // successfully after the flag fires — in that case the caller just
  // replaces the soft-slow hint with the real result. Hard errors set
  // the failed flag immediately.
  //
  // The soft-slow and failed states are DELIBERATELY SEPARATE:
  //
  //   - soft-slow → keep skeleton + neutral-colored hint text
  //                 ("평소보다 조금 걸리고 있어요"). NO retry button.
  //                 The user should wait; the request is still alive.
  //   - failed    → amber DelayedCard with Retry button. The request
  //                 actually threw (HTTP error, abort, hard timeout).
  //
  // Combining these into one flag (as the pre-CP361 code did) caused
  // a "success flash" UX bug: a short transient amber warning just
  // before the real result arrived, which users reported as
  // "에러났네? → 어 됐네?" confusion on the jamie24kim account.
  //
  // Threshold tuning from observed prod latencies:
  //
  //   - SEARCH_DELAY_MS 8000 — template search calls Mac Mini Ollama
  //       qwen3-embedding:8b (2-10s depending on warm state) then
  //       pgvector cosine similarity (<0.5s). The old 5000 value cut
  //       the warm→cold transition too aggressively.
  //
  //   - GENERATE_DELAY_MS 60000 — LoRA + LLM race averages 30-45s
  //       under normal conditions. Old 45000 raced against typical
  //       completion times. 60000 gives headroom to avoid the flash.
  //       Phased progress labels (see WizardStepGoal) keep the user
  //       oriented during the long wait.
  const SEARCH_DELAY_MS = 8000;
  const GENERATE_DELAY_MS = 60000;

  const [isSearchSoftSlow, setIsSearchSoftSlow] = useState(false);
  const [isGenerateSoftSlow, setIsGenerateSoftSlow] = useState(false);

  useEffect(() => {
    if (!searchMutation.isPending) {
      setIsSearchSoftSlow(false);
      return;
    }
    setIsSearchSoftSlow(false);
    const id = window.setTimeout(() => setIsSearchSoftSlow(true), SEARCH_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [searchMutation.isPending]);

  useEffect(() => {
    if (!generateMutation.isPending) {
      setIsGenerateSoftSlow(false);
      return;
    }
    setIsGenerateSoftSlow(false);
    const id = window.setTimeout(() => setIsGenerateSoftSlow(true), GENERATE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [generateMutation.isPending]);

  const isSearchFailed = Boolean(searchMutation.error);
  const isGenerateFailed = Boolean(generateMutation.error);

  // Post-creation routing: select the new mandala in the global store BEFORE
  // navigating, so IndexPage's effective-mandala resolution lands on it
  // immediately. CP358: wizard now lands on the unified `/` dashboard (the
  // legacy `/mandalas/:id` MandalaDashboardPage redirect is a separate unit).
  //
  // Cache invalidation: useMandalaList has staleTime 30s. Without invalidating,
  // both IndexPage and SidebarMandalaSection render with stale data and the
  // freshly created mandala is missing from the list — store selection points
  // to a non-existent entry, fallback default mandala wins.
  const selectMandalaInStore = useMandalaStore((s) => s.selectMandala);
  const setJustCreated = useMandalaStore((s) => s.setJustCreated);
  const queryClient = useQueryClient();
  // Bug #3 v2: optimistic cache injection instead of await refetchQueries.
  // setQueryData synchronously injects the new mandala into the list cache,
  // so IndexPage sees it immediately on mount. Background invalidation
  // replaces the stub with full server data.
  const goToUnifiedDashboard = useCallback(
    async (newMandalaId: string, title?: string) => {
      // 1. Optimistic: inject minimal mandala into list cache
      queryClient.setQueryData(
        queryKeys.mandala.list(),
        (old: { mandalas: Array<Record<string, unknown>>; total: number } | undefined) => {
          if (!old) return old;
          const exists = old.mandalas.some((m) => m.id === newMandalaId);
          if (exists) return old;
          return {
            ...old,
            total: old.total + 1,
            mandalas: [
              ...old.mandalas,
              {
                id: newMandalaId,
                userId: user?.id ?? '',
                title: title ?? state.selectedTemplate?.centerGoal ?? 'New Mandala',
                isDefault: false,
                isPublic: false,
                shareSlug: null,
                position: old.mandalas.length,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                levels: [
                  {
                    depth: 0,
                    centerGoal: state.selectedTemplate?.centerGoal ?? title ?? '',
                    centerLabel: state.selectedTemplate?.centerLabel ?? title ?? '',
                    subjects: state.selectedTemplate?.subjects ?? [],
                    subjectLabels: state.selectedTemplate?.subLabels ?? [],
                  },
                ],
              },
            ],
          };
        }
      );

      // 2. Select in store + mark as just-created (enables card polling)
      selectMandalaInStore(newMandalaId);
      setJustCreated(newMandalaId);
      console.log(
        '[DEBUG-WIZARD] setJustCreated called with:',
        newMandalaId,
        'store value:',
        useMandalaStore.getState().justCreatedMandalaId
      );

      // 3. Persist as default mandala on server (survives page refresh)
      apiClient.updateMandala(newMandalaId, { isDefault: true }).catch(() => {
        // Non-blocking — Zustand selection still works for current session
      });
      trackMandalaCreated({
        mandala_id: newMandalaId,
        template_id: state.selectedTemplate?.id,
        language: detectGoalLanguage(state.goalInput),
      });

      // 3. Invalidate list cache so sidebar fetches fresh data on mount
      await queryClient.invalidateQueries({
        queryKey: queryKeys.mandala.list(),
        refetchType: 'all',
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.quota() });
      navigate('/');
    },
    [navigate, selectMandalaInStore, setJustCreated, queryClient, state.selectedTemplate, user]
  );

  // Create from template mutation (for DB templates)
  const createMutation = useMutation({
    mutationFn: (params: {
      templateId: string;
      skills: Record<string, boolean>;
      focusTags?: string[];
      targetLevel?: string;
    }) =>
      fetchWithAuth<CreateFromTemplateResponse>('/mandalas/create-from-template', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: (data) => {
      goToUnifiedDashboard(data.mandalaId);
    },
  });

  // Create blank mandala mutation (for "처음부터 직접 만들기" / "Create from scratch")
  // Blank mandalas need an editor first — keep them on the editor route.
  const createBlankMutation = useMutation({
    mutationFn: () =>
      fetchWithAuth<{ mandala: { id: string } }>('/mandalas/create', {
        method: 'POST',
        body: JSON.stringify({ title: '새 만다라트', levels: [] }),
      }),
    onSuccess: (data) => {
      navigate(`/mandalas/${data.mandala.id}/edit`);
    },
  });

  // Create with full data mutation (for search results + AI generated)
  const createWithDataMutation = useMutation({
    mutationFn: (params: {
      title: string;
      centerGoal: string;
      subjects: string[];
      subDetails?: Record<string, string[]>;
      skills?: Record<string, boolean>;
      centerLabel?: string;
      subLabels?: string[];
      focusTags?: string[];
      targetLevel?: string;
    }) => apiClient.createMandalaWithData(params),
    onSuccess: (data) => {
      goToUnifiedDashboard(data.mandalaId);
    },
  });

  // Stable ref for createMutation.mutate (avoid infinite loops)
  const createMutateRef = useRef(createMutation.mutate);
  useEffect(() => {
    createMutateRef.current = createMutation.mutate;
  }, [createMutation.mutate]);

  // ─── Actions ───

  const selectDomain = useCallback((domainId: string) => {
    setState((prev) => ({ ...prev, selectedDomain: domainId }));
  }, []);

  const selectTemplate = useCallback((template: WizardTemplate) => {
    setState((prev) => ({
      ...prev,
      selectedTemplate: template,
    }));
  }, []);

  const setSkill = useCallback((type: SkillType, enabled: boolean) => {
    setState((prev) => {
      const next = { ...prev.skills, [type]: enabled };
      // Linked toggles: e.g. recommend → also flip video_discover so the
      // backend pipeline lights up alongside the user-facing toggle.
      const linked = LINKED_SKILL_TOGGLES[type] ?? [];
      for (const linkedKey of linked) {
        next[linkedKey] = enabled;
      }
      return { ...prev, skills: next };
    });
  }, []);

  const goToStep = useCallback((step: 1 | 2 | 3) => {
    setState((prev) => ({ ...prev, currentStep: step }));
  }, []);

  const setFocusTags = useCallback((tags: string[]) => {
    setState((prev) => ({ ...prev, focusTags: tags }));
  }, []);

  const setTargetLevel = useCallback((level: string) => {
    setState((prev) => ({ ...prev, targetLevel: level }));
  }, []);

  // ─── Hybrid search + generate actions ───

  const setGoalInput = useCallback((goal: string) => {
    setState((prev) => ({ ...prev, goalInput: goal }));
  }, []);

  /**
   * Submit goal: fires both Tier 1 (search) and Tier 2 (generate) in parallel.
   * Search results arrive in ~2s, generation takes ~80s.
   * If a previous request is in flight, it is canceled first (single-flight).
   */
  const submitGoal = useCallback(
    (goal: string) => {
      const trimmed = goal.trim();
      if (!trimmed) return;
      // Cancel any prior in-flight requests + reset mutation state
      if (goalAbortRef.current) {
        goalAbortRef.current.abort();
      }
      goalAbortRef.current = new AbortController();
      searchMutation.reset();
      generateMutation.reset();
      setState((prev) => ({ ...prev, goalInput: trimmed }));
      searchMutation.mutate(trimmed);
      generateMutation.mutate(trimmed);
    },
    [searchMutation, generateMutation]
  );

  /** Cancel in-flight search + generate, clear results */
  const cancelGoal = useCallback(() => {
    if (goalAbortRef.current) {
      goalAbortRef.current.abort();
      goalAbortRef.current = null;
    }
    searchMutation.reset();
    generateMutation.reset();
  }, [searchMutation, generateMutation]);

  /** Clear input + cancel any in-flight requests */
  const clearGoal = useCallback(() => {
    cancelGoal();
    setState((prev) => ({ ...prev, goalInput: '' }));
  }, [cancelGoal]);

  /** Retry template search only (leaves in-flight AI generation untouched). */
  const retrySearch = useCallback(() => {
    const goal = state.goalInput.trim();
    if (!goal) return;
    searchMutation.reset();
    searchMutation.mutate(goal);
  }, [state.goalInput, searchMutation]);

  /** Retry AI generation only (leaves in-flight template search untouched). */
  const retryGenerate = useCallback(() => {
    const goal = state.goalInput.trim();
    if (!goal) return;
    generateMutation.reset();
    generateMutation.mutate(goal);
  }, [state.goalInput, generateMutation]);

  /** Create a blank mandala (skip the wizard flow) and navigate to its editor */
  const createBlank = useCallback(() => {
    createBlankMutation.mutate();
  }, [createBlankMutation]);

  /** Convert a search result to a WizardTemplate and select it */
  const selectSearchResult = useCallback((result: MandalaSearchResult) => {
    // Map sub_actions (Record<number, string[]>) → subDetails (same structure)
    const subDetails: Record<number, string[]> = {};
    if (result.sub_actions) {
      for (const [k, v] of Object.entries(result.sub_actions)) {
        subDetails[Number(k)] = Array.isArray(v) ? v : [];
      }
    }

    const template: WizardTemplate = {
      // Prefer real user_mandalas.id when available (enables source_template_id linkage in clone path)
      id: result.template_mandala_id ?? result.mandala_id,
      title: result.center_goal,
      shareSlug: null,
      likeCount: 0,
      centerGoal: result.center_goal,
      centerLabel: result.center_label,
      subjects: result.sub_goals,
      subLabels: result.sub_labels,
      subDetails,
    };
    setState((prev) => ({
      ...prev,
      selectedTemplate: template,
    }));
  }, []);

  /** Select an AI-generated mandala (from Tier 2 or Tier 3) */
  const selectGeneratedMandala = useCallback((generated: GeneratedMandala) => {
    const subDetails: Record<number, string[]> = {};
    let totalActions = 0;
    generated.sub_goals.forEach((_, idx) => {
      const key = `sub_goal_${idx + 1}`;
      const actions =
        generated.actions[key] ??
        generated.actions[String(idx)] ??
        generated.actions[generated.sub_goals[idx]] ??
        [];
      subDetails[idx] = actions;
      totalActions += actions.length;
    });
    // Validate: AI-generated mandala MUST have actions populated (one-shot generation)
    if (totalActions < 56) {
      throw new Error(
        `AI generated mandala is incomplete: ${totalActions}/64 actions (minimum 56). Please retry.`
      );
    }
    const template: WizardTemplate = {
      id: `ai-generated-${Date.now()}`,
      title: generated.center_goal,
      shareSlug: null,
      likeCount: 0,
      centerGoal: generated.center_goal,
      centerLabel: generated.center_label,
      subjects: generated.sub_goals,
      subLabels: generated.sub_labels,
      subDetails,
    };
    setState((prev) => ({
      ...prev,
      selectedTemplate: template,
    }));
  }, []);

  const complete = useCallback(() => {
    const template = state.selectedTemplate;
    if (!template) return;

    // UUID format check: DB templates have UUID; search results use their original UUID;
    // AI-generated uses `ai-generated-{timestamp}` which is not a UUID.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUuid = UUID_RE.test(template.id);
    const hasRichData = template.subDetails && Object.keys(template.subDetails).length > 0;

    // If template has rich data (actions) OR is not a real DB UUID, use create-with-data
    if (hasRichData || !isUuid) {
      const subDetailsKeyed: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(template.subDetails ?? {})) {
        subDetailsKeyed[String(k)] = v;
      }
      createWithDataMutation.mutate({
        title: template.title,
        centerGoal: template.centerGoal,
        subjects: template.subjects,
        subDetails: subDetailsKeyed,
        skills: state.skills,
        centerLabel: template.centerLabel,
        subLabels: template.subLabels,
        focusTags: state.focusTags.length > 0 ? state.focusTags : undefined,
        targetLevel: state.targetLevel !== 'standard' ? state.targetLevel : undefined,
      });
    } else {
      // DB template clone (keeps source_template_id linkage)
      createMutateRef.current({
        templateId: template.id,
        skills: state.skills,
        focusTags: state.focusTags.length > 0 ? state.focusTags : undefined,
        targetLevel: state.targetLevel !== 'standard' ? state.targetLevel : undefined,
      });
    }
  }, [
    state.selectedTemplate,
    state.skills,
    state.focusTags,
    state.targetLevel,
    createWithDataMutation,
  ]);

  return {
    ...state,
    templates: templates ?? [],
    isLoadingTemplates,
    isLoadingDetail,
    isCreating: createMutation.isPending || createWithDataMutation.isPending,
    createError: createMutation.error ?? createWithDataMutation.error,
    selectDomain,
    selectTemplate,
    setSkill,
    goToStep,
    complete,
    setFocusTags,
    setTargetLevel,
    // Hybrid search + generate
    setGoalInput,
    submitGoal,
    cancelGoal,
    clearGoal,
    createBlank,
    isCreatingBlank: createBlankMutation.isPending,
    selectSearchResult,
    selectGeneratedMandala,
    searchResults: searchMutation.data ?? [],
    isSearching: searchMutation.isPending,
    // CP358: isSuccess gates the empty-state UI to eliminate the 1-frame
    // race where reset() flips isPending to false before mutate() runs.
    // isSuccess is only true when data has actually arrived from the server.
    searchSucceeded: searchMutation.isSuccess,
    searchError: searchMutation.error,
    // CP361 Issue #375 — split soft-slow vs failed states
    isSearchSoftSlow,
    isSearchFailed,
    retrySearch,
    aiGenerated: generateMutation.data?.mandala ?? null,
    aiSource: generateMutation.data?.source ?? null,
    isGenerating: generateMutation.isPending,
    generateError: generateMutation.error,
    isGenerateSoftSlow,
    isGenerateFailed,
    retryGenerate,
  };
}
