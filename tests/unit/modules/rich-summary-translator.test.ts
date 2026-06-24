/**
 * v2 translations (PR-T1) — sameShape guard validates the v2 atom/section
 * structure. Structure-preserving mock (NO live OpenRouter); sameShape must pass
 * the real-shape payload and reject a shape mismatch.
 */
process.env['ENCRYPTION_SECRET'] ??=
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

import {
  translateRichSummaryPayload,
  sameShape,
  getStoredTranslation,
} from '../../../src/modules/skills/rich-summary-translator';

// Structurally faithful v2 payload (one_liner/core/analysis/segments{atoms,sections}).
const PAYLOAD = {
  one_liner: 'A short English summary.',
  core: { thesis: 'Main point in English', tags: ['cloud', 'docker'] },
  analysis: {
    entities: [{ name: 'Docker', kind: 'tool' }],
    key_concepts: ['containers', 'images'],
    core_argument: 'Containers remove guest-OS overhead.',
  },
  segments: {
    atoms: [
      { timestamp_sec: 12, text: 'Docker uses the host kernel.' },
      { timestamp_sec: 48, text: 'Images are layered.' },
    ],
    sections: [{ title: 'Basics', narrative: 'An English narrative.' }],
  },
};

function translateLeaves(v: any): any {
  if (typeof v === 'string') return v.length ? '[ko] ' + v : v;
  if (Array.isArray(v)) return v.map(translateLeaves);
  if (v && typeof v === 'object') {
    const o: any = {};
    for (const k of Object.keys(v)) o[k] = translateLeaves(v[k]);
    return o;
  }
  return v;
}

describe('rich-summary-translator — sameShape guard', () => {
  const mock = async () => JSON.stringify(translateLeaves(PAYLOAD));

  it('structure-preserving translation → translateRichSummaryPayload non-null + sameShape true', async () => {
    const out = await translateRichSummaryPayload(PAYLOAD as any, 'ko', { generateImpl: mock });
    expect(out).not.toBeNull();
    expect(sameShape(PAYLOAD, out)).toBe(true);
  });

  it('shape mismatch (dropped segments) → sameShape false (guard catches)', () => {
    const broken = JSON.parse(JSON.stringify(translateLeaves(PAYLOAD)));
    delete broken.segments;
    expect(sameShape(PAYLOAD, broken)).toBe(false);
  });

  it('getStoredTranslation reads the lang key + null when absent', () => {
    expect(getStoredTranslation({ ko: { x: 1 } }, 'ko')).toEqual({ x: 1 });
    expect(getStoredTranslation({ ko: { x: 1 } }, 'en')).toBeNull();
    expect(getStoredTranslation(null, 'ko')).toBeNull();
  });
});
