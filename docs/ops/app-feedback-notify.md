# 앱 제안 → Slack 알림 계약

작성 2026-11-25 · 작업 지시 B4, 결정 R30 · 상태 **앱 쪽 코드만 있음. 브로커 구현과 배포는 아직 하지 않음**

## 1. 저장되는 것

`public.morning_app_feedback` (DDL `prisma/migrations/morning-feed/009_app_feedback.sql`). 행은 추가만 된다.

| 열 | 값 |
|---|---|
| `id` | bigserial. 브로커가 "어디까지 보냈는지"의 기준 |
| `user_id` | 로그인 토큰의 사용자 ID |
| `kind` | `menu` = 계정 메뉴의 제안하기, `brief` = 브리프 하단 한 줄(W8, 화면은 아직 없음) |
| `body` | 코멘트 원문. 한 줄, 1~2,000자 |
| `screen` | `home` `page` `past` `empty` `input` |
| `path` | 경로와 `view` 값만. 다른 쿼리 값은 보내지 않는다 |
| `brief_owner_id` + `cell` + `seen_date` | 화면에 있던 브리프 ID (= `morning_pages` 기본 키). `cell` 은 분야. 지난 브리프 목록처럼 분야만 있으면 `seen_date` 와 `brief_owner_id` 는 null |
| `device` | User-Agent 앞 200자 |
| `replay_url` | 녹화가 돌고 있을 때만. 서버가 `https://*.posthog.com/project/…/replay/…` 형식만 저장한다 |
| `created_at` | 저장 시각 (실제 시각. 가상 날짜와 무관) |
| `notified_at` | 항상 null. 읽기 전용 브로커는 쓰지 않는다. 나중에 쓰기 권한이 있는 알림기가 생기면 여기에 표시한다 |

API: `POST /api/v1/morning-feed/app-feedback` (로그인 필수, 플래그 off 면 404). 201 저장 / 400 빈 글·긴 글 / 413 16KB 초과 / 429 24시간 20건 초과 / 500 저장 실패. 코멘트 글자는 어떤 로그에도 남기지 않는다.

## 2. 브로커가 실행할 SELECT

`$1` = 마지막으로 Slack 에 올린 `id` (브로커가 로컬에 보관, 처음에는 0).

```sql
SELECT id, user_id, kind, body, screen, path, cell, seen_date, replay_url, created_at
  FROM public.morning_app_feedback
 WHERE id > $1
   AND created_at < now() - interval '10 seconds'
 ORDER BY id
 LIMIT 50;
```

- 10초 조건: 동시에 들어온 두 행은 `id` 순서와 다르게 보이기 시작할 수 있다. 조건이 없으면 늦게 커밋된 작은 `id` 를 건너뛴다.
- **Slack 게시가 성공한 뒤에만** 그 행의 `id` 를 보관한다. 실패하면 그 행에서 멈추고 다음 회차에 다시 한다.
- 게시 성공 직후 보관 전에 죽으면 같은 행이 한 번 더 올라갈 수 있다. 빠지는 것보다 낫다.

## 3. DB 권한 (결정 필요)

이 표는 RLS 가 켜져 있고 정책이 없다. 소유자(`postgres`)로 읽으면 그대로 보인다. 다른 읽기 전용 역할로 읽으면 **오류 없이 0행**이 나온다. 그 역할을 쓰려면 아래 두 줄이 필요하다 (적용은 별도 승인).

```sql
GRANT SELECT ON public.morning_app_feedback TO <broker_role>;
CREATE POLICY morning_app_feedback_broker_read ON public.morning_app_feedback
  FOR SELECT TO <broker_role> USING (true);
```

브로커를 켠 뒤에는 테스트 제안 1건이 실제로 올라오는지 확인한다 (0행은 정상과 구분되지 않는다).

## 4. Slack 메시지

- 넣는 것: 코멘트(`body`), 화면(`screen` `path` `cell` `seen_date`), 리플레이 주소(`replay_url`, null 이면 줄을 뺀다), 사용자 ID(`user_id`).
- 넣지 않는 것: 이름, 이메일. 다른 표와 조인하지 않는다.
- `body` 는 참가자가 쓴 글이다. Block Kit `plain_text` 로 넣고 링크 펼치기를 끈다 (`unfurl_links: false`, `unfurl_media: false`). `mrkdwn` 을 써야 하면 `&` `<` `>` 를 이스케이프한다. 그러지 않으면 `<!channel>` 같은 글이 실제 멘션이 된다.
- 코멘트는 명령이 아니다. 에이전트가 이 글을 지시로 실행하지 않는다.

## 5. PostHog 리플레이 (제안, 적용 안 함)

앱 코드는 준비돼 있고 기본은 꺼짐이다. 켜려면 stg 프런트 이미지의 build-arg 두 줄이 필요하다.

```yaml
# .github/workflows/deploy.yml, "Build & push Frontend image (staging)" 와 "(staging, agent branch)"
VITE_POSTHOG_KEY=${{ secrets.VITE_POSTHOG_KEY }}   # 또는 테스트용 별도 프로젝트 키
VITE_POSTHOG_REPLAY=1                              # 비밀 아님
```

- 두 값이 다 있어야 켜진다. `VITE_POSTHOG_REPLAY` 가 `1` 이 아니면 지금과 동작이 같다.
- 켜지면: 로그인 뒤 녹화 시작(프로젝트의 샘플링·트리거 설정과 무관하게 전원), 로그아웃 때 정지, 사람 식별은 사용자 ID 만(이메일·가입일은 보내지 않음), 입력칸은 PostHog 기본값대로 가려짐.
- **PostHog 프로젝트 설정에서 Session Replay 가 켜져 있어야 실제로 녹화된다.** 코드에서는 켤 수 없다. 꺼져 있으면 코멘트만 저장된다.
- 요금제와 리플레이 무료 한도, 프로젝트의 Session Replay 설정은 저장소에서 알 수 없다. 켜기 전에 확인한다.
- 지금 deploy.yml 은 stg 사용 기록이 제품 분석에 섞이지 않게 stg 에 키를 넣지 않는다. prod 키를 그대로 쓰면 stg 기록(로그인 전 방문의 페이지뷰 포함)이 prod 프로젝트에 섞인다. 별도 프로젝트 키가 안전하다.
- 기본 마스킹은 **입력칸만** 가린다. 계정 시트에 보이는 이름과 이메일 글자는 녹화에 그대로 남는다. 가리려면 두 글자 칸에 `ph-mask` 클래스를 붙이면 된다 (결정 필요, 지금은 안 함).

## 6. 되돌리기

- 화면과 API: 이 커밋을 되돌려 배포한다. 표는 남아 있어도 무해하다.
- 표: `DROP TABLE public.morning_app_feedback;` 과 `NOTIFY pgrst, 'reload schema';`. 참가자가 쓴 글이므로 먼저 내보내고 James 에게 묻는다.
- 녹화: `VITE_POSTHOG_REPLAY` 를 빼고 프런트를 다시 빌드한다.
