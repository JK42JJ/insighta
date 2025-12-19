---
sidebar_position: 1
---

# TubeArchive

**TubeArchive** is a powerful YouTube playlist synchronization and learning platform that helps you archive, organize, and learn from your favorite YouTube content.

## What is TubeArchive?

TubeArchive is designed for knowledge workers, students, and lifelong learners who use YouTube as a learning resource. It provides:

- **Playlist Synchronization**: Keep your local database in sync with YouTube playlists
- **Video Summaries**: AI-powered summaries of video content using captions
- **Personal Notes**: Timestamp-based note-taking for videos
- **Learning Analytics**: Track your learning progress and watch history
- **Offline Access**: Access video metadata and notes without internet

## Key Features

### Playlist Management
Import and sync YouTube playlists automatically. TubeArchive detects additions, deletions, and reordering of videos to keep your local copy up-to-date.

### Video Summaries
Generate AI-powered summaries from video captions at different detail levels (brief, detailed, comprehensive) in multiple languages.

### Note-Taking
Create timestamped notes while watching videos. Export notes in Markdown, JSON, or CSV format.

### Learning Analytics
- Track watch progress and completion rates
- View learning streaks and statistics
- Analyze time spent on different playlists

### API & CLI
Full REST API with OpenAPI documentation, plus a CLI for command-line workflows.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   TubeArchive                        │
├─────────────────┬─────────────────┬─────────────────┤
│    REST API     │      CLI        │   Scheduler     │
│   (Fastify)     │  (Commander)    │  (node-cron)    │
├─────────────────┴─────────────────┴─────────────────┤
│                   Core Modules                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │ Playlist │ │  Video   │ │   Sync   │ │Analytics│ │
│  │ Manager  │ │ Manager  │ │  Engine  │ │ Tracker │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────┘ │
├─────────────────────────────────────────────────────┤
│                 Data Layer (Prisma)                  │
├─────────────────────────────────────────────────────┤
│            SQLite / PostgreSQL Database              │
└─────────────────────────────────────────────────────┘
```

## Quick Links

- [Installation](/docs/getting-started/installation) - Set up TubeArchive locally
- [Quick Start](/docs/getting-started/quickstart) - Get started in 5 minutes
- [API Reference](/docs/api-reference/tubearchive-api) - Explore the REST API
- [GitHub](https://github.com/tubearchive/sync-youtube-playlists) - Source code

## Requirements

- Node.js 18.0 or higher
- npm 9.0 or higher
- YouTube API credentials (for sync features)

## License

MIT License - see [LICENSE](https://github.com/tubearchive/sync-youtube-playlists/blob/main/LICENSE) for details.
