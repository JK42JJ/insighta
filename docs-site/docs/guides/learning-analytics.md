# Learning Analytics

TubeArchive provides comprehensive analytics to help you track your learning progress across videos and playlists.

## Dashboard Overview

Get a complete view of your learning statistics:

```bash
curl -X GET http://localhost:3000/api/v1/analytics/dashboard \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Response:
```json
{
  "dashboard": {
    "totalVideos": 150,
    "totalWatchTime": 36000,
    "completedVideos": 45,
    "inProgressVideos": 12,
    "completionRate": 30,
    "learningStreak": {
      "currentStreak": 7,
      "longestStreak": 14,
      "lastActiveDate": "2025-12-19"
    },
    "recentActivity": [
      {
        "videoId": "...",
        "title": "TypeScript Basics",
        "watchedAt": "2025-12-19T10:00:00Z",
        "duration": 300
      }
    ],
    "topPlaylists": [
      {
        "playlistId": "...",
        "title": "Web Development Course",
        "progress": 65,
        "totalVideos": 20
      }
    ]
  }
}
```

## Video Analytics

Get detailed analytics for a specific video:

```bash
curl -X GET http://localhost:3000/api/v1/analytics/videos/VIDEO_ID \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Response:
```json
{
  "analytics": {
    "videoId": "VIDEO_ID",
    "title": "Advanced TypeScript Patterns",
    "totalWatchTime": 1800,
    "completionRate": 85,
    "sessionCount": 3,
    "averageSessionDuration": 600,
    "lastWatched": "2025-12-19T10:00:00Z",
    "watchHistory": [
      {
        "date": "2025-12-19",
        "duration": 600,
        "progress": 85
      }
    ]
  }
}
```

## Playlist Progress

Track your progress through a playlist:

```bash
curl -X GET http://localhost:3000/api/v1/analytics/playlists/PLAYLIST_ID \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Response:
```json
{
  "analytics": {
    "playlistId": "PLAYLIST_ID",
    "title": "Complete React Course",
    "totalVideos": 50,
    "completedVideos": 25,
    "inProgressVideos": 5,
    "unwatchedVideos": 20,
    "completionRate": 50,
    "totalWatchTime": 54000,
    "estimatedTimeRemaining": 48000,
    "videoProgress": [
      {
        "videoId": "...",
        "title": "React Hooks",
        "status": "completed",
        "progress": 100
      },
      {
        "videoId": "...",
        "title": "Redux Toolkit",
        "status": "in_progress",
        "progress": 45
      }
    ]
  }
}
```

## Recording Watch Sessions

Track your viewing activity by recording watch sessions:

```bash
curl -X POST http://localhost:3000/api/v1/analytics/sessions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "videoId": "VIDEO_ID",
    "startPosition": 120,
    "endPosition": 600,
    "startTime": "2025-12-19T10:00:00Z",
    "endTime": "2025-12-19T10:08:00Z"
  }'
```

This automatically updates:
- Video completion status
- Watch time statistics
- Learning streak

## Understanding Metrics

### Completion Rate

A video is considered complete when 90% or more has been watched. The formula:

```
completion_rate = (watched_duration / total_duration) * 100
```

### Learning Streak

Your learning streak tracks consecutive days of activity:

- **Current Streak**: Days in your current streak
- **Longest Streak**: Your all-time best
- **Reset**: Missing a day resets to 0

### Watch Time

Watch time is calculated from recorded sessions:

- **Total Watch Time**: Sum of all session durations
- **Average Session**: Total time / session count
- **Estimated Remaining**: Unwatched video durations

## Analytics Use Cases

### Track Course Progress

Monitor your progress through an online course:

```bash
# Get all playlists with progress
curl -X GET http://localhost:3000/api/v1/playlists \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Get detailed progress for a course
curl -X GET http://localhost:3000/api/v1/analytics/playlists/COURSE_PLAYLIST_ID \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Find Incomplete Videos

Identify videos you started but didn't finish:

```bash
curl -X GET "http://localhost:3000/api/v1/videos?status=in_progress" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Review Learning History

See your recent activity:

```bash
curl -X GET http://localhost:3000/api/v1/analytics/dashboard \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

The `recentActivity` field shows your latest watched videos.

## CLI Analytics Commands

Quick analytics from the command line:

```bash
# View dashboard summary
npm run cli -- dashboard

# Check specific playlist progress
npm run cli -- progress PLAYLIST_ID

# View learning streak
npm run cli -- streak
```

## Exporting Analytics Data

### JSON Export

```bash
curl -X GET "http://localhost:3000/api/v1/analytics/dashboard" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -o analytics.json
```

### Integration with Other Tools

Use the API to integrate analytics with:
- Notion databases
- Spreadsheets
- Personal dashboards
- Learning management systems

## Best Practices

### Maintain Your Streak

1. **Set daily goals**: Even 10 minutes counts
2. **Use reminders**: Schedule learning time
3. **Start small**: Consistency beats intensity

### Effective Progress Tracking

1. **Complete videos**: Don't skip around too much
2. **Take notes**: Reinforces learning
3. **Review analytics weekly**: Identify patterns
4. **Celebrate milestones**: 25%, 50%, 75%, 100%

### Optimize Learning

1. **Focus on one playlist**: Complete before starting another
2. **Prioritize fundamentals**: Watch prerequisite videos first
3. **Spaced repetition**: Revisit completed videos periodically

## Next Steps

- [Video Management](/docs/guides/video-management) - Work with videos and notes
- [Playlist Sync](/docs/guides/playlist-sync) - Manage playlists
- [API Reference](/docs/api-reference/tubearchive-api) - All endpoints
