import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Archive, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { useState } from 'react';

export default function PricingPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/30 bg-background/95 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Archive className="w-4 h-4 text-primary-foreground" />
            </div>
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

        {/* LTD Card */}
        <div className="mx-auto max-w-lg px-4 mt-12">
          <div
            className="rounded-2xl border-2 border-primary/30 bg-card p-8 md:p-10 relative overflow-hidden"
            style={{ boxShadow: 'var(--shadow-lg)' }}
          >
            {/* Badge */}
            <div className="absolute top-4 right-4">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-[#D6336C] text-white">
                {t('pricing.badge')}
              </span>
            </div>

            {/* Price */}
            <div className="mb-8">
              <div className="flex items-baseline gap-3">
                <span className="text-5xl md:text-6xl font-bold tracking-tight">{t('pricing.price')}</span>
                <span className="text-xl text-muted-foreground line-through">{t('pricing.originalPrice')}</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {t('pricing.urgency')}
              </p>
            </div>

            {/* Features */}
            <ul className="space-y-3 mb-8">
              {(t('pricing.features', { returnObjects: true }) as string[]).map((feature, i) => (
                <li key={i} className="flex items-center gap-3">
                  <Check className="w-5 h-5 text-primary shrink-0" />
                  <span className="text-sm">{feature}</span>
                </li>
              ))}
            </ul>

            {/* CTA */}
            <Button
              size="lg"
              className="w-full rounded-full py-6 text-base bg-[#D6336C] hover:bg-[#C2255C] text-white border-0"
            >
              {t('pricing.ctaButton')}
            </Button>

            {/* Spots remaining */}
            <p className="mt-4 text-center text-sm text-muted-foreground">
              {t('pricing.spotsLeft', { count: 47 })}
            </p>
          </div>

          {/* Social proof */}
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t('pricing.socialProof', { count: 42 })}
          </p>
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
      {open && (
        <div className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed">
          {answer}
        </div>
      )}
    </div>
  );
}
