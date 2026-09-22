import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from './api.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const PORT = Number(process.env.PORT ?? 3000);
const TOKEN = process.env.CRM_TOKEN ?? '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw Object.assign(new Error('Corpo da requisição muito grande.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSON inválido.'), { status: 400 });
  }
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\//, '');
  const file = join(publicDir, rel);
  if (!file.startsWith(publicDir)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
  }
}

// Webhook de entrada: protegido por token quando CRM_TOKEN estiver definido.
function webhookAuthorized(req) {
  if (!TOKEN) return true;
  const header = req.headers.authorization ?? '';
  return header === `Bearer ${TOKEN}` || req.headers['x-crm-token'] === TOKEN;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const { pathname } = url;
  const q = Object.fromEntries(url.searchParams);

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  try {
    const idMatch = pathname.match(/^\/api\/(messages|contacts)\/(\d+)(\/[a-z]+)?$/);

    if (pathname === '/api/health') return send(res, 200, { ok: true });
    if (pathname === '/api/meta' && req.method === 'GET') return send(res, 200, api.meta);
    if (pathname === '/api/dashboard' && req.method === 'GET') return send(res, 200, api.dashboard());

    if (pathname === '/api/messages') {
      if (req.method === 'GET') return send(res, 200, api.listMessages(q));
      if (req.method === 'POST') {
        if (!webhookAuthorized(req)) return send(res, 401, { error: 'Token inválido.' });
        return send(res, 201, api.createMessage(await readJson(req)));
      }
    }

    if (pathname === '/api/contacts') {
      if (req.method === 'GET') return send(res, 200, api.listContacts(q));
      if (req.method === 'POST') return send(res, 201, api.createContact(await readJson(req)));
    }

    if (idMatch) {
      const [, kind, rawId, sub] = idMatch;
      const id = Number(rawId);
      if (kind === 'messages') {
        if (sub === '/activities' && req.method === 'GET') return send(res, 200, api.messageActivities(id));
        if (sub === '/rescore' && req.method === 'POST') return send(res, 200, api.rescoreMessage(id));
        if (sub) return send(res, 404, { error: 'Rota não encontrada.' });
        if (req.method === 'GET') return send(res, 200, api.getMessage(id));
        if (req.method === 'PATCH') return send(res, 200, api.updateMessage(id, await readJson(req)));
        if (req.method === 'DELETE') return send(res, 200, api.deleteMessage(id));
      } else {
        if (sub) return send(res, 404, { error: 'Rota não encontrada.' });
        if (req.method === 'GET') return send(res, 200, api.getContact(id));
        if (req.method === 'PATCH') return send(res, 200, api.updateContact(id, await readJson(req)));
        if (req.method === 'DELETE') return send(res, 200, api.deleteContact(id));
      }
    }

    return send(res, 404, { error: 'Rota não encontrada.' });
  } catch (err) {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    return send(res, status, { error: err.message ?? 'Erro interno.' });
  }
});

server.listen(PORT, () => {
  console.log(`CRM 7Bee rodando em http://localhost:${PORT}`);
});
