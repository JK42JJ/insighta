# YouTube OAuth 2.0 Setup Guide

Quick start guide for setting up OAuth 2.0 authentication to access YouTube playlists.

---

## Prerequisites

- Google account
- Node.js 18+ installed
- Project dependencies installed (`npm install`)

---

## Step 1: Create Google Cloud Project

### 1.1 Create Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **"Select a project"** → **"New Project"**
3. Enter project name (e.g., "YouTube Playlist Sync")
4. Click **"Create"**

### 1.2 Enable YouTube Data API v3
1. In your project, go to **"APIs & Services"** → **"Library"**
2. Search for "YouTube Data API v3"
3. Click on it and press **"Enable"**

---

## Step 2: Create OAuth 2.0 Credentials

### 2.1 Create OAuth Client ID
1. Go to [Credentials Page](https://console.cloud.google.com/apis/credentials)
2. Click **"Create Credentials"** → **"OAuth client ID"**
3. If prompted, configure OAuth consent screen:
   - User Type: **External** (for personal use)
   - App name: "YouTube Playlist Sync"
   - User support email: Your email
   - Developer contact: Your email
   - Click **"Save and Continue"** through all steps
   - Add yourself as a test user (Scopes → Add or Remove Scopes → Search "YouTube" → Select "youtube.readonly")

### 2.2 Configure OAuth Client
1. Application type: **Desktop app**
2. Name: "YouTube Sync CLI" (or any name)
3. Click **"Create"**
4. Copy **Client ID** and **Client Secret** (you'll need these!)

---

## Step 3: Configure Environment Variables

### 3.1 Create .env File
```bash
# Copy the example file
cp .env.example .env
```

### 3.2 Edit .env File
Open `.env` and set the following:

```env
# YouTube OAuth 2.0 Configuration
YOUTUBE_CLIENT_ID=123456789-abc123.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=GOCSPX-your_secret_here
YOUTUBE_REDIRECT_URI=http://localhost:3000/oauth2callback

# Gemini API (for video summarization - optional for now)
GEMINI_API_KEY=your_gemini_api_key_here
```

**⚠️ Important**: Replace with YOUR actual credentials from Step 2.

---

## Step 4: Authenticate

### 4.1 Start OAuth Flow
```bash
npm run cli -- auth
```

**Output**:
```
🔐 YouTube API OAuth 2.0 Authentication

📋 Follow these steps to authenticate:

1. Visit the following URL in your browser:
   https://accounts.google.com/o/oauth2/v2/auth?...

2. Authorize the application
3. Copy the authorization code from the redirect URL
4. Run: yt-sync auth-callback <code>
```

### 4.2 Authorize in Browser
1. Click the generated URL (or copy-paste into browser)
2. Sign in with your Google account
3. Grant permissions to access YouTube data
4. You'll be redirected to a URL like:
   ```
   http://localhost:3000/oauth2callback?code=4/0AY0e-g7...
   ```
5. **Copy the code** (the part after `code=`)

### 4.3 Complete Authentication
```bash
npm run cli -- auth-callback "4/0AY0e-g7..."
```

**Note**: Replace with YOUR actual authorization code.

**Output**:
```
✅ Authentication successful!

📝 Save these tokens securely:

YOUTUBE_ACCESS_TOKEN=
ya29.a0AfH6SMBx...

YOUTUBE_REFRESH_TOKEN=
1//0gQE8fZ...
```

### 4.4 Save Tokens
1. Copy the tokens from the output
2. Open `.env` file
3. Paste the tokens:
   ```env
   YOUTUBE_ACCESS_TOKEN=ya29.a0AfH6SMBx...
   YOUTUBE_REFRESH_TOKEN=1//0gQE8fZ...
   ```
4. Save the file

---

## Step 5: Verify Authentication

```bash
npm run cli -- auth-status
```

**Expected Output**:
```
═══════════════════════════════════════════
     🔐 AUTHENTICATION STATUS 🔐
═══════════════════════════════════════════

OAuth 2.0 Configuration:
   Client ID: ✅ Configured
   Client Secret: ✅ Configured
   Redirect URI: http://localhost:3000/oauth2callback

✅ OAuth 2.0 is configured
💡 Run "yt-sync auth" to authenticate

═══════════════════════════════════════════
```

All items should show ✅ Configured.

---

## Step 6: Test with Your Playlists

### Import a Playlist
```bash
npm run cli -- import "https://www.youtube.com/playlist?list=PLxxxxxx"
```

**Or** use playlist ID directly:
```bash
npm run cli -- import PLxxxxxx
```

### Sync Playlist
```bash
npm run cli -- sync PLxxxxxx
```

### List All Playlists
```bash
npm run cli -- list
```

---

## Troubleshooting

### "OAuth client not initialized"
❌ **Problem**: Missing credentials in .env
✅ **Solution**:
1. Check `.env` file exists
2. Verify `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` are set
3. Restart the CLI

### "Invalid authorization code"
❌ **Problem**: Code expired or already used
✅ **Solution**:
1. Run `npm run cli -- auth` again
2. Get a new authorization code (codes expire in 10 minutes)
3. Use the code immediately

### "Redirect URI mismatch"
❌ **Problem**: Redirect URI doesn't match Google Cloud Console
✅ **Solution**:
1. Check `.env` file: `YOUTUBE_REDIRECT_URI=http://localhost:3000/oauth2callback`
2. Go to [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials)
3. Edit your OAuth client
4. Under "Authorized redirect URIs", add:
   - `http://localhost:3000/oauth2callback`
5. Save changes and retry

### "Access token expired"
❌ **Problem**: Token expired (tokens last 1 hour)
✅ **Solution**:
- Automatic token refresh is built-in (uses refresh_token)
- If refresh fails, re-run `npm run cli -- auth`

---

## Security Best Practices

✅ **Never commit .env file** - Already in .gitignore
✅ **Keep credentials private** - Don't share Client Secret or tokens
✅ **Use refresh tokens** - Avoid re-authenticating frequently
✅ **Revoke access when done** - Go to [Google Account Permissions](https://myaccount.google.com/permissions)

---

## Next Steps

Once authenticated, you can:

1. **Import Playlists**: Sync your YouTube playlists locally
2. **Download Captions**: Extract video subtitles
3. **Generate Summaries**: AI-powered video summaries (requires Gemini API key)
4. **Track Progress**: Monitor learning analytics and watch history
5. **Schedule Syncs**: Auto-sync playlists at intervals

---

## Quick Command Reference

```bash
# Authentication
npm run cli -- auth-status          # Check authentication
npm run cli -- auth                 # Start OAuth flow
npm run cli -- auth-callback <code> # Complete OAuth

# Playlist Operations
npm run cli -- import <url>         # Import playlist
npm run cli -- sync <id>            # Sync playlist
npm run cli -- sync --all           # Sync all playlists
npm run cli -- list                 # List playlists

# Video Operations
npm run cli -- caption-download <video-id>  # Download captions
npm run cli -- summarize <video-id>         # Generate AI summary

# Quota & Cache
npm run cli -- quota                # Check quota usage
npm run cli -- cache-stats          # Cache statistics
```

---

## Support

For issues or questions:
1. Check [troubleshooting section](#troubleshooting)
2. Review [PHASE3.1_COMPLETE.md](../PHASE3.1_COMPLETE.md) for detailed documentation
3. Check logs in `./logs` directory

---

**Last Updated**: December 16, 2025
**Version**: Phase 3.1
