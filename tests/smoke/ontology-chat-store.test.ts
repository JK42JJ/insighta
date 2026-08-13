import { isOntologyChatDbStore } from '../../src/config/ontology-chat';

/**
 * Ontology chat history was a Map in the api process. With two replicas the
 * second turn of a conversation can be served by the replica that has never
 * seen it, so the assistant answers as if the exchange had not happened.
 *
 * The database store fixes that. The flag has to default off: the table has
 * to exist before the path is used, and unset must keep the behaviour the
 * single-container deployment has today.
 */
describe('ontology chat store selection', () => {
  it('defaults to the in-memory store', () => {
    expect(isOntologyChatDbStore({})).toBe(false);
  });

  it.each(['true', 'TRUE', '1', 'yes'])('uses the database on %s', (v) => {
    expect(isOntologyChatDbStore({ ONTOLOGY_CHAT_DB_STORE: v })).toBe(true);
  });

  it.each(['false', '0', 'no', '', '   '])('stays in memory for %s', (v) => {
    expect(isOntologyChatDbStore({ ONTOLOGY_CHAT_DB_STORE: v })).toBe(false);
  });

  // A typo must not silently move where history is kept.
  it('stays in memory for an unrecognised value', () => {
    expect(isOntologyChatDbStore({ ONTOLOGY_CHAT_DB_STORE: 'db' })).toBe(false);
    expect(isOntologyChatDbStore({ ONTOLOGY_CHAT_DB_STORE: 'postgres' })).toBe(false);
  });
});

/**
 * The DDL has to stay applyable. It is in the deploy allowlist, and Supabase
 * silently drops changes `prisma db push` thinks it made, so the raw file is
 * what actually creates the table.
 */
describe('conversation table DDL', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const ROOT = path.resolve(__dirname, '..', '..');
  const DDL = 'prisma/migrations/ontology/020_ontology_conversations.sql';

  it('exists and is idempotent', () => {
    const sql = fs.readFileSync(path.join(ROOT, DDL), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS ontology_conversations/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_ontology_conversations_last_access/);
  });

  it('is in the deploy allowlist, or it never reaches production', () => {
    const script = fs.readFileSync(path.join(ROOT, 'scripts/apply-custom-sql.sh'), 'utf8');
    expect(script).toContain(DDL);
  });

  it('is declared in the Prisma schema as well as in raw SQL', () => {
    const schema = fs.readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf8');
    expect(schema).toMatch(/model ontology_conversations/);
  });
});
