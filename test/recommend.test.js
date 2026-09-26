import 'dotenv/config';
import { buildIndex, library } from '../src/scanner.js';
import {
  getTasteProfile,
  getTopPicks,
  getBecauseYouWatched
} from '../src/recommend.js';
import { getWatchLog } from '../src/watcher.js';

let passed = 0;
let failed = 0;

function section(name) {
  console.log(`\n📋 ${name}`);
}

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function info(name, value) {
  console.log(`     ${name}: ${JSON.stringify(value)}`);
}

console.log('🧪 Running recommendation tests...\n');

// ---------- Setup ----------
section('Setup');
buildIndex();
check('Library loaded', library.size > 0, `size=${library.size}`);
info('Library size', library.size);

const log = getWatchLog();
check('Watch log accessible', log && Array.isArray(log.plays));
info('Total plays', log.plays?.length || 0);

// ---------- Environment ----------
section('Environment');
check('TMDB_API_KEY set', !!process.env.TMDB_API_KEY);

// ---------- Taste Profile ----------
section('Taste Profile');
const profile = await getTasteProfile();
info('totalPlays', profile.totalPlays);
info('genres', profile.genres);
info('years', profile.years);

check('Profile has plays', profile.totalPlays > 0, `got ${profile.totalPlays}`);
check('Profile has genres', profile.genres.length > 0, `got ${profile.genres.length}`);

// ---------- Top Picks ----------
section('Top Picks (movies)');
const topPicks = await getTopPicks('movie', 10);
info('count', topPicks.length);

check('Top Picks returns array', Array.isArray(topPicks));
check('Top Picks has items', topPicks.length > 0, `got ${topPicks.length}`);

if (topPicks.length > 0) {
  const first = topPicks[0];
  info('first item', first.name);
  check('Items have id', !!first.id);
  check('Items have name', !!first.name);
  check('Items have type', !!first.type);
}

// ---------- Because You Watched ----------
section('Because You Watched');
const because = await getBecauseYouWatched(10);
info('basedOn', because.basedOn);
info('count', because.items?.length || 0);

check('Returns object', because && typeof because === 'object');
check('Has basedOn field', because.basedOn !== undefined);
check('Has items array', Array.isArray(because.items));

// ---------- Summary ----------
console.log(`\n📊 Results:`);
console.log(`  ✅ Passed: ${passed}`);
console.log(`  ❌ Failed: ${failed}\n`);

process.exit(failed > 0 ? 1 : 0);