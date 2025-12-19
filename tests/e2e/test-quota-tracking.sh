#!/bin/bash
# test-quota-tracking.sh
# Quota Tracking Test Script
#
# Usage: ./tests/test-quota-tracking.sh [playlist1] [playlist2] [playlist3]

set -e  # Exit on error

echo "🧪 Testing Quota Tracking"
echo "========================="
echo ""

# Default test playlists (small playlists for testing)
PLAYLIST1="${1:-PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf}"
PLAYLIST2="${2:-$PLAYLIST1}"
PLAYLIST3="${3:-$PLAYLIST1}"

if [ -z "$1" ]; then
  echo "⚠️ No playlists provided, using default playlist"
  echo "💡 Usage: ./tests/test-quota-tracking.sh <playlist1> <playlist2> <playlist3>"
  echo ""
fi

# Check initial quota
echo "📊 Initial Quota Status:"
echo "-----------------------------------"
npm run cli -- quota
INITIAL_QUOTA=$(npm run cli -- quota 2>/dev/null | grep -o 'Used: [0-9]*' | grep -o '[0-9]*' || echo "0")
echo ""
echo "Initial quota used: $INITIAL_QUOTA units"
echo ""

# Test 1: Import first playlist
echo "📥 Test 1: Importing first playlist..."
echo "-----------------------------------"
echo "Playlist: $PLAYLIST1"
npm run cli -- import "$PLAYLIST1"
echo ""

echo "📊 Quota after first import:"
npm run cli -- quota
QUOTA_AFTER_1=$(npm run cli -- quota 2>/dev/null | grep -o 'Used: [0-9]*' | grep -o '[0-9]*' || echo "0")
QUOTA_DIFF_1=$((QUOTA_AFTER_1 - INITIAL_QUOTA))
echo "Quota increase: $QUOTA_DIFF_1 units"
echo ""

# Test 2: Re-sync first playlist (should use cache)
echo "🔄 Test 2: Re-syncing first playlist (cache test)..."
echo "-----------------------------------"
echo "Playlist: $PLAYLIST1"
npm run cli -- sync "$PLAYLIST1"
echo ""

echo "📊 Quota after re-sync:"
npm run cli -- quota
QUOTA_AFTER_2=$(npm run cli -- quota 2>/dev/null | grep -o 'Used: [0-9]*' | grep -o '[0-9]*' || echo "0")
QUOTA_DIFF_2=$((QUOTA_AFTER_2 - QUOTA_AFTER_1))
echo "Quota increase: $QUOTA_DIFF_2 units (should be 0 if cache working)"
echo ""

# Test 3: Import second playlist (if different)
if [ "$PLAYLIST2" != "$PLAYLIST1" ]; then
  echo "📥 Test 3: Importing second playlist..."
  echo "-----------------------------------"
  echo "Playlist: $PLAYLIST2"
  npm run cli -- import "$PLAYLIST2"
  echo ""

  echo "📊 Quota after second import:"
  npm run cli -- quota
  QUOTA_AFTER_3=$(npm run cli -- quota 2>/dev/null | grep -o 'Used: [0-9]*' | grep -o '[0-9]*' || echo "0")
  QUOTA_DIFF_3=$((QUOTA_AFTER_3 - QUOTA_AFTER_2))
  echo "Quota increase: $QUOTA_DIFF_3 units"
  echo ""
else
  echo "⏭️  Test 3: Skipped (same playlist as Test 1)"
  echo ""
  QUOTA_AFTER_3=$QUOTA_AFTER_2
fi

# Test 4: Import third playlist (if different)
if [ "$PLAYLIST3" != "$PLAYLIST1" ] && [ "$PLAYLIST3" != "$PLAYLIST2" ]; then
  echo "📥 Test 4: Importing third playlist..."
  echo "-----------------------------------"
  echo "Playlist: $PLAYLIST3"
  npm run cli -- import "$PLAYLIST3"
  echo ""

  echo "📊 Quota after third import:"
  npm run cli -- quota
  QUOTA_AFTER_4=$(npm run cli -- quota 2>/dev/null | grep -o 'Used: [0-9]*' | grep -o '[0-9]*' || echo "0")
  QUOTA_DIFF_4=$((QUOTA_AFTER_4 - QUOTA_AFTER_3))
  echo "Quota increase: $QUOTA_DIFF_4 units"
  echo ""
else
  echo "⏭️  Test 4: Skipped (duplicate playlist)"
  echo ""
  QUOTA_AFTER_4=$QUOTA_AFTER_3
fi

# Final summary
echo "====================================="
echo "📊 Quota Tracking Summary"
echo "====================================="
echo ""
echo "Initial quota: $INITIAL_QUOTA units"
echo "Final quota: $QUOTA_AFTER_4 units"
echo "Total increase: $((QUOTA_AFTER_4 - INITIAL_QUOTA)) units"
echo ""
echo "Test Results:"
echo "  Test 1 (import): +$QUOTA_DIFF_1 units (expected: ~3 units)"
echo "  Test 2 (re-sync): +$QUOTA_DIFF_2 units (expected: 0 units - cache)"
if [ "$PLAYLIST2" != "$PLAYLIST1" ]; then
  echo "  Test 3 (import): +$QUOTA_DIFF_3 units (expected: ~3 units)"
fi
if [ "$PLAYLIST3" != "$PLAYLIST1" ] && [ "$PLAYLIST3" != "$PLAYLIST2" ]; then
  echo "  Test 4 (import): +$QUOTA_DIFF_4 units (expected: ~3 units)"
fi
echo ""

# Validation
echo "✅ Validation:"
if [ "$QUOTA_DIFF_1" -ge 1 ] && [ "$QUOTA_DIFF_1" -le 5 ]; then
  echo "  ✅ First import quota usage is reasonable (1-5 units)"
else
  echo "  ⚠️  First import quota usage unexpected: $QUOTA_DIFF_1 units"
fi

if [ "$QUOTA_DIFF_2" -eq 0 ]; then
  echo "  ✅ Cache is working (re-sync used 0 quota)"
else
  echo "  ⚠️  Cache may not be working (re-sync used $QUOTA_DIFF_2 quota)"
fi

echo ""
echo "✅ Quota tracking test complete"
echo ""
echo "Expected Quota Costs:"
echo "  - Playlist details: 1 unit"
echo "  - PlaylistItems (50 items): 1 unit"
echo "  - Videos batch (50 videos): 1 unit"
echo "  - Total per playlist: ~3 units"
echo ""
echo "💡 Review quota usage above to verify tracking accuracy"
