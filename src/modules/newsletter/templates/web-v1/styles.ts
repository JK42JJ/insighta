/**
 * web-v1 stylesheet, lifted verbatim from the Claude Design deliverable.
 *
 * Two wiring changes only, both noted where they occur -- the visual
 * design is not this file's author's to alter (James: 디자인은 직접 하지 마):
 *   1. the Pretendard CDN <link> is gone; see FONT_LINKS in index.ts
 *   2. a dark palette was appended; the light tokens are untouched
 */
export const WEB_V1_CSS = String.raw`
/* ============================================================
   INSIGHTA WEEKLY BRIEF — REPEATABLE TEMPLATE
   ------------------------------------------------------------
   디자인 언어: "장부(ledger)". 매주 같은 편집자가 수치를
   측정하고 등급을 매겨 배달하는 편집물. 신문의 반복성 +
   회계장부의 규율. AI 기본값(크림/세리프/테라코타) 폐기.

   매주 바뀌는 슬롯 = [[SLOT]] 주석으로 표시.
   컴포넌트는 6종으로 고정. 새 호에서 새 컴포넌트 추가 금지.
   ============================================================ */

:root{
  /* -- ink & paper: 차가운 종이 위 검정 잉크, 크림 아님 -- */
  --paper:#FCFCFB;         /* near-white, 미세한 웜 0 */
  --paper-sunk:#F4F4F1;    /* 패널/장부 바닥 */
  --ink:#191A1C;           /* 본문 잉크 */
  --ink-soft:#54565B;      /* 부제·설명 */
  --ink-faint:#8B8D93;     /* 캡션·라벨 */
  --rule:#E4E4DF;          /* 얇은 괘선 */
  --rule-strong:#1C1D1F;   /* 스테이지 경계 (잉크) */

  /* -- 단 하나의 기능색: 등급 체계 (장식 아님, 의미 전용) -- */
  --verified:#2C6B4F;      /* 확인 — 짙은 청록(장부 검인) */
  --observed:#3E5C86;      /* 관측 — 슬레이트 */
  --unconf:#A8412B;        /* 미확인 — 벽돌 (경고 아님, 등급) */
  --measure:#8A6D1E;       /* 수치 강조 — 황토 */

  --maxw:720px;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{
  margin:0;background:var(--paper);color:var(--ink);
  font-family:"Pretendard Variable",Pretendard,-apple-system,system-ui,sans-serif;
  font-size:16.5px;line-height:1.82;letter-spacing:-.012em;
  word-break:keep-all;overflow-wrap:break-word;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 24px 88px}
a{color:inherit;text-decoration:none}

/* 상단 장부 인덱스 테이프 — 시그니처 요소 */
.tape{
  position:sticky;top:0;z-index:10;
  background:var(--rule-strong);color:var(--paper);
  font-family:"Spline Sans Mono",monospace;font-size:10.5px;
  letter-spacing:.13em;text-transform:uppercase;
  display:flex;gap:22px;justify-content:center;padding:7px 24px;
  white-space:nowrap;overflow-x:auto;scrollbar-width:none;
}
.tape::-webkit-scrollbar{display:none}
.tape span{opacity:.55}
.tape b{font-weight:500;opacity:1}

/* ---------- 1. MASTHEAD ---------- */
.mast{padding:44px 0 0}
.mast .kolophon{
  font-family:"Spline Sans Mono",monospace;font-size:11px;
  letter-spacing:.16em;text-transform:uppercase;color:var(--ink-faint);
  display:flex;justify-content:space-between;align-items:baseline;
  padding-bottom:13px;border-bottom:2px solid var(--rule-strong);
}
.mast .kolophon b{color:var(--ink);font-weight:600;letter-spacing:.2em}
h1{
  font-family:"Newsreader",serif;font-weight:560;font-style:normal;
  font-size:clamp(33px,6.2vw,52px);line-height:1.12;letter-spacing:-.02em;
  margin:30px 0 0;
}
.dek{margin:22px 0 0;font-size:18px;line-height:1.8;color:var(--ink-soft)}
.dek b{color:var(--ink);font-weight:600}
.runline{
  margin:24px 0 0;padding-top:14px;border-top:1px solid var(--rule);
  font-family:"Spline Sans Mono",monospace;font-size:11px;
  letter-spacing:.02em;color:var(--ink-faint);line-height:1.7;
}

/* ---------- 2. STAGE HEADER (반복) ---------- */
.stage{margin:64px 0 0}
.stage-bar{
  display:flex;align-items:baseline;gap:14px;
  padding-bottom:11px;border-bottom:2px solid var(--rule-strong);
}
.stage-no{
  font-family:"Newsreader",serif;font-size:15px;font-weight:560;
  font-variant-numeric:tabular-nums;color:var(--ink);
}
.stage-name{
  font-family:"Spline Sans Mono",monospace;font-size:12px;font-weight:600;
  letter-spacing:.22em;text-transform:uppercase;
}
.stage-sub{font-size:13px;color:var(--ink-faint);margin-left:auto;letter-spacing:0}
@media(max-width:520px){.stage-sub{display:none}}

/* ---------- 3. LEDGER (수치판, 반복 핵심) ---------- */
.led-cap{
  margin:24px 0 10px;font-family:"Spline Sans Mono",monospace;
  font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-faint);
}
.ledger{border-top:1.5px solid var(--rule-strong)}
.led-row{
  display:grid;grid-template-columns:1fr 168px;gap:20px;
  padding:18px 0;border-bottom:1px solid var(--rule);
}
@media(max-width:540px){.led-row{grid-template-columns:1fr;gap:8px}}
.led-name{font-size:15.5px;font-weight:600;letter-spacing:-.012em;line-height:1.5}
.led-desc{margin:6px 0 0;font-size:13.5px;line-height:1.66;color:var(--ink-soft)}
.led-val{text-align:right}
@media(max-width:540px){.led-val{text-align:left}}
.led-val b{
  font-family:"Spline Sans Mono",monospace;font-size:18px;font-weight:600;
  letter-spacing:-.02em;display:block;font-variant-numeric:tabular-nums;
}
.led-val b.up{color:var(--unconf)} .led-val b.hot{color:var(--measure)}
.led-val i{
  font-style:normal;display:block;margin-top:5px;font-size:11.5px;
  line-height:1.55;color:var(--ink-faint);
}

/* ---------- 4. FUNNEL (그림, 반복) ---------- */
.panel{background:var(--paper-sunk);padding:22px;margin:16px 0 0}
.waffle{display:grid;grid-template-columns:repeat(17,1fr);gap:3px;margin:0 0 16px}
@media(max-width:520px){.waffle{grid-template-columns:repeat(12,1fr)}}
.c{display:block;width:100%;aspect-ratio:1;border-radius:1px}
.c.f{background:#DCDBD3}.c.r{background:#B9B6A9}.c.s{background:#8894A6}.c.x{background:var(--verified)}
.legend{display:grid;grid-template-columns:1fr 1fr;gap:9px 20px;margin-top:2px}
@media(max-width:520px){.legend{grid-template-columns:1fr}}
.lg{display:flex;gap:9px;font-size:13px;line-height:1.5;color:var(--ink-soft)}
.sw{width:10px;height:10px;flex:0 0 10px;margin-top:5px;border-radius:1px}
.lg em{font-style:normal;font-family:"Spline Sans Mono",monospace;font-weight:600;color:var(--ink);margin-right:6px;font-variant-numeric:tabular-nums}
.cap{margin:14px 0 0;padding-top:11px;border-top:1px solid var(--rule);font-size:12px;line-height:1.65;color:var(--ink-faint)}

/* ---------- 5. STORY (반복) ---------- */
.story{margin:38px 0 0}
.story:first-of-type{margin-top:26px}
.kicker{
  font-family:"Spline Sans Mono",monospace;font-size:11px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--ink-faint);margin:0 0 8px;
  display:flex;align-items:baseline;gap:9px;
}
.kicker .n{color:var(--ink);font-weight:600}
h2{
  font-family:"Newsreader",serif;font-weight:560;
  font-size:clamp(23px,4vw,30px);line-height:1.28;letter-spacing:-.015em;margin:0;
}
h3{font-size:14.5px;font-weight:600;letter-spacing:-.008em;margin:28px 0 0;color:var(--ink)}
h3::before{content:"§ ";color:var(--ink-faint);font-family:"Spline Sans Mono",monospace;font-size:12px}
.story p{margin:14px 0 0}
.lede{font-size:17.5px;line-height:1.78;margin-top:16px}
strong{font-weight:600}
em.term{font-style:italic;font-family:"Newsreader",serif;font-size:1.03em}

/* 등급 인라인 칩 — 의미 전용, 장식 아님 */
.g{
  display:inline-block;font-family:"Spline Sans Mono",monospace;font-size:9.5px;
  font-weight:600;letter-spacing:.08em;padding:1.5px 5px;margin-left:5px;
  border:1px solid currentColor;border-radius:2px;vertical-align:.12em;white-space:nowrap;
}
.g.v{color:var(--verified)}.g.o{color:var(--observed)}.g.u{color:var(--unconf)}
sup.ref{font-family:"Spline Sans Mono",monospace;font-size:9.5px;color:var(--observed);font-weight:600;vertical-align:super;line-height:0;margin-left:1px}

/* 편집자 콜아웃 — 하나의 컴포넌트, variant로 통일 */
.note{
  margin:22px 0 0;padding:16px 18px;background:var(--paper-sunk);
  border-left:3px solid var(--ink);font-size:15px;line-height:1.72;color:var(--ink-soft);
}
.note b{color:var(--ink);font-weight:600}
.note.warn{border-left-color:var(--unconf)}

/* 표 — 장부와 같은 잉크 규율 */
.tbl{width:100%;border-collapse:collapse;margin:18px 0 0;font-family:"Spline Sans Mono",monospace;font-size:13px}
.tbl th{text-align:left;font-weight:600;font-size:10px;letter-spacing:.11em;text-transform:uppercase;color:var(--ink-faint);border-bottom:1.5px solid var(--rule-strong);padding:0 10px 8px 0}
.tbl td{padding:11px 10px 11px 0;border-bottom:1px solid var(--rule);vertical-align:top;font-variant-numeric:tabular-nums}
.tbl td:first-child{font-family:"Pretendard Variable",Pretendard,sans-serif;color:var(--ink-soft)}
.tbl .n{text-align:right;white-space:nowrap}

/* ---------- 6. ROWS (todo / picks / next / terms — 하나의 행 문법) ---------- */
.rows{margin:20px 0 0;border-top:1px solid var(--rule)}
.item{padding:16px 0;border-bottom:1px solid var(--rule)}
.item-h{display:flex;gap:14px;align-items:baseline}
.item-tag{
  font-family:"Spline Sans Mono",monospace;font-size:10.5px;letter-spacing:.08em;
  color:var(--ink-faint);flex:0 0 auto;text-transform:uppercase;
}
.item-when{
  font-family:"Spline Sans Mono",monospace;font-size:10.5px;letter-spacing:.06em;
  color:var(--measure);font-weight:600;flex:0 0 78px;
}
.item-title{font-size:15.5px;font-weight:600;line-height:1.5;letter-spacing:-.01em}
.item-title .en{font-family:"Newsreader",serif;font-weight:400}
.item-meta{margin:5px 0 0;font-family:"Spline Sans Mono",monospace;font-size:11px;letter-spacing:.02em;color:var(--ink-faint)}
.item-body{margin:7px 0 0;font-size:14.5px;line-height:1.68;color:var(--ink-soft)}
.item-body.indent{padding-left:92px}
@media(max-width:520px){.item-body.indent{padding-left:0}}

/* 용어 */
.term-word{font-size:16px;font-weight:600}
.term-word .en{font-family:"Spline Sans Mono",monospace;font-size:11.5px;font-weight:400;color:var(--ink-faint);margin-left:8px;letter-spacing:.02em}
.term-use{margin:8px 0 0;padding-left:12px;border-left:2px solid var(--rule);font-size:14px;line-height:1.66;color:var(--ink);font-style:italic}

/* ---------- FOOT ---------- */
.foot{margin:56px 0 0;padding-top:22px;border-top:2px solid var(--rule-strong);font-size:12.5px;line-height:1.8;color:var(--ink-faint)}
.foot b{color:var(--ink-soft);font-weight:600}
.srclist{counter-reset:s;list-style:none;margin:16px 0 0;padding:0}
.srclist li{counter-increment:s;display:flex;gap:11px;padding:7px 0;font-size:12px;line-height:1.65;border-bottom:1px solid var(--rule)}
.srclist li::before{content:counter(s);font-family:"Spline Sans Mono",monospace;font-size:10px;font-weight:600;color:var(--observed);flex:0 0 16px;padding-top:2px}
.srclist a{color:var(--observed);border-bottom:1px solid var(--rule)}
.srclist b{color:var(--ink-soft);font-weight:600}
.editnote{margin:26px 0 0;padding:16px 18px;background:var(--paper-sunk);font-size:12.5px;line-height:1.75;color:var(--ink-faint)}
.editnote b{color:var(--ink-soft)}
.sign{
  margin:38px 0 0;padding-top:20px;border-top:1px solid var(--rule);
  font-family:"Newsreader",serif;font-style:italic;font-size:19px;
  letter-spacing:-.01em;color:var(--ink);
}

.figref{margin:22px 0 0;font-family:"Spline Sans Mono",monospace;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint)}

@media(prefers-reduced-motion:no-preference){
  .c{animation:pop .4s ease both}
  @keyframes pop{from{opacity:0}to{opacity:1}}
}
:focus-visible{outline:2px solid var(--observed);outline-offset:2px}

/* ------------------------------------------------------------------
   Dark palette. Tokens only -- every rule above reads through var(),
   so nothing here restates a component.

   Three states, not two: an explicit choice stamps data-theme on the
   root, and the default "system" setting stamps nothing at all, so the
   media query has to carry the un-stamped case on its own. It is
   guarded with :not([data-theme="light"]) so an explicit light choice
   still wins under a dark OS.

   The grade colours are lightened rather than reused: --verified at
   #2C6B4F on a near-black ground fails contrast, and these three carry
   meaning (확인/관측/미확인), so losing them loses the argument.
   ------------------------------------------------------------------ */
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --paper:#111214;
    --paper-sunk:#191B1E;
    --ink:#E8E8E5;
    --ink-soft:#A9ABB0;
    --ink-faint:#75777D;
    --rule:#2A2C30;
    --rule-strong:#E8E8E5;
    --verified:#5FA783;
    --observed:#7C9BC9;
    --unconf:#D97D63;
    --measure:#C9A94E;
  }
}
:root[data-theme="dark"]{
  --paper:#111214;
  --paper-sunk:#191B1E;
  --ink:#E8E8E5;
  --ink-soft:#A9ABB0;
  --ink-faint:#75777D;
  --rule:#2A2C30;
  --rule-strong:#E8E8E5;
  --verified:#5FA783;
  --observed:#7C9BC9;
  --unconf:#D97D63;
  --measure:#C9A94E;
}

/* The tape inverts with the palette: it paints --rule-strong as its
   ground and --paper as its text, which swap roles in dark. Restated
   so the bar keeps reading as a bar rather than as white-on-white. */
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]) .tape{background:#1D1F23;color:var(--ink)}
}
:root[data-theme="dark"] .tape{background:#1D1F23;color:var(--ink)}

/* Funnel cells are literals in the design (they encode bucket sizes,
   not theme), so they need their own dark values. */
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]) .c.f{background:#2E3034}
  :root:not([data-theme="light"]) .c.r{background:#43464C}
  :root:not([data-theme="light"]) .c.s{background:#5A6472}
}
:root[data-theme="dark"] .c.f{background:#2E3034}
:root[data-theme="dark"] .c.r{background:#43464C}
:root[data-theme="dark"] .c.s{background:#5A6472}
`;
