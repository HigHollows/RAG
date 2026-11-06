'use strict';
// API HTTP locale (127.0.0.1 uniquement, jeton obligatoire). POST /api/<méthode> avec un corps JSON {"args":[...]}.

const http = require('http');
const crypto = require('crypto');
const { METHODS } = require('./methods');

function startHttp(core, port) {
  const server = http.createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    const token = core.config.data.server.token;
    const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const ok = given.length === token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
    if (!ok) return send(401, { error: { code: 'unauthorized', message: 'Jeton invalide' } });
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/health') return send(200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/api/openapi.json') {
      return send(200, { openapi: '3.0.0', info: { title: 'GraphRAG Studio API', version: '1.0.0' }, servers: [{ url: `http://127.0.0.1:${port}` }], components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } }, security: [{ bearer: [] }], paths: Object.fromEntries(Object.keys(METHODS).filter((m) => METHODS[m].http !== false).map((m) => [`/api/${m}`, { post: { summary: m, requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { args: { type: 'array' } } } } } }, responses: { 200: { description: 'OK' } } } }])) });
    }
    const m = /^\/api\/([a-zA-Z]+)$/.exec(url.pathname);
    if (req.method !== 'POST' || !m || !METHODS[m[1]] || METHODS[m[1]].http === false) return send(404, { error: { code: 'not_found', message: 'Route inconnue' } });
    let body = '';
    for await (const c of req) { body += c; if (body.length > 2e6) return send(413, { error: { code: 'too_large', message: 'Corps trop volumineux' } }); }
    try {
      const args = body ? JSON.parse(body).args || [] : [];
      send(200, { result: await METHODS[m[1]].run(core, ...args) });
    } catch (e) {
      send(400, { error: { code: 'bad_request', message: e.message } });
    }
  });
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { startHttp };
