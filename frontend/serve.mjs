// Optional local development server. Production can serve these static files
// alongside the agreed backend; this server does not implement recommendations.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be between 0 and 65535');
const target = process.env.BACKEND_URL ? new URL(process.env.BACKEND_URL) : null;
if (target && (!['http:', 'https:'].includes(target.protocol) || target.username || target.password
    || target.pathname !== '/' || target.search || target.hash)) {
  throw new Error('BACKEND_URL must be an http(s) origin without credentials, path or query');
}
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/view.mjs', ['view.mjs', 'text/javascript; charset=utf-8']],
  ['/api.mjs', ['api.mjs', 'text/javascript; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
]);
function json(res, status, data) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(data));
}
const serviceError = {error: {code: 'service_unavailable', message: 'Сервис подбора временно недоступен.'}};
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (!(url.pathname === '/api/meta' && req.method === 'GET')
          && !(url.pathname === '/api/recommendations' && req.method === 'POST')) {
        return json(res, 404, {error: {code: 'not_found', message: 'Маршрут не найден.'}});
      }
      if (!target) return json(res, 503, serviceError);
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
        return json(res, 403, {error: {code: 'forbidden', message: 'Запрос отклонён.'}});
      }
      const buffers = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 16384) return json(res, 413, {error: {code: 'invalid_request', message: 'Запрос слишком большой.'}});
        buffers.push(chunk);
      }
      const upstream = await fetch(new URL(url.pathname, target), {
        method: req.method,
        headers: {Accept: 'application/json', ...(req.method === 'POST' ? {'Content-Type': 'application/json'} : {})},
        ...(req.method === 'POST' ? {body: Buffer.concat(buffers)} : {}),
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      // Forward only the JSON API contract; never forward cookies/auth headers.
      if (!upstream.headers.get('content-type')?.includes('application/json')) return json(res, 503, serviceError);
      if (![200, 422].includes(upstream.status)) return json(res, 503, serviceError);
      return json(res, upstream.status, await upstream.json());
    }
    const file = files.get(url.pathname);
    if (!file || !['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      return res.end('Not found');
    }
    const content = await readFile(fileURLToPath(new URL(file[0], import.meta.url)));
    res.writeHead(200, {'Content-Type': file[1], 'Cache-Control': 'no-store'});
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    if (!res.headersSent) json(res, 503, serviceError);
    else res.end();
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Frontend: http://127.0.0.1:${server.address().port}`));
