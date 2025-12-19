#!/bin/bash
# run-all-tests.sh
# Master Test Runner - Executes all E2E tests
#
# Usage: ./tests/run-all-tests.sh [playlist-id]

set -e  # Exit on error

TEST_PLAYLIST="${1:-PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf}"
TEST_RESULTS_FILE="./tests/test-results-$(date +%Y%m%d-%H%M%S).md"

echo "🧪 Phase 3.1 E2E Test Suite"
echo "============================"
echo "Test Playlist: $TEST_PLAYLIST"
echo "Results File: $TEST_RESULTS_FILE"
echo ""

# Initialize results file
cat > "$TEST_RESULTS_FILE" << EOF
# Phase 3.1 E2E Test Results

**Test Date**: $(date +"%Y-%m-%d %H:%M:%S")
**Test Playlist**: $TEST_PLAYLIST
**Environment**: development

---

## Test Summary

EOF

# Check if authenticated
echo "🔐 Checking authentication status..."
echo "-----------------------------------"
npm run cli -- auth-status

# Prompt user to confirm
echo ""
read -p "Is OAuth authentication complete? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Please complete OAuth authentication first"
  echo "💡 Run: ./tests/test-oauth-flow.sh"
  exit 1
fi

# Test counter
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Function to run test and track results
run_test() {
  TEST_NAME=$1
  TEST_SCRIPT=$2
  shift 2
  TEST_ARGS=$@

  TOTAL_TESTS=$((TOTAL_TESTS + 1))

  echo ""
  echo "========================================"
  echo "Test $TOTAL_TESTS: $TEST_NAME"
  echo "========================================"
  echo ""

  # Run test and capture output
  if $TEST_SCRIPT $TEST_ARGS > /tmp/test-output.txt 2>&1; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "✅ PASSED: $TEST_NAME"

    cat >> "$TEST_RESULTS_FILE" << EOF

### Test $TOTAL_TESTS: $TEST_NAME
- **Status**: ✅ PASS
- **Script**: $TEST_SCRIPT
- **Duration**: N/A

<details>
<summary>Output</summary>

\`\`\`
$(cat /tmp/test-output.txt)
\`\`\`

</details>

EOF
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "❌ FAILED: $TEST_NAME"

    cat >> "$TEST_RESULTS_FILE" << EOF

### Test $TOTAL_TESTS: $TEST_NAME
- **Status**: ❌ FAIL
- **Script**: $TEST_SCRIPT
- **Duration**: N/A

<details>
<summary>Error Output</summary>

\`\`\`
$(cat /tmp/test-output.txt)
\`\`\`

</details>

EOF
  fi

  # Display output
  cat /tmp/test-output.txt
}

# Run tests
echo ""
echo "🚀 Starting E2E Test Suite..."
echo "========================================"

# Test 1: Cache Performance
run_test "Cache Performance Test" ./tests/test-cache-performance.sh "$TEST_PLAYLIST" 5

# Wait between tests
sleep 2

# Test 2: Quota Tracking
run_test "Quota Tracking Test" ./tests/test-quota-tracking.sh "$TEST_PLAYLIST"

# Test Summary
echo ""
echo "========================================"
echo "📊 Test Suite Summary"
echo "========================================"
echo "Total Tests: $TOTAL_TESTS"
echo "Passed: $PASSED_TESTS"
echo "Failed: $FAILED_TESTS"
echo "Success Rate: $((PASSED_TESTS * 100 / TOTAL_TESTS))%"
echo ""

# Update results file summary
sed -i '' "s/## Test Summary/## Test Summary\n\n- **Total Tests**: $TOTAL_TESTS\n- **Passed**: $PASSED_TESTS\n- **Failed**: $FAILED_TESTS\n- **Success Rate**: $((PASSED_TESTS * 100 / TOTAL_TESTS))%\n\n---/" "$TEST_RESULTS_FILE"

echo "Results saved to: $TEST_RESULTS_FILE"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
  echo "✅ All tests passed!"
  exit 0
else
  echo "⚠️  Some tests failed. Review results above."
  exit 1
fi
