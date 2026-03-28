#!/bin/bash
# =============================================================================
# Insighta Work Dashboard v2 — Workflow-Centric Agent Monitor
# =============================================================================
# Sections: ❶Header → ❷NOW → ❸AGENTS → ❹CHANGES → ❺WARNINGS → ❻PIPELINE → ❼TREND
# Design: docs/design/dashboard-refactoring.md
# =============================================================================

set +e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/dashboard-common.sh"
source "$SCRIPT_DIR/lib/cache-util.sh"

# -- Config --------------------------------------------------------------------
CACHE_DIR="/tmp/work-dash-cache"; mkdir -p "$CACHE_DIR" 2>/dev/null

# Auto-detect Claude Code task directories
TASK_DIRS=()
for d in ${CLAUDE_TASK_GLOB:-/private/tmp/claude-*/-Users-jeonhokim-cursor-insighta/*/tasks}; do
  [ -d "$d" ] && TASK_DIRS+=("$d")
done

# Main session JSONL directory (session files are {uuid}.jsonl directly in project dir)
MAIN_SESSION_DIR="${CLAUDE_SESSION_DIR:-${HOME}/.claude/projects/-Users-jeonhokim-cursor-insighta}"
MAIN_SESSION_CACHE="$CACHE_DIR/main_session.dat"
MAIN_WARNINGS_CACHE="$CACHE_DIR/warnings.dat"

# Eval data
EVAL_FILE="${HOME}/.claude/projects/-Users-jeonhokim-cursor-insighta/memory/eval-scores.md"
TREND_CACHE="$CACHE_DIR/trend.dat"

# Spinners
SPINNER_FRAMES=("✽" "✶" "✢" "✦"); SPINNER_LEN=${#SPINNER_FRAMES[@]}

# Agent badge colors
BG_BLUE='\033[44;37m'; BG_CYAN='\033[46;30m'; BG_YELLOW='\033[43;30m'
BG_MAGENTA='\033[45;37m'; BG_GREEN='\033[42;30m'
BG_ORANGE='\033[48;5;208;30m'; BG_TEAL='\033[48;5;37;37m'

agent_badge() { case "$1" in
  backend-dev|backend) echo "${BG_BLUE}API${NC}";;
  frontend-dev|frontend) echo "${BG_CYAN} UI${NC}";;
  test-runner) echo "${BG_YELLOW}TST${NC}";;
  Explore) echo "${BG_TEAL}EXP${NC}";;
  Plan) echo "${BG_ORANGE}PLN${NC}";;
  *) echo "${BG_DIM}${1:0:3}${NC}";;
esac; }

# =============================================================================
# JSONL PARSERS
# =============================================================================

parse_main_session() {
  local latest
  latest=$(ls -t "$MAIN_SESSION_DIR"/*.jsonl 2>/dev/null | head -1)
  [ -z "$latest" ] && echo "INACTIVE|0|0|||||||" > "$MAIN_SESSION_CACHE" && return

  python3 -c "
import json, sys, os, time, collections

fp = '$latest'
mtime = os.path.getmtime(fp)
now = time.time()
elapsed = int(now - mtime)

if elapsed > 300:
    print('INACTIVE|0|0|||||||')
    sys.exit(0)

total_tools = 0
tool_freq = collections.Counter()
last_tool = ''
last_tool_file = ''
task_text = ''
user_texts = []
edit_files = collections.Counter()  # files modified via Edit/Write
read_files = collections.Counter()  # files read via Read
warnings = []

with open(fp, 'r') as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            d = json.loads(line)
            t = d.get('type','')
            msg = d.get('message',{})

            if t == 'user':
                content = msg.get('content','')
                if isinstance(content, str) and len(content.strip()) > 10:
                    user_texts.append(content.strip()[:120])
                elif isinstance(content, list):
                    for c in content:
                        if isinstance(c,dict) and c.get('type')=='text':
                            txt = c.get('text','').strip()
                            if txt and len(txt) > 10:
                                user_texts.append(txt[:120])

            elif t == 'assistant':
                content = msg.get('content',[])
                if isinstance(content, list):
                    for c in content:
                        if not isinstance(c,dict): continue
                        if c.get('type') == 'tool_use':
                            total_tools += 1
                            name = c.get('name','')
                            tool_freq[name] += 1
                            inp = c.get('input', {})
                            fpath = inp.get('file_path','')
                            fname = fpath.split('/')[-1] if fpath else ''

                            if name in ('Edit','Write'):
                                if fpath: edit_files[fname] += 1
                                last_tool = f'{name} {fname}'
                                last_tool_file = fname
                            elif name == 'Read':
                                if fpath: read_files[fname] += 1
                                last_tool = f'Read {fname}'
                                last_tool_file = fname
                            elif name == 'Bash':
                                cmd = inp.get('command','')[:50]
                                last_tool = f'Bash {cmd}'
                            elif name in ('Grep','Glob'):
                                pat = inp.get('pattern','')[:30]
                                last_tool = f'{name} {pat}'
                            elif name == 'Agent':
                                sub = inp.get('subagent_type','')
                                desc = inp.get('description','')[:40]
                                last_tool = f'Agent({sub}) {desc}'
                            else:
                                last_tool = name
        except: continue

# Task: last meaningful user text
task_text = user_texts[-1] if user_texts else ''
# Detect issue reference
for ut in reversed(user_texts):
    if '#' in ut and any(c.isdigit() for c in ut):
        task_text = ut
        break

# Top 3 tools
top3 = ' '.join(f'{n}:{c}' for n,c in tool_freq.most_common(3))

# Modified files summary
mod_files = ' '.join(f'{f}(+{c})' for f,c in edit_files.most_common(5))

# Warnings: repeated reads
for fname, cnt in read_files.most_common(3):
    if cnt >= 5:
        warnings.append(f'Read x{cnt} {fname}')

warn_str = '||'.join(warnings)

print(f'{elapsed}|{total_tools}|{top3}|{last_tool}|{task_text}|{mod_files}|{warn_str}')
" > "$MAIN_SESSION_CACHE" 2>/dev/null
}

parse_subagent() {
  local file="$1"
  python3 -c "
import json, os, time

fp = '$file'
mtime = os.path.getmtime(fp)
elapsed = int(time.time() - os.path.getctime(fp))
status = 'RUNNING'
tool_count = 0
description = ''
last_tools = []
agent_type = 'general'

with open(fp, 'r') as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            d = json.loads(line)
            mt = d.get('type','')
            msg = d.get('message',{})
            if mt == 'result': status = 'DONE'
            elif mt == 'assistant':
                content = msg.get('content',[])
                if isinstance(content, list):
                    for c in content:
                        if not isinstance(c,dict): continue
                        if c.get('type') == 'tool_use':
                            tool_count += 1
                            name = c.get('name','')
                            inp = c.get('input',{})
                            fpath = inp.get('file_path','')
                            fname = fpath.split('/')[-1] if fpath else ''
                            if name in ('Read','Edit','Write','Grep','Glob'):
                                detail = fname or inp.get('pattern','')[:20]
                                last_tools.append(f'{name} {detail}')
                            else:
                                last_tools.append(name)
                            last_tools = last_tools[-3:]
            elif mt == 'user':
                content = msg.get('content','')
                if isinstance(content, list):
                    for c in content:
                        if isinstance(c,dict) and c.get('type')=='tool_use':
                            inp = c.get('input',{})
                            if 'subagent_type' in inp: agent_type = inp['subagent_type']
                            if 'description' in inp and not description:
                                description = inp['description'][:60]
                elif isinstance(content, str) and not description:
                    description = content.strip()[:60]
        except: continue

if status == 'RUNNING' and (time.time() - mtime) > 600: status = 'STALE'
trail = ' → '.join(last_tools[-3:])
print(f'{status}|{agent_type}|{tool_count}|{elapsed}|{description}|{trail}')
" 2>/dev/null || echo "UNKNOWN|general|0|0|parse error|"
}

# =============================================================================
# RENDERERS (workflow order)
# =============================================================================

render_header() {
  local spin="${SPINNER_FRAMES[$SPIN_IDX]}"
  local branch=$(git branch --show-current 2>/dev/null || echo "?")
  local mod=$(git diff --name-only 2>/dev/null | wc -l | tr -d ' ')
  local staged=$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')
  local untracked=$(git ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')
  # Count running agents from parsed cache
  local agent_count=0
  [ -s "$PARSED_CACHE" ] && agent_count=$(grep -c 'RUNNING' "$PARSED_CACHE" 2>/dev/null || echo 0)
  local agent_tag=""
  [ "$agent_count" -gt 0 ] && agent_tag="  ${BG_GREEN} ${agent_count} agents ${NC}"
  echo -e "  ${BD}${B}INSIGHTA${NC} ${D}work${NC}  ${D}${spin} $(date '+%H:%M')${NC}  ${Y}${branch}${NC}  ${D}M:${NC}${Y}${mod}${NC} ${D}S:${NC}${G}${staged}${NC} ${D}?:${NC}${D}${untracked}${NC}${agent_tag}"
}

render_now() {
  [ ! -s "$MAIN_SESSION_CACHE" ] && echo -e "  ${BD}NOW${NC}  ${D}(no active session)${NC}" && return

  local data; data=$(cat "$MAIN_SESSION_CACHE")
  IFS='|' read -r elapsed total top3 last_tool task_text mod_files warn_str <<< "$data"

  if [ "$elapsed" = "INACTIVE" ]; then
    echo -e "  ${BD}NOW${NC}  ${D}(inactive)${NC}"
    return
  fi

  local time_str; time_str=$(format_elapsed "$elapsed")
  local spin="${SPINNER_FRAMES[$SPIN_IDX]}"

  # Task line (truncated)
  local tw=$(( $(dash_cols) - 8 ))
  [ "$tw" -lt 20 ] && tw=20
  local task_display="${task_text:0:$tw}"

  echo -e "  ${BD}NOW${NC}  ${task_display:+${C}${task_display}${NC}}"
  echo -e "   ${G}${spin}${NC} active ${D}${time_str}${NC}  tools:${BD}${total}${NC}  ${D}${top3}${NC}"

  # Last tool
  [ -n "$last_tool" ] && echo -e "   ${D}last:${NC} ${last_tool:0:60}"

  # Modified files
  [ -n "$mod_files" ] && echo -e "   ${D}files:${NC} ${mod_files:0:60}"
}

render_agents() {
  [ ! -s "$PARSED_CACHE" ] && return

  local running=0 done_count=0
  local running_lines="" done_lines=""

  while IFS='|' read -r fpath status atype tools elapsed desc trail; do
    [ -z "$status" ] && continue
    local time_str; time_str=$(format_elapsed "$elapsed")
    local badge; badge=$(agent_badge "$atype")

    if [ "$status" = "RUNNING" ]; then
      running=$((running + 1))
      running_lines+="   ${G}●${NC} ${badge} ${D}${time_str}${NC}  \"${desc:0:40}\"\n"
      [ -n "$trail" ] && running_lines+="     ${D}→ ${trail:0:55}${NC}\n"
    elif [ "$status" = "DONE" ] && [ "$done_count" -lt 2 ]; then
      done_count=$((done_count + 1))
      done_lines+="   ${D}✓${NC} ${badge} ${D}${time_str}${NC}  \"${desc:0:40}\"\n"
    fi
  done < "$PARSED_CACHE"

  [ "$running" -eq 0 ] && [ "$done_count" -eq 0 ] && return

  local label
  if [ "$running" -gt 0 ]; then
    label="${BG_GREEN} ${running} RUNNING ${NC}"
    [ "$done_count" -gt 0 ] && label+="  ${D}${done_count} done${NC}"
  else
    label="${D}${done_count} done${NC}"
  fi
  echo -e "  ${BD}AGENTS${NC}  ${label}"
  [ -n "$running_lines" ] && echo -ne "$running_lines"
  [ -n "$done_lines" ] && echo -ne "$done_lines"
}

render_changes() {
  local changes
  changes=$(git diff --stat --stat-width=60 2>/dev/null | head -5)
  local untracked
  untracked=$(git ls-files --others --exclude-standard 2>/dev/null | head -3)
  local last_commit
  last_commit=$(git log -1 --format="%h %s" 2>/dev/null | head -c 55)

  [ -z "$changes" ] && [ -z "$untracked" ] && [ -z "$last_commit" ] && return

  echo -e "  ${BD}CHANGES${NC}"

  # Modified files with stats
  if [ -n "$changes" ]; then
    while IFS= read -r line; do
      # Skip summary line
      [[ "$line" == *"file"*"changed"* ]] && continue
      echo -e "   ${Y}M${NC}  ${D}${line}${NC}"
    done <<< "$changes"
  fi

  # Untracked
  if [ -n "$untracked" ]; then
    while IFS= read -r f; do
      local fname="${f##*/}"
      echo -e "   ${G}N${NC}  ${D}${fname}${NC}"
    done <<< "$untracked"
  fi

  # Last commit
  [ -n "$last_commit" ] && echo -e "   ${D}· ${last_commit}${NC}"
}

render_warnings() {
  local warns=()

  # From JSONL analysis (repeated reads)
  if [ -s "$MAIN_SESSION_CACHE" ]; then
    local data; data=$(cat "$MAIN_SESSION_CACHE")
    local warn_str="${data##*|}"
    if [ -n "$warn_str" ]; then
      IFS='||' read -ra w_items <<< "$warn_str"
      for w in "${w_items[@]}"; do
        [ -n "$w" ] && warns+=("$w")
      done
    fi
  fi

  # API server check (from shared cache)
  local api_health
  api_health=$(cache_get health_api 30 "$SHARED_CACHE_DIR" 2>/dev/null)
  if [ -z "$api_health" ] || [ "$api_health" = "DOWN" ]; then
    # Quick local check
    local api_code
    api_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 1 localhost:3000/health 2>/dev/null)
    if [ "$api_code" != "200" ]; then
      warns+=("API :3000 down — run npm run api:dev")
      echo "DOWN" | cache_set health_api "$SHARED_CACHE_DIR"
    else
      echo "OK" | cache_set health_api "$SHARED_CACHE_DIR"
    fi
  fi

  # Uncommitted file count
  local total_uncommitted
  total_uncommitted=$(git status --short 2>/dev/null | wc -l | tr -d ' ')
  [ "$total_uncommitted" -ge 10 ] && warns+=("${total_uncommitted} uncommitted files")

  # CI failure (from shared cache)
  local ci_status
  ci_status=$(cache_get ci_latest 300 "$SHARED_CACHE_DIR" 2>/dev/null)
  [[ "$ci_status" == *"failure"* ]] && warns+=("CI failed — check gh run list")

  [ ${#warns[@]} -eq 0 ] && return

  echo -e "  ${BD}${R}WARNINGS${NC}"
  for w in "${warns[@]}"; do
    echo -e "   ${Y}⚠${NC} ${w}"
  done
}

render_pipeline() {
  # Stage 1: uncommitted
  local uncommitted
  uncommitted=$(git status --short 2>/dev/null | wc -l | tr -d ' ')
  local stage1
  if [ "$uncommitted" -gt 0 ]; then
    stage1="${Y}uncommitted ${uncommitted}${NC}"
  else
    stage1="${G}clean${NC}"
  fi

  # Stage 2: CI (from shared cache or quick check)
  local ci_data stage2
  ci_data=$(cache_get ci_latest 300 "$SHARED_CACHE_DIR" 2>/dev/null)
  if [ -n "$ci_data" ]; then
    IFS='|' read -r ci_status ci_run ci_ago <<< "$ci_data"
    local ci_short="${ci_run: -4}"  # last 4 digits of run ID
    if [ "$ci_status" = "success" ]; then
      stage2="${G}● #${ci_short} ${ci_ago}${NC}"
    else
      stage2="${R}⊘ #${ci_short} ${ci_ago}${NC}"
    fi
  else
    stage2="${D}?${NC}"
  fi

  # Stage 3: prod (from shared cache)
  local prod_data stage3
  prod_data=$(cache_get health_prod 60 "$SHARED_CACHE_DIR" 2>/dev/null)
  if [ -n "$prod_data" ] && [ "$prod_data" != "DOWN" ]; then
    stage3="${G}● prod${NC}"
  elif [ "$prod_data" = "DOWN" ]; then
    stage3="${R}⊘ prod${NC}"
  else
    stage3="${D}?${NC}"
  fi

  echo -e "  ${BD}PIPELINE${NC}  ${D}commit → CI → deploy${NC}"
  echo -e "   [${stage1}] → [CI ${stage2}] → [${stage3}]"
}

render_trend() {
  # Only render if enough screen space
  local rows; rows=$(dash_rows)
  [ "$rows" -lt 25 ] && return

  # Refresh trend cache every 5 minutes
  local trend_age; trend_age=$(cache_age trend "$CACHE_DIR")
  if [ "$trend_age" -ge 300 ] && [ -f "$EVAL_FILE" ]; then
    tail -25 "$EVAL_FILE" | python3 -c "
import sys, re

scores = []
d2_streak = 0
last_d2 = 0.0

for line in sys.stdin:
    line = line.strip()
    # Match epoch log rows: | N | date | CP# | D1 | D2 | D3 | D4 | D5 | Eval |
    m = re.match(r'^\|\s*(\d+)\s*\|.*?\|.*?\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*\*\*([\d.]+)\*\*', line)
    if m:
        epoch = int(m.group(1))
        d1, d2, d3, d4, d5, ev = [float(m.group(i)) for i in range(2,8)]
        scores.append((epoch, ev, d2))

if not scores:
    print('NO_DATA')
    sys.exit(0)

# D2 streak (consecutive 1.00)
d2_streak = 0
for _, _, d2 in reversed(scores):
    if d2 >= 1.0: d2_streak += 1
    else: break

# Last 3 avg
last3 = scores[-3:] if len(scores) >= 3 else scores
avg = sum(e for _,e,_ in last3) / len(last3)

# Prev 3 avg (for trend arrow)
prev3 = scores[-6:-3] if len(scores) >= 6 else scores[:len(scores)//2] if len(scores) > 1 else scores
prev_avg = sum(e for _,e,_ in prev3) / len(prev3)

arrow = '▲' if avg > prev_avg + 0.005 else '▼' if avg < prev_avg - 0.005 else '─'

# Last D2
last_d2 = scores[-1][2]

# ASCII sparkline (last 20, 4 rows)
recent = [e for _,e,_ in scores[-20:]]
lines = []
for threshold in [1.0, 0.9, 0.8, 0.7]:
    row = f'{threshold:.1f} ┤'
    for v in recent:
        row += '·' if v >= threshold else ' '
    lines.append(row)
lines.append('     └' + '─' * len(recent))

# Summary line
summary = f'Eval {avg:.2f} {arrow}  D2:{last_d2:.2f}({d2_streak}x)'

# First epoch and last epoch for axis labels
first_e = scores[-min(20,len(scores))][0]
last_e = scores[-1][0]
axis = f'      E{first_e}' + ' ' * max(0, len(recent) - 8) + f'E{last_e}'

print(summary)
for l in lines:
    print(l)
print(axis)
" > "$TREND_CACHE" 2>/dev/null
  fi

  [ ! -s "$TREND_CACHE" ] && return
  local first_line; first_line=$(head -1 "$TREND_CACHE")
  [ "$first_line" = "NO_DATA" ] && return

  echo -e "  ${BD}TREND${NC}  ${D}${first_line}${NC}"
  tail -n +2 "$TREND_CACHE" | while IFS= read -r line; do
    echo -e "   ${D}${line}${NC}"
  done
}

# =============================================================================
# MAIN LOOP
# =============================================================================
TMPBUF=$(mktemp /tmp/work-dash-buf.XXXXXX)
PARSED_CACHE=$(mktemp /tmp/work-dash-agents.XXXXXX)
PARSED_CACHE_TMP=$(mktemp /tmp/work-dash-agents-tmp.XXXXXX)

trap 'rm -f "$TMPBUF" "$PARSED_CACHE" "$PARSED_CACHE_TMP" "$MAIN_SESSION_CACHE" "$MAIN_WARNINGS_CACHE" "$TREND_CACHE"; dash_cleanup' EXIT
tput civis 2>/dev/null

prev_cols=0; prev_rows=0; SPIN_IDX=0; LAST_PARSE=0

while true; do
  SPIN_IDX=$(( (SPIN_IDX + 1) % SPINNER_LEN ))

  # Refresh parse caches every 3s
  NOW=$(date +%s)
  if [ $((NOW - LAST_PARSE)) -ge 3 ]; then
    : > "$PARSED_CACHE_TMP" 2>/dev/null

    # Parse sub-agents
    if [ ${#TASK_DIRS[@]} -gt 0 ]; then
      find -L "${TASK_DIRS[@]}" -name "*.output" -type f 2>/dev/null | \
        xargs ls -t 2>/dev/null | head -15 | while read -r f; do
          [ ! -f "$f" ] && continue
          [ "$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo 0)" -eq 0 ] && continue
          local_info=$(parse_subagent "$f" 2>/dev/null)
          echo "${local_info}" >> "$PARSED_CACHE_TMP"
        done
    fi
    mv -f "$PARSED_CACHE_TMP" "$PARSED_CACHE" 2>/dev/null
    PARSED_CACHE_TMP=$(mktemp /tmp/work-dash-agents-tmp.XXXXXX)

    parse_main_session
    LAST_PARSE=$NOW
  fi

  # Render all sections
  {
    render_header
    render_now
    render_agents
    render_changes
    render_warnings
    render_pipeline
    render_trend
  } > "$TMPBUF" 2>/dev/null

  # Terminal resize detection
  local_cols=$(dash_cols); local_rows=$(dash_rows)
  if [ "$local_cols" != "$prev_cols" ] || [ "$local_rows" != "$prev_rows" ]; then
    clear; prev_cols="$local_cols"; prev_rows="$local_rows"
  fi

  tput home 2>/dev/null
  truncate_to_terminal "$TMPBUF"

  sleep 0.15
done
