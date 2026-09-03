# 01 · 배포 체인

**목표**: 코드 한 줄이 프로드 화면에 나타나기까지 손대는 모든 것을 James 가
직접 돌린다.

**왜 이것부터인가**: 2026-09-03 에 이 체인이 **세 번** 끊겼다. 세 번 다 CI 는
`success` 였고 프로드는 어제 코드였다. 이 문서를 끝내면 "배포했는데 왜 안
바뀌지" 를 혼자 진단할 수 있다.

**소요**: 25~40분. 대부분 CI 대기다.

---

## 체인의 전체 모양

```
  코드 수정
     │
     ▼
  PR ──────► CI 10개 ──────► 머지
     │                        │
     │                        ▼
     │                   Deploy 워크플로
     │                     ├ 이미지 빌드 → ECR 푸시
     │                     ├ DB 스키마 싱크
     │                     └ 차트 핀 PR 을 "연다"     ◄── 여기서 3번 끊겼다
     │                                │
     │                                ▼
     │                          그 PR 을 머지해야
     │                          charts/.../prod.yaml 의 태그가 바뀐다
     │                                │
     ▼                                ▼
   되돌리기                      ArgoCD (수동 동기화)  ◄── 여기서도 끊긴다
   git revert                          │
                                       ▼
                                  파드 롤아웃
                                       │
                                       ▼
                                    화면
```

**핵심**: 배포 워크플로가 `success` 라고 말하는 지점은 위 그림의 **절반**이다.
나머지 절반(핀 PR 머지 + ArgoCD 동기화)은 사람이 한다. 그래서 success 와 화면이
따로 논다.

---

## 준비

```bash
cd ~/cursor/insighta-fix       # 또는 ~/cursor/insighta
git checkout main && git pull --ff-only origin main
```

> `insighta-fix` 는 worktree 다. 두 디렉터리가 같은 저장소를 본다.

---

## 실습 1 — 지금 프로드에 무엇이 도는지 확정한다

배포를 이해하기 전에 **현재 상태를 읽는 법**부터. 이걸 못 하면 배포가 됐는지
안 됐는지 영원히 모른다.

### 1-a. 차트가 가리키는 태그

```bash
grep -nE "apiTag|frontendTag" charts/insighta/environments/prod.yaml
```

**예상을 적으세요** → 40자리 hex 두 줄, 서로 같다 / 다르다?

### 1-b. 실제로 도는 이미지

```bash
bash scripts/ops/ssh.sh k3s \
  "kubectl get pods -n insighta-prod -o jsonpath='{range .items[*]}{.spec.containers[0].image}{\"\n\"}{end}'" \
  | sed 's#.*/insighta-#insighta-#' | sort | uniq -c
```

**예상을 적으세요** → 1-a 의 태그와 같을까?

> **판정 포인트**: 두 값이 다르면 배포가 안 닿은 것이다. 오늘 아침 이 두 값이
> 달랐고 아무도 몰랐다. 이 두 명령이 "배포됐나?" 에 대한 유일한 정답이다.
> CI 초록색은 답이 아니다.

### 1-c. 그 태그가 어느 커밋인가

```bash
git log --oneline -1 <1-a 에서 본 apiTag 앞 8자리>
```

**판정 포인트**: 이미지 태그 = 커밋 SHA. 그래서 "지금 프로드에 도는 코드" 를
git 에서 정확히 짚을 수 있다. `latest` 였다면 불가능하다 — `prod.yaml` 주석에
그 이유가 적혀 있다.

---

## 실습 2 — 한 줄 고쳐서 끝까지 보낸다

바꿀 것: 사이드바 브리프 목록에서 미발행 도메인에 붙는 배지 문구.
`TBD` → `준비 중`.

한 단어고, 눈에 보이고, 되돌리기 쉽다. 체인을 배우기 위한 화물이다.

### 2-a. 브랜치와 수정

```bash
git checkout -b drill/badge-label
grep -n "TBD" frontend/src/widgets/app-shell/ui/SidebarBriefEntry.tsx
```

나온 줄의 `TBD` 를 `준비 중` 으로 바꾼다. (에디터로. `sed` 도 됨)

### 2-b. 로컬 검증 — 푸시 전에 여기서 막힌다

```bash
cd frontend
npx tsc --noEmit
npx vitest run src/widgets/app-shell/ui/SidebarBriefEntry.test.tsx
cd ..
```

**예상을 적으세요** → 테스트는 통과할까?

> **판정 포인트**: 실패한다. 테스트가 `screen.getAllByText('TBD')` 를 세고
> 있기 때문이다. **이게 정상이다** — 테스트는 화면 문구를 붙잡고 있어야 문구가
> 조용히 바뀌는 것을 막는다. 테스트도 같이 고친다. 고치기 싫으면 그 문구는
> 테스트가 지킬 가치가 없다는 뜻이고, 그건 별개의 판단이다.

테스트의 `'TBD'` 도 `'준비 중'` 으로 바꾸고 다시 돌린다.

### 2-c. 푸시 게이트

```bash
git add -A && git commit -m "drill: badge label"
git push -u origin drill/badge-label
```

**예상을 적으세요** → 그냥 푸시될까?

> **판정 포인트**: 막힌다. `scripts/verify-gate.sh` 가 PreToolUse 훅으로
> frontend 변경을 감지하고 `/verify` PASS 마커를 요구한다. 2026-04-17 에
> 2줄짜리 PR 두 개가 연속으로 프로드를 죽인 뒤 생긴 장치다. `tsc` + `vitest`
> 통과는 런타임 정상을 뜻하지 않는다.
>
> 마커는 `/verify` 를 돌려서 만든다. 마커에는 커밋 SHA 와 시각이 들어가고
> 10분 뒤 만료된다 — 검증한 코드와 미는 코드가 같아야 하기 때문이다.

### 2-d. PR 과 CI

```bash
gh pr create --base main --head drill/badge-label \
  --title "drill: badge label" --body "Hands-on drill. Reverted after."
gh pr checks --watch
```

**예상을 적으세요** → 몇 개의 체크가 돌까? 이름을 셋만 대보세요.

> **판정 포인트**: 10개다. 그중 셋은 이 저장소가 겪은 사고에서 나왔다 —
> `Card Chokepoint`(D&D 보호), `Hardcode Audit`(baseline 초과 시 실패),
> `PR Body English`(GitHub 산출물 영문 전용). 남의 규칙이 아니라 이 프로젝트가
> 물린 자국이다.

### 2-e. 머지, 그리고 **여기서 끊긴다**

```bash
gh pr merge <번호> --squash --delete-branch
gh run list --branch main --limit 3
gh run view <Deploy 의 databaseId> --json jobs -q '.jobs[] | "\(.name) \(.conclusion // .status)"'
```

Deploy 가 `success` 로 끝난다.

```bash
# 화면이 바뀌었을까?
grep -nE "apiTag|frontendTag" charts/insighta/environments/prod.yaml
git pull --ff-only origin main
grep -nE "apiTag|frontendTag" charts/insighta/environments/prod.yaml
```

**예상을 적으세요** → 태그가 새 커밋으로 바뀌었을까?

> **판정 포인트**: **안 바뀐다.** Deploy 의 마지막 잡 "Point the chart at this
> commit" 은 main 에 커밋하지 않고 **PR 을 연다**. 브랜치 보호가 CI 통과를
> 요구하는데 CI 는 직접 푸시를 통과시켜 줄 수 없기 때문이다 —
> `prod.yaml` 주석에 그 최초 실패 로그가 남아 있다.

```bash
gh pr list --state open --json number,headRefName,title \
  -q '.[] | select(.headRefName|startswith("images/")) | "#\(.number) \(.title)"'
gh pr checks <그 번호>
```

**예상을 적으세요** → 그 PR 의 체크는?

> **판정 포인트**: `no checks reported`. GitHub 은 `GITHUB_TOKEN` 으로 민
> 푸시에 워크플로를 트리거하지 않는다(무한 루프 방지). 브랜치 보호는 8개를
> 요구한다. **그 PR 은 구조적으로 머지할 수 없다.** 2026-09-03 에 이런 PR 이
> 세 개 쌓였고, 그동안 프로드는 어제 이미지로 돌았다.

### 2-f. 손으로 넘긴다

```bash
# ECR 에 그 이미지가 실제로 있는지 먼저 확인 — 없는 태그를 핀하면 ImagePullBackOff
for r in insighta-api insighta-frontend; do
  aws ecr describe-images --repository-name $r --region us-west-2 \
    --query 'reverse(sort_by(imageDetails,&imagePushedAt))[:2].imageTags' --output text
done
```

**판정 포인트**: 이 확인을 건너뛰면 존재하지 않는 SHA 를 핀할 수 있다. 실제로
그런 적이 있고 `ImageNotFound` 로 잡혔다. **태그는 추측하지 않는다.**

```bash
git checkout main && git pull --ff-only origin main
git checkout -b drill/pin
# prod.yaml 의 apiTag / frontendTag 를 위에서 확인한 SHA 로
git commit -am "chore(images): drill pin" && git push -u origin drill/pin
gh pr create --base main --head drill/pin --title "chore(images): drill pin" --body "..."
gh pr checks --watch
gh pr merge <번호> --squash --delete-branch
```

### 2-g. ArgoCD — 여기서 또 끊긴다

```bash
bash scripts/ops/ssh.sh k3s \
  "kubectl get app insighta-prod -n argocd -o custom-columns=SYNC:.status.sync.status,HEALTH:.status.health.status,REV:.status.sync.revision --no-headers"
```

**예상을 적으세요** → `Synced` 일까 `OutOfSync` 일까?

> **판정 포인트**: 방금 머지했는데도 `Synced` 로 보일 수 있다. `REV` 를 봐라 —
> **동기화된 커밋 SHA** 다. main 의 최신 SHA 와 다르면, ArgoCD 는 "내가 아는
> 커밋 기준으로는 맞다" 고 말하는 중이다. `Synced` 는 최신이라는 뜻이 아니다.

```bash
SHA=$(git rev-parse origin/main)
bash scripts/ops/ssh.sh k3s \
  "kubectl -n argocd patch app insighta-prod --type merge -p '{\"metadata\":{\"annotations\":{\"argocd.argoproj.io/refresh\":\"hard\"}}}'"
sleep 20
bash scripts/ops/ssh.sh k3s \
  "kubectl -n argocd patch app insighta-prod --type merge -p '{\"operation\":{\"initiatedBy\":{\"username\":\"james\"},\"sync\":{\"revision\":\"$SHA\"}}}'"
```

두 단계인 이유: `refresh` 는 "git 을 다시 읽어라", `sync` 는 "그대로 클러스터에
적용해라". refresh 없이 sync 하면 ArgoCD 가 아는 옛 커밋을 적용한다.

### 2-h. 롤아웃과 화면

```bash
bash scripts/ops/ssh.sh k3s "kubectl -n insighta-prod rollout status deploy/insighta-frontend --timeout=240s"
bash scripts/ops/ssh.sh k3s \
  "kubectl get pods -n insighta-prod -o jsonpath='{range .items[*]}{.spec.containers[0].image}{\"\n\"}{end}'" \
  | sed 's#.*/insighta-#insighta-#' | sort | uniq -c
```

**실습 1-a 와 1-b 를 다시 돌려서 두 값이 같아진 것을 확인한다.**

마지막으로 브라우저가 아니라 **번들에서** 확인한다. 브라우저는 서비스워커
캐시를 보여줄 수 있다.

```bash
JS=$(curl -s https://insighta.one/ | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
curl -s "https://insighta.one$JS" | grep -c "준비 중"
```

**판정 포인트**: 여기서 1 이상이면 배포는 끝난 것이다. 화면이 그래도 옛것이면
그건 **배포 문제가 아니라 캐시 문제**다. 이 앱은 PWA(`autoUpdate` +
`skipWaiting`)라 새로고침 한 번이면 넘어간다. 둘을 구분하는 것이 이 명령의
목적이다.

---

## 실습 3 — 되돌린다

```bash
git checkout main && git pull --ff-only origin main
git log --oneline -5
git revert --no-edit <drill 커밋 SHA>
```

그리고 2-c ~ 2-h 를 그대로 반복한다. **되돌리기도 배포다.** 되돌리는 경로가
평소 경로와 다르면, 급할 때 그 경로는 동작하지 않는다.

> 문구를 `준비 중` 으로 유지하고 싶으면 되돌리지 않아도 된다. 실습의 화물은
> 문구가 아니라 체인이다.

---

## 오늘 배운 것 — 한 장 요약

| 질문 | 답하는 명령 |
|---|---|
| 지금 프로드에 무슨 코드가 도나 | `kubectl get pods -o jsonpath=...spec.containers[0].image` |
| 차트는 무엇을 가리키나 | `grep apiTag charts/insighta/environments/prod.yaml` |
| 그 태그는 어느 커밋인가 | 태그 = 커밋 SHA. `git log --oneline -1 <sha>` |
| 배포가 정말 끝났나 | 위 둘이 같고, 번들에 새 문자열이 있다 |
| CI 는 통과했는데 왜 그대로인가 | 핀 PR 이 안 머지됐다 / ArgoCD 가 동기화 안 됐다 |
| ArgoCD 가 Synced 인데 왜 옛것인가 | `.status.sync.revision` 을 봐라. Synced ≠ 최신 |
| 화면만 옛것인가 | 번들에는 있는데 화면에 없으면 SW 캐시 |

## 다음

이 체인에서 **자동화되어야 하는데 안 된 것**이 하나 있다. 핀 PR 이 스스로
머지되지 못하는 것. 02~05 트랙 전에 그것부터 고치는 것이 순서일 수 있다 —
고치는 과정 자체가 GitHub Actions 트랙의 좋은 교재다.
