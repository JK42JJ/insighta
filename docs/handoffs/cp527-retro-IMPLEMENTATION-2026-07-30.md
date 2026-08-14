# CP527 /retro — 구현 핸드오프 (다음 CC 가 바로 칠 것)

**상태:** 적용 0건. 아래는 **그대로 실행하면 되는 명세**다.
**순서 고정:** 2 → 1 → 4 → 3. (4 를 3 보다 먼저 — 아니면 3 이 "또 하나의 표면 룰"이 된다.)
**배경/진단:** `docs/handoffs/cp527-retro-design-2026-07-30.md`. 이 문서는 그 설계의 **집행 명세**다.

모든 경로는 절대경로다. `M=~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory`

---

# 작업 2 — 원장 게이트 (★ 최우선, 4연속 실패)

## 왜 지금 것이 못 잡는가 (읽고 시작할 것)

`.claude/commands/init.md:276-292` 의 6c-0 은 **두 원장의 최신 CP 번호가 같은지**만 본다:

```bash
[ "$LOG" = "$EV" ] || echo "LEDGER GAP: ..."
```

사후 등재로 양쪽을 동시에 채우면 번호가 일치 → **통과**. 결손을 메우는 행위가 검출을 무력화한다.
`.claude/commands/save.md:303-312` 의 assert 는 **`/save` 안에서만** 돈다 → `/save` 없이 끝난 세션에는 정의상 도달 못 한다.

**둘 다 자기참조 실패다. 그래서 4연속(CP522·525·526·527) 통과했다.**

## 2-A. `/init` 이 세션 시작에 open 행을 만든다

**파일:** `/Users/jeonhokim/cursor/insighta/.claude/commands/init.md`
**편집 지점:** `### Phase 7: Scheduled Jobs (auto-registration)` (307행) **바로 앞**에 새 Phase 삽입.

**삽입할 내용:**

~~~markdown
### Phase 6d: Open the ledger row for THIS session (CP527 /retro #2)

The two ledgers are written at `/save`. A session that ends without `/save`
leaves nothing — and CP522·CP525·CP526·CP527 all ended that way. The fix is not
another check inside `/save`; it is to write the row **now**, so its absence at
the next boot is impossible and its incompleteness is visible.

Determine `{N}` = last epoch number + 1 (from Phase 3's checkpoint tail).

```bash
M=~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory
N={N}                      # e.g. 528
D=$(date +%Y-%m-%d)
# Idempotent: re-running /init in the same session must not add a second row.
grep -qE "^\| CP$N \|" "$M/eval-scores.md" || \
  printf '| CP%s | %s | — | — | — | — | — | — | **open** — 세션 진행 중. /save 가 확정한다. |\n' "$N" "$D" >> "$M/eval-scores.md"
grep -qE "^\| $D \| CP$N \|" "$M/session-log.md" || \
  printf '| %s | CP%s | open | — | — | — | — | **open** — 세션 진행 중 | — |\n' "$D" "$N" >> "$M/session-log.md"
echo "LEDGER OPENED CP$N"
```

Output one line in the boot summary: `Ledger: CP{N} opened`.
~~~

## 2-B. 6c-0 을 "번호 일치" 에서 "직전 행 상태" 로 교체

**파일:** 같은 파일
**교체 범위:** 276행 `**6c-0. Eval row contiguity check ...` 부터 292행(292행 = `- **Why mechanical, not prose**: ...` 로 끝나는 줄)까지 **전체**. 293행 `**6c. Eval history review...` 은 건드리지 않는다.

**교체 후 내용:**

~~~markdown
**6c-0. Ledger state check (CP527 /retro #2 — replaces the contiguity check) — run FIRST, before any trend math**:

The previous version compared the newest CP number in each ledger and passed
when they matched. Backfilling both by hand makes them match, so the very act of
papering over a gap defeated the detector — four sessions in a row went through
that door. What matters is not whether a row exists but whether it was written
live and closed.

```bash
M=~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory
LAST=$(grep -E "^\| CP[0-9]+ \|" "$M/eval-scores.md" | tail -1)
echo "$LAST" | grep -qE '\*\*open\*\*' && echo "🚨 LEDGER OPEN: 직전 세션이 /save 없이 종료 — $(echo "$LAST" | cut -d'|' -f2)"
echo "$LAST" | grep -qE '사후 등재|backfill'   && echo "⚠️  LEDGER BACKFILL: 직전 에폭이 사후 등재 — $(echo "$LAST" | cut -d'|' -f2)"
# 사후등재 연속 카운트
grep -E "^\| CP[0-9]+ \|" "$M/eval-scores.md" | tail -5 | grep -c '사후 등재\|backfill' | xargs echo "backfill in last 5:"
```

- **`LEDGER OPEN`** → 🚨 **BLOCKING**. 직전 세션이 `/save` 없이 끝났다. 출력 상단에 아래를 넣고 답을 받기 전 "Ready" 선언 금지:
  `"직전 세션 CP{N} 이 원장 open 상태로 종료. (a) 지금 핸드오프/커밋 기록으로 채워 close / (b) 미채점 확정(사후 등재 표기) — 답 1줄."`
- **`backfill in last 5` ≥ 2** → 🚨 **BLOCKING**:
  `"원장 사후등재 N연속. (a) 원인 규명 후 진행 / (b) 공식 포기 — 답 1줄."`
- 사후 등재로 채운 행은 반드시 `사후 등재` 문자열을 포함시킨다. 그것이 이 검사의 입력이다.
~~~

## 2-C. `/save` 가 open 행을 close 로 바꾼다

**파일:** `/Users/jeonhokim/cursor/insighta/.claude/commands/save.md`
**교체 범위:** 303행부터 312행(`   - \`LEDGER MISSING\` 이면 ...` 로 끝나는 줄)까지.

**교체 후 내용:**

~~~markdown
10. **Ledger close assert — 기계 검증, /save 종료 전 필수 (CP527 /retro #2 — CP526+1 assert 대체)**:
   - 이전 버전은 "행이 존재하는가"를 봤고, 그 검사는 `/save` 안에 있어서 `/save` 를 실행하지 않는 세션에는 도달하지 못했다. 이제 행은 `/init` Phase 6d 가 **open** 으로 미리 만든다. `/save` 의 일은 그것을 **close** 하는 것이고, 이 assert 는 close 됐는지 본다.
   ```bash
   M=~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory
   N={N}
   grep -E "^\| CP$N \|" "$M/eval-scores.md" | grep -q '\*\*open\*\*' \
     && echo "🚨 LEDGER STILL OPEN CP$N — 점수/요약으로 교체 후 재실행" \
     || { grep -qE "^\| CP$N \|" "$M/eval-scores.md" \
          && grep -qE "\| CP$N \|" "$M/session-log.md" \
          && echo "LEDGER CLOSED CP$N" || echo "🚨 LEDGER MISSING CP$N"; }
   ```
   - `LEDGER STILL OPEN` / `LEDGER MISSING` 이면 /save 완료 선언 금지. 핸드오프·MEMORY 갱신은 대체물이 아니다.
   - `/init` 이 행을 만들지 못한 경우(구버전 부팅 등)에도 이 단계에서 새로 작성하면 된다.
~~~

## 2-D. 검증 — **이걸 통과해야 "적용 완료"다**

```bash
M=~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory
cp "$M/eval-scores.md" /tmp/eval.bak

# (1) negative control: open 행을 만들고 6c-0 이 잡는지
printf '| CP999 | 2026-01-01 | — | — | — | — | — | — | **open** — test |\n' >> "$M/eval-scores.md"
LAST=$(grep -E "^\| CP[0-9]+ \|" "$M/eval-scores.md" | tail -1)
echo "$LAST" | grep -qE '\*\*open\*\*' && echo "PASS: open detected" || echo "FAIL: not detected"

# (2) close 하면 통과하는지
sed -i '' 's/| CP999 |.*|$/| CP999 | 2026-01-01 | 0.8 | 0.8 | 0.8 | 0.8 | 0.8 | 0.80 | closed test |/' "$M/eval-scores.md"
LAST=$(grep -E "^\| CP[0-9]+ \|" "$M/eval-scores.md" | tail -1)
echo "$LAST" | grep -qE '\*\*open\*\*' && echo "FAIL: still flagged" || echo "PASS: closed row passes"

cp /tmp/eval.bak "$M/eval-scores.md"   # 복원 필수
```

**두 PASS 를 보기 전에는 완료라고 쓰지 말 것.** 편집이 안착한 것과 게이트가 발화하는 것은 다르다 — CP527 이 정확히 그 착각으로 실패했다.

**롤백:** `init.md`/`save.md` 는 git tracked. `git checkout -- .claude/commands/init.md .claude/commands/save.md`

---

# 작업 1 — CP527 실채점

**파일:** `~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/eval-scores.md`
**대상:** 429행. 현재 `| CP527 | 2026-07-30 | — | — | — | — | — | — | **사후 등재 ...` 로 시작하는 행 **전체를 교체**.

**교체할 행 (한 줄로 붙여 넣을 것):**

```
| CP527 | 2026-07-30 | 0.80 | 0.28 | 0.90 | 0.82 | 0.45 | 0.65 | **다이얼 가로 안전영역 종결 9 PR(#1412~#1420, build 62→70) — 실시간 관측 기반 채점(CP527+2 정정: 원 placeholder 는 no-partial-data 룰 오적용. CP522/525/526 과 달리 이 세션은 전 과정 관측됨. 원장 자기기록 0 은 D4 감점 사유이지 채점 회피 사유가 아니다).** D1 0.80: 초장기·컴팩션 관통, 스크린샷 14+장 측정 일관 유지 — 감점 = 자기 모델 3회 전복(오프셋 258/절반 오산 포함, 자가정정). **D2 0.28 (★marker, floor breach)**: base 0.40 × 0.7(family recurrence 4회차: CP521 추측상수→CP523 기기blind→CP524 무료툴벽→CP527 환경미재현) — **7배포 6실패**. 핵심은 코드가 아니라 검증: 증상이 `body.standalone` 전용인데 프로브가 7번째까지 그 클래스를 안 붙임 = **실패 불가능한 검증을 6회 "통과"로 보고**(James "또 사기치네"). + 재발명 2건(휠 소환·포스터 프로브 — 같은 파일 3함수 거리, CP519 dead-code family). offset: 최종 근본원인 확정(viewport-fit 인셋 전파), 매 실패 즉시 인정, 알리바이 표현 자기고발. **D3 0.90**: 하드룰 1 신설([[feedback-two-behaviours-means-state-not-offset]]) + 구조 발견 4건을 **전부 코드/게이트로 결박**(`:root` 컬러웨이 · check-dial orphan-token 게이트 + negative control 증명) + `docs/releases/` 0→10 tracked 해소(07-02 컨벤션 후 첫 커밋). **D4 0.82**: 핸드오프 2종 tracked 안착 · 릴리즈노트 리포 첫 커밋 · MEMORY 갱신 · 룰 파일 틀린 수치 정정 — 감점 = 원장 2종 자기기록 0(사후 등재). **D5 0.45**: 9 PR 출하 + prod 실측 — but 헛배포 6회 · CI `sleep 200~280` 블로킹 8회+ · 로컬 dev 삽질(node_modules/vite/webkit 전부 실패). Hard Rule: 0 LLM API / 0 .env / prod DB 무변경(FE 중심) / GitHub 영문 준수. vs CP525(0.72): −0.07. |
```

**추가 작업:** D2 = 0.28 ≤ 0.55 → marker 파일 기록.

```bash
M=~/.claude/projects/-Users-jeonhokim-cursor-insighta/memory
printf '{"epoch":"CP527","d2":0.28,"reason":"실패 불가능한 검증 6회 통과 보고 + 재발명 2건 (family recurrence 4회차)"}\n' > "$M/.d2-blocking"
```

**MEMORY.md 정합:** `## Eval Trend` 섹션의 3-MA 를 다시 계산해 갱신 — CP525 0.72 · CP526 N/A · CP527 0.65 → 2행 평균 **0.685** (CP526 은 미채점이므로 제외, 그 사실을 한 줄로 명시).

**검증:**
```bash
grep -c "^| CP527 | 2026-07-30 | 0.80" "$M/eval-scores.md"   # 1 이어야
cat "$M/.d2-blocking"
```

---

# 작업 4 — 신규 룰 前 발화 실패 분석 필수

**파일:** `/Users/jeonhokim/cursor/insighta/.claude/commands/retro.md`
**편집 지점:** `### Step 5: Generate Improvement Suggestions` 의 **맨 앞**(“Based on analysis results…” 문장 앞)에 삽입.

**삽입할 내용:**

~~~markdown
**Step 5 전제 — 발화 실패 분석 (CP527 /retro #4, 신규 룰 제안 前 필수)**

룰 커버리지 88%, 발화율 0% (CP526 실측). 부족한 것은 룰이 아니라 발화다. 신규 룰을 하나 더 얹으면 커버리지만 오르고 발화는 그대로다.

이번 세션 위반 각각에 대해 아래 표를 먼저 채운다. **표를 채우기 전에는 어떤 신규 룰도 제안하지 않는다.**

| 위반 | 막았어야 할 기존 룰 | 발화했나 | 실패 사유 |
|---|---|---|---|

실패 사유는 넷 중 하나로 적는다:
- `읽지 않음` → /init 로드 목록 문제
- `표면 인지 실패` → 룰이 특정 사건 표면으로 좁게 쓰임 → **신규 룰 금지, 기존 룰의 범위를 넓힌다**
- `인지했으나 무시` → 기계 게이트로 승격
- `해당 룰 없음` → **이때만 신규 룰 제안 가능**

CP527 실례: 위반 "환경 미재현 검증"의 기존 룰 = `feedback_device_verify_no_blind_deploy`(CP523). 발화 실패 사유 = **표면 인지 실패**(그 룰은 "기기"라고 쓰여 있고 이번 표면은 "설치앱 클래스"였다). → 신규 룰이 아니라 CP523 룰의 범위 확장이 정답이었다.
~~~

**검증:** `grep -n "발화 실패 분석" .claude/commands/retro.md` → 1건.

---

# 작업 3 — "이미 있나" 를 same-behaviour 로 확장

**작업 4 를 먼저 적용한 뒤 착수할 것.** 4의 표를 채우면 이 항목이 **신규 룰이 아니라 기존 `dead-code first-pass` 룰의 확장**으로 처리되어야 함이 드러난다.

**파일:** `/Users/jeonhokim/cursor/insighta/CLAUDE.md`
**편집 지점:** `### 추측 전 소스 읽기` 항목의 bullet 목록 중 **`Dead-code first-pass: wiring 前 consumer-count grep (CP521 sub-rule…)`** 로 시작하는 줄을 찾아, 그 줄 **끝에** 아래를 이어 붙인다(새 bullet 이 아니라 같은 항목의 확장).

**이어 붙일 문장:**

```
**확장 (CP527): consumer-count 는 "이 심볼을 쓰는 곳"만 본다. 그 앞에 "같은 일을 하는 것이 이미 있나"를 먼저 본다** — 새 함수·CSS 규칙·상태관리를 작성하기 前, 같은 파일에서 **하는 일(동사)** 로 grep 한다(`summon|show|probe|fallback|retry|resize|relayout|poster|thumb` 등). 심볼 이름으로 찾으면 이름이 다를 때 빗나간다. 발견 시 그것을 쓰고, 못 쓰는 이유가 있으면 PR 설명에 1줄로 적는다. 근거: CP527 재발명 2건 — 휠 소환(`wz.addEventListener('pointerdown', …cdWheelShow())` 기존재, James "이미 있는데 또 만들면서 코드가 개판됐을꺼야")·포스터 프로브(`cdBestPoster` 의 `naturalWidth` 플레이스홀더 필터 기존재) — **둘 다 같은 파일 3함수 거리, 둘 다 새로 만든 쪽이 회귀 유발**.
```

**검증:** `grep -c "확장 (CP527)" CLAUDE.md` → 1.

---

# 완료 보고 양식 (그대로 쓸 것)

```
작업 2: init.md Phase 6d 삽입 / 6c-0 교체 / save.md Step 10 교체
        negative control — open 검출 PASS·close 통과 PASS   ← 둘 다 없으면 미완료
작업 1: eval-scores CP527 채점(0.65, D2 .28) / .d2-blocking 기록 / MEMORY 3-MA 갱신
작업 4: retro.md Step 5 전제 삽입
작업 3: CLAUDE.md dead-code 항목 확장
```

**금지:** 편집이 들어갔다는 것만으로 "완료" 라고 쓰지 말 것. 작업 2 는 **게이트가 발화하는 것을 본 뒤에만** 완료다.

---

# 함께 넘어가는 미결 (이 4건과 별개)

| 항목 | 상태 | 다음 행동 |
|---|---|---|
| 개인정보처리방침 갱신 | 커밋 `d1955f96` **원격에 없음**(verify 게이트가 push 차단) → 패치 보존 `memory/pending-privacy-subscriptions.patch` (13,789 bytes) | `git am < 그 파일` 후 James 결정 — (a) push / (b) 다음 프론트 세션 병합 |
| `feat/dial-native-motion` | 원격 있음(`828ceb9c`), **미머지** | 화면전환 무게감. **모션 미검증** — 백그라운드 탭에서 CSS transition 미진행, 정적 규칙만 확인. 기기 확인 후 머지 |
| trend judge prod backfill | session-log 에 "07-30 실측 NULL 0 = 기해소" 기재 — **CC 가 확인한 것이 아님** | 프로드에서 직접 재확인 (`judge_state` NULL 카운트) |
