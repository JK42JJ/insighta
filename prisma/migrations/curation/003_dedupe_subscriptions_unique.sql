-- Weekly-novelty defect follow-up (2026-08-03): legacy same-user same-topic
-- duplicate subscriptions multiplied weekly builds (measured: one user held
-- 19 duplicate active rows across 3 topics). POST /curations has deduped at
-- the app layer since then, but the legacy rows remain and a concurrent-create
-- race window persists.
--
-- 1) Deactivate duplicates, keeping per (user, normalised topic) the row with
--    the richest curation_items history (ties -> oldest). Reversible: is_active
--    flip only, no deletes; items of deactivated rows are retained (they feed
--    the family served-history exclusion in the weekly build).
-- 2) Partial unique index as the DB-level backstop for the create race.
--
-- Idempotent: the UPDATE is a no-op once clean; CREATE UNIQUE INDEX guarded
-- by IF NOT EXISTS.

UPDATE curation_subscriptions s
SET is_active = false
WHERE s.is_active
  AND s.id NOT IN (
    SELECT DISTINCT ON (user_id, lower(btrim(topic))) id
    FROM curation_subscriptions s2
    WHERE s2.is_active
    ORDER BY
      user_id,
      lower(btrim(topic)),
      (SELECT count(*) FROM curation_items i WHERE i.subscription_id = s2.id) DESC,
      s2.created_at ASC
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_curation_subs_user_topic_active
  ON curation_subscriptions (user_id, lower(btrim(topic)))
  WHERE is_active;
