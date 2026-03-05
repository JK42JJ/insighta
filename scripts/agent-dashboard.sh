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
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'
C='\033[0;36m'; M='\033[0;35m'; W='\033[0;37m'; D='\033[2m'
BD='\033[1m'; UL='\033[4m'; NC='\033[0m'
BG_G='\033[42;30m'; BG_Y='\033[43;30m'; BG_R='\033[41;37m'; BG_B='\033[44;37m'
BG_C='\033[46;30m'; BG_M='\033[45;37m'; BG_W='\033[47;30m'

# Agent color mapping
agent_color()  { case "$1" in
  backend-dev)        echo "$B";;  frontend-dev)       echo "$C";;
  test-runner)        echo "$Y";;  adapter-dev)        echo "$M";;
  supabase-dev)       echo "$R";;  sync-dev)           echo "$G";;
  docs-writer)        echo "$D";;  security*)          echo "$R";;
  architect)          echo "$M";;  ux-designer)        echo "$G";;
  ai-integration-dev) echo "$C";;  *)                  echo "$W";;
esac; }

agent_badge()  { case "$1" in
  backend-dev)        echo "${BG_B} API ${NC}";;
  frontend-dev)       echo "${BG_C} UI  ${NC}";;
  test-runner)        echo "${BG_Y} TST ${NC}";;
  adapter-dev)        echo "${BG_M} ADP ${NC}";;
  supabase-dev)       echo "${BG_R} SB  ${NC}";;
  sync-dev)           echo "${BG_G} SYN ${NC}";;
  docs-writer)        echo "${D} DOC ${NC}";;
  architect)          echo "${BG_M} ARC ${NC}";;
  security-auditor)   echo "${BG_R} SEC ${NC}";;
  ux-designer)        echo "${BG_G} UXD ${NC}";;
  ai-integration-dev) echo "${BG_C} AI  ${NC}";;
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
                            if t: last_text = t[:200]
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
                    c = content.lower()
                    for kw, at in [('supabase','supabase-dev'),('edge func','supabase-dev'),
                                   ('frontend','frontend-dev'),('react','frontend-dev'),
                                   ('backend','backend-dev'),('prisma','backend-dev'),
                                   ('test','test-runner'),('adapter','adapter-dev'),
                                   ('ux','ux-designer'),('accessibility','ux-designer'),
                                   ('wcag','ux-designer'),('a11y','ux-designer'),
                                   ('ai ','ai-integration-dev'),('llm','ai-integration-dev'),
                                   ('summariz','ai-integration-dev')]:
                        if kw in c: agent_type = at; break
            elif msg_type == 'user':
                # Extract agent description and prompt from initial user message
                content = msg.get('content', '')
                if isinstance(content, str) and not description:
                    lines = content.strip().split('\\n')
                    prompt_summary = lines[0][:120] if lines else ''
                elif isinstance(content, list):
                    for item in content:
                        if isinstance(item, dict) and item.get('type') == 'tool_use':
                            inp = item.get('input', {})
                            if 'subagent_type' in inp:
                                agent_type = inp['subagent_type']
                            if 'description' in inp and not description:
                                description = inp['description']
                            if 'prompt' in inp and not prompt_summary:
                                prompt_summary = inp['prompt'][:120]
        except: continue

# Detect agent type from first line if still general
if agent_type == 'general':
    try:
        with open(file_path, 'r') as f:
            first = json.loads(f.readline())
            content = first.get('message',{}).get('content','')
            c = str(content).lower()
            for kw, at in [('supabase','supabase-dev'),('edge func','supabase-dev'),
                           ('frontend','frontend-dev'),('react','frontend-dev'),
                           ('backend','backend-dev'),('prisma','backend-dev'),
                           ('test','test-runner'),('jest','test-runner'),
                           ('adapter','adapter-dev'),('doc','docs-writer'),
                           ('explore','explorer'),('security','security-auditor'),
                           ('ux','ux-designer'),('accessibility','ux-designer'),
                           ('wcag','ux-designer'),('a11y','ux-designer'),
                           ('ai ','ai-integration-dev'),('llm','ai-integration-dev'),
                           ('summariz','ai-integration-dev'),
                           ('architect','architect')]:
                if kw in c: agent_type = at; break
    except: pass

tools_str = ','.join(sorted(tools_used)[:5])
files_str = ','.join(sorted(files_touched)[:5])
detail = last_tool if last_tool else last_text[:100]
task_desc = description if description else prompt_summary[:80]
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
  local cols=$(tput cols 2>/dev/null || echo 50)
  local line=$(printf '─%.0s' $(seq 1 $cols 2>/dev/null) 2>/dev/null)
  echo -e "${BD}${B}${line}${NC}"
  echo -e "${BD}${B}  INSIGHTA AGENT DASHBOARD${NC}  ${D}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
  echo -e "${BD}${B}${line}${NC}"
}

render_project_status() {
  local branch=$(git branch --show-current 2>/dev/null || echo "?")
  local modified=$(git diff --name-only 2>/dev/null | wc -l | tr -d ' ')
  local staged=$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')
  local untracked=$(git ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')
  local last_commit=$(git log -1 --format="%h %s" 2>/dev/null | head -c 60)

  echo -e ""
  echo -e "  ${BD}PROJECT${NC}  ${D}branch:${NC}${Y}${branch}${NC}  ${D}mod:${NC}${Y}${modified}${NC}  ${D}staged:${NC}${G}${staged}${NC}  ${D}new:${NC}${D}${untracked}${NC}"
  echo -e "  ${D}latest: ${last_commit}${NC}"
}

render_team() {
  [ "$SHOW_TEAM" = "0" ] && return

  echo -e ""
  echo -e "  ${BD}TEAM${NC}  ${D}(agent roster)${NC}"
  echo ""

  # Collect active agent types from recent tasks
  local active_agents=""
  if [ -n "$TASK_DIR" ] && [ -d "$TASK_DIR" ]; then
    active_agents=$(find "$TASK_DIR" -name "*.output" -mmin -1440 -type f 2>/dev/null | while read -r f; do
      parse_subagent "$f" 2>/dev/null | cut -d'|' -f2
    done | sort -u)
  fi

  # Agent roster: badge, name, role, active indicator
  local agents=(
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
    if echo "$active_agents" | grep -q "^${name}$" 2>/dev/null; then
      active_mark="${G}*${NC} "
    fi
    printf "  %b%b %-22s ${D}%s${NC}\n" "$active_mark" "$badge" "$name" "$role"
  done
}

render_agents() {
  echo -e ""
  echo -e "  ${BD}AGENTS${NC}"

  if [ -z "$TASK_DIR" ] || [ ! -d "$TASK_DIR" ]; then
    echo -e "  ${D}  No task directory detected${NC}"
    return
  fi

  # Collect recent output files (last 30 min)
  local files=$(find "$TASK_DIR" -name "*.output" -mmin -30 -type f 2>/dev/null | sort -r)

  if [ -z "$files" ]; then
    # Show older tasks
    files=$(find "$TASK_DIR" -name "*.output" -type f 2>/dev/null | sort -r | head -5)
    if [ -z "$files" ]; then
      echo -e "  ${D}  No agent activity${NC}"
      return
    fi
    echo -e "  ${D}  (showing recent history)${NC}"
  fi

  local running=0 done=0 total=0

  echo ""
  for f in $files; do
    local agent_id=$(basename "$f" .output 2>/dev/null) || continue
    local short_id="${agent_id:0:7}"

    local info=$(parse_subagent "$f")
    IFS='|' read -r status agent_type tool_count elapsed tools_str detail task_desc files_str <<< "$info"
    tool_count="${tool_count:-0}"
    elapsed="${elapsed:-0}"
    total=$((total + 1))

    local badge=$(agent_badge "$agent_type")
    local time_str=$(fmt_elapsed "$elapsed")

    if [ "$status" = "DONE" ]; then
      done=$((done + 1))
      echo -e "  ${G}✓${NC} ${badge} ${D}${short_id}${NC}  ${D}${time_str}${NC}  tools:${BD}${tool_count}${NC}  ${D}[${tools_str}]${NC}"
      [ -n "$task_desc" ] && echo -e "    ${C}📋 ${task_desc:0:70}${NC}"
      [ -n "$files_str" ] && echo -e "    ${D}📁 ${files_str:0:70}${NC}"
      [ -n "$detail" ] && echo -e "    ${D}└─ ${detail:0:80}${NC}"
    elif [ "$status" = "RUNNING" ]; then
      running=$((running + 1))
      echo -e "  ${Y}●${NC} ${badge} ${D}${short_id}${NC}  ${Y}${time_str}${NC}  tools:${BD}${tool_count}${NC}  ${D}[${tools_str}]${NC}"
      [ -n "$task_desc" ] && echo -e "    ${C}📋 ${task_desc:0:70}${NC}"
      [ -n "$files_str" ] && echo -e "    ${D}📁 ${files_str:0:70}${NC}"
      [ -n "$detail" ] && echo -e "    ${D}└─ ${detail:0:80}${NC}"
    else
      echo -e "  ${D}?${NC} ${badge} ${D}${short_id}${NC}  ${D}${time_str}${NC}"
    fi
  done

  echo ""
  echo -e "  ${D}───${NC} ${Y}●${NC} running:${BD}${running}${NC}  ${G}✓${NC} done:${BD}${done}${NC}  total:${D}${total}${NC}"
}

render_delegation_stats() {
  [ "$SHOW_STATS" = "0" ] && return

  echo -e ""
  echo -e "  ${BD}DELEGATION STATS${NC}  ${D}(last 24h)${NC}"
  echo ""

  if [ -z "$TASK_DIR" ] || [ ! -d "$TASK_DIR" ]; then
    echo -e "  ${D}  No data available${NC}"
    return
  fi

  # Count tasks per agent type in last 24h
  local stats=$(find "$TASK_DIR" -name "*.output" -mmin -1440 -type f 2>/dev/null | while read -r f; do
    parse_subagent "$f" 2>/dev/null | cut -d'|' -f2
  done | sort | uniq -c | sort -rn)

  if [ -z "$stats" ]; then
    echo -e "  ${D}  No delegations in last 24h${NC}"
    return
  fi

  # Find max count for bar scaling
  local max_count=$(echo "$stats" | head -1 | awk '{print $1}')
  [ "$max_count" -eq 0 ] 2>/dev/null && max_count=1

  local bar_width=20

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
  echo -e ""
  echo -e "  ${BD}FILE CHANGES${NC}  ${D}(git working tree)${NC}"
  echo ""

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
  local cols=$(tput cols 2>/dev/null || echo 50)
  local line=$(printf '─%.0s' $(seq 1 $cols 2>/dev/null) 2>/dev/null)
  echo -e ""
  echo -e "${D}${line}${NC}"
  echo -e "${D}  refresh: 3s │ Ctrl+C: exit │ SHOW_TEAM=${SHOW_TEAM} SHOW_STATS=${SHOW_STATS} │ agents: $(basename "$TASK_DIR" 2>/dev/null || echo 'none')${NC}"
}

# ── Main Loop ─────────────────────────────────────────────────────────────────

while true; do
  clear
  render_header
  render_project_status
  render_team
  render_agents
  render_delegation_stats
  render_file_activity
  render_footer
  sleep 3
done
