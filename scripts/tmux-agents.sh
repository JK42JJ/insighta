#!/bin/bash
# =============================================================================
# Insighta Console IDE - tmux Agent Environment
# =============================================================================
# Usage:
#   ./scripts/tmux-agents.sh          # Default: Claude + Dashboard
#   ./scripts/tmux-agents.sh full     # Full: Claude + Dashboard + Shell
#   ./scripts/tmux-agents.sh minimal  # Claude + bottom dashboard
#   ./scripts/tmux-agents.sh solo     # Claude only (single pane)
#   ./scripts/tmux-agents.sh kill     # Kill session
# =============================================================================

set -e

SESSION_NAME="tubearchive"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAYOUT="${1:-default}"
CLAUDE_CMD="claude --dangerously-skip-permissions"
# Dashboard auto-restarts on crash
DASH_CMD="while true; do bash scripts/agent-dashboard.sh; echo 'Dashboard restarting...'; sleep 1; done"
OPS_CMD="while true; do bash scripts/ops-dashboard.sh; echo 'Ops restarting...'; sleep 1; done"

# Detect tmux base-index (0 or 1)
WIN_BASE=$(tmux show-option -gv base-index 2>/dev/null || echo 0)
PANE_BASE=$(tmux show-option -gv pane-base-index 2>/dev/null || echo 0)
W="${WIN_BASE}"  # first window index
P0="${PANE_BASE}"  # first pane
P1=$((PANE_BASE + 1))
P2=$((PANE_BASE + 2))

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# Kill session
if [ "$LAYOUT" = "kill" ]; then
  tmux kill-session -t "$SESSION_NAME" 2>/dev/null && \
    echo -e "${GREEN}Session '$SESSION_NAME' killed.${NC}" || \
    echo -e "${YELLOW}Session '$SESSION_NAME' not found.${NC}"
  exit 0
fi

# Check existing session
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
echo -e "${BLUE}${BOLD}  Insighta Console IDE${NC}"
echo -e "${BLUE}${BOLD}================================================${NC}"
echo ""

case "$LAYOUT" in

  solo)
    # Single pane: Claude only
    echo -e "${GREEN}Creating solo layout (Claude only)...${NC}"
    tmux new-session -d -s "$SESSION_NAME" -c "$PROJECT_ROOT" -x 220 -y 55
    tmux send-keys -t "$SESSION_NAME:$W" "$CLAUDE_CMD" Enter
    ;;

  minimal)
    # ┌──────────────────────────────────────────────┐
    # │  Claude Code                                 │
    # ├──────────────────────────────────────────────┤
    # │  Dashboard (25%)                             │
    # └──────────────────────────────────────────────┘
    echo -e "${GREEN}Creating minimal layout (2 panes)...${NC}"
    tmux new-session -d -s "$SESSION_NAME" -c "$PROJECT_ROOT" -x 220 -y 55

    tmux split-window -v -p 25 -t "$SESSION_NAME" -c "$PROJECT_ROOT"
    tmux send-keys -t "$SESSION_NAME:$W.$P1" "$DASH_CMD" Enter

    tmux select-pane -t "$SESSION_NAME:$W.$P0"
    tmux send-keys -t "$SESSION_NAME:$W.$P0" "$CLAUDE_CMD" Enter
    ;;

  full)
    # ┌────────────────────────────┬─────────────────────┐
    # │                            │                     │
    # │  Claude Code               │  Agent Dashboard    │
    # │  (Orchestrator)            │  (unified monitor)  │
    # │                            │                     │
    # ├────────────────────────────┴─────────────────────┤
    # │  Shell (project root)                            │
    # └──────────────────────────────────────────────────┘
    echo -e "${GREEN}Creating full layout (4 panes)...${NC}"
    tmux new-session -d -s "$SESSION_NAME" -c "$PROJECT_ROOT" -x 220 -y 55

    # Right side - Agent Dashboard
    tmux split-window -h -p 38 -t "$SESSION_NAME" -c "$PROJECT_ROOT"
    tmux send-keys -t "$SESSION_NAME:$W.$P1" "$DASH_CMD" Enter

    # Split right pane - Ops Dashboard (compact bottom)
    tmux split-window -v -p 35 -t "$SESSION_NAME:$W.$P1" -c "$PROJECT_ROOT"
    tmux send-keys -t "$SESSION_NAME:$W.$P2" "$OPS_CMD" Enter

    # Bottom shell
    tmux select-pane -t "$SESSION_NAME:$W.$P0"
    tmux split-window -v -p 18 -t "$SESSION_NAME" -c "$PROJECT_ROOT"

    # Launch claude in main pane
    tmux select-pane -t "$SESSION_NAME:$W.$P0"
    tmux send-keys -t "$SESSION_NAME:$W.$P0" "$CLAUDE_CMD" Enter
    ;;

  *)
    # Default: 2-pane layout (Claude + Dashboard)
    # ┌──────────────────────────┬───────────────────────┐
    # │                          │                       │
    # │  Claude Code             │  Agent Dashboard      │
    # │  (--dangerously-skip-    │  (agents + files +    │
    # │   permissions --resume)  │   git status)         │
    # │                          │                       │
    # └──────────────────────────┴───────────────────────┘
    echo -e "${GREEN}Creating default layout (3 panes)...${NC}"
    tmux new-session -d -s "$SESSION_NAME" -c "$PROJECT_ROOT" -x 220 -y 55

    # Right side - Agent Dashboard
    tmux split-window -h -p 38 -t "$SESSION_NAME" -c "$PROJECT_ROOT"
    tmux send-keys -t "$SESSION_NAME:$W.$P1" "$DASH_CMD" Enter

    # Split right pane - Ops Dashboard (compact bottom)
    tmux split-window -v -p 35 -t "$SESSION_NAME:$W.$P1" -c "$PROJECT_ROOT"
    tmux send-keys -t "$SESSION_NAME:$W.$P2" "$OPS_CMD" Enter

    # Launch claude in main pane
    tmux select-pane -t "$SESSION_NAME:$W.$P0"
    tmux send-keys -t "$SESSION_NAME:$W.$P0" "$CLAUDE_CMD" Enter
    ;;
esac

# Load project tmux config
TMUX_CONF="$PROJECT_ROOT/.tmux.project.conf"
if [ -f "$TMUX_CONF" ]; then
  tmux source-file "$TMUX_CONF"
fi

echo ""
echo -e "${GREEN}${BOLD}Session '$SESSION_NAME' created!${NC}"
echo ""
echo -e "${BOLD}Layout:${NC}  $LAYOUT"
echo -e "${BOLD}Claude:${NC}  --dangerously-skip-permissions --resume"
echo ""
echo -e "${BOLD}Attach:${NC}  tmux attach -t $SESSION_NAME"
echo ""
echo -e "${BOLD}Keybindings:${NC}"
echo -e "  ${CYAN}prefix + g${NC}  lazygit        ${CYAN}prefix + f${NC}  yazi (files)"
echo -e "  ${CYAN}prefix + /${NC}  fzf grep       ${CYAN}prefix + p${NC}  fzf file picker"
echo -e "  ${CYAN}prefix + B${NC}  btop           ${CYAN}prefix + D${NC}  lazydocker"
echo -e "  ${CYAN}prefix + S${NC}  shell popup    ${CYAN}Alt+z${NC}      zoom pane"
echo -e "  ${CYAN}Alt+←→↑↓${NC}   pane nav       ${CYAN}Alt+1-9${NC}    window switch"
echo ""

# Auto-attach
tmux attach -t "$SESSION_NAME"
