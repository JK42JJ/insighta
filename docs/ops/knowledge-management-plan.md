# 지식관리 발전 계획: 문서 더미에서 축적되는 지식으로

작성 2026-08-19 · 상태 **제안(승인 대기)**

이 문서는 현재 문서 관리 방식의 한계를 실측으로 진단하고, 오픈소스 LLM wiki 를
도입해 지속 축적 구조로 발전시키는 계획을 정리한다.

---

## 1. 현재 상태 (2026-08-19 실측)

### 1-1. 자산 규모

| 위치 | 규모 | 추적 | 검색 가능 |
|---|---:|---|---|
| `docs/` | md 78개 / 1.0MB | git tracked | grep 만 |
| `memory/` | md 139개 | gitignored, `insighta-private` 미러 | memsearch + graphify |
| `graphify-out/` | 지식그래프 + `GRAPH_REPORT.md` | gitignored | 그래프 질의 |
| `~/.memsearch` | 인덱스 | 로컬 전용 | 의미 검색 |

`docs/` 내부 분포:
```
handoffs 27 · releases 16 · api 6 · guides 6 · deployment 3 · qa 3
ops 1 · design 1 · labs 1
```

### 1-2. 진단

**문제 1 — 자산이 두 갈래로 갈라져 있고 서로를 모른다.**
`memory/` 는 graphify 로 그래프화되어 관계 질의가 되지만, `docs/` 78개는 그래프에
들어가 있지 않다. 정작 인계·설계·운영 지식은 `docs/` 에 있다.

**문제 2 — `handoffs/` 27개가 사실상 아카이브다.**
세션마다 인계 문서를 새로 쓰고, 이전 것은 읽히지 않는다. 같은 내용이 여러 문서에
중복 서술되고, 어느 쪽이 최신인지 문서 자체로는 판별되지 않는다.

**문제 3 — 모순이 검출되지 않는다.**
이번 세션에서 실제로 드러난 사례다. 여러 기록에 "시크릿 144키가 **etcd** 에 base64"
라고 적혀 있었으나, 실측 결과 데이터스토어는 **SQLite** 였다. 문서끼리 대조하는
장치가 없어 잘못된 사실이 그대로 재인용되었다.

**문제 4 — 문서가 낡았는지 알 수 없다.**
`docs/PROJECT_KNOWLEDGE.md` 는 `/sync-knowledge` 로 갱신하지만 나머지 77개는
갱신 신호가 없다. 이 세션에서 만든 가이드도 검증기를 별도로 작성해야 사실 대조가
가능했다.

---

## 2. 목표

문서를 **쌓아 두는 것**에서 **질의하고 갱신되는 지식**으로 옮긴다. 구체적으로 네 가지.

1. `docs/` 와 `memory/` 를 하나의 지식 베이스로 통합 질의
2. 새 문서가 들어오면 기존 지식과 **모순되는지 검출**
3. 같은 주제가 흩어져 있으면 **한 페이지로 병합**하고 원문을 역참조
4. 문서의 사실 주장을 **실측과 자동 대조** (이번 세션의 검증기를 상설화)

---

## 3. 방식 — 2트랙

### 트랙 A: 이미 가진 것을 마저 쓴다 — **전제가 틀렸음 (2026-08-19 확인)**

이 트랙은 "기능은 있는데 안 쓰고 있을 뿐" 이라는 전제로 썼다. 확인 결과 전제가
틀렸으므로 그대로 실행하면 안 된다. 두 가지가 걸린다.

**첫째, 현재 그래프가 동작하지 않는다.** 노드 192개, **엣지 0개**. 관계 그래프인데
관계가 없으므로 아래 표의 God Nodes·커뮤니티·Surprising Connections 는 성립하지
않는다. `docs/` 를 추가한다고 나아지는 것이 아니라, 이미 있는 것부터 고장나 있다.

**둘째, 하드룰과 충돌한다.** graphify 의 semantic extraction 은 LLM 을 쓴다
(SKILL.md 203행: "semantic extraction (LLM, costs tokens)"). `MOONSHOT_API_KEY`
가 없으면 Claude 서브에이전트를 dispatch 한다. 문서 78개 처리는 CLAUDE.md 의
"데이터셋 생성·실험 목적 LLM 호출 금지" 에 걸린다.

**따라서 선행 작업은 엣지 0 의 원인 규명이다.** 아래 표는 원래 계획이며, 그 원인이
해소된 뒤에 유효하다.

| 기능 | 현재 | 조치 |
|---|---|---|
| `--update` 증분 갱신 | `memory/` 에만 적용 | `docs/` 도 대상에 추가 |
| `--wiki` 위키 생성 | 미사용 | index + 커뮤니티별 문서 생성 |
| God Nodes / 커뮤니티 | memory 한정 | docs 포함 후 재계산 |
| Surprising Connections | memory 한정 | 문서 간 숨은 관계 노출 |

작업:
```bash
# 1. docs/ 를 그래프에 편입
/graphify docs --update

# 2. 위키 생성
/graphify docs --wiki

# 3. /save 훅에 docs 갱신 추가 (현재 memory 만 갱신)
```

이것만으로 문제 1(갈라짐)과 문제 2(중복)의 상당 부분이 해소된다.

### 트랙 B: LLM wiki 도입 (검토 대상)

트랙 A 로 해결되지 않는 것은 **모순 검출**과 **편집 가능한 위키 UI** 다.
2026년 기준 이 패턴을 구현한 오픈소스가 나와 있다.

#### 후보 비교

| 후보 | 라이선스 | 자체호스팅 | 모순 검출 | 위키 UI | 비고 |
|---|---|---|---|---|---|
| **WeKnora** (Tencent) | MIT | docker-compose | Wiki Mode | 편집·리비전·롤백 | Ollama 지원 확인 |
| Synto | 확인 필요 | 확인 필요 | 4속성 전부 주장 | 확인 필요 | 소규모, 검증 필요 |
| Arkon | 확인 필요 | 확인 필요 | — | — | MCP 로 Claude 연결 |
| LightRAG / GraphRAG | — | 라이브러리 | — | 없음 | 위키 아님, 검색 계층 |

#### WeKnora 를 1순위로 두는 이유

1. **MIT 라이선스** — 사내 사용에 제약 없음
2. **`docker compose up -d` 로 기동** — 이미 docker 를 쓰고 있다
3. **Ollama 연동** — 아래 제약 때문에 이것이 결정적이다
4. **Wiki Mode 가 원문을 상호연결된 마크다운으로 증류**하고 리비전·라인 diff·
   원클릭 롤백을 제공 — 문제 2·3 을 직접 겨냥한다
5. 지식그래프를 함께 만든다 — graphify 산출물과 역할이 겹치므로 중복 판단 필요

#### 반드시 지켜야 할 제약

> **CLAUDE.md 하드룰: Anthropic·OpenRouter API 를 데이터셋 생성·실험·테스트에
> 사용 금지.** 두 API 는 서비스(프로덕션) 전용이다.

문서 78개 + 메모리 139개를 LLM 으로 증류하는 작업은 **명백히 프로덕션이 아니다.**
따라서 **로컬 Ollama 백엔드로만 운용한다.** 이 조건을 만족하지 못하는 후보는
채택하지 않는다. WeKnora 가 1순위인 실질적 이유가 이것이다.

#### 배치 위치

| 후보 위치 | 장점 | 단점 |
|---|---|---|
| **Mac Mini** | 이미 상시 가동, Ollama 구동 이력 있음, 비용 0 | 외부 접근 시 Tailscale 필요 |
| k3s 클러스터 | 접근 경로 기성 | 노드 메모리 여유 없음(노드1 1.9GB 가용) |
| 신규 인스턴스 | 격리 | 월 비용 발생 |

**Mac Mini 권장.** 노드1 은 가용 메모리가 부족해 LLM 추론을 감당하지 못한다(실측).

**단 선행 조건이 있다 (2026-08-19 확인).** Mac Mini 에 Homebrew 와 Ollama 는
설치돼 있으나 **Docker 계열이 전혀 없고**(docker·colima·multipass·lima 모두 부재),
**디스크 여유가 4.2GB** 뿐이다(Data 볼륨 99% 사용). WeKnora 는 docker-compose 로
뜨므로 두 가지를 먼저 해결해야 한다. `~/.ollama` 가 13GB 를 쓰고 있어 여기가
정리 후보다.

---

## 4. 단계별 계획

| 단계 | 내용 | 판정 기준 | 비용 |
|---|---|---|---|
| 1 | `docs/` 를 graphify 그래프에 편입 | `GRAPH_REPORT.md` 에 docs 노드 존재 | 0 |
| 2 | `--wiki` 로 위키 생성, 결과 검토 | 커뮤니티 분류가 실제 주제와 맞는가 | 0 |
| 3 | `/save` 훅에 docs 증분 갱신 추가 | 세션 종료 시 자동 반영 | 0 |
| 4 | Mac Mini 에 WeKnora + Ollama 기동 | `docker compose up -d` 후 UI 접속 | 0 |
| 5 | docs+memory 색인, Wiki Mode 실행 | 모순 검출 결과를 사람이 검토 | 0 |
| 6 | 문서 사실 검증기 상설화 | CI 에서 주기 실행 | 0 |
| 7 | graphify vs WeKnora 역할 정리 | 중복 제거 또는 분업 확정 | 0 |

전 단계 추가 비용이 없다. Mac Mini 와 Ollama 는 이미 있다.

### 4-1. 6단계 보충 — 문서 검증기 상설화

이번 세션에서 가이드 검증용으로 만든 스크립트를 일반화한다. 4개 축으로 검사했다.

```
A. 비밀정보 노출    IP·AWS 계정번호·인스턴스ID·개인 홈 경로가 0건인가
B. 참조 경로 실재    문서가 언급한 파일이 origin/main 에 존재하는가
C. 설정값 대조       문서의 값이 실제 설정 파일과 같은가
D. 라이브 대조       문서의 값이 지금 클러스터와 같은가
```

가이드 1건에 적용한 결과 **PASS 33 / FAIL 2** 였고, 이 검사가 없었다면
공인 IP 2건이 블로그로 나갈 뻔했다. `docs/` 전체로 확대할 가치가 있다.

---

## 5. 결정이 필요한 사항

1. **트랙 A 를 먼저 실행하는가** — 비용 0, 되돌리기 쉬움. 권장
2. **WeKnora 를 도입하는가** — Mac Mini 자원을 쓰게 된다
3. **graphify 와 WeKnora 를 병행하는가, 하나로 정리하는가**
   — 지식그래프 기능이 겹친다. 5단계 결과를 보고 판단하는 것을 권장
4. **`docs/` 를 위키의 원본으로 삼는가, 위키를 원본으로 삼는가**
   — git 을 원본으로 두고 위키를 파생물로 두는 편이 GitOps 원칙과 일관된다

---

## 6. 참고

- LLM Wiki 패턴 — 원문을 1회 컴파일해 상호연결된 페이지로 만들고 증분 갱신하는 방식.
  기존 RAG 가 질의마다 검색하는 것과 대비된다.
- [WeKnora (Tencent)](https://github.com/Tencent/WeKnora) — MIT, Wiki Mode, Ollama 지원
- [Open-Source Frameworks for an LLM Wiki](https://forwardic.org/blog/posts/open-source-frameworks-for-an-llm-wiki/index.html)
- [llm-wiki: Build Persistent Knowledge Bases](https://dudarik.com/en/blog/llm-wiki/)
