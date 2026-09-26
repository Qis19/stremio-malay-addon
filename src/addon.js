import { addonBuilder } from 'stremio-addon-sdk';
import { library } from './scanner.js';
import { enrich, findLocalPoster } from './metadata.js';
import { logSearch, logClick, startSession } from './watcher.js';
import { getTopPicks, getBecauseYouWatched } from './recommend.js';

export const manifest = {
  id: 'org.local.malay',
  version: '1.2.0',
  name: 'Local Malay Library',
  description: 'Streams Malay movies & dramas downloaded locally, with personal recommendations.',
  logo: 'https://image.tmdb.org/t/p/w300/ziEuG1essDuWuCwZNNxDKcUft7V.jpg',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  idPrefixes: ['local:', 'tmdb:'],
  catalogs: [
    { type: 'movie', id: 'top-picks-movies', name: '⭐ Top Picks For You', extra: [{ name: 'skip' }] },
    { type: 'movie', id: 'because-watched', name: '🎯 Because You Watched', extra: [{ name: 'skip' }] },
    { type: 'movie', id: 'local-films', name: 'Malay Films', extra: [{ name: 'search' }, { name: 'skip' }] },
    { type: 'series', id: 'local-dramas', name: 'Malay Dramas', extra: [{ name: 'search' }, { name: 'skip' }] }
  ],
  behaviorHints: { configurable: false }
};

export const builder = new addonBuilder(manifest);

const base = () => process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 7000}`;

// ---------- Local poster helper ----------
function localPosterUrl(item) {
  const p = findLocalPoster(item);
  if (!p) return null;
  return `${base()}/media?path=${encodeURIComponent(p)}`;
}

// ---------- Catalog ----------
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (extra.search) {
    logSearch(extra.search, type);
  }

  // ========== ⭐ TOP PICKS ==========
  if (id === 'top-picks-movies') {
    try {
      const picks = await getTopPicks('movie', 30);
      console.log(`[catalog] top-picks-movies → ${picks.length} items`);
      return { metas: picks };
    } catch (err) {
      console.error('[catalog] top-picks error:', err.message);
      return { metas: [] };
    }
  }

  // ========== 🎯 BECAUSE YOU WATCHED ==========
  if (id === 'because-watched') {
    try {
      const result = await getBecauseYouWatched(30);
      console.log(`[catalog] because-watched (based on ${result.basedOn || 'nothing'}) → ${result.items.length} items`);
      return { metas: result.items };
    } catch (err) {
      console.error('[catalog] because-watched error:', err.message);
      return { metas: [] };
    }
  }

  // ========== Existing library catalogs ==========
  const search = (extra.search || '').toLowerCase();
  const skip = parseInt(extra.skip || '0', 10);
  const limit = 50;

  const items = [...library.values()]
    .filter(i => i.type === type)
    .filter(i => !search || i.name.toLowerCase().includes(search))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(skip, skip + limit);

  // ⚡ Limit enrichment to first 20 for speed
  // Items beyond 20 return basic metadata (name only) without TMDB enrich
  const metas = await Promise.all(
    items.slice(0, 20).map(async i => {
      try {
        const e = await enrich(i);
        const localPoster = localPosterUrl(i);
        return {
          id: e.id,
          type: e.type,
          name: e.name,
          poster: localPoster || e.poster,
          background: e.background,
          description: e.description,
          year: e.year,
          imdbRating: e.imdbRating
        };
      } catch {
        // Fallback: basic meta if enrich fails
        const localPoster = localPosterUrl(i);
        return {
          id: i.id,
          type: i.type,
          name: i.name,
          poster: localPoster || undefined,
          year: i.year
        };
      }
    })
  );

  // Add remaining items (21+) without enrichment
  const rest = items.slice(20).map(i => ({
    id: i.id,
    type: i.type,
    name: i.name,
    year: i.year
  }));

  return { metas: [...metas, ...rest] };
});

// ---------- Meta ----------
builder.defineMetaHandler(async ({ type, id }) => {
  const item = library.get(id);
  if (item) {
    logClick(item);
  }
  if (!item) {
    const prefix = id.replace(/:S\d+E\d+$/, '');
    const parent = library.get(prefix);
    if (!parent) return { meta: null };
    const e = await enrich(parent);
    const localPoster = localPosterUrl(parent);
    return {
      meta: {
        id: parent.id,
        type: 'series',
        name: parent.name,
        poster: localPoster || e.poster,
        background: e.background,
        description: e.description,
        year: parent.year
      }
    };
  }
  const e = await enrich(item);
  const localPoster = localPosterUrl(item);
  return {
    meta: {
      id: e.id,
      type: e.type,
      name: e.name,
      poster: localPoster || e.poster,
      background: e.background,
      description: e.description,
      year: e.year,
      imdbRating: e.imdbRating
    }
  };
});

// ---------- Stream ----------
builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[STREAM HANDLER FIRED] type=${type} id=${id}`);
  const item = library.get(id);

  // ========== MOVIE ==========
  if (item && item.type === 'movie') {
    startSession(
      { id: item.id, name: item.name, type: 'movie', year: item.year },
      item.filePath
    );
    const streams = [{
      name: 'Local',
      title: item.filename,
      url: `${base()}/media?path=${encodeURIComponent(item.filePath)}`
    }];
    if (item.subtitlePath) {
      streams[0].subtitles = [{
        id: 'sub',
        url: `${base()}/media?path=${encodeURIComponent(item.subtitlePath)}`,
        lang: 'ms'
      }];
    }
    return { streams };
  }

  // ========== SPECIFIC EPISODE (S01E01) ==========
  const episodeMatch = id.match(/:S(\d+)E(\d+)$/);
  if (episodeMatch) {
    const parentId = id.replace(/:S\d+E\d+$/, '');
    const parent = library.get(parentId);
    if (!parent || parent.type !== 'series') return { streams: [] };

    const season = parseInt(episodeMatch[1], 10);
    const episode = parseInt(episodeMatch[2], 10);

    const ep = parent.episodes.find(
      e => e.season === season && e.episode === episode
    );
    if (!ep) return { streams: [] };

    startSession(
      { id: ep.id, name: parent.name, type: 'series', season: ep.season, episode: ep.episode },
      ep.filePath
    );

    const streams = [{
      name: 'Local',
      title: ep.filename,
      url: `${base()}/media?path=${encodeURIComponent(ep.filePath)}`
    }];
    if (ep.subtitlePath) {
      streams[0].subtitles = [{
        id: 'sub',
        url: `${base()}/media?path=${encodeURIComponent(ep.subtitlePath)}`,
        lang: 'ms'
      }];
    }
    return { streams };
  }

  // ========== SERIES-LEVEL (return all episodes, no session) ==========
  if (item && item.type === 'series') {
    const sorted = item.episodes
      .sort((a, b) => a.season - b.season || a.episode - b.episode);

    const streams = sorted.map(ep => {
      const s = {
        name: 'Local',
        title: `S${String(ep.season).padStart(2, '0')}E${String(ep.episode).padStart(2, '0')} — ${ep.filename}`,
        url: `${base()}/media?path=${encodeURIComponent(ep.filePath)}`
      };
      if (ep.subtitlePath) {
        s.subtitles = [{
          id: 'sub',
          url: `${base()}/media?path=${encodeURIComponent(ep.subtitlePath)}`,
          lang: 'ms'
        }];
      }
      return s;
    });

    return { streams };
  }

  return { streams: [] };
});