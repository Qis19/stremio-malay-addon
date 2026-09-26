import assert from 'assert';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { makeMediaApp } from '../src/server.js';

// ---------- Setup ----------
const TEST_MEDIA_DIR = path.resolve('./data/test-media');
if (!fs.existsSync(TEST_MEDIA_DIR)) fs.mkdirSync(TEST_MEDIA_DIR, { recursive: true });

// Create test file
const TEST_FILE = path.join(TEST_MEDIA_DIR, 'test-video.mp4');
const TEST_CONTENT = Buffer.alloc(10 * 1024 * 1024, 'x'); // 10 MB fake file
fs.writeFileSync(TEST_FILE, TEST_CONTENT);

// Set env
process.env.MEDIA_DIR = TEST_MEDIA_DIR;

// Start server
const app = express();
app.use(makeMediaApp());
const server = app.listen(7999);

// ---------- Test framework ----------
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
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

// ---------- Helpers ----------
async function fetchUrl(url, headers = {}) {
  const res = await fetch(url, { headers });
  return res;
}

// ---------- Tests ----------
console.log('🧪 Running server tests...\n');

await test('Server starts and responds', async () => {
  const res = await fetchUrl(`http://localhost:7999/media?path=${encodeURIComponent(TEST_FILE)}`);
  assert.strictEqual(res.status, 200);
});

await test('Missing path → 400', async () => {
  const res = await fetchUrl('http://localhost:7999/media');
  assert.strictEqual(res.status, 400);
});

await test('File outside MEDIA_DIR → 403', async () => {
  const outsidePath = path.resolve('./test/watcher.test.js');
  const res = await fetchUrl(`http://localhost:7999/media?path=${encodeURIComponent(outsidePath)}`);
  assert.strictEqual(res.status, 403);
});

await test('Missing file → 404', async () => {
  const missing = path.join(TEST_MEDIA_DIR, 'nonexistent.mp4');
  const res = await fetchUrl(`http://localhost:7999/media?path=${encodeURIComponent(missing)}`);
  assert.strictEqual(res.status, 404);
});

await test('Full file request → 200', async () => {
  const res = await fetchUrl(`http://localhost:7999/media?path=${encodeURIComponent(TEST_FILE)}`);
  assert.strictEqual(res.status, 200);
  const buf = await res.arrayBuffer();
  assert.strictEqual(buf.byteLength, TEST_CONTENT.length);
});

await test('Range request → 206', async () => {
  const res = await fetchUrl(`http://localhost:7999/media?path=${encodeURIComponent(TEST_FILE)}`, {
    Range: 'bytes=0-1023'
  });
  assert.strictEqual(res.status, 206);
});

await test('Range response has correct Content-Range', async () => {
  const res = await fetchUrl(`http://localhost:7999/media?path=${encodeURIComponent(TEST_FILE)}`, {
    Range: 'bytes=0-1023'
  });
  const range = res.headers.get('content-range');
  assert.ok(range.startsWith('bytes 0-1023/'), `Got: ${range}`);
});

await test('Range response Content-Length is correct', async () => {
  const res = await fetchUrl(`http://localhost:7999/media?path=${encodeURIComponent(TEST_FILE)}`, {
    Range: 'bytes=0-1023'
  });
  assert.strictEqual(res.headers.get('content-length'), '1024');
});

await test('Accepts-Ranges header present', async () => {
  const res = await fetchUrl(`http://localhost:7999/media?path=${encodeURIComponent(TEST_FILE)}`);
  assert.strictEqual(res.headers.get('accept-ranges'), 'bytes');
});

// ---------- Cleanup ----------
server.close();
fs.unlinkSync(TEST_FILE);
fs.rmdirSync(TEST_MEDIA_DIR);

console.log(`\n📊 Results:`);
console.log(`  ✅ Passed: ${passed}`);
console.log(`  ❌ Failed: ${failed}\n`);

process.exit(failed > 0 ? 1 : 0);