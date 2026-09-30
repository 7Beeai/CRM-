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
 *
 * As tabelas agent_pausas e agent_envios vêm da migração em supabase/migrations.
 */
import { all, one, run, tx, log } from './db.js';
import { createMessage, getMessage } from './api.js';
import { STAGES } from './onboarding.js';

// Responsável padrão quando não há usuário logado (agente, importação, seed).
const CS_PADRAO = process.env.CRM_CS_PADRAO ?? 'Guilherme';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const grupoObrigatorio = (id) => {
  const g = String(id ?? '').trim();
  if (!g) throw bad('Informe o group_id do grupo do WhatsApp.');
  return g;
};

async function nomeDoGrupo(groupId) {
  return (await one(`SELECT franchise_name, whatsapp_group_name FROM onboardings WHERE whatsapp_group_id = ?`, [groupId])) ?? null;
}

export async function pausaDoGrupo(groupId) {
  const row = await one(`SELECT * FROM agent_pausas WHERE group_id = ?`, [grupoObrigatorio(groupId)]);
  return row ? { pausado: true, ...row } : { pausado: false, group_id: groupId };
}

/**
 * O que o fluxo precisa saber antes de responder num grupo: se é de uma
 * franquia da esteira, em que etapa ela está, o que ainda falta e se o agente
 * está pausado ali.
 */
export async function contextoDoGrupo(groupId) {
  const g = grupoObrigatorio(groupId);
  const o = await one(`SELECT * FROM onboardings WHERE whatsapp_group_id = ?`, [g]);
  const pausa = await pausaDoGrupo(g);
  if (!o) return { franquia: null, pausado: pausa.pausado, group_id: g };
  const pendentes = await all(
    `SELECT title, status, note FROM onboarding_tasks WHERE onboarding_id = ? AND status <> 'feito' ORDER BY position`,
    [o.id]
  );
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

export async function listarPausas() {
  return all(`
    SELECT p.*, o.id AS onboarding_id, o.franchise_name, o.whatsapp_group_link
    FROM agent_pausas p LEFT JOIN onboardings o ON o.whatsapp_group_id = p.group_id
    ORDER BY p.pausado_em DESC`);
}

/**
 * Pausa o agente no grupo e alerta o Guilherme: a mensagem entra na fila
 * "Precisam de você" com prioridade alta e o webhook de escalonamento é
 * avisado com tipo "agente_pausado". Chamar de novo com o grupo já pausado não
 * duplica nada.
 */
export async function pausar(input = {}) {
  const groupId = grupoObrigatorio(input.group_id);
  const atual = await pausaDoGrupo(groupId);
  if (atual.pausado) return { ...atual, ja_estava_pausado: true };

  const onb = await nomeDoGrupo(groupId);
  const nomeGrupo = input.group_name || onb?.whatsapp_group_name || onb?.franchise_name || groupId;
  const motivo = input.motivo || 'A franquia percebeu que está falando com um robô.';
  const trecho = String(input.texto ?? '').trim();

  let mensagem = null;
  if (trecho) {
    mensagem = await createMessage({
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

  // Duas chamadas ao mesmo tempo: só a primeira grava a pausa e o registro.
  const gravou = await tx(async (t) => {
    const r = await t.run(
      `INSERT INTO agent_pausas (group_id, group_name, motivo, trecho, message_id, pausado_em) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (group_id) DO NOTHING RETURNING group_id`,
      [groupId, nomeGrupo, motivo, trecho, mensagem?.id ?? null, now()]
    );
    if (!r.rowCount) return false;
    await log('agente_pausado', `${nomeGrupo}: ${motivo}`, { messageId: mensagem?.id ?? null, actor: input.agente ?? 'agente-cdt', t });
    return true;
  });
  if (gravou) {
    avisar({ tipo: 'agente_pausado', grupo: nomeGrupo, group_id: groupId, motivo, texto: trecho, mensagem_id: mensagem?.id ?? null });
  }
  return {
    ...(await pausaDoGrupo(groupId)),
    ...(gravou ? {} : { ja_estava_pausado: true }),
    mensagem: mensagem ? await getMessage(mensagem.id) : null
  };
}

export async function retomar(groupId, { por = CS_PADRAO, motivo = 'reativado pelo CRM' } = {}) {
  const g = grupoObrigatorio(groupId);
  const atual = await pausaDoGrupo(g);
  if (!atual.pausado) return { retomado: false, pausado: false, group_id: g };
  await run(`DELETE FROM agent_pausas WHERE group_id = ?`, [g]);
  await log('agente_retomado', `${atual.group_name}: ${motivo}`, { messageId: atual.message_id ?? null, actor: por });
  return { retomado: true, pausado: false, group_id: g };
}

/** O fluxo chama a cada mensagem que o agente envia, com o id devolvido pela Evolution. */
export async function registrarEnvio({ message_key, group_id = '' } = {}) {
  const key = String(message_key ?? '').trim();
  if (!key) throw bad('Informe o message_key da mensagem enviada.');
  await run(`INSERT INTO agent_envios (message_key, group_id) VALUES (?, ?) ON CONFLICT (message_key) DO NOTHING`, [key, String(group_id)]);
  // Guarda só os últimos 90 dias: é o bastante para reconhecer as mensagens do agente.
  await run(`DELETE FROM agent_envios WHERE enviado_em < now() - interval '90 days'`);
  return { ok: true };
}

export const foiDoAgente = async (key) => Boolean(await one(`SELECT 1 FROM agent_envios WHERE message_key = ?`, [String(key ?? '')]));

/**
 * O fluxo chama quando aparece no grupo uma mensagem do número do Guilherme.
 * Se não foi o agente que mandou, foi o Guilherme: a pausa do grupo acaba.
 */
export async function mensagemDoGuilherme({ group_id, message_key } = {}) {
  const g = grupoObrigatorio(group_id);
  if (await foiDoAgente(message_key)) return { do_agente: true, retomado: false, pausado: (await pausaDoGrupo(g)).pausado };
  const r = await retomar(g, { por: CS_PADRAO, motivo: 'o Guilherme respondeu no grupo' });
  return { do_agente: false, ...r };
}

function avisar(payload) {
  const url = process.env.CRM_ESCALATION_WEBHOOK;
  if (!url) return;
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    .catch((err) => console.error('Falha ao avisar sobre a pausa do agente:', err.message));
}
