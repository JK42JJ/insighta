# Phase 3.1 End-to-End Testing Plan

**Test Date**: December 16, 2025
**Phase**: 3.1 - YouTube API Integration (OAuth 2.0)
**Purpose**: Validate OAuth authentication flow and response caching system

---

## Testing Objectives

### Primary Goals
1. ✅ **OAuth Flow Validation**: Complete authentication workflow with real YouTube credentials
2. ✅ **API Integration**: Verify playlist import and sync operations
3. ✅ **Cache Performance**: Measure cache hit/miss rates and token savings
4. ✅ **Quota Tracking**: Validate API quota usage accuracy
5. ✅ **Error Handling**: Test failure scenarios and recovery mechanisms

### Success Criteria
- OAuth flow completes without errors
- Playlist import successful with real data
- Cache hit rate ≥60% on subsequent requests
- Quota tracking accurate within ±5%
- Token savings ≥30% with caching enabled

---

## Test Environment Setup

### Prerequisites
```bash
# 1. Install dependencies
npm install

# 2. Copy environment template
cp .env.example .env

# 3. Configure OAuth credentials (see docs/SETUP_OAUTH.md)
# - YOUTUBE_CLIENT_ID
# - YOUTUBE_CLIENT_SECRET
# - YOUTUBE_REDIRECT_URI

# 4. Run database migrations
npx prisma migrate dev

# 5. Build TypeScript
npm run build
```

### Test Data Requirements
- **YouTube Account**: Active Google account with access to playlists
- **Test Playlists**:
  - Small playlist (5-10 videos) for quick tests
  - Medium playlist (50-100 videos) for performance tests
  - Large playlist (200+ videos) for stress tests
- **Gemini API Key**: For Phase 2 integration testing (optional)

---

## Test Scenarios

### Scenario 1: OAuth Authentication Flow

**Objective**: Validate complete OAuth 2.0 authentication workflow

**Test Steps**:
```bash
# Step 1: Check initial auth status
npm run cli -- auth-status

# Expected Output:
# ❌ No authentication configured (if first time)
# OR
# ✅ OAuth 2.0 is configured (if credentials set)

# Step 2: Start OAuth flow
npm run cli -- auth

# Expected Output:
# 🔐 YouTube API OAuth 2.0 Authentication
# 📋 Follow these steps to authenticate:
# 1. Visit the following URL in your browser:
#    https://accounts.google.com/o/oauth2/v2/auth?...

# Step 3: Complete OAuth flow
# - Copy authorization URL
# - Open in browser
# - Authorize application
# - Copy authorization code from redirect URL

# Step 4: Exchange code for tokens
npm run cli -- auth-callback "<authorization-code>"

# Expected Output:
# ✅ Authentication successful!
# 📝 Save these tokens securely:
# YOUTUBE_ACCESS_TOKEN=ya29.a0AfH6SMBx...
# YOUTUBE_REFRESH_TOKEN=1//0gQE8fZ...

# Step 5: Update .env file with tokens
# Manually copy YOUTUBE_ACCESS_TOKEN and YOUTUBE_REFRESH_TOKEN to .env

# Step 6: Verify authentication
npm run cli -- auth-status

# Expected Output:
# ✅ OAuth 2.0 is configured
# 💡 Run "yt-sync auth" to authenticate
```

**Validation Points**:
- ✅ Authorization URL generates correctly with proper scopes
- ✅ Token exchange succeeds with valid authorization code
- ✅ Access token and refresh token received
- ✅ Auth status reflects authenticated state

**Expected Failures** (and recovery):
- ❌ Invalid authorization code → Clear error message, prompt to retry
- ❌ Code expired (>10 minutes) → Suggest running `auth` again
- ❌ Redirect URI mismatch → Guide to check Google Cloud Console settings

---

### Scenario 2: Playlist Import

**Objective**: Import a real YouTube playlist and verify metadata storage

**Test Steps**:
```bash
# Step 1: Import a small playlist (5-10 videos)
npm run cli -- import "https://www.youtube.com/playlist?list=PLxxxxxx"

# Expected Output:
# 📥 Importing playlist: PLxxxxxx
# ✅ Playlist imported: [Playlist Title]
# 📊 Videos: 8
# 💾 Saved to database

# Step 2: List imported playlists
npm run cli -- list

# Expected Output:
# 📋 Synced Playlists:
# 1. [Playlist Title] (8 videos)
#    Channel: [Channel Name]
#    Last synced: Never

# Step 3: View playlist details
npm run cli -- info PLxxxxxx

# Expected Output:
# 📋 Playlist Details:
# Title: [Playlist Title]
# Description: [Description]
# Videos: 8
# Channel: [Channel Name]
```

**Validation Points**:
- ✅ Playlist metadata fetched correctly (title, description, channel)
- ✅ Item count matches actual playlist size
- ✅ Database records created (Playlist, Videos, PlaylistItems)
- ✅ Duplicate playlist detection (re-import doesn't create duplicates)

**Database Verification**:
```bash
# Check database records
npx prisma studio

# Verify tables:
# - Playlist: 1 record with correct metadata
# - Video: 8 records with video details
# - PlaylistItem: 8 records with correct positions
# - QuotaUsage: 3 records (1 playlist + 1 playlistitems + 1 videos batch)
```

**Expected Quota Usage**:
- Playlist details: 1 unit
- PlaylistItems (8 videos): 1 unit
- Videos batch (8 videos): 1 unit
- **Total**: 3 units

---

### Scenario 3: Response Caching Validation

**Objective**: Measure cache performance and token savings

**Test Setup**:
```bash
# Clear cache before test
npm run cli -- cache-clear

# Enable debug logging
export LOG_LEVEL=debug
```

**Test Steps**:

**Phase A: First Request (Cache Miss)**
```bash
# Import playlist (fresh, no cache)
npm run cli -- import "https://www.youtube.com/playlist?list=PLxxxxxx"

# Monitor cache stats
npm run cli -- cache-stats

# Expected Output:
# 📊 Cache Statistics:
# Total files: 3 (playlist + playlistitems + videos)
# Total size: ~15-25 KB
# Oldest: 0 seconds
# Newest: 0 seconds
```

**Phase B: Second Request (Cache Hit)**
```bash
# Re-sync same playlist (should use cache)
npm run cli -- sync PLxxxxxx

# Check logs for cache hits
# Expected log entries:
# [DEBUG] Cache hit: playlist:PLxxxxxx
# [DEBUG] Cache hit: playlistitems:PLxxxxxx
# [DEBUG] Cache hit: videos:batch:[video-ids]

# Verify quota usage
npm run cli -- quota

# Expected Output:
# 📊 Quota Usage Today:
# Used: 3 units (from first import)
# Remaining: 9,997 units
# ⚠️ Note: No additional quota used (cache hits)
```

**Phase C: Cache Performance Measurement**
```bash
# Sync 5 times to measure cache effectiveness
for i in {1..5}; do
  npm run cli -- sync PLxxxxxx
  sleep 2
done

# Check cache stats
npm run cli -- cache-stats

# Expected Output:
# 📊 Cache Statistics:
# Hit rate: 100% (5/5 syncs used cache)
# Total files: 3
# Total size: ~15-25 KB
```

**Validation Points**:
- ✅ First request creates cache entries (3 files: playlist + items + videos)
- ✅ Subsequent requests use cached data (no API calls)
- ✅ Cache hit rate ≥60% after 5 syncs
- ✅ Quota usage doesn't increase on cached requests
- ✅ Token savings: ~2-5K tokens per cached playlist request

**Cache TTL Validation**:
```bash
# Wait for cache to expire (default: 1 hour)
# For testing, temporarily modify TTL in code or wait

# After expiration, sync should fetch fresh data
npm run cli -- sync PLxxxxxx

# Verify new cache files created
npm run cli -- cache-stats
# Oldest file: 0 seconds (fresh cache)
```

---

### Scenario 4: Quota Tracking Validation

**Objective**: Verify quota usage tracking accuracy

**Test Steps**:
```bash
# Step 1: Check initial quota
npm run cli -- quota

# Expected Output:
# 📊 Quota Usage Today:
# Used: 0 units
# Remaining: 10,000 units

# Step 2: Import playlist (known cost: 3 units)
npm run cli -- import "https://www.youtube.com/playlist?list=PLxxxxxx"

# Step 3: Verify quota increased
npm run cli -- quota

# Expected Output:
# 📊 Quota Usage Today:
# Used: 3 units
# Remaining: 9,997 units

# Step 4: Sync another playlist (known cost: 3 units if not cached)
npm run cli -- import "https://www.youtube.com/playlist?list=PLyyyyyy"

# Step 5: Check final quota
npm run cli -- quota

# Expected Output:
# 📊 Quota Usage Today:
# Used: 6 units
# Remaining: 9,994 units
```

**Validation Points**:
- ✅ Quota tracking initialized at 0
- ✅ Each operation increments quota correctly
- ✅ Quota resets daily (test next day)
- ✅ Warning triggered at 90% (9,000 units)

**Database Verification**:
```bash
# Check QuotaUsage table
npx prisma studio

# Verify records:
# - 2 operations logged
# - Costs: 3 units each
# - Timestamps: within current day
# - Operation types: playlist.details, playlistitems.list, videos.list
```

---

### Scenario 5: Error Handling and Recovery

**Objective**: Test failure scenarios and recovery mechanisms

**Test Cases**:

**Case A: Invalid Authorization Code**
```bash
npm run cli -- auth-callback "invalid-code"

# Expected Output:
# ❌ Authentication failed: invalid_grant
# Possible issues:
#   - Invalid authorization code
#   - Code expired (codes are valid for 10 minutes)
#   - Redirect URI mismatch
```

**Case B: Expired Access Token**
```bash
# Manually set expired token in .env
# Or wait 1 hour for token to expire

npm run cli -- import "https://www.youtube.com/playlist?list=PLxxxxxx"

# Expected Behavior:
# - Automatic token refresh using refresh_token
# - Operation continues without user intervention
# OR (if refresh fails):
# ❌ Authentication expired, please re-authenticate
# 💡 Run: npm run cli -- auth
```

**Case C: Invalid Playlist URL**
```bash
npm run cli -- import "https://youtube.com/invalid-url"

# Expected Output:
# ❌ Invalid playlist URL or ID format
# 💡 Valid formats:
#   - https://www.youtube.com/playlist?list=PLxxxxxx
#   - PLxxxxxx
```

**Case D: Network Failure**
```bash
# Simulate network failure (disconnect internet)
npm run cli -- import "https://www.youtube.com/playlist?list=PLxxxxxx"

# Expected Output:
# ❌ Network error: ENOTFOUND
# 🔄 Retrying in 2 seconds... (attempt 1/5)
# 🔄 Retrying in 4 seconds... (attempt 2/5)
# ...
# ❌ Failed after 5 attempts
```

**Case E: API Quota Exceeded**
```bash
# Manually set quota to 10,000 in database
# Or run operations until quota exhausted

npm run cli -- import "https://www.youtube.com/playlist?list=PLxxxxxx"

# Expected Output:
# ❌ Daily quota limit exceeded (10,000/10,000)
# ⏳ Quota resets at midnight PST
# 💡 Consider requesting quota increase at:
#    https://console.cloud.google.com/apis/quotas
```

**Validation Points**:
- ✅ Clear error messages for each failure type
- ✅ Retry logic with exponential backoff
- ✅ Quota exhaustion detection and messaging
- ✅ Graceful degradation (cache used when available)

---

## Performance Benchmarks

### Target Metrics

| Metric | Target | Acceptable | Critical |
|--------|--------|------------|----------|
| **OAuth Flow** | <10s | <30s | >60s |
| **Small Playlist Import (10 videos)** | <5s | <10s | >20s |
| **Medium Playlist Import (50 videos)** | <15s | <30s | >60s |
| **Large Playlist Import (200 videos)** | <60s | <120s | >300s |
| **Cache Hit Rate** | ≥80% | ≥60% | <40% |
| **Token Savings** | ≥40% | ≥30% | <20% |
| **Quota Accuracy** | ±2% | ±5% | >10% |

### Measurement Commands

```bash
# Measure import time
time npm run cli -- import "https://www.youtube.com/playlist?list=PLxxxxxx"

# Measure sync time (with cache)
time npm run cli -- sync PLxxxxxx

# Check cache performance
npm run cli -- cache-stats
```

---

## Test Results Documentation

### Test Report Template

```markdown
# Phase 3.1 E2E Test Results

**Test Date**: [Date]
**Tester**: [Name]
**Environment**: [development/staging/production]

## Test Summary

- **Total Tests**: [X]
- **Passed**: [X]
- **Failed**: [X]
- **Skipped**: [X]

## Scenario Results

### Scenario 1: OAuth Authentication Flow
- **Status**: ✅ PASS / ❌ FAIL
- **Duration**: [X] seconds
- **Notes**: [Observations]

### Scenario 2: Playlist Import
- **Status**: ✅ PASS / ❌ FAIL
- **Playlist**: [URL]
- **Videos**: [Count]
- **Duration**: [X] seconds
- **Quota Used**: [X] units
- **Notes**: [Observations]

### Scenario 3: Response Caching
- **Status**: ✅ PASS / ❌ FAIL
- **Cache Hit Rate**: [X]%
- **Token Savings**: [X]%
- **Cache Files**: [X]
- **Cache Size**: [X] MB
- **Notes**: [Observations]

### Scenario 4: Quota Tracking
- **Status**: ✅ PASS / ❌ FAIL
- **Expected Usage**: [X] units
- **Actual Usage**: [X] units
- **Accuracy**: ±[X]%
- **Notes**: [Observations]

### Scenario 5: Error Handling
- **Status**: ✅ PASS / ❌ FAIL
- **Test Cases Passed**: [X/5]
- **Notes**: [Observations]

## Performance Benchmarks

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| OAuth Flow | <10s | [X]s | ✅/❌ |
| Small Import (10) | <5s | [X]s | ✅/❌ |
| Medium Import (50) | <15s | [X]s | ✅/❌ |
| Cache Hit Rate | ≥80% | [X]% | ✅/❌ |
| Token Savings | ≥40% | [X]% | ✅/❌ |
| Quota Accuracy | ±2% | ±[X]% | ✅/❌ |

## Issues Found

### Critical Issues
1. [Issue description]
   - **Impact**: [High/Medium/Low]
   - **Steps to Reproduce**: [Steps]
   - **Expected**: [Behavior]
   - **Actual**: [Behavior]

### Minor Issues
1. [Issue description]

## Recommendations

1. [Recommendation 1]
2. [Recommendation 2]

## Next Steps

1. [Next step 1]
2. [Next step 2]
```

---

## Automated Test Scripts

### Script 1: OAuth Flow Test

```bash
#!/bin/bash
# test-oauth-flow.sh

echo "🧪 Testing OAuth Authentication Flow"
echo "====================================="

# Step 1: Check auth status
echo "Step 1: Checking auth status..."
npm run cli -- auth-status

# Step 2: Generate auth URL
echo -e "\nStep 2: Generating auth URL..."
npm run cli -- auth

echo -e "\n✅ OAuth flow test complete"
echo "⚠️ Manual steps required:"
echo "  1. Visit the auth URL"
echo "  2. Authorize the app"
echo "  3. Run: npm run cli -- auth-callback <code>"
```

### Script 2: Cache Performance Test

```bash
#!/bin/bash
# test-cache-performance.sh

PLAYLIST_ID="${1:-PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf}"
ITERATIONS="${2:-10}"

echo "🧪 Testing Cache Performance"
echo "============================"
echo "Playlist: $PLAYLIST_ID"
echo "Iterations: $ITERATIONS"
echo ""

# Clear cache
echo "Clearing cache..."
npm run cli -- cache-clear

# First sync (cache miss)
echo -e "\n📥 First sync (cache miss)..."
time npm run cli -- sync "$PLAYLIST_ID"

# Multiple syncs (cache hits)
echo -e "\n🔄 Running $ITERATIONS syncs (cache hits)..."
for i in $(seq 1 $ITERATIONS); do
  echo "Sync $i/$ITERATIONS..."
  time npm run cli -- sync "$PLAYLIST_ID"
  sleep 1
done

# Check cache stats
echo -e "\n📊 Cache Statistics:"
npm run cli -- cache-stats

echo -e "\n✅ Cache performance test complete"
```

### Script 3: Quota Tracking Test

```bash
#!/bin/bash
# test-quota-tracking.sh

echo "🧪 Testing Quota Tracking"
echo "========================="

# Check initial quota
echo "Initial quota:"
npm run cli -- quota

# Import 3 playlists
PLAYLISTS=(
  "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
  "PLxxxxxx"
  "PLyyyyyy"
)

for playlist in "${PLAYLISTS[@]}"; do
  echo -e "\n📥 Importing $playlist..."
  npm run cli -- import "$playlist"

  echo "Current quota:"
  npm run cli -- quota
done

echo -e "\n✅ Quota tracking test complete"
```

---

## Manual Verification Checklist

### Pre-Testing
- [ ] Environment variables configured (.env)
- [ ] Database migrated (npx prisma migrate dev)
- [ ] TypeScript compiled (npm run build)
- [ ] Cache directory exists (./cache)
- [ ] Log directory exists (./logs)

### During Testing
- [ ] OAuth URL generates correctly
- [ ] Browser authorization succeeds
- [ ] Tokens received and saved
- [ ] Playlist import successful
- [ ] Database records created
- [ ] Cache files created
- [ ] Quota tracking accurate
- [ ] Error messages clear and helpful

### Post-Testing
- [ ] All test scenarios completed
- [ ] Test results documented
- [ ] Issues logged in GitHub
- [ ] Performance benchmarks recorded
- [ ] Screenshots captured (if applicable)

---

## Troubleshooting

### Common Issues

**Issue**: OAuth flow fails with "redirect_uri_mismatch"
- **Solution**: Ensure YOUTUBE_REDIRECT_URI in .env matches Google Cloud Console exactly

**Issue**: Tokens not persisting between sessions
- **Solution**: Verify tokens saved to .env file correctly

**Issue**: Cache not working (all requests hit API)
- **Solution**: Check cache directory exists and has write permissions

**Issue**: Quota tracking shows incorrect values
- **Solution**: Check database QuotaUsage table for orphaned records

---

## Test Data Cleanup

```bash
# Clear all test data
npx prisma migrate reset

# Clear cache
npm run cli -- cache-clear

# Clear logs
rm -rf ./logs/*

# Reset .env tokens (manual)
# Remove YOUTUBE_ACCESS_TOKEN and YOUTUBE_REFRESH_TOKEN lines
```

---

## Success Criteria Summary

✅ **Phase 3.1 E2E Testing Complete When**:
1. OAuth flow works end-to-end with real credentials
2. Playlist import successful with correct metadata
3. Cache hit rate ≥60% on repeated requests
4. Quota tracking accurate within ±5%
5. Error handling covers all failure scenarios
6. Performance meets acceptable benchmarks
7. Test results documented

---

**Test Plan Version**: 1.0
**Last Updated**: December 16, 2025
**Next Review**: After test execution
