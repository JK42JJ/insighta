#!/bin/bash
# =============================================================================
# Subagent Output Monitor - Real-time Claude Code sub-agent task tracking
# =============================================================================
# Monitors Claude Code sub-agent output files in real-time.
# Parses JSONL format to extract tool calls, progress, and results.
# =============================================================================

set +e  # Do NOT use set -e: transient failures in the monitoring loop must not kill the script

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Auto-detect task directory (Claude Code stores tasks in /private/tmp/claude-<uid>/)
TASK_DIR_BASE="/private/tmp"
TASK_DIR=""
for d in "$TASK_DIR_BASE"/claude-*/-Users-jeonhokim-cursor-sync-youtube-playlists/tasks; do
  if [ -d "$d" ]; then
    TASK_DIR="$d"
    break
  fi
done
TASK_DIR="${TASK_DIR:-/private/tmp/claude-502/-Users-jeonhokim-cursor-sync-youtube-playlists/tasks}"

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
BG_GREEN='\033[42m'
BG_YELLOW='\033[43m'
BG_BLUE='\033[44m'

# Parse agent type from initial prompt
parse_agent_type() {
  local file="$1"
  # Look for subagent_type in first few lines
  local agent_type
  agent_type=$(head -1 "$file" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    msg = d.get('message', {})
    content = msg.get('content', '')
    if isinstance(content, str):
        # Try to detect from prompt content
        c = content.lower()
        if 'backend' in c or 'npm install' in c or 'tsc' in c or 'prisma' in c:
            print('backend-dev')
        elif 'frontend' in c or 'vite' in c or 'react' in c:
            print('frontend-dev')
        elif 'test' in c or 'jest' in c or 'coverage' in c:
            print('test-runner')
        elif 'doc' in c:
            print('docs-writer')
        elif 'adapter' in c:
            print('adapter-dev')
        elif 'supabase' in c or 'edge function' in c:
            print('supabase-dev')
        else:
            print('general')
    else:
        print('general')
except:
    print('general')
" 2>/dev/null)
  echo "${agent_type:-general}"
}

# Get agent color
agent_color() {
  case "$1" in
    backend-dev)  echo "$BLUE" ;;
    frontend-dev) echo "$CYAN" ;;
    test-runner)  echo "$YELLOW" ;;
    docs-writer)  echo "$DIM" ;;
    adapter-dev)  echo "$MAGENTA" ;;
    supabase-dev) echo "$RED" ;;
    *)            echo "$GREEN" ;;
  esac
}

# Extract latest status from output file
extract_status() {
  local file="$1"
  python3 -c "
import sys, json

status_lines = []
last_text = ''
last_tool = ''
last_progress = ''
tool_count = 0
is_complete = False

with open('$file', 'r') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
            msg_type = d.get('type', '')
            msg = d.get('message', {})

            if msg_type == 'result':
                is_complete = True
                result = msg.get('result', d.get('result', ''))
                if isinstance(result, str) and result:
                    last_text = result[:200]
            elif msg_type == 'progress':
                data = d.get('data', {})
                ptype = data.get('type', '')
                if ptype == 'bash_progress':
                    output = data.get('output', '')
                    elapsed = data.get('elapsedTimeSeconds', 0)
                    last_progress = f'[{elapsed}s] {output.strip()[:100]}'
            elif msg_type == 'assistant':
                content = msg.get('content', [])
                if isinstance(content, list):
                    for item in content:
                        if isinstance(item, dict):
                            if item.get('type') == 'text':
                                t = item.get('text', '')
                                if t.strip():
                                    last_text = t.strip()[:200]
                            elif item.get('type') == 'tool_use':
                                tool_count += 1
                                name = item.get('name', '')
                                inp = item.get('input', {})
                                if name == 'Bash':
                                    cmd = inp.get('command', '')[:80]
                                    last_tool = f'{name}: {cmd}'
                                elif name in ('Read', 'Write', 'Edit'):
                                    path = inp.get('file_path', '')
                                    last_tool = f'{name}: {path.split(\"/\")[-1]}'
                                elif name in ('Grep', 'Glob'):
                                    pattern = inp.get('pattern', '')
                                    last_tool = f'{name}: {pattern}'
                                else:
                                    last_tool = name
        except (json.JSONDecodeError, KeyError):
            continue

# Output
if is_complete:
    print(f'DONE|{tool_count}|{last_text[:150]}')
else:
    detail = last_progress if last_progress else last_tool if last_tool else last_text[:100]
    print(f'RUNNING|{tool_count}|{detail}')
" 2>/dev/null
}

# Print header
print_header() {
  echo -e "${BOLD}${BLUE}================================================${NC}"
  echo -e "${BOLD}${BLUE}  Subagent Monitor  ${DIM}$(date '+%H:%M:%S')${NC}"
  echo -e "${BOLD}${BLUE}================================================${NC}"
  echo ""
}

# Mode selection
MODE="${1:-live}"

case "$MODE" in
  live)
    # Continuous monitoring with refresh
    while true; do
      clear
      print_header

      if [ ! -d "$TASK_DIR" ]; then
        echo -e "${DIM}  No active subagents (task dir not found)${NC}"
        echo -e "${DIM}  Waiting for subagent tasks...${NC}"
        sleep 3
        continue
      fi

      # Get active output files (modified in last 10 minutes)
      active_files=$(find "$TASK_DIR" -name "*.output" -mmin -10 -type f 2>/dev/null | sort -r)

      if [ -z "$active_files" ]; then
        echo -e "${DIM}  No recent subagent activity (last 10 min)${NC}"
        echo ""
        # Show older completed tasks
        old_files=$(find "$TASK_DIR" -name "*.output" -type f 2>/dev/null | sort -r | head -5)
        if [ -n "$old_files" ]; then
          echo -e "${DIM}  Previous tasks:${NC}"
          for f in $old_files; do
            agent_id=$(basename "$f" .output 2>/dev/null) || continue
            short_id="${agent_id:0:8}"
            agent_type=$(parse_agent_type "$f" 2>/dev/null) || agent_type="general"
            color=$(agent_color "$agent_type")
            mod_time=$(stat -f "%Sm" -t "%H:%M" "$f" 2>/dev/null || echo "??:??")
            echo -e "  ${DIM}${mod_time}${NC} ${color}${agent_type}${NC} ${DIM}[${short_id}]${NC}"
          done
        fi
        sleep 3
        continue
      fi

      running=0
      done_count=0

      for f in $active_files; do
        agent_id=$(basename "$f" .output 2>/dev/null) || continue
        short_id="${agent_id:0:8}"
        agent_type=$(parse_agent_type "$f" 2>/dev/null) || agent_type="general"
        color=$(agent_color "$agent_type")
        mod_time=$(stat -f "%Sm" -t "%H:%M:%S" "$f" 2>/dev/null || echo "??:??:??")

        status_info=$(extract_status "$f" 2>/dev/null) || status_info="RUNNING|0|"
        IFS='|' read -r status tool_count detail <<< "$status_info"
        tool_count="${tool_count:-0}"

        if [ "$status" = "DONE" ]; then
          done_count=$((done_count + 1))
          echo -e "  ${GREEN}[DONE]${NC} ${color}${BOLD}${agent_type}${NC} ${DIM}[${short_id}]${NC} tools:${tool_count}"
          if [ -n "$detail" ]; then
            echo -e "         ${DIM}${detail:0:120}${NC}"
          fi
        else
          running=$((running + 1))
          echo -e "  ${YELLOW}[RUN]${NC}  ${color}${BOLD}${agent_type}${NC} ${DIM}[${short_id}]${NC} tools:${tool_count} ${DIM}${mod_time}${NC}"
          if [ -n "$detail" ]; then
            echo -e "         ${DIM}${detail:0:120}${NC}"
          fi
        fi
        echo ""
      done

      # Summary bar
      echo -e "${BLUE}------------------------------------------------${NC}"
      echo -e "  Running: ${YELLOW}${BOLD}${running}${NC}  Done: ${GREEN}${BOLD}${done_count}${NC}  Total: $((running + done_count))"
      echo ""
      echo -e "${DIM}  Refreshing every 2s... (Ctrl+C to stop)${NC}"
      sleep 2
    done
    ;;

  tail)
    # Tail the most recent output file
    if [ ! -d "$TASK_DIR" ]; then
      echo -e "${RED}No task directory found${NC}"
      exit 1
    fi

    latest=$(ls -t "$TASK_DIR"/*.output 2>/dev/null | head -1)
    if [ -z "$latest" ]; then
      echo -e "${RED}No output files found${NC}"
      exit 1
    fi

    agent_id=$(basename "$latest" .output)
    agent_type=$(parse_agent_type "$latest")
    color=$(agent_color "$agent_type")

    echo -e "${BOLD}Tailing: ${color}${agent_type}${NC} ${DIM}[${agent_id:0:8}]${NC}"
    echo -e "${BLUE}------------------------------------------------${NC}"

    tail -f "$latest" | python3 -c "
import sys, json
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        d = json.loads(line)
        msg_type = d.get('type', '')
        msg = d.get('message', {})

        if msg_type == 'assistant':
            content = msg.get('content', [])
            if isinstance(content, list):
                for item in content:
                    if isinstance(item, dict):
                        if item.get('type') == 'text':
                            print(f'\033[0;32m[TEXT]\033[0m {item[\"text\"][:200]}')
                        elif item.get('type') == 'tool_use':
                            name = item.get('name', '')
                            inp = item.get('input', {})
                            if name == 'Bash':
                                print(f'\033[0;33m[TOOL]\033[0m {name}: {inp.get(\"command\", \"\")[:100]}')
                            else:
                                print(f'\033[0;33m[TOOL]\033[0m {name}')
        elif msg_type == 'progress':
            data = d.get('data', {})
            elapsed = data.get('elapsedTimeSeconds', 0)
            output = data.get('output', '').strip()[:100]
            if output:
                print(f'\033[2m[{elapsed}s]\033[0m {output}')
        elif msg_type == 'result':
            result = msg.get('result', d.get('result', ''))
            if isinstance(result, str):
                print(f'\033[0;32m[RESULT]\033[0m {result[:200]}')
    except:
        pass
    sys.stdout.flush()
"
    ;;

  *)
    echo "Usage: $0 [live|tail]"
    echo ""
    echo "  live  - Real-time dashboard of all active subagents (default)"
    echo "  tail  - Stream latest subagent output in readable format"
    exit 1
    ;;
esac
