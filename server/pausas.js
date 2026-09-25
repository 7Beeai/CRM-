/**
 * Pausa do agente por grupo.
 *
 * Quando uma franquia pergunta se está falando com um robô, ou mostra de
 * qualquer jeito que percebeu, o agente para de responder naquele grupo e o
 * Guilherme recebe um alerta. A pausa acaba quando o Guilherme escreve no grupo
 * (ou reativa pelo CRM).
 *
 * O agente responde pelo número do Guilherme, então para a Evolution as
 * mensagens do agente e as do Guilherme são iguais ("fromMe"). Para diferenciar,
 * o fluxo registra aqui cada mensagem que o agente envia; uma mensagem do número
 * do Guilherme que não está nessa lista foi escrita por ele.
 */
import { db, log } from './db.js';
import { createMessage, getMessage } from './api.js';
import { STAGES } from './onboarding.js';

db.exec(`
CREATE TABLE IF NOT EXISTS agent_pausas (
  group_id     TEXT PRIMARY KEY,
  group_name   TEXT NOT NULL DEFAULT '',
  motivo       TEXT NOT NULL DEFAULT '',
  trecho       TEXT NOT NULL DEFAULT '',
  message_id   INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  pausado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS agent_envios (
  message_key  TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL DEFAULT '',
  enviado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const grupoObrigatorio = (id) => {
  const g = String(id ?? '').trim();
  if (!g) throw bad('Informe o group_id do grupo do WhatsApp.');
  return g;
};

function nomeDoGrupo(groupId) {
  return db.prepare(`SELECT franchise_name, whatsapp_group_name FROM onboardings WHERE whatsapp_group_id = ?`).get(groupId) ?? null;
}

export function pausaDoGrupo(groupId) {
  const row = db.prepare(`SELECT * FROM agent_pausas WHERE group_id = ?`).get(grupoObrigatorio(groupId));
  return row ? { pausado: true, ...row } : { pausado: false, group_id: groupId };
}

/**
 * O que o fluxo precisa saber antes de responder num grupo: se é de uma
 * franquia da esteira, em que etapa ela está, o que ainda falta e se o agente
 * está pausado ali.
 */
export function contextoDoGrupo(groupId) {
  const g = grupoObrigatorio(groupId);
  const o = db.prepare(`SELECT * FROM onboardings WHERE whatsapp_group_id = ?`).get(g);
  const pausa = pausaDoGrupo(g);
  if (!o) return { franquia: null, pausado: pausa.pausado, group_id: g };
  const pendentes = db.prepare(
    `SELECT title, status, note FROM onboarding_tasks WHERE onboarding_id = ? AND status <> 'feito' ORDER BY position`
  ).all(o.id);
  return {
    group_id: g,
    pausado: pausa.pausado,
    franquia: o.franchise_name,
    grupo: o.whatsapp_group_name,
    situacao: o.situacao,
    etapa: o.stage,
    etapa_label: STAGES.find((s) => s.key === o.stage)?.label ?? o.stage,
    tarefas_pendentes: pendentes.map((t) => ({ tarefa: t.title, status: t.status, observacao: t.note })),
    inicio: o.started_at,
    concluida_em: o.concluded_at
  };
}

export function listarPausas() {
  return db.prepare(`
    SELECT p.*, o.id AS onboarding_id, o.franchise_name, o.whatsapp_group_link
    FROM agent_pausas p LEFT JOIN onboardings o ON o.whatsapp_group_id = p.group_id
    ORDER BY p.pausado_em DESC`).all();
}

/**
 * Pausa o agente no grupo e alerta o Guilherme: a mensagem entra na fila
 * "Precisam de você" com prioridade alta e o webhook de escalonamento é
 * avisado com tipo "agente_pausado". Chamar de novo com o grupo já pausado não
 * duplica nada.
 */
export function pausar(input = {}) {
  const groupId = grupoObrigatorio(input.group_id);
  const atual = pausaDoGrupo(groupId);
  if (atual.pausado) return { ...atual, ja_estava_pausado: true };

  const onb = nomeDoGrupo(groupId);
  const nomeGrupo = input.group_name || onb?.whatsapp_group_name || onb?.franchise_name || groupId;
  const motivo = input.motivo || 'A franquia percebeu que está falando com um robô.';
  const trecho = String(input.texto ?? '').trim();

  let mensagem = null;
  if (trecho) {
    mensagem = createMessage({
      body: trecho,
      channel: 'whatsapp',
      sender_name: input.remetente || nomeGrupo,
      sender_handle: input.remetente_numero ?? '',
      subject: `Agente pausado · ${nomeGrupo}`,
      thread_id: groupId,
      external_id: input.message_external_id ?? null,
      agent: {
        decision: 'escalou',
        agent: input.agente ?? 'agente-cdt',
        intent: 'percebeu_robo',
        reason: `${motivo} O agente parou de responder neste grupo até você escrever lá.`,
        priority: 'alta'
      }
    });
  }

  db.prepare(`INSERT INTO agent_pausas (group_id, group_name, motivo, trecho, message_id, pausado_em) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(groupId, nomeGrupo, motivo, trecho, mensagem?.id ?? null, now());
  log('agente_pausado', `${nomeGrupo}: ${motivo}`, { messageId: mensagem?.id ?? null, actor: input.agente ?? 'agente-cdt' });
  avisar({ tipo: 'agente_pausado', grupo: nomeGrupo, group_id: groupId, motivo, texto: trecho, mensagem_id: mensagem?.id ?? null });
  return { ...pausaDoGrupo(groupId), mensagem: mensagem ? getMessage(mensagem.id) : null };
}

export function retomar(groupId, { por = 'Guilherme', motivo = 'reativado pelo CRM' } = {}) {
  const g = grupoObrigatorio(groupId);
  const atual = pausaDoGrupo(g);
  if (!atual.pausado) return { retomado: false, pausado: false, group_id: g };
  db.prepare(`DELETE FROM agent_pausas WHERE group_id = ?`).run(g);
  log('agente_retomado', `${atual.group_name}: ${motivo}`, { messageId: atual.message_id ?? null, actor: por });
  return { retomado: true, pausado: false, group_id: g };
}

/** O fluxo chama a cada mensagem que o agente envia, com o id devolvido pela Evolution. */
export function registrarEnvio({ message_key, group_id = '' } = {}) {
  const key = String(message_key ?? '').trim();
  if (!key) throw bad('Informe o message_key da mensagem enviada.');
  db.prepare(`INSERT OR IGNORE INTO agent_envios (message_key, group_id) VALUES (?, ?)`).run(key, String(group_id));
  // Guarda só os últimos 90 dias: é o bastante para reconhecer as mensagens do agente.
  db.prepare(`DELETE FROM agent_envios WHERE enviado_em < datetime('now', '-90 days')`).run();
  return { ok: true };
}

export const foiDoAgente = (key) => Boolean(db.prepare(`SELECT 1 FROM agent_envios WHERE message_key = ?`).get(String(key ?? '')));

/**
 * O fluxo chama quando aparece no grupo uma mensagem do número do Guilherme.
 * Se não foi o agente que mandou, foi o Guilherme: a pausa do grupo acaba.
 */
export function mensagemDoGuilherme({ group_id, message_key } = {}) {
  const g = grupoObrigatorio(group_id);
  if (foiDoAgente(message_key)) return { do_agente: true, retomado: false, pausado: pausaDoGrupo(g).pausado };
  const r = retomar(g, { por: 'Guilherme', motivo: 'o Guilherme respondeu no grupo' });
  return { do_agente: false, ...r };
}

function avisar(payload) {
  const url = process.env.CRM_ESCALATION_WEBHOOK;
  if (!url) return;
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    .catch((err) => console.error('Falha ao avisar sobre a pausa do agente:', err.message));
}
