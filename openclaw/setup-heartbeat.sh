#!/usr/bin/env bash
# OpenClaw Heartbeat Setup for Insighta
# Prerequisites: openclaw gateway must be running
#   $ openclaw gateway --force
#
# Usage: bash openclaw/setup-heartbeat.sh

set -euo pipefail

echo "Setting up Insighta heartbeat cron jobs..."

# Daily mood greeting — every day at 9:07 AM KST
openclaw cron add \
  --name "insighta-daily-mood" \
  --cron "7 9 * * *" \
  --tz "Asia/Seoul" \
  --message "Run the insighta-mood skill for all my mandalas and send me a brief greeting based on the mood." \
  --channel telegram \
  --announce \
  --timeout 60000

echo "  Daily mood greeting registered (09:07 KST)"

# Weekly learning report — every Monday at 10:03 AM KST
openclaw cron add \
  --name "insighta-weekly-report" \
  --cron "3 10 * * 1" \
  --tz "Asia/Seoul" \
  --message "Run the insighta-report skill to generate my weekly learning report across all mandalas." \
  --channel telegram \
  --announce \
  --timeout 60000

echo "  Weekly learning report registered (Mon 10:03 KST)"

echo ""
echo "Done. Verify with: openclaw cron list"
