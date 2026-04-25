-- Add index on video_summaries.url for Edge Function local-cards enrichment query
-- The local-cards list action does .in('url', youtubeUrls) which was Seq Scanning
CREATE INDEX IF NOT EXISTS idx_video_summaries_url ON public.video_summaries(url);
