import { ArrowUp } from 'lucide-react';
import { Header } from '@/widgets/header/ui/Header';
import { Footer } from '@/widgets/header/ui/Footer';
import { useTranslation } from 'react-i18next';

const PrivacyPage = () => {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header />
      <div className="flex-1 p-4 sm:p-8 max-w-3xl mx-auto w-full legal-prose">
        <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
        <p className="text-muted-foreground mb-4">Last updated: March 11, 2026</p>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">1. Overview</h2>
          <p>
            Insighta (&quot;we&quot;, &quot;our&quot;, &quot;the Service&quot;) is a personal
            knowledge management platform that syncs YouTube playlists, generates AI-powered
            summaries from video captions, and provides note-taking tools for learning purposes. We
            take your privacy seriously. This policy explains what information we collect, how we
            use it, and what rights you have in relation to it.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">2. Data We Collect</h2>
          <h3 className="text-lg font-medium mt-3 mb-1">2.1 Account Information</h3>
          <p>
            When you sign in with Google, we receive your email address and display name via Google
            OAuth.
          </p>
          <h3 className="text-lg font-medium mt-3 mb-1">2.2 YouTube Data</h3>
          <p>
            Playlist metadata, video titles, descriptions, thumbnails, and captions from your
            YouTube playlists (read-only access via the{' '}
            <code className="bg-muted text-foreground/80 px-1 py-0.5 rounded text-sm font-mono">
              https://www.googleapis.com/auth/youtube.readonly
            </code>{' '}
            scope). We never modify or delete any YouTube content.
          </p>
          <h3 className="text-lg font-medium mt-3 mb-1">2.3 User-Generated Content</h3>
          <p>Notes, cards, and settings you create within the Service.</p>
          <h3 className="text-lg font-medium mt-3 mb-1">2.4 Website Visitors</h3>
          <p>
            Like most website operators, we collect non-personally-identifying information such as
            browser type, language preference, referring site, and the date and time of each
            request. We may publish aggregated, non-identifying statistics (e.g., trends in usage)
            from time to time.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">3. How We Use Your Data</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>To authenticate your identity and provide access to the Service.</li>
            <li>To sync and display your YouTube playlist data within the app.</li>
            <li>To store your notes and learning progress.</li>
            <li>
              To generate AI-powered summaries of video content using Google Gemini. Video captions
              are transmitted to this service solely for summary generation and are not stored by
              the AI provider beyond the processing request.
            </li>
            <li>To improve the Service through aggregated, anonymized usage statistics.</li>
          </ul>
          <p className="mt-2">
            We do <strong>not</strong> sell, share, or transmit your personal data to third parties
            for marketing purposes. Your data is used solely to provide and improve the Service.
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
            </a>
            , the{' '}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              Google Privacy Policy
              <span className="sr-only"> (opens in new tab)</span>
            </a>
            , and the{' '}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              Google API Services User Data Policy
              <span className="sr-only"> (opens in new tab)</span>
            </a>
            .
          </p>
          <p className="mt-2">
            We request the{' '}
            <code className="bg-muted text-foreground/80 px-1 py-0.5 rounded text-sm font-mono">
              https://www.googleapis.com/auth/youtube.readonly
            </code>{' '}
            scope (read-only access to your YouTube account) to read your playlist and video
            metadata. We never modify or delete any YouTube content.
          </p>
          <p className="mt-2">
            Insighta&apos;s use and transfer of information received from Google APIs adheres to the{' '}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              Google API Services User Data Policy
              <span className="sr-only"> (opens in new tab)</span>
            </a>
            , including the Limited Use requirements.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">5. Cookies</h2>
          <p>
            A cookie is a small piece of data stored on your computer by your web browser. We use
            cookies to maintain your session and preferences. We do not use cookies to track you
            across other websites.
          </p>
          <p className="mt-2">
            You can configure your browser to refuse cookies, with the understanding that some
            features of the Service may not function properly without them.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">6. Third-Party Service Providers</h2>
          <p>We use the following third-party services to operate the Service:</p>
          <ul className="list-disc pl-6 space-y-1 mt-2">
            <li>
              <strong>Supabase</strong> (database, authentication, and edge functions hosting, AWS
              us-west-2 region) &mdash;{' '}
              <a
                href="https://supabase.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                Supabase Privacy Policy
                <span className="sr-only"> (opens in new tab)</span>
              </a>
            </li>
            <li>
              <strong>Google / YouTube API Services</strong> &mdash;{' '}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                Google Privacy Policy
                <span className="sr-only"> (opens in new tab)</span>
              </a>
            </li>
            <li>
              <strong>Google Gemini</strong> (AI summary generation from video captions) &mdash;{' '}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                Google Privacy Policy
                <span className="sr-only"> (opens in new tab)</span>
              </a>
            </li>
          </ul>
          <p className="mt-2">
            We do not use any third-party advertising networks or retargeting services.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">7. Data Storage &amp; Security</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              All data is stored in a secured PostgreSQL database hosted on Supabase Cloud (AWS
              us-west-2 region).
            </li>
            <li>
              Authentication is handled by Supabase Auth. OAuth tokens and session tokens (JWT) are
              managed securely by the Supabase platform.
            </li>
            <li>All connections use HTTPS/TLS encryption.</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">8. Data Retention &amp; Deletion</h2>
          <p>
            We retain your data only for as long as your account is active. YouTube playlist
            metadata is refreshed on each sync and not stored beyond what is displayed in the app.
            OAuth tokens are retained only while your YouTube account is connected.
          </p>
          <p className="mt-2">
            You can disconnect your YouTube account at any time from the Settings page, which
            immediately revokes our access and deletes stored OAuth tokens. To request full account
            and data deletion, contact us at the email below. We will process deletion requests
            within 30 days.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">9. Your Rights</h2>
          <p>You have the right to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Access your personal data stored in the Service.</li>
            <li>Request correction or deletion of your data.</li>
            <li>Request restriction of processing of your data.</li>
            <li>Request a portable copy of your data in a structured format.</li>
            <li>
              Revoke Google/YouTube access at any time via{' '}
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
            <li>
              Lodge a complaint with your local data protection authority if you believe your data
              has been mishandled.
            </li>
          </ul>
          <p className="mt-2">
            To exercise any of these rights, contact us at the email below. We will respond within
            30 days.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">10. Business Transfers</h2>
          <p>
            If Insighta or substantially all of its assets were acquired, or in the unlikely event
            that Insighta goes out of business, user information would be one of the assets
            transferred to the acquiring party. You acknowledge that such transfers may occur, and
            that any acquirer may continue to use your personal information as set forth in this
            policy.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">11. Privacy Policy Changes</h2>
          <p>
            We may update this Privacy Policy from time to time. We encourage you to frequently
            check this page for any changes. Your continued use of the Service after any change in
            this Privacy Policy will constitute your acceptance of such change.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">12. Contact</h2>
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

export default PrivacyPage;
