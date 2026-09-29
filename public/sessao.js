/**
 * Sessão do usuário: login pelo Supabase Auth, token para a API e tela de entrada.
 * O supabase-js vem do CDN porque o front não tem build.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const $ = (sel) => document.querySelector(sel);
let supabase = null;
let sessao = null;
let usuario = null; // { id, email, nome } vindo do servidor (equipe)
let aoEntrar = null;

export const tokenAtual = () => sessao?.access_token ?? '';
export const usuarioAtual = () => usuario;

async function config() {
  const res = await fetch('/api/config');
  return res.json();
}

async function carregarUsuario() {
  const res = await fetch('/api/eu', { headers: { authorization: `Bearer ${tokenAtual()}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Não foi possível carregar seu usuário.');
  usuario = data;
  return usuario;
}

function mostrarErro(msg) {
  const el = $('#login-erro');
  el.textContent = msg ?? '';
  el.hidden = !msg;
}

export function mostrarLogin(msg = '') {
  const dlg = $('#login');
  mostrarErro(msg);
  if (!dlg.open) dlg.showModal();
  $('#login-email').focus();
}

function esconderLogin() {
  const dlg = $('#login');
  if (dlg.open) dlg.close();
}

/** Resolve quando há uma sessão válida e o usuário faz parte da equipe. */
export async function iniciarSessao() {
  const cfg = await config();
  if (!cfg.login) throw new Error('O servidor está sem SUPABASE_URL/SUPABASE_ANON_KEY.');
  supabase = createClient(cfg.supabase_url, cfg.supabase_anon_key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'crm7bee-sessao' }
  });

  supabase.auth.onAuthStateChange((_evento, s) => { sessao = s; });
  const { data } = await supabase.auth.getSession();
  sessao = data.session;

  // O <dialog> de login não fecha com Esc.
  $('#login').addEventListener('cancel', (e) => e.preventDefault());
  $('#login-form').addEventListener('submit', entrar);

  if (sessao) {
    try {
      await carregarUsuario();
      return usuario;
    } catch (err) {
      await supabase.auth.signOut().catch(() => {});
      sessao = null;
      mostrarLogin(err.message);
    }
  } else {
    mostrarLogin();
  }
  return new Promise((resolve) => { aoEntrar = resolve; });
}

async function entrar(e) {
  e.preventDefault();
  const btn = $('#login-entrar');
  btn.disabled = true;
  mostrarErro('');
  try {
    const email = $('#login-email').value.trim();
    const password = $('#login-senha').value;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message);
    sessao = data.session;
    await carregarUsuario();
    $('#login-senha').value = '';
    esconderLogin();
    if (aoEntrar) { aoEntrar(usuario); aoEntrar = null; }
    document.dispatchEvent(new CustomEvent('crm:entrou', { detail: usuario }));
  } catch (err) {
    await supabase.auth.signOut().catch(() => {});
    sessao = null;
    mostrarErro(err.message);
  } finally {
    btn.disabled = false;
  }
}

export async function sair() {
  await supabase?.auth.signOut().catch(() => {});
  sessao = null;
  usuario = null;
  location.reload();
}

export async function trocarSenha(nova) {
  if (!nova || nova.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  const { error } = await supabase.auth.updateUser({ password: nova });
  if (error) throw new Error(error.message);
}

/** Chamada de API que expirou: derruba a sessão e pede login de novo. */
export async function sessaoExpirou(msg) {
  await supabase?.auth.signOut().catch(() => {});
  sessao = null;
  mostrarLogin(msg ?? 'Sua sessão venceu. Entre de novo.');
  return new Promise((resolve) => { aoEntrar = resolve; });
}
