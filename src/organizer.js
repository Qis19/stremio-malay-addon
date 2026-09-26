import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v']);
const IGNORED_EXTS = new Set(['.crdownload', '.part', '.tmp', '.download']);

// Same junk tags as parser.js
const JUNK_TAGS = [
  // Resolution
  '1080p', '720p', '480p', '2160p', '4k', 'hd', 'sd', 'fhd', 'uhd',
  // Source
  'hdtv', 'dvdrip', 'dvd', 'hdcam', 'cam', 'ts', 'tc', 'brrip', 'bdrip', 'webdl',
  // Codecs
  'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'av1', 'xvid', 'divx',
  '10bit', '8bit',
  // Audio
  'aac', 'ac3', 'eac3', 'ddp5.1', 'dd5.1', 'ddp5', 'ddp', 'dts', 'truehd', 'opus', 'flac', 'mp3', 'ma',
  // Streaming sources
  'amzn', 'nf', 'netflix', 'dsnp', 'disney', 'hmax', 'atvp', 'hulu', 'itunes',
  // Release status
  'proper', 'repack', 'extended', 'unrated', 'remastered',
  // Language/subtitle
  'multi', 'dual', 'subs', 'sub', 'subtitle', 'hardsub', 'softsub',
  'malay', 'malaysub', 'msub', 'indo', 'indonesia', 'submalay', 'bm',
  // Release groups
  'nakama', 'tgx', 'galaxyrg', 'yts', 'rarbg', 'fgt', 'evo', 'psa',
  'kakifilem', 'msm', 'quickie4u', 'seikel', 'mh',
  // Misc
  'ds4k'
];

function sanitize(s) {
  return s.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
}

function cleanTitle(s) {
  let result = String(s);

  // Normalize separators first
  result = result.replace(/[._]/g, ' ');
  result = result.replace(/@\w+/g, ' ');
  result = result.replace(/\[[^\]]*\]/g, ' ');
  result = result.replace(/\s+/g, ' ').trim();

  // ----- Multi-word patterns (must come first) -----
  result = result.replace(/\bweb[\s-]?dl\b/gi, ' ');
  result = result.replace(/\bweb[\s-]?rip\b/gi, ' ');
  result = result.replace(/\bweb[\s-]?multi\b/gi, ' ');
  result = result.replace(/\bblu[\s-]?ray\b/gi, ' ');
  result = result.replace(/\bdd[ps]?\s*\d[\s.]?\d\b/gi, ' ');
  result = result.replace(/\bdts[\s-]?hd\b/gi, ' ');
  result = result.replace(/\bmalay[\s-]?sub\b/gi, ' ');

  // ----- Single-word tag strip -----
  for (const tag of JUNK_TAGS) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    result = result.replace(re, ' ');
  }

  // ----- Generic patterns -----
  result = result.replace(/\b\d{3,4}[pi]\b/gi, ' ');
  result = result.replace(/\b[×xX]26[45]\b/g, ' ');
  result = result.replace(/\s+-\s*[A-Za-z0-9]+\s*$/g, ' ');
  result = result.replace(/\(\d{4}\)/g, ' ');
  result = result.replace(/\b(19|20)\d{2}\b/g, ' ');
  result = result.replace(/[-–—]+/g, ' ');
  result = result.replace(/\s+/g, ' ');

  return result.trim();
}

function smartParse(filename) {
  let base = filename.replace(/\.[^.]+$/, '');
  base = base.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();

  // Extract year (from parens or bare)
  let year = null;
  const yearMatch = base.match(/\((\d{4})\)/);
  if (yearMatch) {
    year = yearMatch[1];
  } else {
    const bareYear = base.match(/\b(19|20)\d{2}\b/);
    if (bareYear) year = bareYear[0];
  }

  base = cleanTitle(base);

  // 1. S01E01
  let m = base.match(/\bS(\d{1,2})[\s.-]*E(\d{1,3})\b/i);
  if (m) {
    const before = base.slice(0, m.index).trim();
    return {
      type: 'series',
      title: sanitize(cleanTitle(before)),
      season: parseInt(m[1], 10),
      episode: parseInt(m[2], 10),
      year
    };
  }

  // 2. Season X Episode Y
  m = base.match(/\bSeason\s*(\d{1,2})\b.*?\bEpisode\s*(\d{1,3})\b/i);
  if (m) {
    const before = base.slice(0, m.index).trim();
    return {
      type: 'series',
      title: sanitize(cleanTitle(before)),
      season: parseInt(m[1], 10),
      episode: parseInt(m[2], 10),
      year
    };
  }

  // 3. Ep 5 / Episode 5 / E05
  m = base.match(/\b(?:Ep|Episode|E)\s*\.?\s*(\d{1,3})\b/i);
  if (m) {
    const before = base.slice(0, m.index).trim();
    const after = base.slice(m.index + m[0].length).trim();
    const potentialTitle = before || after;
    return {
      type: 'series',
      title: sanitize(cleanTitle(potentialTitle)),
      season: 1,
      episode: parseInt(m[1], 10),
      year
    };
  }

  // 4. "Nur 01"
  m = base.match(/^(.+?)[\s-]+(\d{1,3})(?:\s|$)/);
  if (m && !year && m[1].length > 1) {
    const num = parseInt(m[2], 10);
    if (num <= 200) {
      return {
        type: 'series',
        title: sanitize(cleanTitle(m[1])),
        season: 1,
        episode: num,
        year
      };
    }
  }

  // 5. Movie
  const title = sanitize(cleanTitle(base));
  return {
    type: 'movie',
    title: title || sanitize(base),
    year
  };
}

function buildTargetPath(parsed, ext) {
  const root = process.env.MEDIA_DIR;

  if (parsed.type === 'series') {
    const folder = sanitize(parsed.title);
    const targetDir = path.join(root, folder);
    const s = String(parsed.season).padStart(2, '0');
    const e = String(parsed.episode).padStart(2, '0');
    const filename = `${folder} S${s}E${e}${ext}`;
    return path.join(targetDir, filename);
  }

  const cleanName = sanitize(parsed.title)
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .replace(/\s+(19|20)\d{2}\s*$/, '')
    .trim();

  const folder = parsed.year
    ? `${cleanName} (${parsed.year})`
    : cleanName;
  const targetDir = path.join(root, folder);
  const filename = `${folder}${ext}`;
  return path.join(targetDir, filename);
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  let i = 1;
  while (fs.existsSync(path.join(dir, `${base} (${i})${ext}`))) i++;
  return path.join(dir, `${base} (${i})${ext}`);
}

export function organizeFile(srcPath) {
  try {
    const filename = path.basename(srcPath);
    const ext = path.extname(filename).toLowerCase();

    if (IGNORED_EXTS.has(ext)) return;
    if (!VIDEO_EXTS.has(ext)) return;

    const root = path.resolve(process.env.MEDIA_DIR);
    const abs = path.resolve(srcPath);
    if (abs.startsWith(root)) {
      console.log(`[skip] already in library: ${filename}`);
      return;
    }

    const parsed = smartParse(filename);
    const target = uniquePath(buildTargetPath(parsed, ext));
    const targetDir = path.dirname(target);

    console.log(`[parse] "${filename}"`);
    console.log(`      → type: ${parsed.type}, title: "${parsed.title}", S${parsed.season || '-'}E${parsed.episode || '-'}${parsed.year ? ', year: ' + parsed.year : ''}`);

    fs.mkdirSync(targetDir, { recursive: true });

    try {
      fs.renameSync(srcPath, target);
    } catch (err) {
      if (err.code === 'EXDEV') {
        fs.copyFileSync(srcPath, target);
        fs.unlinkSync(srcPath);
      } else throw err;
    }

    // Move subtitles
    const srcBase = path.join(path.dirname(srcPath), path.basename(srcPath, ext));
    const tgtBase = path.join(targetDir, path.basename(target, ext));
    for (const subExt of ['.srt', '.ass', '.vtt', '.sub']) {
      const s = srcBase + subExt;
      if (fs.existsSync(s)) {
        fs.renameSync(s, tgtBase + subExt);
        console.log(`[subtitle] moved ${path.basename(s)}`);
      }
      const ms = srcBase + '.ms' + subExt;
      if (fs.existsSync(ms)) {
        fs.renameSync(ms, tgtBase + '.ms' + subExt);
        console.log(`[subtitle] moved ${path.basename(ms)}`);
      }
    }

    console.log(`[ok] → ${path.relative(process.cwd(), target)}`);
  } catch (err) {
    console.error(`[error] ${srcPath}:`, err.message);
  }
}

export function watchInbox() {
  const inbox = process.env.INBOX_DIR;
  if (!inbox) {
    console.log('INBOX_DIR not set — skipping organizer watcher');
    return null;
  }
  if (!fs.existsSync(inbox)) {
    fs.mkdirSync(inbox, { recursive: true });
    console.log(`Created inbox folder: ${inbox}`);
  }

  const watcher = chokidar.watch(inbox, {
    ignoreInitial: false,
    depth: 3,
    awaitWriteFinish: { stabilityThreshold: 3000, pollInterval: 500 }
  });

  watcher.on('add', (p) => {
    console.log(`[inbox] new file: ${path.basename(p)}`);
    organizeFile(p);
  });

  console.log(`👀 Watching inbox: ${inbox}`);
  return watcher;
}