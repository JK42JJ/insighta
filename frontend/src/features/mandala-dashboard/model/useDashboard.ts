import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/shared/lib/api-client';
import {
  SKILL_TYPES,
  type DashboardResponse,
  type DashboardCell,
  type DashboardStats,
  type SkillType,
} from '@/shared/types/mandala-ux';

// ─── API helper (same pattern as mandala-editor/useEditor.ts) ───

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
    throw new Error(`Dashboard API error: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

// ─── Response types ───

interface DashboardApiResponse {
  mandala: {
    id: string;
    title: string;
    centerLabel: string;
    subLabels: string[];
  };
  cells: DashboardCell[];
  skills: Record<string, boolean>;
  stats: {
    filledCells: number;
    totalCells: number;
    totalVideos: number;
    streakDays: number;
  };
}

function transformToDashboard(data: DashboardApiResponse): DashboardResponse {
  const { mandala, cells, skills: apiSkills, stats: apiStats } = data;

  // Iterate over SKILL_TYPES (SSOT) so any new skill type added there
  // automatically flows through. Hardcoding the keys was the source of
  // a video_discover-shaped hole that silently rendered as OFF.
  const skills = SKILL_TYPES.reduce<Record<SkillType, boolean>>(
    (acc, key) => {
      acc[key] = apiSkills?.[key] ?? false;
      return acc;
    },
    {} as Record<SkillType, boolean>
  );

  const stats: DashboardStats = {
    filledCells: apiStats.filledCells,
    totalCells: apiStats.totalCells,
    totalVideos: apiStats.totalVideos,
    streakDays: apiStats.streakDays,
    avgRelevance: 0,
  };

  return {
    mandala: {
      id: mandala.id,
      title: mandala.title,
      centerLabel: mandala.centerLabel,
      subLabels: mandala.subLabels,
    },
    resume: null,
    cells,
    recommendations: [],
    skills,
    filteredVideos: [],
    stats,
  };
}

// ─── Hook ───

export function useDashboard(mandalaId: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['mandala', 'dashboard', mandalaId],
    queryFn: () => fetchWithAuth<DashboardApiResponse>(`/mandalas/${mandalaId}/dashboard`),
    enabled: !!mandalaId,
    staleTime: 5 * 60 * 1000,
    select: transformToDashboard,
    retry: (failureCount, err: unknown) => {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 403) return false;
      return failureCount < 2;
    },
  });

  return {
    dashboard: data ?? null,
    isLoading,
    error,
  };
}
