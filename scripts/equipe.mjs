#!/usr/bin/env node
/**
 * Cria (ou lista) os usuários da equipe no Supabase Auth, com senha temporária.
 * Usa a service role key, então roda só no servidor ou na máquina do Victor.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/equipe.mjs listar
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/equipe.mjs criar "Nome" email@7bee.ai [senha]
 *
 * Sem senha, gera uma e imprime. A pessoa troca pelo menu do CRM (Trocar senha).
 * O nome vai em user_metadata.nome e o trigger crm.registrar_usuario copia pra crm.usuarios.
 */
import { randomBytes } from 'node:crypto';

const URL_BASE = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const CHAVE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!URL_BASE || !CHAVE) { console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }

const [acao, ...args] = process.argv.slice(2);

async function admin(caminho, init = {}) {
  const res = await fetch(`${URL_BASE}/auth/v1/admin${caminho}`, {
    ...init,
    headers: { apikey: CHAVE, authorization: `Bearer ${CHAVE}`, 'content-type': 'application/json', ...(init.headers ?? {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.msg ?? data.message ?? data.error_description ?? `HTTP ${res.status}`);
  return data;
}

if (acao === 'listar') {
  const { users } = await admin('/users?per_page=100');
  for (const u of users) console.log(`${u.email}\t${u.user_metadata?.nome ?? ''}\tcriado ${u.created_at.slice(0, 10)}\túltimo login ${u.last_sign_in_at?.slice(0, 10) ?? 'nunca'}`);
} else if (acao === 'criar') {
  const [nome, email, senhaInformada] = args;
  if (!nome || !email) { console.error('Uso: criar "Nome" email@7bee.ai [senha]'); process.exit(1); }
  const senha = senhaInformada ?? randomBytes(9).toString('base64url');
  const u = await admin('/users', {
    method: 'POST',
    body: JSON.stringify({ email, password: senha, email_confirm: true, user_metadata: { nome } })
  });
  console.log(`Criado: ${u.email} (${nome})`);
  console.log(`Senha temporária: ${senha}`);
  console.log('Peça para trocar no menu do usuário do CRM (Trocar senha).');
} else {
  console.error('Ações: listar | criar');
  process.exit(1);
}
