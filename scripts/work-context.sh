#!/bin/bash
# =============================================================================
# Issue Context Panel — detailed issue descriptions for work decisions
# Shows: top 3 open issues with Korean descriptions + labels
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/dashboard-common.sh"

# Config
ISSUES_KR_MAP="$SCRIPT_DIR/data/issue-kr.json"
ISSUES_CACHE="/tmp/insighta-issue-context"
ISSUES_DISPLAY_LIMIT=5
ISSUES_DESC_LINES=3
ISSUES_CACHE_TTL=300
REFRESH_SEC=10

fetch_issues() {
  local raw; raw=$(gh issue list --limit 7 \
    --json number,title,body,labels 2>/dev/null)
  [ -z "$raw" ] && return

  local kr_map="{}"
  [ -f "$ISSUES_KR_MAP" ] && kr_map=$(cat "$ISSUES_KR_MAP")

  echo "$raw" | jq -r --argjson kr "$kr_map" '
    .[]|
    "\(.number)\t\(.title)\t" +
    (if $kr["\(.number)"] then $kr["\(.number)"]
     else ((.body // "") | split("\n") | map(select(test("^[^#*|\\->\\s]") and length > 10)) | .[0:3] | join(" ") | .[0:220])
     end) +
    "\t" +
    ([.labels[].name] | join(" · "))
  ' > "$ISSUES_CACHE" 2>/dev/null
}

# Python word-wrap that handles CJK double-width characters
wrap_text() {
  local text="$1"
  local width="$2"
  local indent="$3"
  local max_lines="$4"
  python3 -c "
import unicodedata, sys
def char_width(c):
    cat = unicodedata.east_asian_width(c)
    return 2 if cat in ('W','F') else 1
def wrap(text, w, indent, maxl):
    lines = []
    words = text.split()
    line = ''
    lw = 0
    for word in words:
        ww = sum(char_width(c) for c in word)
        if lw > 0 and lw + 1 + ww > w:
            lines.append(line)
            if len(lines) >= maxl: break
            line = word
            lw = ww
        else:
            if lw > 0:
                line += ' '
                lw += 1
            line += word
            lw += ww
    if line and len(lines) < maxl:
        lines.append(line)
    for l in lines:
        print(indent + l)
wrap('''$text''', $width, '$indent', $max_lines)
" 2>/dev/null
}

render() {
  local tmp; tmp=$(mktemp)
  local cols; cols=$(dash_cols)
  local desc_width=$(( cols - 8 ))

  # Header
  printf "  ${BD}ISSUES${NC}  ${D}up %s${NC}\n" "$(format_elapsed $SECONDS)" >> "$tmp"

  # Refresh cache if stale
  if [ ! -f "$ISSUES_CACHE" ] || [ $(($(date +%s) - $(stat -f%m "$ISSUES_CACHE" 2>/dev/null || echo 0))) -gt "$ISSUES_CACHE_TTL" ]; then
    fetch_issues &
  fi

  if [ -f "$ISSUES_CACHE" ] && [ -s "$ISSUES_CACHE" ]; then
    local count=0
    while IFS=$'\t' read -r num title desc labels; do
      [ -z "$num" ] && continue
      count=$((count + 1))
      [ "$count" -gt "$ISSUES_DISPLAY_LIMIT" ] && break
      # Title (1 line)
      printf "  ${D}#%s %s${NC}\n" "$num" "$title" >> "$tmp"
      # Description (word-wrapped with CJK awareness)
      if [ -n "$desc" ]; then
        wrap_text "$desc" "$desc_width" "      " "$ISSUES_DESC_LINES" >> "$tmp"
      fi
      # Labels
      [ -n "$labels" ] && printf "      ${D}%s${NC}\n" "$labels" >> "$tmp"
    done < "$ISSUES_CACHE"
  else
    printf "  ${D}loading...${NC}\n" >> "$tmp"
  fi

  # Render with truncation
  truncate_to_terminal "$tmp"
  rm -f "$tmp"
}

# Main loop
trap 'dash_cleanup' EXIT INT TERM
tput civis 2>/dev/null

while true; do
  tput home 2>/dev/null || echo -ne '\033[H'
  render
  sleep "$REFRESH_SEC"
done
