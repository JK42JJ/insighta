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

/**
 * Above this share of the corpus a subject is background, not an event.
 *
 * Measured on the 2026-08-31 run: 274 videos, and "agent" appeared on 144
 * channels. Three independent channels is a meaningful bar for a claim and a
 * meaningless one for a word half the corpus uses — every video cleared it,
 * every video reported the same number, and the signal that was supposed to
 * rank the week ranked nothing. A subject this common is what the brief is
 * about; it is not what happened this week.
 */
const BACKGROUND_SHARE = 0.25;

/**
 * Words that carry no subject on their own.
 *
 * Used to find the rare tokens two titles share, which is how a re-upload is
 * recognised. Kept short: the test is rarity in this corpus, not membership of
 * a list, so only words that would otherwise dominate need to be here.
 */
const TITLE_STOPWORDS = new Set([
  'with',
  'from',
  'that',
  'this',
  'your',
  'what',
  'when',
  'why',
  'how',
  'the',
  'and',
  'for',
  'ai',
  'llm',
  'llms',
  'model',
  'models',
  'agent',
  'agents',
  'agentic',
  'build',
  'building',
  'using',
  'guide',
  'tutorial',
  'explained',
  'into',
  'more',
  'just',
  'now',
  'you',
  'are',
  'part',
  'full',
  'live',
  'new',
  'best',
  'code',
  'coding',
  'data',
  'open',
  'local',
]);

/** Tokens a title contributes to the re-upload test. */
function titleTokens(title: string): string[] {
  return (title.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((t) => !TITLE_STOPWORDS.has(t));
}

/**
 * How the re-upload test is tuned, and on what.
 *
 * Measured on the 2026-08-31 run (274 videos), counting how many of the pairs
 * each setting returns are genuinely the same talk:
 *
 *   rare<=3, shared>=2   8 pairs, 4 of them wrong
 *   rare<=3, shared>=3   4 pairs, 4 correct   <- this
 *   rare<=3, shared>=4   1 pair,  3 missed
 *   rare<=2, shared>=3   3 pairs, correct but misses a near-identical title
 *
 * The four it finds are three Korean-subtitled AI Engineer talks and one
 * channel that reposted another's title almost verbatim. Two shared rare
 * tokens is not enough: "Sandbox Escapes and RCE" and "Breaking Claude Code
 * Auto Mode - RCE" are different videos that share two.
 */
const REPUBLISH_TOKEN_MAX_FREQ = 3;
const REPUBLISH_SHARED_TOKENS_REQUIRED = 3;

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

    // How common is each subject in this corpus? A subject on more than a
    // quarter of the channels is the brief's vocabulary, not the week's event.
    const distinctChannels = new Set(input.map((v) => v.channelId)).size;
    const backgroundCutoff = Math.max(
      INDEPENDENT_CHANNELS_REQUIRED,
      Math.ceil(distinctChannels * BACKGROUND_SHARE)
    );
    const background = new Set(
      [...channelsBySubject.entries()]
        .filter(([, ch]) => ch.size > backgroundCutoff)
        .map(([term]) => term)
    );

    // ---- re-uploads ------------------------------------------------------
    //
    // The same talk appears twice when a channel republishes another's with
    // subtitles. The titles share no words — one is a translation — but they
    // share the speaker and the company, and those are rare tokens. Two rare
    // tokens in common, from different channels, is a re-upload; the earlier
    // publication is the original and the later one is marked.
    //
    // Not a drop. A Korean-subtitled version is the more useful of the pair
    // for half this brief's readers. It is recorded so S7 can decline to
    // print both, which is what it would otherwise have done: the first run
    // put a 152-view re-upload at the top of the picks while the original sat
    // in the corpus unused.
    const tokenFreq = new Map<string, number>();
    for (const v of input) {
      for (const t of new Set(titleTokens(v.title))) {
        tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);
      }
    }
    const rareTokensByVideo = new Map<string, Set<string>>();
    for (const v of input) {
      rareTokensByVideo.set(
        v.videoId,
        new Set(
          titleTokens(v.title).filter((t) => (tokenFreq.get(t) ?? 0) <= REPUBLISH_TOKEN_MAX_FREQ)
        )
      );
    }

    const byDate = [...input].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
    const republishOf = new Map<string, string>();
    for (let i = 0; i < byDate.length; i++) {
      const later = byDate[i] as CorpusRow;
      const lt = rareTokensByVideo.get(later.videoId) ?? new Set<string>();
      if (lt.size < REPUBLISH_SHARED_TOKENS_REQUIRED) continue;
      for (let j = 0; j < i; j++) {
        const earlier = byDate[j] as CorpusRow;
        if (earlier.channelId === later.channelId) continue;
        const et = rareTokensByVideo.get(earlier.videoId) ?? new Set<string>();
        let shared = 0;
        for (const t of lt) if (et.has(t)) shared += 1;
        if (shared >= REPUBLISH_SHARED_TOKENS_REQUIRED) {
          republishOf.set(later.videoId, earlier.videoId);
          break;
        }
      }
    }

    const survivors = input.map((v) => {
      const subjects = subjectsByVideo.get(v.videoId) ?? [];
      const corroborated = subjects
        .map((term) => ({ term, channels: channelsBySubject.get(term)?.size ?? 0 }))
        .filter((t) => t.channels >= INDEPENDENT_CHANNELS_REQUIRED && !background.has(t.term))
        // Most specific first. The broadest subject a video touches says the
        // least about it; the narrowest one several channels also covered is
        // the reason it belongs in this week's issue.
        .sort((a, b) => a.channels - b.channels);

      return {
        videoId: v.videoId,
        corroboration: {
          terms: subjects,
          corroborated,
          background: subjects.filter((t) => background.has(t)),
          strongest: corroborated[0]?.term ?? null,
          independentChannels: corroborated[0]?.channels ?? 0,
          republishOf: republishOf.get(v.videoId) ?? null,
        },
      };
    });

    // The week's shape: subjects several independent channels covered, with
    // the background this brief always talks about removed.
    const events = [...channelsBySubject.entries()]
      .map(([term, channels]) => ({ term, channels: channels.size }))
      .filter((e) => e.channels >= INDEPENDENT_CHANNELS_REQUIRED && !background.has(e.term))
      .sort((a, b) => b.channels - a.channels);

    return {
      survivors,
      drops: [],
      detail: {
        rule: `a subject needs ${INDEPENDENT_CHANNELS_REQUIRED} independent channels to be written as fact`,
        backgroundCutoff,
        background: [...background],
        subjectsClearingBar: events.length,
        republishesFound: republishOf.size,
        top: events.slice(0, 15),
      },
    };
  },
};
