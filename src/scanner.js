import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import { parseFilename, makeId, makeEpisodeId } from './parser.js';

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v']);
const SUB_EXTS = new Set(['.srt', '.ass', '.vtt']);

// In-memory index
export const library = new Map();

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (VIDEO_EXTS.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

function findSubtitle(videoPath) {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  for (const ext of SUB_EXTS) {
    const candidate = path.join(dir, base + ext);
    if (fs.existsSync(candidate)) return candidate;
    const ms = path.join(dir, base + '.ms' + ext);
    if (fs.existsSync(ms)) return ms;
  }
  return null;
}

function indexFile(filePath) {
  const filename = path.basename(filePath);
  const parsed = parseFilename(filename);
  const sub = findSubtitle(filePath);

  if (parsed.type === 'series') {
    const id = makeId(parsed);
    if (!library.has(id)) {
      library.set(id, {
        id,
        type: 'series',
        name: parsed.title,
        year: parsed.year,
        episodes: []
      });
    }
    const episodes = library.get(id).episodes;
const episodeId = makeEpisodeId(parsed);

// Only add if not already indexed
const existing = episodes.findIndex(e => e.id === episodeId);
if (existing === -1) {
  episodes.push({
    id: episodeId,
    season: parsed.season,
    episode: parsed.episode,
    filePath,
    subtitlePath: sub,
    filename
  });
} else {
  // Update existing entry (in case file was moved/renamed) series
  episodes[existing] = {
    id: episodeId,
    season: parsed.season,
    episode: parsed.episode,
    filePath,
    subtitlePath: sub,
    filename
  };
}
  } else {
    // movies
    const id = makeId(parsed);
    library.set(id, {
  id,
  type: 'movie',
  name: parsed.title,
  year: parsed.year,
  filePath,
  subtitlePath: sub,
  filename
});
  }
}

export function buildIndex() {
  const dir = process.env.MEDIA_DIR;
  if (!fs.existsSync(dir)) {
    console.error(`MEDIA_DIR not found: ${dir}`);
    return;
  }
  const files = walk(dir);
  console.log(`Indexing ${files.length} files from ${dir}`);
  files.forEach(indexFile);
  console.log(`Indexed ${library.size} titles`);
}

export function watchFolder() {
  const dir = process.env.MEDIA_DIR;
  const watcher = chokidar.watch(dir, {
    ignoreInitial: true,
    depth: 5
  });
  watcher.on('add', (p) => {
    if (VIDEO_EXTS.has(path.extname(p).toLowerCase())) {
      console.log(`New file: ${p}`);
      indexFile(p);
    }
  });
  watcher.on('unlink', (p) => {
    console.log(`Removed: ${p} — rebuilding index`);
    library.clear();
    buildIndex();
  });
  console.log(`Watching ${dir} for new files`);
  return watcher;
}