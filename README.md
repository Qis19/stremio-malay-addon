# Local Malay Library

A personal media server for Malay movies and TV series. Streams local content to Stremio with personalized recommendations powered by your actual watch history.

Built from scratch — no subscriptions, no cloud dependency (optional), fully self-hosted.

---

## What It Does

- 📺 **Local library in Stremio** — browse and play your downloaded Malay content
- 🔄 **Auto-organize Telegram downloads** — drop file in inbox, it self-sorts
- 🎬 **Smart filename parsing** — cleans messy Telegram names
- 📊 **Watch history tracking** — knows what you've watched and how much
- ⭐ **Top Picks** — personalized recommendations from your taste
- 🎯 **Because You Watched** — contextual recommendations
- 🔒 **Torrentio playability filter** — only recommends streamable content
- 🎥 **Cast & director weighting** — recommendations influenced by your favorite actors/directors
- 📈 **IMDb rating boost** — high-rated content influences recommendations more
- 🤖 **Telegram bot** — status, search, quality score from your phone
- 🌐 **Remote access** — via Tailscale (secure, private)
- 🔄 **Auto-import from Stremio** — syncs cloud watch history every 10 min
- 📱 **Works on TV, phone, PC** — native Stremio experience

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        SOURCES                                    │
│                                                                   │
│   ┌──────────────┐    ┌──────────────┐    ┌─────────────────┐   │
│   │  Telegram    │    │   Stremio    │    │   Your manual   │   │
│   │  @msm21bot   │    │   cloud      │    │   downloads     │   │
│   │  @portalmalay│    │   history    │    │                 │   │
│   └──────┬───────┘    └──────┬───────┘    └────────┬────────┘   │
│          │                   │                     │            │
└──────────┼───────────────────┼─────────────────────┼────────────┘
           │                   │                     │
           ▼                   │                     ▼
   ┌───────────────┐           │           ┌──────────────────┐
   │ INBOX folder  │           │           │ MEDIA folder     │
   │ (raw files)   │           │           │ (organized)      │
   └───────┬───────┘           │           └────────┬─────────┘
           │                   │                    │
           ▼                   │                    │
   ┌───────────────┐           │                    │
   │  ORGANIZER    │           │                    │
   │  • parse name │           │                    │
   │  • clean tags │           │                    │
   │  • move file  │           │                    │
   └───────┬───────┘           │                    │
           │                   │                    │
           ▼                   │                    ▼
   ┌───────────────────────────────────────────────┐
   │           LIBRARY (C:\Stremio\Malay\)         │
   │                                                │
   │  Movie Title (Year)/                           │
   │    └── Movie Title (Year).mkv                  │
   │  Series Title/                                 │
   │    ├── Series S01E01.mkv                       │
   │    └── Series S01E02.mkv                       │
   └───────────────────┬───────────────────────────┘
                       │
                       ▼
   ┌───────────────────────────────────────────────┐
   │         SCANNER (builds index)                │
   │         Watches for new files                 │
   └───────────────────┬───────────────────────────┘
                       │
                       ▼
   ┌───────────────────────────────────────────────┐
   │       LOCAL MALAY LIBRARY ADDON               │
   │       (port 7000)                             │
   │                                                │
   │  Catalog handlers:                             │
   │    • Malay Films                               │
   │    • Malay Dramas                              │
   │    • Top Picks For You                         │
   │    • Because You Watched                       │
   │                                                │
   │  Meta handler:                                 │
   │    • Full details, cast, director              │
   │                                                │
   │  Stream handler:                               │
   │    • Local file URLs                           │
   │    • Subtitle paths                            │
   │                                                │
   │  Watch log (JSON):                             │
   │    • plays, clicks, completions                │
   └───────────────────┬───────────────────────────┘
                       │
                       ▼
   ┌───────────────────────────────────────────────┐
   │         TAILSCALE SERVE                       │
   │  https://machine.tailnet.ts.net               │
   └───────────────────┬───────────────────────────┘
                       │
                       ▼
   ┌───────────────────────────────────────────────┐
   │              STREMIO                           │
   │         (TV / phone / PC)                      │
   └───────────────────────────────────────────────┘
```

### Recommendation Engine

```
┌────────────────────────┐      ┌────────────────────────┐
│  Local watch log       │      │  SIMKL watch history   │
│  (data/watch-log.json) │      │  (cloud API)           │
│                        │      │                        │
│  • plays               │      │  • movies (watched)    │
│  • clicks              │      │  • shows               │
│  • completions         │      │  • timestamps          │
└───────────┬────────────┘      └───────────┬────────────┘
            │                                │
            └────────────┬───────────────────┘
                         ▼
            ┌────────────────────────────┐
            │   getTasteProfile()        │
            │                            │
            │  For each play:            │
            │   1. TMDB lookup           │
            │   2. Get genres            │
            │   3. Get cast (top 5)      │
            │   4. Get directors         │
            │   5. Get IMDb rating       │
            │   6. Apply boost (x0.5-1.5)│
            │   7. Accumulate weights    │
            └────────────┬───────────────┘
                         ▼
            ┌────────────────────────────┐
            │  TASTE PROFILE             │
            │                            │
            │  genres:    [top 5]        │
            │  years:     [top 5]        │
            │  cast:      [top 5 actors] │
            │  directors: [top 3]        │
            └────────────┬───────────────┘
                         ▼
            ┌────────────────────────────┐
            │  getTopPicks()             │
            │                            │
            │  1. TMDB discover:         │
            │     • top 3 genres         │
            │     • Malay content        │
            │  2. Remove owned           │
            │  3. Torrentio check        │
            │  4. Rank by cast/director  │
            │  5. Return top 20          │
            └────────────────────────────┘
```

### Telegram Sync Flow

```
Every 10 minutes:
    ↓
NuviSync API called
    ↓
Reads Stremio cloud history
    ↓
Compares to SIMKL
    ↓
Pushes new plays → SIMKL
    ↓
Addon reads updated SIMKL
    ↓
Taste profile refreshed
    ↓
Recommendations updated
```

---

## Data Flow

### When You Watch a Video

```
1. Click play in Stremio
       ↓
2. Stream handler fires → startSession()
       ↓
3. Player requests video chunks
       ↓
4. server.js serves each chunk with range support
       ↓
5. updateProgress() tracks byte requests
       ↓
6. On stop / idle:
   finalizeSession() computes:
     - percent watched
     - duration
     - status (completed/half/started)
     - weight (5/2/1/0)
       ↓
7. Appends to data/watch-log.json
       ↓
8. Next recommendation refresh uses new data
```

### When You Add a File

```
1. File lands in C:\Telegram Downloads\
       ↓
2. Chokidar watcher detects
       ↓
3. parser.js extracts:
     - title
     - year
     - season/episode
       ↓
4. organizer.js:
     - Sanitizes title
     - Creates target folder
     - Moves file
       ↓
5. Library watcher (chokidar) detects new file
       ↓
6. scanner.js indexes it
       ↓
7. metadata.js enriches:
     - TMDB lookup
     - Poster, description
     - Cast, director, genres
     - IMDb rating
       ↓
8. Available in Stremio
```

---

## File Structure

```
malay-local-addon/
│
├── src/
│   ├── index.js
│   ├── addon.js
│   ├── scanner.js
│   ├── parser.js
│   ├── organizer.js
│   ├── metadata.js
│   ├── server.js
│   ├── watcher.js
│   ├── recommend.js
│   └── bot.js
│
├── test/
│   ├── watcher.test.js
│   ├── server.test.js
│   ├── recommend.test.js
│   ├── nuviosync-import.js
│   └── run-all.js
│
├── data/
│   ├── watch-log.json
│   ├── search-log.json
│   └── current-session.json
│
├── .env
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── TESTING.md
```

---

## Content — What Lives Where

### Files (Your Media)

```
C:\Stremio\Malay\                     <- LIBRARY
├── Mat Kilau (2022)/
│   ├── Mat Kilau (2022).mkv
│   └── poster.jpg
├── Nur/
│   ├── Nur S01E01.mkv
│   ├── Nur S01E02.mkv
│   └── Nur S01E03.mkv
├── Polong (2026)/
│   └── Polong (2026).mkv
└── Cinta Dalam Sekam/
    ├── Cinta Dalam Sekam S01E01.mp4
    └── Cinta Dalam Sekam S01E02.mp4

C:\Telegram Downloads\                <- INBOX
└── (files you download from Telegram land here,
     get auto-organized into LIBRARY)
```

### Watch History

`data/watch-log.json`:

```json
{
  "plays": [
    {
      "id": "local:movie:blackberry:2023",
      "name": "BlackBerry",
      "type": "movie",
      "year": "2023",
      "percentWatched": 0.98,
      "status": "completed",
      "weight": 5,
      "duration": 7200,
      "watchCount": 1,
      "timestamp": "2026-09-19T00:00:00Z",
      "lastWatched": "2026-09-19T00:00:00Z"
    }
  ],
  "clicks": [
    {
      "id": "local:movie:blackberry:2023",
      "name": "BlackBerry",
      "type": "movie",
      "timestamp": "2026-09-19T00:00:00Z"
    }
  ]
}
```

### Search History

`data/search-log.json`:

```json
{
  "searches": [
    { "query": "nur", "type": "series", "timestamp": "2026-09-19T00:00:00Z" }
  ]
}
```

### Library Index (Runtime)

In-memory Map, rebuilt on startup:

```js
Map {
  "local:movie:blackberry:2023" => {
    id, name, type, year, filePath,
    poster, background, description,
    genres, cast, director, imdbRating,
    tmdbId
  },
  "local:series:nur" => {
    id, name, type, year,
    episodes: [
      { id, season, episode, filePath }
    ]
  }
}
```

---

## Setup

### Requirements

- Node.js 20+
- Stremio (any platform)
- TMDB API key (free)
- Tailscale (free)
- Optional: SIMKL account (free)
- Optional: Telegram bot token (free)

### Install

```bash
git clone https://github.com/YOUR_USERNAME/malay-local-addon.git
cd malay-local-addon
npm install
```

### Configure

Copy `.env.example` to `.env` and fill in:

```env
PORT=7000
MEDIA_DIR=C:/Stremio/Malay
INBOX_DIR=C:/Telegram Downloads
PUBLIC_URL=https://your-machine.your-tailnet.ts.net
TMDB_API_KEY=your_tmdb_v3_key
BOT_TOKEN=your_bot_token
MY_CHAT_ID=your_chat_id
SIMKL_CLIENT_ID=your_simkl_client_id
SIMKL_ACCESS_TOKEN=your_simkl_access_token
STREMIO_AUTH_KEY=your_stremio_auth_key
```

### Run

```bash
npm start
```

Output:

```
Indexing XX files from C:/Stremio/Malay
Indexed XX titles
Watching C:/Stremio/Malay for new files
Watching inbox: C:/Telegram Downloads
Local Malay addon running
   Manifest: http://localhost:7000/manifest.json
```

### Install in Stremio

1. Addons → Install from URL
2. Paste `http://localhost:7000/manifest.json`
3. Install

### Telegram bot (optional)

```bash
node src/bot.js
```

Commands:
- `/status` — library stats
- `/search <title>` — find in library
- `/recent` — last additions
- `/score <filename>` — quality score

---

## How Each Piece Works

### parser.js — Filename Cleanup

Input:
```
[Group] Movie Title (2024) 1080p WEB-DL x264 HEVC.mkv
```

Process:
1. Strip extension
2. Extract year `(2024)`
3. Remove quality tags (`1080p`, `WEB-DL`, `x264`, `HEVC`)
4. Remove group tags (`[Group]`)
5. Clean whitespace

Output:
```js
{ title: "Movie Title", year: "2024", type: "movie" }
```

### organizer.js — Inbox Pipeline

Watches `INBOX_DIR`. For each new file:
1. Parse filename
2. Build target path
3. Create folder
4. Move file
5. Move subtitles alongside

### scanner.js — Library Index

1. Walks `MEDIA_DIR` recursively
2. Indexes each video file
3. Groups episodes by series
4. Watches for new files (chokidar)

### metadata.js — TMDB Enrichment

For each library item:
1. Search TMDB by title + year
2. Fetch full details (with credits)
3. Extract poster, description, genres, cast, director, IMDb rating
4. Cache result (30 min)

### server.js — HTTP Streaming

1. Endpoint: `/media?path=...`
2. Validates path is under `MEDIA_DIR`
3. Supports range requests (seeking)
4. Serves chunk by chunk

### watcher.js — Watch Log

Tracks:
- Sessions — start, progress, finalize
- Clicks — from meta handler
- Searches — from catalog handler

Auto-finalizes idle sessions after 10 min.

### recommend.js — Engine

1. Taste profile — merges local + SIMKL, applies IMDb boost
2. Top Picks — genre discovery + Torrentio filter + cast/director ranking
3. Because You Watched — recent play's recommendations

### bot.js — Telegram Bot

Commands: `/start`, `/status`, `/search`, `/recent`, `/score`.

---

## Testing

```bash
node test/run-all.js
```

Individual:
```bash
node test/recommend.test.js
node test/watcher.test.js
node test/server.test.js
```

See `TESTING.md` for full guide.

---

## API Keys

| Key | Source |
|---|---|
| TMDB API | https://www.themoviedb.org/settings/api |
| Telegram Bot | @BotFather on Telegram |
| Telegram Chat ID | @userinfobot on Telegram |
| SIMKL | https://simkl.com/settings/developer/ |
| Stremio Auth Key | `web.stremio.com` F12 console |
| Tailscale | https://tailscale.com |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Failed to fetch | Restart addon; reinstall in Stremio |
| 502 from Tailscale | `tailscale serve reset` then `tailscale serve --bg http://127.0.0.1:7000` |
| No recommendations | Check SIMKL + TMDB keys in `.env` |
| Top Picks empty | Watch something first |
| File in wrong folder | Check terminal `[parse]` output |
| Port 7000 in use | `netstat -ano \| findstr :7000` |
| Addon crashes | Check terminal; `npm start` again |
| SIMKL import fails | Regenerate access token |

---

## Known Limitations

1. Local plays don't sync to SIMKL — only watch-log. Cloud plays sync via NuviSync.
2. TMDB coverage — some niche Malay titles not on TMDB.
3. First load slow — Top Picks does ~100 API calls. Subsequent loads cached.
4. Tailscale Serve — one service per URL root. Use `--https=8443` for other projects.
5. Auto-import needs addon running.
6. Windows-tested — should work on Mac/Linux.
7. Single-user system.
8. Manual start — `npm start` on boot.

---

## Acknowledgements

- TMDB — metadata
- Torrentio — stream availability
- SIMKL — watch history
- NuviSync — Stremio to SIMKL sync
- Tailscale — remote access

---

## License

Personal use. Not for redistribution or commercial use.

---

## Version History

- 1.2.0 — Cast/director weighting, IMDb boost
- 1.1.0 — Top Picks + Because You Watched
- 1.0.0 — Initial: library + auto-organize + bot