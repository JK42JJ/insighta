#!/bin/bash
# test-oauth-flow.sh
# OAuth Authentication Flow Test Script
#
# Usage: ./tests/test-oauth-flow.sh

set -e  # Exit on error

echo "🧪 Testing OAuth Authentication Flow"
echo "====================================="
echo ""

# Check if .env exists
if [ ! -f .env ]; then
  echo "❌ .env file not found"
  echo "💡 Please run: cp .env.example .env"
  exit 1
fi

# Step 1: Check auth status
echo "Step 1: Checking auth status..."
echo "-----------------------------------"
npm run cli -- auth-status
echo ""

# Step 2: Generate auth URL
echo "Step 2: Generating auth URL..."
echo "-----------------------------------"
npm run cli -- auth
echo ""

echo "✅ OAuth flow test complete"
echo ""
echo "⚠️ Manual steps required:"
echo "  1. Visit the auth URL shown above"
echo "  2. Authorize the application"
echo "  3. Copy the authorization code from the redirect URL"
echo "  4. Run: npm run cli -- auth-callback <code>"
echo ""
echo "After completing OAuth flow:"
echo "  5. Verify authentication: npm run cli -- auth-status"
echo "  6. Test playlist import: npm run cli -- import <playlist-url>"
