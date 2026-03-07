#!/bin/bash
# =============================================================================
# Agent Activity Monitor - Real-time file change & agent task tracking
# =============================================================================
# Monitors file system changes made by Claude Code sub-agents in real-time.
# Designed to run in a tmux pane alongside the main Claude Code session.
# =============================================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# Icons for file types
icon_for_ext() {
  case "$1" in
    ts|tsx)  echo "[TS]" ;;
    js|jsx)  echo "[JS]" ;;
    css|scss) echo "[CSS]" ;;
    md)      echo "[DOC]" ;;
    json)    echo "[CFG]" ;;
    prisma)  echo "[DB]" ;;
    sh)      echo "[SH]" ;;
    yml|yaml) echo "[YML]" ;;
    *)       echo "[FILE]" ;;
  esac
}

# Agent detection from path
detect_agent() {
  local path="$1"
  case "$path" in
    */adapters/*|*/adapter*) echo "adapter-dev" ;;
    */frontend/*|*/components/*|*/hooks/*) echo "frontend-dev" ;;
    */api/*|*/routes/*|*/controllers/*) echo "backend-dev" ;;
    */sync/*|*/scheduler/*) echo "sync-dev" ;;
    *test*|*spec*|*__tests__*) echo "test-runner" ;;
    */docs/*|*.md) echo "docs-writer" ;;
    */prisma/*|*/database/*|*/models/*) echo "backend-dev" ;;
    */docker*|*Dockerfile*|*.yml) echo "supabase-dev" ;;
    *) echo "general" ;;
  esac
}

# Agent color
agent_color() {
  case "$1" in
    adapter-dev)  echo "$MAGENTA" ;;
    frontend-dev) echo "$CYAN" ;;
    backend-dev)  echo "$BLUE" ;;
    sync-dev)     echo "$GREEN" ;;
    test-runner)  echo "$YELLOW" ;;
    docs-writer)  echo "$DIM" ;;
    supabase-dev) echo "$RED" ;;
    *)            echo "$NC" ;;
  esac
}

# Print header
print_header() {
  clear
  echo -e "${BOLD}${BLUE}================================================${NC}"
  echo -e "${BOLD}${BLUE}  Agent Activity Monitor  ${DIM}$(date '+%H:%M:%S')${NC}"
  echo -e "${BOLD}${BLUE}================================================${NC}"
  echo -e "${DIM}  Project: insighta${NC}"
  echo -e "${DIM}  Branch:  $(git branch --show-current 2>/dev/null || echo 'unknown')${NC}"
  echo -e "${DIM}  Watching: src/ frontend/ prisma/ scripts/ docs/${NC}"
  echo -e "${BLUE}------------------------------------------------${NC}"
  echo ""
}

# Mode selection
MODE="${1:-watch}"

case "$MODE" in
  watch)
    print_header
    echo -e "${GREEN}Monitoring file changes...${NC}"
    echo ""

    fswatch -r \
      --exclude='node_modules' \
      --exclude='.git/' \
      --exclude='dist/' \
      --exclude='.next/' \
      --exclude='.claude/tasks' \
      --exclude='*.log' \
      --event Created --event Updated --event Removed --event Renamed \
      "$PROJECT_ROOT/src" \
      "$PROJECT_ROOT/frontend/src" \
      "$PROJECT_ROOT/prisma" \
      "$PROJECT_ROOT/scripts" \
      "$PROJECT_ROOT/docs" \
      "$PROJECT_ROOT/CLAUDE.md" \
      2>/dev/null | while read -r filepath; do
        # Get relative path
        relpath="${filepath#$PROJECT_ROOT/}"

        # Get file extension
        ext="${relpath##*.}"

        # Detect agent and get icon
        agent=$(detect_agent "$relpath")
        icon=$(icon_for_ext "$ext")
        color=$(agent_color "$agent")

        # Timestamp
        ts=$(date '+%H:%M:%S')

        # Print formatted change
        echo -e "${DIM}${ts}${NC} ${color}${BOLD}${agent}${NC} ${icon} ${relpath}"
    done
    ;;

  status)
    # One-shot git status overview
    print_header
    echo -e "${BOLD}Git Status:${NC}"
    echo ""

    # Modified files grouped by agent domain
    echo -e "${YELLOW}Modified Files:${NC}"
    git diff --name-only 2>/dev/null | while read -r f; do
      agent=$(detect_agent "$f")
      color=$(agent_color "$agent")
      echo -e "  ${color}[${agent}]${NC} $f"
    done

    echo ""
    echo -e "${GREEN}Untracked Files:${NC}"
    git ls-files --others --exclude-standard 2>/dev/null | head -20 | while read -r f; do
      agent=$(detect_agent "$f")
      color=$(agent_color "$agent")
      echo -e "  ${color}[${agent}]${NC} $f"
    done

    echo ""
    echo -e "${BOLD}Recent Commits:${NC}"
    git log --oneline -5 2>/dev/null | while read -r line; do
      echo -e "  ${DIM}$line${NC}"
    done
    ;;

  dashboard)
    # Continuous dashboard with periodic refresh
    while true; do
      print_header

      # Git stats
      modified=$(git diff --name-only 2>/dev/null | wc -l | tr -d ' ')
      staged=$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')
      untracked=$(git ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')

      echo -e "${BOLD}  Project Stats${NC}"
      echo -e "  Modified: ${YELLOW}${modified}${NC}  Staged: ${GREEN}${staged}${NC}  Untracked: ${DIM}${untracked}${NC}"
      echo ""

      # Agent domain breakdown
      echo -e "${BOLD}  Changes by Agent Domain${NC}"
      for agent in adapter-dev frontend-dev backend-dev sync-dev test-runner docs-writer supabase-dev; do
        count=0
        while read -r f; do
          detected=$(detect_agent "$f")
          if [ "$detected" = "$agent" ]; then
            count=$((count + 1))
          fi
        done < <(git diff --name-only 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null)

        if [ "$count" -gt 0 ]; then
          color=$(agent_color "$agent")
          bar=$(printf '%.0s#' $(seq 1 "$count"))
          echo -e "  ${color}${agent}${NC}$(printf '%*s' $((14 - ${#agent})) '')${bar} (${count})"
        fi
      done

      echo ""
      echo -e "${BOLD}  Recent Changes (last 5)${NC}"
      git log --oneline -5 --format="  %C(dim)%h%C(reset) %s %C(dim)(%cr)%C(reset)" 2>/dev/null

      echo ""
      echo -e "${DIM}  Refreshing every 5s... (Ctrl+C to stop)${NC}"
      sleep 5
    done
    ;;

  *)
    echo "Usage: $0 [watch|status|dashboard]"
    echo ""
    echo "  watch     - Real-time file change monitoring (default)"
    echo "  status    - One-shot project status overview"
    echo "  dashboard - Continuous dashboard with periodic refresh"
    exit 1
    ;;
esac
