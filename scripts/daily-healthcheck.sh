#!/usr/bin/env bash
#
# daily-healthcheck.sh — Insighta Daily Service Health Check
#
# Usage:
#   ./scripts/daily-healthcheck.sh              # Full check (SSH + external)
#   ./scripts/daily-healthcheck.sh --local-only # External checks only (no SSH)
#   ./scripts/daily-healthcheck.sh --json       # JSON output for agent parsing
#
# Exit codes: 0 = all pass, 1 = warning, 2 = critical

set -euo pipefail

# ─── Configuration ────────────────────────────────────────
DOMAIN="insighta.one"
SITE_URL="https://${DOMAIN}"
HEALTH_URL="${SITE_URL}/health"
AUTH_TEST_URL="${SITE_URL}/api/v1/playlists"
EC2_HOST="44.231.152.49"
SSH_KEY="${HOME}/Downloads/prx01-tubearchive.pem"
SSH_USER="ubuntu"
SSH_TIMEOUT=5
CHECK_TIMEOUT=5
DISK_WARN_THRESHOLD=80
SSL_WARN_DAYS=30
GITHUB_REPO="JK42JJ/insighta"

# ─── Flags ────────────────────────────────────────────────
JSON_OUTPUT=false
LOCAL_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --json)       JSON_OUTPUT=true ;;
    --local-only) LOCAL_ONLY=true ;;
    --help|-h)
      echo "Usage: $0 [--json] [--local-only] [--help]"
      echo ""
      echo "  --json        Output results as JSON"
      echo "  --local-only  Skip SSH-based checks (Docker, Disk, Memory)"
      echo "  --help        Show this help"
      exit 0
      ;;
  esac
done

# ─── State ────────────────────────────────────────────────
PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
TOTAL_CHECKS=8

declare -a RESULTS=()

# ─── Helpers ──────────────────────────────────────────────
add_result() {
  local status="$1" name="$2" target="$3" detail="$4"
  RESULTS+=("${status}|${name}|${target}|${detail}")
  case "$status" in
    PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
    WARN) WARN_COUNT=$((WARN_COUNT + 1)) ;;
    FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
    SKIP) SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
  esac
}

status_icon() {
  case "$1" in
    PASS) echo "✅" ;;
    WARN) echo "⚠️ " ;;
    FAIL) echo "❌" ;;
    SKIP) echo "⏭️ " ;;
  esac
}

ssh_cmd() {
  ssh -i "$SSH_KEY" -o ConnectTimeout="$SSH_TIMEOUT" \
      -o StrictHostKeyChecking=no -o BatchMode=yes \
      "${SSH_USER}@${EC2_HOST}" "$@" 2>/dev/null
}

# ─── Checks ──────────────────────────────────────────────

check_site() {
  local start end duration http_code
  start=$(date +%s%N)
  http_code=$(curl -sf -o /dev/null -w "%{http_code}" --max-time "$CHECK_TIMEOUT" "$SITE_URL" 2>/dev/null || echo "000")
  end=$(date +%s%N)
  duration=$(( (end - start) / 1000000 ))

  if [[ "$http_code" == "200" ]]; then
    add_result "PASS" "Site" "$SITE_URL" "${http_code} OK (${duration}ms)"
  else
    add_result "FAIL" "Site" "$SITE_URL" "HTTP ${http_code} (${duration}ms)"
  fi
}

check_api() {
  local body http_code status_field uptime_field
  body=$(curl -sf --max-time "$CHECK_TIMEOUT" "$HEALTH_URL" 2>/dev/null || echo "")
  http_code=$(curl -sf -o /dev/null -w "%{http_code}" --max-time "$CHECK_TIMEOUT" "$HEALTH_URL" 2>/dev/null || echo "000")

  if [[ "$http_code" == "200" && -n "$body" ]]; then
    status_field=$(echo "$body" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
    uptime_field=$(echo "$body" | grep -o '"uptime":[0-9.]*' | head -1 | cut -d: -f2 || echo "0")
    # Convert uptime seconds to human readable
    local hours
    hours=$(echo "$uptime_field" | awk '{printf "%.0f", $1/3600}')
    add_result "PASS" "API" "/health" "${status_field}, uptime: ${hours}h"
  else
    add_result "FAIL" "API" "/health" "HTTP ${http_code}"
  fi
}

check_auth() {
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$CHECK_TIMEOUT" "$AUTH_TEST_URL" 2>/dev/null || echo "000")

  if [[ "$http_code" == "401" ]]; then
    add_result "PASS" "Auth" "/api/v1/playlists" "401 (auth working)"
  elif [[ "$http_code" == "200" ]]; then
    add_result "WARN" "Auth" "/api/v1/playlists" "200 (no auth required?)"
  else
    add_result "FAIL" "Auth" "/api/v1/playlists" "HTTP ${http_code}"
  fi
}

check_ssl() {
  local expiry_date days_remaining
  expiry_date=$(echo | openssl s_client -servername "$DOMAIN" -connect "${DOMAIN}:443" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null \
    | cut -d= -f2)

  if [[ -z "$expiry_date" ]]; then
    add_result "FAIL" "SSL" "$DOMAIN" "Could not check certificate"
    return
  fi

  local expiry_epoch now_epoch
  # macOS and Linux compatible date parsing
  if date --version &>/dev/null; then
    # GNU date (Linux)
    expiry_epoch=$(date -d "$expiry_date" +%s)
  else
    # BSD date (macOS)
    expiry_epoch=$(date -jf "%b %d %T %Y %Z" "$expiry_date" +%s 2>/dev/null || date -jf "%b  %d %T %Y %Z" "$expiry_date" +%s 2>/dev/null || echo "0")
  fi
  now_epoch=$(date +%s)
  days_remaining=$(( (expiry_epoch - now_epoch) / 86400 ))

  if [[ "$days_remaining" -lt 0 ]]; then
    add_result "FAIL" "SSL" "$DOMAIN" "EXPIRED"
  elif [[ "$days_remaining" -lt "$SSL_WARN_DAYS" ]]; then
    add_result "WARN" "SSL" "$DOMAIN" "${days_remaining} days remaining"
  else
    add_result "PASS" "SSL" "$DOMAIN" "${days_remaining} days remaining"
  fi
}

check_docker() {
  if [[ "$LOCAL_ONLY" == "true" ]]; then
    add_result "SKIP" "Docker" "EC2" "Skipped (--local-only)"
    return
  fi

  local docker_output
  docker_output=$(ssh_cmd "docker ps --format '{{.Names}}:{{.Status}}'" 2>/dev/null) || {
    add_result "SKIP" "Docker" "EC2" "SSH connection failed"
    return
  }

  local api_status frontend_status
  api_status=$(echo "$docker_output" | grep "tubearchive-api" | head -1 || echo "")
  frontend_status=$(echo "$docker_output" | grep "tubearchive-frontend" | head -1 || echo "")

  local api_health="" frontend_health=""

  if echo "$api_status" | grep -qi "healthy"; then
    api_health="healthy"
  elif echo "$api_status" | grep -qi "unhealthy"; then
    api_health="unhealthy"
  elif [[ -z "$api_status" ]]; then
    api_health="not found"
  else
    api_health="running"
  fi

  if echo "$frontend_status" | grep -qi "healthy"; then
    frontend_health="healthy"
  elif echo "$frontend_status" | grep -qi "unhealthy"; then
    frontend_health="unhealthy"
  elif [[ -z "$frontend_status" ]]; then
    frontend_health="not found"
  else
    frontend_health="running"
  fi

  local detail="api: ${api_health}, frontend: ${frontend_health}"

  if [[ "$api_health" == "healthy" || "$api_health" == "running" ]] && \
     [[ "$frontend_health" == "healthy" || "$frontend_health" == "running" ]]; then
    add_result "PASS" "Docker" "EC2" "$detail"
  elif [[ "$api_health" == "not found" || "$frontend_health" == "not found" ]]; then
    add_result "FAIL" "Docker" "EC2" "$detail"
  else
    add_result "WARN" "Docker" "EC2" "$detail"
  fi
}

check_disk() {
  if [[ "$LOCAL_ONLY" == "true" ]]; then
    add_result "SKIP" "Disk" "EC2" "Skipped (--local-only)"
    return
  fi

  local disk_output
  disk_output=$(ssh_cmd "df -h / | tail -1" 2>/dev/null) || {
    add_result "SKIP" "Disk" "EC2" "SSH connection failed"
    return
  }

  local usage_pct free_space
  usage_pct=$(echo "$disk_output" | awk '{print $5}' | tr -d '%')
  free_space=$(echo "$disk_output" | awk '{print $4}')

  if [[ "$usage_pct" -gt "$DISK_WARN_THRESHOLD" ]]; then
    add_result "WARN" "Disk" "/" "${usage_pct}% used, ${free_space} free"
  else
    add_result "PASS" "Disk" "/" "${usage_pct}% used, ${free_space} free"
  fi
}

check_memory() {
  if [[ "$LOCAL_ONLY" == "true" ]]; then
    add_result "SKIP" "Memory" "EC2" "Skipped (--local-only)"
    return
  fi

  local mem_output
  mem_output=$(ssh_cmd "free -m | grep Mem" 2>/dev/null) || {
    add_result "SKIP" "Memory" "EC2" "SSH connection failed"
    return
  }

  local total used pct swap_output swap_used
  total=$(echo "$mem_output" | awk '{print $2}')
  used=$(echo "$mem_output" | awk '{print $3}')
  pct=$(( used * 100 / total ))

  swap_output=$(ssh_cmd "free -m | grep Swap" 2>/dev/null) || swap_output=""
  swap_used=$(echo "$swap_output" | awk '{print $3}' || echo "0")
  local swap_total
  swap_total=$(echo "$swap_output" | awk '{print $2}' || echo "0")
  local swap_pct=0
  if [[ -n "$swap_total" && "$swap_total" -gt 0 ]]; then
    swap_pct=$(( swap_used * 100 / swap_total ))
  fi

  local detail="${used}/${total} MB (${pct}%), swap: ${swap_pct}%"

  if [[ "$pct" -gt 90 ]]; then
    add_result "WARN" "Memory" "EC2" "$detail"
  else
    add_result "PASS" "Memory" "EC2" "$detail"
  fi
}

check_cicd() {
  if ! command -v gh &>/dev/null; then
    add_result "SKIP" "CI/CD" "GitHub" "gh CLI not installed"
    return
  fi

  local run_info
  run_info=$(gh run list --repo "$GITHUB_REPO" --limit 1 --json status,conclusion,createdAt,name 2>/dev/null) || {
    add_result "SKIP" "CI/CD" "GitHub" "gh CLI error"
    return
  }

  local conclusion created_at name
  conclusion=$(echo "$run_info" | grep -o '"conclusion":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
  created_at=$(echo "$run_info" | grep -o '"createdAt":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")

  # Calculate time ago
  local time_ago="unknown"
  if [[ -n "$created_at" ]]; then
    local created_epoch now_epoch diff_seconds
    if date --version &>/dev/null; then
      created_epoch=$(date -d "$created_at" +%s 2>/dev/null || echo "0")
    else
      created_epoch=$(date -jf "%Y-%m-%dT%H:%M:%SZ" "$created_at" +%s 2>/dev/null || echo "0")
    fi
    now_epoch=$(date +%s)
    diff_seconds=$(( now_epoch - created_epoch ))
    if [[ "$diff_seconds" -lt 3600 ]]; then
      time_ago="$(( diff_seconds / 60 ))m ago"
    elif [[ "$diff_seconds" -lt 86400 ]]; then
      time_ago="$(( diff_seconds / 3600 ))h ago"
    else
      time_ago="$(( diff_seconds / 86400 ))d ago"
    fi
  fi

  if [[ "$conclusion" == "success" ]]; then
    add_result "PASS" "CI/CD" "Last deploy" "success, ${time_ago}"
  elif [[ "$conclusion" == "failure" ]]; then
    add_result "WARN" "CI/CD" "Last deploy" "failure, ${time_ago}"
  else
    add_result "PASS" "CI/CD" "Last deploy" "${conclusion}, ${time_ago}"
  fi
}

# ─── Output ──────────────────────────────────────────────

output_text() {
  local now
  now=$(date '+%Y-%m-%d %H:%M:%S')

  echo ""
  echo "═══════════════════════════════════════════"
  echo "  INSIGHTA DAILY HEALTH CHECK"
  echo "  ${now}"
  echo "═══════════════════════════════════════════"
  echo ""

  for result in "${RESULTS[@]}"; do
    IFS='|' read -r status name target detail <<< "$result"
    local icon
    icon=$(status_icon "$status")
    printf "  %s %-10s %-24s %s\n" "$icon" "$name" "$target" "$detail"
  done

  echo ""
  echo "───────────────────────────────────────────"

  local effective_total=$(( TOTAL_CHECKS - SKIP_COUNT ))
  if [[ "$FAIL_COUNT" -gt 0 ]]; then
    echo "  RESULT: ${PASS_COUNT}/${effective_total} PASSED  ❌ Critical issues found"
  elif [[ "$WARN_COUNT" -gt 0 ]]; then
    echo "  RESULT: ${PASS_COUNT}/${effective_total} PASSED  ⚠️  Warnings detected"
  else
    echo "  RESULT: ${PASS_COUNT}/${effective_total} PASSED  ✅ All systems operational"
  fi

  if [[ "$SKIP_COUNT" -gt 0 ]]; then
    echo "  SKIPPED: ${SKIP_COUNT} checks"
  fi

  echo "═══════════════════════════════════════════"
  echo ""
}

output_json() {
  local now
  now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

  echo "{"
  echo "  \"timestamp\": \"${now}\","
  echo "  \"domain\": \"${DOMAIN}\","
  echo "  \"summary\": {"
  echo "    \"total\": ${TOTAL_CHECKS},"
  echo "    \"passed\": ${PASS_COUNT},"
  echo "    \"warnings\": ${WARN_COUNT},"
  echo "    \"failed\": ${FAIL_COUNT},"
  echo "    \"skipped\": ${SKIP_COUNT}"
  echo "  },"
  echo "  \"checks\": ["

  local i=0
  local len=${#RESULTS[@]}
  for result in "${RESULTS[@]}"; do
    IFS='|' read -r status name target detail <<< "$result"
    ((i++))
    local comma=","
    [[ "$i" -eq "$len" ]] && comma=""
    echo "    {\"name\": \"${name}\", \"status\": \"${status}\", \"target\": \"${target}\", \"detail\": \"${detail}\"}${comma}"
  done

  echo "  ]"
  echo "}"
}

# ─── Main ────────────────────────────────────────────────

main() {
  # Run external checks (always)
  check_site
  check_api
  check_auth
  check_ssl

  # Run SSH-based checks
  check_docker
  check_disk
  check_memory

  # Run CI/CD check
  check_cicd

  # Output
  if [[ "$JSON_OUTPUT" == "true" ]]; then
    output_json
  else
    output_text
  fi

  # Exit code
  if [[ "$FAIL_COUNT" -gt 0 ]]; then
    exit 2
  elif [[ "$WARN_COUNT" -gt 0 ]]; then
    exit 1
  else
    exit 0
  fi
}

main
