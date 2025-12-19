# Installation

This guide walks you through setting up TubeArchive on your local machine.

## Prerequisites

Before installing TubeArchive, ensure you have:

- **Node.js** 18.0 or higher
- **npm** 9.0 or higher (comes with Node.js)
- **Git** (for cloning the repository)

## Step 1: Clone the Repository

```bash
git clone https://github.com/tubearchive/sync-youtube-playlists.git
cd sync-youtube-playlists
```

## Step 2: Install Dependencies

```bash
npm install
```

## Step 3: Set Up Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Database
DATABASE_URL="file:./prisma/data/dev.db"

# JWT Configuration
JWT_SECRET=your-super-secret-key-change-in-production
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# YouTube API (Optional - needed for sync features)
YOUTUBE_CLIENT_ID=your-client-id
YOUTUBE_CLIENT_SECRET=your-client-secret
YOUTUBE_REDIRECT_URI=http://localhost:3000/oauth2callback

# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
```

## Step 4: Initialize Database

Generate Prisma client and run migrations:

```bash
npx prisma generate
npx prisma migrate dev
```

## Step 5: Verify Installation

Run the test suite to verify everything is working:

```bash
npm test
```

Start the development server:

```bash
npm run api:dev
```

You should see:
```
Server listening at http://0.0.0.0:3000
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run api:dev` | Start API server in development mode |
| `npm run build` | Build TypeScript to JavaScript |
| `npm start` | Run production build |
| `npm test` | Run all tests |
| `npm run test:cov` | Run tests with coverage |
| `npm run cli -- <command>` | Run CLI commands |
| `npx prisma studio` | Open database GUI |

## Project Structure

```
sync-youtube-playlists/
├── src/
│   ├── api/           # REST API (Fastify routes, schemas)
│   ├── cli/           # CLI interface
│   ├── modules/       # Business logic modules
│   │   ├── playlist/  # Playlist management
│   │   ├── video/     # Video management
│   │   ├── sync/      # Sync scheduler
│   │   ├── analytics/ # Learning analytics
│   │   └── database/  # Database module
│   ├── config/        # Configuration
│   └── utils/         # Shared utilities
├── prisma/            # Database schema and migrations
├── tests/             # Test files
├── docs/              # Documentation
└── docs-site/         # Docusaurus documentation site
```

## Optional: YouTube API Setup

To use YouTube synchronization features, you need to set up YouTube Data API credentials:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable YouTube Data API v3
4. Create OAuth 2.0 credentials
5. Add credentials to your `.env` file

For detailed instructions, see [Authentication Guide](/docs/getting-started/authentication).

## Troubleshooting

### Error: `Cannot find module '@prisma/client'`

Run Prisma generate:
```bash
npx prisma generate
```

### Error: Database connection failed

Ensure the database directory exists:
```bash
mkdir -p prisma/data
npx prisma migrate dev
```

### Error: Port 3000 already in use

Change the port in `.env`:
```env
PORT=3001
```

Or kill the process using port 3000:
```bash
lsof -i :3000
kill -9 <PID>
```

## Next Steps

- [Quick Start](/docs/getting-started/quickstart) - Start using TubeArchive
- [Authentication Setup](/docs/getting-started/authentication) - Configure YouTube API
- [API Reference](/docs/api-reference/tubearchive-api) - Explore the API
