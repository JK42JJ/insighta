import { memo, useMemo, useState, useEffect, useRef } from 'react';
import { createAvatar } from '@dicebear/core';
import { adventurer } from '@dicebear/collection';
import type { MandalaAvatarProps } from '../model/types';

// --- Theme presets: keyword-based avatar appearance mapping ---

type HairVariant = 'short01' | 'short02' | 'short03' | 'short04' | 'short05' | 'short06' | 'long01' | 'long02' | 'long03' | 'long04' | 'long05' | 'long06';
type GlassesVariant = 'variant01' | 'variant02' | 'variant03' | 'variant04' | 'variant05';
type EarringsVariant = 'variant01' | 'variant02' | 'variant03' | 'variant04' | 'variant05' | 'variant06';

interface ThemePreset {
  hair?: HairVariant[];
  hairColor?: string[];
  glasses?: GlassesVariant[];
  glassesProbability?: number;
  earrings?: EarringsVariant[];
  earringsProbability?: number;
}

const THEME_PRESETS = {
  tech: {
    hair: ['short01', 'short02', 'short04', 'short05'],
    hairColor: ['0e0e0e', '562306', '28150a'],
    glasses: ['variant01', 'variant02', 'variant03'],
    glassesProbability: 70,
  },
  creative: {
    hair: ['long01', 'long02', 'long03', 'long04', 'long05', 'long06'],
    hairColor: ['dba3be', '85c2c6', '3eac2c', 'c29aef'],
    glassesProbability: 15,
    earrings: ['variant01', 'variant02', 'variant03'],
    earringsProbability: 60,
  },
  business: {
    hair: ['short01', 'short02', 'short03', 'short05'],
    hairColor: ['6a4e35', '0e0e0e', '28150a'],
    glasses: ['variant01', 'variant02'],
    glassesProbability: 45,
  },
  language: {
    hair: ['short01', 'short02', 'long01', 'long02', 'long04'],
    hairColor: ['ac6511', 'cb6820', '6a4e35'],
    glassesProbability: 40,
  },
  fitness: {
    hair: ['short01', 'short02', 'short04'],
    hairColor: ['b9a05f', 'e5d7a3', 'ac6511'],
    glassesProbability: 0,
  },
  study: {
    hair: ['short01', 'short02', 'long01', 'long02', 'short05'],
    hairColor: ['0e0e0e', '562306', '6a4e35'],
    glasses: ['variant01', 'variant02', 'variant03'],
    glassesProbability: 60,
  },
  lifestyle: {
    hair: ['long01', 'long02', 'long03', 'long04', 'long06'],
    hairColor: ['ac6511', 'cb6820', 'b9a05f'],
    glassesProbability: 20,
    earrings: ['variant01', 'variant02'],
    earringsProbability: 40,
  },
} as const satisfies Record<string, ThemePreset>;

const THEME_KEYWORDS: Record<string, string[]> = {
  tech: ['ai', 'ml', '\uAC1C\uBC1C', '\uCF54\uB529', '\uD504\uB85C\uADF8\uB798\uBC0D', 'developer', 'coding', 'data', 'programming', '\uC5D4\uC9C0\uB2C8\uC5B4', 'engineer', '\uC18C\uD504\uD2B8\uC6E8\uC5B4', 'software', 'backend', 'frontend', '\uC54C\uACE0\uB9AC\uC998', 'algorithm', 'devops', 'cloud'],
  creative: ['\uB514\uC790\uC778', 'ux', 'ui', '\uC74C\uC545', '\uC608\uC220', 'art', 'design', 'creative', '\uADF8\uB9BC', '\uC77C\uB7EC\uC2A4\uD2B8', '\uC0AC\uC9C4', 'photo', 'video', '\uC601\uC0C1', 'animation', '\uBE0C\uB79C\uB4DC'],
  business: ['\uBE44\uC988\uB2C8\uC2A4', '\uB9C8\uCF00\uD305', '\uACBD\uC601', '\uCC3D\uC5C5', 'startup', 'mba', 'finance', '\uC7AC\uBB34', '\uD22C\uC790', 'invest', '\uB9E4\uCD9C', '\uC804\uB7B5', 'strategy', 'ceo', '\uB9AC\uB354\uC2ED', 'leadership'],
  language: ['\uC601\uC5B4', '\uC77C\uBCF8\uC5B4', '\uC911\uAD6D\uC5B4', '\uD55C\uAD6D\uC5B4', 'language', 'toeic', 'jlpt', 'toefl', 'ielts', '\uD68C\uD654', '\uBB38\uBC95', '\uC5B4\uD718', 'vocab', '\uC2A4\uD398\uC778\uC5B4', '\uD504\uB791\uC2A4\uC5B4', '\uB3C5\uC77C\uC5B4'],
  fitness: ['\uC6B4\uB3D9', '\uD5EC\uC2A4', '\uB2E4\uC774\uC5B4\uD2B8', '\uB9C8\uB77C\uD1A4', 'fitness', 'gym', 'health', '\uCCB4\uB825', '\uADFC\uB825', '\uC694\uAC00', 'yoga', '\uD544\uB77C\uD14C\uC2A4', '\uB7EC\uB2DD', 'running', '\uC218\uC601'],
  study: ['\uC218\uB2A5', '\uACF5\uBD80', '\uC2DC\uD5D8', '\uC790\uACA9\uC99D', 'exam', 'study', '\uB300\uD559', '\uD559\uC2B5', '\uC218\uD559', '\uACFC\uD559', '\uBB3C\uB9AC', '\uD654\uD559', '\uD1A0\uC775', '\uD3B8\uC785', '\uACE0\uC2DC', '\uC784\uC6A9'],
  lifestyle: ['\uC694\uB9AC', '\uC5EC\uD589', '\uB3C5\uC11C', '\uCDE8\uBBF8', 'travel', 'cooking', 'hobby', '\uB3C5\uC11C', '\uC640\uC778', '\uCEE4\uD53C', '\uCEA0\uD551', '\uB4F1\uC0B0', '\uB09A\uC2DC', '\uC6D0\uC608', '\uBC18\uB824'],
};

function inferTheme(centerGoal: string): ThemePreset | null {
  const lower = centerGoal.toLowerCase();
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return (THEME_PRESETS as Record<string, ThemePreset>)[theme] ?? null;
    }
  }
  return null;
}

// 5 activity levels: sad -> worried -> neutral -> smile -> joy
const ACTIVITY_LEVELS = [0, 1, 5, 15, 30] as const;

interface ExpressionPreset {
  eyes: string[];
  eyebrows: string[];
  mouth: string[];
}

const EXPRESSION_PRESETS = [
  { eyes: ['variant26' as const], eyebrows: ['variant06' as const], mouth: ['variant17' as const] },
  { eyes: ['variant20' as const], eyebrows: ['variant09' as const], mouth: ['variant07' as const] },
  { eyes: ['variant01' as const], eyebrows: ['variant01' as const], mouth: ['variant01' as const] },
  { eyes: ['variant12' as const], eyebrows: ['variant13' as const], mouth: ['variant22' as const] },
  { eyes: ['variant17' as const], eyebrows: ['variant15' as const], mouth: ['variant30' as const] },
] satisfies ExpressionPreset[];

function getActivityLevel(totalCards: number): number {
  for (let i = ACTIVITY_LEVELS.length - 1; i >= 0; i--) {
    if (totalCards >= ACTIVITY_LEVELS[i]!) return i;
  }
  return 0;
}

const IDLE_MIN_MS = 20000;
const IDLE_MAX_MS = 35000;
const IDLE_HOLD_MS = 3000;

function buildAvatarUri(
  seed: string,
  preset: ExpressionPreset,
  theme: ThemePreset | null,
): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const avatar = createAvatar(adventurer, {
    seed,
    eyes: preset.eyes as any,
    eyebrows: preset.eyebrows as any,
    mouth: preset.mouth as any,
    ...(theme?.hair && { hair: theme.hair }),
    ...(theme?.hairColor && { hairColor: theme.hairColor }),
    ...(theme?.glasses && { glasses: theme.glasses }),
    ...(theme?.glassesProbability !== undefined && { glassesProbability: theme.glassesProbability }),
    ...(theme?.earrings && { earrings: theme.earrings }),
    ...(theme?.earringsProbability !== undefined && { earringsProbability: theme.earringsProbability }),
  });
  return avatar.toDataUri();
}

const DiceBearFallback = memo(function DiceBearFallback({
  seed,
  totalCards,
  centerGoal,
}: {
  seed: string;
  totalCards: number;
  centerGoal: string;
}) {
  const baseLevel = getActivityLevel(totalCards);
  const theme = useMemo(() => inferTheme(centerGoal), [centerGoal]);
  const [idleLevel, setIdleLevel] = useState<number | null>(null);

  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function scheduleNext() {
      const delay = IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
      scheduleRef.current = setTimeout(() => {
        const candidates = [baseLevel - 1, baseLevel + 1].filter(
          (l) => l >= 0 && l < EXPRESSION_PRESETS.length,
        );
        if (candidates.length === 0) { scheduleNext(); return; }
        const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
        setIdleLevel(pick);
        holdRef.current = setTimeout(() => { setIdleLevel(null); scheduleNext(); }, IDLE_HOLD_MS);
      }, delay);
    }
    scheduleNext();
    return () => {
      if (scheduleRef.current) clearTimeout(scheduleRef.current);
      if (holdRef.current) clearTimeout(holdRef.current);
    };
  }, [baseLevel]);

  const activeLevel = idleLevel ?? baseLevel;
  const svgDataUri = useMemo(
    () => buildAvatarUri(seed, EXPRESSION_PRESETS[activeLevel]!, theme),
    [seed, activeLevel, theme],
  );

  return (
    <img
      src={svgDataUri}
      alt=""
      className="rounded-full drop-shadow-md flex-1 min-h-0 object-contain animate-avatar-float transition-opacity duration-700"
      style={{ width: '80%', maxHeight: '80%' }}
      draggable={false}
    />
  );
});

export const MandalaAvatar = memo(function MandalaAvatar({
  seed,
  totalCards,
  centerGoal,
  riveUrl,
  className,
}: MandalaAvatarProps) {
  const [riveError, setRiveError] = useState(false);

  // Phase 1b: Rive rendering when riveUrl is available
  if (riveUrl && !riveError) {
    return (
      <RiveFallbackWrapper
        riveUrl={riveUrl}
        seed={seed}
        onError={() => setRiveError(true)}
        className={className}
      />
    );
  }

  // DiceBear fallback
  return <DiceBearFallback seed={seed} totalCards={totalCards} centerGoal={centerGoal} />;
});

// Phase 1b: Lazy-loaded Rive component (activated when .riv file is available)
// Uses React.lazy + dynamic import to avoid bundling Rive WASM when not needed.
import React, { lazy, Suspense } from 'react';

const RIVE_STATE_MACHINE = 'State Machine 1';

const LazyRiveAvatar = lazy(() =>
  import('@rive-app/react-canvas').then((mod) => ({
    default: function RiveAvatar({
      riveUrl,
      seed,
      onError,
      className,
    }: {
      riveUrl: string;
      seed: string;
      onError: () => void;
      className?: string;
    }) {
      const { rive, RiveComponent } = mod.useRive({
        src: riveUrl,
        stateMachines: RIVE_STATE_MACHINE,
        autoplay: true,
        onLoadError: (e: unknown) => {
          console.warn('[MandalaAvatar] Rive load error, falling back to DiceBear', e);
          onError();
        },
        onLoad: () => {
          if (import.meta.env.DEV && rive) {
            const inputs = rive.stateMachineInputs(RIVE_STATE_MACHINE);
            console.log('[MandalaAvatar] Rive loaded', {
              stateMachines: rive.stateMachineNames,
              inputs: inputs?.map((i: any) => ({ name: i.name, type: i.type, value: i.value })),
            });
          }
        },
      });

      // Set numeric inputs from seed hash for avatar variation
      useEffect(() => {
        if (!rive) return;
        const inputs = rive.stateMachineInputs(RIVE_STATE_MACHINE);
        if (!inputs) return;
        // Hash seed to get deterministic numeric values
        let hash = 0;
        for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
        // Apply hash-based values to numeric inputs for variation
        const numInputs = inputs.filter((i: any) => i.type === 56); // 56 = number type in Rive
        numInputs.forEach((input: any, idx: number) => {
          const val = Math.abs((hash >> (idx * 3)) % 100);
          input.value = val;
        });
      }, [rive, seed]);

      return (
        <div className={className} style={{ width: '80%', aspectRatio: '1', maxHeight: '80%' }}>
          <RiveComponent style={{ width: '100%', height: '100%' }} />
        </div>
      );
    },
  })),
);

class RiveErrorBoundary extends React.Component<
  { onError: () => void; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.hasError ? null : this.props.children; }
}

function RiveFallbackWrapper({
  riveUrl,
  seed,
  onError,
  className,
}: {
  riveUrl: string;
  seed: string;
  onError: () => void;
  className?: string;
}) {
  return (
    <RiveErrorBoundary onError={onError}>
      <Suspense fallback={null}>
        <LazyRiveAvatar riveUrl={riveUrl} seed={seed} onError={onError} className={className} />
      </Suspense>
    </RiveErrorBoundary>
  );
}
