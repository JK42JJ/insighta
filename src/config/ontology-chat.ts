/**
 * Where ontology chat history lives.
 *
 * It was a Map in the api process, described in its own header as
 * "In-memory conversation store (MVP — no DB persistence)". One container
 * hides the problem. With two, the second turn of a conversation can be
 * served by the other replica, which has no history and answers as if the
 * exchange had not happened. This is one of the reasons the chart pins api to
 * a single replica.
 *
 * The database store keeps the same semantics — 30-minute idle TTL enforced
 * on read, turn cap applied on write — and only changes where the rows sit.
 *
 * Default OFF, so unset keeps the in-memory behaviour and the flag alone
 * rolls back. Turning it on requires ontology_conversations to exist
 * (prisma/migrations/ontology/020_ontology_conversations.sql); the store logs
 * and falls back to memory if a query fails, so a missing table degrades
 * rather than breaks chat.
 */

export function isOntologyChatDbStore(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['ONTOLOGY_CHAT_DB_STORE'] ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}
