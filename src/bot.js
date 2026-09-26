import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getWatchLog } from './watcher.js';
import { library, buildIndex } from './scanner.js';

// ESM-compatible import for CommonJS module
import pkg from 'node-telegram-bot-api';
const TelegramBot = pkg.default || pkg;

const TOKEN = process.env.BOT_TOKEN;
const MY_CHAT_ID = String(process.env.MY_CHAT_ID || '');
const ALLOWED = MY_CHAT_ID ? [MY_CHAT_ID] : [];

if (!TOKEN) {
  console.error('❌ BOT_TOKEN missing in .env');
  process.exit(1);
}

// Build library so /status and /search have data
buildIndex();

const bot = new TelegramBot(TOKEN, { polling: true });

// ---------- Trusted release groups ----------
const TRUSTED_GROUPS = ['seikel', 'nakama', 'tgx', 'galaxyrg', 'yts', 'evo', 'fgt', 'psa'];

// ---------- Quality scoring ----------
function scoreFile(filename) {
  const lower = filename.toLowerCase();
  let score = 0;
  const good = [];
  const warn = [];
  const bad = [];

  // SOURCE (max 35)
  if (/web[\s._-]?dl/i.test(lower)) {
    score += 35; good.push('WEB-DL (best web quality)');
  } else if (/blu[\s._-]?ray|bdrip|brrip/i.test(lower)) {
    score += 33; good.push('BluRay');
  } else if (/web[\s._-]?rip/i.test(lower)) {
    score += 22; warn.push('WEBRip (screen-captured)');
  } else if (/hdtv/i.test(lower)) {
    score += 15; warn.push('HDTV');
  } else if (/cam|telesync|hdcam|\bts\b|\btc\b/i.test(lower)) {
    score -= 30; bad.push('CAM/TS — filmed in cinema');
  }

  // RESOLUTION (max 25)
  if (/1080p/i.test(lower)) {
    score += 25; good.push('1080p');
  } else if (/2160p|4k/i.test(lower)) {
    score += 20; warn.push('4K (large file)');
  } else if (/720p/i.test(lower)) {
    score += 15; warn.push('720p (lower quality)');
  } else if (/480p/i.test(lower)) {
    score += 5; bad.push('480p — low quality');
  }

  // CODEC (max 20)
  if (/x264|h264|avc/i.test(lower)) {
    score += 20; good.push('x264 (TV-safe)');
  } else if (/x265|h265|hevc/i.test(lower)) {
    score += 3; bad.push('HEVC/H.265 — TV may fail');
  } else if (/av1/i.test(lower)) {
    score += 0; bad.push('AV1 — very few TVs support');
  }

  // AUDIO (max 10)
  if (/aac|ddp|ac3|eac3|dd5[\s.]?1/i.test(lower)) {
    score += 10; good.push('AAC/DDP audio');
  } else if (/dts|truehd/i.test(lower)) {
    score += 6; warn.push('DTS/TrueHD (may not decode)');
  } else if (/opus/i.test(lower)) {
    score += 0; bad.push('Opus — many TVs can\'t decode');
  }

  // GROUP BONUS (max 5)
  const foundGroup = TRUSTED_GROUPS.find(g => lower.includes(g));
  if (foundGroup) {
    score += 5; good.push(`Trusted group (${foundGroup.toUpperCase()})`);
  }

  score = Math.max(0, Math.min(100, score));
  return { score, good, warn, bad };
}

function verdictEmoji(score) {
  if (score >= 80) return '✅';
  if (score >= 60) return '⚠️';
  if (score >= 40) return '🟡';
  return '❌';
}

function verdictText(score) {
  if (score >= 80) return 'Excellent — download it.';
  if (score >= 60) return 'Good — should work.';
  if (score >= 40) return 'Mediocre — consider alternatives.';
  if (score >= 20) return 'Poor — try to find better.';
  return 'Terrible — skip it.';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatScore(filename, result) {
  const { score, good, warn, bad } = result;
  let msg = `📊 <b>Score: ${score}/100</b> ${verdictEmoji(score)}\n\n`;
  msg += `<code>${escapeHtml(filename)}</code>\n\n`;
  if (good.length) msg += good.map(t => `✅ ${t}`).join('\n') + '\n\n';
  if (warn.length) msg += warn.map(t => `⚠️ ${t}`).join('\n') + '\n\n';
  if (bad.length) msg += bad.map(t => `❌ ${t}`).join('\n\n');
  msg += `🎬 ${verdictText(score)}`;
  return msg;
}

// ---------- Whitelist ----------
function isAllowed(msg) {
  if (ALLOWED.length === 0) return true;
  return ALLOWED.includes(String(msg.chat.id));
}

// ---------- Utility ----------
function formatSize(bytes) {
  if (bytes > 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes > 1e6) return (bytes / 1e6).toFixed(0) + ' MB';
  return bytes + ' bytes';
}

function getTotalSize() {
  const dir = process.env.MEDIA_DIR;
  if (!dir) return 0;
  let total = 0;
  function walk(p) {
    try {
      for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
        const full = path.join(p, entry.name);
        if (entry.isDirectory()) walk(full);
        else try { total += fs.statSync(full).size; } catch {}
      }
    } catch {}
  }
  walk(dir);
  return total;
}

function getRecentFiles(limit = 10) {
  const dir = process.env.MEDIA_DIR;
  if (!dir) return [];
  const files = [];
  function walk(p) {
    try {
      for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
        const full = path.join(p, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.match(/\.(mp4|mkv|avi|mov|webm|m4v)$/i)) {
          try {
            const stat = fs.statSync(full);
            files.push({ name: entry.name, path: full, mtime: stat.mtime, size: stat.size });
          } catch {}
        }
      }
    } catch {}
  }
  walk(dir);
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

// ---------- Commands ----------
bot.onText(/^\/start/, (msg) => {
  if (!isAllowed(msg)) return;
  bot.sendMessage(msg.chat.id,
    `👋 <b>Malay Movie &amp; Series Scorer</b>\n\n` +
    `Commands:\n` +
    `/status — library stats\n` +
    `/search &lt;title&gt; — find content\n` +
    `/recent — last additions\n` +
    `/score &lt;filename&gt; — score a file\n` +
    `/help — this menu\n\n` +
    `Or send a filename directly to score it.`,
    { parse_mode: 'HTML' }
  );
});

bot.onText(/^\/help/, (msg) => {
  if (!isAllowed(msg)) return;
  bot.sendMessage(msg.chat.id,
    `📖 <b>Commands</b>\n\n` +
    `/status — library stats\n` +
    `/search &lt;title&gt; — find content\n` +
    `/recent — last additions\n` +
    `/score &lt;filename&gt; — score a file\n\n` +
    `<b>Scoring:</b> Source, Resolution, Codec, Audio, Trusted Groups`,
    { parse_mode: 'HTML' }
  );
});

bot.onText(/^\/status/, (msg) => {
  if (!isAllowed(msg)) return;

  const movies = [...library.values()].filter(i => i.type === 'movie');
  const series = [...library.values()].filter(i => i.type === 'series');
  const episodeCount = series.reduce((sum, s) => sum + (s.episodes?.length || 0), 0);
  const totalSize = getTotalSize();
  const log = getWatchLog();
  const playCount = log.plays?.length || 0;

  const reply =
    `📊 <b>Library Status</b>\n\n` +
    `🎬 Movies: ${movies.length}\n` +
    `📺 Series: ${series.length}\n` +
    `📼 Episodes: ${episodeCount}\n` +
    `💾 Storage: ${formatSize(totalSize)}\n` +
    `▶️ Plays logged: ${playCount}`;

  bot.sendMessage(msg.chat.id, reply, { parse_mode: 'HTML' });
});

bot.onText(/^\/recent/, (msg) => {
  if (!isAllowed(msg)) return;

  const recent = getRecentFiles(10);
  if (recent.length === 0) {
    return bot.sendMessage(msg.chat.id, '📁 No files found.');
  }

  let m = `📥 <b>Last ${recent.length} additions:</b>\n\n`;
  for (const f of recent) {
    const date = f.mtime.toISOString().slice(0, 16).replace('T', ' ');
    m += `• ${escapeHtml(f.name)}\n  ${formatSize(f.size)} — ${date}\n`;
  }

  bot.sendMessage(msg.chat.id, m, { parse_mode: 'HTML' });
});

bot.onText(/^\/search\s+(.+)/i, (msg, match) => {
  if (!isAllowed(msg)) return;
  const query = match[1].toLowerCase().trim();
  if (query.length < 2) return;

  const results = [...library.values()]
    .filter(i => i.name.toLowerCase().includes(query))
    .slice(0, 10);

  if (results.length === 0) {
    return bot.sendMessage(msg.chat.id, `🔍 No matches for "<b>${escapeHtml(query)}</b>"`, { parse_mode: 'HTML' });
  }

  let m = `🔍 <b>Found ${results.length} matches:</b>\n\n`;
  for (const r of results) {
    const icon = r.type === 'series' ? '📺' : '🎬';
    m += `${icon} ${escapeHtml(r.name)}${r.year ? ` (${r.year})` : ''}\n`;
    if (r.type === 'series') m += `   ${r.episodes?.length || 0} episodes\n`;
  }

  bot.sendMessage(msg.chat.id, m, { parse_mode: 'HTML' });
});

bot.onText(/^\/score\s+(.+)/i, (msg, match) => {
  if (!isAllowed(msg)) return;
  const filename = match[1].trim();
  const result = scoreFile(filename);
  bot.sendMessage(msg.chat.id, formatScore(filename, result), { parse_mode: 'HTML' });
});

// ---------- Plain text handler (auto-score filenames) ----------
bot.on('message', (msg) => {
  if (!isAllowed(msg)) return;
  if (msg.text && msg.text.startsWith('/')) return;

  if (msg.text) {
    const looksLikeFilename = /\.(mkv|mp4|avi|mov|webm|m4v)$/i.test(msg.text) ||
      /1080p|720p|480p|2160p|web-dl|webrip|x264|x265|hevc/i.test(msg.text);

    if (looksLikeFilename) {
      const result = scoreFile(msg.text.trim());
      bot.sendMessage(msg.chat.id, formatScore(msg.text.trim(), result), { parse_mode: 'HTML' });
    }
  }
});

// ---------- Error handling ----------
bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

console.log('🤖 Malay Movie & Series Scorer running...');
console.log(`   Whitelist: ${ALLOWED.length ? ALLOWED.join(', ') : 'OPEN (no restriction)'}`);