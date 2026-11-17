// Uploads the footage, music and logo to Shotstack's Ingest API, which hosts them at public URLs
// the template can use. Saves the URLs in assets.json.
// Usage: node setup-assets.js
const fs = require('fs');
const path = require('path');
const { INGEST_API, api, sleep } = require('./shotstack');

const FILES = { footage: 'footage.mp4', music: 'music.mp3', logo: 'logo.png' };
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

async function upload(file) {
  // 1. Ask Ingest for a signed upload URL.
  const { data } = await api('POST', `${INGEST_API}/upload`);
  // 2. PUT the file to that URL.
  let res;
  try {
    res = await fetch(data.attributes.url, {
      method: 'PUT',
      body: fs.readFileSync(file),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
    });
  } catch {
    throw new Error(
      `Uploading ${path.basename(file)} failed. Check your network connection and run the script again.`
    );
  }
  if (!res.ok)
    throw new Error(
      `Uploading ${path.basename(file)} failed: HTTP ${res.status}`
    );
  // 3. Wait until Ingest has stored it, then return its URL.
  for (let attempt = 0; attempt < 60; attempt++) {
    const source = await api('GET', `${INGEST_API}/sources/${data.id}`);
    const { status, source: url } = source.data.attributes;
    if (status === 'ready') return url;
    if (status === 'failed')
      throw new Error(`Ingest couldn't process ${path.basename(file)}.`);
    await sleep(5000);
  }
  throw new Error(`${path.basename(file)} wasn't ready after 5 minutes.`);
}

async function main() {
  for (const file of Object.values(FILES)) {
    if (!fs.existsSync(path.join(__dirname, file))) {
      throw new Error(`Can't find ${file} next to this script.`);
    }
  }
  const assets = {};
  for (const [name, file] of Object.entries(FILES)) {
    console.log(`Uploading ${file}...`);
    assets[name] = await upload(path.join(__dirname, file));
    console.log(`  ${assets[name]}`);
  }
  fs.writeFileSync(
    path.join(__dirname, 'assets.json'),
    JSON.stringify(assets, null, 2)
  );
  console.log('Saved the URLs to assets.json');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
