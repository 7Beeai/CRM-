/**
 * Login do CRM: cada pessoa entra com e-mail e senha.
 *
 * - A senha fica guardada só como hash (scrypt, com sal por usuário).
 * - A sessão é um cookie HttpOnly com um código aleatório; no banco fica só o
 *   hash desse código, então quem ler o banco não consegue entrar.
 * - Enquanto não existir nenhum usuário, o CRM fica aberto como antes. O
 *   primeiro usuário é criado pelo terminal: npm run usuario -- criar <email>.
 * - Chamadas do agente (n8n) continuam entrando pelo CRM_TOKEN, sem login.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { db } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nome          TEXT NOT NULL DEFAULT '',
  senha_hash    TEXT NOT NULL,
  ativo         INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  ultimo_acesso TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  expira_em  TEXT NOT NULL
);
`);

const COOKIE = 'crm_sessao';
const DIAS_SESSAO = Number(process.env.CRM_SESSAO_DIAS ?? 30);
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const sha = (t) => createHash('sha256').update(t).digest('hex');
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/* --------------------------------- senhas --------------------------------- */

function hashSenha(senha) {
  const sal = randomBytes(16);
  const hash = scryptSync(senha, sal, 64);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

function confere(senha, guardado) {
  const [tipo, salHex, hashHex] = String(guardado).split('$');
  if (tipo !== 'scrypt' || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const obtido = scryptSync(String(senha), Buffer.from(salHex, 'hex'), esperado.length);
  return timingSafeEqual(esperado, obtido);
}

/* -------------------------------- usuários -------------------------------- */

export const loginAtivo = () => Boolean(db.prepare(`SELECT 1 FROM users WHERE ativo = 1 LIMIT 1`).get());

export function criarUsuario({ email, nome = '', senha }) {
  const e = String(email ?? '').trim().toLowerCase();
  if (!emailValido(e)) throw bad('E-mail inválido.');
  if (!senha || String(senha).length < 4) throw bad('A senha precisa ter pelo menos 4 caracteres.');
  if (db.prepare(`SELECT 1 FROM users WHERE email = ?`).get(e)) throw bad('Já existe um usuário com esse e-mail.', 409);
  const n = String(nome).trim() || e.split('@')[0].replace(/^./, (c) => c.toUpperCase());
  const info = db.prepare(`INSERT INTO users (email, nome, senha_hash) VALUES (?, ?, ?)`).run(e, n, hashSenha(String(senha)));
  return publico(db.prepare(`SELECT * FROM users WHERE id = ?`).get(Number(info.lastInsertRowid)));
}

export function trocarSenha(email, senha) {
  if (!senha || String(senha).length < 4) throw bad('A senha precisa ter pelo menos 4 caracteres.');
  const u = db.prepare(`SELECT * FROM users WHERE email = ?`).get(String(email).trim().toLowerCase());
  if (!u) throw bad('Usuário não encontrado.', 404);
  db.prepare(`UPDATE users SET senha_hash = ? WHERE id = ?`).run(hashSenha(String(senha)), u.id);
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(u.id); // derruba as sessões abertas
  return publico(u);
}

export function ativarUsuario(email, ativo) {
  const u = db.prepare(`SELECT * FROM users WHERE email = ?`).get(String(email).trim().toLowerCase());
  if (!u) throw bad('Usuário não encontrado.', 404);
  db.prepare(`UPDATE users SET ativo = ? WHERE id = ?`).run(ativo ? 1 : 0, u.id);
  if (!ativo) db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(u.id);
  return publico({ ...u, ativo: ativo ? 1 : 0 });
}

export const listarUsuarios = () => db.prepare(`SELECT * FROM users ORDER BY email`).all().map(publico);

function publico(u) {
  return { id: u.id, email: u.email, nome: u.nome, ativo: Boolean(u.ativo), criado_em: u.criado_em, ultimo_acesso: u.ultimo_acesso };
}

/* --------------------------------- sessão --------------------------------- */

// Freio para tentativa e erro: 8 senhas erradas em 15 minutos bloqueiam o e-mail e o IP por 15 minutos.
const falhas = new Map();
const JANELA_MS = 15 * 60_000;
function bloqueado(chave) {
  const f = falhas.get(chave);
  if (!f) return false;
  if (Date.now() - f.desde > JANELA_MS) { falhas.delete(chave); return false; }
  return f.n >= 8;
}
function falhou(chave) {
  const f = falhas.get(chave);
  if (!f || Date.now() - f.desde > JANELA_MS) falhas.set(chave, { n: 1, desde: Date.now() });
  else f.n += 1;
}

export function entrar({ email, senha }, ip = '') {
  const e = String(email ?? '').trim().toLowerCase();
  const chaves = [`e:${e}`, `i:${ip}`];
  if (chaves.some(bloqueado)) throw bad('Muitas tentativas. Espere alguns minutos e tente de novo.', 429);
  const u = db.prepare(`SELECT * FROM users WHERE email = ? AND ativo = 1`).get(e);
  if (!u || !confere(senha ?? '', u.senha_hash)) {
    chaves.forEach(falhou);
    throw bad('E-mail ou senha incorretos.', 401);
  }
  chaves.forEach((c) => falhas.delete(c));
  const token = randomBytes(32).toString('base64url');
  const expira = new Date(Date.now() + DIAS_SESSAO * 8.64e7).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare(`INSERT INTO sessions (token_hash, user_id, expira_em) VALUES (?, ?, ?)`).run(sha(token), u.id, expira);
  db.prepare(`UPDATE users SET ultimo_acesso = datetime('now') WHERE id = ?`).run(u.id);
  db.prepare(`DELETE FROM sessions WHERE expira_em < datetime('now')`).run();
  return { token, usuario: publico(u) };
}

export function sair(req) {
  const t = tokenDoCookie(req);
  if (t) db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(sha(t));
}

function tokenDoCookie(req) {
  const cookies = String(req.headers.cookie ?? '').split(';').map((c) => c.trim().split('='));
  const par = cookies.find(([k]) => k === COOKIE);
  return par ? decodeURIComponent(par.slice(1).join('=')) : '';
}

/** Usuário da sessão do cookie, ou null. */
export function usuarioDaSessao(req) {
  const t = tokenDoCookie(req);
  if (!t) return null;
  const row = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expira_em > datetime('now') AND u.ativo = 1`).get(sha(t));
  return row ? publico(row) : null;
}

export function cookieDeSessao(token, req) {
  const seguro = String(req.headers['x-forwarded-proto'] ?? '').includes('https') || process.env.CRM_COOKIE_SEGURO === '1';
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DIAS_SESSAO * 86400}${seguro ? '; Secure' : ''}`;
}

export const cookieDeSaida = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
