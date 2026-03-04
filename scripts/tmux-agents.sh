#!/bin/bash
# =============================================================================
# TubeArchive - Claude Code Multi-Agent tmux Environment
# =============================================================================
# Sets up a tmux session with panes for:
#   - Main Claude Code orchestrator session
#   - File change monitor (real-time agent activity)
#   - Project dashboard (git status, agent domain stats)
#   - Sub-agent pane (additional Claude Code session)
#
# Layout:
# ┌────────────────────────────┬─────────────────────┐
# │                            │  File Monitor       │
# │  Main Claude Code          │  (real-time changes) │
# │  (Orchestrator)            ├─────────────────────┤
# │                            │  Dashboard          │
# │                            │  (project stats)    │
# ├────────────────────────────┴─────────────────────┤
# │  Sub-Agent Pane (Claude Code / shell)            │
# └──────────────────────────────────────────────────┘
#
# Usage:
#   ./scripts/tmux-agents.sh          # Default 3-pane layout
#   ./scripts/tmux-agents.sh full     # Full 4-pane layout
#   ./scripts/tmux-agents.sh minimal  # Minimal 2-pane layout
#   ./scripts/tmux-agents.sh kill     # Kill the session
# =============================================================================

set -e

SESSION_NAME="tubearchive"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAYOUT="${1:-default}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# Kill existing session
if [ "$LAYOUT" = "kill" ]; then
  tmux kill-session -t "$SESSION_NAME" 2>/dev/null && \
    echo -e "${GREEN}Session '$SESSION_NAME' killed.${NC}" || \
    echo -e "${YELLOW}Session '$SESSION_NAME' not found.${NC}"
  exit 0
fi

# Check if session already exists
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo -e "${YELLOW}Session '$SESSION_NAME' already exists.${NC}"
  echo -e "  ${BOLD}Attach:${NC}  tmux attach -t $SESSION_NAME"
  echo -e "  ${BOLD}Kill:${NC}    $0 kill"
  echo ""
  read -p "Attach to existing session? [Y/n] " answer
  case "$answer" in
    [nN]*) exit 0 ;;
    *) tmux attach -t "$SESSION_NAME"; exit 0 ;;
  esac
fi

echo -e "${BLUE}${BOLD}================================================${NC}"
echo -e "${BLUE}${BOLD}  TubeArchive Agent Environment Setup${NC}"
echo -e "${BLUE}${BOLD}================================================${NC}"
echo ""

case "$LAYOUT" in

  minimal)
    # ┌──────────────────────────────────────────────┐
    # │  Main Claude Code                            │
    # ├──────────────────────────────────────────────┤
    # │  File Monitor                                │
    # └──────────────────────────────────────────────┘
    echo -e "${GREEN}Creating minimal layout (2 panes)...${NC}"

    tmux new-session -d -s "$SESSION_NAME" -c "$PROJECT_ROOT" -x 200 -y 50

    # Main pane - Claude Code
    tmux send-keys -t "$SESSION_NAME" "echo '=== Main Claude Code Session ==='; echo 'Run: claude' ; echo ''" Enter

    # Bottom pane - File monitor
    tmux split-window -v -p 30 -t "$SESSION_NAME" -c "$PROJECT_ROOT"
    tmux send-keys -t "$SESSION_NAME" "bash scripts/agent-monitor.sh watch" Enter

    # Select main pane
    tmux select-pane -t "$SESSION_NAME:0.0"
    ;;

  full)
    # ┌────────────────────────────┬─────────────────────┐
    # │                            │  Subagent Monitor   │
    # │  Main Claude Code          │  (real-time status) │
    # │  (Orchestrator)            ├─────────────────────┤
    # │                            │  File Monitor       │
    # ├────────────────────────────┴─────────────────────┤
    # │  Dashboard (project stats + git)                 │
    # └──────────────────────────────────────────────────┘
    echo -e "${GREEN}Creating full layout (4 panes)...${NC}"

    tmux new-session -d -s "$SESSION_NAME" -c "$PROJECT_ROOT" -x 200 -y 50

    # Pane 0: Main Claude Code (left, large)
    tmux send-keys -t "$SESSION_NAME" "echo '=== Main Claude Code (Orchestrator) ==='; echo 'Run: claude'; echo ''" Enter

    # Pane 1: Right side - Subagent Monitor (top-right)
    tmux split-window -h -p 40 -t "$SESSION_NAME" -c "$PROJECT_ROOT"
    tmux send-keys -t "$SESSION_NAME" "bash scripts/subagent-monitor.sh live" Enter

    # Pane 2: File Monitor (bottom-right)
    tmux split-window -v -p 50 -t "$SESSION_NAME" -c "$PROJECT_ROOT"
    tmux send-keys -t "$SESSION_NAME" "bash scripts/agent-monitor.sh watch" Enter

    # Pane 3: Dashboard (bottom)
    tmux select-pane -t "$SESSION_NAME:0.0"
    tmux split-window -v -p 25 -t "$SESSION_NAME" -c "$PROJECT_ROOT"
    tmux send-keys -t "$SESSION_NAME" "bash scripts/agent-monitor.sh dashboard" Enter

    # Select main pane
    tmux select-pane -t "$SESSION_NAME:0.0"
    ;;

  *)
    # Default: 3-pane layout
    # ┌──────────────────────────┬───────────────────────┐
    # │                          │  Subagent Monitor     │
    # │  Claude Code             │  (real-time status)   │
    # │  (auto-launched)         ├───────────────────────┤
    # │                          │  File Monitor         │
    # │                          │  (file changes)       │
    # └──────────────────────────┴───────────────────────┘
    echo -e "${GREEN}Creating default layout (3 panes)...${NC}"

    tmux new-session -d -s "$SESSION_NAME" -c "$PROJECT_ROOT" -x 220 -y 55

    # Pane 0: Claude Code (left, large) - auto-launch claude
    # Pane 1: Right top - Subagent Monitor
    tmux split-window -h -p 35 -t "$SESSION_NAME" -c "$PROJECT_ROOT"
    tmux send-keys -t "$SESSION_NAME:0.1" "bash scripts/subagent-monitor.sh live" Enter

    # Pane 2: Right bottom - File Monitor
    tmux split-window -v -p 50 -t "$SESSION_NAME:0.1" -c "$PROJECT_ROOT"
    tmux send-keys -t "$SESSION_NAME:0.2" "bash scripts/agent-monitor.sh watch" Enter

    # Launch claude in Pane 0
    tmux select-pane -t "$SESSION_NAME:0.0"
    tmux send-keys -t "$SESSION_NAME:0.0" "claude --resume" Enter
    ;;
esac

# Load project-specific tmux config if exists
TMUX_CONF="$PROJECT_ROOT/.tmux.project.conf"
if [ -f "$TMUX_CONF" ]; then
  tmux source-file "$TMUX_CONF"
fi

echo ""
echo -e "${GREEN}${BOLD}Session '$SESSION_NAME' created!${NC}"
echo ""
echo -e "${BOLD}Attach:${NC}  tmux attach -t $SESSION_NAME"
echo ""
echo -e "${BOLD}Keybindings:${NC}"
echo -e "  ${CYAN}Ctrl+b →${NC}  Move to right pane"
echo -e "  ${CYAN}Ctrl+b ←${NC}  Move to left pane"
echo -e "  ${CYAN}Ctrl+b ↑${NC}  Move to upper pane"
echo -e "  ${CYAN}Ctrl+b ↓${NC}  Move to lower pane"
echo -e "  ${CYAN}Ctrl+b z${NC}  Zoom/unzoom current pane"
echo -e "  ${CYAN}Ctrl+b d${NC}  Detach from session"
echo -e "  ${CYAN}Ctrl+b [${NC}  Scroll mode (q to exit)"
echo ""

# Auto-attach
tmux attach -t "$SESSION_NAME"
