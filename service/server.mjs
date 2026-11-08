import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { baseline, sha, sourceData, sourceNames, taxonomy } from './sources.mjs';
import { openLedger } from './ledger.mjs';
import { makeMcpHandler } from './bridge.mjs';

const runtime = process.env.CONTEXTLEDGER_RUNTIME;
const { privateKey, tokens } = JSON.parse(readFileSync(join(runtime, 'keys.json'), 'utf8'));
const ledger = openLedger(join(runtime, 'knowledge.sqlite'));
const manifests = baseline(ledger.anchor);
const destination = process.env.CONTEXTLEDGER_N8N_URL;
const identities = {
  employee: { id: 'general-employee', groups: ['employees'] },
  support: { id: 'support-owner', groups: ['employees', 'support'] },
  security: { id: 'security-owner', groups: ['employees', 'security'] },
  admin: { id: 'knowledge-admin', groups: ['employees', 'support', 'product', 'engineering', 'security', 'people'], admin: true }
};

function equal(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  return timingSafeEqual(Buffer.from(sha(left), 'hex'), Buffer.from(sha(right), 'hex'));
}
function identify(authorization) {
  for (const [role, token] of Object.entries(tokens)) {
    if (equal(authorization, 'Bearer ' + token)) return identities[role];
  }
  return null;
}
function send(response, status, data, type = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
async function readBody(request, maxBytes = 6_000_000) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBytes) throw new Error('Body limit exceeded');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
async function forward(route, authorization, body, method = 'POST') {
  try {
    const response = await fetch(destination + '/webhook/contextledger/' + route, {
      method,
      headers: { 'content-type': 'application/json', authorization: authorization || '' },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000)
    });
    // Suppress infrastructure errors that might expose workflow internals.
    if (response.status >= 500) return { status: 502, body: { status: 'workflow_unavailable' } };
    return { status: response.status, body: await response.json() };
  } catch {
    return { status: 502, body: { status: 'workflow_unavailable' } };
  }
}
const handleMcp = await makeMcpHandler(process.env.CONTEXTLEDGER_DEPS_DIR || runtime, identify, forward);
const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8']
};
const routes = new Map([
  ['POST /api/ingest', 'ingest'], ['POST /api/context', 'context'],
  ['GET /api/reviews', 'reviews'], ['POST /api/decision', 'decision'], ['POST /api/contribute', 'contribute'], ['POST /api/monitor', 'monitor']
]);
const guarded = (handler, fallback) => (request, response) => {
  handler(request, response).catch(error => {
    console.error(fallback, error.name);
    if (!response.headersSent) send(response, 500, { status: fallback });
    else response.end();
  });
};
const internal = createServer(guarded(async (request, response) => {
  if (!equal(request.headers['x-ledger-key'], privateKey)) return send(response, 403, { status: 'denied' });
  const url = new URL(request.url, 'http://ledger');
  if (request.method === 'GET' && url.pathname.startsWith('/feed/')) {
    const system = url.pathname.slice('/feed/'.length);
    if (!sourceNames.includes(system)) return send(response, 404, { status: 'unknown_source' });
    const scenario = url.searchParams.get('scenario');
    if (scenario === 'outage-' + system) return send(response, 503, { status: 'upstream_unavailable' });
    return send(response, 200, sourceData(ledger.anchor, system, scenario));
  }
  if (request.method !== 'POST') return send(response, 404, { status: 'unknown_route' });
  const body = await readBody(request);
  if (url.pathname === '/snapshot') {
    const actor = body.system === true ? { id: 'ledger-scheduler', admin: true } : identify(body.authorization);
    if (!actor) return send(response, 200, { actor: null });
    if (body.adminOnly && !actor.admin) return send(response, 200, { actor, denied: true });
    return send(response, 200, { actor, taxonomy, manifests, ...ledger.snapshot() });
  }
  if (url.pathname === '/commit') {
    const committed = ledger.commit(body.revision, body.writes);
    return send(response, 200, { committed });
  }
  return send(response, 404, { status: 'unknown_route' });
}, 'storage_unavailable'));

const publicServer = createServer(guarded(async (request, response) => {
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(request.headers.host || '')) {
    return send(response, 403, { status: 'host_denied' });
  }
  if (request.headers.origin) {
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (origin !== 'http://' + host) return send(response, 403, { status: 'origin_denied' });
  }
  const path = new URL(request.url, 'http://ledger').pathname;
  if (request.method === 'GET' && Object.hasOwn(files, path)) {
    const [name, type] = files[path];
    response.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    return send(response, 200, readFileSync(new URL('../ui/' + name, import.meta.url)), type);
  }
  if (path === '/mcp') {
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST');
      return send(response, 405, { status: 'method_not_allowed' });
    }
    return handleMcp(request, response, await readBody(request, 32000));
  }
  const route = routes.get(request.method + ' ' + path);
  if (!route) return send(response, 404, { status: 'unknown_route' });
  const result = await forward(route, request.headers.authorization,
    request.method === 'POST' ? await readBody(request, 32000) : undefined, request.method);
  return send(response, result.status, result.body);
}, 'gateway_unavailable'));
internal.listen(Number(process.env.CONTEXTLEDGER_INTERNAL_PORT), process.env.CONTEXTLEDGER_BIND || '127.0.0.1');
publicServer.listen(Number(process.env.CONTEXTLEDGER_UI_PORT), process.env.CONTEXTLEDGER_BIND || '127.0.0.1');
