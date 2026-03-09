import { useTranslation } from 'react-i18next';
import { AppShell } from '@/widgets/app-shell';
import { useAuth } from '@/features/auth/model/useAuth';
import { Button } from '@/shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { Check, Crown, Zap, Star } from 'lucide-react';
import { toast } from '@/shared/lib/use-toast';

export default function SubscriptionPage() {
  const { t } = useTranslation();
  const { userName } = useAuth();

  const plans = [
    {
      id: 'free',
      name: t('subscription.free.name'),
      price: '$0',
      period: t('subscription.monthly'),
      description: t('subscription.free.description'),
      icon: Star,
      features: t('subscription.free.features', { returnObjects: true }) as string[],
      buttonText: t('subscription.currentPlan'),
      current: true,
    },
    {
      id: 'ltd',
      name: t('subscription.ltd.name', 'Pioneer Lifetime'),
      price: '$99',
      originalPrice: '$299',
      description: t('subscription.ltd.description', 'One-time payment, lifetime access'),
      icon: Crown,
      popular: true,
      features: t('subscription.ltd.features', {
        returnObjects: true,
        defaultValue: [
          'Unlimited mandalas',
          'AI summaries (500/mo)',
          'Playlist sync',
          'Lifetime updates',
          'Priority support',
        ],
      }) as string[],
      buttonText: t('subscription.ltd.buy', 'Get Lifetime Access'),
      current: false,
    },
    {
      id: 'pro',
      name: t('subscription.pro.name'),
      price: '$19.90',
      period: t('subscription.monthly'),
      description: t('subscription.pro.description'),
      icon: Zap,
      features: t('subscription.pro.features', { returnObjects: true }) as string[],
      buttonText: t('subscription.comingSoon', 'Coming Soon'),
      current: false,
      disabled: true,
    },
  ];

  const handleSelectPlan = (planId: string) => {
    if (planId === 'free') return;
    toast({
      title: 'Coming Soon',
      description: 'Payment feature will be available soon.',
    });
  };

  return (
    <AppShell>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">{t('subscription.title')}</h1>
          <p className="text-muted-foreground">{t('subscription.subtitle')}</p>
          {userName && (
            <p className="text-sm text-muted-foreground mt-1">
              {t('subscription.currentUser', { name: userName, defaultValue: 'Logged in as {{name}}' })}
            </p>
          )}
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <Card
              key={plan.id}
              className={`bg-surface-mid border-border/50 relative transition-all duration-200 hover:border-primary/50 ${
                plan.popular ? 'ring-2 ring-primary' : ''
              }`}
            >
              {plan.popular && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                  {t('subscription.recommended', 'Recommended')}
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
                  {plan.originalPrice && (
                    <span className="text-lg text-muted-foreground line-through mr-2">
                      {plan.originalPrice}
                    </span>
                  )}
                  <span className="text-4xl font-bold text-foreground">{plan.price}</span>
                  {plan.period && (
                    <span className="text-muted-foreground">/{plan.period}</span>
                  )}
                  {plan.id === 'ltd' && (
                    <p className="text-xs text-primary mt-1 font-medium">
                      {t('subscription.ltd.oneTime', 'One-time payment')}
                    </p>
                  )}
                </div>
                <ul className="space-y-3 text-left mb-6">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-primary flex-shrink-0" />
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  variant={plan.current ? 'outline' : 'default'}
                  disabled={plan.current || plan.disabled}
                  onClick={() => handleSelectPlan(plan.id)}
                >
                  {plan.buttonText}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Urgency note */}
        <p className="text-center text-sm text-muted-foreground mt-6">
          {t('subscription.urgency', 'Pioneer pricing will transition to monthly subscription soon.')}
        </p>
      </div>
    </AppShell>
  );
}
