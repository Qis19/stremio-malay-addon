import 'dotenv/config';

const STREMIO_AUTH_KEY = process.env.STREMIO_AUTH_KEY;
const SIMKL_ACCESS_TOKEN = process.env.SIMKL_ACCESS_TOKEN;

async function importToSimkl() {
  console.log('Testing NuviSync API...');
  console.log('Auth key length:', STREMIO_AUTH_KEY?.length);
  console.log('SIMKL token length:', SIMKL_ACCESS_TOKEN?.length);

  const res = await fetch('https://nuviosync.com/api/simkl/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'stremio',
      simklAccessToken: SIMKL_ACCESS_TOKEN,
      authKey: STREMIO_AUTH_KEY,
      includeHistory: true
    })
  });

  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text.slice(0, 1000));
}

importToSimkl().catch(console.error);