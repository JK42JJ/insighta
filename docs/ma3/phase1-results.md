# MA-3 Phase 1: Personal Learning Pattern Queries — Validation Results

**Issue**: #290
**Date**: 2026-03-20
**DB**: Local (dev) — user_id `0192fedf-85f4-47ab-a652-7fdd116e2b39`
**Data**: 65 resource nodes (3 YouTube), 9 video_summaries, 0 watch_sessions

---

## Summary

| Category | Queries | Pass | Partial | Fail | Pass Rate |
|----------|---------|------|---------|------|-----------|
| Basic Retrieval (1-5) | 5 | 2 | 1 | 2 | 40% |
| Channel & Content (6-10) | 5 | 0 | 1 | 4 | 0% |
| Watch Behavior (11-15) | 5 | 0 | 1 | 4 | 0% |
| Pattern & Insight (16-20) | 5 | 2 | 1 | 2 | 40% |
| **Total** | **20** | **4** | **4** | **12** | **20%** |

---

## Detailed Results

### Basic Retrieval (1-5) — 1-2 hop traversal

#### Q1: How many total videos have I saved? — PASS
```sql
SELECT COUNT(*) FROM ontology.nodes
WHERE user_id = $1 AND type = 'resource' AND properties->>'link_type' = 'youtube';
```
Result: 3 (correct — all YouTube resources counted)

#### Q2: What are my 5 most recently saved videos? — PASS
```sql
SELECT title, created_at FROM ontology.nodes
WHERE user_id = $1 AND type = 'resource' AND properties->>'link_type' = 'youtube'
ORDER BY created_at DESC LIMIT 5;
```
Result: 3 rows returned (Test Video, Steve Jobs, How to Learn Anything Fast)

#### Q3: List all channels I have saved videos from (deduplicated) — FAIL
**Gap**: No `channel_title` or `channel_id` in resource node `properties`.
- `user_local_cards.metadata_title` is NULL for all YouTube cards
- YouTube channel info is not extracted during card creation or enrichment
- **Schema addition needed**: `properties.channel_title`, `properties.channel_id`

#### Q4: Which videos have completion rate >= 80%? — FAIL
**Gap**: `watch_sessions` table exists but has 0 rows. No completion tracking implemented.
- **Dependency**: ViewSession tracking feature (not yet built)

#### Q5: Show only videos where I wrote a personal note — PARTIAL
```sql
SELECT title, properties->>'user_note' FROM ontology.nodes
WHERE user_id = $1 AND type = 'resource'
  AND properties->>'user_note' IS NOT NULL
  AND properties->>'user_note' != ''
  AND properties->>'user_note' NOT LIKE '%AI Summary%';
```
Result: 0 rows (no manual user notes yet — all `user_note` fields are AI-generated summaries prefixed with "AI Summary:")
**Issue**: `user_note` conflates AI summary and user note in the same field. Need separation.
- **Schema consideration**: Split `user_note` (manual) vs `ai_summary` (auto-generated) in properties

### Channel & Content Analysis (6-10)

#### Q6: Show video count per channel, descending — PARTIAL
```sql
SELECT COALESCE(c.metadata_title, 'Unknown') as source, COUNT(*)
FROM ontology.nodes n
JOIN public.user_local_cards c ON c.id::text = n.source_ref->>'id' AND c.user_id = n.user_id
WHERE n.user_id = $1 AND n.type = 'resource' AND n.properties->>'link_type' = 'youtube'
GROUP BY c.metadata_title ORDER BY count DESC;
```
Result: 0 rows — JOIN works but `metadata_title` is NULL (channel info not captured)
**Gap**: Same as Q3 — channel metadata missing

#### Q7: Top 5 longest videos (by duration) — FAIL
**Gap**: No `duration` in resource properties. YouTube API returns duration but it's not stored.
- **Schema addition needed**: `properties.duration` (ISO 8601 or seconds)

#### Q8: What is my total watch time in hours? — FAIL
**Gap**: Requires `watch_sessions` data + `duration` field. Neither available.

#### Q9: List videos I never re-watched (only 1 view session) — FAIL
**Gap**: `watch_sessions` has 0 rows.

#### Q10: Average completion rate for specific channel — FAIL
**Gap**: Requires `watch_sessions` (completion_rate) + channel data. Neither available.

### Watch Behavior Deep Dive (11-15)

#### Q11: Top 3 most re-watched videos — FAIL
**Gap**: `watch_sessions` empty.

#### Q12: Which segment has the most timestamp memos? — FAIL
**Gap**: Timestamp memo/segment data not in current schema. `video_notes` table exists but is not linked to ontology. No segment-level granularity.
- **Schema consideration**: `source_segment` node type exists in `object_types` but unused

#### Q13: Videos where timestamp memo contains "important" — PARTIAL
```sql
SELECT title FROM ontology.nodes
WHERE user_id = $1 AND type = 'resource'
  AND properties->>'user_note' ILIKE '%important%';
```
Result: 0 rows (no notes contain "important" — valid query, no matching data)
**Status**: Query works, schema supports it. Partial because `user_note` conflation issue.

#### Q14: Videos started but abandoned below 10% — FAIL
**Gap**: `watch_sessions` empty.

#### Q15: Channel with longest average watch duration — FAIL
**Gap**: `watch_sessions` + channel data both missing.

### Pattern & Insight (16-20)

#### Q16: Videos watched only in the last 30 days — PASS
```sql
SELECT title, created_at FROM ontology.nodes
WHERE user_id = $1 AND type = 'resource'
  AND created_at >= NOW() - INTERVAL '30 days'
ORDER BY created_at DESC;
```
Result: 3 rows (all resources are from last 30 days). Note: uses `created_at` (save date), not watch date.

#### Q17: Group my videos by tag — PASS
```sql
SELECT tag, COUNT(*) FROM ontology.nodes n,
  jsonb_array_elements_text(n.properties->'summary_tags') AS tag
WHERE n.user_id = $1 AND n.type = 'resource'
  AND n.properties->'summary_tags' IS NOT NULL
GROUP BY tag ORDER BY count DESC;
```
Result: 15 tags across 2 enriched videos. Works correctly via `summary_tags` jsonb array.

#### Q18: Completion rate: videos with notes vs without — PARTIAL
```sql
SELECT CASE WHEN properties->>'user_note' ... THEN 'has_note' ELSE 'no_note' END, COUNT(*)
FROM ontology.nodes WHERE user_id = $1 AND type = 'resource' GROUP BY 1;
```
Result: `no_note: 3` (note presence queryable, but completion_rate not available)
**Gap**: Can categorize note/no-note, but cannot compare completion rates (watch_sessions empty)

#### Q19: Completion rate distribution by video length — FAIL
**Gap**: Requires `duration` + `watch_sessions`. Neither available.

#### Q20: Videos I saved but never opened at all — FAIL
**Gap**: No "view" or "open" action tracked. `action_log` only has `CREATE_NODE` actions.
- **Schema consideration**: Track `VIEW_RESOURCE` in action_log when user opens a card

---

## Schema Gaps (Required Additions)

### Critical (blocks 12/20 queries)

| Gap | Affected Queries | Priority | Solution |
|-----|-----------------|----------|----------|
| **watch_sessions empty** | Q4, Q8, Q9, Q10, Q11, Q14, Q15, Q18(partial), Q19 | P0 | Implement ViewSession tracking (frontend → API → DB) |
| **channel_title missing** | Q3, Q6, Q10, Q15 | P1 | Add `channel_title`, `channel_id` to resource properties during card creation/enrichment |
| **duration missing** | Q7, Q8, Q15, Q19 | P1 | Add `duration` (seconds) to resource properties during YouTube metadata fetch |

### Moderate (improves quality)

| Gap | Affected Queries | Solution |
|-----|-----------------|----------|
| **user_note conflation** | Q5, Q13, Q18 | Split `user_note` (manual) vs keep AI summary in `summary` property (already exists) |
| **No view tracking in action_log** | Q20 | Add `VIEW_RESOURCE` action when user opens card detail |
| **source_segment unused** | Q12 | Implement timestamp memo as `source_segment` nodes with `CONTAINS` edges from resource |

### Data Volume Note
- Local dev has only 3 YouTube resources and 9 summaries
- Production has 114 rows (ops dashboard) — rerun on prod for realistic coverage assessment
- Many "0 rows" results are data-volume issues, not schema issues (Q5, Q13 queries work correctly)

---

## Recommendations

1. **Immediate (enrichment pipeline enhancement)**:
   - During `enrichVideo()`, extract and store `channel_title`, `channel_id`, `duration` from YouTube API metadata
   - These 3 fields unblock Q3, Q6, Q7 and partially Q8, Q10, Q15

2. **Short-term (ViewSession MVP)**:
   - Track card open/close events → `watch_sessions` table
   - This unblocks 9 queries (Q4, Q8, Q9, Q10, Q11, Q14, Q15, Q19, Q20)

3. **user_note cleanup**:
   - AI summaries already stored in `properties.summary` — stop writing to `user_note`
   - Reserve `user_note` for genuine user notes only
   - Migrate existing AI-prefixed notes: clear `user_note` where it starts with "AI Summary:"
