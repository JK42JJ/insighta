#!/usr/bin/env bash
#
# Mint a 36-hour MFA session for the local AWS CLI.
#
#   scripts/ops/aws-mfa.sh 123456          six digits from the authenticator
#   export AWS_PROFILE=insighta-mfa        then use the CLI as usual
#
# Once the RequireMFA policy is attached (terraform: mfa_required_users), the
# long-lived key in the default profile can do nothing but this call. The
# session it returns is what every other command runs on. 36 hours is the
# maximum sts:GetSessionToken allows an IAM user; the session simply expires
# and the next call to this script replaces it.
#
# The session credentials are written to ~/.aws/credentials under the
# insighta-mfa profile by `aws configure set`; nothing is printed.

set -euo pipefail

CODE="${1:-}"
case "$CODE" in
  [0-9][0-9][0-9][0-9][0-9][0-9]) ;;
  *) printf 'usage: %s <six-digit MFA code>\n' "$0" >&2; exit 1 ;;
esac

SOURCE_PROFILE="${AWS_MFA_SOURCE_PROFILE:-default}"
TARGET_PROFILE="${AWS_MFA_PROFILE:-insighta-mfa}"
DURATION="${AWS_MFA_DURATION:-129600}"

SERIAL=$(aws --profile "$SOURCE_PROFILE" iam list-mfa-devices \
  --query 'MFADevices[0].SerialNumber' --output text)
[ -n "$SERIAL" ] && [ "$SERIAL" != "None" ] || {
  printf '[aws-mfa] no MFA device registered for the %s profile user\n' "$SOURCE_PROFILE" >&2
  exit 1
}

read -r KEY SECRET TOKEN EXPIRES < <(aws --profile "$SOURCE_PROFILE" sts get-session-token \
  --serial-number "$SERIAL" --token-code "$CODE" --duration-seconds "$DURATION" \
  --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken,Expiration]' --output text)

aws configure set --profile "$TARGET_PROFILE" aws_access_key_id "$KEY"
aws configure set --profile "$TARGET_PROFILE" aws_secret_access_key "$SECRET"
aws configure set --profile "$TARGET_PROFILE" aws_session_token "$TOKEN"
aws configure set --profile "$TARGET_PROFILE" region "$(aws --profile "$SOURCE_PROFILE" configure get region 2>/dev/null || echo us-west-2)"

printf '[aws-mfa] profile %s valid until %s\n' "$TARGET_PROFILE" "$EXPIRES" >&2
printf 'export AWS_PROFILE=%s\n' "$TARGET_PROFILE"
