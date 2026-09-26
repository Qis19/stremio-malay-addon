import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve('./data');
const WATCH_LOG = path.join(DATA_DIR, 'watch-log.json');
const SEARCH_LOG = path.join(DATA_DIR, 'search-log.json');
const SESSION_FILE = path.join(DATA_DIR, 'current-session.json');

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Init log files
function ensureLog(file, initial) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(initial, null, 2));
  }
}
ensureLog(WATCH_LOG, { plays: [], clicks: [] });
ensureLog(SEARCH_LOG, { searches: [] });

// ---------- Read/Write helpers ----------
function read(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function write(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ---------- Session tracking ----------
let currentSession = null;

export function startSession(item, filePath) {
  if (currentSession) {
    finalizeSession();
  }

  let totalSize = 0;
  try {
    totalSize = fs.statSync(filePath).size;
  } catch {}

  currentSession = {
    item,
    filePath,
    totalSize,
    lastByte: 0,
    startedAt: Date.now(),
    lastUpdate: Date.now(),
    requestCount: 0
  };

  write(SESSION_FILE, currentSession);
  console.log(`[session] started: ${item.name || item.id} (${formatSize(totalSize)})`);
}

export function updateProgress(endByte) {
  if (!currentSession) return;

  if (!currentSession.requestCount) currentSession.requestCount++;
  else currentSession.requestCount++;

  // Filter 1: ignore byte requests larger than session file
  if (endByte > currentSession.totalSize) {
    return;
  }

  // Filter 2: ignore first request if near end (metadata fetch)
  const isNearEnd = endByte > currentSession.totalSize * 0.95;
  if (currentSession.requestCount === 1 && isNearEnd) {
    currentSession.lastUpdate = Date.now();
    return;
  }

  // Filter 3: ignore huge jumps (> 30% of file)
  const jump = endByte - currentSession.lastByte;
  const isHugeJump = jump > currentSession.totalSize * 0.3;
  if (isHugeJump && currentSession.lastByte > 0) {
    currentSession.lastUpdate = Date.now();
    return;
  }

  if (endByte > currentSession.lastByte) {
    currentSession.lastByte = endByte;
  }
  currentSession.lastUpdate = Date.now();
}

export function finalizeSession() {
  if (!currentSession) return;

  const s = currentSession;
  let percent = s.totalSize > 0 ? s.lastByte / s.totalSize : 0;
  percent = Math.min(percent, 1.0);

  const durationSec = Math.round((s.lastUpdate - s.startedAt) / 1000);

  let status = 'started';
  let weight = 1;

  if (percent >= 0.9 && durationSec >= 60) {
    status = 'completed';
    weight = 5;
  } else if (percent >= 0.5 && durationSec >= 30) {
    status = 'half-watched';
    weight = 2;
  } else if (durationSec >= 10) {
    status = 'started';
    weight = 1;
  } else {
    status = 'barely-started';
    weight = 0;
  }

  const entry = {
    id: s.item.id,
    name: s.item.name,
    type: s.item.type,
    season: s.item.season,
    episode: s.item.episode,
    year: s.item.year,
    percentWatched: Number(percent.toFixed(3)),
    status,
    weight,
    duration: durationSec,
    timestamp: new Date().toISOString()
  };

  const log = read(WATCH_LOG, { plays: [], clicks: [] });

  // Debug
  console.log(`[merge] entry.id=${entry.id}`);
  console.log(`[merge] existing ids: ${log.plays.map(p => p.id).join(' | ') || '(none)'}`);

  const existingIdx = log.plays.findIndex(p => p.id === entry.id);

  if (existingIdx >= 0) {
    console.log(`[merge] merging into index ${existingIdx}`);
    const existing = log.plays[existingIdx];
    log.plays[existingIdx] = {
      ...entry,
      percentWatched: Math.max(existing.percentWatched || 0, entry.percentWatched),
      status: entry.percentWatched >= (existing.percentWatched || 0) ? entry.status : existing.status,
      weight: Math.max(existing.weight || 0, entry.weight),
      watchCount: (existing.watchCount || 1) + 1,
      totalDuration: (existing.totalDuration || existing.duration || 0) + entry.duration,
      firstWatched: existing.firstWatched || existing.timestamp,
      lastWatched: entry.timestamp
    };
  } else {
    console.log(`[merge] new entry`);
    log.plays.push({
      ...entry,
      watchCount: 1,
      totalDuration: entry.duration,
      firstWatched: entry.timestamp,
      lastWatched: entry.timestamp
    });
  }

  write(WATCH_LOG, log);

  console.log(`[session] finalized: ${s.item.name} — ${status} (${(percent * 100).toFixed(0)}% in ${durationSec}s)`);

  currentSession = null;

  try {
    fs.unlinkSync(SESSION_FILE);
  } catch {}
}

// ---------- Loggers ----------
export function logSearch(query, type) {
  if (!query || query.trim().length < 2) return;

  const log = read(SEARCH_LOG, { searches: [] });
  log.searches.push({
    query: query.trim().toLowerCase(),
    type,
    timestamp: new Date().toISOString()
  });

  if (log.searches.length > 500) {
    log.searches = log.searches.slice(-500);
  }

  write(SEARCH_LOG, log);
  console.log(`[search] "${query}" (${type})`);
}

export function logClick(item) {
  if (!item) return;

  const log = read(WATCH_LOG, { plays: [], clicks: [] });

  const now = Date.now();
  const recent = log.clicks.findLast(c =>
    c.id === item.id &&
    (now - new Date(c.timestamp).getTime()) < 60000
  );

  if (recent) {
    console.log(`[click] ${item.name || item.id} (dedup)`);
    return;
  }

  log.clicks.push({
    id: item.id,
    name: item.name,
    type: item.type,
    year: item.year,
    timestamp: new Date().toISOString()
  });

  if (log.clicks.length > 1000) {
    log.clicks = log.clicks.slice(-1000);
  }

  write(WATCH_LOG, log);
  console.log(`[click] ${item.name || item.id}`);
}

// ---------- Read helpers ----------
export function getWatchLog() {
  return read(WATCH_LOG, { plays: [], clicks: [] });
}

export function getSearchLog() {
  return read(SEARCH_LOG, { searches: [] });
}

// ---------- Utility ----------
function formatSize(bytes) {
  if (bytes > 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes > 1e6) return (bytes / 1e6).toFixed(0) + ' MB';
  return bytes + ' bytes';
}

// Auto-finalize if idle
setInterval(() => {
  if (!currentSession) return;
  const idle = Date.now() - currentSession.lastUpdate;
  if (idle > 10 * 60 * 1000) {
    console.log('[session] idle 10min — finalizing');
    finalizeSession();
  }
}, 60 * 1000);

// Finalize on exit
process.on('SIGINT', () => {
  if (currentSession) finalizeSession();
  process.exit(0);
});
process.on('SIGTERM', () => {
  if (currentSession) finalizeSession();
  process.exit(0);
});