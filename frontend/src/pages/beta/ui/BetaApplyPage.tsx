import { useState, useEffect, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiClient } from '@/shared/lib/api-client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Curriculum mockup — real 3Blue1Brown "Essence of Linear Algebra" thumbnails,
// visually verified to match each topic (Vectors / Linear transformations /
// Eigenvectors Av=λv / SVD). Same i.ytimg.com source the app itself uses.
const yt = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const CURRICULUM_THUMBS = ['fNk_zzaMoSs', 'kYB8IZa5AuE', 'PFDu9oVAE-g', 'mBcLRGuAFUk'];
const SEATS_LEFT = 40;
const INVITE_SENT = 160;
const INVITE_TOTAL = 200;

// Closed-beta window (James 2026-07-08): starts next Monday, runs 6 weeks (KST).
const BETA_START_MS = Date.parse('2026-07-13T00:00:00+09:00');
const BETA_END_MS = Date.parse('2026-08-24T00:00:00+09:00');

/**
 * Closed-beta landing (/beta) — faithful implementation of the Claude Design
 * "Insighta 클로즈드 베타 랜딩" (James, 2026-07-08). Six sections: hero with
 * product mockup, problem, solution (before/after + 3 steps), knowledge graph,
 * note density, founding-member benefits, and the apply form (goal + email).
 * Deliberately single-look dark marketing surface, mobile-allowed.
 */

function SectionLabel({ no, label }: { no: string; label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 text-[13px] tracking-[0.2em] text-zinc-500 font-semibold">
      <span>{no}</span>
      <span className="w-8 h-px bg-zinc-700" />
      <span>{label}</span>
    </div>
  );
}

/** Live D/H/M/S countdown for the 6-week closed-beta window. */
function BetaCountdown() {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const beforeStart = now < BETA_START_MS;
  const ended = now >= BETA_END_MS;
  const target = beforeStart ? BETA_START_MS : BETA_END_MS;
  const remain = Math.max(0, target - now);

  const days = Math.floor(remain / 86_400_000);
  const hours = Math.floor((remain % 86_400_000) / 3_600_000);
  const mins = Math.floor((remain % 3_600_000) / 60_000);
  const secs = Math.floor((remain % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');

  const label = ended
    ? t('beta.countdown.ended')
    : beforeStart
      ? t('beta.countdown.toStart')
      : t('beta.countdown.toEnd');

  const units: Array<[number | string, string]> = [
    [days, t('beta.countdown.days')],
    [pad(hours), t('beta.countdown.hours')],
    [pad(mins), t('beta.countdown.mins')],
    [pad(secs), t('beta.countdown.secs')],
  ];

  return (
    <div className="inline-flex flex-col items-start gap-2.5">
      <span className="text-[12px] tracking-[0.15em] font-semibold text-indigo-300/90 uppercase">
        {label}
      </span>
      {ended ? (
        <span className="text-2xl font-extrabold text-zinc-300">{t('beta.countdown.ended')}</span>
      ) : (
        <div className="flex items-center gap-2" role="timer" aria-label={label}>
          {units.map(([v, u], i) => (
            <div key={u} className="flex items-center gap-2">
              <div className="flex flex-col items-center">
                <span className="tabular-nums text-3xl font-extrabold text-zinc-50 leading-none">
                  {v}
                </span>
                <span className="mt-1 text-[10px] tracking-wider text-zinc-500 uppercase">{u}</span>
              </div>
              {i < units.length - 1 && (
                <span className="text-2xl font-bold text-zinc-600 -mt-2">:</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Static product mockup — the "내 커리큘럼" card from the hero. */
function CurriculumMockup() {
  const { t } = useTranslation();
  const rows = [
    {
      title: t('beta.mock.v1'),
      ch: 'Essence of Math',
      time: '18:24',
      done: true,
      thumb: yt(CURRICULUM_THUMBS[0]),
    },
    {
      title: t('beta.mock.v2'),
      ch: 'MIT OpenCourseWare',
      time: '42:10',
      done: true,
      thumb: yt(CURRICULUM_THUMBS[1]),
    },
    {
      title: t('beta.mock.v3'),
      ch: 'StatQuest',
      time: '27:33',
      done: false,
      thumb: yt(CURRICULUM_THUMBS[2]),
    },
    {
      title: t('beta.mock.v4'),
      ch: '3Blue1Brown',
      time: '21:05',
      done: false,
      thumb: yt(CURRICULUM_THUMBS[3]),
    },
  ];
  return (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur px-6 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span className="flex gap-1.5">
          <i className="w-2 h-2 rounded-full bg-zinc-600 inline-block" />
          <i className="w-2 h-2 rounded-full bg-zinc-600 inline-block" />
          <i className="w-2 h-2 rounded-full bg-zinc-600 inline-block" />
        </span>
        <span className="ml-2">insighta · {t('beta.mock.header')}</span>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div>
          <div className="text-[11px] tracking-widest text-zinc-500">
            {t('beta.mock.goalLabel')}
          </div>
          <div className="mt-1 text-lg font-bold text-zinc-100">{t('beta.mock.goal')}</div>
        </div>
        <div className="relative w-14 h-14">
          <svg viewBox="0 0 56 56" className="w-14 h-14 -rotate-90">
            <circle
              cx="28"
              cy="28"
              r="24"
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="5"
            />
            <circle
              cx="28"
              cy="28"
              r="24"
              fill="none"
              stroke="#8b83fb"
              strokeWidth="5"
              strokeDasharray={2 * Math.PI * 24}
              strokeDashoffset={2 * Math.PI * 24 * (1 - 0.42)}
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-indigo-300">
            42%
          </span>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-zinc-500">
        <span className="font-semibold text-zinc-400">{t('beta.mock.module')}</span>
        <span>{t('beta.mock.moduleCount')}</span>
      </div>
      <ul className="mt-3 space-y-2.5">
        {rows.map((r) => (
          <li key={r.title} className="flex items-center gap-3">
            <span
              className={`w-5 h-5 rounded-full border flex items-center justify-center flex-none ${
                r.done ? 'bg-indigo-500 border-indigo-400' : 'border-zinc-600'
              }`}
            >
              {r.done && (
                <svg viewBox="0 0 12 12" className="w-3 h-3">
                  <path
                    d="M2.5 6.5l2.2 2.2L9.5 3.6"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </span>
            <span className="relative w-14 h-9 rounded-md bg-gradient-to-br from-zinc-700 to-zinc-800 flex-none overflow-hidden">
              <img
                src={r.thumb}
                alt=""
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover"
              />
              <span className="absolute bottom-0.5 right-1 text-[9px] text-zinc-300 bg-black/60 rounded px-1">
                {r.time}
              </span>
            </span>
            <span className="min-w-0">
              <span
                className={`block truncate text-[13px] font-semibold ${r.done ? 'text-zinc-400' : 'text-zinc-200'}`}
              >
                {r.title}
              </span>
              <span className="block text-[11px] text-zinc-500">{r.ch}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 rounded-lg border border-indigo-400/20 bg-indigo-500/[0.08] px-3.5 py-3 flex gap-2.5 items-start">
        <span className="text-[10px] font-bold tracking-wider text-indigo-300 border border-indigo-400/40 rounded px-1.5 py-0.5 flex-none">
          {t('beta.mock.aiBadge')}
        </span>
        <p className="text-[12px] leading-relaxed text-zinc-400">{t('beta.mock.aiSummary')}</p>
      </div>
    </div>
  );
}

function AlgorithmFeedMockup() {
  const { t } = useTranslation();
  const vids = [
    { title: t('beta.s1.f1'), time: '2:24:11' },
    { title: t('beta.s1.f2'), time: '11:47' },
    { title: t('beta.s1.f3'), time: '19:22' },
    { title: t('beta.s1.f4'), time: '2:58:03' },
    { title: t('beta.s1.f5'), time: '9:56' },
    { title: t('beta.s1.f6'), time: '6:31' },
  ];
  return (
    <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span className="flex gap-1.5">
          <i className="w-2 h-2 rounded-full bg-zinc-600 inline-block" />
          <i className="w-2 h-2 rounded-full bg-zinc-600 inline-block" />
          <i className="w-2 h-2 rounded-full bg-zinc-600 inline-block" />
        </span>
        <span className="ml-2">{t('beta.s1.feedTitle')}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
        {vids.map((v, i) => (
          <div key={v.title}>
            {/* Abstract "junk feed" cards — deliberately anonymous noise you scroll
                past, not real videos (a recognizable clip would clash with the
                fictional clickbait title). */}
            <div
              className={`relative aspect-video rounded-lg overflow-hidden bg-gradient-to-br ${
                [
                  'from-slate-700 to-slate-900',
                  'from-zinc-700 to-neutral-900',
                  'from-stone-700 to-zinc-900',
                  'from-neutral-700 to-slate-900',
                  'from-zinc-600 to-stone-900',
                  'from-slate-800 to-neutral-900',
                ][i]
              }`}
            >
              <span
                className="absolute inset-0 opacity-[0.12] [background-image:repeating-linear-gradient(45deg,#fff_0,#fff_1px,transparent_1px,transparent_9px)]"
                aria-hidden
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="w-8 h-8 rounded-full bg-black/30 border border-white/15 flex items-center justify-center">
                  <span className="ml-0.5 border-y-[6px] border-y-transparent border-l-[10px] border-l-white/50" />
                </span>
              </span>
              <span className="absolute bottom-1 right-1.5 text-[10px] text-zinc-200 bg-black/60 rounded px-1">
                {v.time}
              </span>
            </div>
            <div className="mt-1.5 text-[12px] font-semibold text-zinc-300 truncate">{v.title}</div>
            <div className="text-[11px] text-zinc-600">{t('beta.s1.channel')}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KnowledgeGraph() {
  const nodes = [
    { x: 300, y: 120, r: 26, hot: true },
    { x: 120, y: 60, r: 14 },
    { x: 470, y: 40, r: 15 },
    { x: 520, y: 150, r: 12 },
    { x: 90, y: 200, r: 13 },
    { x: 430, y: 230, r: 14 },
    { x: 300, y: 260, r: 10 },
  ];
  const edges: Array<[number, number]> = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [0, 5],
    [0, 6],
    [1, 4],
    [2, 3],
    [5, 6],
  ];
  return (
    <svg viewBox="0 0 600 300" className="w-full max-w-2xl">
      {edges.map(([a, b]) => (
        <line
          key={`${a}-${b}`}
          x1={nodes[a].x}
          y1={nodes[a].y}
          x2={nodes[b].x}
          y2={nodes[b].y}
          stroke="rgba(139,131,251,0.35)"
          strokeWidth="1.2"
        />
      ))}
      {nodes.map((n, i) => (
        <g key={i}>
          <circle cx={n.x} cy={n.y} r={n.r + 8} fill="rgba(139,131,251,0.10)" />
          <circle
            cx={n.x}
            cy={n.y}
            r={n.r}
            fill={n.hot ? 'rgba(139,131,251,0.85)' : 'rgba(148,163,184,0.5)'}
          />
        </g>
      ))}
    </svg>
  );
}

export default function BetaApplyPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [goal, setGoal] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) {
      setState('error');
      return;
    }
    setState('submitting');
    try {
      await apiClient.applyForBeta(normalized, goal.trim() || undefined);
      setState('done');
    } catch {
      setState('error');
    }
  };

  const scrollToApply = () =>
    document.getElementById('apply')?.scrollIntoView({ behavior: 'smooth' });

  const steps = [
    { no: '01', title: t('beta.s2.step1t'), desc: t('beta.s2.step1d') },
    { no: '02', title: t('beta.s2.step2t'), desc: t('beta.s2.step2d') },
    { no: '03', title: t('beta.s2.step3t'), desc: t('beta.s2.step3d') },
  ];
  const perks = [
    { title: t('beta.s5.p1t'), desc: t('beta.s5.p1d') },
    { title: t('beta.s5.p2t'), desc: t('beta.s5.p2d') },
    { title: t('beta.s5.p3t'), desc: t('beta.s5.p3d') },
  ];

  return (
    <div className="relative min-h-screen bg-[#0b0b14] text-zinc-100 overflow-x-clip">
      {/* design-mockup background: indigo glows + fine starfield + faint grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:radial-gradient(ellipse_55%_38%_at_72%_6%,rgba(108,99,255,0.22),transparent_65%),radial-gradient(ellipse_45%_30%_at_12%_38%,rgba(108,99,255,0.10),transparent_60%),radial-gradient(ellipse_50%_32%_at_82%_72%,rgba(108,99,255,0.12),transparent_60%),radial-gradient(ellipse_45%_30%_at_28%_96%,rgba(108,99,255,0.14),transparent_60%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70 [background-image:radial-gradient(rgba(255,255,255,0.10)_1px,transparent_1.3px),radial-gradient(rgba(255,255,255,0.05)_1px,transparent_1.2px)] [background-size:190px_170px,97px_83px] [background-position:0_0,40px_60px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:88px_88px]"
      />
      <div className="relative">
        {/* header */}
        <header className="max-w-6xl mx-auto px-6 pt-8 flex items-center justify-between">
          <Link
            to="/"
            aria-label={t('beta.logoHome')}
            className="flex items-center gap-2.5 font-extrabold text-lg hover:opacity-80 transition-opacity"
          >
            <span className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-400/50 flex items-center justify-center">
              <i className="w-3 h-3 rounded-full border-2 border-indigo-300 inline-block" />
            </span>
            Insighta
          </Link>
          <span className="text-[11px] tracking-[0.25em] text-indigo-300/90 border border-indigo-400/40 bg-indigo-500/10 rounded-full px-4 py-1.5 font-bold">
            CLOSED BETA
          </span>
        </header>

        {/* hero */}
        <section className="max-w-6xl mx-auto px-6 pt-16 pb-24 grid lg:grid-cols-2 gap-14 items-center">
          <div className="min-w-0">
            <h1 className="text-4xl sm:text-6xl font-extrabold leading-[1.15] tracking-tight break-keep">
              {t('beta.hero.line1')}
              <br />
              {t('beta.hero.line2pre')}
              <span className="text-indigo-300 underline decoration-indigo-400/60 decoration-4 underline-offset-8">
                {t('beta.hero.line2hl')}
              </span>
              {t('beta.hero.line2post')}
            </h1>
            <p className="mt-8 text-base sm:text-lg leading-relaxed text-zinc-400 whitespace-pre-line break-keep">
              {t('beta.hero.desc')}
            </p>
            <div className="mt-9 flex flex-col sm:flex-row sm:items-center items-start gap-4 sm:gap-5">
              <button
                type="button"
                onClick={scrollToApply}
                className="w-full sm:w-auto rounded-xl bg-indigo-500 hover:bg-indigo-400 transition-colors px-7 py-4 text-[15px] font-bold text-white shadow-[0_0_40px_rgba(108,99,255,0.35)] whitespace-nowrap"
              >
                {t('beta.hero.cta')} →
              </button>
              <span className="text-sm text-zinc-500">{t('beta.hero.ctaNote')}</span>
            </div>
            <div className="mt-10 pt-8 border-t border-white/10">
              <BetaCountdown />
            </div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <CurriculumMockup />
          </div>
        </section>

        {/* 01 problem */}
        <section className="max-w-6xl mx-auto px-6 py-24 text-center">
          <SectionLabel no="01" label={t('beta.s1.label')} />
          <h2 className="mt-6 text-4xl sm:text-5xl font-extrabold leading-snug whitespace-pre-line">
            {t('beta.s1.title')}
          </h2>
          <p className="mt-6 text-zinc-400 max-w-2xl mx-auto leading-relaxed whitespace-pre-line">
            {t('beta.s1.desc')}
          </p>
          <div className="mt-12 flex justify-center">
            <AlgorithmFeedMockup />
          </div>
          <p className="mt-6 text-sm text-zinc-500">{t('beta.s1.caption')}</p>
        </section>

        {/* 02 solution */}
        <section className="max-w-6xl mx-auto px-6 py-24 text-center">
          <SectionLabel no="02" label={t('beta.s2.label')} />
          <h2 className="mt-6 text-4xl sm:text-5xl font-extrabold">{t('beta.s2.title')}</h2>
          <p className="mt-5 text-zinc-400">{t('beta.s2.desc')}</p>
          <div className="mt-12 grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left">
              <div className="text-[11px] tracking-widest text-zinc-500 font-bold">
                BEFORE — {t('beta.s2.before')}
              </div>
              <div className="mt-4 relative h-40">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="absolute w-28 h-[4.2rem] rounded-md bg-gradient-to-br from-zinc-600 to-zinc-800 border border-white/10"
                    style={{
                      left: `${12 + i * 18}%`,
                      top: `${8 + (i % 2) * 34}%`,
                      transform: `rotate(${i * 7 - 10}deg)`,
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-indigo-400/30 bg-indigo-500/[0.06] p-5 text-left">
              <div className="text-[11px] tracking-widest text-indigo-300 font-bold">
                AFTER — {t('beta.s2.after')}
              </div>
              <ul className="mt-4 space-y-2.5">
                {[t('beta.mock.v1'), t('beta.mock.v2'), t('beta.mock.v3'), t('beta.mock.v4')].map(
                  (v, i) => (
                    <li key={v} className="flex items-center gap-2.5">
                      <span
                        className={`w-4 h-4 rounded-full border flex-none ${i < 2 ? 'bg-indigo-500 border-indigo-400' : 'border-zinc-600'}`}
                      />
                      <span className="relative w-10 h-6 rounded bg-zinc-800 flex-none overflow-hidden">
                        <img
                          src={yt(CURRICULUM_THUMBS[i])}
                          alt=""
                          loading="lazy"
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      </span>
                      <span className="text-[12px] text-zinc-300 truncate">{v}</span>
                    </li>
                  )
                )}
              </ul>
            </div>
          </div>
          <div className="mt-8 grid sm:grid-cols-3 gap-5 max-w-4xl mx-auto">
            {steps.map((s) => (
              <div
                key={s.no}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left"
              >
                <div className="text-[11px] tracking-widest text-indigo-300 font-bold">{s.no}</div>
                <div className="mt-2 font-bold text-zinc-100">{s.title}</div>
                <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 03 knowledge graph */}
        <section className="max-w-6xl mx-auto px-6 py-24 text-center">
          <SectionLabel no="03" label={t('beta.s3.label')} />
          <h2 className="mt-6 text-4xl sm:text-5xl font-extrabold">{t('beta.s3.title')}</h2>
          <p className="mt-6 text-zinc-400 max-w-2xl mx-auto leading-relaxed whitespace-pre-line">
            {t('beta.s3.desc')}
          </p>
          <div className="mt-10 max-w-2xl mx-auto">
            <div className="flex items-center justify-between text-xs text-zinc-500 px-2">
              <span>{t('beta.s3.graphLabel')}</span>
              <span className="flex items-center gap-2">
                {t('beta.s3.accuracy')}
                <i className="w-10 h-px bg-indigo-400 inline-block" />
                <b className="text-indigo-300">96%</b>
              </span>
            </div>
            <div className="mt-3 flex justify-center">
              <KnowledgeGraph />
            </div>
            <p className="mt-4 text-sm text-zinc-500">{t('beta.s3.caption')}</p>
          </div>
        </section>

        {/* 04 note density */}
        <section className="max-w-6xl mx-auto px-6 py-24 text-center">
          <SectionLabel no="04" label={t('beta.s4.label')} />
          <h2 className="mt-6 text-4xl sm:text-5xl font-extrabold leading-snug whitespace-pre-line">
            {t('beta.s4.title')}
          </h2>
          <div className="mt-12 grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto text-left">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex items-center justify-between">
                <span className="font-bold">Free</span>
                <span className="text-[11px] text-zinc-500 border border-white/10 rounded-full px-2.5 py-0.5">
                  {t('beta.s4.freeTag')}
                </span>
              </div>
              <div className="mt-5 space-y-2.5">
                {[80, 62, 71, 55].map((w, i) => (
                  <div
                    key={i}
                    className="h-2.5 rounded bg-zinc-700/70"
                    style={{ width: `${w}%` }}
                  />
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-indigo-400/40 bg-indigo-500/[0.07] p-6">
              <div className="flex items-center justify-between">
                <span className="font-bold">Pro</span>
                <span className="text-[11px] text-indigo-200 bg-indigo-500/30 rounded-full px-2.5 py-0.5">
                  {t('beta.s4.proTag')}
                </span>
              </div>
              <div className="mt-5 space-y-2.5">
                <div className="h-2.5 rounded bg-indigo-400/80 w-[85%]" />
                <div className="h-2.5 rounded bg-indigo-400/50 w-[70%]" />
                <div className="rounded border border-indigo-300/30 bg-black/30 px-3 py-2 text-[12px] font-mono text-indigo-200">
                  A v = λ v
                </div>
                <div className="h-2.5 rounded bg-indigo-400/50 w-[64%]" />
                <div className="h-2.5 rounded bg-indigo-400/30 w-[52%]" />
              </div>
            </div>
          </div>
        </section>

        {/* 05 founding member */}
        <section className="max-w-6xl mx-auto px-6 py-24">
          <SectionLabel no="05" label={t('beta.s5.label')} />
          <h2 className="mt-6 text-4xl sm:text-5xl font-extrabold text-center">
            {t('beta.s5.title')}
          </h2>
          <div className="mt-14 grid lg:grid-cols-2 gap-12 items-center max-w-4xl mx-auto">
            <div className="rounded-2xl border border-indigo-300/25 bg-gradient-to-br from-indigo-500/[0.14] to-white/[0.03] p-7 aspect-[8/5] flex flex-col justify-between shadow-[0_24px_80px_rgba(108,99,255,0.15)]">
              <div className="flex items-center justify-between text-[11px] tracking-[0.2em] text-zinc-400">
                <span className="flex items-center gap-2 font-bold text-zinc-200">
                  <i className="w-4 h-4 rounded border border-indigo-300/60 inline-block" />{' '}
                  Insighta
                </span>
                <span>FOUNDING MEMBER</span>
              </div>
              <div>
                <div className="text-4xl font-extrabold text-zinc-50">Lifetime</div>
                <div className="mt-1 text-xs text-zinc-500">{t('beta.s5.cardSub')}</div>
              </div>
              <div className="flex items-center justify-between text-[11px] tracking-widest text-zinc-500">
                <span>No. 0041</span>
                <span>2026 · VOL.01</span>
              </div>
            </div>
            <div>
              <ul className="space-y-6">
                {perks.map((p) => (
                  <li key={p.title} className="flex gap-4">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-indigo-500/20 border border-indigo-400/50 flex items-center justify-center flex-none">
                      <svg viewBox="0 0 12 12" className="w-2.5 h-2.5">
                        <path
                          d="M2.5 6.5l2.2 2.2L9.5 3.6"
                          fill="none"
                          stroke="#a5b4fc"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                    <span>
                      <span className="block font-bold text-zinc-100">{p.title}</span>
                      <span className="block mt-1 text-sm text-zinc-500 leading-relaxed">
                        {p.desc}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span>{t('beta.s5.inviteLabel')}</span>
                  <span className="font-bold text-zinc-300">
                    {INVITE_SENT} / {INVITE_TOTAL}
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-indigo-400"
                    style={{ width: `${(INVITE_SENT / INVITE_TOTAL) * 100}%` }}
                  />
                </div>
                <p className="mt-3 text-[13px] text-zinc-500">
                  {t('beta.s5.seatsNote', { seats: SEATS_LEFT })}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 06 apply */}
        <section id="apply" className="max-w-6xl mx-auto px-6 py-24 text-center">
          <SectionLabel no="06" label={t('beta.s6.label')} />
          <h2 className="mt-6 text-4xl sm:text-5xl font-extrabold leading-snug whitespace-pre-line">
            {t('beta.s6.title')}
          </h2>
          <p className="mt-5 text-zinc-400">{t('beta.s6.desc')}</p>

          {state === 'done' ? (
            <div
              role="status"
              className="mt-12 max-w-xl mx-auto rounded-2xl border border-indigo-400/30 bg-indigo-500/[0.07] px-8 py-10"
            >
              <p className="text-xl font-bold">{t('beta.doneTitle')}</p>
              <p className="mt-3 text-sm text-zinc-400">{t('beta.doneDesc')}</p>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-12 max-w-xl mx-auto text-left">
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder={t('beta.s6.goalPlaceholder')}
                aria-label={t('beta.s6.goalPlaceholder')}
                className="w-full rounded-xl border border-white/15 bg-white/[0.04] px-5 py-4 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-indigo-400/60 resize-none"
              />
              <div className="mt-3 flex flex-col sm:flex-row gap-3">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (state === 'error') setState('idle');
                  }}
                  placeholder={t('beta.emailPlaceholder')}
                  aria-label={t('beta.emailPlaceholder')}
                  className="flex-1 rounded-xl border border-white/15 bg-white/[0.04] px-5 py-4 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-indigo-400/60"
                />
                <button
                  type="submit"
                  disabled={state === 'submitting'}
                  className="rounded-xl bg-indigo-500 hover:bg-indigo-400 transition-colors px-8 py-4 text-[15px] font-bold text-white disabled:opacity-50"
                >
                  {state === 'submitting' ? t('beta.submitting') : t('beta.s6.submit')}
                </button>
              </div>
              {state === 'error' && (
                <p role="alert" className="mt-3 text-sm text-red-400">
                  {t('beta.error')}
                </p>
              )}
              <p className="mt-4 text-center text-xs text-zinc-600">{t('beta.s6.privacy')}</p>
            </form>
          )}
        </section>

        {/* footer */}
        <footer className="border-t border-white/10">
          <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-600">
            <span className="flex items-center gap-2 font-bold text-zinc-400">
              <i className="w-3.5 h-3.5 rounded border border-zinc-500 inline-block" /> Insighta
            </span>
            <span className="flex gap-5">
              <a href="/privacy" className="hover:text-zinc-400">
                Privacy
              </a>
              <a href="/terms" className="hover:text-zinc-400">
                Terms
              </a>
            </span>
            <span>© 2026 Insighta</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
