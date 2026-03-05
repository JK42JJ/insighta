import { Footer } from '@/components/Footer';

const Terms = () => {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <div className="flex-1 p-8 max-w-3xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-6">Terms of Service</h1>
        <p className="text-muted-foreground mb-4">Last updated: March 5, 2026</p>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">1. Acceptance of Terms</h2>
          <p>
            By accessing or using Insighta (&quot;the Service&quot;), you agree to be bound by these
            Terms of Service. If you do not agree, please do not use the Service.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">2. Description of Service</h2>
          <p>
            Insighta is a personal knowledge management platform that allows you to sync YouTube
            playlists, take notes, and manage learning progress. The Service is provided as-is for
            personal, non-commercial use.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">3. User Accounts</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>You must sign in with a valid Google account to use the Service.</li>
            <li>You are responsible for maintaining the security of your account.</li>
            <li>You must not share your account or use the Service for unauthorized purposes.</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">4. YouTube API Usage</h2>
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
            </a>
            .
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">5. Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Use the Service to violate any laws or regulations.</li>
            <li>Attempt to circumvent security measures or access controls.</li>
            <li>Use automated tools to scrape or abuse the Service.</li>
            <li>Interfere with the Service&apos;s operation or other users&apos; access.</li>
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">6. Intellectual Property</h2>
          <p>
            Content you create (notes, cards) remains yours. YouTube content displayed in the
            Service belongs to its respective creators and is subject to YouTube&apos;s terms.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">7. Limitation of Liability</h2>
          <p>
            The Service is provided &quot;as is&quot; without warranties of any kind. We are not
            liable for any data loss, service interruptions, or damages arising from use of the
            Service.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">8. Termination</h2>
          <p>
            We may suspend or terminate your access at any time for violation of these terms. You
            may stop using the Service at any time by disconnecting your accounts and deleting your
            data.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">9. Changes to Terms</h2>
          <p>
            We may update these terms from time to time. Continued use of the Service after changes
            constitutes acceptance of the updated terms.
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">10. Contact</h2>
          <p>
            For questions about these terms, contact:{' '}
            <a href="mailto:jamesjk4242@gmail.com" className="text-primary underline">
              jamesjk4242@gmail.com
            </a>
          </p>
        </section>
      </div>
      <Footer />
    </div>
  );
};

export default Terms;
