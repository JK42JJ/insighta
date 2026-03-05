#!/bin/bash
# =============================================================================
# Insighta Agent Dashboard — Interactive Agent Monitor
# =============================================================================
# Real-time agent status with animated spinners (Claude Code style).
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

# -- Colors & Symbols ---------------------------------------------------------
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'
C='\033[0;36m'; M='\033[0;35m'; W='\033[0;37m'; D='\033[2m'
BD='\033[1m'; UL='\033[4m'; NC='\033[0m'
C_ORANGE='\033[38;5;208m'; C_LIME='\033[38;5;118m'; C_PINK='\033[38;5;213m'
C_TEAL='\033[38;5;37m'; C_GOLD='\033[38;5;220m'; C_LAVENDER='\033[38;5;183m'

# Background badges (unique per agent)
BG_BLUE='\033[44;37m'; BG_CYAN='\033[46;30m'; BG_YELLOW='\033[43;30m'
BG_MAGENTA='\033[45;37m'; BG_RED='\033[41;37m'; BG_GREEN='\033[42;30m'
BG_ORANGE='\033[48;5;208;30m'; BG_PINK='\033[48;5;204;30m'
BG_TEAL='\033[48;5;37;37m'; BG_LAVENDER='\033[48;5;183;30m'
BG_GOLD='\033[48;5;220;30m'; BG_DIM='\033[48;5;240;37m'

# Animated spinner frames (Claude Code style)
SPINNER_FRAMES=("✽" "✶" "✢" "✦")
SPINNER_LEN=${#SPINNER_FRAMES[@]}

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

# -- Subagent Status Parser ---------------------------------------------------
parse_subagent() {
  local file="$1"
  python3 -c "
import sys, json, os, time, re

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

if not first_prompt and all_text:
    first_prompt = all_text[:500]

# --- Agent type detection (multi-strategy) ---
if agent_type == 'general' and first_prompt:
    fp_lower = first_prompt.lower()
    for et in ['pm','backend-dev','frontend-dev','adapter-dev','supabase-dev',
               'sync-dev','test-runner','docs-writer','architect',
               'security-auditor','ai-integration-dev','ux-designer']:
        if et in fp_lower:
            agent_type = et
            break

if agent_type == 'general' and first_prompt:
    fp_lower = first_prompt.lower()
    keyword_map = [
        ('project manager', 'pm'), ('quality gate', 'pm'), ('final report', 'pm'),
        ('frontend', 'frontend-dev'), ('react', 'frontend-dev'), ('component', 'frontend-dev'),
        ('ui ', 'frontend-dev'), ('tsx', 'frontend-dev'), ('jsx', 'frontend-dev'),
        ('backend', 'backend-dev'), ('api', 'backend-dev'), ('prisma', 'backend-dev'),
        ('test', 'test-runner'), ('e2e', 'test-runner'), ('vitest', 'test-runner'),
        ('playwright', 'test-runner'), ('jest', 'test-runner'), ('spec', 'test-runner'),
        ('supabase', 'supabase-dev'), ('edge func', 'supabase-dev'), ('docker', 'supabase-dev'),
        ('security', 'security-auditor'), ('vulnerability', 'security-auditor'),
        ('architect', 'architect'),
        ('ux', 'ux-designer'), ('accessibility', 'ux-designer'), ('a11y', 'ux-designer'),
        ('ai ', 'ai-integration-dev'), ('llm', 'ai-integration-dev'), ('summariz', 'ai-integration-dev'),
        ('document', 'docs-writer'),
        ('sync', 'sync-dev'),
        ('adapter', 'adapter-dev'),
    ]
    for kw, at in keyword_map:
        if kw in fp_lower:
            agent_type = at
            break

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

ansi_strip = re.compile(r'\x1b\[[0-9;]*m|\\\\033\[[0-9;]*m')
def clean(s): return ansi_strip.sub('', s).replace('|', '/').replace('\n', ' ').strip()

tools_str = ','.join(sorted(tools_used)[:5])
files_str = ','.join(sorted(files_touched)[:5])
detail = clean(last_tool if last_tool else last_text[:100])
task_desc = clean(description if description else prompt_summary[:80])
KNOWN_TYPES = {'pm','backend-dev','frontend-dev','adapter-dev','supabase-dev',
               'sync-dev','test-runner','docs-writer','architect',
               'security-auditor','ai-integration-dev','ux-designer','general'}
if agent_type not in KNOWN_TYPES:
    agent_type = 'general'

if status == 'RUNNING' and (time.time() - mtime) > 300:
    status = 'STALE'

print(f'{status}|{agent_type}|{tool_count}|{elapsed_total}|{tools_str}|{detail}|{task_desc}|{files_str}')
" 2>/dev/null || echo "UNKNOWN|general|0|0|||parse error|"
}

# -- Time Formatting -----------------------------------------------------------
fmt_elapsed() {
  local s="$1"
  if [ "$s" -ge 3600 ]; then echo "$((s/3600))h$((s%3600/60))m"
  elif [ "$s" -ge 60 ]; then echo "$((s/60))m$((s%60))s"
  else echo "${s}s"
  fi
}

# -- Progress Bar --------------------------------------------------------------
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

# -- Section Renderers ---------------------------------------------------------

render_header() {
  local spin="${SPINNER_FRAMES[$SPIN_IDX]}"
  local has_running=0
  if [ -s "$PARSED_CACHE" ]; then
    grep -q '|RUNNING|' "$PARSED_CACHE" 2>/dev/null && has_running=1
  fi

  if [ "$has_running" -eq 1 ]; then
    echo -e "${BD}${C}  ${spin}${NC} ${BD}${B}INSIGHTA AGENT DASHBOARD${NC}  ${D}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
  else
    echo -e "${BD}${B}  INSIGHTA AGENT DASHBOARD${NC}  ${D}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
  fi
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

  # Collect running agent types from cache
  local running_agents=""
  if [ -n "$PARSED_CACHE" ] && [ -f "$PARSED_CACHE" ]; then
    running_agents=$(while IFS='|' read -r _file status agent_type _rest; do
      [ "$status" = "RUNNING" ] && echo "$agent_type"
    done < "$PARSED_CACHE" | sort -u)
  fi

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

  local spin="${SPINNER_FRAMES[$SPIN_IDX]}"
  for entry in "${agents[@]}"; do
    local name="${entry%%|*}"
    local role="${entry#*|}"
    local badge=$(agent_badge "$name")
    local color=$(agent_color "$name")

    if echo "$running_agents" | grep -q "^${name}$" 2>/dev/null; then
      # Active agent: spinner + highlighted name
      printf "  ${color}${spin}${NC} %b ${BD}${color}%-22s${NC} ${D}%s${NC}\n" "$badge" "$name" "$role"
    else
      printf "    %b %-22s ${D}%s${NC}\n" "$badge" "$name" "$role"
    fi
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

  local running=0 done=0 total=0 stale=0
  local spin="${SPINNER_FRAMES[$SPIN_IDX]}"

  while IFS='|' read -r f status agent_type tool_count elapsed tools_str detail task_desc files_str; do
    local agent_id=$(basename "$f" .output 2>/dev/null) || continue
    local short_id="${agent_id:0:7}"
    local color=$(agent_color "$agent_type")

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
      stale=$((stale + 1))
      echo -e "  ${D}✗${NC} ${badge} ${D}${short_id}${NC}  ${D}${time_str}${NC}  tools:${BD}${tool_count}${NC}  ${R}(stale)${NC}"
    elif [ "$status" = "RUNNING" ]; then
      running=$((running + 1))
      # Animated spinner + highlighted time + current action
      echo -e "  ${color}${spin}${NC} ${badge} ${D}${short_id}${NC}  ${Y}${time_str}${NC}  tools:${BD}${tool_count}${NC}  ${D}[${tools_str}]${NC}"
      [ -n "$task_desc" ] && echo -e "    ${C}├─${NC} ${task_desc:0:60}"
      [ -n "$detail" ] && echo -e "    ${D}└─ ${detail:0:60}${NC}"
    else
      echo -e "  ${D}?${NC} ${badge} ${D}${short_id}${NC}  ${D}${time_str}${NC}"
    fi
  done < "$PARSED_CACHE"

  echo -e "  ${D}──${NC} ${Y}●${NC} running:${BD}${running}${NC}  ${G}✓${NC} done:${BD}${done}${NC}  ${R}✗${NC} stale:${BD}${stale}${NC}  total:${D}${total}${NC}"
}

render_delegation_stats() {
  [ "$SHOW_STATS" = "0" ] && return
  echo -e "  ${BD}DELEGATION STATS${NC}  ${D}(last 24h)${NC}"

  if [ -z "$TASK_DIR" ] || [ ! -d "$TASK_DIR" ]; then
    echo -e "  ${D}  No data available${NC}"
    return
  fi

  local stats=$(find -L "$TASK_DIR" -name "*.output" -mmin -1440 -type f 2>/dev/null | while read -r f; do
    parse_subagent "$f" 2>/dev/null | cut -d'|' -f2
  done | sort | uniq -c | sort -rn)

  if [ -z "$stats" ]; then
    echo -e "  ${D}  No delegations in last 24h${NC}"
    return
  fi

  local max_count=$(echo "$stats" | head -1 | awk '{print $1}')
  [ "$max_count" -eq 0 ] 2>/dev/null && max_count=1

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
  local spin="${SPINNER_FRAMES[$SPIN_IDX]}"
  echo -e "${D}  ${spin} refresh: 0.5s │ Ctrl+C: exit │ SHOW_TEAM=${SHOW_TEAM} SHOW_STATS=${SHOW_STATS}${NC}"
}

# -- Terminal-safe output ------------------------------------------------------
strip_ansi() { sed 's/\x1b\[[0-9;]*m//g'; }

print_truncated() {
  local cols=$(tput cols 2>/dev/null || echo 80)
  local rows=$(tput lines 2>/dev/null || echo 40)

  python3 -u -c "
import sys, re, os

cols = $cols
rows = $rows - 1
ansi_re = re.compile(r'\x1b\[[0-9;]*m')
EL = '\x1b[K'
RESET = '\x1b[0m'
ED = '\x1b[J'
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

os.write(1, ED.encode())
" < "$1"
}

# -- Main Loop (flicker-free, animated) ----------------------------------------
TMPBUF=$(mktemp /tmp/dash-buf.XXXXXX)
PARSED_CACHE=$(mktemp /tmp/dash-parsed.XXXXXX)
trap 'rm -f "$TMPBUF" "$PARSED_CACHE"; tput cnorm 2>/dev/null' EXIT

tput civis 2>/dev/null  # hide cursor

prev_cols=0
prev_rows=0
SPIN_IDX=0

while true; do
  SPIN_IDX=$(( (SPIN_IDX + 1) % SPINNER_LEN ))

  # Pre-populate parse cache
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

  # Detect terminal resize -> full clear
  local_cols=$(tput cols 2>/dev/null || echo 80)
  local_rows=$(tput lines 2>/dev/null || echo 40)
  if [ "$local_cols" != "$prev_cols" ] || [ "$local_rows" != "$prev_rows" ]; then
    clear
    prev_cols="$local_cols"
    prev_rows="$local_rows"
  fi

  tput home 2>/dev/null
  print_truncated "$TMPBUF"

  sleep 0.5
done
