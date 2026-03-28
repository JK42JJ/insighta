import { ArrowUp } from 'lucide-react';
import { Header } from '@/widgets/header/ui/Header';
import { Footer } from '@/widgets/header/ui/Footer';
import { useTranslation, Trans } from 'react-i18next';
import { SUPPORT_EMAIL } from '@/shared/config/constants';

const LINK_CLASS = 'text-primary underline';
const SR_ONLY = 'sr-only';

const PrivacyPage = () => {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header />
      <div className="flex-1 p-4 sm:p-8 max-w-3xl mx-auto w-full legal-prose">
        <h1 className="text-3xl font-bold mb-6">{t('privacy.title')}</h1>
        <p className="text-muted-foreground mb-4">{t('privacy.lastUpdated')}</p>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('privacy.s1Title')}</h2>
          <p>{t('privacy.s1P1')}</p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('privacy.s2Title')}</h2>
          <h3 className="text-lg font-medium mt-3 mb-1">{t('privacy.s2_1Title')}</h3>
          <p>{t('privacy.s2_1P1')}</p>
          <h3 className="text-lg font-medium mt-3 mb-1">{t('privacy.s2_2Title')}</h3>
          <p>
            <Trans
              i18nKey="privacy.s2_2P1"
              components={{
                code: (
                  <code className="bg-muted text-foreground/80 px-1 py-0.5 rounded text-sm font-mono" />
                ),
              }}
            />
          </p>
          <h3 className="text-lg font-medium mt-3 mb-1">{t('privacy.s2_3Title')}</h3>
          <p>{t('privacy.s2_3P1')}</p>
          <h3 className="text-lg font-medium mt-3 mb-1">{t('privacy.s2_4Title')}</h3>
          <p>{t('privacy.s2_4P1')}</p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('privacy.s3Title')}</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>{t('privacy.s3Item1')}</li>
            <li>{t('privacy.s3Item2')}</li>
            <li>{t('privacy.s3Item3')}</li>
            <li>{t('privacy.s3Item4')}</li>
            <li>{t('privacy.s3Item5')}</li>
            <li>{t('privacy.s3Item6')}</li>
          </ul>
          <p className="mt-2">
            <Trans i18nKey="privacy.s3P2" components={{ strong: <strong /> }} />
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('privacy.s4Title')}</h2>
          <p>
            <Trans
              i18nKey="privacy.s4P1"
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
                googlePrivacyLink: (
                  <a
                    href="https://policies.google.com/privacy"
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
          <p className="mt-2">
            <Trans
              i18nKey="privacy.s4P2"
              components={{
                code: (
                  <code className="bg-muted text-foreground/80 px-1 py-0.5 rounded text-sm font-mono" />
                ),
              }}
            />
          </p>
          <p className="mt-2">
            <Trans
              i18nKey="privacy.s4P3"
              components={{
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
          <h2 className="text-xl font-semibold mb-2">{t('privacy.s5Title')}</h2>
          <p>{t('privacy.s5P1')}</p>
          <p className="mt-2">{t('privacy.s5P2')}</p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('privacy.s6Title')}</h2>
          <p>{t('privacy.s6P1')}</p>
          <ul className="list-disc pl-6 space-y-1 mt-2">
            <li>
              <Trans i18nKey="privacy.s6Supabase" components={{ strong: <strong /> }} />
              {' — '}
              <a
                href="https://supabase.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS}
              >
                Supabase Privacy Policy<span className={SR_ONLY}> (opens in new tab)</span>
              </a>
            </li>
            <li>
              <Trans i18nKey="privacy.s6Google" components={{ strong: <strong /> }} />
              {' — '}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS}
              >
                Google Privacy Policy<span className={SR_ONLY}> (opens in new tab)</span>
              </a>
            </li>
            <li>
              <Trans i18nKey="privacy.s6Gemini" components={{ strong: <strong /> }} />
              {' — '}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS}
              >
                Google Privacy Policy<span className={SR_ONLY}> (opens in new tab)</span>
              </a>
            </li>
            <li>
              <Trans i18nKey="privacy.s6OpenRouter" components={{ strong: <strong /> }} />
              {' — '}
              <a
                href="https://openrouter.ai/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS}
              >
                OpenRouter Privacy Policy<span className={SR_ONLY}> (opens in new tab)</span>
              </a>
            </li>
            <li>
              <Trans i18nKey="privacy.s6WebShare" components={{ strong: <strong /> }} />
              {' — '}
              <a
                href="https://www.webshare.io/privacy-policy"
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS}
              >
                WebShare Privacy Policy<span className={SR_ONLY}> (opens in new tab)</span>
              </a>
            </li>
          </ul>
          <p className="mt-2">{t('privacy.s6P2')}</p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('privacy.s7Title')}</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>{t('privacy.s7Item1')}</li>
            <li>{t('privacy.s7Item2')}</li>
            <li>{t('privacy.s7Item3')}</li>
            <li>{t('privacy.s7Item4')}</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('privacy.s8Title')}</h2>
          <p>{t('privacy.s8P1')}</p>
          <p className="mt-2">{t('privacy.s8P2')}</p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('privacy.s9Title')}</h2>
          <p>{t('privacy.s9P1')}</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>{t('privacy.s9Item1')}</li>
            <li>{t('privacy.s9Item2')}</li>
            <li>{t('privacy.s9Item3')}</li>
            <li>{t('privacy.s9Item4')}</li>
            <li>
              <Trans
                i18nKey="privacy.s9Item5"
                components={{
                  googlePermissionsLink: (
                    <a
                      href="https://myaccount.google.com/permissions"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={LINK_CLASS}
                    >
                      <span className={SR_ONLY}> (opens in new tab)</span>
                    </a>
                  ),
                }}
              />
            </li>
            <li>{t('privacy.s9Item6')}</li>
          </ul>
          <p className="mt-2">{t('privacy.s9P2')}</p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('privacy.s10Title')}</h2>
          <p>{t('privacy.s10P1')}</p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('privacy.s11Title')}</h2>
          <p>{t('privacy.s11P1')}</p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">{t('privacy.s12Title')}</h2>
          <p>
            {t('privacy.s12P1')}{' '}
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

export default PrivacyPage;
