# Manual Development Scripts

Ad-hoc testing scripts used during development and debugging of Phase 2 features (transcript extraction and caption handling).

---

## 📁 Scripts Overview

### test-transcript.js

Tests the `youtube-transcript` library with different language configurations.

**Purpose**: Validate transcript fetching functionality for various language settings.

**Usage**:
```bash
node tests/manual/test-transcript.js
```

**What it tests**:
- Fetching transcript without language specification
- Fetching transcript with `lang=en` parameter
- Fetching transcript with `lang=ja` parameter
- Error handling for each scenario

**Expected output**:
```
Testing transcript for video: dQw4w9WgXcQ

1. Testing without language specification:
   Success! Got 45 segments
   First segment: { text: '...', offset: 0, duration: 2.5 }

2. Testing with lang=en:
   Success! Got 45 segments
   ...

3. Testing with lang=ja:
   Error: No captions available in Japanese
```

---

### test-different-videos.js

Tests multiple YouTube videos to find ones with working captions.

**Purpose**: Identify test videos with reliable caption availability for development testing.

**Usage**:
```bash
node tests/manual/test-different-videos.js
```

**What it tests**:
- Iterates through predefined list of popular videos
- Tests caption availability for each
- Reports success/failure for each video
- Stops at first working video

**Test videos**:
- Rick Astley - Never Gonna Give You Up
- Me at the zoo (first YouTube video)
- Charlie bit my finger
- Luis Fonsi - Despacito

**Expected output**:
```
Testing multiple videos to find one with working captions...

Testing: Rick Astley - Never Gonna Give You Up (dQw4w9WgXcQ)
  ✅ SUCCESS! Got 167 segments
  First: "We're no strangers to love"

✨ Found working video: dQw4w9WgXcQ

Test completed
```

---

### test-transcript-debug.js

Debug version of transcript testing with additional logging and error details.

**Purpose**: Troubleshoot transcript fetching issues with verbose output.

**Usage**:
```bash
node tests/manual/test-transcript-debug.js
```

**Features**:
- Enhanced error logging
- Additional debugging information
- Detailed API response inspection
- Useful for investigating caption availability issues

---

## 🎯 When to Use Manual Scripts

### During Development
- Quick validation of transcript library functionality
- Testing new video IDs for caption availability
- Debugging caption extraction issues
- Verifying language support

### For Testing
- Finding suitable test videos with captions
- Validating transcript quality
- Testing edge cases (different languages, no captions, etc.)
- Ad-hoc API behavior validation

### Not For
- ❌ Automated testing (use E2E tests in `tests/e2e/`)
- ❌ Unit testing (use Jest tests in `tests/unit/`)
- ❌ Integration testing (use tests in `tests/integration/`)
- ❌ Production use (these are development tools only)

---

## 📦 Dependencies

These scripts require the `youtube-transcript` package:

```bash
npm install youtube-transcript
```

**Note**: This dependency should already be installed if you ran `npm install` for the project.

---

## 🔧 Configuration

### No configuration required

These scripts are self-contained and don't require:
- OAuth credentials
- Database setup
- Environment variables
- API keys

They work directly with the `youtube-transcript` library which doesn't require authentication.

---

## 💡 Tips

### Finding Test Videos

To find videos with captions:
1. Run `test-different-videos.js` to scan popular videos
2. Use YouTube search with "CC" filter for captioned videos
3. Test educational or official music videos (usually have captions)
4. Avoid user-uploaded content (less likely to have captions)

### Testing Different Languages

Modify `test-transcript.js` to test other languages:
```javascript
// Add more language tests
const transcript = await YoutubeTranscript.fetchTranscript(videoId, {
  lang: 'ko'  // Korean
});
```

Supported languages depend on video's available captions.

### Debugging Issues

If scripts fail:
1. Check internet connection
2. Verify video ID is valid
3. Check if video has captions (YouTube UI)
4. Try different video IDs
5. Review error messages from youtube-transcript library

---

## 🚀 Quick Start

```bash
# 1. Navigate to manual test directory
cd tests/manual

# 2. Run basic transcript test
node test-transcript.js

# 3. Find videos with captions
node test-different-videos.js

# 4. Debug caption issues
node test-transcript-debug.js
```

---

## 📝 Adding New Manual Tests

When creating new manual test scripts:

1. **Place in this directory**: `tests/manual/`
2. **Use descriptive names**: `test-[feature]-[purpose].js`
3. **Add to this README**: Document purpose and usage
4. **Keep self-contained**: Minimal dependencies, clear output
5. **Make runnable from anywhere**: Use relative paths or node resolution

Example:
```bash
# Create new manual test
touch tests/manual/test-caption-quality.js

# Make it executable (if shell script)
chmod +x tests/manual/test-caption-quality.sh

# Document in this README
```

---

## 🔗 Related Documentation

- **E2E Tests**: See `tests/e2e/` for automated end-to-end testing
- **Unit Tests**: See `tests/unit/` for Jest-based unit tests
- **Phase 2 Implementation**: See `docs/phases/phase2/PHASE2_IMPLEMENTATION.md`
- **Main Testing Guide**: See `tests/README.md`

---

## ⚠️ Important Notes

### Development Use Only
These scripts are for **development and debugging purposes only**. They are:
- Not part of automated test suite
- Not run in CI/CD pipeline
- Not covered by test coverage metrics
- Intended for developer convenience

### No Automated Execution
Do not use these scripts for:
- Automated testing workflows
- Production data processing
- Scheduled jobs or cron tasks
- CI/CD pipelines

For automated testing, use the E2E scripts in `tests/e2e/` instead.

---

**Last Updated**: 2025-12-16
**Phase**: Phase 2 (Transcript extraction)
**Purpose**: Development and debugging tools
