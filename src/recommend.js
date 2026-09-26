import fetch from 'node-fetch';
import { getWatchLog } from './watcher.js';
import { library } from './scanner.js';

const KEY = process.env.TMDB_API_KEY;
const IMG = 'https://image.tmdb.org/t/p';
const TORRENTIO_BASE = 'https://torrentio.strem.fun';
const SIMKL_CLIENT_ID = process.env.SIMKL_CLIENT_ID;
const SIMKL_ACCESS_TOKEN = process.env.SIMKL_ACCESS_TOKEN;

// Caches
const imdbIdCache = new Map();
const torrentioCache = new Map();
const tasteCache = new Map();
const detailCache = new Map();

// ---------- Sanitize title for TMDB search ----------
function sanitizeTitle(title) {
  if (!title) return '';
  return String(title)
    .replace(/\b(malaysub|msub|msm|kakifilem|quickie4u|seikel|nakama|tgx|galaxyrg|yts|rarbg|fgt|evo|psa|mh)\b/gi, ' ')
    .replace(/\b(web[\s._-]?dl|web[\s._-]?rip|web[\s._-]?multi|hdrip|hdtv|blu[\s._-]?ray|brrip|bdrip|dvdrip|dvd|hdcam|cam)\b/gi, ' ')
    .replace(/\b(x264|x265|h264|h265|hevc|avc|av1|xvid|divx|10bit|8bit)\b/gi, ' ')
    .replace(/\b(aac|ac3|eac3|dd5[\s.]?1|ddp5[\s.]?1|ddp|dts|truehd|opus|flac|mp3)\b/gi, ' ')
    .replace(/\b(1080p|720p|480p|2160p|4k|hd|sd|fhd|uhd)\b/gi, ' ')
    .replace(/\b(nf|netflix|amzn|dsnp|disney|hmax|atvp|hulu|itunes)\b/gi, ' ')
    .replace(/\b(malay|indo|indonesia|submalay|multi|dual|subs|sub|bm)\b/gi, ' ')
    .replace(/\b(proper|repack|extended|unrated|remastered)\b/gi, ' ')
    .replace(/[._]/g, ' ')
    .replace(/[-–—]+/g, ' ')
    .replace(/\(\d{4}\)/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- IMDb Boost ----------
function imdbBoost(rating) {
  const r = Number(rating);
  if (!r || r === 0) return 1.0;
  if (r >= 8.5) return 1.5;
  if (r >= 8.0) return 1.4;
  if (r >= 7.5) return 1.3;
  if (r >= 7.0) return 1.2;
  if (r >= 6.5) return 1.1;
  if (r >= 6.0) return 1.0;
  if (r >= 5.0) return 0.8;
  if (r >= 4.0) return 0.6;
  return 0.5;
}

// ---------- SIMKL History ----------
async function getSimklHistory() {
  if (!SIMKL_CLIENT_ID || !SIMKL_ACCESS_TOKEN) return [];

  try {
    const res = await fetch('https://api.simkl.com/sync/all-items?extended=full', {
      headers: {
        'Authorization': `Bearer ${SIMKL_ACCESS_TOKEN}`,
        'simkl-api-key': SIMKL_CLIENT_ID
      }
    });
    if (!res.ok) {
      console.log(`[simkl] error ${res.status}`);
      return [];
    }
    const data = await res.json();

    const plays = [];

    for (const m of (data.movies || [])) {
      const movie = m.movie;
      if (!movie) continue;
      const ts = m.last_watched_at || m.added_to_watchlist_at || null;
      plays.push({
        name: movie.title,
        year: movie.year ? String(movie.year) : undefined,
        type: 'movie',
        imdbId: movie.ids?.imdb,
        tmdbId: movie.ids?.tmdb,
        status: m.status === 'completed' ? 'completed' : 'started',
        weight: m.status === 'completed' ? 5 : 2,
        source: 'simkl',
        lastWatched: ts,
        timestamp: ts
      });
    }

    for (const s of (data.shows || [])) {
      const show = s.show;
      if (!show) continue;
      const ts = s.last_watched_at || s.added_to_watchlist_at || null;
      plays.push({
        name: show.title,
        year: show.year ? String(show.year) : undefined,
        type: 'series',
        imdbId: show.ids?.imdb,
        tmdbId: show.ids?.tmdb,
        status: s.status === 'completed' ? 'completed' : 'started',
        weight: s.status === 'completed' ? 5 : 2,
        source: 'simkl',
        lastWatched: ts,
        timestamp: ts
      });
    }

    console.log(`[simkl] loaded ${plays.length} plays (${(data.movies||[]).length} movies, ${(data.shows||[]).length} shows)`);
    return plays;
  } catch (err) {
    console.log(`[simkl] error: ${err.message}`);
    return [];
  }
}

// ---------- Taste Profile (with cast/director/rating boost) ----------
export async function getTasteProfile() {
  const log = getWatchLog();
  const localPlays = log.plays || [];
  const simklPlays = await getSimklHistory();

  const seen = new Set();
  const allPlays = [];

  for (const p of localPlays) {
    const key = `${p.name}:${p.year || ''}:${p.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    allPlays.push({ ...p, source: 'local' });
  }

  for (const p of simklPlays) {
    const key = `${p.name}:${p.year || ''}:${p.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    allPlays.push(p);
  }

  console.log(`[taste] merged ${allPlays.length} plays (${localPlays.length} local + ${simklPlays.length} simkl)`);

  const genres = {};
  const years = {};
  const castMap = {};
  const directorsMap = {};

  for (const play of allPlays) {
    const baseWeight = play.weight || 1;
    if (baseWeight === 0) continue;

    const info = await lookupTMDB(play.name, play.year, play.type);
    if (!info) continue;

    // Apply IMDb boost
    const boost = imdbBoost(info.imdbRating);
    const weight = baseWeight * boost;

    if (info.genres) {
      for (const g of info.genres) {
        genres[g] = (genres[g] || 0) + weight;
      }
    }

    // Cast accumulation
    if (info.cast) {
      for (const actor of info.cast.slice(0, 5)) {
        castMap[actor] = (castMap[actor] || 0) + weight;
      }
    }

    // Director accumulation
    if (info.director) {
      for (const d of info.director) {
        directorsMap[d] = (directorsMap[d] || 0) + weight;
      }
    }

    if (play.year) {
      years[play.year] = (years[play.year] || 0) + weight;
    }
  }

  return {
    genres: topN(genres, 5),
    years: topN(years, 5),
    cast: topN(castMap, 5),
    directors: topN(directorsMap, 3),
    totalPlays: allPlays.length,
    localCount: localPlays.length,
    simklCount: simklPlays.length
  };
}

// ---------- TMDB lookup with variants ----------
async function lookupTMDB(title, year, type = 'movie') {
  if (!title || !KEY) return null;

  const cleanedTitle = sanitizeTitle(title);
  if (!cleanedTitle || cleanedTitle.length < 2) {
    console.log(`[tmdb] sanitized title empty from "${title}"`);
    return null;
  }

  const cacheKey = `${cleanedTitle}:${year || ''}:${type}`;
  if (tasteCache.has(cacheKey)) return tasteCache.get(cacheKey);

  try {
    const endpoint = type === 'series' ? 'tv' : 'movie';

    const variants = [
      cleanedTitle,
      cleanedTitle.replace(/\bdan\b/gi, '&'),
      cleanedTitle.replace(/\band\b/gi, '&'),
      cleanedTitle.replace(/&/g, 'dan'),
      cleanedTitle.split(' ').slice(0, 2).join(' ')
    ].filter((v, i, arr) => v && v.length > 1 && arr.indexOf(v) === i);

    let hit = null;

    if (year) {
      for (const variant of variants) {
        const params = new URLSearchParams({ api_key: KEY, query: variant });
        params.append(type === 'series' ? 'first_air_date_year' : 'year', year);

        const searchUrl = `https://api.themoviedb.org/3/search/${endpoint}?${params}`;
        let searchRes;
        try { searchRes = await fetch(searchUrl); } catch { continue; }
        if (!searchRes.ok) continue;

        const searchData = await searchRes.json();
        const candidate = searchData.results?.[0];
        if (candidate) {
          hit = candidate;
          console.log(`[tmdb] variant hit (year=${year}): "${variant}" → ${candidate.title || candidate.name}`);
          break;
        }
      }
    }

    if (!hit) {
      for (const variant of variants) {
        const params = new URLSearchParams({ api_key: KEY, query: variant });
        const searchUrl = `https://api.themoviedb.org/3/search/${endpoint}?${params}`;
        let searchRes;
        try { searchRes = await fetch(searchUrl); } catch { continue; }
        if (!searchRes.ok) continue;

        const searchData = await searchRes.json();
        const candidate = searchData.results?.[0];
        if (candidate) {
          hit = candidate;
          console.log(`[tmdb] variant hit (no year): "${variant}" → ${candidate.title || candidate.name}`);
          break;
        }
      }
    }

    if (!hit) {
      console.log(`[tmdb] no match: "${title}" → "${cleanedTitle}"`);
      tasteCache.set(cacheKey, null);
      return null;
    }

    // Get full details with credits
    const detailUrl = `https://api.themoviedb.org/3/${endpoint}/${hit.id}?api_key=${KEY}&append_to_response=credits`;
    const detailRes = await fetch(detailUrl);
    if (!detailRes.ok) {
      tasteCache.set(cacheKey, null);
      return null;
    }

    const detail = await detailRes.json();

    const cast = (detail.credits?.cast || []).slice(0, 5).map(c => c.name);
    const director = (detail.credits?.crew || [])
      .filter(c => c.job === 'Director')
      .map(c => c.name);

    const result = {
      tmdbId: detail.id,
      name: detail.title || detail.name,
      genres: (detail.genres || []).map(g => g.name),
      imdbRating: detail.vote_average ? Number(detail.vote_average.toFixed(1)) : 0,
      cast,
      director
    };

    console.log(`[tmdb] ✓ "${title}" → ${result.name} [${result.genres.join(', ')}] ⭐${result.imdbRating}`);
    tasteCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.log(`[tmdb] error for "${cleanedTitle}": ${err.message}`);
    tasteCache.set(cacheKey, null);
    return null;
  }
}

function topN(obj, n) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key]) => key);
}

// ---------- Top Picks (with cast/director ranking) ----------
export async function getTopPicks(type = 'movie', limit = 20) {
  if (!KEY) {
    console.log('[top-picks] No TMDB key');
    return [];
  }

  const profile = await getTasteProfile();
  console.log(`[top-picks] profile: genres=${JSON.stringify(profile.genres)}, cast=${JSON.stringify(profile.cast)}, directors=${JSON.stringify(profile.directors)}, plays=${profile.totalPlays}`);

  if (profile.totalPlays === 0) {
    console.log('[top-picks] No plays logged → empty');
    return [];
  }

  const endpoint = type === 'series' ? 'tv' : 'movie';
  const params = new URLSearchParams({
    api_key: KEY,
    sort_by: 'popularity.desc',
    page: 1
  });

  const topGenres = profile.genres.slice(0, 3);
  const genreIds = topGenres.map(mapGenreToId).filter(Boolean);
  if (genreIds.length > 0) {
    params.append('with_genres', genreIds.join(','));
    console.log(`[top-picks] filtering by genres (OR): ${topGenres.join(', ')}`);
  }

  const url = `https://api.themoviedb.org/3/discover/${endpoint}?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`[top-picks] TMDB error: ${res.status}`);
    return [];
  }

  const data = await res.json();
  const results = data.results || [];
  console.log(`[top-picks] TMDB returned ${results.length} results`);

  const existingTmdbIds = new Set();
  for (const item of library.values()) {
    if (item.tmdbId) existingTmdbIds.add(item.tmdbId);
  }

  const candidates = results
    .filter(r => !existingTmdbIds.has(r.id))
    .slice(0, limit * 5);

  console.log(`[top-picks] ${candidates.length} candidates after owned filter`);

  if (candidates.length === 0) return [];

  const playable = await filterPlayable(candidates, type, limit);
  console.log(`[top-picks] ${playable.length} playable via Torrentio`);

  // Rank by cast/director match
  const ranked = await rankByCastDirector(playable, profile, type);
  console.log(`[top-picks] ranked → ${ranked.length} items`);

  return ranked.map(r => toStremioMeta(r.item || r, type));
}

// ---------- Rank by cast/director match ----------
async function rankByCastDirector(items, profile, type) {
  const topCast = profile.cast || [];
  const topDirectors = profile.directors || [];

  if (topCast.length === 0 && topDirectors.length === 0) {
    // No cast/director data → return as-is
    return items.map(item => ({ item, score: 0 }));
  }

  const scored = [];

  for (const item of items) {
    const detail = await getItemCredits(item.id, type);
    if (!detail) {
      scored.push({ item, score: 0 });
      continue;
    }

    let score = 0;

    // Cast match
    for (const actor of (detail.cast || [])) {
      if (topCast.includes(actor)) score += 1;
    }

    // Director match (higher weight)
    for (const d of (detail.directors || [])) {
      if (topDirectors.includes(d)) score += 1.5;
    }

    scored.push({ item, score, detail });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ---------- Get cast/director for a TMDB item ----------
async function getItemCredits(tmdbId, type) {
  const cacheKey = `credits:${type}:${tmdbId}`;
  if (detailCache.has(cacheKey)) return detailCache.get(cacheKey);

  try {
    const endpoint = type === 'series' ? 'tv' : 'movie';
    const url = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}/credits?api_key=${KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
      detailCache.set(cacheKey, null);
      return null;
    }
    const data = await res.json();
    const result = {
      cast: (data.cast || []).slice(0, 5).map(c => c.name),
      directors: (data.crew || []).filter(c => c.job === 'Director').map(c => c.name)
    };
    detailCache.set(cacheKey, result);
    return result;
  } catch {
    detailCache.set(cacheKey, null);
    return null;
  }
}

// ---------- Because You Watched X ----------
export async function getBecauseYouWatched(limit = 20) {
  if (!KEY) return { basedOn: null, items: [] };

  const log = getWatchLog();
  const localPlays = (log.plays || []).filter(p => p.weight >= 2);
  const simklPlays = (await getSimklHistory()).filter(p => p.weight >= 2);

  const allPlays = [...localPlays];
  const seen = new Set(allPlays.map(p => `${p.name}:${p.year || ''}`));
  for (const p of simklPlays) {
    const key = `${p.name}:${p.year || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    allPlays.push(p);
  }

  if (allPlays.length === 0) {
    console.log('[because-watched] No high-weight plays');
    return { basedOn: null, items: [] };
  }

  allPlays.sort((a, b) =>
    new Date(b.lastWatched || b.timestamp || 0) - new Date(a.lastWatched || a.timestamp || 0)
  );

  console.log(`[because-watched] top candidates by recency:`);
  allPlays.slice(0, 3).forEach(p => {
    console.log(`   - ${p.name} | ${p.lastWatched || p.timestamp || 'no timestamp'}`);
  });

  for (const play of allPlays) {
    console.log(`[because-watched] trying: ${play.name}`);
    const info = await lookupTMDB(play.name, play.year, play.type);
    if (!info || !info.tmdbId) {
      console.log(`[because-watched] "${play.name}" not found on TMDB, trying next...`);
      continue;
    }

    console.log(`[because-watched] matched: ${info.name}`);

    const endpoint = play.type === 'series' ? 'tv' : 'movie';
    const url = `https://api.themoviedb.org/3/${endpoint}/${info.tmdbId}/recommendations?api_key=${KEY}&page=1`;

    let res;
    try { res = await fetch(url); } catch { continue; }
    if (!res.ok) continue;

    const data = await res.json();
    const results = data.results || [];

    const existingTmdbIds = new Set();
    for (const item of library.values()) {
      if (item.tmdbId) existingTmdbIds.add(item.tmdbId);
    }

    const candidates = results
      .filter(r => !existingTmdbIds.has(r.id))
      .slice(0, limit * 3);

    console.log(`[because-watched] ${candidates.length} candidates`);

    if (candidates.length === 0) continue;

    const playable = await filterPlayable(candidates, play.type, limit);
    console.log(`[because-watched] ${playable.length} playable via Torrentio`);

    if (playable.length === 0) continue;

    return {
      basedOn: info.name,
      items: playable.map(r => toStremioMeta(r, play.type))
    };
  }

  console.log('[because-watched] No matching titles found');
  return { basedOn: null, items: [] };
}

// ---------- Torrentio Playability Check ----------
async function hasTorrentioStream(imdbId, type = 'movie') {
  if (!imdbId) return false;

  const cacheKey = `${type}:${imdbId}`;
  if (torrentioCache.has(cacheKey)) return torrentioCache.get(cacheKey);

  const endpoint = type === 'series' ? 'series' : 'movie';
  const url = `${TORRENTIO_BASE}/stream/${endpoint}/${imdbId}.json`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000
    });
    if (!res.ok) {
      torrentioCache.set(cacheKey, false);
      return false;
    }

    const data = await res.json();
    const has = Array.isArray(data.streams) && data.streams.length > 0;
    torrentioCache.set(cacheKey, has);
    return has;
  } catch {
    torrentioCache.set(cacheKey, false);
    return false;
  }
}

async function getImdbId(tmdbId, type) {
  const cacheKey = `${type}:${tmdbId}`;
  if (imdbIdCache.has(cacheKey)) return imdbIdCache.get(cacheKey);

  try {
    const endpoint = type === 'series' ? 'tv' : 'movie';
    const url = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}/external_ids?api_key=${KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
      imdbIdCache.set(cacheKey, null);
      return null;
    }

    const data = await res.json();
    const imdbId = data.imdb_id || null;
    imdbIdCache.set(cacheKey, imdbId);
    return imdbId;
  } catch {
    imdbIdCache.set(cacheKey, null);
    return null;
  }
}

async function filterPlayable(candidates, type, limit) {
  const playable = [];
  const queue = [...candidates];

  async function worker() {
    while (queue.length > 0 && playable.length < limit * 3) {
      const item = queue.shift();
      if (!item) break;

      const imdbId = await getImdbId(item.id, type);
      if (!imdbId) continue;

      const has = await hasTorrentioStream(imdbId, type);
      if (has) {
        playable.push(item);
      }
    }
  }

  await Promise.all(Array(5).fill(null).map(worker));
  return playable.slice(0, limit);
}

// ---------- Helpers ----------
function toStremioMeta(item, type) {
  return {
    id: `tmdb:${type === 'series' ? 'series' : 'movie'}:${item.id}`,
    type: type === 'series' ? 'series' : 'movie',
    name: item.title || item.name,
    poster: item.poster_path ? `${IMG}/w500${item.poster_path}` : undefined,
    background: item.backdrop_path ? `${IMG}/w1280${item.backdrop_path}` : undefined,
    description: item.overview,
    year: (item.release_date || item.first_air_date || '').slice(0, 4),
    imdbRating: item.vote_average ? item.vote_average.toFixed(1) : undefined
  };
}

function mapGenreToId(genreName) {
  const map = {
    'Action': 28, 'Adventure': 12, 'Animation': 16, 'Comedy': 35,
    'Crime': 80, 'Documentary': 99, 'Drama': 18, 'Family': 10751,
    'Fantasy': 14, 'History': 36, 'Horror': 27, 'Music': 10402,
    'Mystery': 9648, 'Romance': 10749, 'Sci-Fi': 878,
    'Thriller': 53, 'War': 10752, 'Western': 37
  };
  return map[genreName];
}