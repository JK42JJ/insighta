#!/bin/bash
# setup-test-env.sh
# Test Environment Setup Script
#
# Usage: ./tests/setup-test-env.sh

set -e  # Exit on error

echo "🔧 Setting Up Test Environment"
echo "==============================="
echo ""

# Step 1: Check Node.js version
echo "Step 1: Checking Node.js version..."
echo "-----------------------------------"
NODE_VERSION=$(node -v)
echo "Node.js version: $NODE_VERSION"

REQUIRED_VERSION="v18"
if [[ $NODE_VERSION == $REQUIRED_VERSION* ]]; then
  echo "✅ Node.js version is compatible"
else
  echo "⚠️  Warning: Node.js 18+ recommended, current: $NODE_VERSION"
fi
echo ""

# Step 2: Install dependencies
echo "Step 2: Installing dependencies..."
echo "-----------------------------------"
npm install
echo "✅ Dependencies installed"
echo ""

# Step 3: Check .env file
echo "Step 3: Checking environment configuration..."
echo "-----------------------------------"
if [ -f .env ]; then
  echo "✅ .env file found"

  # Check required OAuth variables
  if grep -q "YOUTUBE_CLIENT_ID" .env && grep -q "YOUTUBE_CLIENT_SECRET" .env; then
    echo "✅ OAuth credentials configured"
  else
    echo "⚠️  OAuth credentials not configured"
    echo "💡 Please set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env"
  fi

  # Check Gemini API key
  if grep -q "GEMINI_API_KEY" .env; then
    echo "✅ Gemini API key configured"
  else
    echo "⚠️  Gemini API key not configured (optional for Phase 2 features)"
  fi
else
  echo "❌ .env file not found"
  echo "Creating .env from .env.example..."
  cp .env.example .env
  echo "✅ .env file created"
  echo "⚠️  Please configure environment variables in .env before testing"
  echo ""
  echo "Required variables:"
  echo "  - YOUTUBE_CLIENT_ID"
  echo "  - YOUTUBE_CLIENT_SECRET"
  echo "  - YOUTUBE_REDIRECT_URI"
  echo ""
  echo "See docs/SETUP_OAUTH.md for setup instructions"
fi
echo ""

# Step 4: Database setup
echo "Step 4: Setting up database..."
echo "-----------------------------------"

# Check if Prisma schema exists
if [ -f prisma/schema.prisma ]; then
  echo "✅ Prisma schema found"

  # Generate Prisma client
  echo "Generating Prisma client..."
  npx prisma generate
  echo "✅ Prisma client generated"

  # Run migrations
  echo "Running database migrations..."
  npx prisma migrate dev --name init
  echo "✅ Database migrations complete"
else
  echo "❌ Prisma schema not found"
  echo "Please ensure prisma/schema.prisma exists"
  exit 1
fi
echo ""

# Step 5: Build TypeScript
echo "Step 5: Building TypeScript..."
echo "-----------------------------------"
npm run build
echo "✅ TypeScript build complete"
echo ""

# Step 6: Create required directories
echo "Step 6: Creating required directories..."
echo "-----------------------------------"
mkdir -p cache
mkdir -p logs
mkdir -p data
echo "✅ Directories created"
echo ""

# Step 7: Verify setup
echo "Step 7: Verifying setup..."
echo "-----------------------------------"

# Check if CLI is working
echo "Testing CLI..."
npm run cli -- --help > /dev/null 2>&1
if [ $? -eq 0 ]; then
  echo "✅ CLI is working"
else
  echo "❌ CLI test failed"
  exit 1
fi

# Check auth-status
echo "Testing auth-status command..."
npm run cli -- auth-status
echo ""

echo "==============================="
echo "✅ Test Environment Setup Complete"
echo "==============================="
echo ""
echo "Next Steps:"
echo "  1. Configure OAuth credentials in .env (if not done)"
echo "     See: docs/SETUP_OAUTH.md"
echo ""
echo "  2. Run OAuth flow test:"
echo "     ./tests/test-oauth-flow.sh"
echo ""
echo "  3. After authentication, run full test suite:"
echo "     ./tests/run-all-tests.sh"
echo ""
echo "  4. Or run individual tests:"
echo "     ./tests/test-cache-performance.sh <playlist-id>"
echo "     ./tests/test-quota-tracking.sh <playlist-id>"
echo ""
