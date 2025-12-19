# Auto-Sync Scheduler - Usage Examples

Practical examples for using the Auto-Sync Scheduler.

## Quick Start

### 1. Import a Playlist

First, import a YouTube playlist:

```bash
npm run cli -- import "https://www.youtube.com/playlist?list=PLxxxxxxxxxxx"
```

This will output the playlist ID, for example: `clfy7x8x70000abc123def456`

### 2. Add to Schedule

Add the playlist to auto-sync schedule:

```bash
# Sync every 6 hours
npm run cli -- scheduler add clfy7x8x70000abc123def456 "0 */6 * * *"
```

### 3. Start the Scheduler

Start the scheduler daemon:

```bash
npm run cli -- scheduler start
```

The scheduler will now automatically sync the playlist every 6 hours.

## Common Use Cases

### Daily News Playlist

Sync a news playlist every day at 9:00 AM:

```bash
# Add playlist
npm run cli -- import "https://www.youtube.com/playlist?list=PLNewsPlaylist"

# Get playlist ID from output (e.g., clfy7x8x70001abc123def457)

# Schedule daily at 9:00 AM
npm run cli -- scheduler add clfy7x8x70001abc123def457 "0 9 * * *"
```

### Active Learning Playlist

Sync an actively-updated course playlist every 2 hours:

```bash
# Import playlist
npm run cli -- import "https://www.youtube.com/playlist?list=PLCoursePlaylist"

# Schedule every 2 hours
npm run cli -- scheduler add clfy7x8x70002abc123def458 "0 */2 * * *"
```

### Weekly Podcast Playlist

Sync a weekly podcast playlist every Sunday at midnight:

```bash
# Import playlist
npm run cli -- import "https://www.youtube.com/playlist?list=PLPodcastPlaylist"

# Schedule weekly on Sunday at 00:00
npm run cli -- scheduler add clfy7x8x70003abc123def459 "0 0 * * 0"
```

### Multiple Playlists with Different Intervals

```bash
# Import playlists
npm run cli -- import "https://www.youtube.com/playlist?list=PLTechNews"
npm run cli -- import "https://www.youtube.com/playlist?list=PLTutorials"
npm run cli -- import "https://www.youtube.com/playlist?list=PLMusic"

# Schedule with different intervals
npm run cli -- scheduler add <tech-news-id> "0 */3 * * *"   # Every 3 hours
npm run cli -- scheduler add <tutorials-id> "0 0 * * *"     # Daily
npm run cli -- scheduler add <music-id> "0 0 * * 1"         # Weekly on Monday
```

## Cron Expression Quick Reference

### Every N Minutes
```bash
*/15 * * * *  # Every 15 minutes
*/30 * * * *  # Every 30 minutes
```

### Every N Hours
```bash
0 */1 * * *   # Every 1 hour
0 */2 * * *   # Every 2 hours
0 */6 * * *   # Every 6 hours
0 */12 * * *  # Every 12 hours
```

### Daily at Specific Time
```bash
0 0 * * *     # Daily at midnight (00:00)
0 6 * * *     # Daily at 6:00 AM
0 12 * * *    # Daily at noon
0 18 * * *    # Daily at 6:00 PM
30 8 * * *    # Daily at 8:30 AM
```

### Weekly
```bash
0 0 * * 0     # Weekly on Sunday
0 0 * * 1     # Weekly on Monday
0 9 * * 1     # Weekly on Monday at 9:00 AM
0 0 * * 5     # Weekly on Friday
```

### Monthly
```bash
0 0 1 * *     # Monthly on the 1st
0 0 15 * *    # Monthly on the 15th
```

## Management Operations

### View All Schedules

```bash
npm run cli -- scheduler list
```

Output:
```
📋 Auto-sync schedules (3):

✅ Tech News Daily
   ID: clfy7x8x70001abc123def457
   Interval: 6 hours
   Last run: 2024-01-15T14:30:00.000Z
   Next run: 2024-01-15T20:30:00.000Z
   Status: Enabled
   Retries: 0/3

✅ Course Tutorials
   ID: clfy7x8x70002abc123def458
   Interval: 1 day
   Last run: 2024-01-15T00:00:00.000Z
   Next run: 2024-01-16T00:00:00.000Z
   Status: Enabled
   Retries: 0/3
```

### Check Scheduler Status

```bash
npm run cli -- scheduler status
```

Output:
```
═══════════════════════════════════════════
      ⏰ SCHEDULER STATUS ⏰
═══════════════════════════════════════════

Status: 🟢 Running
Active schedules: 3
Running jobs: 1
Uptime: 2h 15m 30s

🔄 Currently syncing:
   • clfy7x8x70001abc123def457

📋 Configured schedules (3):

✅ clfy7x8x70001abc123def457
   Interval: 6 hours
   Last run: 2024-01-15T14:30:00.000Z
   Next run: 2024-01-15T20:30:00.000Z
   Retries: 0/3
```

### Temporarily Disable a Schedule

```bash
# Stop the scheduler
npm run cli -- scheduler stop

# Remove the schedule
npm run cli -- scheduler remove clfy7x8x70001abc123def457

# Or use the schedule commands
npm run cli -- schedule-disable clfy7x8x70001abc123def457

# Start again
npm run cli -- scheduler start
```

### Update Schedule Interval

```bash
# Stop scheduler
npm run cli -- scheduler stop

# Remove old schedule
npm run cli -- scheduler remove clfy7x8x70001abc123def457

# Add with new interval
npm run cli -- scheduler add clfy7x8x70001abc123def457 "0 */12 * * *"

# Start scheduler
npm run cli -- scheduler start
```

## Production Deployment

### Using PM2 (Recommended)

```bash
# Install PM2 globally
npm install -g pm2

# Create ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'yt-sync-scheduler',
    script: 'dist/cli/index.js',
    args: 'scheduler start',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      DATABASE_URL: 'file:./prisma/prod.db'
    },
    error_file: './logs/scheduler-error.log',
    out_file: './logs/scheduler-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
EOF

# Start with PM2
pm2 start ecosystem.config.js

# View logs
pm2 logs yt-sync-scheduler

# Stop
pm2 stop yt-sync-scheduler

# Restart
pm2 restart yt-sync-scheduler

# Auto-start on system boot
pm2 startup
pm2 save
```

### Using systemd (Linux)

```bash
# Create service file
sudo cat > /etc/systemd/system/yt-sync-scheduler.service << EOF
[Unit]
Description=YouTube Playlist Sync Scheduler
After=network.target

[Service]
Type=simple
User=yourusername
WorkingDirectory=/path/to/sync-youtube-playlists
Environment="NODE_ENV=production"
Environment="DATABASE_URL=file:./prisma/prod.db"
ExecStart=/usr/bin/node dist/cli/index.js scheduler start
Restart=always
RestartSec=10
StandardOutput=append:/var/log/yt-sync-scheduler.log
StandardError=append:/var/log/yt-sync-scheduler-error.log

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
sudo systemctl daemon-reload

# Start service
sudo systemctl start yt-sync-scheduler

# Enable auto-start
sudo systemctl enable yt-sync-scheduler

# Check status
sudo systemctl status yt-sync-scheduler

# View logs
sudo journalctl -u yt-sync-scheduler -f
```

### Using Docker

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

CMD ["node", "dist/cli/index.js", "scheduler", "start"]
```

```bash
# Build
docker build -t yt-sync-scheduler .

# Run
docker run -d \
  --name yt-sync-scheduler \
  -v $(pwd)/prisma:/app/prisma \
  -v $(pwd)/logs:/app/logs \
  -e DATABASE_URL=file:./prisma/prod.db \
  -e YOUTUBE_API_KEY=your-key \
  yt-sync-scheduler

# View logs
docker logs -f yt-sync-scheduler

# Stop
docker stop yt-sync-scheduler
```

## Monitoring and Maintenance

### Check Quota Usage

```bash
# View today's quota
npm run cli -- quota

# View 7-day history
npm run cli -- quota --days 7
```

### View Sync History

```bash
# View playlist info (includes sync stats)
npm run cli -- info <playlist-id>
```

### Manual Sync

If you need to sync immediately without waiting for the schedule:

```bash
npm run cli -- sync <playlist-id>
```

### Backup Database

```bash
# SQLite backup
cp prisma/dev.db prisma/backup-$(date +%Y%m%d).db

# PostgreSQL backup
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
```

## Troubleshooting Examples

### Problem: Scheduler Won't Start

```bash
# Check if database is accessible
npm run cli -- schedule-list

# Check environment variables
npm run cli -- auth-status

# Check for existing process
ps aux | grep "scheduler start"
```

### Problem: Syncs Failing

```bash
# Check scheduler status
npm run cli -- scheduler status

# Check quota
npm run cli -- quota

# View last sync error
npm run cli -- info <playlist-id>

# Try manual sync
npm run cli -- sync <playlist-id>
```

### Problem: High API Usage

```bash
# Check quota usage
npm run cli -- quota --days 7

# List all schedules
npm run cli -- scheduler list

# Reduce sync frequency for less critical playlists
npm run cli -- scheduler remove <playlist-id>
npm run cli -- scheduler add <playlist-id> "0 0 * * *"  # Change to daily
```

## Best Practices

### 1. Stagger Sync Times

Don't schedule all playlists at the same time:

```bash
# Bad: All at midnight
npm run cli -- scheduler add <id1> "0 0 * * *"
npm run cli -- scheduler add <id2> "0 0 * * *"
npm run cli -- scheduler add <id3> "0 0 * * *"

# Good: Spread throughout the day
npm run cli -- scheduler add <id1> "0 0 * * *"   # Midnight
npm run cli -- scheduler add <id2> "0 8 * * *"   # 8 AM
npm run cli -- scheduler add <id3> "0 16 * * *"  # 4 PM
```

### 2. Monitor Quota Usage

```bash
# Check daily before adding new schedules
npm run cli -- quota

# Add schedules only if quota remaining > 20%
```

### 3. Use Appropriate Intervals

- **Frequently updated** (news, live events): 2-3 hours
- **Regular content** (tutorials, courses): 6-12 hours
- **Occasional updates** (music, archives): Daily or weekly
- **Rarely updated** (completed series): Weekly

### 4. Test Before Production

```bash
# Test cron expression
npm run cli -- scheduler add <id> "*/5 * * * *" --disabled

# Verify it's created
npm run cli -- scheduler list

# Enable and test
npm run cli -- schedule-enable <id>
npm run cli -- scheduler start

# Watch for 15-30 minutes
npm run cli -- scheduler status
```

## Advanced Scenarios

### Peak vs Off-Peak Scheduling

```bash
# Heavy processing during off-peak hours (night)
npm run cli -- scheduler add <large-playlist-id> "0 2 * * *"

# Quick updates during peak hours
npm run cli -- scheduler add <small-playlist-id> "0 */6 * * *"
```

### Gradual Rollout

```bash
# Week 1: Add first playlist
npm run cli -- scheduler add <id1> "0 */6 * * *"

# Week 2: Add second if quota OK
npm run cli -- quota
npm run cli -- scheduler add <id2> "0 */12 * * *"

# Week 3: Add third if still within quota
npm run cli -- quota
npm run cli -- scheduler add <id3> "0 0 * * *"
```

### Emergency Stop

```bash
# Stop scheduler immediately
npm run cli -- scheduler stop

# Or kill process (not recommended)
pkill -f "scheduler start"

# Verify stopped
npm run cli -- scheduler status
```

## Summary

The Auto-Sync Scheduler provides flexible, reliable automated synchronization. Key takeaways:

1. **Start Simple**: Begin with one playlist and a conservative schedule
2. **Monitor Quota**: Keep an eye on daily quota usage
3. **Adjust as Needed**: Fine-tune intervals based on actual update frequency
4. **Use Production Tools**: PM2 or systemd for reliability
5. **Regular Maintenance**: Check status and logs periodically

For more details, see the full documentation in `docs/AUTO_SYNC_SCHEDULER.md`.
