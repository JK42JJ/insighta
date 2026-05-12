/**
 * Wizard Step-1 Typeahead — Smoke Test
 *
 * Verifies the dropdown UX contract on `WizardSearchBar`:
 *   - Query length < 2 → no fetch, no dropdown
 *   - Debounce 250ms before fetch
 *   - Click row → onChange(center_goal), NO onSubmit (auto-submit forbidden)
 *   - Esc → dropdown hides
 *   - enableTypeahead=false → no fetch even on long query
 *
 * Pure component test — apiClient is mocked so we don't actually hit BE.
 *
 * Note: uses real timers + a small `wait()` helper. Fake timers don't play
 * nice with `@testing-library/react`'s `waitFor` (which polls on real
 * timers internally) and the dropdown render flow involves both a
 * setTimeout (debounce) AND a microtask (await response), making fake
 * timers awkward to interleave.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string) => fallback ?? _k,
    i18n: { language: 'en' },
  }),
}));

const searchTemplatesTypeaheadMock = vi.fn();
vi.mock('@/shared/lib/api-client', () => ({
  apiClient: {
    get searchTemplatesTypeahead() {
      return searchTemplatesTypeaheadMock;
    },
  },
}));

import { WizardSearchBar } from '@/features/mandala-wizard/ui/WizardSearchBar';

const FIXTURE_RESULTS = [
  { mandala_id: 'm-1', center_goal: '영어 회화 마스터', domain: 'learning' },
  { mandala_id: 'm-2', center_goal: '영어 토익 900점', domain: 'learning' },
];

// Debounce window plus a small slack so the timer + microtask both flush.
const DEBOUNCE_PLUS_SLACK_MS = 350;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  searchTemplatesTypeaheadMock.mockReset();
  searchTemplatesTypeaheadMock.mockResolvedValue(FIXTURE_RESULTS);
});

afterEach(() => {
  cleanup();
});

interface RenderOpts {
  enableTypeahead?: boolean;
  initialValue?: string;
  onSubmit?: () => void;
  onChange?: (v: string) => void;
}

function renderBar(opts: RenderOpts) {
  const handleSubmit = opts.onSubmit ?? vi.fn();
  const handleChange = opts.onChange ?? vi.fn();
  let captured = opts.initialValue ?? '';

  function Wrapper() {
    const [value, setValue] = useState(opts.initialValue ?? '');
    return (
      <WizardSearchBar
        value={value}
        onChange={(v) => {
          captured = v;
          setValue(v);
          handleChange(v);
        }}
        onSubmit={handleSubmit}
        enableTypeahead={opts.enableTypeahead ?? true}
        ariaLabel="goal-input"
      />
    );
  }

  return {
    ...render(<Wrapper />),
    handleSubmit,
    handleChange,
    getValue: () => captured,
  };
}

describe('WizardSearchBar — typeahead', () => {
  it('does NOT fetch when query length < 2', async () => {
    renderBar({ enableTypeahead: true });
    const input = screen.getByLabelText('goal-input');

    fireEvent.change(input, { target: { value: '영' } });
    await wait(DEBOUNCE_PLUS_SLACK_MS);

    expect(searchTemplatesTypeaheadMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does NOT fetch when enableTypeahead is false (step-3 lockdown)', async () => {
    renderBar({ enableTypeahead: false });
    const input = screen.getByLabelText('goal-input');

    fireEvent.change(input, { target: { value: '영어 회화' } });
    await wait(DEBOUNCE_PLUS_SLACK_MS);

    expect(searchTemplatesTypeaheadMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('debounces fetch (no call before 250ms boundary)', async () => {
    renderBar({ enableTypeahead: true });
    const input = screen.getByLabelText('goal-input');

    fireEvent.change(input, { target: { value: '영어' } });
    // Just under the debounce window — no fetch yet.
    await wait(150);
    expect(searchTemplatesTypeaheadMock).not.toHaveBeenCalled();

    // Cross the boundary.
    await wait(200);
    expect(searchTemplatesTypeaheadMock).toHaveBeenCalledTimes(1);
    expect(searchTemplatesTypeaheadMock).toHaveBeenCalledWith(
      '영어',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('row click fills input value but does NOT auto-submit', async () => {
    const onSubmit = vi.fn();
    const { getValue } = renderBar({
      enableTypeahead: true,
      onSubmit,
    });
    const input = screen.getByLabelText('goal-input');

    fireEvent.change(input, { target: { value: '영어' } });

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeNull(), {
      timeout: 1500,
    });
    const rows = screen.getAllByRole('option');
    expect(rows.length).toBe(FIXTURE_RESULTS.length);

    // mousedown is the actual selection trigger (preserves input focus).
    fireEvent.mouseDown(rows[0]);

    expect(getValue()).toBe('영어 회화 마스터');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Esc key closes the dropdown', async () => {
    renderBar({ enableTypeahead: true });
    const input = screen.getByLabelText('goal-input');

    fireEvent.change(input, { target: { value: '영어' } });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeNull(), {
      timeout: 1500,
    });

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('hides dropdown when result set is empty', async () => {
    searchTemplatesTypeaheadMock.mockResolvedValueOnce([]);
    renderBar({ enableTypeahead: true });
    const input = screen.getByLabelText('goal-input');

    fireEvent.change(input, { target: { value: 'zzzz' } });
    await wait(DEBOUNCE_PLUS_SLACK_MS);

    expect(searchTemplatesTypeaheadMock).toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
