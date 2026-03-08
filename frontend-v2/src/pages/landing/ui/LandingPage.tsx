import { useAuth } from '@/features/auth/model/useAuth';
import { LandingHeader } from './components/LandingHeader';
import { HeroSection } from './components/HeroSection';
import { FeatureCards } from './components/FeatureCards';
import { BentoSection } from './components/BentoSection';
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
      <LandingHeader onLogin={handleLogin} />
      <main id="main-content">
      <HeroSection onLogin={handleLogin} />
      <FeatureCards />
      <BentoSection onLogin={handleLogin} />
      <CTASection onLogin={handleLogin} />
      </main>
      <FooterSection />
    </div>
  );
}
