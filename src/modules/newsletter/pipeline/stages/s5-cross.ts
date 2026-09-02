/**
 * S5 — one channel is a claim; independent channels are an event.
 *
 * The rule issue 1 discovered by hand and applied correctly to the Furiosa
 * story, written down so the next editor does not have to rediscover it:
 *
 *   A claim carried by fewer than three independent channels is not written
 *   as fact. It is written as "this is circulating", or it is dropped.
 *
 * "Independent" means a different channel id, not a different video. Four
 * uploads from one channel are one source, and treating them as four is how a
 * brief turns a press release into a trend.
 *
 * This stage does not drop anything. Corroboration is a property of a claim,
 * not a reason a video is unfit — a single-source video can be the best pick
 * of the week as long as the page says what it is. It writes the count and the
 * peers onto each row so S7 has to look at them.
 *
 * Grouping is by the topic terms a title contains. Crude on purpose: a shared
 * subject is what makes two channels corroborating, and inferring subjects
 * with a model here would put an unaudited judgement between the corpus and
 * the page.
 */

import type { CorpusRow } from '../corpus';
import type { Stage, StageResult } from '../stage';

/**
 * The subjects this brief's stories are about, each with the words that mean it.
 *
 * Aliases, not a word list, and the reason is the whole point of harvesting in
 * two languages. `ai-tech` searches Korean and English because issue 1
 * measured that either alone misses a story — the DeepSeek harness ran 11
 * English videos to 4 Korean, Furiosa ran 5 Korean to 0 English. If "agent"
 * and "에이전트" count as two subjects then a story covered by two English and
 * one Korean channel clears no bar, and the second language bought nothing.
 *
 * A matching aid, not a boundary: adding an alias changes which videos are
 * seen as talking about the same thing, never which videos are in the brief.
 */
const SUBJECTS: ReadonlyArray<{ key: string; aliases: readonly string[] }> = [
  { key: 'agent', aliases: ['agent', 'agentic', '에이전트'] },
  { key: 'mcp', aliases: ['mcp', 'model context protocol'] },
  { key: 'rag', aliases: ['rag', 'retrieval-augmented', '검색 증강'] },
  { key: 'embedding', aliases: ['embedding', 'vector', '임베딩', '벡터'] },
  { key: 'context', aliases: ['context window', 'context engineering', '컨텍스트'] },
  { key: 'benchmark', aliases: ['benchmark', 'eval', 'leaderboard', '벤치마크', '평가'] },
  { key: 'fine-tuning', aliases: ['fine-tun', 'finetun', 'lora', 'sft', '파인튜닝', '미세조정'] },
  { key: 'quantization', aliases: ['quantiz', 'gguf', 'awq', '양자화'] },
  {
    key: 'inference',
    aliases: ['inference', 'vllm', 'serving', 'throughput', 'latency', '추론', '서빙'],
  },
  {
    key: 'pricing',
    aliases: ['pricing', 'price', 'cost per', 'token cost', '요금', '비용', '가격'],
  },
  {
    key: 'prompt-injection',
    aliases: ['prompt injection', 'jailbreak', '프롬프트 인젝션', '탈옥'],
  },
  { key: 'safety', aliases: ['guardrail', 'alignment', 'safety', '안전', '가드레일'] },
  {
    key: 'coding-agent',
    aliases: ['coding agent', 'cursor', 'copilot', 'codex', 'claude code', '코딩 에이전트'],
  },
  {
    key: 'open-weights',
    aliases: [
      'open weights',
      'open-source model',
      'open source model',
      '오픈소스 모델',
      '오픈 웨이트',
    ],
  },
  { key: 'gpt', aliases: ['gpt-', 'gpt 5', 'openai o'] },
  { key: 'claude', aliases: ['claude'] },
  { key: 'gemini', aliases: ['gemini'] },
  { key: 'llama', aliases: ['llama'] },
  { key: 'qwen', aliases: ['qwen'] },
  { key: 'deepseek', aliases: ['deepseek'] },
  { key: 'mistral', aliases: ['mistral'] },
  { key: 'grok', aliases: ['grok'] },
  { key: 'kimi', aliases: ['kimi'] },
  { key: 'nvidia', aliases: ['nvidia', 'blackwell', 'h100', 'b200', 'gpu cluster'] },
] as const;

/** Which subjects this text is about. Canonical keys, so the two languages meet. */
function subjectsIn(text: string): string[] {
  const t = text.toLowerCase();
  return SUBJECTS.filter((s) => s.aliases.some((a) => t.includes(a))).map((s) => s.key);
}

/** Three independent channels is the bar. Below it, a claim is circulating. */
const INDEPENDENT_CHANNELS_REQUIRED = 3;

export const s5Cross: Stage = {
  id: 'S5_cross',
  what: 'count the independent channels behind each subject',
  kind: 'machine',

  async run(input: CorpusRow[]): Promise<StageResult> {
    // subject -> the distinct channels that covered it
    const channelsBySubject = new Map<string, Set<string>>();
    const subjectsByVideo = new Map<string, string[]>();

    for (const v of input) {
      const enrichment = (v.enrichment ?? {}) as { description?: string; tags?: string[] };
      // Title, description and tags: the description is where a channel says
      // which model it actually tested, and titles alone miss most of it.
      const haystack = [
        v.title,
        enrichment.description ?? '',
        (enrichment.tags ?? []).join(' '),
      ].join(' ');
      const subjects = subjectsIn(haystack);
      subjectsByVideo.set(v.videoId, subjects);
      for (const subject of subjects) {
        const set = channelsBySubject.get(subject) ?? new Set<string>();
        set.add(v.channelId);
        channelsBySubject.set(subject, set);
      }
    }

    const survivors = input.map((v) => {
      const subjects = subjectsByVideo.get(v.videoId) ?? [];
      const corroborated = subjects
        .map((term) => ({ term, channels: channelsBySubject.get(term)?.size ?? 0 }))
        .filter((t) => t.channels >= INDEPENDENT_CHANNELS_REQUIRED)
        .sort((a, b) => b.channels - a.channels);

      return {
        videoId: v.videoId,
        corroboration: {
          terms: subjects,
          // Subjects at least three independent channels covered this week.
          corroborated,
          strongest: corroborated[0]?.term ?? null,
          independentChannels: corroborated[0]?.channels ?? 0,
        },
      };
    });

    // The week's shape: which subjects cleared the bar, and by how much.
    const events = [...channelsBySubject.entries()]
      .map(([term, channels]) => ({ term, channels: channels.size }))
      .filter((e) => e.channels >= INDEPENDENT_CHANNELS_REQUIRED)
      .sort((a, b) => b.channels - a.channels);

    return {
      survivors,
      drops: [],
      detail: {
        rule: `a subject needs ${INDEPENDENT_CHANNELS_REQUIRED} independent channels to be written as fact`,
        subjectsClearingBar: events.length,
        top: events.slice(0, 15),
      },
    };
  },
};
