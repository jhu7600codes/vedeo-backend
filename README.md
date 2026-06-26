# vedeo-backend

The backend for Vedeo — a YouTube alternative for Russia without VPN.

Built with Deno and YouTube.js (innertube API). Deployed on Deno Deploy under VEDEO Technologies.

## Endpoints

- `GET /trending?region=RU` — trending videos
- `GET /search?q={query}` — search videos and channels
- `GET /video/{videoId}` — video info + stream URLs
- `GET /comments/{videoId}` — video comments
- `GET /channel/{channelId}` — channel info + videos
- `GET /shorts` — shorts feed
- `GET /proxy?url={url}` — CORS proxy for stream URLs

## Stack

- Runtime: Deno 2.x
- YouTube API: youtubei.js (InnerTube)
- Hosting: Deno Deploy (VEDEO Technologies org)

## Fallback chain

1. This backend (innertube via Deno Deploy)
2. thepixora invidious instance
3. fairydust piped instance
