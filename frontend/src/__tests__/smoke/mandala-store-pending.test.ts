import { describe, it, expect, beforeEach } from 'vitest';
import { useMandalaStore, type PendingMandalaInputs } from '@/stores/mandalaStore';

/**
 * Smoke tests for the `pendingMandala` slice added in CP389 as part of the
 * wizard optimistic-UI fix (Task #3 / Issue #413).
 *
 * The slice is the contract boundary between `fireCreateMandala` (wizard
 * submission) and `IndexPage` (optimistic dashboard render). Every branch
 * of that flow reads from or writes to this slice, so these assertions
 * guard against silent shape regressions.
 */

const SAMPLE_INPUTS: PendingMandalaInputs = {
  title: '취준비전략',
  centerGoal: '취업 목표를 세우고 준비하기',
  subjects: [
    '자기 분석 및 커리어 방향 설정',
    '직무 및 산업 시장 조사',
    '이력서 및 자기소개서 작성',
    '면접 준비 및 예상 질문 대응',
    '기술 및 역량 개발',
    '네트워킹 및 정보 수집',
    '채용 공고 탐색 및 지원 전략',
    '합격 후 입사 준비',
  ],
  subLabels: [
    '자기분석및방향설정',
    '시장조사분석',
    '서류작성',
    '면접대비',
    '역량개발',
    '네트워킹',
    '채용공고지원',
    '입사준비',
  ],
};

describe('mandalaStore — pendingMandala slice', () => {
  beforeEach(() => {
    useMandalaStore.getState().reset();
  });

  it('initialises with pendingMandala null', () => {
    expect(useMandalaStore.getState().pendingMandala).toBeNull();
  });

  it('setPendingMandala persists the full input shape', () => {
    const tempId = 'temp-uuid-1';
    const startedAt = Date.now();
    useMandalaStore.getState().setPendingMandala({
      tempId,
      startedAt,
      originalInputs: SAMPLE_INPUTS,
    });
    const s = useMandalaStore.getState();
    expect(s.pendingMandala?.tempId).toBe(tempId);
    expect(s.pendingMandala?.startedAt).toBe(startedAt);
    expect(s.pendingMandala?.originalInputs).toEqual(SAMPLE_INPUTS);
  });

  it('clearPendingMandala resets the slice to null', () => {
    useMandalaStore.getState().setPendingMandala({
      tempId: 'temp-2',
      startedAt: 1,
      originalInputs: SAMPLE_INPUTS,
    });
    useMandalaStore.getState().clearPendingMandala();
    expect(useMandalaStore.getState().pendingMandala).toBeNull();
  });

  it('reset() clears pendingMandala along with the rest of the store', () => {
    useMandalaStore.setState({
      selectedMandalaId: 'a',
      justCreatedMandalaId: 'b',
      pendingMandala: {
        tempId: 'temp-3',
        startedAt: 1,
        originalInputs: SAMPLE_INPUTS,
      },
    });
    useMandalaStore.getState().reset();
    const s = useMandalaStore.getState();
    expect(s.selectedMandalaId).toBeNull();
    expect(s.justCreatedMandalaId).toBeNull();
    expect(s.pendingMandala).toBeNull();
  });

  it('preserves originalInputs under partial optional fields', () => {
    const minimal: PendingMandalaInputs = {
      title: 'minimal',
      centerGoal: 'minimal',
      subjects: Array(8).fill(''),
    };
    useMandalaStore.getState().setPendingMandala({
      tempId: 'temp-min',
      startedAt: 0,
      originalInputs: minimal,
    });
    const stored = useMandalaStore.getState().pendingMandala?.originalInputs;
    expect(stored?.subDetails).toBeUndefined();
    expect(stored?.subLabels).toBeUndefined();
    expect(stored?.skills).toBeUndefined();
    expect(stored?.focusTags).toBeUndefined();
    expect(stored?.targetLevel).toBeUndefined();
  });
});
