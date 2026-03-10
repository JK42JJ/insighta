import { useTranslation } from 'react-i18next';

import { Check, ChevronDown, ChevronUp, Shield, Lock, RefreshCw, X, Sparkles } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { useRef, useState } from 'react';
import { GradientBackground } from '@/pages/landing/ui/components/GradientBackground';
import { LandingHeader } from '@/pages/landing/ui/components/LandingHeader';

const TOTAL_SPOTS = 100;
const SPOTS_REMAINING = 47;
const SPOTS_TAKEN_PERCENT = ((TOTAL_SPOTS - SPOTS_REMAINING) / TOTAL_SPOTS) * 100;

export default function PricingPage() {
  const { t } = useTranslation();

  return (
    <div className="relative min-h-screen bg-background">
      <GradientBackground variant="F" />
      <div className="relative z-10">
        <LandingHeader />

        <main className="py-10 md:py-16">
          {/* Title */}
          <div className="mx-auto max-w-3xl px-4 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Sparkles className="w-3.5 h-3.5" />
              {t('pricing.badge')}
            </div>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
              {t('pricing.title')}
            </h1>
            <p className="mt-4 text-lg text-muted-foreground max-w-lg mx-auto">
              {t('pricing.subtitle')}
            </p>
          </div>

          {/* Urgency bar */}
          <div className="mx-auto max-w-md px-4 mt-10">
            <div className="rounded-xl bg-card/80 backdrop-blur-sm border border-border/50 p-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="font-medium">{t('pricing.spotsLeft', { count: SPOTS_REMAINING })}</span>
                <span className="text-muted-foreground">{SPOTS_TAKEN_PERCENT}% {t('pricing.claimed')}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-primary/70 rounded-full transition-all"
                  style={{ width: `${SPOTS_TAKEN_PERCENT}%` }}
                />
              </div>
            </div>
          </div>

          {/* Pricing cards — 2 column */}
          <div className="mx-auto max-w-4xl px-4 mt-10 grid md:grid-cols-2 gap-6 items-stretch">
            {/* Monthly card */}
            <div className="relative rounded-2xl bg-gradient-to-b from-border/60 via-border/30 to-transparent p-[1.5px] flex flex-col">
              <div className="rounded-[calc(1rem-1.5px)] bg-card p-8 md:p-10 relative overflow-hidden flex flex-col flex-1">
                <div className="mb-8">
                  <h3 className="text-lg font-semibold">{t('pricing.monthlyName')}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{t('pricing.monthlyDesc')}</p>
                  <div className="mt-6 flex items-baseline gap-3">
                    <span className="text-5xl font-bold tracking-tight">{t('pricing.monthlyPrice')}</span>
                    <span className="text-muted-foreground">/{t('pricing.monthlyPeriod')}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{t('pricing.monthlyAnnual')}</p>
                </div>

                <ul className="space-y-3 mb-8 flex-1">
                  {(t('pricing.monthlyFeatures', { returnObjects: true }) as string[]).map((feature, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Check className="w-3 h-3 text-primary" />
                      </span>
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  variant="outline"
                  size="lg"
                  className="w-full rounded-full py-6 text-base"
                  disabled
                >
                  {t('pricing.monthlyCtaDisabled')}
                </Button>
              </div>
            </div>

            {/* LTD card (highlighted) */}
            <div className="relative rounded-2xl bg-gradient-to-b from-primary/20 via-primary/5 to-transparent p-[1.5px] flex flex-col">
              {/* Popular badge */}
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                <span className="inline-flex items-center px-4 py-1 rounded-full text-xs font-bold bg-primary text-primary-foreground shadow-lg">
                  {t('pricing.recommended')}
                </span>
              </div>

              <div className="rounded-[calc(1rem-1.5px)] bg-card p-8 md:p-10 relative overflow-hidden flex flex-col flex-1">
                <div className="mb-8">
                  <h3 className="text-lg font-semibold">{t('pricing.ltdName')}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{t('pricing.ltdDesc')}</p>
                  <div className="mt-6 flex items-baseline gap-3">
                    <span className="text-5xl font-bold tracking-tight">{t('pricing.price')}</span>
                    <span className="text-xl text-muted-foreground line-through">{t('pricing.originalPrice')}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-500/10 text-green-600 dark:text-green-400">
                      {t('pricing.saveLabel')}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('pricing.monthlyComparison')}
                    </span>
                  </div>
                </div>

                <ul className="space-y-3 mb-8 flex-1">
                  {(t('pricing.features', { returnObjects: true }) as string[]).map((feature, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Check className="w-3 h-3 text-primary" />
                      </span>
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  size="lg"
                  className="w-full rounded-full py-6 text-base bg-primary hover:bg-primary/90 text-primary-foreground border-0 shadow-lg shadow-primary/20"
                >
                  {t('pricing.ctaButton')}
                </Button>
              </div>
            </div>
          </div>

          {/* Trust signals */}
          <div className="mx-auto max-w-4xl px-4 mt-8 flex items-center justify-center gap-8 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              {t('pricing.trustGuarantee')}
            </span>
            <span className="flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              {t('pricing.trustSecure')}
            </span>
            <span className="flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
              {t('pricing.trustUpdates')}
            </span>
          </div>

          {/* Social proof */}
          <div className="mt-6 flex items-center justify-center gap-2">
            <div className="flex -space-x-2">
              {['SK', 'JL', 'MC', 'AH', 'DP'].map((initials, i) => (
                <div
                  key={i}
                  className="w-7 h-7 rounded-full bg-primary/10 border-2 border-background flex items-center justify-center text-[10px] font-semibold text-primary"
                >
                  {initials}
                </div>
              ))}
            </div>
            <span className="text-sm text-muted-foreground">
              {t('pricing.socialProof', { count: 53 })}
            </span>
          </div>

          {/* Feature comparison table */}
          <div className="mx-auto max-w-2xl px-4 mt-16">
            <h2 className="text-2xl font-semibold text-center mb-8">
              {t('pricing.compareTitle')}
            </h2>
            <div className="rounded-xl border border-border/50 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/30">
                    <th className="text-left px-5 py-3 font-medium">{t('pricing.compareFeature')}</th>
                    <th className="text-center px-5 py-3 font-medium text-muted-foreground">{t('pricing.monthlyName')}</th>
                    <th className="text-center px-5 py-3 font-medium text-primary">{t('pricing.ltdName')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(t('pricing.compareRows', { returnObjects: true }) as Array<{ feature: string; monthly: string; ltd: string }>).map((row, i) => (
                    <tr key={i} className="border-b border-border/30 last:border-0">
                      <td className="px-5 py-3">{row.feature}</td>
                      <td className="text-center px-5 py-3 text-muted-foreground">
                        {row.monthly === 'true' ? <Check className="w-4 h-4 text-muted-foreground mx-auto" /> :
                         row.monthly === 'false' ? <X className="w-4 h-4 text-muted-foreground/40 mx-auto" /> :
                         row.monthly}
                      </td>
                      <td className="text-center px-5 py-3">
                        {row.ltd === 'true' ? <Check className="w-4 h-4 text-primary mx-auto" /> :
                         row.ltd === 'false' ? <X className="w-4 h-4 text-muted-foreground/40 mx-auto" /> :
                         <span className="text-primary font-medium">{row.ltd}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* FAQ */}
          <div className="mx-auto max-w-2xl px-4 mt-16">
            <h2 className="text-2xl font-semibold text-center mb-8">
              {t('pricing.faqTitle')}
            </h2>
            <div className="space-y-2">
              <FAQItem question={t('pricing.faq1q')} answer={t('pricing.faq1a')} />
              <FAQItem question={t('pricing.faq2q')} answer={t('pricing.faq2a')} />
              <FAQItem question={t('pricing.faq3q')} answer={t('pricing.faq3a')} />
              <FAQItem question={t('pricing.faq4q')} answer={t('pricing.faq4a')} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="text-sm font-medium">{question}</span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>
      <div
        ref={contentRef}
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: open ? contentRef.current?.scrollHeight ?? 200 : 0,
        }}
      >
        <div className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed">
          {answer}
        </div>
      </div>
    </div>
  );
}
