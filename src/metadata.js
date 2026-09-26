import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const KEY = process.env.TMDB_API_KEY;
const IMG = 'https://image.tmdb.org/t/p';
const cache = new Map();
const enrichCache = new Map();

async function tmdbSearch(type, title, year) {
  const key = `${type}:${title}:${year || ''}`;
  if (cache.has(key)) return cache.get(key);

  const endpoint = type === 'series' ? 'tv' : 'movie';
  const params = new URLSearchParams({
    api_key: KEY,
    query: title,
    language: 'en-US'
  });
  if (year) {
    params.append(type === 'series' ? 'first_air_date_year' : 'year', year);
  }

  const url = `https://api.themoviedb.org/3/search/${endpoint}?${params}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const hit = data.results?.[0] || null;
  cache.set(key, hit);
  return hit;
}

async function tmdbDetails(type, id) {
  const key = `details:${type}:${id}`;
  if (cache.has(key)) return cache.get(key);

  const endpoint = type === 'series' ? 'tv' : 'movie';
  const params = new URLSearchParams({
    api_key: KEY,
    language: 'en-US',
    append_to_response: 'credits,videos,images,external_ids'
  });

  const url = `https://api.themoviedb.org/3/${endpoint}/${id}?${params}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  cache.set(key, data);
  return data;
}

// Find local poster/folder image
export function findLocalPoster(item) {
  try {
    const dir = item.type === 'movie'
      ? path.dirname(item.filePath)
      : (item.episodes?.[0]?.filePath ? path.dirname(item.episodes[0].filePath) : null);

    if (!dir || !fs.existsSync(dir)) return null;

    for (const name of ['poster.jpg', 'poster.png', 'folder.jpg', 'folder.png', 'cover.jpg', 'cover.png']) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  } catch {}
  return null;
}

export async function enrich(item) {
  const cacheKey = `${item.type}:${item.name}:${item.year || ''}`;
  const cached = enrichCache.get(cacheKey);
  if (cached && Date.now() - cached.t < 30 * 60 * 1000) {
    return cached.v;
  }

  if (!KEY) return item;
  try {
    const hit = await tmdbSearch(item.type, item.name, item.year);
    if (!hit) return item;

    const details = await tmdbDetails(item.type, hit.id);

    // Top 5 cast (was 10 — 5 is enough for our weighting)
    const cast = (details?.credits?.cast || []).slice(0, 5).map(c => c.name);

    // Directors (all)
    const director = (details?.credits?.crew || [])
      .filter(c => c.job === 'Director')
      .map(c => c.name);

    const trailer = (details?.videos?.results || [])
      .find(v => v.type === 'Trailer' && v.site === 'YouTube');

    const result = {
      ...item,
      tmdbId: hit.id,
      imdbId: details?.external_ids?.imdb_id,
      poster: hit.poster_path ? `${IMG}/w500${hit.poster_path}` : undefined,
      background: hit.backdrop_path ? `${IMG}/w1280${hit.backdrop_path}` : undefined,
      description: details?.overview || hit.overview || undefined,
      imdbRating: hit.vote_average ? Number(hit.vote_average.toFixed(1)) : undefined,
      genres: (details?.genres || []).map(g => g.name),
      cast,
      director,
      runtime: details?.runtime ? `${details.runtime} min` : undefined,
      releaseInfo: details?.release_date || details?.first_air_date,
      trailerYtId: trailer?.key
    };

    enrichCache.set(cacheKey, { t: Date.now(), v: result });
    return result;
  } catch (err) {
    console.log(`[enrich] error for "${item.name}": ${err.message}`);
    return item;
  }
}