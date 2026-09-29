/**
 * Login pelo Supabase Auth.
 *
 * O navegador entra com e-mail e senha pelo supabase-js e manda o JWT em
 * `Authorization: Bearer`. O servidor confere o token no próprio Supabase
 * (GET /auth/v1/user) e guarda o resultado em cache até o token vencer, então
 * cada requisição não vira uma chamada de rede. Quem está na equipe (e ativo)
 * vem da tabela crm.usuarios; o nome de lá é o ator registrado nas ações.
 *
 * O agente (n8n) continua entrando pelo CRM_TOKEN, sem usuário.
 */
import { one, all, run } from './db.js';

export const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
export const configurado = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const cache = new Map(); // token → { usuario, expira }
const MAX_CACHE = 200;

const bad = (msg, status = 401) => Object.assign(new Error(msg), { status });

function expiracaoDoJwt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.exp ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export function tokenDoPedido(req) {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function usuarioDoSupabase(token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000)
  });
  if (res.status === 401 || res.status === 403) throw bad('Sessão inválida ou vencida. Entre de novo.');
  if (!res.ok) throw bad(`O Supabase Auth respondeu com erro ${res.status}.`, 502);
  return res.json();
}

/**
 * Resolve o usuário do pedido. Lança 401 sem token ou com token inválido,
 * 403 se a pessoa não está na equipe ou foi desativada.
 */
export async function usuarioDoPedido(req) {
  if (!configurado) throw bad('Login não configurado: defina SUPABASE_URL e SUPABASE_ANON_KEY.', 500);
  const token = tokenDoPedido(req);
  if (!token) throw bad('Entre no CRM para continuar.');

  const agora = Date.now();
  const emCache = cache.get(token);
  if (emCache && emCache.expira > agora) return emCache.usuario;

  const auth = await usuarioDoSupabase(token);
  const membro = await one(`SELECT id, email, nome, ativo FROM usuarios WHERE id = ?`, [auth.id]);
  if (!membro) throw bad('Seu usuário não está na equipe do CRM.', 403);
  if (!membro.ativo) throw bad('Seu acesso ao CRM foi desativado.', 403);

  const usuario = { id: membro.id, email: membro.email, nome: membro.nome };
  const expJwt = expiracaoDoJwt(token);
  // Cache curto: no máximo 5 min, e nunca além do vencimento do token.
  const expira = Math.min(agora + 5 * 60 * 1000, expJwt || Infinity);
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(token, { usuario, expira });
  return usuario;
}

/** Equipe ativa, para os seletores de responsável. */
export async function listarEquipe() {
  return all(`SELECT id, nome, email FROM usuarios WHERE ativo ORDER BY nome`);
}

/** Renomeia a pessoa (o nome é o que aparece nos cards). */
export async function atualizarNome(id, nome) {
  const limpo = String(nome ?? '').trim();
  if (limpo.length < 2) throw bad('Informe um nome com pelo menos 2 letras.', 400);
  await run(`UPDATE usuarios SET nome = ?, atualizado_em = now() WHERE id = ?`, [limpo, id]);
  for (const [token, item] of cache) if (item.usuario.id === id) cache.delete(token);
  return { ok: true, nome: limpo };
}

/** O que o navegador precisa para falar com o Supabase Auth. Público. */
export function configPublica() {
  return { supabase_url: SUPABASE_URL, supabase_anon_key: SUPABASE_ANON_KEY, login: configurado };
}
