import { ArrowUp } from 'lucide-react';
import { Header } from '@/widgets/header/ui/Header';
import { Footer } from '@/widgets/header/ui/Footer';
import { useTranslation, Trans } from 'react-i18next';
import { SUPPORT_EMAIL } from '@/shared/config/constants';

const LINK_CLASS = 'text-primary underline';
const SR_ONLY = 'sr-only';

const TermsPage = () => {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header />
      <div className="flex-1 p-4 sm:p-8 max-w-3xl mx-auto w-full legal-prose">
        <h1 className="text-3xl font-bold mb-6">{t('terms.title')}</h1>
        <p className="text-muted-foreground mb-4">{t('terms.lastUpdated')}</p>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('terms.s1Title')}</h2>
          <p>{t('terms.s1P1')}</p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('terms.s2Title')}</h2>
          <p>{t('terms.s2P1')}</p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('terms.s3Title')}</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>{t('terms.s3Item1')}</li>
            <li>{t('terms.s3Item2')}</li>
            <li>{t('terms.s3Item3')}</li>
            <li>{t('terms.s3Item4')}</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('terms.s4Title')}</h2>
          <p>{t('terms.s4P1')}</p>
          <ul className="list-disc pl-6 space-y-1 mt-2">
            <li>{t('terms.s4Item1')}</li>
            <li>{t('terms.s4Item2')}</li>
            <li>{t('terms.s4Item3')}</li>
            <li>{t('terms.s4Item4')}</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('terms.s5Title')}</h2>
          <p>
            <Trans
              i18nKey="terms.s5P1"
              components={{
                ytTermsLink: (
                  <a
                    href="https://www.youtube.com/t/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={LINK_CLASS}
                  >
                    <span className={SR_ONLY}> (opens in new tab)</span>
                  </a>
                ),
                googleApiLink: (
                  <a
                    href="https://developers.google.com/terms/api-services-user-data-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={LINK_CLASS}
                  >
                    <span className={SR_ONLY}> (opens in new tab)</span>
                  </a>
                ),
              }}
            />
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('terms.s6Title')}</h2>
          <p>{t('terms.s6P1')}</p>
          <ul className="list-disc pl-6 space-y-1 mt-2">
            <li>{t('terms.s6Item1')}</li>
            <li>{t('terms.s6Item2')}</li>
            <li>{t('terms.s6Item3')}</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('terms.s7Title')}</h2>
          <p>{t('terms.s7P1')}</p>
          <p className="mt-2">{t('terms.s7P2')}</p>
          <p className="mt-2">{t('terms.s7P3')}</p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('terms.s8Title')}</h2>
          <p>{t('terms.s8P1')}</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>{t('terms.s8Item1')}</li>
            <li>{t('terms.s8Item2')}</li>
            <li>{t('terms.s8Item3')}</li>
            <li>{t('terms.s8Item4')}</li>
            <li>{t('terms.s8Item5')}</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('terms.s9Title')}</h2>
          <p>{t('terms.s9P1')}</p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('terms.s10Title')}</h2>
          <p>{t('terms.s10P1')}</p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('terms.s11Title')}</h2>
          <p>{t('terms.s11P1')}</p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('terms.s12Title')}</h2>
          <p>{t('terms.s12P1')}</p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('terms.s13Title')}</h2>
          <p>{t('terms.s13P1')}</p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('terms.s14Title')}</h2>
          <p>{t('terms.s14P1')}</p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('terms.s15Title')}</h2>
          <p>{t('terms.s15P1')}</p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('terms.s16Title')}</h2>
          <p>
            {t('terms.s16P1')}{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className={LINK_CLASS}>
              {SUPPORT_EMAIL}
              <span className={SR_ONLY}> (opens email client)</span>
            </a>
          </p>
        </section>
        <div className="flex justify-center mt-8">
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-surface-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <ArrowUp className="w-4 h-4" aria-hidden="true" />
            {t('common.backToTop')}
          </button>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default TermsPage;
