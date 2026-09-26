import 'dotenv/config';
import assert from 'assert';
import fs from 'fs';
import path from 'path';

// ---------- Setup ----------
const DATA_DIR = path.resolve('./data');
const WATCH_LOG = path.join(DATA_DIR, 'watch-log.json');

let backup = null;
if (fs.existsSync(WATCH_LOG)) {
  backup = fs.readFileSync(WATCH_LOG, 'utf8');
}

// ---------- Import + Build Library ----------
import { library, buildIndex } from '../src/scanner.js';
import { builder, manifest } from '../src/addon.js';

// Build the library from disk (reads C:\Stremio\Malay)
buildIndex();

// ---------- Framework ----------
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n📋 ${name}`);
}

console.log('🧪 Running addon tests...\n');
console.log(`📚 Library: ${library.size} titles\n`);
section('Manifest');

test('Manifest has required fields', () => {
  assert.ok(manifest.id, 'Has id');
  assert.ok(manifest.name, 'Has name');
  assert.ok(manifest.resources.includes('catalog'), 'Has catalog resource');
  assert.ok(manifest.resources.includes('meta'), 'Has meta resource');
  assert.ok(manifest.resources.includes('stream'), 'Has stream resource');
});

test('Manifest has Malay Films catalog', () => {
  const cat = manifest.catalogs.find(c => c.id === 'local-films');
  assert.ok(cat, 'Has local-films catalog');
  assert.strictEqual(cat.type, 'movie');
});

test('Manifest has Malay Dramas catalog', () => {
  const cat = manifest.catalogs.find(c => c.id === 'local-dramas');
  assert.ok(cat, 'Has local-dramas catalog');
  assert.strictEqual(cat.type, 'series');
});

section('Stream Handler — Episode Resolution');

test('Series ID returns all episodes', async () => {
  // Find a series in the library
  const series = [...library.values()].find(i => i.type === 'series');
  if (!series) {
    console.log('     (skipped — no series in library)');
    return;
  }

  const handler = builder.getInterface().get('stream');
  const result = await handler({
    type: 'series',
    id: series.id
  });

  assert.ok(result.streams, 'Returns streams array');
  assert.ok(result.streams.length > 0, 'Has at least 1 stream');
  assert.strictEqual(
    result.streams.length,
    series.episodes.length,
    'Returns exactly as many streams as episodes'
  );
});

test('Specific episode ID returns ONLY that episode', async () => {
  // Find a series with at least 2 episodes
  const series = [...library.values()].find(
    i => i.type === 'series' && i.episodes.length >= 2
  );
  if (!series) {
    console.log('     (skipped — no series with 2+ episodes)');
    return;
  }

  const ep = series.episodes[0];
  const episodeId = ep.id; // Should be like "local:series:nur:S01E01"

  const handler = builder.getInterface().get('stream');
  const result = await handler({
    type: 'series',
    id: episodeId
  });

  assert.ok(result.streams, 'Returns streams array');
  assert.strictEqual(result.streams.length, 1, 'Returns exactly 1 stream');

  // Verify the URL matches THIS episode's file, not another
  const streamUrl = result.streams[0].url;
  const expectedPath = encodeURIComponent(ep.filePath);
  assert.ok(
    streamUrl.includes(expectedPath),
    `Stream URL should contain episode file path.\nExpected: ${expectedPath}\nGot: ${streamUrl}`
  );
});

test('Each episode has a UNIQUE stream URL', async () => {
  const series = [...library.values()].find(
    i => i.type === 'series' && i.episodes.length >= 2
  );
  if (!series) {
    console.log('     (skipped — no series with 2+ episodes)');
    return;
  }

  const handler = builder.getInterface().get('stream');
  const urls = new Set();

  for (const ep of series.episodes.slice(0, 5)) {
    const result = await handler({ type: 'series', id: ep.id });
    if (result.streams.length > 0) {
      urls.add(result.streams[0].url);
    }
  }

  assert.strictEqual(
    urls.size,
    Math.min(5, series.episodes.length),
    'Each episode returns a unique URL'
  );
});

section('Stream Handler — Movie Resolution');

test('Movie ID returns exactly 1 stream', async () => {
  const movie = [...library.values()].find(i => i.type === 'movie');
  if (!movie) {
    console.log('     (skipped — no movie in library)');
    return;
  }

  const handler = builder.getInterface().get('stream');
  const result = await handler({ type: 'movie', id: movie.id });

  assert.ok(result.streams, 'Returns streams array');
  assert.strictEqual(result.streams.length, 1, 'Returns exactly 1 stream');
});

test('Movie stream URL contains movie file path', async () => {
  const movie = [...library.values()].find(i => i.type === 'movie');
  if (!movie) {
    console.log('     (skipped — no movie in library)');
    return;
  }

  const handler = builder.getInterface().get('stream');
  const result = await handler({ type: 'movie', id: movie.id });

  const streamUrl = result.streams[0].url;
  const expectedPath = encodeURIComponent(movie.filePath);
  assert.ok(
    streamUrl.includes(expectedPath),
    `URL should contain movie path.\nExpected: ${expectedPath}\nGot: ${streamUrl}`
  );
});

section('Episodes Are Returned in Order');

test('Series streams are sorted by season then episode', async () => {
  const series = [...library.values()].find(
    i => i.type === 'series' && i.episodes.length >= 2
  );
  if (!series) {
    console.log('     (skipped — no series with 2+ episodes)');
    return;
  }

  const handler = builder.getInterface().get('stream');
  const result = await handler({ type: 'series', id: series.id });

  // Parse S01E01 from titles
  const titles = result.streams.map(s => s.title);
  const numbers = titles.map(t => {
    const match = t.match(/S(\d+)E(\d+)/);
    return match ? `${match[1]}-${match[2]}` : null;
  }).filter(Boolean);

  // Check sorted
  for (let i = 1; i < numbers.length; i++) {
    const [s1, e1] = numbers[i - 1].split('-').map(Number);
    const [s2, e2] = numbers[i].split('-').map(Number);
    assert.ok(
      s1 < s2 || (s1 === s2 && e1 <= e2),
      `Episode ${i - 1} (${numbers[i - 1]}) should come before ${i} (${numbers[i]})`
    );
  }
});

// ---------- Cleanup ----------
if (backup) {
  fs.writeFileSync(WATCH_LOG, backup);
  console.log('\n🧹 Restored original log');
}

console.log(`\n📊 Results:`);
console.log(`  ✅ Passed: ${passed}`);
console.log(`  ❌ Failed: ${failed}\n`);

process.exit(failed > 0 ? 1 : 0);