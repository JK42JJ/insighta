import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronUp, Shield, Lock, RefreshCw } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { useRef, useState } from 'react';

export default function PricingPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/30 bg-background/95 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Insighta" className="w-8 h-8 rounded-lg dark:invert" />
            <span className="text-lg font-bold tracking-tight">Insighta</span>
          </Link>
          <Link to="/">
            <Button variant="ghost" size="sm">{t('common.home')}</Button>
          </Link>
        </div>
      </header>

      <main className="py-16 md:py-24">
        <div className="mx-auto max-w-2xl px-4 text-center">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
            {t('pricing.title')}
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            {t('pricing.subtitle')}
          </p>
        </div>

        {/* LTD Card with gradient border */}
        <div className="mx-auto max-w-lg px-4 mt-12">
          <div className="rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 p-[2px]">
            <div className="rounded-[calc(1rem-2px)] bg-card p-8 md:p-10 relative overflow-hidden">
              {/* Badge */}
              <div className="absolute top-4 right-4">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-primary text-primary-foreground">
                  {t('pricing.badge')}
                </span>
              </div>

              {/* Price */}
              <div className="mb-8">
                <div className="flex items-baseline gap-3">
                  <span className="text-5xl md:text-6xl font-bold tracking-tight">{t('pricing.price')}</span>
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
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('pricing.urgency')}
                </p>
              </div>

              {/* Features */}
              <ul className="space-y-3 mb-8">
                {(t('pricing.features', { returnObjects: true }) as string[]).map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 text-primary" />
                    </span>
                    <span className="text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <Button
                size="lg"
                className="w-full rounded-full py-6 text-base bg-primary hover:bg-primary/90 text-primary-foreground border-0"
              >
                {t('pricing.ctaButton')}
              </Button>

              {/* Spots remaining */}
              <p className="mt-4 text-center text-sm text-muted-foreground">
                {t('pricing.spotsLeft', { count: 47 })}
              </p>
            </div>
          </div>

          {/* Trust signals row */}
          <div className="mt-6 flex items-center justify-center gap-6 text-xs text-muted-foreground">
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

          {/* Social proof with avatar stack */}
          <div className="mt-6 flex items-center justify-center gap-2">
            <div className="flex -space-x-2">
              {['SK', 'JL', 'MC'].map((initials, i) => (
                <div
                  key={i}
                  className="w-7 h-7 rounded-full bg-primary/10 border-2 border-background flex items-center justify-center text-[10px] font-semibold text-primary"
                >
                  {initials}
                </div>
              ))}
            </div>
            <span className="text-sm text-muted-foreground">
              {t('pricing.socialProof', { count: 42 })}
            </span>
          </div>
        </div>

        {/* FAQ */}
        <div className="mx-auto max-w-2xl px-4 mt-20">
          <h2 className="text-2xl font-semibold text-center mb-8">
            {t('pricing.faqTitle')}
          </h2>
          <div className="space-y-2">
            <FAQItem question={t('pricing.faq1q')} answer={t('pricing.faq1a')} />
            <FAQItem question={t('pricing.faq2q')} answer={t('pricing.faq2a')} />
            <FAQItem question={t('pricing.faq3q')} answer={t('pricing.faq3a')} />
          </div>
        </div>
      </main>
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
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-surface-light transition-colors"
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
