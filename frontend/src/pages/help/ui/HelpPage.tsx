import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/widgets/app-shell';
import { Mail, MessageSquarePlus, ChevronDown, ExternalLink } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface FaqItem {
  questionKey: string;
  answerKey: string;
}

const FAQ_ITEMS: FaqItem[] = [
  { questionKey: 'help.faq.q1', answerKey: 'help.faq.a1' },
  { questionKey: 'help.faq.q2', answerKey: 'help.faq.a2' },
  { questionKey: 'help.faq.q3', answerKey: 'help.faq.a3' },
  { questionKey: 'help.faq.q4', answerKey: 'help.faq.a4' },
  { questionKey: 'help.faq.q5', answerKey: 'help.faq.a5' },
  { questionKey: 'help.faq.q6', answerKey: 'help.faq.a6' },
];

function FaqAccordion({ questionKey, answerKey }: FaqItem) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-b border-border/30 last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-4 text-left text-sm font-medium text-foreground hover:text-primary transition-colors"
        aria-expanded={isOpen}
      >
        <span>{t(questionKey)}</span>
        <ChevronDown
          className={cn(
            'w-4 h-4 shrink-0 ml-2 text-muted-foreground transition-transform duration-200',
            isOpen && 'rotate-180'
          )}
        />
      </button>
      {isOpen && (
        <div className="pb-4 text-sm text-muted-foreground leading-relaxed">
          {t(answerKey)}
        </div>
      )}
    </div>
  );
}

function HelpPage() {
  const { t } = useTranslation();

  return (
    <AppShell
      selectedMandalaId={null}
      onMandalaSelect={() => {}}
    >
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-foreground mb-2">
          {t('help.title', 'Help & Support')}
        </h1>
        <p className="text-muted-foreground mb-8">
          {t('help.subtitle', 'Find answers to common questions or get in touch with our team.')}
        </p>

        {/* FAQ Section */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            {t('help.faqTitle', 'Frequently Asked Questions')}
          </h2>
          <div className="rounded-lg border border-border/50 bg-surface-mid/30 px-4">
            {FAQ_ITEMS.map((item) => (
              <FaqAccordion key={item.questionKey} {...item} />
            ))}
          </div>
        </section>

        {/* Contact Section */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            {t('help.contactTitle', 'Contact Us')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <a
              href="mailto:support@insighta.one"
              className="flex items-center gap-3 p-4 rounded-lg border border-border/50 bg-surface-mid/30 hover:bg-surface-mid/60 transition-colors group"
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                  {t('help.emailSupport', 'Email Support')}
                </p>
                <p className="text-xs text-muted-foreground">support@insighta.one</p>
              </div>
            </a>
            <a
              href="https://github.com/JK42JJ/insighta/issues/new"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-4 rounded-lg border border-border/50 bg-surface-mid/30 hover:bg-surface-mid/60 transition-colors group"
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <MessageSquarePlus className="w-5 h-5 text-primary" />
              </div>
              <div className="flex items-center gap-1">
                <div>
                  <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                    {t('help.suggestFeature', 'Suggest a Feature')}
                  </p>
                  <p className="text-xs text-muted-foreground">GitHub Issues</p>
                </div>
                <ExternalLink className="w-3 h-3 text-muted-foreground ml-1" />
              </div>
            </a>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

export default HelpPage;
