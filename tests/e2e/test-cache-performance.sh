#!/bin/bash
# test-cache-performance.sh
# Cache Performance Test Script
#
# Usage: ./tests/test-cache-performance.sh <playlist-id> [iterations]
# Example: ./tests/test-cache-performance.sh PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf 10

set -e  # Exit on error

PLAYLIST_ID="${1:-PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf}"
ITERATIONS="${2:-10}"

echo "🧪 Testing Cache Performance"
echo "============================"
echo "Playlist: $PLAYLIST_ID"
echo "Iterations: $ITERATIONS"
echo ""

# Check if playlist ID provided
if [ -z "$1" ]; then
  echo "⚠️ No playlist ID provided, using default"
  echo "💡 Usage: ./tests/test-cache-performance.sh <playlist-id> [iterations]"
  echo ""
fi

# Clear cache
echo "Clearing cache..."
echo "-----------------------------------"
npm run cli -- cache-clear
echo ""

# First sync (cache miss)
echo "📥 First sync (cache miss)..."
echo "-----------------------------------"
echo "Measuring import time..."
start_time=$(date +%s)
npm run cli -- import "$PLAYLIST_ID"
end_time=$(date +%s)
import_duration=$((end_time - start_time))
echo "⏱️  Import duration: ${import_duration}s"
echo ""

# Check cache after first sync
echo "📊 Cache after first sync:"
npm run cli -- cache-stats
echo ""

# Multiple syncs (cache hits)
echo "🔄 Running $ITERATIONS syncs (cache hits)..."
echo "-----------------------------------"
total_duration=0

for i in $(seq 1 $ITERATIONS); do
  echo "Sync $i/$ITERATIONS..."
  start_time=$(date +%s)
  npm run cli -- sync "$PLAYLIST_ID"
  end_time=$(date +%s)
  duration=$((end_time - start_time))
  total_duration=$((total_duration + duration))
  echo "⏱️  Duration: ${duration}s"
  sleep 1
done

average_duration=$((total_duration / ITERATIONS))
echo ""
echo "📊 Sync Performance:"
echo "  Total duration: ${total_duration}s"
echo "  Average duration: ${average_duration}s"
echo "  First import: ${import_duration}s"
echo "  Speed improvement: $((import_duration - average_duration))s ($((100 * (import_duration - average_duration) / import_duration))%)"
echo ""

# Check cache stats
echo "📊 Final Cache Statistics:"
echo "-----------------------------------"
npm run cli -- cache-stats
echo ""

# Check quota usage
echo "📊 Quota Usage:"
echo "-----------------------------------"
npm run cli -- quota
echo ""

echo "✅ Cache performance test complete"
echo ""
echo "Expected Results:"
echo "  - First import: Uses API quota (3 units for small playlist)"
echo "  - Subsequent syncs: Use cache (0 additional quota)"
echo "  - Cache hit rate: ~100% for repeated syncs"
echo "  - Speed improvement: 30-50% with cache"
echo ""
echo "💡 Review cache stats above to verify cache effectiveness"
