import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Lock, Mail, Unlock } from 'lucide-react';
import { apiClient } from '@/shared/lib/api-client';
import { toast } from '@/shared/lib/use-toast';
import { Button } from '@/shared/ui/button';

type SignupMode = 'open' | 'invite_only' | 'closed';

const MODES: Array<{
  value: SignupMode;
  label: string;
  desc: string;
  icon: typeof Unlock;
  tone: string;
}> = [
  {
    value: 'open',
    label: '가입 개방',
    desc: '누구나 가입 가능 (현재 기본값)',
    icon: Unlock,
    tone: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  },
  {
    value: 'invite_only',
    label: '초대만 허용',
    desc: '초대 처리된 이메일만 가입 가능. 나머지는 베타 신청으로 안내',
    icon: Mail,
    tone: 'text-indigo-300 border-indigo-500/40 bg-indigo-500/10',
  },
  {
    value: 'closed',
    label: '가입 차단',
    desc: '신규 가입 전면 차단. 기존 로그인은 항상 허용',
    icon: Lock,
    tone: 'text-red-400 border-red-500/40 bg-red-500/10',
  },
];

const SETTING_KEY = 'beta_signup_mode';

/**
 * Admin → Beta Campaign — closed-beta signup gate + application inbox.
 *
 * The signup gate is a single system_settings value (`beta_signup_mode`) read
 * by /login and the public /beta/config. Flipping it here propagates within the
 * settings cache window (~30s) — no deploy. Applications land in
 * `beta_applications` via the public /beta form.
 */
export function AdminBetaCampaign() {
  const queryClient = useQueryClient();

  const modeQuery = useQuery({
    queryKey: ['admin', 'settings', SETTING_KEY],
    queryFn: () => apiClient.getSystemSetting(SETTING_KEY),
    staleTime: 0,
  });
  // Unset store → 'open' (matches the BE default = current behavior).
  const currentMode = (modeQuery.data?.value as SignupMode | undefined) ?? 'open';

  const setModeMutation = useMutation({
    mutationFn: (next: SignupMode) => apiClient.setSystemSetting(SETTING_KEY, next),
    onSuccess: (_res, next) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', SETTING_KEY] });
      toast({
        title: '가입 모드를 변경했습니다',
        description: MODES.find((m) => m.value === next)?.label,
      });
    },
    onError: () =>
      toast({ title: '변경 실패', description: '다시 시도해 주세요.', variant: 'destructive' }),
  });

  const appsQuery = useQuery({
    queryKey: ['admin', 'beta-applications'],
    queryFn: () => apiClient.getBetaApplications(),
    staleTime: 10_000,
  });

  const inviteMutation = useMutation({
    mutationFn: (id: string) => apiClient.markBetaInvited(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'beta-applications'] });
      toast({ title: '초대 처리 완료', description: '이 이메일은 이제 가입할 수 있습니다.' });
    },
    onError: () => toast({ title: '초대 처리 실패', variant: 'destructive' }),
  });

  const apps = appsQuery.data?.applications ?? [];
  const counts = {
    total: apps.length,
    pending: apps.filter((a) => a.status === 'pending').length,
    invited: apps.filter((a) => a.status === 'invited').length,
    joined: apps.filter((a) => a.status === 'joined').length,
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Beta Campaign</h1>
        <p className="text-sm text-muted-foreground mt-1">
          클로즈드 베타 가입 게이트와 신청 관리 (2026-07-13 ~ 08-24)
        </p>
      </div>

      {/* Zone 1 — signup gate */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">가입 차단 / 재개</h2>
          <span className="text-xs text-muted-foreground">
            현재:{' '}
            <b className="text-foreground">{MODES.find((m) => m.value === currentMode)?.label}</b>
          </span>
        </div>
        <div className="mt-4 grid sm:grid-cols-3 gap-3">
          {MODES.map((m) => {
            const active = currentMode === m.value;
            const Icon = m.icon;
            return (
              <button
                key={m.value}
                type="button"
                disabled={setModeMutation.isPending || modeQuery.isLoading}
                onClick={() => !active && setModeMutation.mutate(m.value)}
                className={`text-left rounded-lg border p-4 transition-colors disabled:opacity-60 ${
                  active ? m.tone : 'border-border bg-background hover:border-foreground/30'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4" />
                  <span className="font-semibold text-sm">{m.label}</span>
                  {active && <Check className="w-4 h-4 ml-auto" />}
                </div>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{m.desc}</p>
              </button>
            );
          })}
        </div>
        {currentMode === 'closed' && (
          <p className="mt-3 flex items-center gap-2 text-xs text-red-400">
            <AlertTriangle className="w-3.5 h-3.5" /> 신규 가입이 전면 차단된 상태입니다. (기존
            로그인은 계속 허용)
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          변경은 약 30초 내 반영됩니다. 기본값은 <b>가입 개방</b>이며, 언제든 되돌릴 수 있습니다.
        </p>
      </section>

      {/* Zone 2 — applications inbox */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">신청 인박스</h2>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>
              전체 <b className="text-foreground">{counts.total}</b>
            </span>
            <span>
              대기 <b className="text-amber-400">{counts.pending}</b>
            </span>
            <span>
              초대됨 <b className="text-indigo-300">{counts.invited}</b>
            </span>
            <span>
              가입 <b className="text-emerald-400">{counts.joined}</b>
            </span>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          {appsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">불러오는 중…</p>
          ) : apps.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">아직 신청이 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 pr-4 font-medium">이메일</th>
                  <th className="py-2 pr-4 font-medium">학습 목표</th>
                  <th className="py-2 pr-4 font-medium">상태</th>
                  <th className="py-2 pr-4 font-medium">신청일</th>
                  <th className="py-2 font-medium text-right">액션</th>
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.id} className="border-b border-border/50">
                    <td className="py-2.5 pr-4 text-foreground">{a.email}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground max-w-xs truncate">
                      {a.goal || '—'}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          a.status === 'invited'
                            ? 'bg-indigo-500/15 text-indigo-300'
                            : a.status === 'joined'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-amber-500/15 text-amber-400'
                        }`}
                      >
                        {a.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                      {new Date(a.created_at).toLocaleDateString('ko-KR')}
                    </td>
                    <td className="py-2.5 text-right">
                      {a.status === 'pending' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={inviteMutation.isPending}
                          onClick={() => inviteMutation.mutate(a.id)}
                        >
                          초대 처리
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          "초대 처리"하면 <b>초대만 허용</b> 모드에서 해당 이메일이 가입할 수 있습니다. 초대 메일은
          수동 발송입니다.
        </p>
      </section>
    </div>
  );
}
