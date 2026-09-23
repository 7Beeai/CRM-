import { db, log } from './db.js';
import { lerPeriodo, filtroPeriodo, foraDoPeriodo } from './periodo.js';

/**
 * Esteira de onboarding de franquias.
 *
 * Cada etapa da esteira é uma tarefa do onboarding, então a coluna onde o card
 * está já diz o que falta fazer. A etapa "Nova franquia" é a entrada, onde caem
 * as franquias detectadas no WhatsApp ou cadastradas na mão.
 */

// O tom de cada etapa vira um token no front: mel pede ação humana,
// verde é positivo, neutro não carrega emoção.
export const STAGES = [
  { key: 'nova',         label: 'Nova franquia',             tone: 'honey' },
  { key: 'openai',       label: 'Cadastro na OpenAI',        tone: 'neutral' },
  { key: 'bm_facebook',  label: 'Criação de BM no Facebook', tone: 'neutral' },
  { key: 'ctn',          label: 'CTN',                       tone: 'neutral' },
  { key: 'teste_agente', label: 'Teste do agente de vendas', tone: 'neutral' },
  { key: 'concluido',    label: 'Concluído',                 tone: 'success' }
];

// As tarefas são as etapas do meio: as que alguém precisa executar.
export const TASK_TEMPLATE = STAGES.slice(1, -1).map((s, i) => ({
  task_key: s.key, title: s.label, position: i
}));

const STAGE_KEYS = STAGES.map((s) => s.key);
const TASK_STATUSES = ['pendente', 'feito', 'bloqueado'];
const PARADO_DIAS = Number(process.env.CRM_ONBOARDING_ALERTA_DIAS ?? 7);

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/* ------------------------------ links do WhatsApp ----------------------------- */

/**
 * Aceita o link de convite do grupo (ou só o código) e devolve a URL canônica.
 * Qualquer outra coisa volta vazia: o link vai parar num href, então nada de
 * endereço inventado entra aqui.
 */
export function linkDoGrupo(valor) {
  const bruto = String(valor ?? '').trim();
  if (!bruto) return '';
  const comProtocolo = /^https?:\/\//i.test(bruto) ? bruto : `https://chat.whatsapp.com/${bruto}`;
  let url;
  try {
    url = new URL(comProtocolo);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  if (url.hostname.toLowerCase() !== 'chat.whatsapp.com') return '';
  const codigo = url.pathname.replace(/^\/+/, '').split('/')[0];
  return /^[A-Za-z0-9]{6,60}$/.test(codigo) ? `https://chat.whatsapp.com/${codigo}` : '';
}

/** Telefone em dígitos, assumindo Brasil quando vem sem código do país. */
export function telefoneEmDigitos(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (digitos.length < 10) return '';
  return digitos.length <= 11 ? `55${digitos}` : digitos;
}

/** Conversa direta com a pessoa, quando não há grupo. */
export function linkDaConversa(telefone) {
  const digitos = telefoneEmDigitos(telefone);
  return digitos ? `https://wa.me/${digitos}` : '';
}
const parse = (s) => new Date(`${s.replace(' ', 'T')}Z`).getTime();
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const naoEncontrado = () => Object.assign(new Error('Onboarding não encontrado.'), { status: 404 });

/* ---------------------------------- leitura --------------------------------- */

function tasksOf(id) {
  return db.prepare(
    `SELECT * FROM onboarding_tasks WHERE onboarding_id = ? ORDER BY position, id`
  ).all(id);
}

function decorate(row) {
  const tasks = tasksOf(row.id);
  const feitas = tasks.filter((t) => t.status === 'feito').length;
  const diasNaEtapa = Math.floor((Date.now() - parse(row.stage_changed_at)) / 8.64e7);
  return {
    ...row,
    whatsapp_link: row.whatsapp_group_link || linkDaConversa(row.phone),
    whatsapp_destino: row.whatsapp_group_link ? 'grupo' : (linkDaConversa(row.phone) ? 'conversa' : ''),
    tasks,
    total_tarefas: tasks.length,
    tarefas_feitas: feitas,
    bloqueada: tasks.some((t) => t.status === 'bloqueado'),
    dias_desde_o_inicio: Math.floor((Date.now() - parse(row.started_at)) / 8.64e7),
    dias_na_etapa: diasNaEtapa,
    parada: row.stage !== 'concluido' && row.situacao === 'ativo' && diasNaEtapa >= PARADO_DIAS
  };
}

export function listOnboardings({ q = '', stage = '', situacao = 'ativo', desde = '', ate = '' } = {}) {
  const periodo = filtroPeriodo('started_at', lerPeriodo({ desde, ate }));
  let sql = `SELECT * FROM onboardings WHERE 1=1${periodo.sql}`;
  const args = [...periodo.args];
  if (situacao && situacao !== 'todas') { sql += ` AND situacao = ?`; args.push(situacao); }
  if (stage) { sql += ` AND stage = ?`; args.push(stage); }
  if (q) {
    sql += ` AND (franchise_name LIKE ? OR contact_name LIKE ? OR whatsapp_group_name LIKE ? OR phone LIKE ?)`;
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ` ORDER BY stage_changed_at ASC LIMIT 500`;
  return db.prepare(sql).all(...args).map(decorate);
}

export function getOnboarding(id) {
  const row = db.prepare(`SELECT * FROM onboardings WHERE id = ?`).get(id);
  if (!row) throw naoEncontrado();
  return decorate(row);
}

/* --------------------------- ligação com os contatos -------------------------- */

/**
 * Toda franquia na esteira também é um contato do CRM: é assim que as mensagens
 * dela chegam já identificadas na triagem. Se já existe contato com o mesmo
 * telefone, reaproveita em vez de duplicar.
 */
function sincronizarContato(onboarding, { actor = 'sistema' } = {}) {
  const digitos = telefoneEmDigitos(onboarding.phone);
  let contato = onboarding.contact_id
    ? db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(onboarding.contact_id)
    : null;

  if (!contato && digitos) {
    contato = db.prepare(`SELECT * FROM contacts WHERE replace(replace(replace(replace(phone,'+',''),'-',''),' ',''),'(','') LIKE ?`)
      .get(`%${digitos.slice(-11)}%`) ?? null;
  }
  if (!contato) {
    contato = db.prepare(`SELECT * FROM contacts WHERE lower(company) = lower(?)`).get(onboarding.franchise_name) ?? null;
  }

  const nome = onboarding.contact_name?.trim() || onboarding.franchise_name;
  if (contato) {
    db.prepare(`UPDATE contacts SET name = ?, company = ?, phone = ?, is_customer = 1,
      owner = CASE WHEN owner = '' THEN ? ELSE owner END,
      tags = CASE WHEN tags LIKE '%franquia%' THEN tags
                  WHEN tags = '' THEN 'franquia'
                  ELSE tags || ', franquia' END,
      updated_at = ? WHERE id = ?`)
      .run(nome, onboarding.franchise_name, onboarding.phone ?? '', onboarding.owner ?? '', now(), contato.id);
  } else {
    const info = db.prepare(`
      INSERT INTO contacts (name, company, phone, stage, owner, tags, is_customer)
      VALUES (?, ?, ?, 'cliente', ?, 'franquia', 1)
    `).run(nome, onboarding.franchise_name, onboarding.phone ?? '', onboarding.owner ?? 'Guilherme');
    contato = db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(Number(info.lastInsertRowid));
    log('contato_criado', `${nome} (franquia ${onboarding.franchise_name})`,
      { contactId: contato.id, onboardingId: onboarding.id, actor });
  }

  db.prepare(`UPDATE onboardings SET contact_id = ?, updated_at = ? WHERE id = ?`)
    .run(contato.id, now(), onboarding.id);

  // Mensagens antigas desse telefone passam a apontar para o contato.
  if (digitos) {
    const finalDoNumero = `%${digitos.slice(-8)}`;
    db.prepare(`UPDATE messages SET contact_id = ?, updated_at = ?
                WHERE contact_id IS NULL AND sender_handle <> '' AND
                      replace(replace(replace(replace(sender_handle,'+',''),'-',''),' ',''),'(','') LIKE ?`)
      .run(contato.id, now(), finalDoNumero);
  }
  return contato;
}

/* ---------------------------------- escrita --------------------------------- */

export function createOnboarding(input = {}) {
  const nome = (input.franchise_name ?? '').trim();
  if (!nome) throw bad('O nome da franquia é obrigatório.');
  if (input.stage && !STAGE_KEYS.includes(input.stage)) throw bad('Etapa inválida.');

  if (input.whatsapp_group_id) {
    const existente = db.prepare(`SELECT * FROM onboardings WHERE whatsapp_group_id = ?`)
      .get(input.whatsapp_group_id);
    if (existente) return decorate(existente);
  }

  const info = db.prepare(`
    INSERT INTO onboardings (franchise_name, contact_name, phone, plan, owner, stage, notes,
                             origem, whatsapp_group_id, whatsapp_group_name, whatsapp_group_link,
                             contact_id, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nome, input.contact_name ?? '', input.phone ?? '', input.plan ?? '',
    input.owner ?? 'Guilherme', input.stage ?? 'nova', input.notes ?? '',
    input.origem ?? 'manual', input.whatsapp_group_id ?? null,
    input.whatsapp_group_name ?? '', linkDoGrupo(input.whatsapp_group_link),
    input.contact_id ?? null, input.started_at ?? now()
  );

  const id = Number(info.lastInsertRowid);
  const insert = db.prepare(
    `INSERT INTO onboarding_tasks (onboarding_id, task_key, title, position) VALUES (?, ?, ?, ?)`
  );
  for (const t of TASK_TEMPLATE) insert.run(id, t.task_key, t.title, t.position);

  log('onboarding_criado', `${nome} (${input.origem ?? 'manual'})`, { onboardingId: id, actor: input.actor ?? 'sistema' });
  sincronizarContato(db.prepare(`SELECT * FROM onboardings WHERE id = ?`).get(id), { actor: input.actor ?? 'sistema' });
  return getOnboarding(id);
}

export function updateOnboarding(id, patch = {}) {
  getOnboarding(id);
  const campos = ['franchise_name', 'contact_name', 'phone', 'plan', 'owner', 'notes',
    'whatsapp_group_name', 'whatsapp_group_link', 'situacao'];
  const sets = [];
  const args = [];
  for (const f of campos) {
    if (patch[f] === undefined) continue;
    if (f === 'whatsapp_group_link') {
      const link = linkDoGrupo(patch[f]);
      if (patch[f] && !link) throw bad('O link do grupo precisa ser um convite do WhatsApp (chat.whatsapp.com).');
      sets.push('whatsapp_group_link = ?');
      args.push(link);
      continue;
    }
    if (f === 'situacao' && !['ativo', 'pausado', 'cancelado'].includes(patch[f])) {
      throw bad('Situação inválida. Use ativo, pausado ou cancelado.');
    }
    sets.push(`${f} = ?`);
    args.push(patch[f]);
  }
  if (sets.length) {
    db.prepare(`UPDATE onboardings SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...args, now(), id);
    log('onboarding_atualizado', sets.map((s) => s.split(' =')[0]).join(', '),
      { onboardingId: id, actor: patch.actor ?? 'sistema' });
    sincronizarContato(db.prepare(`SELECT * FROM onboardings WHERE id = ?`).get(id),
      { actor: patch.actor ?? 'sistema' });
  }
  return getOnboarding(id);
}

export function moveStage(id, stage, { actor = 'sistema' } = {}) {
  const atual = getOnboarding(id);
  if (!STAGE_KEYS.includes(stage)) throw bad('Etapa inválida.');
  if (stage === atual.stage) return atual;

  const destino = STAGE_KEYS.indexOf(stage);
  // Avançar na esteira marca como feitas as tarefas que ficaram para trás.
  for (const task of atual.tasks) {
    const posicao = STAGE_KEYS.indexOf(task.task_key);
    const deveEstarFeita = posicao < destino;
    if (deveEstarFeita && task.status === 'pendente') {
      db.prepare(`UPDATE onboarding_tasks SET status = 'feito', done_at = ?, updated_at = ? WHERE id = ?`)
        .run(now(), now(), task.id);
    }
    if (!deveEstarFeita && task.status === 'feito') {
      db.prepare(`UPDATE onboarding_tasks SET status = 'pendente', done_at = NULL, updated_at = ? WHERE id = ?`)
        .run(now(), task.id);
    }
  }

  db.prepare(`UPDATE onboardings SET stage = ?, stage_changed_at = ?, concluded_at = ?, updated_at = ? WHERE id = ?`)
    .run(stage, now(), stage === 'concluido' ? now() : null, now(), id);

  const rotulo = STAGES.find((s) => s.key === stage).label;
  log('onboarding_etapa', `${atual.franchise_name} → ${rotulo}`, { onboardingId: id, actor });
  return getOnboarding(id);
}

export function setTask(id, taskKey, patch = {}) {
  const atual = getOnboarding(id);
  const task = atual.tasks.find((t) => t.task_key === taskKey);
  if (!task) throw Object.assign(new Error('Tarefa não encontrada.'), { status: 404 });
  if (patch.status !== undefined && !TASK_STATUSES.includes(patch.status)) {
    throw bad(`Status inválido. Use: ${TASK_STATUSES.join(', ')}.`);
  }

  const status = patch.status ?? task.status;
  db.prepare(`UPDATE onboarding_tasks SET status = ?, note = ?, done_at = ?, updated_at = ? WHERE id = ?`)
    .run(status, patch.note ?? task.note, status === 'feito' ? (task.done_at ?? now()) : null, now(), task.id);

  log('onboarding_tarefa', `${task.title}: ${status}`, { onboardingId: id, actor: patch.actor ?? 'sistema' });

  // A etapa do card passa a ser a primeira tarefa que ainda falta.
  const tasks = tasksOf(id);
  const pendente = tasks.find((t) => t.status !== 'feito');
  const novaEtapa = pendente ? pendente.task_key : 'concluido';
  const saiuDaEntrada = atual.stage !== 'nova' || tasks.some((t) => t.status !== 'pendente');
  if (saiuDaEntrada && novaEtapa !== atual.stage) {
    db.prepare(`UPDATE onboardings SET stage = ?, stage_changed_at = ?, concluded_at = ?, updated_at = ? WHERE id = ?`)
      .run(novaEtapa, now(), novaEtapa === 'concluido' ? now() : null, now(), id);
  }
  return getOnboarding(id);
}

export function deleteOnboarding(id) {
  getOnboarding(id);
  db.prepare(`DELETE FROM onboardings WHERE id = ?`).run(id);
  return { ok: true };
}

export function onboardingActivities(id) {
  return db.prepare(
    `SELECT * FROM activities WHERE onboarding_id = ? ORDER BY created_at DESC LIMIT 50`
  ).all(id);
}

/* --------------------- entrada automática pelo WhatsApp --------------------- */

/**
 * Recebe um grupo novo do WhatsApp do Guilherme e abre o onboarding sozinho.
 * O nome da franquia sai do nome do grupo, já sem os prefixos que o time usa.
 */
export function fromWhatsappGroup(input = {}) {
  const groupId = (input.group_id ?? '').trim();
  const groupName = (input.group_name ?? '').trim();
  if (!groupId) throw bad('Envie o group_id do grupo do WhatsApp.');
  if (!groupName) throw bad('Envie o group_name do grupo do WhatsApp.');

  return createOnboarding({
    franchise_name: nomeDaFranquia(groupName),
    whatsapp_group_id: groupId,
    whatsapp_group_name: groupName,
    whatsapp_group_link: input.group_invite_link ?? input.invite_link ?? '',
    contact_name: input.contact_name ?? '',
    phone: input.phone ?? '',
    plan: input.plan ?? '',
    owner: input.owner ?? 'Guilherme',
    origem: 'whatsapp',
    started_at: input.created_at ?? now(),
    actor: 'whatsapp'
  });
}

export function nomeDaFranquia(groupName) {
  return groupName
    .replace(/^\s*(onboarding|implanta[çc][ãa]o|suporte|grupo|equipe|time)\s*[-–—:|]\s*/i, '')
    .replace(/\s*[-–—|]\s*(onboarding|implanta[çc][ãa]o|suporte|oficial)\s*$/i, '')
    .replace(/\s*[×x]\s*7bee\s*$/i, '')
    .replace(/^\s*7bee\s*[×x]\s*/i, '')
    .trim() || groupName.trim();
}

/** Onboarding ligado a um contato, para a triagem mostrar a franquia e o grupo. */
export function onboardingDoContato(contactId) {
  if (!contactId) return null;
  const row = db.prepare(
    `SELECT * FROM onboardings WHERE contact_id = ? ORDER BY updated_at DESC LIMIT 1`
  ).get(contactId);
  if (!row) return null;
  const etapa = STAGES.find((s) => s.key === row.stage);
  return {
    id: row.id,
    franchise_name: row.franchise_name,
    stage: row.stage,
    stage_label: etapa?.label ?? row.stage,
    whatsapp_link: row.whatsapp_group_link || linkDaConversa(row.phone),
    whatsapp_destino: row.whatsapp_group_link ? 'grupo' : (linkDaConversa(row.phone) ? 'conversa' : '')
  };
}

/* -------------------------------- indicadores ------------------------------- */

export function onboardingStats({ desde = '', ate = '' } = {}) {
  const p = lerPeriodo({ desde, ate });
  const f = filtroPeriodo('started_at', p);
  const porEtapa = Object.fromEntries(
    db.prepare(
      `SELECT stage, COUNT(*) n FROM onboardings WHERE situacao = 'ativo'${f.sql} GROUP BY stage`
    ).all(...f.args).map((r) => [r.stage, r.n])
  );
  const ativos = listOnboardings({ situacao: 'ativo', desde, ate });
  const concluidos = db.prepare(
    `SELECT COUNT(*) n FROM onboardings WHERE stage = 'concluido'${f.sql}`
  ).get(...f.args).n;
  const tempoMedio = db.prepare(
    `SELECT AVG(julianday(concluded_at) - julianday(started_at)) v
     FROM onboardings WHERE concluded_at IS NOT NULL${f.sql}`
  ).get(...f.args).v;

  // Franquias ainda em implantação que começaram fora do período escolhido.
  const fora = foraDoPeriodo('started_at', p);
  const emAndamentoFora = p.ativo
    ? db.prepare(
      `SELECT COUNT(*) n FROM onboardings WHERE situacao = 'ativo' AND stage <> 'concluido'${fora.sql}`
    ).get(...fora.args).n
    : 0;

  return {
    etapas: STAGES.map((s) => ({ ...s, n: porEtapa[s.key] ?? 0 })),
    em_andamento: ativos.filter((o) => o.stage !== 'concluido').length,
    paradas: ativos.filter((o) => o.parada).length,
    bloqueadas: ativos.filter((o) => o.bloqueada).length,
    concluidos,
    dias_medios_para_concluir: tempoMedio ? Math.round(tempoMedio * 10) / 10 : 0,
    alerta_dias: PARADO_DIAS,
    em_andamento_fora_do_periodo: emAndamentoFora
  };
}

export const onboardingMeta = { STAGES, TASK_TEMPLATE, TASK_STATUSES, PARADO_DIAS };
