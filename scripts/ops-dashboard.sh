#!/bin/bash
# =============================================================================
# Insighta System Dashboard v2 — Workflow-Centric Operations Monitor
# =============================================================================
# Sections: ❶Header → ❷HEALTH → ❸DB → ❹CI → ❺INFRA → ❻ISSUES
# Design: docs/design/dashboard-refactoring.md
# =============================================================================

set +e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/dashboard-common.sh"
source "$SCRIPT_DIR/lib/cache-util.sh"

# -- Singleton Guard -----------------------------------------------------------
PIDFILE="/tmp/ops-dashboard.pid"
if [ -f "$PIDFILE" ]; then
  old_pid=$(cat "$PIDFILE" 2>/dev/null)
  [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null && kill "$old_pid" 2>/dev/null && sleep 0.5
fi
echo $$ > "$PIDFILE"

# -- Config --------------------------------------------------------------------
CACHE_DIR="/tmp/ops-cache"; mkdir -p "$CACHE_DIR" 2>/dev/null
DOMAIN="${DOMAIN:-insighta.one}"
REPO_NWO="JK42JJ/insighta"
SREF="${SUPABASE_PROJECT_REF:-rckkhhjanqgaopynhfgd}"; SDB_URL="${SUPABASE_DB_URL:-}"
EC2_ID="i-0b375829716559a09"
SSH_KEY="$DASH_PROJECT_ROOT/prx01-tubearchive.pem"
SSH_HOST="${SSH_HOST:-ubuntu@44.231.152.49}"

SP=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏"); SP_LEN=${#SP[@]}

# TTL Policy (seconds)
TTL_HEALTH=15      # Health endpoints — fast detection
TTL_LOCAL=10       # Local services — zero cost
TTL_DB=120         # Supabase DB — expensive queries
TTL_CI=120         # CI/Workflows — event-driven
TTL_INFRA=60       # EC2/SSL — slow change
TTL_ISSUES=120     # Issues/PRs — semi-static

# =============================================================================
# FETCHERS (background, success-only write)
# =============================================================================

_sdb() { [ -z "$SDB_URL" ] && return 1; supabase inspect db "$1" --db-url "$SDB_URL" 2>/dev/null; }

fetch_health_prod() {
  local t0 t1 ms code e
  t0=$(date +%s%N 2>/dev/null || echo 0)
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://${DOMAIN}/health" 2>/dev/null); e=$?
  t1=$(date +%s%N 2>/dev/null || echo 0); ms=$(( (t1 - t0) / 1000000 )); [ "$ms" -lt 0 ] 2>/dev/null && ms=0
  if [ $e -eq 0 ] && [ "$code" != "000" ]; then
    if [ "$code" -ge 200 ] && [ "$code" -lt 400 ] 2>/dev/null; then
      echo "OK|${ms}ms" | cache_set health_prod
      echo "OK" | cache_set health_prod "$SHARED_CACHE_DIR"  # share with Work Dashboard
    else echo "WARN|${ms}ms|${code}" | cache_set health_prod; fi
  fi
}

fetch_health_dev() {
  local code e t0 t1 ms
  t0=$(date +%s%N 2>/dev/null || echo 0)
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://localhost:8081/ 2>/dev/null); e=$?
  t1=$(date +%s%N 2>/dev/null || echo 0); ms=$(( (t1 - t0) / 1000000 )); [ "$ms" -lt 0 ] 2>/dev/null && ms=0
  if [ $e -eq 0 ] && [ "${code:0:1}" = "2" ]; then echo "OK|${ms}ms" | cache_set health_dev
  else echo "DOWN|${code}" | cache_set health_dev; fi
}

fetch_health_api() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 1 --max-time 2 http://localhost:3000/health 2>/dev/null)
  if [ "$code" = "200" ]; then
    echo "OK|${code}" | cache_set health_api
    echo "OK" | cache_set health_api "$SHARED_CACHE_DIR"
  else
    echo "DOWN|${code}" | cache_set health_api
    echo "DOWN" | cache_set health_api "$SHARED_CACHE_DIR"
  fi
}

fetch_db_prod() {
  local r; r=$(_sdb "db-stats" 2>/dev/null | grep -E '^\s+postgres' | python3 -c "
import sys
for l in sys.stdin:
    p=[x.strip() for x in l.split('|')]
    if len(p)>=8: print(f'{p[1]}|{p[2]}|{p[6]}|{p[7]}')
" 2>/dev/null)
  [ -n "$r" ] && echo "$r" | cache_set db_prod
}

fetch_db_tbl() {
  local r; r=$(_sdb "table-stats" 2>/dev/null | grep -E '^\s+public\.' | python3 -c "
import sys
t=0;rows=0
for l in sys.stdin:
    p=[x.strip() for x in l.split('|')]
    if len(p)>=5:
        t+=1
        try: rows+=int(p[3].replace(',',''))
        except: pass
print(f'{t}|{rows}')
" 2>/dev/null)
  [ -n "$r" ] && echo "$r" | cache_set db_tbl
}

fetch_db_conn() {
  [ -z "$SDB_URL" ] && return
  local r; r=$(PGCONNECT_TIMEOUT=3 psql "$SDB_URL" -t -A -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'postgres'" 2>/dev/null)
  [ -n "$r" ] && echo "$r" | cache_set db_conn
}

fetch_edge_fn() {
  local r; r=$(supabase functions list --project-ref "$SREF" 2>/dev/null)
  [ -z "$r" ] && return
  local parsed; parsed=$(echo "$r" | python3 -c "
import sys
fns=[]
for l in sys.stdin:
    l=l.strip()
    if not l or l.startswith('ID') or l.startswith('---'): continue
    p=[x.strip() for x in l.split('|')]
    if len(p)>=6 and p[1] and not p[1].startswith('NAME'): fns.append(p[1])
print(' '.join(fns))
" 2>/dev/null)
  [ -n "$parsed" ] && echo "$parsed" | cache_set edge_fn
}

fetch_ci() {
  # CI workflow (ci.yml) — shows lint/build/test job details
  local r; r=$(gh run list --workflow=ci.yml --limit 1 --json status,conclusion,name,createdAt,databaseId,headBranch \
    --jq '.[0]|"\(.status)|\(.conclusion // "")|\(.name)|\(.createdAt)|\(.databaseId)|\(.headBranch)"' 2>/dev/null)
  [ -n "$r" ] && echo "$r" | cache_set ci_run

  # CI job details
  local run_id; run_id=$(echo "$r" | cut -d'|' -f5)
  if [ -n "$run_id" ]; then
    local jobs; jobs=$(gh run view "$run_id" --json jobs \
      --jq '.jobs[]|"\(.name)|\(.status)|\(.conclusion // "")"' 2>/dev/null)
    [ -n "$jobs" ] && echo "$jobs" | cache_set ci_jobs
  fi

  # Share with Work Dashboard
  local status conclusion ago_ts run_id_val
  status=$(echo "$r" | cut -d'|' -f1)
  conclusion=$(echo "$r" | cut -d'|' -f2)
  ago_ts=$(echo "$r" | cut -d'|' -f4)
  run_id_val=$(echo "$r" | cut -d'|' -f5)
  local ago_str; ago_str=$(format_timestamp_rel "$ago_ts")
  echo "${conclusion:-$status}|${run_id_val}|${ago_str}" | cache_set ci_latest "$SHARED_CACHE_DIR"
}

fetch_deploy() {
  local r; r=$(gh run list --workflow=deploy.yml --limit 1 --json status,conclusion,updatedAt,databaseId \
    --jq '.[0]|"\(.status)|\(.conclusion // "")|\(.updatedAt)|\(.databaseId)"' 2>/dev/null)
  [ -n "$r" ] && echo "$r" | cache_set deploy_run
}

fetch_workflows() {
  for wf in ci terraform backup; do
    local r; r=$(gh run list --workflow="${wf}.yml" --limit 1 --json status,conclusion,updatedAt \
      --jq '.[0]|"\(.status)|\(.conclusion // "")|\(.updatedAt)"' 2>/dev/null)
    [ -n "$r" ] && [ "$r" != "null" ] && echo "$r" | cache_set "wf_${wf}"
  done
}

fetch_infra() {
  local ec2="err" ssl="err" dock=""
  # EC2
  local ec2j; ec2j=$(timeout 10 aws ec2 describe-instance-status --instance-ids "$EC2_ID" \
    --query 'InstanceStatuses[0].{S:InstanceState.Name,Sys:SystemStatus.Status,Inst:InstanceStatus.Status}' \
    --output json --cli-connect-timeout 5 --cli-read-timeout 5 2>/dev/null)
  if [ -n "$ec2j" ]; then
    local s sys inst
    s=$(echo "$ec2j"|python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('S','?'))" 2>/dev/null)
    sys=$(echo "$ec2j"|python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('Sys','?'))" 2>/dev/null)
    inst=$(echo "$ec2j"|python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('Inst','?'))" 2>/dev/null)
    [ "$s" = "running" ] && [ "$sys" = "ok" ] && [ "$inst" = "ok" ] && ec2="ok" || ec2="warn"
  fi
  # SSL
  local exp; exp=$(echo | timeout 10 openssl s_client -connect "${DOMAIN}:443" -servername "${DOMAIN}" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | sed 's/notAfter=//')
  if [ -n "$exp" ]; then
    local days; days=$(python3 -c "
from datetime import datetime
d=datetime.strptime('$exp','%b %d %H:%M:%S %Y %Z')
print((d-datetime.utcnow()).days)" 2>/dev/null)
    [ -n "$days" ] && ssl="$days"
  fi
  # Docker (SSH)
  local prev_dock=""
  local prev; prev=$(cache_get infra 9999 2>/dev/null)
  [ -n "$prev" ] && prev_dock="${prev##*|}"
  local dps; dps=$(timeout 15 ssh -o ConnectTimeout=5 -o BatchMode=yes -i "$SSH_KEY" "$SSH_HOST" \
    'cd /opt/tubearchive && docker compose -f docker-compose.prod.yml ps --format "{{.Name}}|{{.State}}"' 2>/dev/null)
  if [ -n "$dps" ]; then
    local total=0 running=0
    while IFS='|' read -r dn ds; do [ -z "$dn" ] && continue; total=$((total+1)); [ "$ds" = "running" ] && running=$((running+1)); done <<< "$dps"
    dock="$running/$total"
  else dock="${prev_dock:-err}"; fi
  echo "${ec2}|${ssl}|${dock}" | cache_set infra
}

fetch_issues() {
  local issues; issues=$(gh issue list --limit 5 --json number,title,createdAt \
    --jq '.[]|"#\(.number) \(.createdAt[5:10]) \(.title)"' 2>/dev/null)
  [ -n "$issues" ] && echo "$issues" | cache_set issues
  # Counts — use search API for accurate totals (gh issue list has 30 default limit)
  local o=0 cl=0
  o=$(gh api "search/issues?q=repo:${REPO_NWO}+type:issue+state:open" --jq '.total_count' 2>/dev/null || echo 0)
  cl=$(gh api "search/issues?q=repo:${REPO_NWO}+type:issue+state:closed" --jq '.total_count' 2>/dev/null || echo 0)
  o="${o:-0}"; cl="${cl:-0}"
  local total=$(( o + cl ))
  echo "${o}|${cl}|${total}" | cache_set issue_counts
  # PRs
  local prs; prs=$(gh pr list --limit 3 --json number,title --jq 'length' 2>/dev/null)
  echo "${prs:-0}" | cache_set pr_count
}

# =============================================================================
# RENDERERS (priority order: most-watched first)
# =============================================================================

render_header() {
  local up_sec=$(( $(date +%s) - BOOT ))
  local up_str; up_str=$(format_elapsed "$up_sec")
  echo -e "  ${BD}${B}INSIGHTA${NC} ${D}sys${NC}  ${D}${SP[$SI]} $(date '+%H:%M:%S')${NC}  ${D}up ${up_str}${NC}"
}

render_health() {
  local all_ok=true

  # Prod
  local prod; prod=$(cache_get health_prod 9999)
  local prod_icon prod_text
  if [ -n "$prod" ]; then
    IFS='|' read -r ps pl phc <<< "$prod"
    if [ "$ps" = "OK" ]; then prod_icon="${G}●${NC}"; prod_text="${pl} ${DOMAIN}"
    elif [ "$ps" = "WARN" ]; then prod_icon="${Y}●${NC}"; prod_text="${pl} ${DOMAIN}(${phc})"; all_ok=false
    else prod_icon="${R}●${NC}"; prod_text="${DOMAIN}"; all_ok=false; fi
  else prod_icon="${D}○${NC}"; prod_text="${DOMAIN}"; fi

  # Dev :8081
  local dev; dev=$(cache_get health_dev 9999)
  local dev_icon dev_text
  if [ -n "$dev" ]; then
    IFS='|' read -r ds dl <<< "$dev"
    if [ "$ds" = "OK" ]; then dev_icon="${G}●${NC}"; dev_text="${dl} :8081"
    else dev_icon="${R}●${NC}"; dev_text=":8081"; all_ok=false; fi
  else dev_icon="${D}○${NC}"; dev_text=":8081"; fi

  # API :3000
  local api; api=$(cache_get health_api 9999)
  local api_icon api_text
  if [ -n "$api" ]; then
    IFS='|' read -r as ac <<< "$api"
    if [ "$as" = "OK" ]; then api_icon="${G}●${NC}"; api_text=":3000"
    else api_icon="${R}⊘${NC}"; api_text=":3000 DOWN"; all_ok=false; fi
  else api_icon="${D}○${NC}"; api_text=":3000"; fi

  local status_label
  if $all_ok; then status_label="${G}all green${NC}"
  else status_label="${Y}issues${NC}"; fi

  echo -e "  ${BD}HEALTH${NC}  ${status_label}"
  echo -e "   ${prod_icon} ${D}${prod_text}${NC}   ${dev_icon} ${D}${dev_text}${NC}   ${api_icon} ${D}${api_text}${NC}"

  # Expanded error detail
  if [ -n "$api" ]; then
    IFS='|' read -r as _ <<< "$api"
    [ "$as" = "DOWN" ] && echo -e "   ${D}└${NC} ${Y}API server not responding — npm run api:dev${NC}"
  fi
}

render_db() {
  echo -e "  ${BD}DB${NC}  $(cache_freshness db_prod $TTL_DB)"

  # Prod DB stats
  local db; db=$(cache_get db_prod 9999)
  local tbl; tbl=$(cache_get db_tbl 9999)
  local conn; conn=$(cache_get db_conn 9999)
  if [ -n "$db" ]; then
    IFS='|' read -r sz ix hi ht <<< "$db"
    local tbl_count=0 row_count=0
    [ -n "$tbl" ] && IFS='|' read -r tbl_count row_count <<< "$tbl"
    echo -ne "   ${C}prod${NC} ${D}${sz} hit:${NC}${G}${hi}${NC}/${G}${ht}${NC}"
    [ -n "$tbl_count" ] && echo -ne " ${D}tbl:${NC}${tbl_count} ${D}row:${NC}${row_count}"
    [ -n "$conn" ] && echo -ne " ${D}conn:${NC}${conn}"
    echo ""
  else echo -e "   ${D}prod: loading...${NC}"; fi

  # Edge Functions
  local fns; fns=$(cache_get edge_fn 9999)
  if [ -n "$fns" ]; then
    echo -ne "   ${D}fn${NC} "
    for fn in $fns; do echo -ne " ${G}●${NC} ${D}${fn}${NC}"; done
    echo ""
  fi
}

render_ci() {
  echo -e "  ${BD}CI${NC}  $(cache_freshness ci_run $TTL_CI)"

  # Latest CI run
  local ci; ci=$(cache_get ci_run 9999)
  if [ -n "$ci" ]; then
    IFS='|' read -r c_status c_conc c_name c_ts c_id c_branch <<< "$ci"
    local ago; ago=$(format_timestamp_rel "$c_ts")
    local icon
    if [ "$c_conc" = "success" ]; then icon="${G}●${NC}"
    elif [ "$c_conc" = "failure" ]; then icon="${R}⊘${NC}"
    elif [ "$c_status" = "in_progress" ]; then icon="${Y}◉${NC}"
    else icon="${D}○${NC}"; fi
    echo -e "   ${icon} ${D}#${c_id}${NC} ${c_conc:-$c_status} ${D}${ago}${NC}"

    # Job details (inline)
    local jobs; jobs=$(cache_get ci_jobs 9999)
    if [ -n "$jobs" ]; then
      local job_line=""
      while IFS='|' read -r jname jstatus jconc; do
        [ -z "$jname" ] && continue
        local short="${jname##* }"  # last word
        if [ "$jconc" = "success" ]; then job_line+="${G}${short}✓${NC} "
        elif [ "$jconc" = "failure" ]; then job_line+="${R}${short}✗${NC} "
        elif [ "$jstatus" = "in_progress" ]; then job_line+="${Y}${short}…${NC} "
        else job_line+="${D}${short}${NC} "; fi
      done <<< "$jobs"
      [ -n "$job_line" ] && echo -e "   ${D}${job_line}${NC}"
    fi
  else echo -e "   ${D}loading...${NC}"; fi

  # Deploy status
  local deploy; deploy=$(cache_get deploy_run 9999)
  if [ -n "$deploy" ]; then
    IFS='|' read -r d_status d_conc d_ts d_id <<< "$deploy"
    local d_ago; d_ago=$(format_timestamp_rel "$d_ts")
    local d_icon
    [ "$d_conc" = "success" ] && d_icon="${G}●${NC}" || d_icon="${R}⊘${NC}"
    echo -e "   ${D}deploy${NC} ${d_icon} ${D}#${d_id} ${d_ago}${NC}"
  fi
}

render_infra() {
  local inf; inf=$(cache_get infra 9999)
  if [ -n "$inf" ]; then
    IFS='|' read -r ec2 ssl dock <<< "$inf"
    local ec2_icon ssl_icon dock_icon
    [ "$ec2" = "ok" ] && ec2_icon="${G}●${NC}" || ec2_icon="${R}●${NC}"
    [ -n "$ssl" ] && [ "$ssl" != "err" ] && { [ "$ssl" -gt 30 ] 2>/dev/null && ssl_icon="${G}●${NC}" || ssl_icon="${Y}●${NC}"; } || ssl_icon="${R}●${NC}"
    [[ "$dock" == *"/"* ]] && { local dr="${dock%%/*}" dt="${dock##*/}"; [ "$dr" = "$dt" ] && dock_icon="${G}●${NC}" || dock_icon="${Y}●${NC}"; } || dock_icon="${D}○${NC}"
    echo -e "  ${BD}INFRA${NC}  ${D}prod${NC} ${ec2_icon} ${D}EC2${NC}  ${ssl_icon} ${D}SSL(${ssl:-?}d)${NC}  ${dock_icon} ${D}Docker(${dock:-?})${NC}"
  else echo -e "  ${BD}INFRA${NC}  ${D}loading...${NC}"; fi
}

render_issues() {
  local counts; counts=$(cache_get issue_counts 9999)
  local pr_count; pr_count=$(cache_get pr_count 9999)
  local open_count=0 closed_count=0 total_count=0 pct=0
  if [ -n "$counts" ]; then
    IFS='|' read -r open_count closed_count total_count <<< "$counts"
    [ "${total_count:-0}" -gt 0 ] 2>/dev/null && pct=$(( closed_count * 100 / total_count ))
  fi

  echo -e "  ${BD}ISSUES${NC}  ${D}open: ${open_count}, closed: ${closed_count}, total: ${total_count} (${pct}%)${NC}  ${D}PRs: ${pr_count:-0}${NC}"
}

# =============================================================================
# BACKGROUND REFRESH
# =============================================================================

bg_refresh() {
  refresh_if_stale health_prod "$TTL_HEALTH" fetch_health_prod
  refresh_if_stale health_dev "$TTL_LOCAL" fetch_health_dev
  refresh_if_stale health_api "$TTL_LOCAL" fetch_health_api
  refresh_if_stale db_prod "$TTL_DB" fetch_db_prod
  refresh_if_stale db_tbl "$TTL_DB" fetch_db_tbl
  refresh_if_stale db_conn "$TTL_DB" fetch_db_conn
  refresh_if_stale edge_fn "$TTL_DB" fetch_edge_fn
  refresh_if_stale ci_run "$TTL_CI" fetch_ci
  refresh_if_stale deploy_run "$TTL_CI" fetch_deploy
  refresh_if_stale infra "$TTL_INFRA" fetch_infra
  refresh_if_stale issues "$TTL_ISSUES" fetch_issues
  # Workflows (bundled in fetch_ci for latest run)
}

# =============================================================================
# MAIN LOOP
# =============================================================================
BUF=$(mktemp /tmp/sys-dash-buf.XXXXXX)
trap 'rm -f "$BUF" "$PIDFILE" "$CACHE_DIR"/.lock_*; dash_cleanup' EXIT
tput civis 2>/dev/null

pc=0; pr=0; SI=0; BOOT=$(date +%s); LAST_BG=0

bg_refresh  # Initial fetch

while true; do
  SI=$(( (SI+1) % SP_LEN ))
  NOW=$(date +%s)

  # Background refresh every 5s
  [ $((NOW - LAST_BG)) -ge 5 ] && { bg_refresh; LAST_BG=$NOW; }

  {
    render_header
    render_health
    render_db
    render_ci
    render_infra
    render_issues
  } > "$BUF" 2>/dev/null

  lc=$(dash_cols); lr=$(dash_rows)
  [ "$lc" != "$pc" ] || [ "$lr" != "$pr" ] && { clear; pc="$lc"; pr="$lr"; }
  tput home 2>/dev/null
  truncate_to_terminal "$BUF"
  sleep 0.15
done
