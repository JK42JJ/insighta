---
name: ship
description: "커밋 → 푸시 → PR → 머지 → 배포 검증 원스텝 자동화. /deploy 상위 호환."
---

# /ship — One-step Ship to Production

커밋부터 프로덕션 배포 검증까지 6 Phase 자동 실행.

## 사용법
```
/ship                          # 전체 플로우 (commit → deploy 검증)
/ship --dry-run                # pre-flight만 실행, 실제 변경 없음
/ship --no-merge               # PR 생성까지만 (자동 머지 안 함)
/ship --message "커밋 메시지"    # 커밋 메시지 직접 지정
/ship --hotfix                 # pre-flight 최소화 + 긴급 배포
```

## 안전장치 (Phase 실행 전 확인)

| 체크 | 동작 |
|------|------|
| 현재 브랜치 != master | **차단** — master에서만 실행 허용 |
| .env, credentials 파일 감지 | staging 제외 + 경고 |
| 미커밋 파일 50+ | 경고 + 분할 커밋 제안 |
| force push 시도 | **차단** |
| CI 실패 | 자동 머지 중단, 원인 출력 |
| Deploy 실패 | rollback workflow 안내 |

## 실행 흐름

### Phase 1: Pre-flight 검증

**병렬 실행**:
```bash
npx tsc --noEmit                      # Backend type check
cd frontend && npx tsc --noEmit       # Frontend type check
cd frontend && npm run build          # Vite build (--hotfix 시 skip)
```

추가 정보 수집 (병렬):
```bash
git status -s                         # 변경 파일 확인
git diff --stat                       # 변경 규모
```

- 하나라도 실패 → 즉시 중단 + 에러 출력
- `--hotfix`: tsc만 실행 (build skip)
- `--dry-run`: 여기서 결과 출력 후 종료

### Phase 1.5: 이슈 트래킹 검증

1. `git diff --stat` + `git status -s` 결과를 분석하여 변경사항을 논리 단위로 분류
2. 각 단위에 대해 기존 GitHub 이슈 매핑 확인:
   ```bash
   gh issue list --state all --limit 50 --json number,title,state
   ```
3. 매핑되지 않는 변경사항이 있으면:
   - 이슈 생성 제안 (제목, 라벨, 본문 초안)
   - **유저 확인 후** `gh issue create` 실행
   - 이미 완료된 작업이면 생성 즉시 `gh issue close` + 코멘트
4. 커밋 메시지에 관련 이슈 번호 포함 (e.g., `Closes #170, #171, #172`)

### Phase 2: 스마트 커밋

1. `git diff --staged` + `git diff` 분석하여 변경 내용 파악
2. Conventional Commit 메시지 자동 생성 (feat/fix/refactor/docs/chore)
   - `--message` 지정 시 해당 메시지 사용
3. 파일별 선택적 staging:
   - **제외**: `.env*`, `credentials*`, `*.pem`, `*.key`, `backups/`, `test-results/`
   - 나머지 변경 파일 모두 stage
4. **유저 확인 필수**: 커밋 메시지 + 파일 목록 표시 → 승인 후 커밋 실행
5. 커밋 메시지 형식:
   ```
   {type}({scope}): {subject}

   Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
   ```

### Phase 3: Push

```bash
git push origin master
```

- master 브랜치가 아닌 경우 → Phase 1에서 이미 차단됨
- push 실패 시 원인 분석 (conflict, auth 등) + 중단

### Phase 4: PR 생성

1. 기존 열린 PR 확인: `gh pr list --base main --head master --state open`
2. 열린 PR 있으면 재사용 (URL 출력)
3. 없으면 새로 생성:
   ```bash
   gh pr create --base main --head master \
     --title "{커밋 메시지 기반 제목}" \
     --body "$(cat <<'EOF'
   ## Summary
   {변경 내용 요약 — diff 기반 자동 생성}

   ## Pre-flight
   - tsc (backend): ✅ pass
   - tsc (frontend): ✅ pass
   - build: ✅ pass
   - files changed: {N}

   ## Test plan
   - [ ] CI pass
   - [ ] Deploy health check

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   ```
4. `--no-merge` 지정 시 PR URL 출력 후 종료

### Phase 5: CI 모니터링 + Auto-merge

1. CI 상태 확인 (최대 5분 폴링):
   ```bash
   gh pr checks {PR_NUMBER} --watch
   ```
2. CI 통과 시 자동 머지:
   ```bash
   gh pr merge {PR_NUMBER} --squash --delete-branch=false
   ```
3. CI 실패 시: 실패 job 상세 출력 + 중단

### Phase 6: 배포 검증

1. Deploy workflow 완료 대기 (최대 10분):
   ```bash
   gh run list --workflow=deploy.yml -L 1 --json status,conclusion
   ```
2. 헬스체크:
   ```bash
   curl -sf https://insighta.one/health
   ```
3. 결과 출력:
   - 성공: PR URL + Deploy 상태 + 헬스체크 결과
   - 실패: 로그 출력 + `docs/operations-manual.md`의 rollback 절차 안내

## Phase별 종료 조건 정리

| 플래그 | 종료 Phase |
|--------|-----------|
| `--dry-run` | Phase 1 완료 후 종료 |
| `--no-merge` | Phase 4 완료 후 종료 |
| (기본) | Phase 6 완료 후 종료 |
| `--hotfix` | Phase 1 경량화 (tsc만) + 전체 실행 |

## 주의사항

- `/deploy`의 상위 호환. 기존 `/deploy`는 이 skill로 대체됨.
- 커밋 전 반드시 유저 확인을 받는다 (자동 커밋 금지 — CLAUDE.md 규칙).
- `--delete-branch=false`: master 브랜치는 삭제하지 않는다.
- 모든 Phase에서 실패 시 즉시 중단하고 현재까지 결과를 요약 출력한다.
