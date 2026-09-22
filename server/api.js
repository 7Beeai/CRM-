import { db, log } from './db.js';
import { scoreMessage, dueDateFor } from './relevance.js';

const MESSAGE_STATUSES = ['triagem', 'relevante', 'respondida', 'arquivada'];
const CONTACT_STAGES = ['lead', 'qualificado', 'proposta', 'cliente', 'perdido'];

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

/* ---------------------------------- contatos --------------------------------- */

export function listContacts({ q = '', stage = '' } = {}) {
  let sql = `SELECT * FROM contacts WHERE 1=1`;
  const args = [];
  if (q) {
    sql += ` AND (name LIKE ? OR company LIKE ? OR email LIKE ? OR phone LIKE ?)`;
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (stage) {
    sql += ` AND stage = ?`;
    args.push(stage);
  }
  sql += ` ORDER BY updated_at DESC LIMIT 500`;
  return db.prepare(sql).all(...args);
}

export function createContact(input) {
  if (!input?.name?.trim()) throw bad('Nome do contato é obrigatório.');
  if (input.stage && !CONTACT_STAGES.includes(input.stage)) throw bad('Etapa inválida.');
  const info = db.prepare(`
    INSERT INTO contacts (name, company, email, phone, stage, owner, tags, notes, is_customer)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.name.trim(), input.company ?? '', input.email ?? '', input.phone ?? '',
    input.stage ?? 'lead', input.owner ?? '', input.tags ?? '', input.notes ?? '',
    input.is_customer ? 1 : 0
  );
  const id = Number(info.lastInsertRowid);
  log('contato_criado', input.name.trim(), { contactId: id, actor: input.actor ?? 'sistema' });
  return getContact(id);
}

export function getContact(id) {
  const contact = db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(id);
  if (!contact) throw Object.assign(new Error('Contato não encontrado.'), { status: 404 });
  return contact;
}

export function updateContact(id, patch) {
  getContact(id);
  const fields = ['name', 'company', 'email', 'phone', 'stage', 'owner', 'tags', 'notes', 'is_customer'];
  const sets = [];
  const args = [];
  for (const f of fields) {
    if (patch[f] === undefined) continue;
    if (f === 'stage' && !CONTACT_STAGES.includes(patch[f])) throw bad('Etapa inválida.');
    sets.push(`${f} = ?`);
    args.push(f === 'is_customer' ? (patch[f] ? 1 : 0) : patch[f]);
  }
  if (sets.length) {
    db.prepare(`UPDATE contacts SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...args, now(), id);
    log('contato_atualizado', sets.map((s) => s.split(' =')[0]).join(', '), { contactId: id, actor: patch.actor ?? 'sistema' });
  }
  return getContact(id);
}

export function deleteContact(id) {
  getContact(id);
  db.prepare(`DELETE FROM contacts WHERE id = ?`).run(id);
  return { ok: true };
}

/* --------------------------------- mensagens --------------------------------- */

function findContactFor({ contact_id, sender_handle, sender_name }) {
  if (contact_id) return db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(contact_id) ?? null;
  if (sender_handle) {
    const found = db.prepare(`SELECT * FROM contacts WHERE email = ? OR phone = ?`).get(sender_handle, sender_handle);
    if (found) return found;
  }
  if (sender_name) {
    return db.prepare(`SELECT * FROM contacts WHERE lower(name) = lower(?)`).get(sender_name) ?? null;
  }
  return null;
}

export function createMessage(input) {
  if (!input?.body?.trim()) throw bad('O texto da mensagem é obrigatório.');
  if (input.external_id) {
    const dup = db.prepare(`SELECT * FROM messages WHERE external_id = ?`).get(input.external_id);
    if (dup) return decorate(dup);
  }

  const contact = findContactFor(input);
  const receivedAt = input.received_at ?? now();
  const channel = input.channel ?? 'whatsapp';
  const { score, priority, reasons } = scoreMessage({
    body: input.body,
    subject: input.subject ?? '',
    channel,
    isCustomer: Boolean(contact?.is_customer),
    receivedAt
  });

  const info = db.prepare(`
    INSERT INTO messages (contact_id, sender_name, sender_handle, channel, subject, body,
                          received_at, status, priority, score, reasons, assigned_to, due_at, external_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'triagem', ?, ?, ?, ?, ?, ?)
  `).run(
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
    input.assigned_to ?? (priority === 'baixa' ? '' : 'Guilherme'),
    dueDateFor(priority, receivedAt),
    input.external_id ?? null
  );

  const id = Number(info.lastInsertRowid);
  log('mensagem_recebida', `${channel} · score ${score} (${priority})`, { messageId: id, contactId: contact?.id ?? null });
  return getMessage(id);
}

export function listMessages({ status = '', priority = '', channel = '', assigned_to = '', q = '', sort = 'score' } = {}) {
  let sql = `
    SELECT m.*, c.name AS contact_name, c.company AS contact_company, c.is_customer
    FROM messages m LEFT JOIN contacts c ON c.id = m.contact_id WHERE 1=1`;
  const args = [];
  if (status) { sql += ` AND m.status = ?`; args.push(status); }
  if (priority) { sql += ` AND m.priority = ?`; args.push(priority); }
  if (channel) { sql += ` AND m.channel = ?`; args.push(channel); }
  if (assigned_to) { sql += ` AND m.assigned_to = ?`; args.push(assigned_to); }
  if (q) {
    sql += ` AND (m.body LIKE ? OR m.subject LIKE ? OR m.sender_name LIKE ?)`;
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += sort === 'recente'
    ? ` ORDER BY m.received_at DESC`
    : ` ORDER BY (m.status = 'respondida' OR m.status = 'arquivada') ASC, m.score DESC, m.received_at ASC`;
  sql += ` LIMIT 500`;
  return db.prepare(sql).all(...args).map(decorate);
}

export function getMessage(id) {
  const row = db.prepare(`
    SELECT m.*, c.name AS contact_name, c.company AS contact_company, c.is_customer
    FROM messages m LEFT JOIN contacts c ON c.id = m.contact_id WHERE m.id = ?`).get(id);
  if (!row) throw Object.assign(new Error('Mensagem não encontrada.'), { status: 404 });
  return decorate(row);
}

function decorate(row) {
  const overdue = row.due_at && !row.answered_at &&
    ['triagem', 'relevante'].includes(row.status) &&
    new Date(`${row.due_at.replace(' ', 'T')}Z`) < new Date();
  const waitingHours = Math.round(
    (Date.now() - new Date(`${row.received_at.replace(' ', 'T')}Z`).getTime()) / 3.6e5
  ) / 10;
  return { ...row, overdue: Boolean(overdue), waiting_hours: waitingHours };
}

export function updateMessage(id, patch) {
  const current = getMessage(id);
  const sets = [];
  const args = [];
  const actor = patch.actor ?? 'sistema';

  if (patch.status !== undefined) {
    if (!MESSAGE_STATUSES.includes(patch.status)) throw bad('Status inválido.');
    sets.push('status = ?'); args.push(patch.status);
    if (patch.status === 'respondida') { sets.push('answered_at = ?'); args.push(now()); }
    if (patch.status !== 'respondida' && current.answered_at) { sets.push('answered_at = NULL'); }
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

  db.prepare(`UPDATE messages SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...args, now(), id);
  const changes = [];
  if (patch.status !== undefined && patch.status !== current.status) changes.push(`status → ${patch.status}`);
  if (patch.priority !== undefined && patch.priority !== current.priority) changes.push(`prioridade → ${patch.priority}`);
  if (patch.assigned_to !== undefined && patch.assigned_to !== current.assigned_to) changes.push(`responsável → ${patch.assigned_to || 'ninguém'}`);
  if (patch.internal_note !== undefined) changes.push('nota interna atualizada');
  if (changes.length) log('mensagem_atualizada', changes.join(' · '), { messageId: id, contactId: current.contact_id, actor });
  return getMessage(id);
}

export function rescoreMessage(id) {
  const m = getMessage(id);
  const { score, priority, reasons } = scoreMessage({
    body: m.body, subject: m.subject, channel: m.channel,
    isCustomer: Boolean(m.is_customer), receivedAt: m.received_at
  });
  db.prepare(`UPDATE messages SET score = ?, priority = ?, reasons = ?, due_at = ?, updated_at = ? WHERE id = ?`)
    .run(score, priority, reasons, dueDateFor(priority, m.received_at), now(), id);
  return getMessage(id);
}

export function deleteMessage(id) {
  getMessage(id);
  db.prepare(`DELETE FROM messages WHERE id = ?`).run(id);
  return { ok: true };
}

export function messageActivities(id) {
  return db.prepare(`SELECT * FROM activities WHERE message_id = ? ORDER BY created_at DESC LIMIT 50`).all(id);
}

/* --------------------------------- indicadores -------------------------------- */

export function dashboard() {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const openFilter = `status IN ('triagem','relevante')`;
  return {
    triagem: one(`SELECT COUNT(*) n FROM messages WHERE status = 'triagem'`).n,
    relevantes: one(`SELECT COUNT(*) n FROM messages WHERE status = 'relevante'`).n,
    alta_prioridade: one(`SELECT COUNT(*) n FROM messages WHERE ${openFilter} AND priority = 'alta'`).n,
    atrasadas: one(
      `SELECT COUNT(*) n FROM messages WHERE ${openFilter} AND due_at IS NOT NULL AND due_at < ?`, now()
    ).n,
    respondidas_hoje: one(
      `SELECT COUNT(*) n FROM messages WHERE status = 'respondida' AND date(answered_at) = date('now')`
    ).n,
    tempo_medio_resposta_horas: Math.round(
      (one(`SELECT AVG((julianday(answered_at) - julianday(received_at)) * 24) v
            FROM messages WHERE answered_at IS NOT NULL`).v ?? 0) * 10
    ) / 10,
    contatos: one(`SELECT COUNT(*) n FROM contacts`).n,
    clientes: one(`SELECT COUNT(*) n FROM contacts WHERE is_customer = 1`).n,
    por_canal: db.prepare(
      `SELECT channel, COUNT(*) n FROM messages WHERE ${openFilter} GROUP BY channel ORDER BY n DESC`
    ).all(),
    pipeline: db.prepare(`SELECT stage, COUNT(*) n FROM contacts GROUP BY stage`).all()
  };
}

export const meta = { MESSAGE_STATUSES, CONTACT_STAGES };
