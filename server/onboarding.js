import { all, one, run, tx, log } from './db.js';
import { lerPeriodo, filtroPeriodo, foraDoPeriodo } from './periodo.js';

// Responsável padrão quando não há usuário logado (agente, importação, seed).
const CS_PADRAO = process.env.CRM_CS_PADRAO ?? 'Guilherme';

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

// Fora de transação as consultas vão direto no pool; dentro, recebem o `t` do tx().
const db = { all, one, run };

/* ------------------------------ prazo do onboarding ---------------------------
   Meta do bônus de agilidade do CS: todas as tarefas concluídas em até 5 dias,
   contados do início do onboarding até a conclusão.
   Dias corridos por padrão; CRM_ONBOARDING_PRAZO_UTEIS=1 pula sábados e domingos. */
export const PRAZO_DIAS = Number(process.env.CRM_ONBOARDING_PRAZO_DIAS ?? 5);
export const PRAZO_UTEIS = process.env.CRM_ONBOARDING_PRAZO_UTEIS === '1';
// Fuso usado para saber se um dia é fim de semana (Brasília, sem horário de verão).
const FUSO_HORAS = Number(process.env.CRM_FUSO_HORAS ?? -3);
const DIA = 8.64e7;

export function prazoFinal(inicio) {
  const comeco = typeof inicio === 'number' ? inicio : parse(inicio);
  if (!PRAZO_UTEIS) return comeco + PRAZO_DIAS * DIA;
  let fim = comeco;
  let contados = 0;
  while (contados < PRAZO_DIAS) {
    fim += DIA;
    const diaDaSemana = new Date(fim + FUSO_HORAS * 3.6e6).getUTCDay();
    if (diaDaSemana !== 0 && diaDaSemana !== 6) contados += 1;
  }
  return fim;
}

function situacaoDoPrazo(row) {
  const inicio = parse(row.started_at);
  const vence = prazoFinal(inicio);
  const fim = row.concluded_at ? parse(row.concluded_at) : Date.now();
  const decorridos = Math.max(0, (fim - inicio) / DIA);
  const base = {
    dias: PRAZO_DIAS,
    uteis: PRAZO_UTEIS,
    vence_em: new Date(vence).toISOString(),
    dias_decorridos: Math.round(decorridos * 10) / 10
  };
  // Concluída antes de existir o CRM: não dá para medir a agilidade, então não conta na meta.
  if (row.fora_da_meta) return { ...base, situacao: 'anterior', dentro: null };
  if (row.concluded_at) {
    const dentro = parse(row.concluded_at) <= vence;
    return { ...base, situacao: dentro ? 'no_prazo' : 'fora_do_prazo', dentro };
  }
  const restante = (vence - Date.now()) / DIA;
  let situacao = 'em_dia';
  if (restante < 0) situacao = 'estourado';
  else if (restante <= 1) situacao = 'vence_logo';
  return {
    ...base,
    situacao,
    dentro: null,
    dias_restantes: Math.round(restante * 10) / 10
  };
}

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

function tasksOf(id, q = db) {
  return q.all(`SELECT * FROM onboarding_tasks WHERE onboarding_id = ? ORDER BY position, id`, [id]);
}

function decorate(row, tasks, agentePausado) {
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
    parada: row.stage !== 'concluido' && row.situacao === 'ativo' && diasNaEtapa >= PARADO_DIAS,
    prazo: situacaoDoPrazo(row),
    agente_pausado: agentePausado
  };
}

// Tarefas e pausas de uma lista inteira em duas consultas, em vez de duas por linha.
async function decorarTodos(rows) {
  if (!rows.length) return [];
  const tarefas = await all(
    `SELECT * FROM onboarding_tasks WHERE onboarding_id = ANY(?) ORDER BY onboarding_id, position, id`,
    [rows.map((r) => r.id)]
  );
  const porOnboarding = new Map();
  for (const t of tarefas) {
    if (!porOnboarding.has(t.onboarding_id)) porOnboarding.set(t.onboarding_id, []);
    porOnboarding.get(t.onboarding_id).push(t);
  }
  // A tabela de pausas é escrita em pausas.js; aqui só se consulta.
  const grupos = rows.map((r) => r.whatsapp_group_id).filter(Boolean);
  const pausados = new Set(grupos.length
    ? (await all(`SELECT group_id FROM agent_pausas WHERE group_id = ANY(?)`, [grupos])).map((r) => r.group_id)
    : []);
  return rows.map((r) => decorate(r, porOnboarding.get(r.id) ?? [], pausados.has(r.whatsapp_group_id)));
}

export async function listOnboardings({ q = '', stage = '', situacao = 'ativo', desde = '', ate = '' } = {}) {
  const periodo = filtroPeriodo('started_at', lerPeriodo({ desde, ate }));
  let sql = `SELECT * FROM onboardings WHERE 1=1${periodo.sql}`;
  const args = [...periodo.args];
  if (situacao && situacao !== 'todas') { sql += ` AND situacao = ?`; args.push(situacao); }
  if (stage) { sql += ` AND stage = ?`; args.push(stage); }
  if (q) {
    sql += ` AND (franchise_name ILIKE ? OR contact_name ILIKE ? OR whatsapp_group_name ILIKE ? OR phone ILIKE ?)`;
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ` ORDER BY stage_changed_at ASC LIMIT 500`;
  return decorarTodos(await all(sql, args));
}

export async function getOnboarding(id) {
  const row = await one(`SELECT * FROM onboardings WHERE id = ?`, [id]);
  if (!row) throw naoEncontrado();
  return (await decorarTodos([row]))[0];
}

/* --------------------------- ligação com os contatos -------------------------- */

/**
 * Toda franquia na esteira também é um contato do CRM: é assim que as mensagens
 * dela chegam já identificadas na triagem. Se já existe contato com o mesmo
 * telefone, reaproveita em vez de duplicar.
 */
async function sincronizarContato(onboarding, { actor = 'sistema', t = db } = {}) {
  const digitos = telefoneEmDigitos(onboarding.phone);
  let contato = onboarding.contact_id
    ? await t.one(`SELECT * FROM contacts WHERE id = ?`, [onboarding.contact_id])
    : null;

  if (!contato && digitos) {
    contato = (await t.one(
      `SELECT * FROM contacts WHERE replace(replace(replace(replace(phone,'+',''),'-',''),' ',''),'(','') LIKE ?`,
      [`%${digitos.slice(-11)}%`]
    )) ?? null;
  }
  if (!contato) {
    contato = (await t.one(`SELECT * FROM contacts WHERE lower(company) = lower(?)`, [onboarding.franchise_name])) ?? null;
  }

  const nome = onboarding.contact_name?.trim() || onboarding.franchise_name;
  if (contato) {
    await t.run(`UPDATE contacts SET name = ?, company = ?, phone = ?, is_customer = true,
      owner = CASE WHEN owner = '' THEN ? ELSE owner END,
      tags = CASE WHEN tags LIKE '%franquia%' THEN tags
                  WHEN tags = '' THEN 'franquia'
                  ELSE tags || ', franquia' END,
      updated_at = ? WHERE id = ?`,
    [nome, onboarding.franchise_name, onboarding.phone ?? '', onboarding.owner ?? '', now(), contato.id]);
  } else {
    const { id } = await t.run(`
      INSERT INTO contacts (name, company, phone, stage, owner, tags, is_customer)
      VALUES (?, ?, ?, 'cliente', ?, 'franquia', true) RETURNING id
    `, [nome, onboarding.franchise_name, onboarding.phone ?? '', onboarding.owner ?? CS_PADRAO]);
    contato = await t.one(`SELECT * FROM contacts WHERE id = ?`, [id]);
    await log('contato_criado', `${nome} (franquia ${onboarding.franchise_name})`,
      { contactId: contato.id, onboardingId: onboarding.id, actor, t });
  }

  await t.run(`UPDATE onboardings SET contact_id = ?, updated_at = ? WHERE id = ?`, [contato.id, now(), onboarding.id]);

  // Mensagens antigas desse telefone passam a apontar para o contato.
  if (digitos) {
    const finalDoNumero = `%${digitos.slice(-8)}`;
    await t.run(`UPDATE messages SET contact_id = ?, updated_at = ?
                 WHERE contact_id IS NULL AND sender_handle <> '' AND
                       replace(replace(replace(replace(sender_handle,'+',''),'-',''),' ',''),'(','') LIKE ?`,
    [contato.id, now(), finalDoNumero]);
  }
  return contato;
}

/* ---------------------------------- escrita --------------------------------- */

export async function createOnboarding(input = {}) {
  const nome = (input.franchise_name ?? '').trim();
  if (!nome) throw bad('O nome da franquia é obrigatório.');
  if (input.started_at !== undefined && input.started_at !== null && input.started_at !== '') {
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(input.started_at))) throw bad('Data de início inválida.');
    if (parse(String(input.started_at)) > Date.now() + 60000) throw bad('A data de início não pode estar no futuro.');
  } else {
    input = { ...input, started_at: undefined };
  }
  if (input.stage && !STAGE_KEYS.includes(input.stage)) throw bad('Etapa inválida.');

  if (input.whatsapp_group_id) {
    const existente = await one(`SELECT id FROM onboardings WHERE whatsapp_group_id = ?`, [input.whatsapp_group_id]);
    if (existente) return getOnboarding(existente.id);
  }

  const actor = input.actor ?? 'sistema';
  const id = await tx(async (t) => {
    // Dois avisos do mesmo grupo podem chegar juntos: só o primeiro cria.
    const { id } = await t.run(`
      INSERT INTO onboardings (franchise_name, contact_name, phone, plan, owner, stage, notes,
                               origem, whatsapp_group_id, whatsapp_group_name, whatsapp_group_link,
                               contact_id, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (whatsapp_group_id) DO NOTHING RETURNING id
    `, [
      nome, input.contact_name ?? '', input.phone ?? '', input.plan ?? '',
      input.owner ?? CS_PADRAO, input.stage ?? 'nova', input.notes ?? '',
      input.origem ?? 'manual', input.whatsapp_group_id ?? null,
      input.whatsapp_group_name ?? '', linkDoGrupo(input.whatsapp_group_link),
      input.contact_id ?? null, input.started_at ?? now()
    ]);
    if (!id) return null;

    for (const task of TASK_TEMPLATE) {
      await t.run(`INSERT INTO onboarding_tasks (onboarding_id, task_key, title, position) VALUES (?, ?, ?, ?)`,
        [id, task.task_key, task.title, task.position]);
    }
    await log('onboarding_criado', `${nome} (${input.origem ?? 'manual'})`, { onboardingId: id, actor, t });
    await sincronizarContato(await t.one(`SELECT * FROM onboardings WHERE id = ?`, [id]), { actor, t });
    return id;
  });

  if (id) return getOnboarding(id);
  const existente = await one(`SELECT id FROM onboardings WHERE whatsapp_group_id = ?`, [input.whatsapp_group_id]);
  return getOnboarding(existente.id);
}

export async function updateOnboarding(id, patch = {}) {
  await getOnboarding(id);
  const campos = ['franchise_name', 'contact_name', 'phone', 'plan', 'owner', 'notes',
    'whatsapp_group_name', 'whatsapp_group_link', 'situacao', 'started_at'];
  const sets = [];
  const args = [];
  const atual = await one(`SELECT * FROM onboardings WHERE id = ?`, [id]);
  for (const f of campos) {
    if (patch[f] === undefined) continue;
    if (f === 'started_at') {
      // O prazo do bônus conta daqui, então a data precisa ser válida e plausível.
      const valor = String(patch[f]);
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(valor)) throw bad('Data de início inválida.');
      if (parse(valor) > Date.now() + 60000) throw bad('A data de início não pode estar no futuro.');
      if (atual.concluded_at && valor > atual.concluded_at) throw bad('A data de início não pode ser depois da conclusão.');
      if (valor === atual.started_at) continue;
      sets.push('started_at = ?');
      args.push(valor);
      continue;
    }
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
    const actor = patch.actor ?? 'sistema';
    await tx(async (t) => {
      await t.run(`UPDATE onboardings SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...args, now(), id]);
      await log('onboarding_atualizado', sets.map((s) => s.split(' =')[0]).join(', '), { onboardingId: id, actor, t });
      await sincronizarContato(await t.one(`SELECT * FROM onboardings WHERE id = ?`, [id]), { actor, t });
    });
  }
  return getOnboarding(id);
}

export async function moveStage(id, stage, { actor = 'sistema' } = {}) {
  const atual = await getOnboarding(id);
  if (!STAGE_KEYS.includes(stage)) throw bad('Etapa inválida.');
  if (stage === atual.stage) return atual;

  const destino = STAGE_KEYS.indexOf(stage);
  await tx(async (t) => {
    // Avançar na esteira marca como feitas as tarefas que ficaram para trás.
    for (const task of atual.tasks) {
      const posicao = STAGE_KEYS.indexOf(task.task_key);
      const deveEstarFeita = posicao < destino;
      if (deveEstarFeita && task.status === 'pendente') {
        await t.run(`UPDATE onboarding_tasks SET status = 'feito', done_at = ?, updated_at = ? WHERE id = ?`,
          [now(), now(), task.id]);
      }
      if (!deveEstarFeita && task.status === 'feito') {
        await t.run(`UPDATE onboarding_tasks SET status = 'pendente', done_at = NULL, updated_at = ? WHERE id = ?`,
          [now(), task.id]);
      }
    }

    await t.run(`UPDATE onboardings SET stage = ?, stage_changed_at = ?, concluded_at = ?, updated_at = ? WHERE id = ?`,
      [stage, now(), stage === 'concluido' ? now() : null, now(), id]);

    const rotulo = STAGES.find((s) => s.key === stage).label;
    await log('onboarding_etapa', `${atual.franchise_name} → ${rotulo}`, { onboardingId: id, actor, t });
  });
  return getOnboarding(id);
}

/** Marca uma franquia importada já concluída: ela fica fora da meta de agilidade. */
export async function marcarAnteriorAoCrm(id, { actor = 'sistema' } = {}) {
  const atual = await getOnboarding(id);
  await run(`UPDATE onboardings SET fora_da_meta = true, updated_at = ? WHERE id = ?`, [now(), id]);
  await log('onboarding_meta', `${atual.franchise_name}: concluída antes do CRM, fora da meta de ${PRAZO_DIAS} dias`, { onboardingId: id, actor });
  return getOnboarding(id);
}

export async function setTask(id, taskKey, patch = {}) {
  const atual = await getOnboarding(id);
  const task = atual.tasks.find((t) => t.task_key === taskKey);
  if (!task) throw Object.assign(new Error('Tarefa não encontrada.'), { status: 404 });
  if (patch.status !== undefined && !TASK_STATUSES.includes(patch.status)) {
    throw bad(`Status inválido. Use: ${TASK_STATUSES.join(', ')}.`);
  }

  const status = patch.status ?? task.status;
  await tx(async (t) => {
    await t.run(`UPDATE onboarding_tasks SET status = ?, note = ?, done_at = ?, updated_at = ? WHERE id = ?`,
      [status, patch.note ?? task.note, status === 'feito' ? (task.done_at ?? now()) : null, now(), task.id]);

    await log('onboarding_tarefa', `${task.title}: ${status}`, { onboardingId: id, actor: patch.actor ?? 'sistema', t });

    // A etapa do card passa a ser a primeira tarefa que ainda falta.
    const tasks = await tasksOf(id, t);
    const pendente = tasks.find((x) => x.status !== 'feito');
    const novaEtapa = pendente ? pendente.task_key : 'concluido';
    const saiuDaEntrada = atual.stage !== 'nova' || tasks.some((x) => x.status !== 'pendente');
    if (saiuDaEntrada && novaEtapa !== atual.stage) {
      await t.run(`UPDATE onboardings SET stage = ?, stage_changed_at = ?, concluded_at = ?, updated_at = ? WHERE id = ?`,
        [novaEtapa, now(), novaEtapa === 'concluido' ? now() : null, now(), id]);
    }
  });
  return getOnboarding(id);
}

export async function deleteOnboarding(id) {
  await getOnboarding(id);
  await run(`DELETE FROM onboardings WHERE id = ?`, [id]);
  return { ok: true };
}

export async function onboardingActivities(id) {
  return all(`SELECT * FROM activities WHERE onboarding_id = ? ORDER BY created_at DESC LIMIT 50`, [id]);
}

/* --------------------- entrada automática pelo WhatsApp --------------------- */

/**
 * Recebe um grupo novo do WhatsApp do Guilherme e abre o onboarding sozinho.
 * O nome da franquia sai do nome do grupo, já sem os prefixos que o time usa.
 */
export async function fromWhatsappGroup(input = {}) {
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
    owner: input.owner ?? CS_PADRAO,
    origem: 'whatsapp',
    started_at: input.created_at ?? now(),
    actor: 'whatsapp'
  });
}

export function nomeDaFranquia(groupName) {
  return groupName
    // Grupos das unidades CDT: "CDT - Guriri ES", "CDT.IA - Varginha", "IA CDT - Campo Limpo".
    .replace(/^\s*(ia\s+)?cdt(\.ia)?\s*[-–—:|]\s*/i, '')
    .replace(/^\s*(onboarding|implanta[çc][ãa]o|suporte|grupo|equipe|time)\s*[-–—:|]\s*/i, '')
    .replace(/\s*[-–—|]\s*(onboarding|implanta[çc][ãa]o|suporte|oficial)\s*$/i, '')
    .replace(/\s*[×x]\s*7bee\s*$/i, '')
    .replace(/^\s*7bee\s*[×x]\s*/i, '')
    .trim() || groupName.trim();
}

// O que a triagem mostra de uma franquia no card da mensagem.
function resumoDoOnboarding(row) {
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

/** Onboarding ligado a um contato, para a triagem mostrar a franquia e o grupo. */
export async function onboardingDoContato(contactId) {
  if (!contactId) return null;
  const row = await one(`SELECT * FROM onboardings WHERE contact_id = ? ORDER BY updated_at DESC LIMIT 1`, [contactId]);
  return row ? resumoDoOnboarding(row) : null;
}

/** O mesmo, para uma lista de contatos de uma vez: Map contact_id → resumo. */
export async function onboardingsDosContatos(contactIds) {
  const ids = [...new Set(contactIds.filter(Boolean))];
  const mapa = new Map();
  if (!ids.length) return mapa;
  const rows = await all(
    `SELECT DISTINCT ON (contact_id) * FROM onboardings WHERE contact_id = ANY(?) ORDER BY contact_id, updated_at DESC`,
    [ids]
  );
  for (const row of rows) mapa.set(row.contact_id, resumoDoOnboarding(row));
  return mapa;
}

/* -------------------------------- indicadores ------------------------------- */

export async function onboardingStats({ desde = '', ate = '' } = {}) {
  const p = lerPeriodo({ desde, ate });
  const f = filtroPeriodo('started_at', p);
  const porEtapa = Object.fromEntries(
    (await all(`SELECT stage, COUNT(*) n FROM onboardings WHERE situacao = 'ativo'${f.sql} GROUP BY stage`, f.args))
      .map((r) => [r.stage, r.n])
  );
  const ativos = await listOnboardings({ situacao: 'ativo', desde, ate });
  const concluidos = (await one(`SELECT COUNT(*) n FROM onboardings WHERE stage = 'concluido'${f.sql}`, f.args)).n;
  const tempoMedio = (await one(
    `SELECT AVG(extract(epoch from (concluded_at - started_at)) / 86400.0) v
     FROM onboardings WHERE concluded_at IS NOT NULL AND NOT fora_da_meta${f.sql}`, f.args
  )).v;

  // Franquias ainda em implantação que começaram fora do período escolhido.
  const fora = foraDoPeriodo('started_at', p);
  const emAndamentoFora = p.ativo
    ? (await one(
      `SELECT COUNT(*) n FROM onboardings WHERE situacao = 'ativo' AND stage <> 'concluido'${fora.sql}`, fora.args
    )).n
    : 0;

  const concluidasNoPeriodo = (await all(
    `SELECT * FROM onboardings WHERE concluded_at IS NOT NULL AND situacao <> 'cancelado' AND NOT fora_da_meta${f.sql}`, f.args
  )).map((r) => situacaoDoPrazo(r));
  const noPrazo = concluidasNoPeriodo.filter((p) => p.dentro).length;
  const emAndamento = ativos.filter((o) => o.stage !== 'concluido');
  const anterioresAoCrm = (await one(`SELECT COUNT(*) n FROM onboardings WHERE fora_da_meta${f.sql}`, f.args)).n;

  return {
    prazo: {
      dias: PRAZO_DIAS,
      uteis: PRAZO_UTEIS,
      concluidas: concluidasNoPeriodo.length,
      no_prazo: noPrazo,
      fora_do_prazo: concluidasNoPeriodo.length - noPrazo,
      taxa_no_prazo: concluidasNoPeriodo.length ? Math.round((noPrazo / concluidasNoPeriodo.length) * 100) : 0,
      em_andamento_estourado: emAndamento.filter((o) => o.prazo.situacao === 'estourado').length,
      em_andamento_vence_logo: emAndamento.filter((o) => o.prazo.situacao === 'vence_logo').length,
      anteriores_ao_crm: anterioresAoCrm
    },
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

export const onboardingMeta = { STAGES, TASK_TEMPLATE, TASK_STATUSES, PARADO_DIAS, PRAZO_DIAS, PRAZO_UTEIS };
