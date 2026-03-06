import { ArrowUp } from 'lucide-react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { useTranslation } from 'react-i18next';

const Privacy = () => {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header />
      <div className="flex-1 p-4 sm:p-8 max-w-3xl mx-auto w-full legal-prose">
        <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
        <p className="text-muted-foreground mb-4">Last updated: March 5, 2026</p>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">1. Overview</h2>
          <p>
            Insighta (&quot;we&quot;, &quot;our&quot;, &quot;the Service&quot;) is a personal
            knowledge management platform that syncs YouTube playlists for learning and note-taking
            purposes. This policy explains how we handle your data.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">2. Data We Collect</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Google Account Info</strong>: Email address and display name via Google OAuth
              sign-in.
            </li>
            <li>
              <strong>YouTube Data</strong>: Playlist metadata, video titles, descriptions, and
              thumbnails from your YouTube playlists (read-only access via{' '}
              <code className="bg-muted text-foreground/80 px-1 py-0.5 rounded text-sm font-mono">
                youtube.readonly
              </code>{' '}
              scope).
            </li>
            <li>
              <strong>User-Generated Content</strong>: Notes, cards, and settings you create within
              the Service.
            </li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">3. How We Use Your Data</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>To authenticate your identity and provide access to the Service.</li>
            <li>To sync and display your YouTube playlist data within the app.</li>
            <li>To store your notes and learning progress.</li>
          </ul>
          <p className="mt-2">
            We do <strong>not</strong> sell, share, or transmit your data to third parties. Your
            data is used solely to provide the Service.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">4. YouTube API Services</h2>
          <p>
            This application uses the YouTube API Services. By using this Service, you agree to be
            bound by the{' '}
            <a
              href="https://www.youtube.com/t/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              YouTube Terms of Service
              <span className="sr-only"> (opens in new tab)</span>
            </a>{' '}
            and the{' '}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              Google Privacy Policy
              <span className="sr-only"> (opens in new tab)</span>
            </a>
            .
          </p>
          <p className="mt-2">
            We request{' '}
            <code className="bg-muted text-foreground/80 px-1 py-0.5 rounded text-sm font-mono">
              youtube.readonly
            </code>{' '}
            access to read your playlist and video metadata. We never modify or delete any YouTube
            content.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">5. Data Storage &amp; Security</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>All data is stored in a secured database hosted on Supabase (AWS us-west-2).</li>
            <li>OAuth tokens are encrypted at rest.</li>
            <li>All connections use HTTPS/TLS encryption.</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">6. Data Retention &amp; Deletion</h2>
          <p>
            You can disconnect your YouTube account at any time from the Settings page, which
            revokes our access and deletes stored tokens. To request full account deletion, contact
            us at the email below.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">7. Your Rights</h2>
          <p>You have the right to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Access your personal data stored in the Service.</li>
            <li>Request correction or deletion of your data.</li>
            <li>
              Revoke Google/YouTube access via{' '}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                Google Account Permissions
                <span className="sr-only"> (opens in new tab)</span>
              </a>
              .
            </li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">8. Contact</h2>
          <p>
            For privacy-related questions, contact:{' '}
            <a href="mailto:jamesjk4242@gmail.com" className="text-primary underline">
              jamesjk4242@gmail.com
              <span className="sr-only"> (opens email client)</span>
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

export default Privacy;
