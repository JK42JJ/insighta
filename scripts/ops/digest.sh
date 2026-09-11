#!/usr/bin/env bash
# Evening digest: what changed, what was verified, what is open, what needs James.
#   scripts/ops/digest.sh [YYYY-MM-DD]   default today (KST)
# Reads git/GitHub, the work-order files and the question queue. Prints markdown.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
DAY="${1:-$(TZ=Asia/Seoul date +%F)}"
echo "# 다이제스트 $DAY"
echo
echo "## 머지된 PR"
gh pr list --state merged --search "merged:$DAY" --limit 50 --json number,title,mergedAt --jq '.[] | "- #\(.number) \(.title)"' 2>/dev/null || echo "- (gh 조회 실패)"
echo
echo "## 열린 PR"
gh pr list --state open --limit 20 --json number,title,isDraft --jq '.[] | "- #\(.number) \(.title)\(if .isDraft then " (draft)" else "" end)"' 2>/dev/null
echo
echo "## 워크 오더"
bash scripts/ops/work-orders.sh list
echo
echo "## 질문 큐 (James 답 필요)"
tail -n +5 docs/work-orders/QUESTIONS.md | grep '^|' | grep -v '^| *---' || echo "- 없음"
echo
echo "## 되돌릴 수 없는 결정 대기"
grep -h -A6 '^# james' docs/work-orders/WO-*.md 2>/dev/null | grep '^- ' | sort -u || echo "- 없음"
echo
echo "## 프로덕션 신호"
gh run list --workflow=keel.yml --limit 1 --json conclusion,createdAt --jq '.[] | "- Keel 마지막 실행: \(.conclusion) (\(.createdAt))"' 2>/dev/null
gh run list --workflow=terraform.yml --limit 1 --json conclusion,name --jq '.[] | "- Terraform 마지막 실행: \(.conclusion)"' 2>/dev/null
echo
echo "## James 3줄 (핵심 3 · 근거 · 반례)"
echo "1."
echo "2."
echo "3."
