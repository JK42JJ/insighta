#!/bin/bash
# Supabase Cloud prisma db push 스크립트
# Circuit breaker가 풀린 후 실행 (최소 5-10분 대기 후)
#
# 사용법:
#   DB_PASSWORD=xxx bash scripts/prisma-push-cloud.sh
#   또는 환경변수 미설정 시 프롬프트로 입력

set -e

if [ -z "$DB_PASSWORD" ]; then
  read -sp "Supabase DB Password: " DB_PASSWORD
  echo
fi

POOLER_HOST="aws-0-us-west-2.pooler.supabase.com"
DB_USER="postgres.rckkhhjanqgaopynhfgd"
DIRECT_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${POOLER_HOST}:5432/postgres"

# Step 1: psql 연결 테스트
echo "=== Step 1: psql 연결 테스트 ==="
psql "$DIRECT_URL" -c "SELECT 1"

# Step 2: prisma db push
echo ""
echo "=== Step 2: prisma db push ==="
cd /Users/jeonhokim/cursor/insighta
DIRECT_URL="$DIRECT_URL" npx prisma db push --skip-generate

echo "prisma db push 성공"
