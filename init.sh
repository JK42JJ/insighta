#!/usr/bin/env bash
# Session init for issue #1788 (mobile morning cards).
set -u
echo "== pwd"; pwd
echo "== git"; git status --short --branch; git log --oneline -5
echo "== backend typecheck"; npm run typecheck
echo "== frontend typecheck"; (cd frontend && npm run typecheck)
echo "== quick test"; /usr/local/insighta-harness/current/bin/run-jest.sh tests/smoke/card-interactions.test.ts
