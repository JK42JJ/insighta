-- CP437 (2026-04-29) — user_mandalas.domain backfill
--
-- Source: CC console self-classification of 105 rows (1 typo + 104 null) per
-- the 9-slug taxonomy in src/config/domains.ts. Each id was matched against
-- its title using domain knowledge of the slugs (Hard Rule compliant — no
-- LLM API call).
--
-- Slugs: tech / learning / health / business / finance /
--        social / creative / lifestyle / mind
--
-- Distribution after this migration (expected):
--   user_mandalas.domain non-null = 2,105 (was 2,001)
--   user_mandalas.domain null     = 0     (was 104)
--   '기술/개발' typo               = 0     (was 1)

BEGIN;

-- 1. Typo fix
UPDATE user_mandalas SET domain = 'tech'
WHERE domain = '기술/개발';

-- 2. Null backfill — classified by CC self-knowledge
UPDATE user_mandalas SET domain = 'tech' WHERE id IN (
  'f57268a5-69fb-46be-93fb-355ffe4c8c52',  -- Google One 에서 AI 프로젝트 시작하기
  '7b7c2546-c882-44e3-897a-80c41d13e203',  -- GraphRAG 로 나만의 지식관리 시스템 구축하기
  'a9e19950-d30b-42e4-a9ee-25e11c785992',  -- SaaS 서비스 구축하고 논문 작성하기
  '95ef83d8-0b0e-4be2-8492-d751fc36da5a',  -- 프로젝트
  'a625a194-fbed-4c20-8e5a-d58c723ffe03',  -- 챗봇 프로젝트
  'bfe60da7-c895-4cef-add1-e0334f2d970b',  -- Claude Code 및 Vibe Coding 달인 되기
  '2b1d6664-6111-4cfd-a9b0-df4f5a80c808',  -- AI 시대의 클라우드 인프라엔지니어가 준비할 사항
  'c447c3b6-0c30-47a2-a0cb-3c8d890133a2',  -- 1주일 안에 나만의 모바일 앱 출시하기
  '2ab57f04-eb96-4cdf-b87d-dbfa474f9906',  -- Platform Engineer로 성장하기 위한 데일리 루틴 완성
  'd7d2b9d8-7256-4fc3-a96a-c8cf0f938411',  -- Claude Code 완전 정복하기
  '1b938543-03d3-4091-8cbb-3bb26838c05d',  -- 한 달 안에 AI 모델 활용 달인되기
  '561af0f8-62c7-425b-821a-6140b704e38c',  -- AI 서비스 개발을 위한 데일리 루틴 완성하기
  '6ceff2ed-b42f-45b0-a945-18c387061b5d',  -- Knowledge Graph & GraphRAG for PKM Systems
  '3cfd2ba1-3cb6-4185-b623-dc16048a3a84',  -- 개인 지식관리 완성을 위한 GraphDB 전문가 되기
  'f288144d-45bd-4487-a26d-cc037e94929d',  -- 시멘틱 검색 알고리즘 완성하기
  '8514498d-9292-489d-8cd0-797a7d111976',  -- AI/ML Expert
  'aa7af62b-c8c2-4d2a-964a-d4a5ee788700',  -- A.M.D 프로젝트
  'f9ef86d4-952d-4d7e-b9af-6702d9830608',  -- learn ai in 2026
  '4f3218ea-92ac-4ba6-a919-1a00f8f70623',  -- Learn AI Technology in 2026
  '3bcc73ec-99a9-48b2-b2a5-96c0fde0147c'   -- Learn Deep-Learning
);

UPDATE user_mandalas SET domain = 'learning' WHERE id IN (
  '72d5fe52-2f35-4a9e-8ef6-cd21629173ef',  -- 영어로 말하고 싶다
  '69b4e729-3a0d-4be4-9d25-c58637b8c1cb',  -- 일일 공부 습관 만들기
  '31a6ee8a-0e71-46f3-bef2-b64f153e63cc',  -- 영어 인터뷰 완정 정복하기
  '78c05632-e0de-41da-bf00-6fa17e18ff68',  -- 고등수학 완전정복
  '3a3432c9-36c6-4f74-96b5-da37fb20c1c1',  -- 3개월 안에 중학영어 초급반에서 상급반 가기
  '5adac758-0468-4675-9576-5d0f284607fa',  -- 영어원서 100권 읽기
  '0cdaa2b2-50e7-4980-8709-caaa39dc4f27',  -- 12주 영어 스피킹 훈련
  '360d4cce-db4d-4ff6-ba22-7e17f46b2ef0',  -- 100일 10권 책일기 도전
  'c6872c32-90dc-42ac-bd50-121ecb5a3366',  -- 일주일 영어 말하기 훈련
  'f79543d6-6d1e-4f75-9b4d-5af471085448',  -- 100일 루틴으로 학습 능력 키우기
  'ced89da0-327c-44f8-b3d0-d2b1f7af6168',  -- 공부하는 법 공부하기
  '2ce112c7-81a4-4e42-9108-2b641a47c446',  -- 두 달 안에 해외 AI 대학원 진학
  '36698ca8-9fd6-4442-b880-ff1ccbe61efe',  -- sqld 자격증 취득
  '6a27b571-81dd-43da-9e2c-f4ae14e6374d',  -- 영어 면접 일주일 안에 완성하기
  '70ef45d9-e8f0-4513-b84d-2166b79dcd74',  -- 30일 ultra learning 습관 만들기
  'e6a77f75-222e-4e0a-9d2f-91d253b36062',  -- 데일리 울트라 Learning 루틴
  '1f85f526-0692-4b30-99c9-95558d9392c6',  -- 성장하는 AI 학습 로드맵
  '444cdf48-b0a3-4b5f-b1b5-66f35d436688',  -- 1달 일일 루틴으로 전문가되기
  '606ff219-4f43-416e-82d0-e0e44f2b8414',  -- 오픽 IH받기
  '1cb5e7d4-6363-4cd8-9128-3896dda9ac5f',  -- 효율적인 학습법 탐색
  'e770348d-3132-4482-b95d-e4323fec9eec',  -- 우리아이 공부 습관 형성하기
  '591298e7-24ea-425d-b4de-734fcd9ad897',  -- 수능 대비 100일
  'f11dba71-5440-4ded-801e-9e7ae1260101',  -- 박사 학위 준비하기
  'f59970f8-8049-48ba-8a0d-8e815c702311',  -- 유튜브로 학습하는 방법
  'e560725f-b2b7-44ae-888e-9460dc90460f'   -- 100일 안에 수능 1등급 올리기
);

UPDATE user_mandalas SET domain = 'health' WHERE id IN (
  '3bf5d75d-3414-49ac-959d-7f4f5650ec42',  -- 나를 위한 건강습관 만들기
  '1d752e19-a5e1-4374-973a-533f9b44825a',  -- 60일 데일리 워크아웃
  'ea7edf9b-cb40-4f37-8473-947ea6835dd9',  -- 한 달안에 요가 초보에서 중급을오 올라서기
  'ef2f6428-fdf1-4ae1-9048-034191fd38ba',  -- 한 달안에 10KM 완주하기
  '22a1412b-d77b-4389-bb50-a112cec6fe0f',  -- 건강한 몸 만들기
  '20cda112-7413-4763-bca7-04e694d0d86c',  -- 100일 간헐적 단식 실천으로 대사 건강 지표 정상화
  '555610d8-9a7c-4f29-93d1-c91d3e3297f3',  -- 복싱 기초
  'fb76d907-43ac-4e4d-9438-3a15c6f45472',  -- 50일 턱걸이 20개 완성하기
  '191d0298-9771-422d-8b1b-11238aa1ba81',  -- 한달 안에 5kg 빼기
  '557d6986-e074-436f-aac7-d684b9855ee5',  -- 매일 운동하는 습관 만들기
  'fd875758-87af-4bdb-bc5c-142c8d040406'   -- 50일 수영 마스터 하기
);

UPDATE user_mandalas SET domain = 'business' WHERE id IN (
  '0404fe2d-a32c-456a-a244-84cf99f87be8',  -- 취직을 위한 프레임워크 만들기
  'a89c5e06-0f2d-465a-8201-588008139cf3',  -- 한 달 안에 외국계 기업 취직하기
  '64a70031-82e3-465e-a2d0-664ccda55d3f',  -- SaaS 비즈니스 론칭하기
  'cd38cf78-9885-4246-9e0d-dd67f539c9a6',  -- 온라인 비즈니스 성공하기
  '2652cbd6-3d34-415a-bd67-ce84ac3f8265',  -- Claude Code 로 1인 비즈니스 론칭하기
  '58fb26fe-e6a7-4ad9-a6f8-5e836f0993be',  -- 규칙적인 생활로 비즈니스 성공하기
  'eb512503-8369-4dd5-aae0-7182faeccf1e',  -- 1인 비즈니스 10개 오픈하기
  '466c4423-150e-4a7e-88e8-2bc0c5721ed5',  -- AI 시대 기업법
  '1dda8ee7-1bd3-44e0-a8f2-c138e51cc730',  -- 취업 목표를 세우고 준비하기
  'ace7bfd9-027f-4137-82ac-83523afbb6ba',  -- 사업 아이템 점검하기
  '8136df33-dd53-4dae-8bc0-339a1a63244f',  -- 한 달 안에 창업 프로그램 지원
  'e846d329-9fb0-41f3-ba21-c10496d67f1c',  -- 글로벌 채용 플랫폼 활용
  '86592535-f605-42dc-8d19-8c1c3b23e2b6',  -- 성공적인 직장 이직 전략
  'd8ddea4b-d7f8-43f3-bbc9-50645554efa0',  -- to build new business
  '431386a7-8189-43c9-9a37-7bb2b779f9cd',  -- Build a Remote-First Consulting Firm ...
  '4bb28086-7705-4523-9b9d-d28303fa7e54'   -- 취업 성공
);

UPDATE user_mandalas SET domain = 'finance' WHERE id IN (
  'f4a2d2d2-fd4a-4160-90f8-6649b69ef1f6',  -- 주식투자로 1억 벌기
  'ccebcc7a-5446-40fb-9fa1-0f4a5d7a4000',  -- 주식투자 5억 굴리기
  'f2adbde1-af99-4a53-a722-b09337dd02e2'   -- 금융 투자로 부자되기
);

UPDATE user_mandalas SET domain = 'creative' WHERE id IN (
  '0f217a4a-bf07-4552-9fea-15ac4213cb08',  -- 한달 AI 강의 영상 완성하기
  'acb83682-b491-4ac2-8b6f-c9fd0646b84a',  -- 음악 플레이 리스트 (advanced)
  '6e3a3fe8-85f0-4b4d-8f89-cd1f3e1bba47',  -- 음악 플레이 리스트 (standard)
  '9087062f-68b5-4bc7-b24e-4038f5be4fcf',  -- 즐겁게 공부하기 위한 추천 음악
  '8547f728-4c34-4357-84c1-6d646454097a',  -- Grow youtube channel
  '72c54b07-749e-4eb9-8aa1-c0d004ae2b9a'   -- Insighta 뉴스레터 시리즈
);

UPDATE user_mandalas SET domain = 'lifestyle' WHERE id IN (
  '963d7d9d-adff-4ae1-8322-93eb77437a59',  -- 가장 완전한 데일리 루틴
  'bc55ce08-1b78-4aed-9e6a-7553143b56c7',  -- 위클리 플래너 쓰는 습관 만들기
  'a1eed557-6414-4d6f-8884-7923f4d880ee',  -- 일주일 혼자 백패킹 하기
  '3b455fc1-19f8-441d-8b71-f98c3d704531',  -- 인생을 바꾸는 데일리 루틴 완성하기
  'b330c1af-92d3-4ee1-bd92-7df2f7d1def7',  -- 가족 해외 1달 살기
  '50057107-6656-482a-95cf-2da58a25125f',  -- 하반기 가족여행 가기
  '35e20a1d-08e4-44aa-92f0-3a92a26cda65',  -- 20대 캐쥬얼 브렌드 추천
  'c6e6dab1-4ea1-453b-ae17-79ce93d08c16',  -- 한 달 데일리루틴 실천으로 성장 습관 만들기
  'a3422f02-e41b-4481-9f37-b2a0a056c12a'   -- Planner
);

UPDATE user_mandalas SET domain = 'mind' WHERE id IN (
  '1ee990a9-6ee5-45e2-8c1f-0bab568a99a2',  -- 감정 컨트롤 하기
  'b262bd28-e9fe-46db-b2d1-5cb34b720898',  -- 나를 다스리는 방법
  '704b026e-5583-4188-ad18-ad782aed081a',  -- 행복하게 사는 방법
  'c8d62cf8-c1dc-4480-8ab4-4c4382d1bab9',  -- 세상에 도움이 되는 사람이 되자
  'cfa8a4bf-2359-4234-b292-9ca97113f101',  -- 불편함을 받아들이기
  'b079177d-4882-43cc-a07a-f8fd8417b8b3',  -- 원하는 것을 어떻게 얻는가
  'f13084b2-e642-4438-94f3-370ded87a513',  -- 행복하기 위한 삶 만들기
  '23b3c12b-6fef-4688-a8b5-75dacf963515',  -- 행복하기 위한 삶 만들기 (dup)
  '772ba8b8-d1f9-420a-9250-fa81edc04e9f',  -- 삶의 목표를 찾고 하루 루틴 완성하기
  '46b6fe0b-48e7-4e59-b1c9-e4b1773f3ef4',  -- 새 만다라트
  '22b430f5-ade2-4555-80f2-17a84b8d5717',  -- AI 시대의 뇌 활용법
  'fb02e4d9-4166-4e1f-90fd-22c8842801c7',  -- AI 시대의 기억법
  '14ddfef8-9396-4402-a081-03d1888d5d7e',  -- 2026 원하는 목표 달성하기
  'd503f4a0-32a6-43d2-a991-12d96592115b'   -- 2026년 목표
);

-- Validation: must be 0 nulls and 0 typos after this script.
-- SELECT COUNT(*) FILTER (WHERE domain IS NULL) AS still_null,
--        COUNT(*) FILTER (WHERE domain = '기술/개발') AS still_typo,
--        COUNT(*) AS total
-- FROM user_mandalas;

COMMIT;
