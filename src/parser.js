// Handles: "Nur S01E01.mp4", "Nur.S01E01.1080p.mkv",
// "Nur (2025) S01E01.mp4", "Mat Kilau (2022).mp4",
// "Nur Ep 5.mkv", "Nur Episode 5.mp4", "Nur E05.mkv"

// Known junk tags (simple single-word matches)
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

export function parseFilename(filename) {
  const name = filename.replace(/\.[^.]+$/, '');

  // Extract year
  const yearMatch = name.match(/\((\d{4})\)/);
  let year = yearMatch ? yearMatch[1] : undefined;

  if (!year) {
    const bareYear = name.match(/\b(19|20)\d{2}\b/);
    if (bareYear) year = bareYear[0];
  }

  // Clean junk FIRST
  const cleaned = cleanTitle(name);

  // ---------- 1. Standard S01E01 ----------
  const seriesMatch = cleaned.match(
    /^(.*?)[\s._-]*[Ss](\d{1,2})[\s._-]*[Ee](\d{1,3})/i
  );
  if (seriesMatch) {
    return {
      type: 'series',
      title: cleanTitle(seriesMatch[1]),
      season: parseInt(seriesMatch[2], 10),
      episode: parseInt(seriesMatch[3], 10),
      year
    };
  }

  // ---------- 2. "Ep 5" / "Episode 5" / "E05" ----------
  const epMatch = cleaned.match(/^(.*?)[\s._-]+(?:Ep|Episode|E)[\s._-]*(\d{1,3})\b/i);
  if (epMatch && epMatch[1].length > 1) {
    return {
      type: 'series',
      title: cleanTitle(epMatch[1]),
      season: 1,
      episode: parseInt(epMatch[2], 10),
      year
    };
  }

  // ---------- 3. Season pack ----------
  const packMatch = cleaned.match(/^(.*?)[\s._-]+(?:[Ss](\d{1,2})|Season[\s._-]*(\d{1,2}))[\s._-]*$/i);
  if (packMatch) {
    return {
      type: 'series',
      title: cleanTitle(packMatch[1]),
      season: parseInt(packMatch[2] || packMatch[3], 10),
      episode: 1,
      year
    };
  }

  // ---------- 4. Movie ----------
  return {
    type: 'movie',
    title: cleanTitle(name),
    year
  };
}

export function cleanTitle(s) {
  let result = String(s);

  // Normalize separators first
  result = result.replace(/[._]/g, ' ');
  result = result.replace(/@\w+/g, ' ');
  result = result.replace(/\[[^\]]*\]/g, ' ');
  result = result.replace(/\s+/g, ' ').trim();

  // ----- Multi-word patterns (must come before word-boundary tags) -----
  result = result.replace(/\bweb[\s-]?dl\b/gi, ' ');
  result = result.replace(/\bweb[\s-]?rip\b/gi, ' ');
  result = result.replace(/\bweb[\s-]?multi\b/gi, ' ');
  result = result.replace(/\bblu[\s-]?ray\b/gi, ' ');
  result = result.replace(/\bdd[ps]?\s*\d[\s.]?\d\b/gi, ' ');
  result = result.replace(/\bdts[\s-]?hd\b/gi, ' ');
  result = result.replace(/\bmalay[\s-]?sub\b/gi, ' ');

  // ----- Single-word tag strip from JUNK_TAGS -----
  for (const tag of JUNK_TAGS) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    result = result.replace(re, ' ');
  }

  // ----- Generic resolution pattern (e.g. 1080p, 2160p, 480i) -----
  result = result.replace(/\b\d{3,4}[pi]\b/gi, ' ');

  // ----- Codec pattern -----
  result = result.replace(/\b[×xX]26[45]\b/g, ' ');

  // ----- Trailing release-group suffix: " -MH", "-SEIKEL", "-TGX" -----
  result = result.replace(/\s+-\s*[A-Za-z0-9]+\s*$/g, ' ');

  // ----- Years -----
  result = result.replace(/\(\d{4}\)/g, ' ');
  result = result.replace(/\b(19|20)\d{2}\b/g, ' ');

  // ----- Cleanup -----
  result = result.replace(/[-–—]+/g, ' ');
  result = result.replace(/\s+/g, ' ');
  return result.trim();
}

export function makeId(parsed) {
  const base = parsed.title.toLowerCase().replace(/\s+/g, '-');
  return `local:${parsed.type}:${base}${parsed.year ? ':' + parsed.year : ''}`;
}

export function makeEpisodeId(parsed) {
  const base = parsed.title.toLowerCase().replace(/\s+/g, '-');
  const s = String(parsed.season || 1).padStart(2, '0');
  const e = String(parsed.episode || 1).padStart(2, '0');
  return `local:series:${base}${parsed.year ? ':' + parsed.year : ''}:S${s}E${e}`;
}