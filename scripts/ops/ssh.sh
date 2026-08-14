#!/usr/bin/env bash
#
# SSH to a project host. Direct SSH is the path; Tailscale is the fallback.
#
#   scripts/ops/ssh.sh prod                     interactive
#   scripts/ops/ssh.sh prod "docker ps"         command
#   scripts/ops/ssh.sh k3s  "sudo k3s kubectl get nodes"
#   scripts/ops/ssh.sh k3s --update-sg          authorize this machine, do not connect
#   scripts/ops/ssh.sh k3s --print-host         resolve and print, do not connect
#
# Port 22 on both hosts is allow-listed by source address, so a connection from
# a new location times out until the security group is told about it. This
# script does that first, every time, then connects.
#
# Determining "this machine's address" is the part that goes wrong. Ask without
# forcing a protocol and a dual-stack connection can report a different address
# than the one an SSH session will actually leave from:
#
#     curl -4 ifconfig.me            211.234.196.34     <- what SSH uses
#     curl    checkip.amazonaws.com  211.234.196.243    <- what gets authorized
#
# Measured 2026-08-14, and the reason a node with correct security group rules,
# route table, NACL and instance status refused connections for an hour. Every
# lookup here forces IPv4 and the result is cross-checked against a second
# source before anything is authorized.
#
# Hosts are resolved from AWS by Name tag rather than written down, so a
# stop/start that changes the public address does not turn this into a file
# that lies.

set -euo pipefail

log() { printf '[ssh] %s\n' "$*" >&2; }
die() { printf '[ssh] %s\n' "$*" >&2; exit 1; }

# name-tag : ssh-user : tailscale-alias (empty = no fallback available)
target_spec() {
  case "$1" in
    prod) echo "insighta-prod:ubuntu:insighta-ec2-ts" ;;
    k3s)  echo "insighta-k3s-1:ubuntu:" ;;
    *)    die "unknown target '$1' (prod|k3s)" ;;
  esac
}

TARGET="${1:-}"
[ -n "$TARGET" ] || die "usage: $0 <prod|k3s> [--update-sg|--print-host|command...]"
shift || true

IFS=: read -r NAME_TAG SSH_USER TS_ALIAS <<<"$(target_spec "$TARGET")"

KEY="${INSIGHTA_SSH_KEY:-$HOME/.ssh/insighta/prx01-tubearchive.pem}"
[ -f "$KEY" ] || die "key not found: $KEY"

# ── this machine's IPv4, agreed by two independent sources ──────────────────
my_ipv4() {
  local a b
  a=$(curl -4 -s --max-time 6 ifconfig.me 2>/dev/null || true)
  b=$(curl -4 -s --max-time 6 https://api.ipify.org 2>/dev/null || true)
  [ -n "$a" ] || a=$(curl -4 -s --max-time 6 https://checkip.amazonaws.com 2>/dev/null | tr -d '\n' || true)
  [ -n "$a" ] || die "could not determine this machine's IPv4 address"

  # Disagreement means one of them saw a different egress path. Authorizing a
  # guess is what produced the hour-long timeout this script exists to prevent.
  if [ -n "$b" ] && [ "$a" != "$b" ]; then
    die "IPv4 lookups disagree ($a vs $b) -- refusing to authorize a guess"
  fi
  case "$a" in
    *:*)          die "got an IPv6 address ($a); this script requires IPv4" ;;
    *.*.*.*)      printf '%s' "$a" ;;
    *)            die "unrecognised address: $a" ;;
  esac
}

# ── host and security group, resolved from AWS ──────────────────────────────
resolve() {
  aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=$NAME_TAG" "Name=instance-state-name,Values=running" \
    --query 'Reservations[0].Instances[0].{ip:PublicIpAddress,sg:SecurityGroups[0].GroupId}' \
    --output text 2>/dev/null
}

authorize() {
  local sg="$1" ip="$2"
  if aws ec2 describe-security-group-rules --filters "Name=group-id,Values=$sg" \
       --query "SecurityGroupRules[?FromPort==\`22\`].CidrIpv4" --output text 2>/dev/null \
     | tr '\t' '\n' | grep -qx "$ip/32"; then
    log "security group already allows $ip"
    return 0
  fi
  if aws ec2 authorize-security-group-ingress --group-id "$sg" \
       --protocol tcp --port 22 --cidr "$ip/32" >/dev/null 2>&1; then
    log "authorized $ip on $sg"
    # A new rule is not instant from the caller's point of view.
    sleep 2
  else
    log "WARN: could not authorize $ip (no AWS credentials, or rule exists)"
  fi
}

read -r HOST_IP SG_ID <<<"$(resolve)"
[ -n "${HOST_IP:-}" ] && [ "$HOST_IP" != "None" ] || die "$NAME_TAG: no running instance with a public address"

if [ "${1:-}" = "--print-host" ]; then
  printf '%s\n' "$HOST_IP"
  exit 0
fi

MY_IP=$(my_ipv4)
authorize "$SG_ID" "$MY_IP"

if [ "${1:-}" = "--update-sg" ]; then
  log "security group updated; not connecting"
  exit 0
fi

SSH_OPTS=(-o ConnectTimeout=15 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -i "$KEY")

# ── path 1: direct ──────────────────────────────────────────────────────────
if [ "$#" -gt 0 ]; then
  ssh "${SSH_OPTS[@]}" "$SSH_USER@$HOST_IP" "$@" && exit 0
else
  ssh "${SSH_OPTS[@]}" "$SSH_USER@$HOST_IP" && exit 0
fi
rc=$?
log "direct SSH to $HOST_IP failed (exit $rc)"

# ── path 2: Tailscale, only if this host has a peer ─────────────────────────
[ -n "$TS_ALIAS" ] || die "$TARGET has no Tailscale fallback; direct SSH is the only path"

log "falling back to Tailscale ($TS_ALIAS)"
if [ "$#" -gt 0 ]; then
  exec ssh -o ConnectTimeout=15 "$TS_ALIAS" "$@"
else
  exec ssh -o ConnectTimeout=15 "$TS_ALIAS"
fi
