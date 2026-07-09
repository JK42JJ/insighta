import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home } from 'lucide-react';
import { Button } from '@/shared/ui/button';

/**
 * A cute, brand-consistent 404 mascot — three round characters that gently
 * float and blink (inline CSS/SVG, no external GIF so there's no PWA/hosting
 * dependency and it always renders). No emoji, per brand guidelines.
 */
function LostMascots() {
  const chars = [
    { fill: '#8b83fb', d: 0, look: 'left' },
    { fill: '#ffb056', d: 0.4, look: 'up' },
    { fill: '#4fd1a5', d: 0.8, look: 'right' },
  ];
  return (
    <div className="flex items-end justify-center gap-4" aria-hidden="true">
      <style>{`
        @keyframes nf-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes nf-blink { 0%,92%,100% { transform: scaleY(1); } 96% { transform: scaleY(0.1); } }
      `}</style>
      {chars.map((c, i) => {
        const ex = c.look === 'left' ? -3 : c.look === 'right' ? 3 : 0;
        const ey = c.look === 'up' ? -3 : 0;
        return (
          <svg
            key={i}
            viewBox="0 0 80 80"
            className="w-16 h-16 sm:w-20 sm:h-20"
            style={{ animation: `nf-float 2.6s ease-in-out ${c.d}s infinite` }}
          >
            <circle cx="40" cy="40" r="34" fill={c.fill} stroke="#1c1c22" strokeWidth="3" />
            <g
              style={{
                animation: `nf-blink 3.4s ease-in-out ${c.d}s infinite`,
                transformOrigin: '40px 36px',
              }}
            >
              <circle cx={30 + ex} cy={36 + ey} r="4.5" fill="#1c1c22" />
              <circle cx={50 + ex} cy={36 + ey} r="4.5" fill="#1c1c22" />
            </g>
            <path
              d="M32 52 Q40 46 48 52"
              fill="none"
              stroke="#1c1c22"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        );
      })}
    </div>
  );
}

/**
 * 404 — content only, NO header/footer. `App.tsx` already wraps every route
 * in `<AppShell>`, which supplies context-appropriate chrome: the sidebar for
 * logged-in app routes, nothing for marketing/auth routes. Adding a header or
 * footer here would double up with the shell (a mini "Insighta" header + a
 * "© 2026" footer stacked on top of the app sidebar). Just render the centered
 * content and let the shell decide the surroundings.
 */
export default function NotFoundPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div id="main-content" className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className="text-center space-y-7">
        <LostMascots />
        <h1 className="text-6xl font-bold text-primary">404</h1>
        <h2 className="text-2xl font-semibold text-foreground">{t('notFound.title')}</h2>
        <p className="text-muted-foreground max-w-md mx-auto">{t('notFound.description')}</p>
        <Button size="lg" className="gap-2 rounded-xl" onClick={() => navigate('/')}>
          <Home className="w-4 h-4" aria-hidden="true" />
          {t('notFound.goHome')}
        </Button>
      </div>
    </div>
  );
}
