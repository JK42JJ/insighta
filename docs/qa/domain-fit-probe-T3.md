# Domain-fit local classifier — T3 prompt (frozen)

Status: R11 candidate → R12 re-validation at N≥100.
Compliance: local inference ONLY — Mac Mini Ollama via Tailscale
(`http://100.91.173.17:11434/api/generate`, model `mandala-gen:latest`,
`raw:true`). No Anthropic / OpenRouter / YouTube API calls anywhere in this
probe or its data generation.

## Why this file exists

R10's probe artifacts were lost (scratchpad-only, no repo copy). R11 found
that among 3 candidate prompt templates (T1/T2/T3), only **T3** avoided
"niche massacre" (false-not-fit on legit niche-domain pairs) while still
catching drift — but on a small sample (N=14 for the `niche_legit` cluster).
This file freezes the exact T3 prompt + Ollama call config so it can be
reproduced without re-deriving it, and is the baseline R12 re-validates
against at N≥100.

**T1 and T2 are retired** (niche-massacre 22–40% false-not-fit-on-legit in
R11) — not reproduced here. Ensembling across templates was also retired
(systematic bias, not random noise — averaging doesn't help). T3 alone,
frozen, is the only surviving candidate.

## T3 prompt (verbatim, do not alter for the "fixed" re-validation)

Template function (`goal`, `title` → prompt string):

```js
const T3 = (goal, title) =>
  `### Instruction:\n다음 영상 제목과 목표의 주제 적합성을 분류하라 (적합/비적합). JSON만 출력: {"fit": "적합"|"비적합"}\n\n### Input:\n영상 제목: ${title}\n관련 목표: ${goal}\n\n### Output:\n`;
```

Key property vs T1/T2: video title is presented **before** the goal
(title-first, goal-second), Alpaca instruction format. T1/T2 put goal first
— that ordering is believed (not proven) to correlate with the niche-massacre
failure mode; not re-tested in R12 (out of scope, T3 is fixed).

### R12 scalar-capture variant (separate, additive — see R12-2)

Used only in the scalar-capture pass, never substituted for the frozen T3
binary call above:

```js
const T3_SCALAR = (goal, title) =>
  `### Instruction:\n다음 영상 제목과 목표의 주제 적합성을 분류하라 (적합/비적합). 그리고 0.0~1.0 사이의 적합도 confidence 점수도 함께 산정하라 (1.0=완전히 같은 주제, 0.0=전혀 무관). JSON만 출력: {"fit": "적합"|"비적합", "score": 0.0~1.0}\n\n### Input:\n영상 제목: ${title}\n관련 목표: ${goal}\n\n### Output:\n`;
```

## Ollama call config (frozen)

```json
{
  "model": "mandala-gen:latest",
  "raw": true,
  "stream": false,
  "options": { "temperature": 0.1, "num_predict": 60 }
}
```

- Endpoint: `POST http://100.91.173.17:11434/api/generate` (Tailscale IP of
  Mac Mini; do not use any hosted/cloud inference substitute).
- `raw: true` — no chat template wrapping; the Alpaca-format string above is
  sent as literal raw prompt.
- Parse strategy: regex-extract first `{...}` blob, `JSON.parse`, accept
  `fit` iff exactly `"적합"` or `"비적합"`. Fallback substring scan is
  fragile-flagged (`parse_clean: false`) — see `parseFit()` in the runner.

## Ground truth / cluster taxonomy

- `auto_legit` / `auto_drift` — AI-automation/no-code domain goal × video,
  fit / mismatch.
- `homonym_fit` / `homonym_drift` — Korean `코드` token trap: means
  "programming code" in dev-domain pairs (fit) vs guitar/piano "chord" in
  music-domain pairs (drift, title contains `코드` but is actually a coding
  video — tests the classifier isn't fooled by surface token overlap).
- `niche_legit` — vocabulary-non-overlapping but domain-true fit (e.g.
  classical guitar goal × "핑거스타일/스케일/주법" video with zero literal
  token overlap with the goal string). **This is the cluster that most
  needs N-expansion** — R11 had only 14 rows here.
- `niche_drift` (R12 addition, not in R11) — cross-niche mismatches (e.g.
  AWS-architect goal × dividend-ETF video) to add drift-detection signal
  specifically among niche/specialist domains, not just generic sanity_off.
- `sanity_on` / `sanity_off` — obviously-fit / obviously-off-topic control
  pairs (regression floor, should be ~100%).
- `ambiguous_excluded` — genuinely unclear domain calls (label:null),
  excluded from all scoring, kept for transparency.

## File locations (persisted, working-tree only — not committed per task scope)

- This spec: `docs/qa/domain-fit-probe-T3.md`
- Runner: `scripts/probes/domain-fit-t3-runner.mjs`
- R11 fixtures (frozen reference, for regression diff): `scripts/probes/fixtures/r11-dataset.json`, `scripts/probes/fixtures/r11-results.json`
- R12 dataset (N≥100): `scripts/probes/fixtures/r12-dataset.json`
- R12 results (binary + scalar): `scripts/probes/fixtures/r12-results-binary.json`, `scripts/probes/fixtures/r12-results-scalar.json`

## Metric definitions (as established in R11, reused for R12)

- **False-not-fit-on-legit rate** = (legit rows misclassified as `비적합`) /
  (total rows with gold=`적합`). This is the primary GO/NO-GO bar, target
  **<10%**. R11 measured 1/30 = 3.3% overall, 0/14 = 0% within `niche_legit`
  specifically.
- **Drift detection rate** = (drift rows correctly classified as `비적합`) /
  (total rows with gold=`비적합`). R11 measured 21/22 = 95.5%.
- Rows with `gold: null` (ambiguous) are excluded from both metrics.
