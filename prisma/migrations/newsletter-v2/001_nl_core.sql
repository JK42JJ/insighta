-- Newsletter pipeline v2.1 core (WO-2026-09-11-newsletter-v21-pr1).
-- Design: insighta-newsletter-pipeline-implementation-v2.1.md §2-§3 (2026-09-08).
-- Applied with raw SQL first (prisma db push is known to fail silently on Supabase), then mirrored in prisma/schema.prisma.
-- Idempotent: every statement is IF NOT EXISTS / OR REPLACE / ON CONFLICT.

create table if not exists nl_domain (
  domain text primary key,
  audience text,
  search_terms text[] not null default '{}',
  trusted_creators uuid[] not null default '{}',
  concept_taxonomy jsonb not null default '{}'::jsonb,
  primary_source_types text[] not null default '{}',
  term_dictionary jsonb not null default '{}'::jsonb,
  signal_min_creators int not null default 8,
  baseline_weeks int not null default 4,
  cron text,
  caption_retention text not null default 'until_milestone',
  created_at timestamptz not null default now()
);

create table if not exists source_creator (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel_ids text[] not null default '{}',
  kind text not null default 'unknown' check (kind in ('individual','company','conference','media','unknown')),
  trust_score numeric not null default 0.5,
  created_at timestamptz not null default now()
);

create table if not exists channel_identity (
  channel_id text primary key,
  creator_id uuid not null references source_creator(id),
  talk_org text,
  mapped_by text,
  mapped_at timestamptz not null default now()
);

create table if not exists nl_issue (
  id uuid primary key default gen_random_uuid(),
  domain text not null references nl_domain(domain),
  iso_week text not null,
  state text not null default 'collecting',
  thesis text,
  thesis_by uuid,
  thesis_at timestamptz,
  published_version int,
  created_at timestamptz not null default now(),
  unique (domain, iso_week)
);

create table if not exists collect_job (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid references nl_issue(id),
  kind text not null check (kind in ('meta','caption')),
  video_ids text[] not null,
  state text not null default 'queued' check (state in ('queued','running','done','failed')),
  idempotency_key text not null unique,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Caption text never lives here: only the fingerprint and quality of what the Mac Mini holds (v2.1 §2).
-- Named nl_video_captions: a video_captions table with another shape already exists.
create table if not exists nl_video_captions (
  video_id text primary key,
  lang text,
  fetched_at timestamptz,
  sha256 text,
  quality jsonb,
  archived_at timestamptz
);

create table if not exists nl_signal (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references nl_issue(id) on delete cascade,
  concept text not null,
  creator_count int not null default 0,
  video_ids text[] not null default '{}',
  representative_video_ids text[] not null default '{}',
  baseline_mean numeric,
  baseline_sd numeric,
  z numeric,
  delta_vs_last numeric,
  created_at timestamptz not null default now(),
  unique (issue_id, concept)
);

create table if not exists nl_evidence (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references nl_issue(id) on delete cascade,
  kind text not null check (kind in ('caption','description','primary')),
  video_id text,
  t0 numeric,
  t1 numeric,
  seg_hash text,
  url text,
  fetched_at timestamptz,
  http_status int,
  excerpt text,
  quoted text not null check (char_length(quoted) <= 200),
  created_at timestamptz not null default now()
);

create table if not exists nl_claim (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references nl_issue(id) on delete cascade,
  version int not null default 1,
  section text not null,
  seq int not null,
  ctype text not null check (ctype in ('fact','explain','transition','judgment')),
  text text not null,
  numbers text[] not null default '{}',
  proper_nouns text[] not null default '{}',
  grade text check (grade in ('확인','관측','미확인')),
  created_at timestamptz not null default now(),
  unique (issue_id, version, section, seq)
);

create table if not exists nl_claim_evidence (
  claim_id uuid not null references nl_claim(id) on delete cascade,
  evidence_id uuid not null references nl_evidence(id) on delete cascade,
  primary key (claim_id, evidence_id)
);

create table if not exists nl_atomic_claim (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references nl_claim(id) on delete cascade,
  kind text not null check (kind in ('number','entity','quote','event')),
  text text not null,
  normalized text
);

create table if not exists nl_atomic_claim_evidence (
  atomic_id uuid not null references nl_atomic_claim(id) on delete cascade,
  evidence_id uuid not null references nl_evidence(id) on delete cascade,
  primary key (atomic_id, evidence_id)
);

create table if not exists nl_issue_version (
  issue_id uuid not null references nl_issue(id) on delete cascade,
  version int not null,
  rendered_email text,
  rendered_web text,
  claims_snapshot jsonb,
  published_at timestamptz,
  correction_note text,
  primary key (issue_id, version)
);

create table if not exists nl_gate_spec (
  name text primary key,
  severity text not null check (severity in ('block','warn')),
  stage text not null,
  description text not null,
  enabled boolean not null default true
);

create table if not exists nl_gate_result (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references nl_issue(id) on delete cascade,
  version int not null,
  gate text not null references nl_gate_spec(name),
  severity text not null check (severity in ('block','warn')),
  passed boolean not null,
  detail jsonb,
  run_at timestamptz not null default now()
);

create table if not exists nl_rejection (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid references nl_issue(id) on delete cascade,
  claim_id uuid references nl_claim(id) on delete set null,
  quoted text,
  reason text,
  cause text,
  by_user uuid,
  at timestamptz not null default now()
);

create table if not exists nl_feedback (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid references nl_issue(id) on delete cascade,
  version int,
  claim_id uuid references nl_claim(id) on delete set null,
  section text,
  kind text not null,
  value numeric,
  actor_hash text,
  at timestamptz not null default now()
);

create table if not exists nl_eval (
  issue_id uuid not null references nl_issue(id) on delete cascade,
  axis text not null,
  auto_score numeric,
  human_score numeric,
  n int,
  detail jsonb,
  at timestamptz not null default now(),
  primary key (issue_id, axis, at)
);

-- The rule the whole design rests on (v2.1 §3.3): a fact sentence cannot be
-- stored without at least one atomic claim, and no atomic claim without
-- evidence. Checked at commit so a claim, its atomic claims and their
-- evidence can be written in one transaction in any order.
create or replace function nl_check_fact_claim(p_claim uuid) returns void language plpgsql as $$
declare v_ctype text; v_missing int;
begin
  select ctype into v_ctype from nl_claim where id = p_claim;
  if v_ctype is distinct from 'fact' then return; end if;
  if not exists (select 1 from nl_atomic_claim a where a.claim_id = p_claim) then
    raise exception 'nl_claim %: a fact claim needs at least one atomic claim', p_claim using errcode = '23514';
  end if;
  select count(*) into v_missing from nl_atomic_claim a
    where a.claim_id = p_claim
      and not exists (select 1 from nl_atomic_claim_evidence e where e.atomic_id = a.id);
  if v_missing > 0 then
    raise exception 'nl_claim %: % atomic claim(s) without evidence', p_claim, v_missing using errcode = '23514';
  end if;
end $$;

create or replace function nl_claim_fact_trg() returns trigger language plpgsql as $$
begin perform nl_check_fact_claim(coalesce(NEW.id, OLD.id)); return null; end $$;

create or replace function nl_atomic_fact_trg() returns trigger language plpgsql as $$
declare cid uuid;
begin
  if TG_TABLE_NAME = 'nl_atomic_claim' then
    cid := coalesce(NEW.claim_id, OLD.claim_id);
  else
    select claim_id into cid from nl_atomic_claim where id = coalesce(NEW.atomic_id, OLD.atomic_id);
  end if;
  if cid is not null then perform nl_check_fact_claim(cid); end if;
  return null;
end $$;

drop trigger if exists nl_claim_fact_evidence on nl_claim;
create constraint trigger nl_claim_fact_evidence
  after insert or update on nl_claim deferrable initially deferred
  for each row execute function nl_claim_fact_trg();
drop trigger if exists nl_atomic_claim_fact_evidence on nl_atomic_claim;
create constraint trigger nl_atomic_claim_fact_evidence
  after insert or update or delete on nl_atomic_claim deferrable initially deferred
  for each row execute function nl_atomic_fact_trg();
drop trigger if exists nl_atomic_evidence_fact_evidence on nl_atomic_claim_evidence;
create constraint trigger nl_atomic_evidence_fact_evidence
  after delete on nl_atomic_claim_evidence deferrable initially deferred
  for each row execute function nl_atomic_fact_trg();

-- Gate declarations (v2.1 §4 W7 hard, W8 soft). Admin shows this table; a gate not run counts as failed.
insert into nl_gate_spec (name, severity, stage, description) values
  ('fact-has-evidence',            'block', 'W7', 'Every fact sentence has at least one atomic claim, each with evidence'),
  ('grade-rules-pass',             'block', 'W7', 'Numbers and names pass §3.4: no fact sentence graded 미확인'),
  ('story-no-captionless-evidence','block', 'W7', 'Story body cites no evidence from a video without captions'),
  ('confirmed-primary-2xx',        'block', 'W7', 'Every [확인] sentence has a primary source with http_status 2xx and fetched_at'),
  ('no-raw-markers',               'block', 'W7', 'No videoId, [영상] or backtick left in the body'),
  ('no-editorial-vocab-emoji',     'block', 'W7', 'No 편집부, no emoji, signature is Insighta 에디토리얼'),
  ('picks-match-db',               'block', 'W7', 'Picks: videoId, title, channel, views equal the DB values; ledger grade/value unchanged'),
  ('footnotes-contiguous',         'block', 'W7', 'Footnote numbers contiguous with no gaps after render'),
  ('banned-phrases',               'warn',  'W8', 'Persona §3 banned phrases plus patterns approved from nl_rejection'),
  ('title-shape',                  'warn',  'W8', 'Title has no dash and is not a bare noun phrase'),
  ('honorific-consistency',        'warn',  'W8', 'Sentence-ending register consistent (honorific ratio >= 95%)'),
  ('repeated-verb',                'warn',  'W8', 'Same verb twice in one sentence (morphological analysis)'),
  ('glossary-explained',           'warn',  'W8', 'A dictionary term is explained within two sentences of first use'),
  ('sentence-length-variance',     'warn',  'W8', 'Three short declaratives in a row'),
  ('judgment-count',               'warn',  'W8', 'More than three judgment sentences in one issue'),
  ('comprehension-judge-log',      'warn',  'W8', 'Cross-family judge, temperature 0, pairwise both orders; log only until 200 human labels')
on conflict (name) do nothing;

-- Domain seed for ai-tech from the issue-1 corpus (274 videos): the search terms actually used,
-- the channels reached through the trusted path, and the concept tags observed. Creators start
-- as kind=unknown; the weekly merge step assigns kind and adjusts trust_score.
insert into source_creator (id,name,channel_ids,kind,trust_score) values ('23ecef28-6bf9-5e25-961f-cb31e1475df4','AI Engineer',ARRAY['UCLKPca3kwwd-B59HNr-_lvA']::text[],'unknown',0.7) on conflict (id) do nothing;
insert into channel_identity (channel_id,creator_id,mapped_by) values ('UCLKPca3kwwd-B59HNr-_lvA','23ecef28-6bf9-5e25-961f-cb31e1475df4','corpus-2026-W36') on conflict (channel_id) do nothing;
insert into source_creator (id,name,channel_ids,kind,trust_score) values ('e28c695a-b21d-58ae-9fcb-3bbd2b0f1668','AI Foundations',ARRAY['UCWZwfV3ICOt3uEPpW6hYK4g']::text[],'unknown',0.7) on conflict (id) do nothing;
insert into channel_identity (channel_id,creator_id,mapped_by) values ('UCWZwfV3ICOt3uEPpW6hYK4g','e28c695a-b21d-58ae-9fcb-3bbd2b0f1668','corpus-2026-W36') on conflict (channel_id) do nothing;
insert into source_creator (id,name,channel_ids,kind,trust_score) values ('a8e0b6f1-aca9-5afb-9d41-c915351c1789','Anthropic',ARRAY['UCrDwWp7EBBv4NwvScIpBDOA']::text[],'unknown',0.7) on conflict (id) do nothing;
insert into channel_identity (channel_id,creator_id,mapped_by) values ('UCrDwWp7EBBv4NwvScIpBDOA','a8e0b6f1-aca9-5afb-9d41-c915351c1789','corpus-2026-W36') on conflict (channel_id) do nothing;
insert into source_creator (id,name,channel_ids,kind,trust_score) values ('df519d30-0c62-5cbf-8f39-d448c4c2de94','DevOps & AI Toolkit',ARRAY['UCfz8x0lVzJpb_dgWm9kPVrw']::text[],'unknown',0.7) on conflict (id) do nothing;
insert into channel_identity (channel_id,creator_id,mapped_by) values ('UCfz8x0lVzJpb_dgWm9kPVrw','df519d30-0c62-5cbf-8f39-d448c4c2de94','corpus-2026-W36') on conflict (channel_id) do nothing;
insert into source_creator (id,name,channel_ids,kind,trust_score) values ('1da82b0e-37e5-5dca-9481-17e9dc4c2e89','Every',ARRAY['UCjIMtrzxYc0lblGhmOgC_CA']::text[],'unknown',0.7) on conflict (id) do nothing;
insert into channel_identity (channel_id,creator_id,mapped_by) values ('UCjIMtrzxYc0lblGhmOgC_CA','1da82b0e-37e5-5dca-9481-17e9dc4c2e89','corpus-2026-W36') on conflict (channel_id) do nothing;
insert into source_creator (id,name,channel_ids,kind,trust_score) values ('d4db0e77-c413-54b2-a1bd-511a10e6b4ee','IBM Technology',ARRAY['UCKWaEZ-_VweaEx1j62do_vQ']::text[],'unknown',0.7) on conflict (id) do nothing;
insert into channel_identity (channel_id,creator_id,mapped_by) values ('UCKWaEZ-_VweaEx1j62do_vQ','d4db0e77-c413-54b2-a1bd-511a10e6b4ee','corpus-2026-W36') on conflict (channel_id) do nothing;
insert into source_creator (id,name,channel_ids,kind,trust_score) values ('ab6f70ed-20fe-50f0-9357-f1a380044289','IndyDevDan',ARRAY['UC_x36zCEGilGpB1m-V4gmjg']::text[],'unknown',0.7) on conflict (id) do nothing;
insert into channel_identity (channel_id,creator_id,mapped_by) values ('UC_x36zCEGilGpB1m-V4gmjg','ab6f70ed-20fe-50f0-9357-f1a380044289','corpus-2026-W36') on conflict (channel_id) do nothing;
insert into source_creator (id,name,channel_ids,kind,trust_score) values ('eaea3c80-d9cc-5cae-b127-0c07750fa46b','LangChain',ARRAY['UCC-lyoTfSrcJzA1ab3APAgw']::text[],'unknown',0.7) on conflict (id) do nothing;
insert into channel_identity (channel_id,creator_id,mapped_by) values ('UCC-lyoTfSrcJzA1ab3APAgw','eaea3c80-d9cc-5cae-b127-0c07750fa46b','corpus-2026-W36') on conflict (channel_id) do nothing;
insert into source_creator (id,name,channel_ids,kind,trust_score) values ('1beb9d9b-4329-52af-9373-92872b0e9a36','NVIDIA Developer',ARRAY['UCBHcMCGaiJhv-ESTcWGJPcw']::text[],'unknown',0.7) on conflict (id) do nothing;
insert into channel_identity (channel_id,creator_id,mapped_by) values ('UCBHcMCGaiJhv-ESTcWGJPcw','1beb9d9b-4329-52af-9373-92872b0e9a36','corpus-2026-W36') on conflict (channel_id) do nothing;
insert into source_creator (id,name,channel_ids,kind,trust_score) values ('41cb2ecb-2267-5cbf-b7c5-48d82e4c6bd1','Nate Herk | AI Automation',ARRAY['UC2ojq-nuP8ceeHqiroeKhBA']::text[],'unknown',0.7) on conflict (id) do nothing;
insert into channel_identity (channel_id,creator_id,mapped_by) values ('UC2ojq-nuP8ceeHqiroeKhBA','41cb2ecb-2267-5cbf-b7c5-48d82e4c6bd1','corpus-2026-W36') on conflict (channel_id) do nothing;
insert into source_creator (id,name,channel_ids,kind,trust_score) values ('9c0b477b-1a80-5f58-b9af-9232f538bf30','Tech Bridge',ARRAY['UC895rbZX2iXLTDfji7W4PfA']::text[],'unknown',0.7) on conflict (id) do nothing;
insert into channel_identity (channel_id,creator_id,mapped_by) values ('UC895rbZX2iXLTDfji7W4PfA','9c0b477b-1a80-5f58-b9af-9232f538bf30','corpus-2026-W36') on conflict (channel_id) do nothing;
insert into source_creator (id,name,channel_ids,kind,trust_score) values ('917efb44-5f3d-5a4d-b6c3-da321d59c63b','바이브마피아 | AI Native 엔지니어',ARRAY['UC6xro-nRXlpa4A5UoeFKUDA']::text[],'unknown',0.7) on conflict (id) do nothing;
insert into channel_identity (channel_id,creator_id,mapped_by) values ('UC6xro-nRXlpa4A5UoeFKUDA','917efb44-5f3d-5a4d-b6c3-da321d59c63b','corpus-2026-W36') on conflict (channel_id) do nothing;

insert into nl_domain (domain, audience, search_terms, trusted_creators, concept_taxonomy, primary_source_types, signal_min_creators, baseline_weeks, cron)
values ('ai-tech', 'AI·클라우드·DevOps 실무자 (한국어)', ARRAY['AI 에이전트 만들기','AI 에이전트 툴 사용','AI 토큰 비용 절감','LLM benchmark comparison','LLM security vulnerability','MCP server tutorial','RAG implementation','RAG 구축','agent tool use','building AI agents','coding agent','context engineering','fine-tuning LLM','inference cost optimization','model evaluation results','model quantization','new LLM model release','open weights model release','prompt injection attack','run LLM locally','system prompt design','token cost reduction','vLLM serving','로컬 LLM 구동','모델 양자화','컨텍스트 엔지니어링','코딩 에이전트','프롬프트 인젝션']::text[], ARRAY['23ecef28-6bf9-5e25-961f-cb31e1475df4','e28c695a-b21d-58ae-9fcb-3bbd2b0f1668','a8e0b6f1-aca9-5afb-9d41-c915351c1789','df519d30-0c62-5cbf-8f39-d448c4c2de94','1da82b0e-37e5-5dca-9481-17e9dc4c2e89','d4db0e77-c413-54b2-a1bd-511a10e6b4ee','ab6f70ed-20fe-50f0-9357-f1a380044289','eaea3c80-d9cc-5cae-b127-0c07750fa46b','1beb9d9b-4329-52af-9373-92872b0e9a36','41cb2ecb-2267-5cbf-b7c5-48d82e4c6bd1','9c0b477b-1a80-5f58-b9af-9232f538bf30','917efb44-5f3d-5a4d-b6c3-da321d59c63b']::uuid[], '{"concepts": ["agent", "supply-chain", "evaluation", "coding-agent", "rag", "mcp", "serving-stack", "inference", "context", "agent-harness", "prompt-injection", "local-inference", "quantization", "guardrails", "multi-agent", "tool-calling", "pricing", "kv-cache", "fine-tuning", "human-in-the-loop", "ai-security", "model-release", "indirect-injection", "embedding", "context-compaction", "agent-payments"]}'::jsonb,
        ARRAY['paper','repository','official-blog','cve','release-notes']::text[], 8, 4, '0 6 * * 1')
on conflict (domain) do nothing;
