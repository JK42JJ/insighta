import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/model/useAuth';
import { LTDBanner } from './components/LTDBanner';
import { LandingHeader } from './components/LandingHeader';
import { HeroSection } from './components/HeroSection';
import { FeatureCards } from './components/FeatureCards';
import { HowItWorks } from './components/HowItWorks';
import { TestimonialsSection } from './components/TestimonialsSection';
import { CTASection } from './components/CTASection';
import { FooterSection } from './components/FooterSection';
import { GradientBackground } from './components/GradientBackground';

export default function LandingPage() {
  const { signInWithGoogle } = useAuth();
  const location = useLocation();

  useEffect(() => {
    const scrollTo = (location.state as { scrollTo?: string })?.scrollTo;
    if (scrollTo) {
      // Small delay to ensure DOM is rendered
      setTimeout(() => {
        document.getElementById(scrollTo)?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      // Clear the state so it doesn't re-scroll on re-render
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  const handleLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  return (
    <div className="relative min-h-screen bg-background">
      <GradientBackground variant="F" />
      <div className="relative z-10">
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
    </div>
  );
}
