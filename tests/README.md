# Testing Guide

Comprehensive testing documentation for the YouTube Playlist Sync project.

---

## 📁 Test Structure

This directory contains all project tests organized by type:

- **[e2e/](./e2e/)** - End-to-End tests (bash scripts for OAuth, caching, quota tracking)
- **[unit/](./unit/)** - Unit tests (Jest-based, future implementation)
- **[integration/](./integration/)** - Integration tests (Jest-based, future implementation)
- **[manual/](./manual/)** - Manual development scripts for debugging

---

## Quick Start (E2E Tests)

### 1. Setup Test Environment

```bash
# Run environment setup script
./tests/e2e/setup-test-env.sh
```

This script will:
- ✅ Check Node.js version (18+ required)
- ✅ Install npm dependencies
- ✅ Create/verify .env configuration
- ✅ Run database migrations
- ✅ Build TypeScript
- ✅ Create required directories (cache, logs, data)
- ✅ Verify CLI is working

### 2. Configure OAuth Credentials

Before running tests, you must configure OAuth credentials:

1. Follow setup guide: `docs/SETUP_OAUTH.md`
2. Update `.env` file with:
   - `YOUTUBE_CLIENT_ID`
   - `YOUTUBE_CLIENT_SECRET`
   - `YOUTUBE_REDIRECT_URI`

### 3. Complete OAuth Authentication

```bash
# Test OAuth flow
./tests/e2e/test-oauth-flow.sh
```

Follow the on-screen instructions:
1. Visit the generated authorization URL
2. Authorize the application
3. Copy the authorization code
4. Run: `npm run cli -- auth-callback <code>`
5. Save tokens to `.env` file

### 4. Run Full Test Suite

```bash
# Run all E2E tests
./tests/e2e/run-all-tests.sh [playlist-id]

# Example:
./tests/e2e/run-all-tests.sh PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf
```

---

## Individual Test Scripts

### OAuth Flow Test

Tests the complete OAuth 2.0 authentication workflow.

```bash
./tests/e2e/test-oauth-flow.sh
```

**What it tests**:
- Authorization URL generation
- OAuth client configuration
- Authentication status checking

**Expected outcome**:
- ✅ Authorization URL generated with correct scopes
- ✅ Auth status shows configuration state

**Manual steps required**:
- Browser authorization
- Token exchange via `auth-callback` command

---

### Cache Performance Test

Measures response caching effectiveness and token savings.

```bash
./tests/e2e/test-cache-performance.sh [playlist-id] [iterations]

# Examples:
./tests/e2e/test-cache-performance.sh PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf 10
./tests/e2e/test-cache-performance.sh PLxxxxxx 5
```

**Parameters**:
- `playlist-id` (optional): YouTube playlist ID or URL
  - Default: `PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf`
- `iterations` (optional): Number of sync iterations
  - Default: `10`

**What it tests**:
- First import (cache miss) performance
- Subsequent syncs (cache hit) performance
- Cache hit rate measurement
- Token savings calculation
- Quota usage with caching

**Expected outcomes**:
- ✅ First import: 3 units quota used (playlist + items + videos)
- ✅ Subsequent syncs: 0 units quota (cache hits)
- ✅ Cache hit rate: ~100% for repeated syncs
- ✅ Speed improvement: 30-50% with cache

**Output includes**:
- Import duration (first request)
- Average sync duration (cached requests)
- Cache statistics (files, size, age)
- Quota usage summary
- Performance improvement percentage

---

### Quota Tracking Test

Validates API quota usage tracking accuracy.

```bash
./tests/e2e/test-quota-tracking.sh [playlist1] [playlist2] [playlist3]

# Examples:
./tests/e2e/test-quota-tracking.sh PLxxxxxx
./tests/e2e/test-quota-tracking.sh PLxxxxxx PLyyyyyy PLzzzzzz
```

**Parameters**:
- `playlist1`, `playlist2`, `playlist3` (optional): Playlist IDs to test
  - Default: Uses same playlist for all tests

**What it tests**:
- Initial quota state
- Quota increase after playlist import
- Cache effect on quota (re-sync should use 0 quota)
- Multiple playlist imports
- Quota accuracy

**Expected outcomes**:
- ✅ Initial quota: 0 units (or previous day's usage)
- ✅ First import: +3 units
- ✅ Re-sync (cached): +0 units
- ✅ Each new playlist: +3 units
- ✅ Quota tracking accuracy: ±5%

**Quota costs reference**:
- Playlist details: 1 unit
- PlaylistItems (50 items): 1 unit
- Videos batch (50 videos): 1 unit
- **Total per playlist**: ~3 units

---

## Test Types

### E2E Tests (`e2e/`)

End-to-end bash scripts testing OAuth authentication, caching, and quota tracking.

**When to use**:
- Testing OAuth flow with real YouTube API
- Validating cache performance
- Verifying quota tracking accuracy
- Integration testing with external services

**Run all E2E tests**:
```bash
./tests/e2e/run-all-tests.sh [playlist-id]
```

### Unit Tests (`unit/`)

Jest-based unit tests for individual modules (future implementation).

**When to use**:
- Testing individual functions and classes
- Isolated logic testing without external dependencies
- Fast feedback during development

**Run unit tests** (when implemented):
```bash
npm test
# or
npm run test:unit
```

### Integration Tests (`integration/`)

Jest-based integration tests for module interactions (future implementation).

**When to use**:
- Testing database operations
- Testing module interactions
- Testing API client integration

**Run integration tests** (when implemented):
```bash
npm run test:integration
```

### Manual Scripts (`manual/`)

Development and debugging scripts for ad-hoc testing.

**When to use**:
- Quick validation during development
- Debugging specific features (e.g., transcript extraction)
- Finding test data

**See**: [manual/README.md](./manual/README.md) for detailed usage

---

## Test Results

Test results are automatically saved to timestamped files:

```
tests/test-results-YYYYMMDD-HHMMSS.md
```

Results include:
- Test summary (total, passed, failed, success rate)
- Individual test details
- Output logs for each test
- Performance metrics

---

## Test Playlists

### Recommended Test Playlists

**Small Playlist** (5-10 videos):
- Best for quick tests
- Minimal quota usage
- Fast execution

**Medium Playlist** (50-100 videos):
- Performance testing
- Cache effectiveness
- Realistic usage scenario

**Large Playlist** (200+ videos):
- Stress testing
- Pagination testing
- Maximum quota usage

### Creating Test Playlists

For consistent testing, create your own test playlists:

1. Go to YouTube
2. Create a new playlist
3. Add 5-10 videos
4. Set to "Public" or "Unlisted"
5. Copy playlist ID from URL
6. Use in tests: `./tests/e2e/test-cache-performance.sh YOUR_PLAYLIST_ID`

---

## Troubleshooting

### "OAuth client not initialized"

**Problem**: Missing OAuth credentials in `.env`

**Solution**:
```bash
# Check .env file
cat .env | grep YOUTUBE_CLIENT_ID
cat .env | grep YOUTUBE_CLIENT_SECRET

# If missing, configure credentials
# See: docs/SETUP_OAUTH.md
```

### "Invalid authorization code"

**Problem**: Authorization code expired or already used

**Solution**:
```bash
# Generate new code
./tests/e2e/test-oauth-flow.sh

# Complete OAuth flow with new code
```

### "Cache not working"

**Problem**: Cache directory permissions or configuration

**Solution**:
```bash
# Check cache directory
ls -la ./cache

# Clear and recreate
npm run cli -- cache-clear
mkdir -p ./cache
```

### "Quota exceeded"

**Problem**: Daily quota limit reached (10,000 units)

**Solution**:
- Wait until next day (quota resets at midnight PST)
- Use smaller test playlists
- Enable caching to reduce quota usage
- Request quota increase in Google Cloud Console

---

## Test Environment Requirements

### System Requirements
- Node.js 18+
- npm 8+
- 500MB free disk space
- Internet connection

### Configuration Requirements
- Google Cloud Project with YouTube Data API v3 enabled
- OAuth 2.0 credentials (Client ID, Client Secret)
- Valid YouTube account for testing
- Test playlists (public or unlisted)

### Optional Requirements
- Gemini API key (for Phase 2 features)
- PostgreSQL (for production testing)

---

## Best Practices

### 1. Use Small Playlists for Development
- Faster test execution
- Lower quota usage
- Easier debugging

### 2. Clear Cache Between Test Runs
```bash
npm run cli -- cache-clear
```

### 3. Monitor Quota Usage
```bash
npm run cli -- quota
```

### 4. Use Consistent Test Data
- Same playlists for reproducible results
- Document test playlist IDs
- Version control test configurations

### 5. Review Logs
```bash
# Check logs for detailed information
cat ./logs/app.log

# Enable debug logging
export LOG_LEVEL=debug
```

---

## Test Coverage

### Covered Scenarios
- ✅ OAuth 2.0 authentication flow
- ✅ Playlist import and metadata storage
- ✅ Response caching effectiveness
- ✅ Cache hit/miss rates
- ✅ Quota tracking accuracy
- ✅ Token savings measurement
- ✅ Error handling (manual testing required)

### Not Covered (Manual Testing Required)
- Token expiration and refresh
- Invalid credentials handling
- Network failure scenarios
- Concurrent sync operations
- Database transaction rollbacks
- Edge cases (empty playlists, private videos, etc.)

---

## Performance Benchmarks

### Expected Performance

| Metric | Target | Acceptable | Critical |
|--------|--------|------------|----------|
| Small Playlist Import (10 videos) | <5s | <10s | >20s |
| Medium Playlist Import (50 videos) | <15s | <30s | >60s |
| Cache Hit Rate | ≥80% | ≥60% | <40% |
| Token Savings | ≥40% | ≥30% | <20% |
| Quota Accuracy | ±2% | ±5% | >10% |

### Measuring Performance

```bash
# Measure import time
time npm run cli -- import "https://www.youtube.com/playlist?list=PLxxxxxx"

# Measure sync time (with cache)
time npm run cli -- sync PLxxxxxx

# Check cache performance
npm run cli -- cache-stats
```

---

## Next Steps After Testing

### If All Tests Pass ✅

1. **Document Results**
   - Review test results file
   - Note any performance metrics
   - Document any issues encountered

2. **Prepare for Production**
   - Configure production environment variables
   - Set up monitoring and logging
   - Plan quota management strategy

3. **Optional Enhancements**
   - Implement automatic token refresh UI
   - Add automatic .env file updates
   - Create OAuth callback server
   - Support multi-account authentication

### If Tests Fail ❌

1. **Review Error Messages**
   - Check test output logs
   - Identify failure patterns
   - Review application logs (`./logs/app.log`)

2. **Common Fixes**
   - Update OAuth credentials
   - Clear and rebuild cache
   - Reset database (`npx prisma migrate reset`)
   - Check API quota limits

3. **Report Issues**
   - Create GitHub issue with test results
   - Include error logs and configuration (remove secrets!)
   - Provide reproduction steps

---

## Support

For issues or questions:
1. Check [PHASE3.1_E2E_TEST_PLAN.md](../PHASE3.1_E2E_TEST_PLAN.md)
2. Review [docs/SETUP_OAUTH.md](../docs/SETUP_OAUTH.md)
3. Check logs in `./logs` directory
4. Review [PHASE3.1_COMPLETE.md](../PHASE3.1_COMPLETE.md) troubleshooting section

---

**Last Updated**: December 16, 2025
**Version**: Phase 3.1
