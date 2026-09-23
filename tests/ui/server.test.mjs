import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Synthetic upstream for HTTP integration tests only; not a recommendation engine.
const received = [];
const backend = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  received.push({path: req.url, method: req.method, headers: req.headers, body});
  res.writeHead(200, {'Content-Type': 'application/json', 'Set-Cookie': 'test-only=1'});
  res.end(JSON.stringify({testOnly: true}));
});
await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
const backendUrl = `http://127.0.0.1:${backend.address().port}`;

async function launch(target) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../frontend/serve.mjs', import.meta.url))], {
    env: {SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, PORT: '0', ...(target ? {BACKEND_URL: target} : {})},
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {child.kill(); reject(new Error('Frontend did not start'));}, 5000);
    child.once('error', error => {clearTimeout(timeout); reject(error);});
    child.once('exit', code => {clearTimeout(timeout); reject(new Error(`Frontend exited ${code}`));});
    child.stdout.on('data', data => {
      const found = String(data).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (found) {clearTimeout(timeout); resolve(found[0]);}
    });
  });
  return {child, url};
}

try {
  await test('local server exposes only static assets and the two agreed API routes', async () => {
    const {child, url} = await launch(backendUrl);
    try {
      const page = await fetch(url);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /id="app"/);
      assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
      assert.equal((await fetch(`${url}/AGENTS.md`)).status, 404);
      assert.equal((await fetch(`${url}/.env`)).status, 404);
      assert.equal((await fetch(`${url}/api/anything-else`)).status, 404);
      const proxied = await fetch(`${url}/api/recommendations`, {
        method: 'POST', headers: {'Content-Type': 'application/json', Cookie: 'test-secret=do-not-forward', Authorization: 'Bearer test-only-do-not-forward'},
        body: JSON.stringify({city: 'Алматы'}),
      });
      assert.equal(proxied.status, 200);
      assert.deepEqual(await proxied.json(), {testOnly: true});
      assert.equal(proxied.headers.get('set-cookie'), null);
      assert.equal(received.at(-1).path, '/api/recommendations');
      assert.equal(received.at(-1).headers.cookie, undefined);
      assert.equal(received.at(-1).headers.authorization, undefined);
      assert.deepEqual(JSON.parse(received.at(-1).body), {city: 'Алматы'});
      const rejected = await fetch(`${url}/api/recommendations`, {method: 'POST', headers: {Origin: 'https://unrelated.example'}, body: '{}'});
      assert.equal(rejected.status, 403);
    } finally {child.kill();}
  });
  await test('missing backend gives 503; no synthetic successful application results', async () => {
    const {child, url} = await launch();
    try {
      const res = await fetch(`${url}/api/meta`);
      assert.equal(res.status, 503);
      assert.equal((await res.json()).error.code, 'service_unavailable');
    } finally {child.kill();}
  });
} finally {backend.close();}
