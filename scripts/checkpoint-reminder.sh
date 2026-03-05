#!/bin/bash
# checkpoint-reminder.sh — 세션 종료 시 미기록 작업 감지 및 리마인더
# Stop hook에서 호출됨

MEMORY_DIR="$HOME/.claude/projects/-Users-jeonhokim-cursor-sync-youtube-playlists/memory"
CHECKPOINT_FILE="$MEMORY_DIR/checkpoint.md"

# 마지막 checkpoint의 커밋 해시 추출 (백틱으로 감싼 7자리 해시 중 마지막)
LAST_HASH=""
if [ -f "$CHECKPOINT_FILE" ]; then
  LAST_HASH=$(grep -oE '`[a-f0-9]{7}`' "$CHECKPOINT_FILE" | tail -1 | tr -d '`')
fi

CURRENT_HASH=$(git rev-parse --short HEAD 2>/dev/null)

# 미커밋 변경사항 확인
UNCOMMITTED=$(git diff --stat 2>/dev/null | tail -1)
UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')

# 새 커밋 확인 (마지막 checkpoint 이후)
NEW_COMMITS=0
if [ -n "$LAST_HASH" ] && [ "$LAST_HASH" != "$CURRENT_HASH" ]; then
  NEW_COMMITS=$(git log --oneline "${LAST_HASH}..HEAD" 2>/dev/null | wc -l | tr -d ' ')
fi

# 리마인더 출력 조건: 새 커밋, 미커밋 변경, untracked 파일 중 하나라도 있으면
if [ "$NEW_COMMITS" -gt 0 ] || [ -n "$UNCOMMITTED" ] || [ "$UNTRACKED" -gt 0 ]; then
  echo "⚠️ 미기록 작업이 감지되었습니다. /checkpoint 실행을 권장합니다."
  [ "$NEW_COMMITS" -gt 0 ] && echo "  - 새 커밋 ${NEW_COMMITS}개"
  [ -n "$UNCOMMITTED" ] && echo "  - 미커밋 변경: ${UNCOMMITTED}"
  [ "$UNTRACKED" -gt 0 ] && echo "  - Untracked 파일 ${UNTRACKED}개"
fi
