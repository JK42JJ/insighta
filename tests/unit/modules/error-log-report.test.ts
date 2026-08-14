/**
 * error-log-check report builder (incident-response daily digest, 2026-07-09).
 * buildErrorReportHtml is PURE (no DB / no mailer). Locks: clean-state banner,
 * spike detection vs prior, no-prior baseline surfacing, discover-trace null
 * rendering (flag OFF ≠ 0), grand-total in subject.
 */

jest.mock('@/modules/skills/mailer', () => ({ transporter: { sendMail: jest.fn() } }));
jest.mock('@/config/index', () => ({
  config: {
    paths: { logs: '/tmp' },
    app: { isTest: true },
    discoverTracing: { enabled: false },
    observability: { alertEmail: '' },
    gmail: { smtpFrom: 'noreply@insighta.one', smtpHost: 'localhost', smtpPort: 587 },
  },
}));

import {
  buildErrorReportHtml,
  type ErrorSummary,
} from '../../../src/modules/queue/handlers/error-log-check';

const base = (over: Partial<ErrorSummary> = {}): ErrorSummary => ({
  llmErrors: 0,
  llmBy: [],
  jobsFailed: 0,
  jobsBy: [],
  mandalaCreateErrors: 0,
  pipelineFailed: 0,
  wizardFailed: 0,
  skillErrors: 0,
  syncErrors: 0,
  discoverTraceErrors: null,
  eventsTotal: 0,
  eventsBy: [],
  grandTotal: 0,
  ...over,
});

describe('buildErrorReportHtml', () => {
  it('clean state (0 errors) → "이상 없음" banner + subject, no spikes', () => {
    const r = buildErrorReportHtml('2026-07-08', base(), base());
    expect(r.spikes).toEqual([]);
    expect(r.subject).toContain('이상 없음');
    expect(r.html).toContain('✓ 어제 에러 0건');
  });

  it('flags a spike when a source grows ≥50% over prior (past the floor)', () => {
    const today = base({ llmErrors: 20, grandTotal: 20 });
    const prior = base({ llmErrors: 5, grandTotal: 5 });
    const r = buildErrorReportHtml('2026-07-08', today, prior);
    expect(r.spikes.some((s) => s.includes('LLM 호출 실패'))).toBe(true);
    expect(r.subject).toContain('스파이크');
    expect(r.html).toContain('🔺');
  });

  it('does NOT flag sub-floor noise (1→2 stays quiet)', () => {
    const r = buildErrorReportHtml('2026-07-08', base({ llmErrors: 2, grandTotal: 2 }), base());
    expect(r.spikes).toEqual([]);
  });

  it('surfaces a non-trivial count when there is no prior baseline', () => {
    const r = buildErrorReportHtml(
      '2026-07-08',
      base({
        eventsTotal: 9,
        grandTotal: 9,
        eventsBy: [{ key: 'book_fill · skeleton_hardfail', count: 9 }],
      }),
      null
    );
    expect(r.spikes.some((s) => s.includes('기준 없음'))).toBe(true);
    expect(r.html).toContain('book_fill · skeleton_hardfail = 9');
  });

  it('renders discover-trace NULL as "미측정" (flag OFF ≠ 0)', () => {
    const off = buildErrorReportHtml('2026-07-08', base({ discoverTraceErrors: null }), base());
    expect(off.html).toContain('미측정 (discover trace flag OFF)');
    const on = buildErrorReportHtml(
      '2026-07-08',
      base({ discoverTraceErrors: 3, grandTotal: 3 }),
      base()
    );
    expect(on.html).not.toContain('미측정 (discover trace flag OFF)');
  });

  it('puts the grand total in a non-clean subject', () => {
    const r = buildErrorReportHtml(
      '2026-07-08',
      base({ jobsFailed: 3, grandTotal: 3, jobsBy: [{ key: 'mandala-book-fill', count: 3 }] }),
      base()
    );
    expect(r.subject).toContain('3건');
    expect(r.html).toContain('mandala-book-fill = 3');
  });
});
