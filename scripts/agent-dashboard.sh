#!/bin/bash
# =============================================================================
# Insighta Agent Dashboard — Unified Team Agent Monitor
# =============================================================================
# Combines subagent status, file activity, and git overview into one view.
# Designed for a tmux side-pane. Robust: no set -e, all errors handled.
#
# Environment toggles:
#   SHOW_TEAM=0|1   Show/hide TEAM roster section (default: 1)
#   SHOW_STATS=0|1  Show/hide delegation stats section (default: 1)
# =============================================================================

set +e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT" 2>/dev/null

# Toggles (default on)
SHOW_TEAM="${SHOW_TEAM:-1}"
SHOW_STATS="${SHOW_STATS:-1}"

# Auto-detect Claude Code task directory
TASK_DIR=""
for d in /private/tmp/claude-*/-Users-jeonhokim-cursor-sync-youtube-playlists/tasks; do
  [ -d "$d" ] && TASK_DIR="$d" && break
done

# ── Colors & Symbols ──────────────────────────────────────────────────────────
# Base colors
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'
C='\033[0;36m'; M='\033[0;35m'; W='\033[0;37m'; D='\033[2m'
BD='\033[1m'; UL='\033[4m'; NC='\033[0m'
# Extended 256-color for unique agent colors (no duplicates)
C_ORANGE='\033[38;5;208m'; C_LIME='\033[38;5;118m'; C_PINK='\033[38;5;213m'
C_TEAL='\033[38;5;37m'; C_GOLD='\033[38;5;220m'; C_LAVENDER='\033[38;5;183m'
# Background badges (unique per agent — no duplicates)
BG_BLUE='\033[44;37m'       # backend-dev   (blue)
BG_CYAN='\033[46;30m'       # frontend-dev  (cyan)
BG_YELLOW='\033[43;30m'     # test-runner   (yellow)
BG_MAGENTA='\033[45;37m'    # adapter-dev   (magenta)
BG_RED='\033[41;37m'        # supabase-dev  (red)
BG_GREEN='\033[42;30m'      # sync-dev      (green)
BG_ORANGE='\033[48;5;208;30m' # architect   (orange)
BG_PINK='\033[48;5;204;30m'   # security    (pink)
BG_TEAL='\033[48;5;37;37m'    # ux-designer (teal)
BG_LAVENDER='\033[48;5;183;30m' # ai-integ  (lavender)
BG_GOLD='\033[48;5;220;30m'   # pm         (gold)
BG_DIM='\033[48;5;240;37m'    # docs-writer (gray)

# Agent color mapping — each agent has a UNIQUE foreground color
agent_color()  { case "$1" in
  pm)                 echo "$C_GOLD";;
  backend-dev)        echo "$B";;
  frontend-dev)       echo "$C";;
  test-runner)        echo "$Y";;
  adapter-dev)        echo "$M";;
  supabase-dev)       echo "$R";;
  sync-dev)           echo "$G";;
  docs-writer)        echo "$D";;
  security-auditor)   echo "$C_PINK";;
  architect)          echo "$C_ORANGE";;
  ux-designer)        echo "$C_TEAL";;
  ai-integration-dev) echo "$C_LAVENDER";;
  *)                  echo "$W";;
esac; }

# Agent badge — each agent has a UNIQUE background color
agent_badge()  { case "$1" in
  pm)                 echo "${BG_GOLD} PM  ${NC}";;
  backend-dev)        echo "${BG_BLUE} API ${NC}";;
  frontend-dev)       echo "${BG_CYAN} UI  ${NC}";;
  test-runner)        echo "${BG_YELLOW} TST ${NC}";;
  adapter-dev)        echo "${BG_MAGENTA} ADP ${NC}";;
  supabase-dev)       echo "${BG_RED} SB  ${NC}";;
  sync-dev)           echo "${BG_GREEN} SYN ${NC}";;
  docs-writer)        echo "${BG_DIM} DOC ${NC}";;
  architect)          echo "${BG_ORANGE} ARC ${NC}";;
  security-auditor)   echo "${BG_PINK} SEC ${NC}";;
  ux-designer)        echo "${BG_TEAL} UXD ${NC}";;
  ai-integration-dev) echo "${BG_LAVENDER} AI  ${NC}";;
  *)                  echo "${D} GEN ${NC}";;
esac; }

# File path → agent detection
detect_agent() { case "$1" in
  */adapters/*) echo "adapter-dev";;
  */frontend/*|*/components/*|*/hooks/*) echo "frontend-dev";;
  */api/*|*/routes/*) echo "backend-dev";;
  */sync/*|*/scheduler/*) echo "sync-dev";;
  *test*|*spec*) echo "test-runner";;
  */docs/*|*.md) echo "docs-writer";;
  */prisma/*) echo "backend-dev";;
  */docker*|*.yml) echo "supabase-dev";;
  */ai/*|*/llm/*) echo "ai-integration-dev";;
  *) echo "general";;
esac; }

# ── Subagent Status Parser ────────────────────────────────────────────────────
parse_subagent() {
  local file="$1"
  python3 -c "
import sys, json, os, time

file_path = '$file'
mtime = os.path.getmtime(file_path)
elapsed_total = int(time.time() - os.path.getctime(file_path))

agent_type = 'general'
description = ''
prompt_summary = ''
status = 'RUNNING'
tool_count = 0
last_tool = ''
last_text = ''
tools_used = set()
files_touched = set()
first_prompt = ''
all_text = ''

with open(file_path, 'r') as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            d = json.loads(line)
            msg_type = d.get('type', '')
            msg = d.get('message', {})

            if msg_type == 'result':
                status = 'DONE'
                r = msg.get('result', d.get('result', ''))
                if isinstance(r, str): last_text = r[:200]
            elif msg_type == 'assistant':
                content = msg.get('content', [])
                if isinstance(content, list):
                    for item in content:
                        if not isinstance(item, dict): continue
                        if item.get('type') == 'text':
                            t = item.get('text', '').strip()
                            if t:
                                last_text = t[:200]
                                if len(all_text) < 1000: all_text += ' ' + t[:200]
                        elif item.get('type') == 'tool_use':
                            tool_count += 1
                            name = item.get('name', '')
                            tools_used.add(name)
                            inp = item.get('input', {})
                            if name == 'Bash':
                                last_tool = 'Bash: ' + inp.get('command', '')[:60]
                            elif name in ('Read','Write','Edit'):
                                p = inp.get('file_path', '')
                                fname = p.split('/')[-1]
                                files_touched.add(fname)
                                last_tool = name + ': ' + fname
                            elif name in ('Grep','Glob'):
                                last_tool = name + ': ' + inp.get('pattern', '')[:40]
                            elif name == 'Agent':
                                sub = inp.get('subagent_type', 'general')
                                desc = inp.get('description', '')
                                last_tool = 'Agent(' + sub + '): ' + desc
                                agent_type = sub
                            else:
                                last_tool = name
                elif isinstance(content, str):
                    if len(all_text) < 1000: all_text += ' ' + content[:200]
            elif msg_type == 'user':
                # Extract agent description and prompt from initial user message
                content = msg.get('content', '')
                if isinstance(content, str) and not description:
                    if not first_prompt:
                        first_prompt = content[:500]
                    lines = content.strip().split('\\n')
                    prompt_summary = lines[0][:120] if lines else ''
                elif isinstance(content, list):
                    for item in content:
                        if not isinstance(item, dict): continue
                        if item.get('type') == 'tool_use':
                            inp = item.get('input', {})
                            if 'subagent_type' in inp:
                                agent_type = inp['subagent_type']
                            if 'description' in inp and not description:
                                description = inp['description']
                            if 'prompt' in inp and not prompt_summary:
                                prompt_summary = inp['prompt'][:120]
                                if not first_prompt:
                                    first_prompt = inp.get('prompt', '')[:500]
                        elif item.get('type') == 'text':
                            t = item.get('text', '').strip()
                            if t and not first_prompt:
                                first_prompt = t[:500]
        except: continue

# Use all_text as fallback if first_prompt is empty
if not first_prompt and all_text:
    first_prompt = all_text[:500]

# --- Agent type detection (multi-strategy) ---
# Strategy 1: Explicit agent type name in first prompt (highest priority)
if agent_type == 'general' and first_prompt:
    fp_lower = first_prompt.lower()
    for et in ['pm','backend-dev','frontend-dev','adapter-dev','supabase-dev',
               'sync-dev','test-runner','docs-writer','architect',
               'security-auditor','ai-integration-dev','ux-designer']:
        if et in fp_lower:
            agent_type = et
            break

# Strategy 2: Extended keyword matching (Korean + English)
if agent_type == 'general' and first_prompt:
    fp_lower = first_prompt.lower()
    keyword_map = [
        # PM
        ('project manager', 'pm'), ('quality gate', 'pm'), ('final report', 'pm'),
        ('최종 검증', 'pm'), ('성공 판정', 'pm'),
        # Frontend
        ('frontend', 'frontend-dev'), ('react', 'frontend-dev'), ('component', 'frontend-dev'),
        ('ui ', 'frontend-dev'), ('훅', 'frontend-dev'), ('컴포넌트', 'frontend-dev'),
        ('tsx', 'frontend-dev'), ('jsx', 'frontend-dev'),
        # Backend
        ('backend', 'backend-dev'), ('api', 'backend-dev'), ('prisma', 'backend-dev'),
        ('서버', 'backend-dev'), ('엔드포인트', 'backend-dev'),
        # Test
        ('test', 'test-runner'), ('e2e', 'test-runner'), ('vitest', 'test-runner'),
        ('playwright', 'test-runner'), ('테스트', 'test-runner'), ('검증', 'test-runner'),
        ('jest', 'test-runner'), ('spec', 'test-runner'),
        # Supabase
        ('supabase', 'supabase-dev'), ('edge func', 'supabase-dev'), ('docker', 'supabase-dev'),
        # Security
        ('security', 'security-auditor'), ('보안', 'security-auditor'), ('vulnerability', 'security-auditor'),
        # Architect
        ('architect', 'architect'), ('아키텍처', 'architect'), ('설계', 'architect'),
        # UX
        ('ux', 'ux-designer'), ('accessibility', 'ux-designer'), ('접근성', 'ux-designer'),
        ('wcag', 'ux-designer'), ('a11y', 'ux-designer'),
        # AI
        ('ai ', 'ai-integration-dev'), ('llm', 'ai-integration-dev'), ('요약', 'ai-integration-dev'),
        ('summariz', 'ai-integration-dev'),
        # Docs
        ('document', 'docs-writer'), ('문서', 'docs-writer'),
        # Sync
        ('sync', 'sync-dev'), ('동기화', 'sync-dev'),
        # Adapter
        ('adapter', 'adapter-dev'), ('어댑터', 'adapter-dev'),
        # Explore (maps to general but at least tried)
        ('explore', 'general'), ('조사', 'general'), ('분석', 'general'),
        ('debug', 'general'), ('review', 'general'),
    ]
    for kw, at in keyword_map:
        if kw in fp_lower:
            agent_type = at
            break

# Strategy 3: File path pattern detection (fallback)
if agent_type == 'general' and files_touched:
    for fname in files_touched:
        fl = fname.lower()
        if fl.endswith(('.tsx','.jsx','.css','.scss')):
            agent_type = 'frontend-dev'; break
        elif 'test' in fl or 'spec' in fl:
            agent_type = 'test-runner'; break
        elif 'supabase' in fl or 'edge' in fl:
            agent_type = 'supabase-dev'; break
        elif fl.endswith('.prisma'):
            agent_type = 'backend-dev'; break
        elif fl.endswith('.md'):
            agent_type = 'docs-writer'; break

import re
ansi_strip = re.compile(r'\x1b\[[0-9;]*m|\\033\[[0-9;]*m')
def clean(s): return ansi_strip.sub('', s).replace('|', '/').replace('\n', ' ').strip()

tools_str = ','.join(sorted(tools_used)[:5])
files_str = ','.join(sorted(files_touched)[:5])
detail = clean(last_tool if last_tool else last_text[:100])
task_desc = clean(description if description else prompt_summary[:80])
# Validate agent_type is a known value
KNOWN_TYPES = {'pm','backend-dev','frontend-dev','adapter-dev','supabase-dev',
               'sync-dev','test-runner','docs-writer','architect',
               'security-auditor','ai-integration-dev','ux-designer','general'}
if agent_type not in KNOWN_TYPES:
    agent_type = 'general'

# Detect stale agents: RUNNING but file not modified in >5 minutes
if status == 'RUNNING' and (time.time() - mtime) > 300:
    status = 'STALE'

# FORMAT: status|agent_type|tool_count|elapsed|tools_str|detail|task_desc|files_str
print(f'{status}|{agent_type}|{tool_count}|{elapsed_total}|{tools_str}|{detail}|{task_desc}|{files_str}')
" 2>/dev/null || echo "UNKNOWN|general|0|0|||parse error|"
}

# ── Time Formatting ───────────────────────────────────────────────────────────
fmt_elapsed() {
  local s="$1"
  if [ "$s" -ge 3600 ]; then echo "$((s/3600))h$((s%3600/60))m"
  elif [ "$s" -ge 60 ]; then echo "$((s/60))m$((s%60))s"
  else echo "${s}s"
  fi
}

# ── Progress Bar ──────────────────────────────────────────────────────────────
progress_bar() {
  local width=$1 pct=$2
  local filled=$((width * pct / 100))
  local empty=$((width - filled))
  printf "${G}"
  printf '%.0s█' $(seq 1 $filled 2>/dev/null) 2>/dev/null
  printf "${D}"
  printf '%.0s░' $(seq 1 $empty 2>/dev/null) 2>/dev/null
  printf "${NC}"
}

# ── Section Renderers ─────────────────────────────────────────────────────────

render_header() {
  echo -e "${BD}${B}  INSIGHTA AGENT DASHBOARD${NC}  ${D}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
}

render_project_status() {
  local branch=$(git branch --show-current 2>/dev/null || echo "?")
  local modified=$(git diff --name-only 2>/dev/null | wc -l | tr -d ' ')
  local staged=$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')
  local untracked=$(git ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')
  local last_commit=$(git log -1 --format="%h %s" 2>/dev/null | head -c 60)
  echo -e "  ${BD}PROJECT${NC}  ${D}branch:${NC}${Y}${branch}${NC}  ${D}mod:${NC}${Y}${modified}${NC}  ${D}staged:${NC}${G}${staged}${NC}  ${D}new:${NC}${D}${untracked}${NC}"
  echo -e "  ${D}latest: ${last_commit}${NC}"
}

render_team() {
  [ "$SHOW_TEAM" = "0" ] && return
  echo -e "  ${BD}TEAM${NC}  ${D}(agent roster)${NC}"

  # Use cached parse results (populated by render_agents) for running agent types
  local running_agents=""
  if [ -n "$PARSED_CACHE" ] && [ -f "$PARSED_CACHE" ]; then
    running_agents=$(while IFS='|' read -r _file status agent_type _rest; do
      [ "$status" = "RUNNING" ] && echo "$agent_type"
    done < "$PARSED_CACHE" | sort -u)
  fi

  # Agent roster: badge, name, role, blink indicator for running agents
  local agents=(
    "pm|Final verification, quality gate"
    "backend-dev|API, Prisma, services"
    "frontend-dev|React, hooks, components"
    "adapter-dev|OAuth, Feed, File adapters"
    "supabase-dev|Edge Functions, Docker, Auth"
    "sync-dev|Sync logic, scheduling"
    "test-runner|Test writing & execution"
    "docs-writer|Technical documentation"
    "architect|System design, tech decisions"
    "security-auditor|Security audit, vulnerability"
    "ai-integration-dev|AI integration, summarization"
    "ux-designer|UX/a11y audit (read-only)"
  )

  for entry in "${agents[@]}"; do
    local name="${entry%%|*}"
    local role="${entry#*|}"
    local badge=$(agent_badge "$name")
    local active_mark="  "
    if echo "$running_agents" | grep -q "^${name}$" 2>/dev/null; then
      # Blink effect: toggle * on/off each cycle
      if [ "$BLINK_TICK" -eq 0 ]; then
        active_mark="${G}*${NC} "
      else
        active_mark="  "
      fi
    fi
    printf "  %b%b %-22s ${D}%s${NC}\n" "$active_mark" "$badge" "$name" "$role"
  done
}

render_agents() {
  echo -e "  ${BD}AGENTS${NC}"

  if [ -z "$TASK_DIR" ] || [ ! -d "$TASK_DIR" ]; then
    echo -e "  ${D}  No task directory detected${NC}"
    return
  fi

  # Read from pre-populated cache
  if [ ! -s "$PARSED_CACHE" ]; then
    # Fallback: check for older tasks if cache is empty
    local old_files=$(find -L "$TASK_DIR" -name "*.output" -type f 2>/dev/null | sort -r | head -5)
    if [ -z "$old_files" ]; then
      echo -e "  ${D}  No agent activity${NC}"
      return
    fi
    echo -e "  ${D}  (showing recent history)${NC}"
    for f in $old_files; do
      local_info=$(parse_subagent "$f" 2>/dev/null)
      echo "${f}|${local_info}" >> "$PARSED_CACHE"
    done
  fi

  local running=0 done=0 total=0
  while IFS='|' read -r f status agent_type tool_count elapsed tools_str detail task_desc files_str; do
    local agent_id=$(basename "$f" .output 2>/dev/null) || continue
    local short_id="${agent_id:0:7}"

    tool_count="${tool_count:-0}"
    elapsed="${elapsed:-0}"
    total=$((total + 1))

    local badge=$(agent_badge "$agent_type")
    local time_str=$(fmt_elapsed "$elapsed")

    if [ "$status" = "DONE" ]; then
      done=$((done + 1))
      echo -e "  ${G}✓${NC} ${badge} ${D}${short_id}${NC}  ${D}${time_str}${NC}  tools:${BD}${tool_count}${NC}  ${D}[${tools_str}]${NC}"
      [ -n "$task_desc" ] && echo -e "    ${D}└─ ${task_desc:0:60}${NC}"
    elif [ "$status" = "STALE" ]; then
      done=$((done + 1))
      echo -e "  ${D}✗${NC} ${badge} ${D}${short_id}${NC}  ${D}${time_str}${NC}  tools:${BD}${tool_count}${NC}  ${R}(stale)${NC}"
    elif [ "$status" = "RUNNING" ]; then
      running=$((running + 1))
      echo -e "  ${Y}●${NC} ${badge} ${D}${short_id}${NC}  ${Y}${time_str}${NC}  tools:${BD}${tool_count}${NC}  ${D}[${tools_str}]${NC}"
      [ -n "$task_desc" ] && echo -e "    ${D}└─ ${task_desc:0:60}${NC}"
    else
      echo -e "  ${D}?${NC} ${badge} ${D}${short_id}${NC}  ${D}${time_str}${NC}"
    fi
  done < "$PARSED_CACHE"

  echo -e "  ${D}──${NC} ${Y}●${NC} running:${BD}${running}${NC}  ${G}✓${NC} done:${BD}${done}${NC}  total:${D}${total}${NC}"
}

render_delegation_stats() {
  [ "$SHOW_STATS" = "0" ] && return
  echo -e "  ${BD}DELEGATION STATS${NC}  ${D}(last 24h)${NC}"

  if [ -z "$TASK_DIR" ] || [ ! -d "$TASK_DIR" ]; then
    echo -e "  ${D}  No data available${NC}"
    return
  fi

  # Count tasks per agent type in last 24h
  local stats=$(find -L "$TASK_DIR" -name "*.output" -mmin -1440 -type f 2>/dev/null | while read -r f; do
    parse_subagent "$f" 2>/dev/null | cut -d'|' -f2
  done | sort | uniq -c | sort -rn)

  if [ -z "$stats" ]; then
    echo -e "  ${D}  No delegations in last 24h${NC}"
    return
  fi

  # Find max count for bar scaling
  local max_count=$(echo "$stats" | head -1 | awk '{print $1}')
  [ "$max_count" -eq 0 ] 2>/dev/null && max_count=1

  # Scale bar to available width (leave room for badge + name + count)
  local cols=$(tput cols 2>/dev/null || echo 80)
  local bar_width=$(( (cols - 30) > 5 ? (cols - 30) : 5 ))
  [ "$bar_width" -gt 30 ] && bar_width=30

  echo "$stats" | while read -r count agent_type; do
    [ -z "$agent_type" ] && continue
    local badge=$(agent_badge "$agent_type")
    local bar_len=$((count * bar_width / max_count))
    [ "$bar_len" -eq 0 ] && bar_len=1

    local bar=""
    for ((i=0; i<bar_len; i++)); do bar+="█"; done

    local color=$(agent_color "$agent_type")
    printf "  %b %-14s %b%b${NC} %d\n" "$badge" "$agent_type" "$color" "$bar" "$count"
  done
}

render_file_activity() {
  echo -e "  ${BD}FILE CHANGES${NC}  ${D}(git working tree)${NC}"

  # Collect all changed files into an array
  local files_list
  files_list=$({
    git diff --name-only 2>/dev/null
    git diff --cached --name-only 2>/dev/null
    git ls-files --others --exclude-standard 2>/dev/null
  } | sort -u)

  if [ -z "$files_list" ]; then
    echo -e "  ${D}  Working tree clean${NC}"
    return
  fi

  echo "$files_list" | while read -r f; do
    [ -z "$f" ] && continue
    local agent=$(detect_agent "$f")
    local badge=$(agent_badge "$agent")

    local ext="${f##*.}"
    local icon
    case "$ext" in
      ts|tsx) icon="TS";;  js|jsx) icon="JS";;  css|scss) icon="SS";;
      md) icon="MD";;  json) icon="CF";;  prisma) icon="DB";;
      sh) icon="SH";;  yml|yaml) icon="YM";;  *) icon="  ";;
    esac

    echo -e "  ${badge} ${D}${icon}${NC} ${f}"
  done
}

render_footer() {
  echo -e "${D}  refresh: 1.5s │ Ctrl+C: exit │ SHOW_TEAM=${SHOW_TEAM} SHOW_STATS=${SHOW_STATS} │ agents: $(basename "$TASK_DIR" 2>/dev/null || echo 'none')${NC}"
}

# ── Terminal-safe output ──────────────────────────────────────────────────────
# Strip ANSI codes and measure visible width, then truncate to terminal columns.
# This prevents line-wrapping that breaks the tput-home redraw approach.

strip_ansi() { sed 's/\x1b\[[0-9;]*m//g'; }

# Print buffer line-by-line, each truncated to $COLUMNS visible chars.
# After content, fill remaining screen rows with blank lines to erase stale data.
print_truncated() {
  local cols=$(tput cols 2>/dev/null || echo 80)
  local rows=$(tput lines 2>/dev/null || echo 40)

  # Process buffer: truncate wide lines, clear EOL residual, limit to pane height
  python3 -u -c "
import sys, re, os

cols = $cols
rows = $rows - 1
ansi_re = re.compile(r'\x1b\[[0-9;]*m')
EL = '\x1b[K'      # clear to end of line
RESET = '\x1b[0m'
ED = '\x1b[J'       # clear to end of screen
line_num = 0

for raw_line in sys.stdin:
    if line_num >= rows:
        break
    line = raw_line.rstrip('\n')
    visible_len = len(ansi_re.sub('', line))

    if visible_len > cols:
        out = []
        vis = 0
        i = 0
        inside_esc = False
        while i < len(line):
            ch = line[i]
            if ch == '\x1b':
                inside_esc = True
                out.append(ch)
                i += 1
                continue
            if inside_esc:
                out.append(ch)
                if ch == 'm':
                    inside_esc = False
                i += 1
                continue
            vis += 1
            if vis > cols:
                break
            out.append(ch)
            i += 1
        os.write(1, (''.join(out) + RESET + EL + '\n').encode())
    else:
        os.write(1, (line + RESET + EL + '\n').encode())
    line_num += 1

# Clear all remaining lines below
os.write(1, ED.encode())
" < "$1"
}

# ── Main Loop (flicker-free) ──────────────────────────────────────────────────
TMPBUF=$(mktemp /tmp/dash-buf.XXXXXX)
PARSED_CACHE=$(mktemp /tmp/dash-parsed.XXXXXX)
trap 'rm -f "$TMPBUF" "$PARSED_CACHE"; tput cnorm 2>/dev/null' EXIT

tput civis 2>/dev/null  # hide cursor

prev_cols=0
prev_rows=0
BLINK_TICK=0

while true; do
  BLINK_TICK=$(( (BLINK_TICK + 1) % 2 ))

  # Pre-populate parse cache (used by render_team and render_agents)
  : > "$PARSED_CACHE" 2>/dev/null
  if [ -n "$TASK_DIR" ] && [ -d "$TASK_DIR" ]; then
    find -L "$TASK_DIR" -name "*.output" -mmin -30 -type f 2>/dev/null | sort -r | while read -r f; do
      local_info=$(parse_subagent "$f" 2>/dev/null)
      echo "${f}|${local_info}" >> "$PARSED_CACHE"
    done
  fi

  {
    render_header
    render_project_status
    render_team
    render_agents
    render_delegation_stats
    render_file_activity
    render_footer
  } > "$TMPBUF" 2>/dev/null

  # Detect terminal resize → full clear
  local_cols=$(tput cols 2>/dev/null || echo 80)
  local_rows=$(tput lines 2>/dev/null || echo 40)
  if [ "$local_cols" != "$prev_cols" ] || [ "$local_rows" != "$prev_rows" ]; then
    clear
    prev_cols="$local_cols"
    prev_rows="$local_rows"
  fi

  tput home 2>/dev/null
  print_truncated "$TMPBUF"

  sleep 1.5
done
