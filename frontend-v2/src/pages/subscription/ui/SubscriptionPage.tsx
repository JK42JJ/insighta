import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Header } from '@/widgets/header/ui/Header';
import { Button } from '@/shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { Check, ArrowLeft, Crown, Zap, Star } from 'lucide-react';
import { toast } from '@/shared/lib/use-toast';

export default function SubscriptionPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [selectedPlan, setSelectedPlan] = useState('free');

  const plans = [
    {
      id: 'free',
      name: t('subscription.free.name'),
      price: '\u20A90',
      period: t('subscription.monthly'),
      description: t('subscription.free.description'),
      icon: Star,
      features: t('subscription.free.features', { returnObjects: true }) as string[],
      buttonText: t('subscription.currentPlan'),
      current: true,
    },
    {
      id: 'pro',
      name: t('subscription.pro.name'),
      price: '\u20A99,900',
      period: t('subscription.monthly'),
      description: t('subscription.pro.description'),
      icon: Zap,
      popular: true,
      features: t('subscription.pro.features', { returnObjects: true }) as string[],
      buttonText: t('subscription.upgrade'),
      current: false,
    },
    {
      id: 'enterprise',
      name: t('subscription.enterprise.name'),
      price: '\u20A929,900',
      period: t('subscription.monthly'),
      description: t('subscription.enterprise.description'),
      icon: Crown,
      features: t('subscription.enterprise.features', { returnObjects: true }) as string[],
      buttonText: t('subscription.contactSales'),
      current: false,
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
    <div className="min-h-screen bg-background">
      <Header onNavigateHome={() => navigate('/')} />

      <main className="container mx-auto px-4 py-8">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="mb-6 gap-2">
          <ArrowLeft className="w-4 h-4" />
          {t('common.back')}
        </Button>

        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-foreground mb-2">{t('subscription.title')}</h1>
          <p className="text-muted-foreground">{t('subscription.subtitle')}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {plans.map((plan) => (
            <Card
              key={plan.id}
              className={`bg-surface-mid border-border/50 relative transition-all duration-200 hover:border-primary/50 ${
                plan.popular ? 'ring-2 ring-primary' : ''
              }`}
            >
              {plan.popular && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                  {t('subscription.pro.popular')}
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
                  <span className="text-4xl font-bold text-foreground">{plan.price}</span>
                  <span className="text-muted-foreground">/{plan.period}</span>
                </div>
                <ul className="space-y-3 text-left">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-primary flex-shrink-0" />
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  variant={plan.current ? 'outline' : 'default'}
                  disabled={plan.current}
                  onClick={() => handleSelectPlan(plan.id)}
                >
                  {plan.buttonText}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>

        {/* Current Plan Info */}
        <Card className="mt-10 max-w-2xl mx-auto bg-surface-mid border-border/50">
          <CardHeader>
            <CardTitle className="text-lg">{t('subscription.currentPlan')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">{t('subscription.currentPlan')}</span>
              <Badge variant="outline">{t('subscription.free.name')}</Badge>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
