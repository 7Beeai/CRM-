import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from './api.js';
import * as onb from './onboarding.js';
import * as baileys from './whatsapp.js';
import * as evolution from './evolution.js';
import * as pausas from './pausas.js';
import { verificarBanco } from './db.js';
import * as auth from './auth.js';

// Com a Evolution configurada, a tela do WhatsApp lê da instância dela; sem ela, usa o QR code.
const whats = evolution.configurado ? evolution : baileys;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const PORT = Number(process.env.PORT ?? 3000);
const TOKEN = process.env.CRM_TOKEN ?? '';
// Responsável padrão quando a ação não vem de um usuário logado (agente, importação).
const CS_PADRAO = process.env.CRM_CS_PADRAO ?? 'Guilherme';

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

// Corpo JSON com o ator preso ao usuário logado: o navegador não escolhe em nome de quem age.
async function lerCorpo(req) {
  const body = await readJson(req);
  if (req.usuario && body && typeof body === 'object') body.actor = req.usuario.nome;
  return body;
}

const PUBLICAS = new Set(['/api/health', '/api/config', '/api/marca']);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const { pathname } = url;
  const q = Object.fromEntries(url.searchParams);

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  try {
    // Quem chama: o agente (CRM_TOKEN) ou uma pessoa logada (Supabase Auth).
    // Rotas públicas não exigem nada; as do agente conferem o token adiante, como antes.
    req.usuario = null;
    const doAgente = Boolean(TOKEN) && webhookAuthorized(req);
    if (!PUBLICAS.has(pathname) && !doAgente) req.usuario = await auth.usuarioDoPedido(req);

    if (pathname === '/api/config' && req.method === 'GET') return send(res, 200, auth.configPublica());
    if (pathname === '/api/eu' && req.method === 'GET') return send(res, 200, req.usuario);
    if (pathname === '/api/eu' && req.method === 'PATCH') {
      if (!req.usuario) return send(res, 401, { error: 'Entre no CRM para continuar.' });
      return send(res, 200, await auth.atualizarNome(req.usuario.id, (await readJson(req)).nome));
    }
    if (pathname === '/api/usuarios' && req.method === 'GET') return send(res, 200, await auth.listarEquipe());

    const idMatch = pathname.match(/^\/api\/(messages|contacts)\/(\d+)(\/[a-z]+)?$/);

    // Pausa do agente por grupo (a franquia percebeu que é robô).
    if (pathname.startsWith('/api/agent/')) {
      const acao = pathname.slice('/api/agent/'.length);
      // Tela do CRM: ver e reativar.
      if (acao === 'pausas' && req.method === 'GET') return send(res, 200, await pausas.listarPausas());
      if (acao === 'pausas/retomar' && req.method === 'POST') {
        const body = await lerCorpo(req);
        return send(res, 200, await pausas.retomar(body.group_id, { por: body.actor ?? CS_PADRAO }));
      }
      // Fluxo do agente (n8n): protegido pelo token.
      const doFluxo = ['pausa', 'envio', 'mensagem-do-guilherme', 'contexto'];
      if (doFluxo.includes(acao) && !webhookAuthorized(req)) return send(res, 401, { error: 'Token inválido.' });
      if (acao === 'contexto' && req.method === 'GET') return send(res, 200, await pausas.contextoDoGrupo(q.group_id));
      if (acao === 'pausa' && req.method === 'GET') return send(res, 200, await pausas.pausaDoGrupo(q.group_id));
      if (acao === 'pausa' && req.method === 'POST') return send(res, 200, await pausas.pausar(await lerCorpo(req)));
      if (acao === 'envio' && req.method === 'POST') return send(res, 200, await pausas.registrarEnvio(await lerCorpo(req)));
      if (acao === 'mensagem-do-guilherme' && req.method === 'POST') return send(res, 200, await pausas.mensagemDoGuilherme(await lerCorpo(req)));
    }

    // Fila do agente: mensagens que ainda esperam uma decisão.
    if (pathname === '/api/agent/queue' && req.method === 'GET') {
      if (!webhookAuthorized(req)) return send(res, 401, { error: 'Token inválido.' });
      return send(res, 200, await api.listMessages({ ...q, aguardando_agente: '1', sort: q.sort ?? 'recente' }));
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
    if (pathname === '/api/onboarding/stats' && req.method === 'GET') return send(res, 200, await onb.onboardingStats(q));

    if (pathname === '/api/onboarding') {
      if (req.method === 'GET') return send(res, 200, await onb.listOnboardings(q));
      if (req.method === 'POST') return send(res, 201, await onb.createOnboarding(await lerCorpo(req)));
    }

    // Entrada automática: um grupo novo no WhatsApp do CS vira um onboarding.
    if (pathname === '/api/onboarding/whatsapp-group' && req.method === 'POST') {
      if (!webhookAuthorized(req)) return send(res, 401, { error: 'Token inválido.' });
      return send(res, 201, await onb.fromWhatsappGroup(await lerCorpo(req)));
    }

    // Conexão com o WhatsApp do CS: Evolution API ou leitura de QR code.
    if (pathname.startsWith('/api/whatsapp/')) {
      const acao = pathname.slice('/api/whatsapp/'.length);
      // Eventos de grupo vindos da Evolution. O token pode vir no cabeçalho ou em ?token=.
      if (acao === 'evolution-webhook' && req.method === 'POST') {
        if (!evolution.configurado) return send(res, 404, { error: 'A Evolution não está configurada.' });
        if (TOKEN && !webhookAuthorized(req) && q.token !== TOKEN) return send(res, 401, { error: 'Token inválido.' });
        return send(res, 200, await evolution.receberEvento(await lerCorpo(req)));
      }
      if (acao === 'status' && req.method === 'GET') return send(res, 200, await whats.status());
      if (acao === 'conectar' && req.method === 'POST') return send(res, 200, await whats.conectar());
      if (acao === 'desconectar' && req.method === 'POST') return send(res, 200, await whats.desconectar());
      if (acao === 'grupos' && req.method === 'GET') return send(res, 200, await whats.listarGrupos());
      if (acao === 'importar' && req.method === 'POST') {
        const body = await lerCorpo(req);
        return send(res, 200, await whats.importar(body.grupos));
      }
      if (acao === 'simular-leitura' && req.method === 'POST') return send(res, 200, await whats.simularLeitura());
      if (acao === 'simular-grupo-novo' && req.method === 'POST') {
        const body = await lerCorpo(req);
        return send(res, 200, await whats.simularGrupoNovo(body.nome ?? 'Grupo novo'));
      }
      return send(res, 404, { error: 'Rota não encontrada.' });
    }

    const onbMatch = pathname.match(/^\/api\/onboarding\/(\d+)(?:\/(stage|activities|tasks\/[a-z_]+))?$/);
    if (onbMatch) {
      const id = Number(onbMatch[1]);
      const sub = onbMatch[2];
      if (sub === 'stage' && req.method === 'POST') {
        const body = await lerCorpo(req);
        return send(res, 200, await onb.moveStage(id, body.stage, { actor: body.actor ?? CS_PADRAO }));
      }
      if (sub === 'activities' && req.method === 'GET') return send(res, 200, await onb.onboardingActivities(id));
      if (sub?.startsWith('tasks/') && req.method === 'PATCH') {
        return send(res, 200, await onb.setTask(id, sub.slice(6), await lerCorpo(req)));
      }
      if (!sub) {
        if (req.method === 'GET') return send(res, 200, await onb.getOnboarding(id));
        if (req.method === 'PATCH') return send(res, 200, await onb.updateOnboarding(id, await lerCorpo(req)));
        if (req.method === 'DELETE') return send(res, 200, await onb.deleteOnboarding(id));
      }
    }
    if (pathname === '/api/meta' && req.method === 'GET') return send(res, 200, api.meta);
    if (pathname === '/api/dashboard' && req.method === 'GET') return send(res, 200, await api.dashboard(q));

    if (pathname === '/api/messages') {
      if (req.method === 'GET') return send(res, 200, await api.listMessages(q));
      if (req.method === 'POST') {
        if (!webhookAuthorized(req)) return send(res, 401, { error: 'Token inválido.' });
        return send(res, 201, await api.createMessage(await lerCorpo(req)));
      }
    }

    if (pathname === '/api/contacts') {
      if (req.method === 'GET') return send(res, 200, await api.listContacts(q));
      if (req.method === 'POST') return send(res, 201, await api.createContact(await lerCorpo(req)));
    }

    if (idMatch) {
      const [, kind, rawId, sub] = idMatch;
      const id = Number(rawId);
      if (kind === 'messages') {
        if (sub === '/activities' && req.method === 'GET') return send(res, 200, await api.messageActivities(id));
        if (sub === '/rescore' && req.method === 'POST') return send(res, 200, await api.rescoreMessage(id));
        if (sub === '/agent' && req.method === 'POST') {
          if (!webhookAuthorized(req)) return send(res, 401, { error: 'Token inválido.' });
          return send(res, 200, await api.applyAgentDecision(id, await lerCorpo(req)));
        }
        if (sub === '/feedback' && req.method === 'POST') {
          return send(res, 200, await api.setHumanFeedback(id, await lerCorpo(req)));
        }
        if (sub) return send(res, 404, { error: 'Rota não encontrada.' });
        if (req.method === 'GET') return send(res, 200, await api.getMessage(id));
        if (req.method === 'PATCH') return send(res, 200, await api.updateMessage(id, await lerCorpo(req)));
        if (req.method === 'DELETE') return send(res, 200, await api.deleteMessage(id));
      } else {
        if (sub) return send(res, 404, { error: 'Rota não encontrada.' });
        if (req.method === 'GET') return send(res, 200, await api.getContact(id));
        if (req.method === 'PATCH') return send(res, 200, await api.updateContact(id, await lerCorpo(req)));
        if (req.method === 'DELETE') return send(res, 200, await api.deleteContact(id));
      }
    }

    return send(res, 404, { error: 'Rota não encontrada.' });
  } catch (err) {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    return send(res, status, { error: err.message ?? 'Erro interno.' });
  }
});

// Falha cedo se o Postgres não estiver acessível ou o schema não tiver sido aplicado.
await verificarBanco();

server.listen(PORT, () => {
  console.log(`CRM 7Bee rodando em http://localhost:${PORT}`);
  whats.retomarSessao();
});
