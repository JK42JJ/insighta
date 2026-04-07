/**
 * preview-llm-extract — Phase 1.5a quality gate (CP352)
 *
 * Runs Mac Mini Ollama qwen3.5:9b on 5 sample YouTube Trending titles
 * and prints the extracted keywords + learning_score. Manual quality
 * check BEFORE the full trend-collector pipeline rewires.
 *
 * Per-user requirement: "LLM 키워드 추출 결과를 5건 먼저 출력해서 품질
 * 확인 후 전체 실행".
 *
 * Usage:
 *   npx tsx scripts/preview-llm-extract.ts
 *
 * The 5 sample titles below are taken verbatim from the smoke run that
 * exposed the keyword=title bug — same data, so the comparison is honest.
 */

import {
  extractKeywordsBatch,
  LlmExtractError,
} from '../src/skills/plugins/trend-collector/sources/llm-extract';

// 5 sample titles from the actual trend_signals snapshot taken on 2026-04-07.
// Mix of clickbait entertainment, ChatGPT how-to, news, K-content, and a
// politically charged title — covers the full quality spectrum.
const SAMPLE_TITLES: string[] = [
  '역대급 스카이 다이빙',
  '구라치는 챗gpt 사용법 개꿀팁 ㅋㅋㅋ',
  '강남 이상화 부부 일본 집에 놀러온 기안84',
  'KBS vs SBS, 누가 더 악질인가? 이재명 대통령을 향한 역대급 언론 공작의 실체',
  '김어준의 겸손은힘들다 뉴스공장 2026년 4월 7일 화요일',
];

async function main(): Promise<void> {
  console.log('=== LLM Keyword Extraction Quality Preview ===');
  console.log(`Model     : llama3.1:latest @ Mac Mini (100.91.173.17:11434)`);
  console.log(`Samples   : ${SAMPLE_TITLES.length}`);
  console.log('');

  const t0 = Date.now();
  let results;
  try {
    results = await extractKeywordsBatch({ titles: SAMPLE_TITLES });
  } catch (err) {
    if (err instanceof LlmExtractError) {
      console.error(`FAIL: LlmExtractError — ${err.message}`);
    } else {
      console.error('FAIL: unhandled error');
      console.error(err);
    }
    process.exit(1);
  }
  const wallMs = Date.now() - t0;

  console.log(`[wall] ${wallMs}ms total (${(wallMs / SAMPLE_TITLES.length).toFixed(0)}ms/title)`);
  console.log('');
  console.log('---');

  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const learnBar = '█'.repeat(Math.round(r.learning_score * 10)).padEnd(10, '·');
    console.log(`[${i + 1}] "${r.title}"`);
    console.log(`    keywords      : ${JSON.stringify(r.keywords)}`);
    console.log(`    learning_score: ${learnBar} ${r.learning_score.toFixed(2)}`);
    console.log('');
  }

  console.log('---');
  console.log('');
  console.log('Quality questions to answer manually:');
  console.log('  1. Are clickbait words ("역대급", "ㅋㅋㅋ") removed from keywords?');
  console.log('  2. Are keywords actual TOPIC nouns (not full title fragments)?');
  console.log('  3. Does learning_score correctly separate entertainment from learning?');
  console.log('     - "역대급 스카이 다이빙"        should be LOW  (~0.0–0.3)');
  console.log('     - "구라치는 챗gpt 사용법"        should be HIGH (~0.6–0.9)');
  console.log('     - "강남 이상화 부부 일본 집…"    should be LOW  (~0.0–0.3)');
  console.log('     - "KBS vs SBS …"                should be MID  (~0.4–0.6, 시사/정치)');
  console.log('     - "김어준 뉴스공장 …"            should be MID  (~0.4–0.6, 뉴스)');
  console.log('');
  console.log('If quality is acceptable: confirm "OK" to proceed with executor rewrite.');
  console.log('If quality is bad       : tell what to fix (prompt? model? schema?).');
}

main();
