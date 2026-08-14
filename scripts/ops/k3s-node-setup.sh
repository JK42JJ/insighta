#!/usr/bin/env bash
#
# Brings a k3s node to the configuration this project expects. Idempotent:
# safe to run against a fresh instance or one that is already serving.
#
#   scripts/ops/k3s-node-setup.sh          configure the node
#   scripts/ops/k3s-node-setup.sh --check  report what differs, change nothing
#
# Runs on the node. Reach it with scripts/ops/ssh.sh:
#
#   scripts/ops/ssh.sh k3s "sudo bash -s" < scripts/ops/k3s-node-setup.sh
#
# Two things it sets up.
#
# secrets-encryption
#   The cluster is going to hold production credentials. etcd stores secrets
#   base64-encoded by default, which is not encryption.
#
# --disable traefik --disable servicelb
#   k3s otherwise claims 80 and 443. Nothing else holds them on this host, but
#   the production host's nginx does, and a node whose defaults differ from the
#   host it will replace is a difference discovered at the worst moment.
#
# ecr-credential-provider
#   The node has an instance profile with ECR read, and containerd cannot use
#   it. Measured 2026-08-14: the role is visible at the instance metadata
#   endpoint and the pull still fails with
#
#     pull access denied ... authorization failed: no basic auth credentials
#
#   containerd resolves registry credentials from static configuration; it does
#   not call AWS. The kubelet credential provider is the supported bridge: the
#   kubelet runs this binary for images matching the ECR host pattern, the
#   binary exchanges the instance profile for a registry token, and no secret
#   is stored anywhere. Tokens last 12 hours and are refreshed by the same
#   path, so nothing expires into an outage.

set -euo pipefail

CHECK=false
AGENT=false
for a in "$@"; do
  case "$a" in
    --check) CHECK=true ;;
    --agent) AGENT=true ;;
  esac
done

# An agent needs the server's address and token. Both are read from the server
# rather than passed on a command line, so neither ends up in shell history.
#   K3S_URL, K3S_TOKEN in the environment when --agent is given.
if $AGENT && ! $CHECK; then
  : "${K3S_URL:?--agent requires K3S_URL}"
  : "${K3S_TOKEN:?--agent requires K3S_TOKEN}"
fi

CP_VERSION="v1.31.0"   # verified present at artifacts.k8s.io on 2026-08-14
CP_DIR="/var/lib/rancher/credentialprovider"
CP_BIN="$CP_DIR/bin/ecr-credential-provider"
CP_CFG="$CP_DIR/config.yaml"
K3S_CFG="/etc/rancher/k3s/config.yaml"

changed=0
note() { printf '  %s\n' "$*"; }
would() { if $CHECK; then note "WOULD: $*"; else note "$*"; fi; changed=1; }

[ "$(id -u)" -eq 0 ] || { echo "must run as root (sudo)"; exit 1; }

# ── credential provider binary ──────────────────────────────────────────────
if [ -x "$CP_BIN" ]; then
  note "credential provider present"
else
  would "installing ecr-credential-provider $CP_VERSION"
  if ! $CHECK; then
    mkdir -p "$CP_DIR/bin"
    curl -fsSL -o "$CP_BIN" \
      "https://artifacts.k8s.io/binaries/cloud-provider-aws/${CP_VERSION}/linux/amd64/ecr-credential-provider-linux-amd64"
    chmod 0755 "$CP_BIN"
  fi
fi

# ── credential provider config ──────────────────────────────────────────────
read -r -d '' WANT_CFG <<'EOF' || true
apiVersion: kubelet.config.k8s.io/v1
kind: CredentialProviderConfig
providers:
  - name: ecr-credential-provider
    matchImages:
      - "*.dkr.ecr.*.amazonaws.com"
      - "*.dkr.ecr-fips.*.amazonaws.com"
    defaultCacheDuration: "12h"
    apiVersion: credentialprovider.kubelet.k8s.io/v1
EOF

if [ -f "$CP_CFG" ] && [ "$(cat "$CP_CFG")" = "$WANT_CFG" ]; then
  note "credential provider config current"
else
  would "writing $CP_CFG"
  $CHECK || { mkdir -p "$CP_DIR"; printf '%s\n' "$WANT_CFG" > "$CP_CFG"; }
fi

# ── k3s config ──────────────────────────────────────────────────────────────
# Declared in config.yaml rather than in the unit file: the install script
# rewrites the unit, and flags that live only there are lost on upgrade.
if $AGENT; then
  # An agent takes no disable/write-kubeconfig flags -- those configure a
  # server. It does run a kubelet, and the kubelet is what needs the credential
  # provider, so that part is identical on both.
  read -r -d '' WANT_K3S <<EOF || true
kubelet-arg:
  - "image-credential-provider-config=$CP_CFG"
  - "image-credential-provider-bin-dir=$CP_DIR/bin"
EOF
  UNIT=k3s-agent
else
  UNIT=k3s
read -r -d '' WANT_K3S <<EOF || true
disable:
  - traefik
  - servicelb
write-kubeconfig-mode: "644"
# Secrets are stored in etcd. Without this they are stored base64-encoded,
# which is an encoding, not encryption. The flag makes the server load
# server/cred/encryption-config.json; without it, status reports
# "Disabled, no configuration file found" while that file sits there.
#
# The flag alone does not turn encryption on. See the note in the block below.
secrets-encryption: true
kubelet-arg:
  - "image-credential-provider-config=$CP_CFG"
  - "image-credential-provider-bin-dir=$CP_DIR/bin"
EOF
fi

if [ -f "$K3S_CFG" ] && [ "$(cat "$K3S_CFG")" = "$WANT_K3S" ]; then
  note "k3s config current"
else
  would "writing $K3S_CFG"
  $CHECK || { mkdir -p /etc/rancher/k3s; printf '%s\n' "$WANT_K3S" > "$K3S_CFG"; }
fi

if $CHECK; then
  [ "$changed" -eq 0 ] && note "node matches the expected configuration" || note "node differs (see WOULD lines)"
  exit 0
fi

# Install if absent. An agent is the same binary with K3S_URL and K3S_TOKEN
# in the environment, which is what makes it join rather than start a control
# plane of its own.
if ! command -v k3s >/dev/null; then
  would "installing k3s ($AGENT && echo agent || echo server)"
  if ! $CHECK; then
    if $AGENT; then
      curl -sfL https://get.k3s.io | K3S_URL="$K3S_URL" K3S_TOKEN="$K3S_TOKEN" \
        INSTALL_K3S_VERSION="${K3S_VERSION:-v1.36.3+k3s1}" sh -
    else
      curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="${K3S_VERSION:-v1.36.3+k3s1}" sh -
    fi
  fi
  changed=1
fi

if [ "$changed" -eq 1 ] && systemctl is-active --quiet "$UNIT"; then
  note "restarting $UNIT"
  systemctl restart "$UNIT"
  for _ in $(seq 1 30); do
    if $AGENT; then systemctl is-active --quiet "$UNIT" && break
    else k3s kubectl get nodes >/dev/null 2>&1 && break; fi
    sleep 2
  done
fi

# An agent has no cluster-wide state to report and no secrets-encrypt surface.
if $AGENT; then
  note "agent: $(systemctl is-active "$UNIT" 2>/dev/null)"
  note "k3s: $(k3s --version 2>/dev/null | head -1)"
  note "provider: $("$CP_BIN" --version 2>/dev/null | head -1 || echo installed)"
  exit 0
fi

# ── report, from the node's own view ────────────────────────────────────────
# Encryption is reported, not asserted.
#
# `k3s secrets-encrypt enable` fails on this cluster (k3s v1.36.3):
#
#   Put "https://127.0.0.1:6443/v1-k3s/encrypt/config": EOF
#
# with nothing in the server log, and with /readyz returning ok beforehand.
# Four attempts, including one that waited for API readiness explicitly.
#
# So this script sets the flag and reports the status rather than pretending
# the feature is on. Verified by control rather than by trusting the status
# line: an existing secret's value is greppable in server/db/state.db, and a
# canary that showed zero matches was a false negative from the probe, not
# evidence of encryption.
#
# What this means in practice: secrets in etcd are base64-encoded. The compose
# host keeps the same secrets in a plaintext .env on disk, so this is parity
# with production, not a regression -- but it is not the improvement it was
# meant to be, and long-lived credentials belong in AWS Secrets Manager read
# through External Secrets Operator rather than in etcd at all.
note "secrets: $(k3s secrets-encrypt status 2>/dev/null | head -1)"

note "k3s: $(k3s --version 2>/dev/null | head -1)"
note "secrets: $(k3s secrets-encrypt status 2>/dev/null | head -1)"
note "provider: $("$CP_BIN" --version 2>/dev/null | head -1 || echo 'installed')"
note "node: $(k3s kubectl get nodes --no-headers 2>/dev/null | awk '{print $1, $2}')"
