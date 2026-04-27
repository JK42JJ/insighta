# Issue #543 — Baseline Measurement (post-PR-X1, pre-PR-X2)

> Date: 2026-04-28
> Source: prod Supabase Cloud DB (`mandala_embeddings`, 1306 KO+EN templates)
> Related: PR #544 (search accuracy), PR #545 (batch upsert + fetch limit)

## §1 Step 1-E summary — root cause confirmation

For "수학 올림피아드 …" template (mandala_id `0246ab77-…`) used as the query proxy:

| Bucket | Row count |
|--------|-----------|
| sim ≥ 0.70 | 1 |
| 0.40 ≤ sim < 0.50 | 15 |
| **0.25 ≤ sim < 0.40** | **843** |
| 0.10 ≤ sim < 0.25 | 447 |

**Decisive finding**: the old `HARD_FLOOR=0.25` allowed 859 of 1306 templates (66%) to surface for a "수학" query — most of them in the long-tail 0.25–0.40 band where similarity is barely above random. PR #544's `0.4` floor reduces this to 16 templates, all of them in the genuinely-related top-15 band.

## §2 Top-1 proxy measurement — 13-domain ground truth

Method: for each of 13 ground-truth domains (`ground-truth-13.json`), use the expected mandala's stored embedding as a query proxy (avoids LLM API call per CLAUDE.md Hard Rule). Search `mandala_embeddings` for top-1 nearest neighbour excluding self.

| Domain | Query | Top-1 sim | Top-1 result excerpt | Same domain? |
|--------|-------|-----------|----------------------|--------------|
| 수학 | 수학 | 0.587 | 사내 교육 플랫폼 기획… 온보딩 시간 50% 단축 | ✗ (학습 플랫폼만 공통) |
| 음악 | 피아노 | 0.645 | Learn classical piano to Grade 5 level… | ✓ |
| 운동 | 근력 운동 | 0.753 | Achieve a 300 kg Powerlifting Total… | ✓ |
| 프로그래밍 | Rust | 0.772 | Build a cross-platform CLI tool in Rust… | ✓ |
| 요리 | 요리 | 0.713 | 과학 실험 유튜브 채널… 100편 영상 1만명 | ✗ (유튜브 1만명 공통) |
| 영어 | 영어 회화 | 0.631 | 평생 학습 플랫폼… 은퇴자 강좌 | ✗ |
| 창업 | 스타트업 | 0.694 | 리걸테크 스타트업 공동창업… AI 계약서 분석 | ✓ |
| 투자 | 부동산 투자 | 0.856 | 부동산 경매 투자… 수익률 20% | ✓ |
| 글쓰기 | 소설 글쓰기 | 0.663 | 첫 단편 소설집 10편 완성… 문학상 공모 | ✓ |
| 디자인 | 디자인 | 0.692 | 아침 의식(Morning Ritual) 90일 체화… | ✗ (루틴 공통) |
| 멘토링 | 청소년 멘토링 | 0.724 | 다문화 가정 멘토링… 멘티 50명 | ✓ |
| 일본어 | 일본어 | 0.754 | 일본어 JLPT N2 합격… 일본 IT 기업 면접 | ✓ |
| 건강 | 건강 | 0.668 | React Native로 헬스케어 앱… 평점 4.5 | ✓ |

**Top-1 same-domain hit rate: 9/13 = 69.2%.**

### §2.1 Failure analysis

The 4 misses share a structural pattern: the proxy query embedding (full long-form center_goal) overlaps with non-target templates on **secondary attributes** (학습 플랫폼, 유튜브 1만명, 평생 학습, 아침 루틴) rather than the **primary topic** (수학, 요리, 영어, 디자인).

This is a **known limitation of the proxy method**, not necessarily a model defect — a real user typing the short query `수학` will produce a different (likely shorter) embedding than a 60-character compound goal that happens to mention 수학. Real-world top-1 hit rate may be higher OR lower than 69.2%; only prod manual smoke can resolve.

## §3 Implications for PR X2 / X3

- **PR X2 hypothesis**: top-3 hit rate likely ≥ 80% even with current model. Validate with prod manual smoke (post-PR-X1 deploy). If confirmed, no model swap needed; declare PR X2 a no-op success.
- **PR X2 fallback**: if prod top-3 < 80%, two options:
  1. Hybrid FTS pre-boost (cheap: add `to_tsvector` index + score fusion)
  2. BGE-M3 embedding swap (expensive: re-embed 1306 templates + dim-mismatch handling)
- **PR X3 unaffected**: Redis search-result cache layered on top, model-agnostic.

## §4 Verification request (user manual smoke)

After PR #544 + #545 deploy, please run the wizard with each of these queries and report which template appears in slots 1–5:

```
수학    피아노    근력 운동    Rust       요리
영어 회화  스타트업  부동산 투자  소설 글쓰기  디자인
청소년 멘토링  일본어   건강
```

Report format:
```
수학 → [template_1 title], [template_2 title], … (or "empty")
…
```

This produces real-world top-K accuracy. If ≥ 80% match the `expected_center_goal` in `ground-truth-13.json` (or a contextually-equivalent template), PR X2 model swap is unnecessary.
