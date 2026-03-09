#!/bin/bash
# Compact ccusage for tmux status bar (cached 60s)
# Shows: D:<daily%> [reset_time] W:<weekly%>
CACHE="/tmp/ccusage-tmux.cache"
AGE=9999
[ -f "$CACHE" ] && AGE=$(( $(date +%s) - $(stat -f%m "$CACHE" 2>/dev/null || echo 0) ))

if [ "$AGE" -ge 60 ]; then
  result=$(python3 -c "
import subprocess,json,sys
from datetime import datetime, timedelta

now = datetime.now()

# --- Weekly: reset Sat 11:00 AM KST ---
days_since_sat = (now.weekday() - 5) % 7
last_sat = now - timedelta(days=days_since_sat)
reset_w = last_sat.replace(hour=11, minute=0, second=0, microsecond=0)
if now < reset_w:
    reset_w -= timedelta(days=7)
since_w = reset_w.strftime('%Y%m%d')

# --- Daily: today ---
since_d = now.strftime('%Y%m%d')

try:
    out = subprocess.check_output(
        ['ccusage', 'daily', '--since', since_w, '--json', '--offline'],
        stderr=subprocess.DEVNULL, timeout=10
    )
    d = json.loads(out)
    days = d.get('daily', [])
    week_cost = sum(day.get('totalCost', 0) for day in days)
    today_cost = 0
    today_str = now.strftime('%Y-%m-%d')
    for day in days:
        if day.get('date') == today_str:
            today_cost = day.get('totalCost', 0)
            break
except:
    week_cost = 0
    today_cost = 0

# Limits (calibrated: \$202 = 19% weekly from screenshot)
WEEKLY_LIMIT = 1063
DAILY_LIMIT = WEEKLY_LIMIT / 7  # ~\$152

d_pct = min(100, today_cost / DAILY_LIMIT * 100) if DAILY_LIMIT > 0 else 0
w_pct = min(100, week_cost / WEEKLY_LIMIT * 100) if WEEKLY_LIMIT > 0 else 0

# Reset time: hours until session reset (~5h window from current hour)
# Show remaining time until midnight when daily > 80%
parts = []
if d_pct >= 80:
    midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    remaining = midnight - now
    h = int(remaining.total_seconds() // 3600)
    m = int((remaining.total_seconds() % 3600) // 60)
    parts.append(f'D:{d_pct:.0f}% {h:02d}:{m:02d}')
else:
    parts.append(f'D:{d_pct:.0f}%')

parts.append(f'W:{w_pct:.0f}%')
print(' '.join(parts))
" 2>/dev/null)
  [ -n "$result" ] && echo "$result" > "$CACHE"
fi

cat "$CACHE" 2>/dev/null || echo "n/a"
