import { ArrowUp } from 'lucide-react';
import { Header } from '@/widgets/header/ui/Header';
import { Footer } from '@/widgets/header/ui/Footer';
import { useTranslation } from 'react-i18next';

const TermsPage = () => {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header />
      <div className="flex-1 p-4 sm:p-8 max-w-3xl mx-auto w-full legal-prose">
        <h1 className="text-3xl font-bold mb-6">Terms of Service</h1>
        <p className="text-muted-foreground mb-4">Last updated: March 11, 2026</p>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">1. Acceptance of Terms</h2>
          <p>
            By accessing or using Insighta (&quot;the Service&quot;), you agree to be bound by these
            Terms of Service (&quot;Terms&quot;). If you do not agree to these Terms, you may not
            access or use the Service.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">2. Description of Service</h2>
          <p>
            Insighta is a personal knowledge management platform that allows you to sync YouTube
            playlists, generate AI-powered summaries from video captions, take notes, and manage
            learning progress. The Service is provided as-is and may be updated, modified, or
            discontinued at any time without prior notice.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">3. User Accounts</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>You must sign in with a valid Google account to use the Service.</li>
            <li>You are responsible for maintaining the security of your account.</li>
            <li>You must not share your account or use the Service for unauthorized purposes.</li>
            <li>
              You may delete your account at any time by contacting us. Upon deletion, your data
              will be removed within 30 days.
            </li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">4. Subscription &amp; Payment</h2>
          <p>
            The Service currently offers a free tier. If paid plans are introduced in the future,
            the following terms will apply:
          </p>
          <ul className="list-disc pl-6 space-y-1 mt-2">
            <li>Paid subscriptions are billed on a recurring basis (monthly or annually).</li>
            <li>
              Your subscription will automatically renew unless you cancel before the renewal date.
            </li>
            <li>
              You may cancel your subscription at any time from your account settings. Cancellation
              takes effect at the end of the current billing period.
            </li>
            <li>
              Refunds are generally not provided for partial billing periods, except where required
              by applicable law.
            </li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">5. YouTube API Usage</h2>
          <p>
            The Service accesses YouTube data through the YouTube API Services. By using this
            feature, you also agree to the{' '}
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
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">6. AI-Generated Content</h2>
          <p>
            The Service uses Google Gemini to generate summaries from video captions. By using the
            AI summary feature, you acknowledge that:
          </p>
          <ul className="list-disc pl-6 space-y-1 mt-2">
            <li>
              Video captions are transmitted to Google Gemini solely for summary generation and are
              not stored by the AI provider beyond the processing request.
            </li>
            <li>
              AI-generated summaries are provided for informational purposes and may not be fully
              accurate.
            </li>
            <li>
              You retain ownership of any notes or edits you make to AI-generated content within the
              Service.
            </li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">7. User Content</h2>
          <p>
            Content you create within the Service (notes, cards, settings) remains yours. You retain
            all ownership rights to your content.
          </p>
          <p className="mt-2">
            By submitting content to the Service, you grant Insighta a limited, non-exclusive,
            royalty-free license to use, store, and display your content solely for the purpose of
            operating and providing the Service to you. This license terminates when you delete your
            content or your account.
          </p>
          <p className="mt-2">
            YouTube content displayed in the Service belongs to its respective creators and is
            subject to YouTube&apos;s terms.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">8. Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Use the Service to violate any laws or regulations.</li>
            <li>Attempt to circumvent security measures or access controls.</li>
            <li>Use automated tools to scrape or abuse the Service.</li>
            <li>Interfere with the Service&apos;s operation or other users&apos; access.</li>
            <li>Upload or transmit viruses or other malicious code.</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">9. Third-Party Links</h2>
          <p>
            The Service may contain links to third-party websites or services that are not owned or
            controlled by Insighta. We have no control over, and assume no responsibility for, the
            content, privacy policies, or practices of any third-party websites or services. Use of
            the Service does not grant you any rights to the trademarks or intellectual property of
            third parties.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">10. Service Availability</h2>
          <p>
            We strive to keep the Service available at all times, but we do not guarantee
            uninterrupted access. The Service may be temporarily unavailable due to maintenance,
            updates, or circumstances beyond our control. We reserve the right to modify, suspend,
            or discontinue the Service at any time.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">11. Limitation of Liability</h2>
          <p>
            The Service is provided &quot;as is&quot; and &quot;as available&quot; without
            warranties of any kind, either express or implied. To the fullest extent permitted by
            law, Insighta shall not be liable for any indirect, incidental, special, consequential,
            or punitive damages, or any loss of data, profits, or goodwill arising from your use of
            the Service.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">12. Indemnification</h2>
          <p>
            You agree to indemnify and hold harmless Insighta, its operators, and their respective
            officers, employees, and agents from and against any and all claims, damages,
            obligations, losses, and expenses arising from your use of the Service or your violation
            of these Terms.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">13. Termination</h2>
          <p>
            We may suspend or terminate your access at any time for violation of these Terms. You
            may stop using the Service at any time by disconnecting your accounts and requesting
            data deletion. Upon termination, your right to use the Service ceases immediately.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">14. Governing Law</h2>
          <p>
            These Terms shall be governed by and construed in accordance with the laws of the
            Republic of Korea, without regard to its conflict of law provisions. Any disputes
            arising from these Terms or the Service shall be subject to the exclusive jurisdiction
            of the courts located in Seoul, Republic of Korea.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">15. Changes to Terms</h2>
          <p>
            We may update these Terms from time to time. We will notify users of material changes by
            posting the updated Terms on this page with a revised &quot;Last updated&quot; date.
            Continued use of the Service after changes constitutes acceptance of the updated Terms.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">16. Contact</h2>
          <p>
            For questions about these Terms, contact:{' '}
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

export default TermsPage;
