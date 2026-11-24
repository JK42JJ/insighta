/*
 * Landing v4 text ("Insighta Intro v4.dc.html", 2026-11-24), as written in the design. Changes
 * from the design, decided by James:
 *   - scene 4 text: spacing fixed ("관심 있는", "자세한 건", "만들어집니다.")
 *   - both Google buttons: "Google로 계속하기" (Google branding rule, Slack R46)
 * Example brief data (headline, channels, video titles, times) is in landing-example.ts.
 */

export const BRAND = 'Insighta';
export const LOGIN_LABEL = '로그인';

/** Scene 1 (s=0): title lines, sub line, swipe hint. */
export const S0_TITLE = ['작은 습관 하나로', '문해력을', '키워갈 수 있어요'] as const;
export const S0_BODY = '단지 그날의 관심 헤드라인을 고르는 것으로 가능합니다.';
export const SWIPE_HINT = '위로 밀어 보세요';
/** Deck card kicker before the domain. */
export const BRIEF_KICKER = '오늘의 브리프';

/** Scene 2 (s=1). */
export const S1_TEXT =
  '그런데 혼자서는 쉽지 않아요. 제목과 썸네일만으로는 무슨 내용인지 알기 어렵고, 믿을 만한 영상인지는 끝까지 봐야 알 수 있거든요.';
/** Scene 3 (s=2). */
export const S2_TITLE = ['오늘 볼 영상,', '미리 골라 뒀어요'] as const;
export const S2_BODY = '분야마다 의미 있는 최근 영상을 인사이타가 살펴봤어요.';
/** Scene 4 (s=3), James-confirmed spacing (2026-11-24). */
export const S3_TEXT =
  '관심 있는 글을 가볍게 읽어요. 자세한 건 영상으로 확인하면 맥락이 만들어집니다.';
/** Scene 5 before the source tap (s=4). */
export const S4_TEXT =
  '문장마다 어느 영상에서 나온 이야기인지 표시해 두었어요. 출처를 눌러 보세요.';
/** Scene 5 after the source tap (s=5). */
export const S5_TEXT = '영상이 그 부분부터 나와요. 읽은 내용이 맞는지 직접 확인해 보세요.';
/** Scene 6 (s=7). */
export const S7_LEAD = '방금 해 보신 것이 그 습관이에요.';
export const S7_TITLE = '왜곡 없는 정보를 지향합니다';
export const S7_BODY = '매일 아침 이렇게 읽고 확인할 수 있게 준비해 둘게요.';

/** The last sheet. */
export const DOMAINS_LEAD = '지금은 8개 분야에서 골라 드려요.';
export const DOMAINS = [
  '비즈니스/커리어',
  '재테크/투자',
  '학습/교육',
  '건강/피트니스',
  '인간관계/커뮤니티',
  '창작/예술',
  '라이프스타일/여행',
  '기술/개발',
] as const;
/** ADD's accessible name (the design draws a + only). */
export const ADD_LABEL = '분야 추가';
export const FINAL_LINE = 'Google 계정으로 로그인하면 오늘의 영상을 바로 볼 수 있어요.';

// James 2026-11-24 (Slack R46): Google's branding allows only Sign in / Sign up / Continue with Google and
// their translations, so the design's "Google로 시작하기" became the translation of "Continue with Google".
export const GOOGLE_LABEL = 'Google로 계속하기';
/** Footer: each opens its existing page content in a sheet over the landing (James 2026-11-24). */
export const PRIVACY = { label: '개인정보처리방침' } as const;
export const TERMS = { label: '이용약관' } as const;
/** The sheet's close button (accessible label). */
export const CLOSE_LABEL = '닫기';
/** YouTube attribution (YouTube API policy): wherever thumbnails are visible (decision 2026-11-24). */
export const YT_CREDIT = '영상 출처: YouTube';
/** Accessible names that are not drawn. */
export const DOT_LABEL = (n: number): string => `장면 ${n}`;
export const STAGE_LABEL = '인사이타 소개';
