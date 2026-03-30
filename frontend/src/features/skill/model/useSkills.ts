import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { queryKeys } from '@/shared/config/query-client';
import { useAuth } from '@/features/auth/model/useAuth';

export function useSkillList() {
  const { isLoggedIn, isTokenReady } = useAuth();

  return useQuery({
    queryKey: queryKeys.skills.list(),
    queryFn: () => apiClient.listSkills(),
    enabled: isLoggedIn && isTokenReady,
    staleTime: 60_000,
  });
}

export function useSkillPreview() {
  return useMutation({
    mutationFn: ({ skillId, mandalaId }: { skillId: string; mandalaId: string }) =>
      apiClient.previewSkill(skillId, mandalaId),
  });
}

export function useSkillExecute() {
  return useMutation({
    mutationFn: ({ skillId, mandalaId }: { skillId: string; mandalaId: string }) =>
      apiClient.executeSkill(skillId, mandalaId),
  });
}

export function useSkillOutputs(mandalaId: string | null) {
  const { isLoggedIn, isTokenReady } = useAuth();

  return useQuery({
    queryKey: queryKeys.skills.outputs(mandalaId ?? ''),
    queryFn: () => apiClient.listSkillOutputs(mandalaId!),
    enabled: isLoggedIn && isTokenReady && !!mandalaId,
    staleTime: 30_000,
  });
}
