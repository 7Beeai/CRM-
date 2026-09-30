import { all, one, run, tx, log } from './db.js';
import { scoreMessage, dueDateFor } from './relevance.js';
import { onboardingDoContato, onboardingsDosContatos, linkDaConversa } from './onboarding.js';
import { lerPeriodo, filtroPeriodo, foraDoPeriodo } from './periodo.js';

// Responsável padrão quando não há usuário logado (agente, importação, seed).
const CS_PADRAO = process.env.CRM_CS_PADRAO ?? 'Guilherme';

const MESSAGE_STATUSES = ['triagem', 'escalada', 'auto_respondida', 'respondida', 'arquivada'];
const AGENT_DECISIONS = ['respondeu', 'escalou', 'ignorou'];
const AGENT_TIMEOUT_MIN = Number(process.env.CRM_AGENT_TIMEOUT_MIN ?? 10);
const CONTACT_STAGES = ['lead', 'qualificado', 'proposta', 'cliente', 'perdido'];

// Fora de transação as consultas vão direto no pool; dentro, recebem o `t` do tx().
const db = { all, one, run };

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

/* ---------------------------------- contatos --------------------------------- */

export async function listContacts({ q = '', stage = '', desde = '', ate = '' } = {}) {
  const periodo = filtroPeriodo('created_at', lerPeriodo({ desde, ate }));
  let sql = `SELECT * FROM contacts WHERE 1=1${periodo.sql}`;
  const args = [...periodo.args];
  if (q) {
    sql += ` AND (name ILIKE ? OR company ILIKE ? OR email ILIKE ? OR phone ILIKE ? OR tags ILIKE ?)`;
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (stage) {
    sql += ` AND stage = ?`;
    args.push(stage);
  }
  sql += ` ORDER BY updated_at DESC LIMIT 500`;
  return all(sql, args);
}

export async function createContact(input) {
  if (!input?.name?.trim()) throw bad('Nome do contato é obrigatório.');
  if (input.stage && !CONTACT_STAGES.includes(input.stage)) throw bad('Etapa inválida.');
  const { id } = await run(`
    INSERT INTO contacts (name, company, email, phone, stage, owner, tags, notes, is_customer)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
  `, [
    input.name.trim(), input.company ?? '', input.email ?? '', input.phone ?? '',
    input.stage ?? 'lead', input.owner ?? '', input.tags ?? '', input.notes ?? '',
    Boolean(input.is_customer)
  ]);
  await log('contato_criado', input.name.trim(), { contactId: id, actor: input.actor ?? 'sistema' });
  return getContact(id);
}

export async function getContact(id) {
  const contact = await one(`SELECT * FROM contacts WHERE id = ?`, [id]);
  if (!contact) throw Object.assign(new Error('Contato não encontrado.'), { status: 404 });
  return contact;
}

export async function updateContact(id, patch) {
  await getContact(id);
  const fields = ['name', 'company', 'email', 'phone', 'stage', 'owner', 'tags', 'notes', 'is_customer'];
  const sets = [];
  const args = [];
  for (const f of fields) {
    if (patch[f] === undefined) continue;
    if (f === 'stage' && !CONTACT_STAGES.includes(patch[f])) throw bad('Etapa inválida.');
    sets.push(`${f} = ?`);
    args.push(f === 'is_customer' ? Boolean(patch[f]) : patch[f]);
  }
  if (sets.length) {
    await run(`UPDATE contacts SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...args, now(), id]);
    await log('contato_atualizado', sets.map((s) => s.split(' =')[0]).join(', '), { contactId: id, actor: patch.actor ?? 'sistema' });
  }
  return getContact(id);
}

export async function deleteContact(id) {
  await getContact(id);
  await run(`DELETE FROM contacts WHERE id = ?`, [id]);
  return { ok: true };
}

/* --------------------------------- mensagens --------------------------------- */

async function findContactFor({ contact_id, sender_handle, sender_name }) {
  if (contact_id) return (await one(`SELECT * FROM contacts WHERE id = ?`, [contact_id])) ?? null;
  if (sender_handle) {
    const found = await one(`SELECT * FROM contacts WHERE email = ? OR phone = ?`, [sender_handle, sender_handle]);
    if (found) return found;
  }
  if (sender_name) {
    return (await one(`SELECT * FROM contacts WHERE lower(name) = lower(?)`, [sender_name])) ?? null;
  }
  return null;
}

export async function createMessage(input) {
  if (!input?.body?.trim()) throw bad('O texto da mensagem é obrigatório.');
  if (input.external_id) {
    const dup = await one(`SELECT id FROM messages WHERE external_id = ?`, [input.external_id]);
    if (dup) return getMessage(dup.id);
  }

  const contact = await findContactFor(input);
  const receivedAt = input.received_at ?? now();
  const channel = input.channel ?? 'whatsapp';
  const { score, priority, reasons } = scoreMessage({
    body: input.body,
    subject: input.subject ?? '',
    channel,
    isCustomer: Boolean(contact?.is_customer),
    receivedAt
  });

  // Duas cópias da mesma mensagem podem chegar juntas: só a primeira entra.
  const inserir = async (q) => {
    const { id } = await q.run(`
      INSERT INTO messages (contact_id, sender_name, sender_handle, channel, subject, body,
                            received_at, status, priority, score, reasons, assigned_to, due_at,
                            external_id, thread_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'triagem', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (external_id) DO NOTHING RETURNING id
    `, [
      contact?.id ?? null,
      input.sender_name?.trim() || contact?.name || 'Desconhecido',
      input.sender_handle ?? '',
      channel,
      input.subject ?? '',
      input.body.trim(),
      receivedAt,
      priority,
      score,
      reasons,
      input.assigned_to ?? (priority === 'baixa' ? '' : CS_PADRAO),
      dueDateFor(priority, receivedAt),
      input.external_id ?? null,
      input.thread_id ?? null
    ]);
    if (id) await log('mensagem_recebida', `${channel} · score ${score} (${priority})`, { messageId: id, contactId: contact?.id ?? null, t: q });
    return id;
  };

  // O agente pode enviar a mensagem e a decisão na mesma chamada.
  if (input.agent) {
    const decidida = await tx(async (t) => {
      const id = await inserir(t);
      return id ? decidir(id, input.agent, t) : null;
    });
    if (decidida) {
      if (decidida.needs_human) notifyEscalation(decidida);
      return decidida;
    }
  } else {
    const id = await inserir(db);
    if (id) return getMessage(id);
  }

  // Perdeu a corrida para uma cópia idêntica: devolve a que já existe.
  const dup = await one(`SELECT id FROM messages WHERE external_id = ?`, [input.external_id]);
  return getMessage(dup.id);
}

/* ------------------------- decisão do agente de IA ------------------------- */

export async function applyAgentDecision(id, input = {}) {
  const updated = await decidir(id, input, db);
  if (updated.needs_human) notifyEscalation(updated);
  return updated;
}

// Grava a decisão; `q` é o pool ou o `t` de uma transação. O aviso fica com quem chama.
async function decidir(id, input, q) {
  const current = await lerMensagem(id, q);
  const decision = input.decision;
  if (!AGENT_DECISIONS.includes(decision)) {
    throw bad(`Decisão inválida. Use uma destas: ${AGENT_DECISIONS.join(', ')}.`);
  }
  if (decision === 'respondeu' && !input.reply?.trim() && !input.needs_human) {
    throw bad('Para a decisão "respondeu" envie o texto da resposta em "reply".');
  }

  const confidence = input.confidence === undefined || input.confidence === null
    ? null
    : Number(input.confidence);
  if (confidence !== null && (Number.isNaN(confidence) || confidence < 0 || confidence > 1)) {
    throw bad('A confiança deve ser um número entre 0 e 1.');
  }

  const needsHuman = decision === 'escalou' || Boolean(input.needs_human);
  const status = needsHuman ? 'escalada' : decision === 'respondeu' ? 'auto_respondida' : 'arquivada';
  const answeredAt = decision === 'respondeu' && !needsHuman ? now() : null;

  await q.run(`
    UPDATE messages SET
      status = ?, needs_human = ?, answered_at = ?,
      agent_name = ?, agent_decision = ?, agent_confidence = ?, agent_intent = ?,
      agent_reason = ?, agent_reply = ?, agent_suggested_reply = ?, agent_decided_at = ?,
      assigned_to = ?, priority = ?, due_at = ?, updated_at = ?
    WHERE id = ?
  `, [
    status,
    needsHuman,
    answeredAt,
    input.agent ?? input.agent_name ?? 'agente',
    decision,
    confidence,
    input.intent ?? '',
    input.reason ?? '',
    input.reply ?? '',
    input.suggested_reply ?? '',
    now(),
    needsHuman ? (input.assign_to ?? (current.assigned_to || CS_PADRAO)) : '',
    input.priority && ['alta', 'media', 'baixa'].includes(input.priority) ? input.priority : current.priority,
    dueDateFor(input.priority ?? current.priority, now()),
    now(),
    id
  ]);

  const confLabel = confidence === null ? 'sem confiança informada' : `confiança ${Math.round(confidence * 100)}%`;
  await log('decisao_agente', `${decision}${needsHuman ? ' (escalou para humano)' : ''} · ${confLabel}`,
    { messageId: id, contactId: current.contact_id, actor: input.agent ?? 'agente', t: q });

  return lerMensagem(id, q);
}

export async function setHumanFeedback(id, input = {}) {
  const current = await getMessage(id);
  const valid = ['acertou', 'deveria_escalar', 'nao_precisava_escalar', 'resposta_ruim'];
  if (!valid.includes(input.feedback)) throw bad(`Avaliação inválida. Use: ${valid.join(', ')}.`);
  await run(`UPDATE messages SET human_feedback = ?, human_feedback_note = ?, updated_at = ? WHERE id = ?`,
    [input.feedback, input.note ?? '', now(), id]);
  await log('feedback_humano', input.feedback, { messageId: id, contactId: current.contact_id, actor: input.actor ?? 'humano' });
  return getMessage(id);
}

// Aviso de escalonamento para Slack, WhatsApp ou o que o time usar.
function notifyEscalation(message) {
  const url = process.env.CRM_ESCALATION_WEBHOOK;
  if (!url) return;
  const payload = {
    tipo: 'escalonamento',
    mensagem_id: message.id,
    de: message.contact_name ?? message.sender_name,
    canal: message.channel,
    prioridade: message.priority,
    motivo_do_agente: message.agent_reason,
    texto: message.body,
    rascunho_sugerido: message.agent_suggested_reply
  };
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch((err) => console.error('Falha ao avisar sobre escalonamento:', err.message));
}

export async function listMessages({ status = '', priority = '', channel = '', assigned_to = '', q = '',
  sort = 'score', needs_human = '', aguardando_agente = '', desde = '', ate = '' } = {}) {
  const periodo = filtroPeriodo('m.received_at', lerPeriodo({ desde, ate }));
  let sql = `
    SELECT m.*, c.name AS contact_name, c.company AS contact_company, c.is_customer,
           c.phone AS contact_phone
    FROM messages m LEFT JOIN contacts c ON c.id = m.contact_id WHERE 1=1${periodo.sql}`;
  const args = [...periodo.args];
  if (status) { sql += ` AND m.status = ?`; args.push(status); }
  if (needs_human === '1' || needs_human === true) {
    sql += ` AND m.needs_human AND m.status = 'escalada'`;
  }
  if (aguardando_agente === '1' || aguardando_agente === true) {
    sql += ` AND m.agent_decision IS NULL AND m.status = 'triagem'`;
  }
  if (priority) { sql += ` AND m.priority = ?`; args.push(priority); }
  if (channel) { sql += ` AND m.channel = ?`; args.push(channel); }
  if (assigned_to) { sql += ` AND m.assigned_to = ?`; args.push(assigned_to); }
  if (q) {
    sql += ` AND (m.body ILIKE ? OR m.subject ILIKE ? OR m.sender_name ILIKE ?)`;
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += sort === 'recente'
    ? ` ORDER BY m.received_at DESC`
    : ` ORDER BY m.needs_human DESC,
               (m.status IN ('respondida', 'arquivada', 'auto_respondida')) ASC,
               m.score DESC, m.received_at ASC`;
  sql += ` LIMIT 500`;
  const rows = await all(sql, args);
  // Os onboardings dos contatos vêm numa consulta só, em vez de uma por mensagem.
  const onboardings = await onboardingsDosContatos(rows.map((r) => r.contact_id));
  return rows.map((row) => decorate(row, onboardings.get(row.contact_id) ?? null));
}

export async function getMessage(id) {
  return lerMensagem(id, db);
}

async function lerMensagem(id, q) {
  const row = await q.one(`
    SELECT m.*, c.name AS contact_name, c.company AS contact_company, c.is_customer,
           c.phone AS contact_phone
    FROM messages m LEFT JOIN contacts c ON c.id = m.contact_id WHERE m.id = ?`, [id]);
  if (!row) throw Object.assign(new Error('Mensagem não encontrada.'), { status: 404 });
  return decorate(row, await onboardingDoContato(row.contact_id));
}

function decorate(row, onboarding) {
  const overdue = row.due_at && !row.answered_at &&
    ['triagem', 'escalada'].includes(row.status) &&
    new Date(`${row.due_at.replace(' ', 'T')}Z`) < new Date();
  const minutesSince = (Date.now() - new Date(`${row.received_at.replace(' ', 'T')}Z`).getTime()) / 60000;
  const agentLate = !row.agent_decision && row.status === 'triagem' && minutesSince > AGENT_TIMEOUT_MIN;
  const waitingHours = Math.round(
    (Date.now() - new Date(`${row.received_at.replace(' ', 'T')}Z`).getTime()) / 3.6e5
  ) / 10;
  // Se o contato é uma franquia, o CS abre o grupo dela direto do card.
  const link = onboarding?.whatsapp_link
    || linkDaConversa(row.sender_handle)
    || linkDaConversa(row.contact_phone);
  const destino = onboarding?.whatsapp_link
    ? onboarding.whatsapp_destino
    : (link ? 'conversa' : '');

  return {
    ...row,
    onboarding: onboarding ?? null,
    whatsapp_link: link,
    whatsapp_destino: destino,
    overdue: Boolean(overdue),
    waiting_hours: waitingHours,
    aguardando_agente: !row.agent_decision && row.status === 'triagem',
    agente_atrasado: Boolean(agentLate)
  };
}

export async function updateMessage(id, patch) {
  const current = await getMessage(id);
  const sets = [];
  const args = [];
  const actor = patch.actor ?? 'sistema';

  if (patch.status !== undefined) {
    if (!MESSAGE_STATUSES.includes(patch.status)) throw bad('Status inválido.');
    sets.push('status = ?'); args.push(patch.status);
    if (patch.status === 'respondida') { sets.push('answered_at = ?'); args.push(now()); }
    if (patch.status !== 'respondida' && current.answered_at) { sets.push('answered_at = NULL'); }
    sets.push('needs_human = ?'); args.push(patch.status === 'escalada');
  }
  if (patch.priority !== undefined) {
    if (!['alta', 'media', 'baixa'].includes(patch.priority)) throw bad('Prioridade inválida.');
    sets.push('priority = ?'); args.push(patch.priority);
    sets.push('due_at = ?'); args.push(dueDateFor(patch.priority, current.received_at));
  }
  for (const f of ['assigned_to', 'internal_note', 'contact_id']) {
    if (patch[f] !== undefined) { sets.push(`${f} = ?`); args.push(patch[f]); }
  }
  if (!sets.length) return current;

  await run(`UPDATE messages SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...args, now(), id]);
  const changes = [];
  if (patch.status !== undefined && patch.status !== current.status) changes.push(`status → ${patch.status}`);
  if (patch.priority !== undefined && patch.priority !== current.priority) changes.push(`prioridade → ${patch.priority}`);
  if (patch.assigned_to !== undefined && patch.assigned_to !== current.assigned_to) changes.push(`responsável → ${patch.assigned_to || 'ninguém'}`);
  if (patch.internal_note !== undefined) changes.push('nota interna atualizada');
  if (changes.length) await log('mensagem_atualizada', changes.join(' · '), { messageId: id, contactId: current.contact_id, actor });
  return getMessage(id);
}

export async function rescoreMessage(id) {
  const m = await getMessage(id);
  const { score, priority, reasons } = scoreMessage({
    body: m.body, subject: m.subject, channel: m.channel,
    isCustomer: Boolean(m.is_customer), receivedAt: m.received_at
  });
  await run(`UPDATE messages SET score = ?, priority = ?, reasons = ?, due_at = ?, updated_at = ? WHERE id = ?`,
    [score, priority, reasons, dueDateFor(priority, m.received_at), now(), id]);
  return getMessage(id);
}

export async function deleteMessage(id) {
  await getMessage(id);
  await run(`DELETE FROM messages WHERE id = ?`, [id]);
  return { ok: true };
}

export async function messageActivities(id) {
  return all(`SELECT * FROM activities WHERE message_id = ? ORDER BY created_at DESC LIMIT 50`, [id]);
}

/* --------------------------------- indicadores -------------------------------- */

export async function dashboard({ desde = '', ate = '' } = {}) {
  const p = lerPeriodo({ desde, ate });
  const msg = filtroPeriodo('received_at', p);
  const cont = filtroPeriodo('created_at', p);
  const n = async (sql, args = []) => (await one(sql, args)).n;
  // Toda consulta de mensagem recebe o mesmo recorte de período.
  const M = (where) => `FROM messages WHERE ${where}${msg.sql}`;
  const aberta = `status IN ('triagem','escalada')`;

  const total = await n(`SELECT COUNT(*) n ${M('agent_decision IS NOT NULL')}`, msg.args);
  const auto = await n(`SELECT COUNT(*) n ${M('agent_decision IS NOT NULL AND NOT needs_human')}`, msg.args);

  // Rede de segurança: filtrar a fila por data pode esconder trabalho pendente.
  const fora = foraDoPeriodo('received_at', p);
  const pendentesFora = p.ativo
    ? await n(`SELECT COUNT(*) n FROM messages WHERE ${aberta}${fora.sql}`, fora.args)
    : 0;

  const tempoMedio = (await one(
    `SELECT AVG(extract(epoch from (answered_at - received_at)) / 3600.0) v ${M('answered_at IS NOT NULL')}`,
    msg.args
  )).v ?? 0;

  return {
    periodo: { desde: p.desde, ate: p.ate, ativo: p.ativo },
    triagem: await n(`SELECT COUNT(*) n ${M("status = 'triagem'")}`, msg.args),
    escaladas: await n(`SELECT COUNT(*) n ${M("status = 'escalada'")}`, msg.args),
    aguardando_agente: await n(`SELECT COUNT(*) n ${M("status = 'triagem' AND agent_decision IS NULL")}`, msg.args),
    auto_respondidas: await n(`SELECT COUNT(*) n ${M("status = 'auto_respondida'")}`, msg.args),
    alta_prioridade: await n(`SELECT COUNT(*) n ${M(`${aberta} AND priority = 'alta'`)}`, msg.args),
    atrasadas: await n(`SELECT COUNT(*) n ${M(`${aberta} AND due_at IS NOT NULL AND due_at < ?`)}`, [now(), ...msg.args]),
    respondidas_hoje: await n(
      `SELECT COUNT(*) n FROM messages WHERE status = 'respondida' AND answered_at::date = current_date`
    ),
    tempo_medio_resposta_horas: Math.round(tempoMedio * 10) / 10,
    contatos: await n(`SELECT COUNT(*) n FROM contacts WHERE 1=1${cont.sql}`, cont.args),
    clientes: await n(`SELECT COUNT(*) n FROM contacts WHERE is_customer${cont.sql}`, cont.args),
    taxa_automacao: total ? Math.round((auto / total) * 100) : 0,
    feedback_agente: await all(
      `SELECT human_feedback AS feedback, COUNT(*) n ${M("human_feedback <> ''")}
       GROUP BY human_feedback ORDER BY n DESC`, msg.args),
    por_decisao_do_agente: await all(
      `SELECT COALESCE(agent_decision, 'sem decisão') AS decisao, COUNT(*) n ${M('1=1')}
       GROUP BY agent_decision ORDER BY n DESC`, msg.args),
    por_canal: await all(
      `SELECT channel, COUNT(*) n ${M(aberta)} GROUP BY channel ORDER BY n DESC`, msg.args),
    pipeline: await all(`SELECT stage, COUNT(*) n FROM contacts WHERE 1=1${cont.sql} GROUP BY stage`, cont.args),
    pendentes_fora_do_periodo: pendentesFora
  };
}

export const meta = { MESSAGE_STATUSES, CONTACT_STAGES, AGENT_DECISIONS, AGENT_TIMEOUT_MIN };
