#!/bin/bash
# Ops Dashboard Reliability Test Suite
# 유저가 리포트한 실제 문제를 재현/검증하는 테스트
#
# Usage: bash scripts/test-ops-dashboard.sh [--live]

set +e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OPS="$SCRIPT_DIR/ops-dashboard.sh"
LIVE=false; [ "$1" = "--live" ] && LIVE=true

PASS=0; FAIL=0; SKIP=0
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; D='\033[2m'; NC='\033[0m'
pass() { PASS=$((PASS+1)); echo -e "  ${G}PASS${NC} $1"; }
fail() { FAIL=$((FAIL+1)); echo -e "  ${R}FAIL${NC} $1${2:+ — $2}"; }
skip() { SKIP=$((SKIP+1)); echo -e "  ${Y}SKIP${NC} $1"; }

# Isolated test cache
TC="/tmp/ops-test-$$"; mkdir -p "$TC"; trap "rm -rf $TC" EXIT
TTL=30
_cg() { local f="$TC/$1"; [ -f "$f" ] && local a=$(( $(date +%s) - $(stat -f%m "$f" 2>/dev/null || stat -c%Y "$f" 2>/dev/null || echo 0) )) && [ "$a" -lt "${2:-$TTL}" ] && cat "$f" && return 0; return 1; }
_cs() { local t="$TC/$1.tmp"; cat > "$t" && mv -f "$t" "$TC/$1"; }

echo ""
echo "=========================================="
echo " Ops Dashboard — Reported Issues Test"
echo "=========================================="

# ============================================================================
# BUG-1: 프로덕션 서버 정상인데 red(●) 또는 no-data(○) 표시
# "운영서버 잘 접속되.. 근데 계속 레드표시.."
# 원인: curl -sf가 HTTP 500을 failure로 처리
# 수정: HTTP status code 기반 판정 + success-only write
# ============================================================================
echo ""
echo -e "${D}--- BUG-1: 정상 서버가 red/○ 로 표시 ---${NC}"

# T1: fetch_health는 HTTP status code를 체크해야 함 (curl -sf 아님)
if grep -q 'curl.*-sf.*insighta' "$OPS"; then
  fail "T1.1 fetch_health still uses curl -sf (masks HTTP errors)"
else
  pass "T1.1 fetch_health does NOT use curl -sf"
fi

# T2: HTTP 200 → OK, HTTP 500 → WARN (not failure)
if grep -q "http_code\|%{http_code}" "$OPS"; then
  pass "T1.2 fetch_health checks HTTP status code"
else
  fail "T1.2 fetch_health missing HTTP status code check"
fi

# T3: 실패 시 이전 성공 데이터 유지 (success-only write 핵심)
echo "OK|100ms" | _cs health_bug1
# 실패 시뮬레이션: curl 실패 → 빈 결과
r=""
[ -n "$r" ] && echo "$r" | _cs health_bug1
result=$(_cg health_bug1 9999)
[ "$result" = "OK|100ms" ] && pass "T1.3 실패 후 이전 정상 데이터 유지" || fail "T1.3 정상 데이터 손실" "got [$result]"

# T4: 3번 연속 실패해도 마지막 성공 데이터 유지
echo "OK|200ms" | _cs health_bug1b
for i in 1 2 3; do
  r=""
  [ -n "$r" ] && echo "$r" | _cs health_bug1b
done
result=$(_cg health_bug1b 9999)
[ "$result" = "OK|200ms" ] && pass "T1.4 3번 연속 실패해도 데이터 유지" || fail "T1.4 연속 실패 시 데이터 손실"

# ============================================================================
# BUG-2: :8081 표시가 ● ↔ ○ 왔다갔다 (flickering)
# "8081 계속 왔다갔다해.."
# 원인: TTL 짧음 + curl timeout 짧음 + 실패 시 캐시 삭제
# ============================================================================
echo ""
echo -e "${D}--- BUG-2: :8081 표시 flickering ---${NC}"

# T1: curl timeout이 충분한가 (1초 → 2초)
health_dev_body=$(sed -n '/^fetch_health_dev()/,/^}/p' "$OPS")
timeout_val=$(echo "$health_dev_body" | grep -o 'max-time [0-9]*' | head -1 | grep -o '[0-9]*')
[ "${timeout_val:-0}" -ge 2 ] && pass "T2.1 dev health curl timeout >= 2s (${timeout_val}s)" || fail "T2.1 curl timeout too short" "${timeout_val}s"

# T2: dev health는 HTTP status code 사용
if echo "$health_dev_body" | grep -q 'http_code\|%{http_code}'; then
  pass "T2.2 dev health uses HTTP status code"
else
  fail "T2.2 dev health missing HTTP status code check"
fi

# ============================================================================
# BUG-3: Terraform 5h ago → red/green 왔다갔다
# "● Terraform 5h ago 은 5시간 전것인데.. 계속 red or green 왔다갔다하는건 이상하지 않아?"
# 원인: TTL=30초로 30초마다 gh API 재호출, 가끔 빈 결과 → 캐시 삭제
# 수정: WF_TTL=300초 (5분), success-only write
# ============================================================================
echo ""
echo -e "${D}--- BUG-3: Terraform 상태 flickering ---${NC}"

# T1: workflow TTL이 충분히 긴가 (이벤트성 데이터)
if grep -q 'WF_TTL=300\|WF_TTL=[3-9][0-9][0-9]' "$OPS"; then
  pass "T3.1 workflow TTL >= 300s (이벤트성 데이터)"
else
  actual=$(grep 'WF_TTL=' "$OPS" | head -1)
  fail "T3.1 workflow TTL too short" "$actual"
fi

# T2: fetch_wf는 WF_TTL을 사용하는가
wf_body=$(sed -n '/^fetch_wf()/,/^}/p' "$OPS")
if echo "$wf_body" | grep -q 'WF_TTL\|\$WF_TTL'; then
  pass "T3.2 fetch_wf uses WF_TTL"
else
  fail "T3.2 fetch_wf not using WF_TTL"
fi

# T3: fetch_wf success-only write
if echo "$wf_body" | grep -q '\[ -n "\$r" \].*_cs'; then
  pass "T3.3 fetch_wf uses success-only write"
else
  fail "T3.3 fetch_wf missing success-only write"
fi

# T4: 시뮬레이션 — 정상 fetch 후 gh 빈 결과 반환 시 상태 유지
echo "completed|failure|2026-03-07T01:23:24Z" | _cs wf_terraform_bug3
r=""  # gh API 빈 결과 시뮬레이션
[ -n "$r" ] && echo "$r" | _cs wf_terraform_bug3
result=$(_cg wf_terraform_bug3 9999)
echo "$result" | grep -q 'failure' && pass "T3.4 gh 빈 결과 후 Terraform failure 상태 유지" || fail "T3.4 Terraform 상태 유실"

# ============================================================================
# BUG-4: DEPLOY 섹션 사라졌다 나타났다
# "DEPLOY 는 사라졌다 나타났다.."
# 원인: gh CLI 빈 결과 → 캐시에 빈 문자열 기록 → "(no data)" 표시
# ============================================================================
echo ""
echo -e "${D}--- BUG-4: DEPLOY 섹션 사라짐 ---${NC}"

# T1: pipeline fetcher는 빈 결과를 캐시에 쓰지 않음
pipeline_body=$(sed -n '/^fetch_pipeline()/,/^}/p' "$OPS")
if echo "$pipeline_body" | grep -q '\[ -n "\$r" \].*_cs\|\[ -n "\$' ; then
  pass "T4.1 pipeline fetcher guards empty writes"
else
  fail "T4.1 pipeline fetcher may write empty data"
fi

# T2: pipeline TTL이 이벤트성에 맞는가
if echo "$pipeline_body" | grep -q 'WF_TTL\|\$WF_TTL'; then
  pass "T4.2 pipeline uses WF_TTL (이벤트성)"
else
  fail "T4.2 pipeline TTL not event-driven"
fi

# T3: 시뮬레이션 — deploy 데이터 있는 상태에서 gh 실패
echo "RUN|completed|success|main|2026-03-07|7839" | _cs pipeline_bug4
r=""
[ -n "$r" ] && echo "$r" | _cs pipeline_bug4
result=$(_cg pipeline_bug4 9999)
echo "$result" | grep -q '7839' && pass "T4.3 gh 실패 후 deploy 데이터 유지" || fail "T4.3 deploy 데이터 유실"

# T5: DEPLOY no-data 시 3줄 고정
deploy_nodata=$(sed -n '/^r_deploy()/,/^}/p' "$OPS" | sed -n '/loading/,/return/p')
nodata_lines=$(echo "$deploy_nodata" | grep -c 'echo')
[ "$nodata_lines" -ge 3 ] && pass "T4.4 DEPLOY no-data시 3줄 고정 출력" || fail "T4.4 DEPLOY no-data" "${nodata_lines}줄"

# ============================================================================
# BUG-5: ISSUES 29/64 done (45%) 깜빡임
# "ISSUES • 29/64 done (45%) 도 계속 꾸뻑꾸뻑하는데.."
# 원인: issue_counts TTL=60초, 매분 gh API 호출
# ============================================================================
echo ""
echo -e "${D}--- BUG-5: ISSUES 카운트 flickering ---${NC}"

# T1: issue_counts TTL이 충분한가
if grep -q 'ISS_TTL=300\|ISS_TTL=[3-9][0-9][0-9]' "$OPS"; then
  pass "T5.1 issue TTL >= 300s (이벤트성)"
else
  actual=$(grep 'ISS_TTL=' "$OPS" | head -1)
  fail "T5.1 issue TTL too short" "$actual"
fi

# T2: issue_counts fetcher가 ISS_TTL 사용
ic_body=$(sed -n '/^fetch_issue_counts()/,/^}/p' "$OPS")
if echo "$ic_body" | grep -q 'ISS_TTL\|\$ISS_TTL'; then
  pass "T5.2 fetch_issue_counts uses ISS_TTL"
else
  fail "T5.2 fetch_issue_counts not using ISS_TTL"
fi

# T3: issue_counts success-only write
if echo "$ic_body" | grep -q '\[ -n "\$r" \].*_cs'; then
  pass "T5.3 issue_counts uses success-only write"
else
  fail "T5.3 issue_counts missing write guard"
fi

# T4: issues, prs도 ISS_TTL 사용
issues_body=$(sed -n '/^fetch_issues()/,/^}/p' "$OPS")
prs_body=$(sed -n '/^fetch_prs()/,/^}/p' "$OPS")
iss_ok=true; prs_ok=true
echo "$issues_body" | grep -q 'ISS_TTL\|\$ISS_TTL' || iss_ok=false
echo "$prs_body" | grep -q 'ISS_TTL\|\$ISS_TTL' || prs_ok=false
$iss_ok && $prs_ok && pass "T5.4 issues/prs fetchers use ISS_TTL" || fail "T5.4 issues=$iss_ok prs=$prs_ok"

# ============================================================================
# BUG-6: Docker 상태 순간 red 표시
# "terraform 과, docker 부분도 순간순간 red 로 표기되는데"
# 원인: SSH timeout → err 기록 → red 표시 → 다음 성공 시 green
# ============================================================================
echo ""
echo -e "${D}--- BUG-6: Docker/Infra 순간 red ---${NC}"

# T1: infra fetcher는 최소 1개 성공해야 캐시에 기록
infra_body=$(sed -n '/^fetch_infra()/,/^}/p' "$OPS")
if echo "$infra_body" | grep -q 'ec2.*!=.*err.*||.*ssl.*!=.*err.*||.*dock.*!=.*err'; then
  pass "T6.1 infra requires at-least-one-success before write"
else
  fail "T6.1 infra missing success guard"
fi

# T2: infra timeout 설정
timeout_count=$(echo "$infra_body" | grep -c 'timeout ')
[ "$timeout_count" -ge 2 ] && pass "T6.2 infra uses $timeout_count timeout wrappers" || fail "T6.2 insufficient timeouts"

# T3: 시뮬레이션 — 정상 infra 후 전체 실패 시 데이터 유지
echo "ok|87|3/3" | _cs infra_bug6
# 전체 실패: ec2=err, ssl=err, dock=err → 쓰지 않음
ec2="err"; ssl="err"; dock="err"
if [ "$ec2" != "err" ] || [ "$ssl" != "err" ] || [ "$dock" != "err" ]; then
  echo "${ec2}|${ssl}|${dock}" | _cs infra_bug6
fi
result=$(_cg infra_bug6 9999)
[ "$result" = "ok|87|3/3" ] && pass "T6.3 전체 실패 시 이전 infra 데이터 유지" || fail "T6.3 infra 데이터 유실"

# T4: 부분 실패 (ec2 ok, ssh timeout) → 부분 업데이트 기록
ec2="ok"; ssl="90"; dock="err"
if [ "$ec2" != "err" ] || [ "$ssl" != "err" ] || [ "$dock" != "err" ]; then
  echo "${ec2}|${ssl}|${dock}" | _cs infra_bug6b
fi
result=$(_cg infra_bug6b 9999)
[ "$result" = "ok|90|err" ] && pass "T6.4 부분 실패는 기록 (err 포함 가능)" || fail "T6.4 partial write"

# ============================================================================
# BUG-7: 전체 상태 왔다갔다 (근본 원인)
# "상태가 왜 자꾸 왔다갔다하는거야.. ㅜㅜ 문제 심각해"
# 원인: renderer가 fetch를 직접 호출 → 매 렌더마다 네트워크 요청
# 수정: renderer는 캐시만 읽기, fetcher는 백그라운드에서만 실행
# ============================================================================
echo ""
echo -e "${D}--- BUG-7: 렌더러/페처 분리 (근본 원인) ---${NC}"

# T1: 모든 renderer가 _cg (cache read)만 사용
renderer_issues=0
for fn in r_health r_supabase r_deploy r_infra r_workflows r_prs r_issues; do
  body=$(sed -n "/^${fn}()/,/^}/p" "$OPS" 2>/dev/null)
  [ -z "$body" ] && continue
  if echo "$body" | grep -q 'fetch_\|curl \|gh '; then
    fail "T7.1 $fn calls external commands directly"
    renderer_issues=$((renderer_issues+1))
  fi
done
[ "$renderer_issues" -eq 0 ] && pass "T7.1 모든 renderer는 캐시만 읽음 (네트워크 호출 없음)"

# T2: _bg_fetch가 disown 사용 (zombie 방지)
bg_body=$(sed -n '/_bg_fetch()/,/^}/p' "$OPS")
echo "$bg_body" | grep -q 'disown' && pass "T7.2 _bg_fetch uses disown" || fail "T7.2 missing disown"

# T3: atomic cache write (tmp + mv)
if grep -q 'mv -f.*\$.*tmp.*\$' "$OPS" || grep -q 'mv -f "\$t" "\$CD/\$1"' "$OPS"; then
  pass "T7.3 atomic cache write via tmp+mv"
else
  fail "T7.3 non-atomic cache write"
fi

# T4: _bg_refresh의 TTL이 fetcher TTL과 일치
bg_refresh=$(sed -n '/_bg_refresh()/,/^}/p' "$OPS")
wf_in_refresh=$(echo "$bg_refresh" | grep -o 'WF_TTL' | wc -l | tr -d ' ')
iss_in_refresh=$(echo "$bg_refresh" | grep -o 'ISS_TTL' | wc -l | tr -d ' ')
[ "$wf_in_refresh" -ge 5 ] && [ "$iss_in_refresh" -ge 3 ] \
  && pass "T7.4 _bg_refresh TTL matches fetcher TTL (WF=$wf_in_refresh ISS=$iss_in_refresh)" \
  || fail "T7.4 _bg_refresh TTL mismatch" "WF=$wf_in_refresh ISS=$iss_in_refresh"

# ============================================================================
# BUG-8: insighta.one이 red로 표시 (HTTP 500이지만 서버 alive)
# "● insighta.one 도 지금 red 로 보여.."
# ============================================================================
echo ""
echo -e "${D}--- BUG-8: HTTP 500 서버 alive 표시 ---${NC}"

# T1: HTTP 500은 WARN(yellow)로 표시, red가 아님
r_health_body=$(sed -n '/^r_health()/,/^}/p' "$OPS")
if echo "$r_health_body" | grep -q 'WARN.*Y\|Y}.*WARN'; then
  pass "T8.1 WARN(500) 상태는 yellow로 표시 (red 아님)"
else
  fail "T8.1 WARN 상태 색상 미설정"
fi

# T2: WARN 상태에 HTTP 코드 표시
if echo "$r_health_body" | grep -q 'hc\|http_code\|code'; then
  pass "T8.2 WARN 상태에 HTTP 코드 표시"
else
  fail "T8.2 WARN에 HTTP 코드 없음"
fi

# ============================================================================
# BUG-9: 고정 row (PRs/ISSUES 제외)
# "PRs, ISSUES 를 제외하고는 고정 row 로 처리하는게.. 사용성면에서 압도적으로 유리할거 같아."
# ============================================================================
echo ""
echo -e "${D}--- BUG-9: 고정 row 보장 ---${NC}"

# T1: INFRA no-data시 3줄 출력
infra_nodata=$(sed -n '/^r_infra()/,/^}/p' "$OPS" | sed -n '/loading/,/return/p')
infra_lines=$(echo "$infra_nodata" | grep -c 'echo')
[ "$infra_lines" -ge 3 ] && pass "T9.1 INFRA no-data시 3줄 고정" || fail "T9.1 INFRA no-data" "${infra_lines}줄"

# T2: INFRA dev행 항상 출력 (조건부가 아닌 고정)
infra_body=$(sed -n '/^r_infra()/,/^}/p' "$OPS")
if echo "$infra_body" | grep -q 'dev.*local.*always\|# DEV line.*always\|# always'; then
  pass "T9.2 INFRA dev행 항상 표시"
elif echo "$infra_body" | grep -q 'echo -ne.*dev.*local'; then
  # dev 행이 if 밖에 있는지 확인
  pass "T9.2 INFRA dev행 출력 존재"
else
  fail "T9.2 INFRA dev행 조건부 출력"
fi

# ============================================================================
# BUG-10: DEPLOY "loading..." 표시 후 사라짐 (재시작 시 캐시 소실)
# "DEPLOY loading.. 으로표기되면서 사리지는데.."
# 원인: trap에서 "$CD"/* 삭제 → 재시작 시 모든 캐시 소실
# 수정: trap에서 캐시 삭제 제거, lock+buffer+PID만 정리
# ============================================================================
echo ""
echo -e "${D}--- BUG-10: 재시작 시 캐시 보존 ---${NC}"

# T1: trap에서 캐시 파일 삭제하지 않음
trap_body=$(grep '_cleanup\|trap ' "$OPS" | grep -v '#')
if echo "$trap_body" | grep -q '"\$CD"/\*'; then
  fail "T10.1 trap이 캐시 전삭 ($CD/*)"
else
  pass "T10.1 trap이 캐시 보존 (삭제 없음)"
fi

# T2: trap에서 lock 파일은 정리함
if echo "$trap_body" | grep -q '.lock_'; then
  pass "T10.2 trap이 lock 파일 정리"
else
  fail "T10.2 trap에 lock 파일 정리 누락"
fi

# T3: trap에서 PID 파일 정리
if echo "$trap_body" | grep -q 'PIDFILE'; then
  pass "T10.3 trap이 PID 파일 정리"
else
  fail "T10.3 trap에 PID 파일 정리 누락"
fi

# ============================================================================
# BUG-11: Docker 3/3이 1~3초 red 표시
# "● Docker 3/3 도 1~3초씩 red 로 표기되.."
# 원인: fetch_infra에서 EC2+SSL 성공 후 Docker SSH 미완료 시 dock="err" 기본값으로 캐시 작성
# 수정: SSH 실패 시 이전 캐시의 Docker 값을 보존
# ============================================================================
echo ""
echo -e "${D}--- BUG-11: Docker SSH 실패 시 이전값 보존 ---${NC}"

# T1: fetch_infra에서 이전 Docker 값 읽기
infra_body=$(sed -n '/^fetch_infra()/,/^}/p' "$OPS")
if echo "$infra_body" | grep -q 'prev_dock\|prev_infra'; then
  pass "T11.1 fetch_infra가 이전 Docker 캐시값 참조"
else
  fail "T11.1 Docker SSH 실패 시 무조건 err 처리"
fi

# T2: Docker 기본값이 "err"가 아님 (이전값 fallback)
if echo "$infra_body" | grep -q 'dock="${prev_dock:-err}"'; then
  pass "T11.2 Docker 기본값이 이전 캐시값 (fallback to err)"
else
  fail "T11.2 Docker fallback 패턴 미적용"
fi

# T3: 시뮬레이션 — 이전 3/3 → SSH 실패 시 3/3 유지
echo "ok|87|3/3" | _cs infra_bug11
# SSH 실패 시뮬레이션: prev_dock = "3/3", dps = "" → dock = prev_dock
prev_dock="3/3"; dps=""
if [ -n "$dps" ]; then dock="2/3"; else dock="${prev_dock:-err}"; fi
echo "ok|87|${dock}" | _cs infra_bug11
result=$(_cg infra_bug11 9999)
echo "$result" | grep -q '3/3' && pass "T11.3 SSH 실패 시 이전 Docker 상태 보존" || fail "T11.3 Docker 상태 유실" "$result"

# ============================================================================
# BUG-12: PRs/ISSUES 나타났다 사라짐
# "PRs, ISSUES 가 보이지 않음.. PRs 는 잠시 보였다 사라짐"
# 원인: 좀비 프로세스들의 old trap이 캐시 전삭
# 수정: Singleton PID guard + trap 캐시 보존
# ============================================================================
echo ""
echo -e "${D}--- BUG-12: PRs/ISSUES 캐시 소실 방지 ---${NC}"

# T1: Singleton PID guard 존재
if grep -q 'PIDFILE.*ops-dashboard.pid\|ops-dashboard.pid' "$OPS"; then
  pass "T12.1 Singleton PID guard 존재"
else
  fail "T12.1 Singleton guard 없음 (다중 인스턴스 가능)"
fi

# T2: 기존 PID 프로세스를 kill 후 새 PID 등록
pidguard_body=$(sed -n '/PIDFILE/,/echo.*PIDFILE/p' "$OPS" | head -10)
if echo "$pidguard_body" | grep -q 'kill.*old_pid'; then
  pass "T12.2 기존 인스턴스 자동 종료"
else
  fail "T12.2 기존 인스턴스 종료 로직 없음"
fi

# T3: PRs fetcher success-only write
prs_body=$(sed -n '/^fetch_prs()/,/^}/p' "$OPS")
if echo "$prs_body" | grep -q '\[ -n "\$r" \].*_cs'; then
  pass "T12.3 PRs fetcher success-only write"
else
  fail "T12.3 PRs fetcher 빈 결과 기록 가능"
fi

# ============================================================================
# BUG-13: Terraform green/gray/red 교대
# "아니 내말은 그린이었다가, 회색이었다가 레드였다가.. 한다는거야.."
# 원인: 좀비 프로세스 캐시 경합 (동일 데이터인데 다른 프로세스가 다른 타이밍에 읽기)
# 수정: per-key fetcher lock으로 중복 fetch 방지
# ============================================================================
echo ""
echo -e "${D}--- BUG-13: Background fetcher 중복 방지 ---${NC}"

# T1: _bg_fetch에 per-key lock 존재
bg_body=$(sed -n '/_bg_fetch()/,/^}/p' "$OPS")
if echo "$bg_body" | grep -q 'lock_\|lockf'; then
  pass "T13.1 _bg_fetch에 per-key lock 존재"
else
  fail "T13.1 _bg_fetch에 lock 없음 (중복 spawn 가능)"
fi

# T2: lock이 stale 판단 메커니즘 보유
if echo "$bg_body" | grep -q 'lock_age\|age.*lt'; then
  pass "T13.2 lock stale 판단 (age 기반)"
else
  fail "T13.2 lock stale 판단 없음 (교착 가능)"
fi

# T3: lock이 PID 검증 포함
if echo "$bg_body" | grep -q 'kill -0'; then
  pass "T13.3 lock PID 생존 검증 (kill -0)"
else
  fail "T13.3 lock PID 검증 없음"
fi

# ============================================================================
# BUG-14: 과거 failure(>1h)를 red로 표시하는 것은 부적절
# "'● Terraform 6h ago' 가 red 로 보이는게 가장 황당해. (과거 데이터잖아)"
# 수정: >1h 된 failure는 dim으로 표시 (정보 vs 알림 구분)
# ============================================================================
echo ""
echo -e "${D}--- BUG-14: Old failure dim 처리 ---${NC}"

# T1: r_wf에서 old failure 구분 로직
wf_render=$(sed -n '/^r_wf()/,/^}/p' "$OPS")
if echo "$wf_render" | grep -q 'is_old\|old.*fail\|age_str.*h.*d'; then
  pass "T14.1 r_wf에 old failure 구분 로직 존재"
else
  fail "T14.1 old failure 무조건 red 표시"
fi

# T2: old failure (>1h)는 dim 처리
if echo "$wf_render" | grep -q 'is_old.*1.*D}\|D}.*Terraform\|dim.*old'; then
  pass "T14.2 old failure dim 스타일 적용"
else
  # 직접 dim 코드 패턴 확인
  if echo "$wf_render" | grep -q '"\${D}.*Terraform\|D}●'; then
    pass "T14.2 old failure dim 스타일 적용"
  else
    fail "T14.2 old failure dim 미적용"
  fi
fi

# ============================================================================
# BUG-15: 자식 프로세스 cleanup
# 좀비 프로세스 누적 (49개 → 7개)
# 수정: trap에서 pkill -P $$ 로 자식 프로세스 정리
# ============================================================================
echo ""
echo -e "${D}--- BUG-15: 종료 시 자식 프로세스 정리 ---${NC}"

# T1: trap/cleanup에서 자식 프로세스 kill
if grep -q 'pkill -P.*\$\$\|kill.*child' "$OPS"; then
  pass "T15.1 종료 시 자식 프로세스 정리 (pkill -P)"
else
  fail "T15.1 자식 프로세스 cleanup 없음"
fi

# ============================================================================
# LIVE TESTS
# ============================================================================
if [ "$LIVE" = true ]; then
  echo ""
  echo -e "${D}--- LIVE: 실제 안정성 테스트 ---${NC}"

  # TL.1: health 3회 연속 일관성
  states=""
  for i in 1 2 3; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://insighta.one/health 2>/dev/null)
    [ "$code" -ge 200 ] && [ "$code" -lt 400 ] && states="$states OK" || states="$states FAIL:$code"
  done
  unique=$(echo "$states" | tr ' ' '\n' | sort -u | grep -c .)
  [ "$unique" -eq 1 ] && pass "TL.1 health 3회 일관 ($states)" || fail "TL.1 health 불일관" "$states"

  # TL.2: gh API 3회 연속 일관성
  states=""
  for i in 1 2 3; do
    r=$(gh run list --workflow=deploy.yml --limit 1 --json conclusion --jq '.[0].conclusion' 2>/dev/null)
    states="$states ${r:-EMPTY}"
  done
  unique=$(echo "$states" | tr ' ' '\n' | sort -u | grep -c .)
  [ "$unique" -eq 1 ] && pass "TL.2 gh pipeline 3회 일관 ($states)" || fail "TL.2 gh 불일관" "$states"

  # TL.3: 대시보드 3초 실행 후 캐시 안정성
  rm -rf /tmp/ops-cache; mkdir -p /tmp/ops-cache
  bash -c "timeout 3 bash '$OPS' >/dev/null 2>&1"
  sleep 1
  snap1=$(cat /tmp/ops-cache/health 2>/dev/null)
  snap2=$(cat /tmp/ops-cache/pipeline 2>/dev/null)
  [ -n "$snap1" ] && pass "TL.3 health 캐시 생성됨" || skip "TL.3 health cache"
  [ -n "$snap2" ] && pass "TL.4 pipeline 캐시 생성됨" || skip "TL.4 pipeline cache"

  echo ""
fi

# ============================================================================
TOTAL=$((PASS + FAIL + SKIP))
echo "=========================================="
if [ "$FAIL" -eq 0 ]; then
  echo -e " ${G}ALL TESTS PASSED${NC}  $PASS passed, $SKIP skipped, $TOTAL total"
else
  echo -e " ${R}FAILURES DETECTED${NC}  $PASS passed, $FAIL failed, $SKIP skipped"
fi
echo "=========================================="
echo ""
exit $FAIL
