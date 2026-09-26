import 'dotenv/config';
import express from 'express';
import sdk from 'stremio-addon-sdk';
import { buildIndex, watchFolder } from './scanner.js';
import { builder } from './addon.js';
import { makeMediaApp } from './server.js';
import { watchInbox } from './organizer.js';

const { getRouter } = sdk;
const PORT = process.env.PORT || 7000;

// 1. Index existing library files
buildIndex();

// 2. Watch library folder for changes
watchFolder();

// 3. Watch inbox and auto-organize
watchInbox();

// 4. Auto-import from NuviSync every 30 minutes
setTimeout(() => {
  runNuviSyncImport();
  setInterval(runNuviSyncImport, 10 * 60 * 1000);
}, 10 * 1000); // start 30 sec after boot, then every 30 min

async function runNuviSyncImport() {
  try {
    const { exec } = await import('child_process');
    const startTime = new Date().toISOString();
    exec(
      'node test/nuviosync-import.js',
      { cwd: process.cwd() },
      (err, stdout) => {
        if (err) {
          console.log(`[nuviosync] ${startTime} — ERROR: ${err.message}`);
          return;
        }
        const match = stdout.match(/"stats":(\{.*?\})/);
        console.log(`[nuviosync] ${startTime} — done`);
        if (match) {
          try {
            const stats = JSON.parse(match[1]);
            console.log(
              `[nuviosync] movies:+${stats.moviesAdded} shows:+${stats.showsAdded} ` +
              `eps:+${stats.historyEpisodes} skipped:${stats.skippedExisting}`
            );
          } catch {
            console.log(`[nuviosync] stats: ${match[1].slice(0, 200)}`);
          }
        }
      }
    );
  } catch (err) {
    console.log('[nuviosync] error:', err.message);
  }
}

// 5. Server
const app = express();
app.use(getRouter(builder.getInterface()));
app.use(makeMediaApp());

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Local Malay addon running`);
  console.log(`   Manifest: http://localhost:${PORT}/manifest.json`);
  console.log(`   Inbox:    ${process.env.INBOX_DIR}`);
  console.log(`   Library:  ${process.env.MEDIA_DIR}`);
  console.log(`   NuviSync auto-import: every 30 minutes\n`);
});