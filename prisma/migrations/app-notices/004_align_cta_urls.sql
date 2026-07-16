-- Point the two launch notices at in-app CTA destinations (2026-07-16):
-- closed_beta -> invite screen (beta growth), dial_launch -> home. Idempotent
-- (IS DISTINCT FROM guard makes re-application a no-op).
UPDATE app_notices SET cta_url = 'invite' WHERE kind = 'closed_beta' AND cta_url IS DISTINCT FROM 'invite';
UPDATE app_notices SET cta_url = 'home'   WHERE kind = 'dial_launch' AND cta_url IS DISTINCT FROM 'home';
