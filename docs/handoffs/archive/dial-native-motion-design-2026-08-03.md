# 다이얼 화면 전환에 무게 주기 — 설계

**작성:** 2026-08-03 · **상태:** 구현 완료, **미머지·미검증**
**구현 위치:** 브랜치 `feat/dial-native-motion` (커밋 `828ceb9c`) — PR 미생성
**보고:** "다이얼에서 버튼이 앱이 아니라서 가벼운 느낌이 나고 불안정하다" (James)

---

## 1. 진단 — "버튼"이 아니라 화면 전환이다

버튼부터 조사했고, **버튼은 이미 앱 문법이었다.**

```
:active 규칙          38개
--snap:120ms          눌림 즉시 반응
--spring              cubic-bezier(.34,1.4,.64,1) — 오버슈트 복귀
```

가벼움의 출처는 화면 전환 **한 줄**이다 (`frontend/public/mobile/index.html:132-134`, 현재 main 그대로):

```css
.scr{position:absolute; inset:0; …
  opacity:0; transform:translateX(14px);
  transition:opacity .32s var(--soft), transform .32s var(--soft); pointer-events:none}
.scr.active{opacity:1; transform:none; pointer-events:auto}
```

| 요소 | 현재 | 네이티브(iOS) |
|---|---|---|
| 이동 거리 | **14px** = 화면 폭의 약 3% | 100% (또는 30% 패럴랙스) |
| 방식 | **크로스페이드** — 두 화면이 동시에 반투명 | 불투명한 판이 판을 **덮음** |
| 나가는 화면 | 그냥 사라짐 | 28% 물러나며 **어두워짐** |
| 이징 | 들어옴·나감 **동일 커브** | 들어올 때 감속 / 나갈 때 가속 |
| 방향 | 없음 (모든 전환이 동일) | 깊이 들어감 ↔ 되돌아옴이 반대 |

두 가지가 구조적으로 가벼움을 만든다.

**하나.** 14px 은 이동이 아니라 **떨림**이다. 눈이 "옮겨갔다"로 읽을 만한 변위가 아니다.

**둘.** 크로스페이드는 겹치는 순간 두 화면이 모두 반투명이라 **"누가 위에 있는가"가 표현되지 않는다.** 종이 두 장이 서로 비치며 바뀌는 문법이다. 깊이가 없으면 무게도 없다 — 앱이 무겁게 느껴지는 이유의 상당 부분은 **occlusion(가림)과 패럴랙스**이지 지속시간이 아니다.

---

## 2. 설계

### 2.1 원칙

- **불투명하게 덮는다.** 들어오는 화면이 배경을 갖고 100% 폭으로 이전 화면을 가린다.
- **나가는 화면은 물러난다.** 반대 방향으로 28%, 밝기 84%. 이 **시차가 깊이 신호**다.
- **방향에 의미를 준다.** 깊이 들어가면 오른쪽에서 들어오고, 되돌아오면 오른쪽으로 나간다.
- **transform / opacity / filter 만 움직인다.** 각 화면이 합성 레이어 하나로 유지된다 — 저사양 iOS 에서 레이아웃 재계산이 없다.

### 2.2 토큰

```css
--nav-dur:340ms;
--nav-in :cubic-bezier(.32,.72,0,1);   /* 도착: 강한 감속 */
--nav-out:cubic-bezier(.4,0,.6,1);     /* 이탈: 가속 */
```

거리·시간·커브는 iOS 표준을 따랐다. 340ms 는 짧으면 경박하고 길면 굼뜬 경계값이다.

### 2.3 CSS

```css
.scr{position:absolute; inset:0; … background:var(--paper); pointer-events:none;
  transform:translateX(100%);
  transition:transform var(--nav-dur) var(--nav-in), filter var(--nav-dur) linear;
  will-change:transform}
.scr.active{transform:none; pointer-events:auto}

/* 이탈: 짧게 반대로 + 어둡게 = 뒤로 들어가는 것으로 읽힘 */
.scr.leaving{transform:translateX(-28%); filter:brightness(.84);
  transition:transform var(--nav-dur) var(--nav-out), filter var(--nav-dur) linear}

/* 되돌아오기는 두 역할을 뒤집는다 */
.scr.pop{transform:translateX(-28%); filter:brightness(.84)}
.scr.pop.active{transform:none; filter:none}
.scr.leaving.pop{transform:translateX(100%); filter:none}

/* 첫 페인트에는 올 곳이 없다 */
.scr.instant,.scr.instant.active,.scr.instant.leaving{transition:none}

@media (prefers-reduced-motion:reduce){
  .scr,.scr.active,.scr.leaving,.scr.pop{transition:opacity .12s linear; transform:none; filter:none}
  .scr{opacity:0} .scr.active{opacity:1}
}
```

### 2.4 방향 판단 — `show()` 에 깊이를 준다

전환이 의미를 가지려면 **어느 쪽으로 가는지**를 알아야 한다. 화면에 깊이를 매긴다.

```js
var NAV_DEPTH={login:-1, home:0, menu:1, news:1, invite:1, player:2};
```

`login` 이 홈보다 **아래**인 이유: 로그인에서 앱으로 들어오는 것은 깊이 들어가는 게 아니라 **올라오는** 것이다.
목록에 없는 화면은 **1(한 단계 안쪽)로 취급**한다 — 모르는 화면은 pop 해서 없는 곳으로 나가느니 push 하는 편이 안전하다.

```js
var popping = depth(to) < depth(from);
to.classList.remove('leaving');
to.classList.toggle('pop', popping);
void to.offsetWidth;              // 시작 위치를 커밋한 뒤에 애니메이션
from.classList.remove('active');
from.classList.toggle('pop', popping);
from.classList.add('leaving');
cur=n; to.classList.add('active');
setTimeout(function(){ from.classList.remove('leaving','pop'); }, NAV_SETTLE_MS);  // 380ms
```

`void to.offsetWidth` 가 핵심이다. 시작 위치를 **강제로 커밋하지 않으면** 브라우저가 이전 상태에서 바로 최종 상태로 보간해 첫 프레임이 틀린다.

`NAV_SETTLE_MS(380ms)` 후 클래스를 떼는 이유: 화면 밖으로 나간 판이 살아있는 레이어로 남지 않게 한다.

### 2.5 실패 모드

**안전한 쪽으로 떨어진다.** 클래스가 붙지 않으면 화면은 이전과 정확히 같은 상태가 된다 — 기존 규칙에도 `.scr.active{transform:none}` 이 있었기 때문이다. 새 규칙이 화면을 사라지게 만들 수 있는 경로는 없다.

---

## 3. 검증 상태 — **미검증. 이 항목을 지우지 말 것**

**곡선·타이밍·"앱 같은가" 는 확인하지 못했다.**
모션은 정지 화면으로 판단할 수 없고, **백그라운드 탭에서는 CSS transition 이 진행되지 않는다.** 모든 샘플이 시작값에 고정돼 나왔다(`active` 인데 `translateX(390px)`).

확인한 것은 **정적 규칙뿐**이다 (transition 을 끄고 측정):

| 검사 | 결과 |
|---|---|
| 활성 화면 | `transform:none` (제자리) |
| 비활성 화면 전부 | `translateX(390px)` (화면 밖 대기) |
| 매칭 규칙 | `.scr` / `.scr.active` — 덮는 규칙 없음 |
| 감소 모션 분기 | `transform:none` 로 해소 |
| 게이트 | `check-dial` OK · `hardcode-audit` 248/281 불변 |

**기기에서 눈으로 보기 전에는 머지하지 않는 것이 맞다.**

---

## 4. 적용 방법

```bash
git fetch origin
git checkout -b feat/dial-native-motion origin/feat/dial-native-motion   # 828ceb9c
git rebase origin/main        # 충돌 없음 — 아래 참조
```

**충돌 위험 실측 (2026-08-03):**
- 브랜치는 main 대비 **26커밋 뒤처짐**, 같은 파일(`index.html`)이 그 사이 **18커밋** 변경됨
- 그러나 `git merge-tree` 결과 **충돌 마커 0**
- 이유: main 의 변경은 전부 다이얼 비디오 모드(build 77~85, mound/overlay)이고 **`.scr` 규칙은 base 와 문자 단위로 동일**

빌드 번호는 브랜치가 `71` 로 올려두었으므로 rebase 후 **현재 값 기준으로 다시 올려야 한다**(main 은 이미 85 이후).

---

## 5. 남은 질문 — "불안정하다"

James 의 보고에는 "가볍다" 외에 **"불안정하다"** 가 함께 있었고, 이 설계는 **가벼움만 다룬다.** 불안정은 별개 증상일 가능성이 높고 확인하지 못했다.

다음에 이어받는 사람은 아래 중 어느 것인지부터 좁힐 것:

- 눌러도 **반응이 늦다** → 터치 지연 / `touch-action` / 300ms 클릭 지연
- **두 번 눌린다** → 클릭 억제 창(`suppressClickUntil`, 350ms)과 휠 제스처의 상호작용
- 전환 중 **깜빡인다** → 합성 레이어 승격/해제 타이밍, `will-change` 잔류
- 눌렀다가 **되돌아온다** → `show()` 재진입 또는 라우팅 경합

이 설계를 머지하면 전환 시간이 320ms → 340ms 로 늘고 이동량이 커지므로, **불안정 증상이 전환과 얽혀 있다면 더 눈에 띌 수 있다.** 그래서 불안정의 정체를 먼저 좁히는 편이 순서상 낫다.
