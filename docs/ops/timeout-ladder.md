# 타임아웃 사다리

작성 2026-08-19 · 상태 **적용됨** · 강제 `scripts/ci/check-timeouts.sh`

요청 하나는 여러 계층을 통과한다. 각 계층에 타임아웃이 따로 있고, 그 값들이
서로를 모르면 **가장 짧은 계층이 조용히 전부를 결정한다.** 이 문서는 그 값들을
한 곳에 모으고, CI 가 순서를 강제하도록 한다.

---

## 1. 사다리

**바깥으로 갈수록 길어야 한다.** 안쪽이 먼저 끝나야 어디서 끊겼는지 알 수 있다.

```
  ┌─ ① GitHub Actions job          600s   마지막 안전망
  │  ┌─ ② curl --max-time          300s   워크플로 클라이언트
  │  │  ┌─ ③ ingress               270s   proxy-read / proxy-send
  │  │  │  ┌─ ④ Fastify            240s   requestTimeout
  │  │  │  │  ┌─ ⑤ 외부 호출         30s   LLM · YouTube, 호출 1건
  │  │  │  │  │
  │  │  │  │  └─ 관측된 최장 작업   181s   trend-collector
```

| # | 계층 | 값 | 선언 위치 |
|---:|---|---:|---|
| ① | GitHub Actions job | 600s (10분) | `.github/workflows/*.yml` `timeout-minutes` |
| ② | curl 클라이언트 | 300s | 같은 파일 `--max-time` |
| ③ | ingress | 270s | `charts/insighta/environments/prod.yaml` annotations |
| ④ | Fastify | 240s | `src/api/server.ts` `requestTimeout` |
| ⑤ | 외부 호출 | 30s | `src/config/index.ts` |

여유 간격은 30초다. 어느 계층이 끊었는지 경과 시간만으로 구분된다.

**예외** — 순수 헬스체크(`batch-video-collector-watchdog.yml` 의 30초 호출)는
사다리 밖이다. 응답이 즉시 오거나 죽었거나 둘 중 하나이고, 오래 기다릴 이유가 없다.

---

## 2. 왜 이렇게 하는가

### 2-1. 실제로 일어난 일

2026-08-14 커트오버로 진입점이 host nginx(`proxy_read_timeout 180s`)에서
ingress(기본 60s)로 바뀌었다. 워크플로 쪽 값은 그대로였다.

```
② curl      300s   ← 넉넉히 잡아 둠
③ ingress    60s   ← 실제로 여기서 잘림
```

결과:

```
02:01:52  POST /api/v1/internal/skills/trend-collector/run
02:02:06  pod: dynamic seeds +68 terms
02:02:21  pod: LLM extracted keywords from 34 titles   ← 비용 발생
02:02:52  ingress: 504                                  ← 정확히 60초
```

그런데 **작업은 끝까지 갔다.** DB 실측:

```
Aug 19   1,083건   마지막 fetched_at 02:01:52   ← 504 로 기록된 그 실행
Aug 18   3,619건
Aug 17   1,514건
```

즉 "실패" 로 집계된 실행이 실제로는 데이터를 적재했다. 8/18 이 다른 날의 2~3배인
것은 실패 판정 뒤 watchdog 이 다시 돌려 **같은 작업이 중복 실행**된 흔적으로 보인다.

### 2-2. 이 상태가 나쁜 이유

| | |
|---|---|
| 비용 | LLM 호출은 매번 발생한다. 실패로 보이든 아니든 |
| 신호 | 실패 알림이 매일 오면 아무도 안 본다 |
| 중복 | 재시도·watchdog 이 같은 작업을 또 돌린다 |
| 진단 | 504 만 남고 어느 계층이 끊었는지 로그에 없다 |

가장 나쁜 것은 마지막이다. **60초라는 값이 어디에도 선언돼 있지 않았다.**
컨트롤러 기본값이라 차트를 아무리 읽어도 나오지 않는다.

---

## 3. 값을 바꿀 때

### 3-1. 규칙

1. **혼자 바꾸지 않는다.** 한 계층을 늘리면 그 바깥 계층도 함께 본다.
2. **안쪽부터 정한다.** 작업이 실제로 얼마나 걸리는지 측정하고, 거기에 여유를
   더해 ④를 정한 뒤 바깥으로 30초씩 넓힌다.
3. **측정 없이 늘리지 않는다.** "느리니까 늘린다" 는 근본 원인을 덮는다.
   `trend-collector` 의 181초는 실행 로그에서 나온 값이다.

### 3-2. 절차

```bash
# 1. 실제 소요 측정 — 파드 안에서, ingress 를 거치지 않고
kubectl -n insighta-prod exec deploy/insighta-api -- \
  curl -s -o /dev/null -w '%{time_total}\n' -X POST localhost:3000/<경로>

# 2. ④부터 위로 30초씩 넓혀 값을 정한다

# 3. 검사
bash scripts/ci/check-timeouts.sh

# 4. 렌더 확인 — 인그레스가 둘이므로 양쪽 모두에 붙는지 본다
helm template insighta charts/insighta \
  -f charts/insighta/environments/prod.yaml \
  --set imageRegistry=registry.invalid | grep -c proxy-read-timeout   # 2
```

4번을 빠뜨리지 않는다. `/api` 는 `insighta` 가 아니라
`insighta-api-ratelimit` 인그레스가 담당한다. 한쪽에만 붙이면 정작 스케줄
작업이 쓰는 경로가 빠진다.

---

## 4. 사다리 밖의 타임아웃

같이 기억해야 할 값들. 사다리에 속하지 않지만 요청 수명에 영향을 준다.

| 항목 | 값 | 위치 | 비고 |
|---|---:|---|---|
| readinessProbe | 1s | `charts/insighta/templates/api.yaml` | 트래픽 투입 판정 |
| livenessProbe | 1s | 같음 | 재시작 판정 |
| Cohere rerank | 5s | `src/config/index.ts` | 사용자 요청 경로, 짧아야 함 |
| keepAliveTimeout | 275s | `src/api/server.ts` | ingress(270s)보다 커야 커넥션 재사용이 끊기지 않음 |

`keepAliveTimeout` 이 ingress 보다 짧으면 서버가 먼저 커넥션을 닫아
간헐적 502 가 난다. 사다리와 방향이 반대인 유일한 값이다.

---

## 5. 근본 해결은 따로 있다

이 사다리는 **동기 실행을 전제로 한 완화책**이다. 작업이 240초를 넘으면 다시
같은 문제가 난다.

근본 해결은 `/run` 이 작업을 큐에 넣고 즉시 `202` 를 반환하고, 워크플로가
상태를 폴링하는 것이다. HTTP 요청 수명과 작업 수명을 분리하면 타임아웃 자체가
의미를 잃는다. 설계는 `docs/ops/pipeline-repair-design.md` §3-3 B-2.

그때까지는 이 사다리가 유효하며, 작업 시간이 180초를 넘기 시작하면 근본 해결을
먼저 하고 값을 더 늘리지 않는다.
