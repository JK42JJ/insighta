import { useState, useCallback, useRef, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';

import { apiClient } from '@/shared/lib/api-client';
import type { WizardState, WizardTemplate, SkillType } from '@/shared/types/mandala-ux';

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

const DEFAULT_SKILLS: Record<SkillType, boolean> = {
  newsletter: true,
  alerts: true,
  bias_filter: true,
  report: false,
};

// ─── Hook ───

export function useWizard() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const templateSlug = searchParams.get('template');

  const [state, setState] = useState<WizardState>({
    currentStep: templateSlug ? 2 : 1,
    selectedDomain: null,
    selectedTemplate: null,
    skills: { ...DEFAULT_SKILLS },
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
      currentStep: 2,
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

  // Create from template mutation
  const createMutation = useMutation({
    mutationFn: (params: { templateId: string; skills: Record<string, boolean> }) =>
      fetchWithAuth<CreateFromTemplateResponse>('/mandalas/create-from-template', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: (data) => {
      navigate(`/mandalas/${data.mandalaId}`);
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
      currentStep: 2,
    }));
  }, []);

  const setSkill = useCallback((type: SkillType, enabled: boolean) => {
    setState((prev) => ({
      ...prev,
      skills: { ...prev.skills, [type]: enabled },
    }));
  }, []);

  const goToStep = useCallback((step: 1 | 2 | 3) => {
    setState((prev) => ({ ...prev, currentStep: step }));
  }, []);

  const complete = useCallback(() => {
    const templateId = state.selectedTemplate?.id;
    if (!templateId) return;
    createMutateRef.current({ templateId, skills: state.skills });
  }, [state.selectedTemplate?.id, state.skills]);

  return {
    ...state,
    templates: templates ?? [],
    isLoadingTemplates,
    isLoadingDetail,
    isCreating: createMutation.isPending,
    createError: createMutation.error,
    selectDomain,
    selectTemplate,
    setSkill,
    goToStep,
    complete,
  };
}
