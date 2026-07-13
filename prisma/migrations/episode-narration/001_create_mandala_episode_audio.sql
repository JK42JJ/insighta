-- Episode narration audio (ElevenLabs pre-produce, 2026-07-13).
-- Raw DDL alongside schema.prisma per the prisma-db-push silent-fail rule.
CREATE TABLE IF NOT EXISTS mandala_episode_audio (
  mandala_id    uuid PRIMARY KEY REFERENCES user_mandalas(id) ON DELETE CASCADE,
  status        varchar(12) NOT NULL DEFAULT 'pending',
  host          varchar(8)  NOT NULL DEFAULT 'jun',
  book_version  integer     NOT NULL DEFAULT 0,
  manifest_json jsonb,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
