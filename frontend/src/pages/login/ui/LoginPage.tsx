import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Loader2, Eye, EyeOff, Mail, CheckCircle2, ChevronLeft,
  LayoutGrid, Video, Sparkles, Activity,
} from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { useAuth } from '@/features/auth/model/useAuth';

// ── SVG Brand Icons ────────────────────────────────────────

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function KakaoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 3C6.48 3 2 6.48 2 10.8c0 2.78 1.86 5.22 4.64 6.6-.2.75-.73 2.72-.84 3.14-.13.52.19.51.4.37.17-.11 2.63-1.79 3.7-2.52.68.1 1.39.15 2.1.15 5.52 0 10-3.48 10-7.74C22 6.48 17.52 3 12 3z" />
    </svg>
  );
}

// ── Feature config ─────────────────────────────────────────

const FEATURES = [
  { key: 'feature1', icon: LayoutGrid, iconClass: 'text-primary', bgClass: 'bg-primary/10' },
  { key: 'feature2', icon: Video, iconClass: 'text-red-400', bgClass: 'bg-red-500/10' },
  { key: 'feature3', icon: Sparkles, iconClass: 'text-amber-400', bgClass: 'bg-amber-500/10' },
  { key: 'feature4', icon: Activity, iconClass: 'text-emerald-400', bgClass: 'bg-emerald-500/10' },
] as const;

const SOCIAL_PROOF_AVATARS = [
  { initial: 'J', className: 'bg-primary' },
  { initial: 'K', className: 'bg-emerald-600' },
  { initial: 'M', className: 'bg-amber-500' },
  { initial: 'S', className: 'bg-red-500' },
  { initial: 'H', className: 'bg-purple-500' },
];

const SOCIAL_PROOF_CARDS = 645;
const SOCIAL_PROOF_USERS = 7;

// ── Types ──────────────────────────────────────────────────

type AuthMode = 'signin' | 'signup';
type SuccessState = 'none' | 'magicLink' | 'signup' | 'resetPassword';

// ── Component ──────────────────────────────────────────────

export default function LoginPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const {
    isLoggedIn,
    isLoading,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signInWithMagicLink,
    resetPassword,
  } = useAuth();
  const [searchParams] = useSearchParams();

  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successState, setSuccessState] = useState<SuccessState>('none');

  useEffect(() => {
    if (!isLoading && isLoggedIn) {
      const returnTo = searchParams.get('returnTo');
      const safeReturnTo =
        returnTo && returnTo.startsWith('/') && returnTo !== '/login' ? returnTo : '/';
      navigate(safeReturnTo, { replace: true });
    }
  }, [isLoggedIn, isLoading, navigate, searchParams]);

  const storeReturnTo = () => {
    const returnTo = searchParams.get('returnTo');
    if (returnTo) sessionStorage.setItem('auth-return-to', returnTo);
  };

  const handleGoogleLogin = async () => {
    storeReturnTo();
    setError(null);
    setIsSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    storeReturnTo();
    setError(null);
    setIsSubmitting(true);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password, name || undefined);
        setSuccessState('signup');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMagicLink = async () => {
    if (!email) {
      setError(t('login.emailPlaceholder'));
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await signInWithMagicLink(email);
      setSuccessState('magicLink');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Magic link failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError(t('login.emailPlaceholder'));
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await resetPassword(email);
      setSuccessState('resetPassword');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchMode = (newMode: AuthMode) => {
    setMode(newMode);
    setError(null);
    setSuccessState('none');
  };

  const backToSignIn = () => {
    setSuccessState('none');
    setMode('signin');
    setError(null);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const logoSrc = `${import.meta.env.BASE_URL}logo.png`;

  return (
    <div className="min-h-screen flex bg-background">
        {/* ═══ LEFT: Brand Panel ═══ */}
        <div className="hidden lg:flex w-[45%] flex-col items-center justify-center px-12 pb-24 pt-10 relative overflow-hidden border-r border-border/40">
          {/* Animated gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-purple-500/[0.04]" />
          <div className="absolute top-[15%] -left-[15%] w-[500px] h-[500px] rounded-full bg-primary/[0.07] blur-[100px] animate-gradient-blob-1 pointer-events-none" />
          <div className="absolute bottom-[10%] -right-[10%] w-[350px] h-[350px] rounded-full bg-purple-500/[0.05] blur-[80px] animate-gradient-blob-2 pointer-events-none" />

          <div className="w-full max-w-[480px] relative z-10">
            {/* Logo */}
            <div className="flex items-center gap-2.5 mb-12">
              <img
                src={logoSrc}
                alt="Insighta"
                className="w-9 h-9 rounded-xl dark:invert"
              />
              <span className="text-2xl font-bold tracking-tight text-foreground">Insighta</span>
              <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/30">
                {t('common.beta')}
              </span>
            </div>

            {/* Headline */}
            <h1 className="text-[2.5rem] leading-[1.15] font-serif mb-4 text-foreground whitespace-pre-line">
              {t('login.headline')}
            </h1>
            <p className="text-[15px] text-muted-foreground mb-8 leading-relaxed whitespace-pre-line">
              {t('login.brandSub')}
            </p>

            {/* Features */}
            <ul className="space-y-4 mb-10">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <li key={f.key} className="flex items-start gap-3 text-sm text-muted-foreground leading-relaxed">
                    <div className={`w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center mt-0.5 ${f.bgClass}`}>
                      <Icon className={`w-3.5 h-3.5 ${f.iconClass}`} />
                    </div>
                    <span dangerouslySetInnerHTML={{ __html: t(`login.${f.key}`).replace(/^(.+?) — /, '<strong class="text-foreground font-medium">$1</strong> — ') }} />
                  </li>
                );
              })}
            </ul>

            {/* Social proof */}
            <div className="flex items-center gap-4">
            <div className="flex">
              {SOCIAL_PROOF_AVATARS.map((av, i) => (
                <div
                  key={av.initial}
                  className={`w-8 h-8 rounded-full border-2 border-background flex items-center justify-center text-xs font-bold text-white ${av.className}`}
                  style={{ marginLeft: i > 0 ? '-8px' : 0 }}
                >
                  {av.initial}
                </div>
              ))}
            </div>
            <span className="text-[13px] text-muted-foreground/70">
              {t('login.socialProof', { cards: SOCIAL_PROOF_CARDS, users: SOCIAL_PROOF_USERS })}
            </span>
            </div>
          </div>
        </div>

        {/* ═══ RIGHT: Auth Panel ═══ */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 sm:pt-[12vh] relative">
          <div className="w-full max-w-[400px]">
            {successState !== 'none' ? (
              <SuccessMessage
                state={successState}
                email={email}
                t={t}
                onBack={backToSignIn}
              />
            ) : (
              <>
                {/* Mobile logo (hidden on lg+) */}
                <div className="lg:hidden flex items-center justify-center gap-2.5 mb-8">
                  <img
                    src={logoSrc}
                    alt="Insighta"
                    className="w-8 h-8 rounded-xl dark:invert"
                  />
                  <span className="text-xl font-bold tracking-tight text-foreground">Insighta</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/30">
                    {t('common.beta')}
                  </span>
                </div>

                {/* Tabs */}
                <div className="flex gap-0.5 mb-7 bg-muted rounded-xl p-1">
                  <button
                    type="button"
                    onClick={() => switchMode('signin')}
                    className={`flex-1 py-2.5 text-center text-[13px] font-semibold rounded-[10px] transition-all ${
                      mode === 'signin'
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground/70'
                    }`}
                  >
                    {t('login.tabSignIn')}
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode('signup')}
                    className={`flex-1 py-2.5 text-center text-[13px] font-semibold rounded-[10px] transition-all ${
                      mode === 'signup'
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground/70'
                    }`}
                  >
                    {t('login.tabCreateAccount')}
                  </button>
                </div>

                {/* Social buttons */}
                <div className="flex flex-col gap-2.5 mb-6">
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={isSubmitting}
                    className="w-full h-12 flex items-center justify-center gap-2.5 rounded-xl text-sm font-semibold border border-border bg-card text-foreground hover:bg-accent hover:-translate-y-px hover:shadow-md active:translate-y-0 transition-all disabled:opacity-50"
                  >
                    <GoogleIcon className="w-[18px] h-[18px]" />
                    {t('login.continueWithGoogle')}
                  </button>
                  <div className="relative group">
                    <button
                      type="button"
                      disabled
                      className="w-full h-12 flex items-center justify-center gap-2.5 rounded-xl text-sm font-semibold cursor-not-allowed transition-all border border-[#FEE500]/30 bg-[#FEE500]/20 text-[#FEE500] grayscale-[0.4] opacity-60"
                    >
                      <KakaoIcon className="w-[18px] h-[18px]" />
                      {t('login.continueWithKakao')}
                    </button>
                    <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 text-xs rounded bg-foreground text-background opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                      {t('login.kakaoComingSoon')}
                    </span>
                  </div>
                </div>

                {/* Divider */}
                <div className="flex items-center gap-4 mb-6">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground/60 font-medium whitespace-nowrap">
                    {t('login.orContinueWithEmail')}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                {/* Error */}
                {error && (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm mb-4">
                    {error}
                  </div>
                )}

                {/* Email form */}
                <form onSubmit={handleEmailSubmit} className="space-y-4">
                  {mode === 'signup' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="name" className="text-[13px] font-semibold text-muted-foreground">
                        {t('login.fullName')}
                      </Label>
                      <Input
                        id="name"
                        type="text"
                        placeholder={t('login.fullNamePlaceholder')}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="h-11"
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-[13px] font-semibold text-muted-foreground">
                      {t('login.email')}
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder={t('login.emailPlaceholder')}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="h-11"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-[13px] font-semibold text-muted-foreground">
                      {t('login.password')}
                    </Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder={t('login.passwordPlaceholder')}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="h-11 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {mode === 'signin' && (
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        className="block text-right w-full text-xs text-primary/80 hover:text-primary hover:underline transition-colors mt-1"
                      >
                        {t('login.forgotPassword')}
                      </button>
                    )}
                  </div>

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full h-12 text-sm font-bold rounded-xl mt-2"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : mode === 'signin' ? (
                      t('login.signIn')
                    ) : (
                      t('login.createAccount')
                    )}
                  </Button>
                </form>

                {/* Magic link */}
                <button
                  type="button"
                  onClick={handleMagicLink}
                  disabled={isSubmitting}
                  className="w-full mt-3 py-2.5 flex items-center justify-center gap-2 rounded-xl text-[13px] font-semibold text-primary/80 border border-primary/20 hover:bg-primary/[0.06] hover:border-primary/30 transition-all disabled:opacity-50"
                >
                  <Mail className="w-4 h-4" />
                  {t('login.sendMagicLink')}
                </button>

                {/* Mode switch */}
                <p className="text-center mt-6 text-[13px] text-muted-foreground">
                  {mode === 'signin' ? t('login.noAccount') : t('login.hasAccount')}{' '}
                  <button
                    type="button"
                    onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
                    className="text-primary/80 font-semibold hover:text-primary hover:underline transition-colors"
                  >
                    {mode === 'signin' ? t('login.createOne') : t('login.signInLink')}
                  </button>
                </p>

                {/* Terms */}
                <p className="text-center mt-5 text-[11.5px] text-muted-foreground/60 leading-relaxed">
                  {t('login.agreeToTerms')}{' '}
                  <Link to="/terms" className="text-muted-foreground underline underline-offset-2 hover:text-primary transition-colors">
                    {t('login.termsOfService')}
                  </Link>{' '}
                  {t('login.and')}{' '}
                  <Link to="/privacy" className="text-muted-foreground underline underline-offset-2 hover:text-primary transition-colors">
                    {t('login.privacyPolicy')}
                  </Link>
                  {t('login.agreeSuffix')}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
  );
}

// ── Success Message Component ──────────────────────────────

interface SuccessMessageProps {
  state: Exclude<SuccessState, 'none'>;
  email: string;
  t: (key: string) => string;
  onBack: () => void;
}

function SuccessMessage({ state, email, t, onBack }: SuccessMessageProps) {
  const config = {
    magicLink: { title: t('login.magicLinkSent'), desc: t('login.magicLinkDesc') },
    signup: { title: t('login.signupComplete'), desc: t('login.signupCompleteDesc') },
    resetPassword: { title: t('login.resetPasswordSent'), desc: t('login.resetPasswordDesc') },
  };

  const { title, desc } = config[state];

  return (
    <div className="text-center space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="w-14 h-14 rounded-full bg-green-500/10 border-2 border-green-500/30 flex items-center justify-center mx-auto">
        <CheckCircle2 className="w-6 h-6 text-green-500" />
      </div>
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="text-sm text-muted-foreground">
        {desc} {state === 'magicLink' && <strong>{email}</strong>}
      </p>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-primary/80 border border-primary/20 hover:bg-primary/[0.06] hover:border-primary/30 transition-all"
      >
        <ChevronLeft className="w-4 h-4" />
        {t('login.backToSignIn')}
      </button>
    </div>
  );
}
