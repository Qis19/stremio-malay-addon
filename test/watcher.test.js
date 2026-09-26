import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  startSession,
  updateProgress,
  finalizeSession,
  getWatchLog,
  logClick
} from '../src/watcher.js';

const TEST_FILE = path.resolve('./data/test-sample.bin');
const WATCH_LOG = path.resolve('./data/watch-log.json');

let backup = null;
if (fs.existsSync(WATCH_LOG)) {
  backup = fs.readFileSync(WATCH_LOG, 'utf8');
}

if (!fs.existsSync(TEST_FILE)) {
  fs.writeFileSync(TEST_FILE, Buffer.alloc(1024));
}

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

console.log('🧪 Running watcher tests...\n');

section('Session Lifecycle');

test('startSession creates a session', () => {
  fs.writeFileSync(WATCH_LOG, JSON.stringify({ plays: [], clicks: [] }, null, 2));
  startSession(
    { id: 'test:movie:1', name: 'Test Movie', type: 'movie', year: '2024' },
    TEST_FILE
  );
});

test('updateProgress tracks bytes', () => {
  updateProgress(1000);
  updateProgress(2000);
});

test('finalizeSession logs to watch-log', () => {
  finalizeSession();
  const log = getWatchLog();
  assert.strictEqual(log.plays.length, 1);
  assert.strictEqual(log.plays[0].id, 'test:movie:1');
});

section('Completion Detection');

test('Short session → barely-started', () => {
  fs.writeFileSync(WATCH_LOG, JSON.stringify({ plays: [], clicks: [] }, null, 2));
  startSession({ id: 'test:movie:2', name: 'Quick Watch', type: 'movie' }, TEST_FILE);
  updateProgress(50);
  finalizeSession();
  const log = getWatchLog();
  const entry = log.plays.find(p => p.id === 'test:movie:2');
  assert.ok(entry);
  assert.strictEqual(entry.status, 'barely-started');
});

section('Merge Behavior');

test('Same episode played twice merges into one entry', () => {
  fs.writeFileSync(WATCH_LOG, JSON.stringify({ plays: [], clicks: [] }, null, 2));

  // First play
  startSession(
    { id: 'test:series:1:S01E01', name: 'Test Series', type: 'series', season: 1, episode: 1 },
    TEST_FILE
  );
  updateProgress(500);
  finalizeSession();

  // Second play same episode
  startSession(
    { id: 'test:series:1:S01E01', name: 'Test Series', type: 'series', season: 1, episode: 1 },
    TEST_FILE
  );
  updateProgress(600);
  finalizeSession();

  const log = getWatchLog();
  assert.strictEqual(log.plays.length, 1, 'Should have 1 merged entry');
  assert.strictEqual(log.plays[0].watchCount, 2, 'watchCount should be 2');
});

section('Click Logging');

test('logClick adds a click entry', () => {
  fs.writeFileSync(WATCH_LOG, JSON.stringify({ plays: [], clicks: [] }, null, 2));
  logClick({ id: 'test:movie:4', name: 'Click Test', type: 'movie', year: '2024' });
  const log = getWatchLog();
  assert.strictEqual(log.clicks.length, 1);
});

test('logClick dedups within 60 seconds', () => {
  fs.writeFileSync(WATCH_LOG, JSON.stringify({ plays: [], clicks: [] }, null, 2));
  logClick({ id: 'test:movie:5', name: 'Dedup Test', type: 'movie' });
  logClick({ id: 'test:movie:5', name: 'Dedup Test', type: 'movie' });
  const log = getWatchLog();
  assert.strictEqual(log.clicks.length, 1);
});

// Cleanup
if (backup) {
  fs.writeFileSync(WATCH_LOG, backup);
  console.log('\n🧹 Restored original log');
}

console.log(`\n📊 Results:`);
console.log(`  ✅ Passed: ${passed}`);
console.log(`  ❌ Failed: ${failed}`);
console.log('');

process.exit(failed > 0 ? 1 : 0);