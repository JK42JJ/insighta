# YouTube API OAuth 2.0 Setup Guide

**Complete guide for setting up YouTube Data API v3 with OAuth 2.0 authentication**

---

## Overview

This guide will walk you through setting up YouTube API access for the YouTube Playlist Sync application. You'll need:

- Google account
- 15-20 minutes
- Access to Google Cloud Console

**What you'll get**:
- OAuth 2.0 Client ID and Secret
- Access to YouTube Data API v3
- Ability to import and sync YouTube playlists

---

## Step 1: Create Google Cloud Project

### 1.1 Go to Google Cloud Console

Visit: https://console.cloud.google.com/

### 1.2 Create New Project

1. Click the project dropdown at the top of the page
2. Click **"New Project"**
3. Enter project details:
   - **Project name**: `youtube-playlist-sync` (or your preferred name)
   - **Organization**: Leave as "No organization" (unless you have one)
   - **Location**: Leave as "No organization"
4. Click **"Create"**
5. Wait for the project to be created (usually 10-20 seconds)
6. **Select your new project** from the project dropdown

---

## Step 2: Enable YouTube Data API v3

### 2.1 Navigate to APIs & Services

1. In the left sidebar, click **"APIs & Services"** → **"Library"**
2. Or visit directly: https://console.cloud.google.com/apis/library

### 2.2 Find and Enable YouTube Data API v3

1. In the search bar, type: `YouTube Data API v3`
2. Click on **"YouTube Data API v3"** in the results
3. Click the **"Enable"** button
4. Wait for the API to be enabled (usually instant)

### 2.3 Verify API is Enabled

1. Go to **"APIs & Services"** → **"Enabled APIs & services"**
2. You should see **"YouTube Data API v3"** in the list

---

## Step 3: Configure OAuth Consent Screen

### 3.1 Navigate to OAuth Consent Screen

1. In the left sidebar, click **"APIs & Services"** → **"OAuth consent screen"**
2. Or visit: https://console.cloud.google.com/apis/credentials/consent

### 3.2 Select User Type

1. Choose **"External"** (recommended for personal use)
   - External allows any Google account to authenticate
   - Internal only works for Google Workspace organizations
2. Click **"Create"**

### 3.3 Fill OAuth Consent Screen Details

**App Information**:
- **App name**: `YouTube Playlist Sync` (or your preferred name)
- **User support email**: Your email address (select from dropdown)
- **App logo**: (Optional) Upload a logo if you have one

**App Domain** (Optional):
- Leave blank for personal use

**Authorized Domains** (Optional):
- Leave blank for personal use

**Developer Contact Information**:
- **Email addresses**: Your email address

Click **"Save and Continue"**

### 3.4 Configure Scopes

1. Click **"Add or Remove Scopes"**
2. In the filter box, search for: `youtube`
3. Select the following scopes:
   - ✅ `https://www.googleapis.com/auth/youtube.readonly`
     - View your YouTube account (read-only access)
   - ✅ `https://www.googleapis.com/auth/youtube.force-ssl`
     - Manage your YouTube account (required for full playlist access)
4. Click **"Update"**
5. Verify both scopes are listed under "Your sensitive scopes"
6. Click **"Save and Continue"**

### 3.5 Add Test Users (External App Only)

**Important**: For external apps in testing mode, you must add test users.

1. Click **"Add Users"**
2. Enter your Google account email address
3. Click **"Add"**
4. Click **"Save and Continue"**

### 3.6 Review and Confirm

1. Review all settings
2. Click **"Back to Dashboard"**

---

## Step 4: Create OAuth 2.0 Credentials

### 4.1 Navigate to Credentials

1. In the left sidebar, click **"APIs & Services"** → **"Credentials"**
2. Or visit: https://console.cloud.google.com/apis/credentials

### 4.2 Create OAuth Client ID

1. Click **"+ Create Credentials"** at the top
2. Select **"OAuth client ID"**

### 4.3 Configure OAuth Client

1. **Application type**: Select **"Desktop app"**
   - Desktop app is recommended for CLI applications
   - Alternatively, you can use "Web application" if you plan to add a web UI later

2. **Name**: `YouTube Playlist Sync CLI` (or your preferred name)

3. Click **"Create"**

### 4.4 Download Credentials

1. A modal will appear showing your **Client ID** and **Client Secret**
2. **Option 1**: Click **"Download JSON"** to download credentials file
3. **Option 2**: Copy the values manually:
   - **Client ID**: Copy and save (format: `xxxxx.apps.googleusercontent.com`)
   - **Client Secret**: Copy and save (format: `GOCSPX-xxxxx`)

4. Click **"OK"** to close the modal

---

## Step 5: Configure Application

### 5.1 Create .env File

1. In your project root, copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

### 5.2 Add YouTube API Credentials

Edit `.env` file and add your OAuth credentials:

```env
# YouTube API OAuth 2.0 Configuration
YOUTUBE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=GOCSPX-your_client_secret_here
YOUTUBE_REDIRECT_URI=http://localhost:3000/oauth2callback
```

**Replace**:
- `your_client_id_here.apps.googleusercontent.com` → Your actual Client ID
- `GOCSPX-your_client_secret_here` → Your actual Client Secret

**Note**: Keep `YOUTUBE_REDIRECT_URI` as is. It doesn't need to be a real server for desktop apps.

### 5.3 Generate Encryption Secret

Generate a secure encryption secret for token storage:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output and add to `.env`:

```env
# Encryption
ENCRYPTION_SECRET=<paste the generated 64-character hex string here>
```

### 5.4 Verify Configuration

Your `.env` should now have:

```env
# Database
DATABASE_URL="file:./data/youtube-sync.db"

# YouTube API OAuth 2.0
YOUTUBE_CLIENT_ID=123456789-abcdefghijk.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=GOCSPX-AbCdEfGhIjKlMnOpQrStUvWx
YOUTUBE_REDIRECT_URI=http://localhost:3000/oauth2callback

# Encryption
ENCRYPTION_SECRET=a1b2c3d4e5f6...64_character_hex_string

# Other configuration...
```

---

## Step 6: Authenticate with YouTube API

### 6.1 Check Authentication Status

```bash
npm run cli -- auth-status
```

Expected output:
```
═══════════════════════════════════════════
     🔐 AUTHENTICATION STATUS 🔐
═══════════════════════════════════════════

OAuth 2.0 Configuration:
   Client ID: ✅ Configured
   Client Secret: ✅ Configured
   Redirect URI: http://localhost:3000/oauth2callback

API Key Configuration:
   API Key: ❌ Not set

✅ OAuth 2.0 is configured
💡 Run "yt-sync auth" to authenticate
```

### 6.2 Start OAuth Flow

```bash
npm run cli -- auth
```

Output:
```
🔐 YouTube API OAuth 2.0 Authentication

📋 Follow these steps to authenticate:

1. Visit the following URL in your browser:

   https://accounts.google.com/o/oauth2/auth?access_type=offline&scope=...

2. Authorize the application
3. Copy the authorization code from the redirect URL
4. Run: yt-sync auth-callback <code>
```

### 6.3 Authorize in Browser

1. **Copy the URL** from the output
2. **Paste it in your browser** and press Enter
3. **Sign in** with your Google account (if not already signed in)
4. **Review permissions**:
   - View your YouTube account
   - Manage your YouTube account
5. Click **"Continue"** or **"Allow"**

### 6.4 Get Authorization Code

After authorizing, you'll be redirected to a URL like:

```
http://localhost:3000/oauth2callback?code=4/0AeanS0a...very_long_code...&scope=https://...
```

**The page will show an error** (This is normal! We're not running a web server)

**Extract the code**:
1. Look at the URL in your browser's address bar
2. Copy everything after `code=` and before `&scope`
3. The code looks like: `4/0AeanS0a...` (very long alphanumeric string)

### 6.5 Complete Authentication

```bash
npm run cli -- auth-callback "4/0AeanS0a...your_code_here..."
```

**Important**: Wrap the code in quotes!

Expected output:
```
🔄 Exchanging authorization code for tokens...

✅ Authentication successful!

📝 Save these tokens securely:

YOUTUBE_ACCESS_TOKEN=
ya29.a0AfB_byC...

YOUTUBE_REFRESH_TOKEN=
1//0gHZfK8rT...

⚠️  Add these to your .env file to persist authentication

💡 You can now use commands like:
   - yt-sync import <playlist-url>
   - yt-sync sync --all
```

### 6.6 Save Tokens to .env (Optional)

**Option 1: Automatic (Recommended)**

The tokens are stored securely in the database. You don't need to manually add them to `.env`.

**Option 2: Manual Persistence**

If you want to persist tokens in `.env` (for backup or easier token management):

1. Copy the `YOUTUBE_ACCESS_TOKEN` and `YOUTUBE_REFRESH_TOKEN` from the output
2. Add them to your `.env` file:

```env
# OAuth Tokens (Generated after OAuth flow)
YOUTUBE_ACCESS_TOKEN=ya29.a0AfB_byC...
YOUTUBE_REFRESH_TOKEN=1//0gHZfK8rT...
```

**Security Note**: The `.env` file should be in `.gitignore` to prevent token exposure.

---

## Step 7: Test YouTube API Access

### 7.1 Import a Playlist

Test the setup by importing a public YouTube playlist:

```bash
npm run cli -- import "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
```

Expected output:
```
✅ Playlist imported successfully
   ID: cm5a1b2c3d4e5f6
   YouTube ID: PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf
   Title: Web Development Tutorial
   Channel: Example Channel
   Items: 42

Run "yt-sync sync" to synchronize the playlist items.
```

### 7.2 Sync the Playlist

```bash
npm run cli -- sync --all
```

Expected output:
```
🔄 Syncing all playlists...

📊 Sync Results:

   Playlist: cm5a1b2c3d4e5f6
   Status: success
   Added: 42
   Removed: 0
   Reordered: 0
   Duration: 2847ms
   Quota Used: 5
```

### 7.3 List Playlists

```bash
npm run cli -- list
```

Expected output:
```
📚 Playlists (1/1):

   Web Development Tutorial
   ID: PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf
   Channel: Example Channel
   Items: 42
   Status: synced
   Last Sync: 2025-12-17T04:30:15.000Z
```

---

## Troubleshooting

### Issue 1: "OAuth credentials not configured"

**Problem**: `.env` file is missing or has incorrect credentials.

**Solution**:
1. Verify `.env` file exists in project root
2. Check `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` are set correctly
3. Restart the CLI application after changing `.env`

### Issue 2: "Invalid authorization code"

**Problem**: The authorization code is invalid, expired, or incorrectly copied.

**Solutions**:
- **Expired code**: Authorization codes expire in 10 minutes. Generate a new one by running `npm run cli -- auth` again
- **Incorrect code**: Make sure you copied the entire code from the redirect URL
- **Quotes missing**: Wrap the code in quotes: `auth-callback "code_here"`

### Issue 3: "Redirect URI mismatch"

**Problem**: The redirect URI in Google Cloud Console doesn't match `.env`.

**Solution**:
1. Go to Google Cloud Console → Credentials
2. Click on your OAuth Client ID
3. Under "Authorized redirect URIs", add: `http://localhost:3000/oauth2callback`
4. Click "Save"
5. Wait 5 minutes for changes to propagate
6. Try authentication again

### Issue 4: "Access blocked: This app's request is invalid"

**Problem**: OAuth consent screen is not configured correctly.

**Solution**:
1. Go to Google Cloud Console → OAuth consent screen
2. Verify scopes include:
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `https://www.googleapis.com/auth/youtube.force-ssl`
3. For external apps, add your email to "Test users"
4. Save changes and try again

### Issue 5: "Quota exceeded"

**Problem**: YouTube API daily quota limit reached (10,000 units/day by default).

**Solution**:
- Wait until midnight PST when quota resets
- Check quota usage: `npm run cli -- quota`
- Optimize sync frequency to reduce quota usage
- Request quota increase from Google Cloud Console (for production use)

### Issue 6: "Token expired"

**Problem**: Access token has expired (tokens expire after 1 hour).

**Solution**:
The application automatically refreshes tokens using the refresh token. If automatic refresh fails:

1. Check that `YOUTUBE_REFRESH_TOKEN` is set in `.env` (if using manual persistence)
2. Re-authenticate: `npm run cli -- auth` and follow the flow again

---

## API Quota Management

### Understanding Quota Costs

YouTube Data API v3 has a default quota of **10,000 units/day**. Different operations cost different amounts:

| Operation | Cost (units) | Example |
|-----------|-------------|---------|
| Playlist details | 1 | Get playlist metadata |
| Playlist items (50) | 1 | List videos in playlist |
| Video details (50) | 1 | Get video metadata batch |
| Search | 100 | Search for videos/channels |

### Typical Usage

**Importing a 100-video playlist**:
- Playlist details: 1 unit
- Playlist items (2 requests × 50 items): 2 units
- Video details (2 requests × 50 videos): 2 units
- **Total**: ~5 units

**Syncing 10 playlists (daily)**:
- 10 playlists × 5 units = 50 units/day
- Well within the 10,000 daily limit

### Check Quota Usage

```bash
npm run cli -- quota --days 7
```

Output:
```
📊 Today's Quota Usage:

   Used: 247 / 10000
   Remaining: 9753
   Percent: 2.47%

📈 Usage History (7 days):

   2025-12-17: 247/10000 (2.5%)
   2025-12-16: 89/10000 (0.9%)
   2025-12-15: 156/10000 (1.6%)
   ...
```

---

## Security Best Practices

### 1. Protect Your Credentials

**Never commit to Git**:
- ✅ `.env` file is already in `.gitignore`
- ✅ Verify with: `git status` (should not show `.env`)

**Secure storage**:
- Keep `.env` file with `600` permissions (owner read/write only)
- Don't share Client Secret with others
- Regenerate credentials if exposed

### 2. Token Management

**Tokens are sensitive**:
- Access tokens grant full YouTube account access
- Refresh tokens are long-lived (can be revoked)

**Secure token storage**:
- Application stores tokens encrypted in database
- Encryption key is the `ENCRYPTION_SECRET` in `.env`
- Never log or expose tokens

### 3. Revoke Access (If Needed)

If you need to revoke application access:

1. Go to: https://myaccount.google.com/permissions
2. Find "YouTube Playlist Sync" application
3. Click "Remove Access"
4. Delete tokens from `.env` file
5. Re-authenticate if you want to use the app again

---

## Next Steps

Now that YouTube API is configured, you can:

1. **Import playlists**: `npm run cli -- import <playlist-url>`
2. **Sync playlists**: `npm run cli -- sync --all`
3. **Schedule automatic syncs**: `npm run cli -- schedule-create <playlist-id> 1h`
4. **View quota usage**: `npm run cli -- quota`

For more CLI commands, see: [CLI Documentation](./implementation-reports/03-cli-integration.md)

---

## Reference Links

- **Google Cloud Console**: https://console.cloud.google.com/
- **YouTube Data API Documentation**: https://developers.google.com/youtube/v3
- **OAuth 2.0 Documentation**: https://developers.google.com/identity/protocols/oauth2
- **API Quota Documentation**: https://developers.google.com/youtube/v3/getting-started#quota

---

**Document Version**: 1.0
**Last Updated**: 2025-12-17
**Maintained by**: Claude Code
**Project**: YouTube Playlist Sync
