#!/bin/bash
# PreToolUse hook — blocks every path that can put mail in a real inbox.
#
# Rationale (CLAUDE.md "메일 발송 = James 고유 권한", LEVEL-3, 2026-07-28):
#   Sending is James's authority and requires his confirmation of the content.
#   On 2026-07-28 the assistant asked "발송할까요?", did not wait for the
#   answer, read a copy-edit instruction as approval, and mailed 10 contacts.
#   The revised copy then went out as a second mail to the same people.
#   Irreversible, and the rule that should have stopped it was a document.
#
#   A document did not hold. This does.
#
# Blocks any Bash command that reaches a send path:
#   - transporter.sendMail / sendMail(          nodemailer, direct or via dist
#   - sendMobileGuideEmail / sendBetaInviteEmail / send*Email(  transactional wrappers
#   - runBroadcast(                              the broadcast runner
#   - admin/email/... broadcast | mobile-guide-sample   the admin endpoints
#   - insert into email_broadcast_sends           the ledger claim that precedes a send
#
# Explicitly NOT blocked — these do not send:
#   - planBroadcast(  (dry run: returns who WOULD receive)
#   - build[A-Za-z]*Email( / building or rendering any template
#   - reading the ledger (select ... from email_broadcast_sends)
#
# Bypass, one-shot, must be typed by the operator on the command itself:
#   INSIGHTA_EMAIL_SEND_OK=1 <command>
#
# The bypass exists so James can direct a send. The assistant must not add it
# on its own initiative: doing so is the same violation this hook exists to
# prevent, just spelled differently.

set -u

INPUT=$(cat 2>/dev/null || echo '{}')
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")

[ -z "$CMD" ] && exit 0

# Operator bypass, inline on the command or in the host env.
case "$CMD" in
  *INSIGHTA_EMAIL_SEND_OK=1*) exit 0 ;;
esac
[ "${INSIGHTA_EMAIL_SEND_OK:-}" = "1" ] && exit 0

# Dry-run and template-building are allowed; strip them so their names cannot
# be mistaken for a send below.
#
# The builder strip is a PATTERN, not a list of names. It used to name one
# builder, so every builder added afterwards was blocked on sight -- writing
# buildWelcome / buildBetaInvite / buildBrief all trip the *Email( case below,
# and none of them reaches an inbox. An allowlist that must be edited for
# each new function fails closed on authorship, which is not what this
# guard is for. send* is untouched: sendBetaInvite / sendBrief still match.
PROBE=$(printf '%s' "$CMD" | sed -e 's/planBroadcast//g' -e 's/build[A-Za-z]*Email//g')

HIT=""
case "$PROBE" in
  *sendMail*)                     HIT="nodemailer sendMail" ;;
  *runBroadcast*)                 HIT="runBroadcast()" ;;
  *Email\(*)                      HIT="a send*Email() wrapper" ;;
  *sendMobileGuideEmail*)         HIT="sendMobileGuideEmail" ;;
  *sendBetaInviteEmail*)          HIT="sendBetaInviteEmail" ;;
  *email/broadcast*)              HIT="POST /admin/email/broadcast" ;;
  *mobile-guide-sample*)          HIT="POST /admin/email/mobile-guide-sample" ;;
esac

# The ledger claim happens immediately before a send, so writing it is sending.
#
# The write verb has to sit ADJACENT to the table name. Matching them anywhere
# in the same command is too loose: `createSuccessResponse(... SELECT ... FROM
# email_broadcast_sends ...)` is a read, and the first version of this hook
# blocked exactly that — the admin screen that shows send history.
if [ -z "$HIT" ]; then
  if printf '%s' "$PROBE" \
     | grep -qiE '(insert[[:space:]]+into[[:space:]]+(public\.)?email_broadcast_sends|email_broadcast_sends[[:space:]]*\.[[:space:]]*(create|upsert))'; then
    HIT="an email_broadcast_sends write (a send is about to follow)"
  fi
fi

[ -z "$HIT" ] && exit 0

cat >&2 <<EOF
🚫 BLOCKED — sending mail is James's authority, not yours.

  matched: $HIT

Mail requires James's confirmation OF THE CONTENT, every time. A review copy
to his own address is still a send.

  approval      "보내" / "발송해" — an instruction naming the send itself
  NOT approval  a copy edit · a recipient list · an AskUserQuestion answer ·
                silence · your own "발송할까요?" going unanswered

If you asked, wait for the answer. Asking is proof you knew one was needed.

Present the draft, render it, show it, and stop.

James can direct a send by prefixing the command:
  INSIGHTA_EMAIL_SEND_OK=1 <command>

Do not add that prefix yourself. Doing so is this same violation, respelled.
Rule: CLAUDE.md "메일 발송 = James 고유 권한" · memory/feedback_email_send_is_james_authority.md
EOF
exit 2
