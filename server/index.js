import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from './api.js';
import * as onb from './onboarding.js';
import * as baileys from './whatsapp.js';
import * as evolution from './evolution.js';
import * as pausas from './pausas.js';

// Com a Evolution configurada, a tela do WhatsApp lê da instância dela; sem ela, usa o QR code.
const whats = evolution.configurado ? evolution : baileys;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const PORT = Number(process.env.PORT ?? 3000);
const TOKEN = process.env.CRM_TOKEN ?? '';

const MIME = {
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.webp': 'image/webp',
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

// Entrada de mensagens e decisões do agente: protegida por token quando CRM_TOKEN estiver definido.
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

    // Pausa do agente por grupo (a franquia percebeu que é robô).
    if (pathname.startsWith('/api/agent/')) {
      const acao = pathname.slice('/api/agent/'.length);
      // Tela do CRM: ver e reativar.
      if (acao === 'pausas' && req.method === 'GET') return send(res, 200, pausas.listarPausas());
      if (acao === 'pausas/retomar' && req.method === 'POST') {
        const body = await readJson(req);
        return send(res, 200, pausas.retomar(body.group_id, { por: body.actor ?? 'Guilherme' }));
      }
      // Fluxo do agente (n8n): protegido pelo token.
      const doFluxo = ['pausa', 'envio', 'mensagem-do-guilherme', 'contexto'];
      if (doFluxo.includes(acao) && !webhookAuthorized(req)) return send(res, 401, { error: 'Token inválido.' });
      if (acao === 'contexto' && req.method === 'GET') return send(res, 200, pausas.contextoDoGrupo(q.group_id));
      if (acao === 'pausa' && req.method === 'GET') return send(res, 200, pausas.pausaDoGrupo(q.group_id));
      if (acao === 'pausa' && req.method === 'POST') return send(res, 200, pausas.pausar(await readJson(req)));
      if (acao === 'envio' && req.method === 'POST') return send(res, 200, pausas.registrarEnvio(await readJson(req)));
      if (acao === 'mensagem-do-guilherme' && req.method === 'POST') return send(res, 200, pausas.mensagemDoGuilherme(await readJson(req)));
    }

    // Fila do agente: mensagens que ainda esperam uma decisão.
    if (pathname === '/api/agent/queue' && req.method === 'GET') {
      if (!webhookAuthorized(req)) return send(res, 401, { error: 'Token inválido.' });
      return send(res, 200, api.listMessages({ ...q, aguardando_agente: '1', sort: q.sort ?? 'recente' }));
    }

    if (pathname === '/api/health') return send(res, 200, { ok: true });
    // Logo da abelha: o GIF animado tem prioridade; sem ele, vale a arte parada.
    if (pathname === '/api/marca' && req.method === 'GET') {
      const existe = (nome) => access(join(publicDir, 'assets', nome)).then(() => true, () => false);
      if (await existe('abelha.gif')) return send(res, 200, { abelha: '/assets/abelha.gif', animada: true });
      for (const nome of ['abelha.webp', 'abelha.png']) {
        if (await existe(nome)) return send(res, 200, { abelha: `/assets/${nome}`, animada: false });
      }
      return send(res, 200, { abelha: null, animada: false });
    }
    if (pathname === '/api/onboarding/meta' && req.method === 'GET') return send(res, 200, onb.onboardingMeta);
    if (pathname === '/api/onboarding/stats' && req.method === 'GET') return send(res, 200, onb.onboardingStats(q));

    if (pathname === '/api/onboarding') {
      if (req.method === 'GET') return send(res, 200, onb.listOnboardings(q));
      if (req.method === 'POST') return send(res, 201, onb.createOnboarding(await readJson(req)));
    }

    // Entrada automática: um grupo novo no WhatsApp do CS vira um onboarding.
    if (pathname === '/api/onboarding/whatsapp-group' && req.method === 'POST') {
      if (!webhookAuthorized(req)) return send(res, 401, { error: 'Token inválido.' });
      return send(res, 201, onb.fromWhatsappGroup(await readJson(req)));
    }

    // Conexão com o WhatsApp do CS: Evolution API ou leitura de QR code.
    if (pathname.startsWith('/api/whatsapp/')) {
      const acao = pathname.slice('/api/whatsapp/'.length);
      // Eventos de grupo vindos da Evolution. O token pode vir no cabeçalho ou em ?token=.
      if (acao === 'evolution-webhook' && req.method === 'POST') {
        if (!evolution.configurado) return send(res, 404, { error: 'A Evolution não está configurada.' });
        if (TOKEN && !webhookAuthorized(req) && q.token !== TOKEN) return send(res, 401, { error: 'Token inválido.' });
        return send(res, 200, await evolution.receberEvento(await readJson(req)));
      }
      if (acao === 'status' && req.method === 'GET') return send(res, 200, await whats.status());
      if (acao === 'conectar' && req.method === 'POST') return send(res, 200, await whats.conectar());
      if (acao === 'desconectar' && req.method === 'POST') return send(res, 200, await whats.desconectar());
      if (acao === 'grupos' && req.method === 'GET') return send(res, 200, whats.listarGrupos());
      if (acao === 'importar' && req.method === 'POST') {
        const body = await readJson(req);
        return send(res, 200, await whats.importar(body.grupos));
      }
      if (acao === 'simular-leitura' && req.method === 'POST') return send(res, 200, await whats.simularLeitura());
      if (acao === 'simular-grupo-novo' && req.method === 'POST') {
        const body = await readJson(req);
        return send(res, 200, await whats.simularGrupoNovo(body.nome ?? 'Grupo novo'));
      }
      return send(res, 404, { error: 'Rota não encontrada.' });
    }

    const onbMatch = pathname.match(/^\/api\/onboarding\/(\d+)(?:\/(stage|activities|tasks\/[a-z_]+))?$/);
    if (onbMatch) {
      const id = Number(onbMatch[1]);
      const sub = onbMatch[2];
      if (sub === 'stage' && req.method === 'POST') {
        const body = await readJson(req);
        return send(res, 200, onb.moveStage(id, body.stage, { actor: body.actor ?? 'Guilherme' }));
      }
      if (sub === 'activities' && req.method === 'GET') return send(res, 200, onb.onboardingActivities(id));
      if (sub?.startsWith('tasks/') && req.method === 'PATCH') {
        return send(res, 200, onb.setTask(id, sub.slice(6), await readJson(req)));
      }
      if (!sub) {
        if (req.method === 'GET') return send(res, 200, onb.getOnboarding(id));
        if (req.method === 'PATCH') return send(res, 200, onb.updateOnboarding(id, await readJson(req)));
        if (req.method === 'DELETE') return send(res, 200, onb.deleteOnboarding(id));
      }
    }
    if (pathname === '/api/meta' && req.method === 'GET') return send(res, 200, api.meta);
    if (pathname === '/api/dashboard' && req.method === 'GET') return send(res, 200, api.dashboard(q));

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
        if (sub === '/agent' && req.method === 'POST') {
          if (!webhookAuthorized(req)) return send(res, 401, { error: 'Token inválido.' });
          return send(res, 200, api.applyAgentDecision(id, await readJson(req)));
        }
        if (sub === '/feedback' && req.method === 'POST') {
          return send(res, 200, api.setHumanFeedback(id, await readJson(req)));
        }
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
  whats.retomarSessao();
});
