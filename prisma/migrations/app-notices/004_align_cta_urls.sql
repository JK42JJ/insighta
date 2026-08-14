-- Point the launch notices at their CTA destinations (2026-07-16):
-- closed_beta -> the beta signup page, dial_launch -> home. Idempotent
-- (IS DISTINCT FROM guard makes re-application a no-op).
UPDATE app_notices SET cta_url = 'https://insighta.one/beta/' WHERE kind = 'closed_beta' AND cta_url IS DISTINCT FROM 'https://insighta.one/beta/';
UPDATE app_notices SET cta_url = 'home' WHERE kind = 'dial_launch' AND cta_url IS DISTINCT FROM 'home';
