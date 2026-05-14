/**
 * @deprecated Not used after CP456 SubscriptionPage revert (2026-05-13).
 *
 * `SubscriptionPage.tsx` now hosts the plan cards inline with the preserved
 * pre-CP456 design (3 cards: Free / Pioneer Lifetime / Pro). This separate
 * `PlanSelector` component was an interim LS-only implementation built before
 * the user clarified they wanted the existing prod design preserved.
 *
 * Kept for history per CLAUDE.md "컴포넌트 삭제 금지" rule. If a future plan
 * picker is needed elsewhere, prefer extracting from SubscriptionPage instead
 * of using this file.
 */
import { useState } from 'react';
import { Check, Crown, Star, Zap } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { useCheckoutUrl } from '../model/useCheckoutUrl';
import { toast } from '@/shared/lib/use-toast';
import type { BillingPlanCode } from '@/shared/lib/api-client';

/**
 * Plan selection cards (free / pro_monthly / pro_yearly).
 * Click on a paid plan → BE issues LS checkout URL → window.location redirect.
 * Free card is informational only (current tier indicator).
 *
 * Design ref: ChatGPT 플랜 구성 (다크 카드 + ✓ 핵심기능 + 가격 + CTA).
 * Local Card token only (no hsl(...) literal — CLAUDE.md hardcoded color rule).
 */
type PlanDef = {
  id: 'free' | 'pro_monthly' | 'pro_yearly';
  name: string;
  priceLabel: string;
  periodLabel?: string;
  description: string;
  icon: typeof Star;
  features: string[];
  ctaLabel: string;
  popular?: boolean;
  badge?: string;
};

const FREE_FEATURES = ['만다라 3개', '카드 150개', '주간 리포트 10개', 'AI 요약 150건/월'];
const PRO_FEATURES = [
  '만다라 20개',
  '카드 1,000개',
  '무제한 주간 리포트',
  'AI 요약 1,000건/월',
  'Rich Summary 200건/월',
  '구조화 요약 + 알림 채널 전부',
];

const PLANS: PlanDef[] = [
  {
    id: 'free',
    name: 'Free',
    priceLabel: '$0',
    periodLabel: '월',
    description: '일반 사용자 무료 한도',
    icon: Star,
    features: FREE_FEATURES,
    ctaLabel: '현재 플랜',
  },
  {
    id: 'pro_monthly',
    name: 'Pro Monthly',
    priceLabel: '$9.99',
    periodLabel: '월',
    description: '매월 결제 · 언제든 해지',
    icon: Zap,
    features: PRO_FEATURES,
    ctaLabel: 'Pro 구독',
    popular: true,
  },
  {
    id: 'pro_yearly',
    name: 'Pro Yearly',
    priceLabel: 'Annual',
    description: '연간 결제 · 추가 할인',
    icon: Crown,
    features: PRO_FEATURES,
    ctaLabel: 'Pro 연간 구독',
    badge: '절약',
  },
];

export interface PlanSelectorProps {
  /** Current tier — disables matching CTA + marks "현재 플랜". */
  currentTier?: 'free' | 'pro' | 'lifetime' | 'admin';
}

export function PlanSelector({ currentTier = 'free' }: PlanSelectorProps) {
  const checkout = useCheckoutUrl();
  const [redirecting, setRedirecting] = useState<BillingPlanCode | null>(null);

  const onSelect = async (id: PlanDef['id']) => {
    if (id === 'free') return;
    if (currentTier === 'pro') {
      toast({
        title: '이미 Pro 사용 중',
        description: '플랜 변경은 결제 관리에서 진행해 주세요.',
      });
      return;
    }
    setRedirecting(id);
    try {
      const res = await checkout.mutateAsync(id);
      window.location.href = res.checkoutUrl;
    } catch (err) {
      setRedirecting(null);
      const message =
        err instanceof Error ? err.message : '결제 페이지를 여는 중 오류가 발생했습니다.';
      toast({ title: '결제 시작 실패', description: message, variant: 'destructive' });
    }
  };

  return (
    <div className="grid md:grid-cols-3 gap-6">
      {PLANS.map((plan) => {
        const isCurrent =
          (plan.id === 'free' && currentTier === 'free') ||
          (plan.id !== 'free' && currentTier === 'pro');
        const isLoading = redirecting === plan.id;
        return (
          <Card
            key={plan.id}
            className={`bg-card border-border/50 relative transition-all duration-200 hover:border-primary/60 ${
              plan.popular ? 'ring-2 ring-primary' : ''
            }`}
          >
            {plan.popular && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                추천
              </Badge>
            )}
            {plan.badge && !plan.popular && (
              <Badge variant="secondary" className="absolute -top-3 left-1/2 -translate-x-1/2">
                {plan.badge}
              </Badge>
            )}
            <CardHeader className="text-center pb-2">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <plan.icon className="w-6 h-6 text-primary" />
              </div>
              <CardTitle className="text-xl">{plan.name}</CardTitle>
              <CardDescription>{plan.description}</CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <div className="mb-6">
                <span className="text-4xl font-bold text-foreground">{plan.priceLabel}</span>
                {plan.periodLabel && (
                  <span className="text-muted-foreground">/{plan.periodLabel}</span>
                )}
              </div>
              <ul className="space-y-3 text-left mb-6">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <Check className="w-4 h-4 text-primary flex-shrink-0" />
                    <span className="text-foreground/90">{feature}</span>
                  </li>
                ))}
              </ul>
              <Button
                onClick={() => onSelect(plan.id)}
                disabled={isCurrent || isLoading || plan.id === 'free'}
                variant={plan.popular ? 'default' : 'outline'}
                className="w-full"
              >
                {isLoading ? '결제 페이지로 이동 중…' : isCurrent ? '현재 플랜' : plan.ctaLabel}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
