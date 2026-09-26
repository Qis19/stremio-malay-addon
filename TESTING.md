# Testing Guide

How to verify the Local Malay Library addon works end-to-end.

---

## Quick Health Check

```powershell
curl http://localhost:7000/manifest.json
```

Expected: JSON starting with `{"id":"org.local.malay",...}`

- Works → addon running
- Failed to fetch → run `npm start`
- Timeout → port conflict or crash

---

## Automated Tests

### Run All

```powershell
node test/run-all.js
```

Expected:

```
Running watcher tests...
  Passed: 7
  Failed: 0

Running server tests...
  Passed: 9
  Failed: 0

Running recommendation tests...
  Passed: 13
  Failed: 0
```

### Individual

```powershell
node test/watcher.test.js
node test/server.test.js
node test/recommend.test.js
```

---

## Test 1 — Library Index

```powershell
node -e "import('./src/scanner.js').then(m => { m.buildIndex(); console.log('Library size:', m.library.size); })"
```

Expected: `Library size: 13`

If 0:
- Check `MEDIA_DIR` in `.env`
- Check folder has video files
- Extensions: `.mp4`, `.mkv`, `.avi`, `.mov`, `.webm`, `.m4v`

---

## Test 2 — Metadata Enrichment

```powershell
node -e "import('dotenv/config').then(async () => { const { enrich } = await import('./src/metadata.js'); const { buildIndex, library } = await import('./src/scanner.js'); buildIndex(); const item = [...library.values()][0]; const e = await enrich(item); console.log('Name:', e.name); console.log('Rating:', e.imdbRating, typeof e.imdbRating); console.log('Genres:', e.genres); console.log('Cast:', e.cast); console.log('Director:', e.director); })"
```

Expected:

```
Name: <title>
Rating: 7.3 number
Genres: [ 'Drama', 'Action' ]
Cast: [ 'Actor 1', 'Actor 2', ... ]
Director: [ 'Director Name' ]
```

---

## Test 3 — SIMKL Connection

```powershell
node -e "import('dotenv/config').then(async () => { const r = await fetch('https://api.simkl.com/sync/all-items?extended=full', { headers: { 'Authorization': 'Bearer ' + process.env.SIMKL_ACCESS_TOKEN, 'simkl-api-key': process.env.SIMKL_CLIENT_ID } }); console.log('Status:', r.status); const d = await r.json(); console.log('Movies:', (d.movies||[]).length); console.log('Shows:', (d.shows||[]).length); })"
```

Expected:

```
Status: 200
Movies: 18
Shows: 10
```

| Status | Meaning |
|---|---|
| 200 | Working |
| 401 | Bad token |
| 412 | Bad client ID |
| 500 | SIMKL server issue |

---

## Test 4 — NuviSync Import

```powershell
node test/nuviosync-import.js
```

Expected:

```
Auth key length: 44
SIMKL token length: 64
Status: 200
Response: {"success":true,"stats":{...}}
```

`movies:+0 shows:+0` means nothing new (normal).
`movies:+1` means new play imported.

---

## Test 5 — Recommendations

```powershell
node test/recommend.test.js
```

Look for:

```
[simkl] loaded XX plays
[taste] merged XX plays
[tmdb] OK "Title" -> Title [genres] rating
[top-picks] profile: genres=[...], cast=[...], directors=[...]
[top-picks] TMDB returned XX results
[top-picks] XX playable via Torrentio
[catalog] top-picks-movies -> XX items
```

Expected: 13 passed, 0 failed.

---

## Test 6 — Tailscale Access

Browser (PC):

```
https://<your-machine>.ts.net/manifest.json
```

Expected: JSON output.

If 502:

```powershell
tailscale serve reset
tailscale serve --bg http://127.0.0.1:7000
tailscale serve status
```

---

## Test 7 — Stremio Playback

On TV / phone / PC:

1. Open Stremio
2. Addons -> confirm Local Malay Library installed
3. Discover -> check rows:
   - Top Picks For You
   - Because You Watched
   - Malay Films
   - Malay Dramas
4. Click a title -> streams show
5. Play -> video plays

---

## Test 8 — Auto-Organize

```powershell
"test" > "C:\Telegram Downloads\Test Movie (2024).mkv"
```

Watch terminal:

```
[inbox] new file: Test Movie (2024).mkv
[parse] "Test Movie (2024).mkv"
      -> type: movie, title: "Test Movie", year: 2024
[ok] -> Stremio\Malay\Test Movie (2024)\Test Movie (2024).mkv
```

Check:

```powershell
dir "C:\Stremio\Malay\Test Movie (2024)"
```

Cleanup:

```powershell
rmdir /S /Q "C:\Stremio\Malay\Test Movie (2024)"
```

---

## Test 9 — Watch Log

```powershell
type data\watch-log.json
```

Expected structure:

```json
{
  "plays": [
    {
      "id": "local:movie:...",
      "name": "...",
      "status": "completed",
      "weight": 5,
      "duration": 3600,
      "percentWatched": 0.98,
      "timestamp": "..."
    }
  ],
  "clicks": []
}
```

If empty after watching: wait 10 min for auto-finalize, or restart addon.

---

## Test 10 — Telegram Bot

```powershell
node src/bot.js
```

In Telegram:

- `/start` — welcome menu
- `/status` — library stats
- `/search <title>` — find in library
- `/score <filename>` — quality score

Expected: reply within 2 seconds.

---

## Full Test Suite

```powershell
cd "C:\Users\Qisti\Desktop\Malay local addon\Local addon\malay-local-addon"

# 1. Addon
curl http://localhost:7000/manifest.json

# 2. All tests
node test/run-all.js

# 3. SIMKL
node -e "import('dotenv/config').then(async () => { const r = await fetch('https://api.simkl.com/sync/all-items?extended=full', { headers: { 'Authorization': 'Bearer ' + process.env.SIMKL_ACCESS_TOKEN, 'simkl-api-key': process.env.SIMKL_CLIENT_ID } }); const d = await r.json(); console.log('SIMKL:', (d.movies||[]).length, 'movies,', (d.shows||[]).length, 'shows'); })"

# 4. Recommendations
node test/recommend.test.js
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Addon doesn't start | `netstat -ano \| findstr :7000` |
| Tests fail | `npm install` |
| SIMKL 401 | Regenerate token in `.env` |
| SIMKL 412 | Check client ID |
| TMDB 401 | Check API key |
| Tailscale 502 | `tailscale serve reset` + re-add |
| No recommendations | Watch something first |
| Empty Top Picks | Check SIMKL + TMDB |

---

## Daily Health Check

```powershell
cd "C:\Users\Qisti\Desktop\Malay local addon\Local addon\malay-local-addon"

curl -s http://localhost:7000/manifest.json | findstr "org.local.malay"
node test/recommend.test.js | findstr "Passed"
```

All pass: healthy.

---

## Expected Test Times

| Test | Time |
|---|---|
| watcher.test.js | 2 sec |
| server.test.js | 5 sec |
| recommend.test.js | 30-60 sec |
| All together | 60-90 sec |

Slow because of TMDB rate limits. Caching helps on repeat runs.