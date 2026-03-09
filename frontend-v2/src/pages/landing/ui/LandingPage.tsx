import { useAuth } from '@/features/auth/model/useAuth';
import { LTDBanner } from './components/LTDBanner';
import { LandingHeader } from './components/LandingHeader';
import { HeroSection } from './components/HeroSection';
import { FeatureCards } from './components/FeatureCards';
import { HowItWorks } from './components/HowItWorks';
import { TestimonialsSection } from './components/TestimonialsSection';
import { CTASection } from './components/CTASection';
import { FooterSection } from './components/FooterSection';

export default function LandingPage() {
  const { signInWithGoogle } = useAuth();

  const handleLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <LTDBanner />
      <LandingHeader onLogin={handleLogin} />
      <main id="main-content">
        <HeroSection onLogin={handleLogin} />
        <FeatureCards />
        <HowItWorks />
        <TestimonialsSection />
        <CTASection />
      </main>
      <FooterSection />
    </div>
  );
}
