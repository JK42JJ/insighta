-- Seed the two launch 새소식 (closed_beta + dial_launch) idempotently (2026-07-16).
-- Guarded by kind so re-application no-ops after first insert. Content is the
-- approved mockup copy; future notices via admin POST /admin/notices.
INSERT INTO app_notices (title, body, kind, event_at, cta_label, cta_url, published_at)
SELECT '클로즈드 베타가 열렸어요',
       '지금, 초대받은 분들만 · 6주 무료로 Pro 전 기능을 써보세요.',
       'closed_beta', TIMESTAMPTZ '2026-08-24 23:59:59+09', '지금 참여하기', 'invite', now()
WHERE NOT EXISTS (SELECT 1 FROM app_notices WHERE kind = 'closed_beta');

INSERT INTO app_notices (title, body, kind, cta_label, cta_url, published_at)
SELECT E'다이얼,\n이제 손 안에',
       '유튜브는 보던 대로 보세요. 인사이타가 매주 한 편의 지식노트로 정리해 드려요.',
       'dial_launch', '지금 들어보기', 'home', now() - interval '1 minute'
WHERE NOT EXISTS (SELECT 1 FROM app_notices WHERE kind = 'dial_launch');
