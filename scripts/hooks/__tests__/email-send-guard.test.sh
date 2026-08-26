#!/bin/bash
# Cases for email-send-guard.sh.
#
# Lives in a file rather than being typed inline because the guard reads the
# command it is asked about — a shell one-liner containing "sendMail" is itself
# blocked, so the suite could not be run by hand.
#
#   bash scripts/hooks/__tests__/email-send-guard.test.sh

set -u
GUARD="$(cd "$(dirname "$0")/.." && pwd)/email-send-guard.sh"
PASS=0; FAIL=0

run() {  # run <expected-exit> <label> <command>
  local want="$1" label="$2" cmd="$3" got
  got=$(python3 -c 'import json,sys;print(json.dumps({"tool_input":{"command":sys.argv[1]}}))' "$cmd" \
        | bash "$GUARD" >/dev/null 2>&1; echo $?)
  if [ "$got" = "$want" ]; then
    PASS=$((PASS+1)); printf '  ok    %s\n' "$label"
  else
    FAIL=$((FAIL+1)); printf '  FAIL  %s (want %s, got %s)\n' "$label" "$want" "$got"
  fi
}

echo "blocks — every path that reaches an inbox"
run 2 "nodemailer sendMail"        'docker exec api node -e "transporter.send''Mail({to:1})"'
run 2 "transactional wrapper"      'node -e "sendMobileGuide''Email(\"a@b.com\")"'
run 2 "beta invite wrapper"        'node -e "sendBetaInvite''Email(\"a@b.com\")"'
run 2 "broadcast runner"           'node -e "runBroadcast(\"mobile-guide\", 18)"'
run 2 "admin broadcast endpoint"   'curl -X POST https://insighta.one/api/v1/admin/email/broadcast'
run 2 "admin sample endpoint"      'curl -X POST https://x/admin/email/mobile-guide-sample'
run 2 "ledger claim, sql"          'psql -c "insert into email_broadcast_sends (campaign) values (1)"'
run 2 "ledger claim, qualified"    'psql -c "insert into public.email_broadcast_sends (campaign) values (1)"'
run 2 "send wrapper added later"   'node -e "sendBriefEmai''l(1)"'
run 2 "ledger claim, prisma"       'await p.email_broadcast_sends.create({data:{campaign:"x"}})'

echo "allows — reading, planning, rendering"
run 0 "dry run"                    'node -e "planBroadcast(\"mobile-guide\").then(console.log)"'
run 0 "template build"             'node -e "buildMobileGuideEmail({})"'
run 0 "ledger read"                'psql -c "select count(*) from email_broadcast_sends"'
run 0 "read inside create*Response" 'node -e "createSuccessResponse(q(\"SELECT kind FROM public.email_broadcast_sends WHERE email=$1\"))"'
run 0 "template build, any name"   'node -e "buildBriefEmail({})"'
run 0 "editing template source"    'sed -i s/x/y/ src/modules/email/templates.ts'
run 0 "unrelated"                  'git status'

echo "allows — James directing a send"
run 0 "operator bypass"            'INSIGHTA_EMAIL_SEND_OK=1 node -e "transporter.send''Mail({to:1})"'

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
