const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const CS_PADRAO = 'Guilherme';

const FILAS = {
  precisa: { needs_human: '1' },
  aguardando: { aguardando_agente: '1' },
  auto: { status: 'auto_respondida' },
  respondidas: { status: 'respondida' },
  arquivadas: { status: 'arquivada' },
  todas: {}
};

const state = {
  view: 'triagem',
  fila: 'precisa',
  msgFilters: { q: '', priority: '', channel: '', sort: 'score' },
  contactFilters: { q: '', stage: '' }
};

/* --------------------------------- helpers -------------------------------- */

async function apiCall(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Falha na requisição (${res.status})`);
  return data;
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Números no formato brasileiro: 7,3h e não 7.3h.
const num = (v) => (typeof v === 'number' ? v.toLocaleString('pt-BR') : v);

const CANAIS = {
  whatsapp: 'WhatsApp', email: 'E-mail', instagram: 'Instagram',
  site: 'Site', telefone: 'Telefone', chat: 'Chat', outro: 'Outro'
};

// Ícones de traço 2px, sempre ao lado de um rótulo.
const traco = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  check: traco('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  flag: traco('<path d="M5 21V4h11l-2 4 2 4H5"/>'),
  note: traco('<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4"/>'),
  x: traco('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: traco('<path d="M12 5v14M5 12h14"/>'),
  robot: traco('<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/>'),
  copy: traco('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5h10"/>'),
  undo: traco('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>'),
  arrow: traco('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  eye: traco('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3"/>'),
  chat: traco('<path d="M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z"/>'),
  calendar: traco('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  chevron: traco('<path d="M6 9l6 6 6-6"/>'),
  user: traco('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  grid: traco('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  group: traco('<circle cx="9" cy="9" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 7a3 3 0 0 1 0 6M18 20a6 6 0 0 0-2-4.5"/>')
};

function waitLabel(hours) {
  if (hours < 1) return `há ${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `há ${Math.round(hours)} h`;
  return `há ${Math.round(hours / 24)} dias`;
}

const debounce = (fn, ms = 300) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

/* ---------------------------------- modal --------------------------------- */

function openModal({ title, fields, confirmLabel = 'Salvar' }) {
  return new Promise((resolve) => {
    const dialog = $('#modal');
    $('#modal-title').textContent = title;
    $('#modal-confirm').textContent = confirmLabel;
    $('#modal-body').innerHTML = fields.map((f) => {
      const req = f.required ? 'required' : '';
      if (f.type === 'textarea') {
        return `<label>${esc(f.label)}<textarea name="${f.name}" ${req}>${esc(f.value ?? '')}</textarea></label>`;
      }
      if (f.type === 'select') {
        const opts = f.options.map((o) =>
          `<option value="${esc(o.value)}"${o.value === f.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
        return `<label>${esc(f.label)}<select name="${f.name}">${opts}</select></label>`;
      }
      if (f.type === 'checkbox') {
        return `<label class="check">
          <input type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''} />
          ${esc(f.label)}</label>`;
      }
      return `<label>${esc(f.label)}<input type="${f.type ?? 'text'}" name="${f.name}" value="${esc(f.value ?? '')}" ${req} /></label>`;
    }).join('');

    dialog.showModal();
    $('#modal-form').onsubmit = null;
    dialog.addEventListener('close', function handler() {
      dialog.removeEventListener('close', handler);
      if (dialog.returnValue !== 'confirm') return resolve(null);
      const data = new FormData($('#modal-form'));
      const out = {};
      for (const f of fields) {
        out[f.name] = f.type === 'checkbox' ? data.get(f.name) === 'on' : (data.get(f.name) ?? '');
      }
      resolve(out);
    });
  });
}

/* --------------------------------- período -------------------------------- */

// O navegador calcula o início e o fim do dia local e manda em UTC, no mesmo
// formato que o banco guarda. Assim "hoje" é o hoje de quem está usando.
const utc = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const inicioDoDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
const fimDoDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
const somaDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const ddmm = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

const PERIODOS = {
  tudo: { rotulo: 'Todo o período', faixa: () => null },
  hoje: { rotulo: 'Hoje', faixa: (h) => [inicioDoDia(h), fimDoDia(h)] },
  ontem: { rotulo: 'Ontem', faixa: (h) => [inicioDoDia(somaDias(h, -1)), fimDoDia(somaDias(h, -1))] },
  '7d': { rotulo: 'Últimos 7 dias', faixa: (h) => [inicioDoDia(somaDias(h, -6)), fimDoDia(h)] },
  mes: { rotulo: 'Este mês', faixa: (h) => [new Date(h.getFullYear(), h.getMonth(), 1), fimDoDia(h)] },
  mes_anterior: {
    rotulo: 'Mês anterior',
    faixa: (h) => [new Date(h.getFullYear(), h.getMonth() - 1, 1), fimDoDia(new Date(h.getFullYear(), h.getMonth(), 0))]
  },
  '30d': { rotulo: 'Últimos 30 dias', faixa: (h) => [inicioDoDia(somaDias(h, -29)), fimDoDia(h)] }
};

const periodo = { chave: 'tudo', inicio: null, fim: null };

function faixaAtual() {
  if (periodo.chave === 'custom') {
    return periodo.inicio && periodo.fim ? [periodo.inicio, periodo.fim] : null;
  }
  return PERIODOS[periodo.chave]?.faixa(new Date()) ?? null;
}

/** Acrescenta o período escolhido aos parâmetros de qualquer consulta. */
function comPeriodo(params = new URLSearchParams()) {
  const faixa = faixaAtual();
  if (faixa) {
    params.set('desde', utc(faixa[0]));
    params.set('ate', utc(faixa[1]));
  }
  return params;
}

function rotuloDoPeriodo() {
  const faixa = faixaAtual();
  const rotulo = periodo.chave === 'custom' ? 'Personalizado' : PERIODOS[periodo.chave].rotulo;
  if (!faixa) return { rotulo, faixa: '' };
  const [a, b] = faixa;
  return { rotulo, faixa: ddmm(a) === ddmm(b) ? ddmm(a) : `${ddmm(a)}–${ddmm(b)}` };
}

function avisoForaDoPeriodo(alvo, quantidade, texto) {
  const caixa = $(alvo);
  if (!quantidade) { caixa.hidden = true; caixa.innerHTML = ''; return; }
  caixa.hidden = false;
  caixa.innerHTML = `
    <div class="sb-notice" role="status">
      <span><b>${quantidade}</b> ${texto}</span>
      <button class="sb-btn sb-btn--sm" type="button" data-periodo-tudo>Ver todo o período</button>
    </div>`;
}

/* --------------------------------- triagem -------------------------------- */

function agentBlock(m) {
  if (!m.agent_decision) {
    return m.agente_atrasado
      ? `<div class="sb-agent sb-agent--waiting is-late">O agente ainda não decidiu esta mensagem
           (${waitLabel(m.waiting_hours)}). Talvez ele esteja fora do ar.</div>`
      : `<div class="sb-agent sb-agent--waiting">Aguardando a análise do agente.</div>`;
  }

  const decisao = {
    respondeu: 'Respondeu sozinho',
    escalou: 'Escalou para você',
    ignorou: 'Descartou'
  }[m.agent_decision] ?? m.agent_decision;
  const escalou = Boolean(m.needs_human);
  const conf = m.agent_confidence === null || m.agent_confidence === undefined
    ? null : Math.round(m.agent_confidence * 100);
  const texto = m.agent_reply || m.agent_suggested_reply;
  const rotulo = m.agent_reply ? 'Respondeu ao cliente' : 'Rascunho sugerido para você';

  return `
    <div class="sb-agent ${escalou ? 'sb-agent--escalated' : 'sb-agent--resolved'}">
      <div class="sb-agent__head">
        <span class="sb-agent__who">${ICON.robot}${esc(m.agent_name || 'agente')}</span>
        <span class="sb-badge ${escalou ? 'sb-badge--honey' : 'sb-badge--info'} sb-badge--plain">${esc(decisao)}</span>
        ${m.agent_intent ? `<span>${esc(m.agent_intent)}</span>` : ''}
        ${conf === null ? '' : `<span class="sb-conf">confiança
          <span class="sb-conf__bar"><i style="width:${conf}%"></i></span>
          <span class="sb-score">${conf}%</span></span>`}
      </div>
      ${m.agent_reason ? `<div class="sb-agent__reason"><b>Motivo:</b> ${esc(m.agent_reason)}</div>` : ''}
      ${texto ? `<details><summary>${rotulo}</summary><p>${esc(texto)}</p>
        <button type="button" class="sb-btn sb-btn--sm" data-act="copiar" data-id="${m.id}">
          ${ICON.copy}Copiar texto</button></details>` : ''}
    </div>`;
}

function feedbackRow(m) {
  if (!m.agent_decision) return '';
  if (m.human_feedback) {
    const rotulo = {
      acertou: 'Você marcou: o agente acertou',
      deveria_escalar: 'Você marcou: deveria ter escalado',
      nao_precisava_escalar: 'Você marcou: não precisava escalar',
      resposta_ruim: 'Você marcou: a resposta ficou ruim'
    }[m.human_feedback] ?? m.human_feedback;
    return `<div class="sb-feedback">${esc(rotulo)}</div>`;
  }
  const opcao = (valor, rotulo, classe = 'sb-btn--ghost', icone = '') =>
    `<button class="sb-btn sb-btn--sm ${classe}" data-act="feedback" data-id="${m.id}"
      data-feedback="${valor}">${icone}${rotulo}</button>`;
  return `<div class="sb-feedback">O agente acertou?
    ${opcao('acertou', 'Acertou', 'sb-btn--success', ICON.check)}
    ${m.needs_human
      ? opcao('nao_precisava_escalar', 'Não precisava me chamar')
      : opcao('deveria_escalar', 'Deveria ter me chamado')}
    ${m.agent_reply ? opcao('resposta_ruim', 'Resposta ruim') : ''}</div>`;
}

function whyChips(reasons) {
  if (!reasons) return '';
  const chips = reasons.split(' · ').map((fator) => {
    const [, sinal, rotulo] = fator.match(/^([+-]\d+)\s+(.*)$/) ?? [null, '', fator];
    return `<span>${sinal ? `<b>${esc(sinal)}</b> ` : ''}${esc(rotulo)}</span>`;
  }).join('');
  return `<div class="sb-why">Por que priorizar: ${chips}</div>`;
}

function iniciaisDe(nome) {
  const partes = String(nome ?? '').trim().split(/\s+/).slice(0, 2);
  return partes.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function messageCard(m) {
  const done = ['respondida', 'arquivada', 'auto_respondida'].includes(m.status);
  const nome = m.contact_name ?? m.sender_name;

  const prioridade = { alta: 'Alta', media: 'Média', baixa: 'Baixa' }[m.priority] ?? m.priority;
  const prioBadge = `<span class="sb-badge ${m.priority === 'alta' ? 'sb-badge--danger' : ''} sb-badge--plain">${prioridade}</span>`;
  const status = {
    triagem: '<span class="sb-badge">Em análise do agente</span>',
    escalada: '<span class="sb-badge sb-badge--honey">Precisa de você</span>',
    auto_respondida: '<span class="sb-badge sb-badge--info">Agente respondeu</span>',
    respondida: '<span class="sb-badge sb-badge--success">Respondida</span>',
    arquivada: '<span class="sb-badge">Descartada</span>'
  }[m.status] ?? '';

  const regua = m.priority === 'alta' ? '' : m.priority === 'media' ? ' sb-msg__prio--mid' : ' sb-msg__prio--low';
  const org = [
    m.contact_company,
    m.is_customer ? 'cliente ativo' : null,
    m.onboarding ? `onboarding em ${m.onboarding.stage_label}` : null
  ].filter(Boolean).join(' · ');

  const abrirWhats = m.whatsapp_link
    ? `<a class="sb-btn" href="${esc(m.whatsapp_link)}" target="_blank" rel="noopener noreferrer">
         ${m.whatsapp_destino === 'grupo' ? `${ICON.group}Abrir grupo` : `${ICON.chat}Abrir conversa`}
       </a>`
    : '';

  const acoes = done
    ? `<button class="sb-btn" data-act="reabrir" data-id="${m.id}">${ICON.undo}Assumir de volta</button>${abrirWhats}`
    : `<button class="sb-btn sb-btn--primary" data-act="responder" data-id="${m.id}">${ICON.check}Marcar respondida</button>
       ${m.status === 'triagem'
        ? `<button class="sb-btn" data-act="escalar" data-id="${m.id}">${ICON.arrow}Trazer para mim</button>` : ''}
       <button class="sb-btn" data-act="prioridade" data-id="${m.id}">${ICON.flag}Prioridade</button>
       <button class="sb-btn" data-act="nota" data-id="${m.id}">${ICON.note}Nota</button>
       ${abrirWhats}
       <button class="sb-btn sb-btn--danger" data-act="arquivar" data-id="${m.id}">${ICON.x}Descartar</button>`;

  return `
  <article class="sb-msg ${done ? 'is-done' : ''}">
    <span class="sb-msg__prio${regua}" aria-hidden="true"></span>
    <div class="sb-msg__head">
      <span class="sb-avatar">${esc(iniciaisDe(nome))}</span>
      <div class="sb-msg__who">
        <span class="sb-msg__name">${esc(nome)}</span>
        ${org ? `<span class="sb-msg__org">${esc(org)}</span>` : ''}
      </div>
      <div class="sb-msg__meta">
        ${prioBadge}
        <span class="sb-score ${m.score >= 80 ? 'sb-score--high' : ''}">${m.score}</span>
        ${status}
        ${m.overdue ? '<span class="sb-badge sb-badge--danger">Fora do prazo</span>' : ''}
        <span>${esc(CANAIS[m.channel] ?? m.channel)} · ${waitLabel(m.waiting_hours)}</span>
      </div>
    </div>
    ${m.subject ? `<div class="sb-msg__org">${esc(m.subject)}</div>` : ''}
    <p class="sb-msg__text">${esc(m.body)}</p>
    ${agentBlock(m)}
    ${whyChips(m.reasons)}
    <div class="sb-msg__actions">
      ${acoes}
      <span class="sb-msg__owner">Responsável: <b>${esc(m.assigned_to || 'ninguém')}</b></span>
    </div>
    ${m.internal_note ? `<div class="sb-msg__note">${esc(m.internal_note)}</div>` : ''}
    ${feedbackRow(m)}
  </article>`;
}

async function renderMessages() {
  const params = comPeriodo(new URLSearchParams(
    Object.entries({ ...state.msgFilters, ...FILAS[state.fila] }).filter(([, v]) => v)
  ));
  const list = await apiCall(`/messages?${params}`);
  $('#msg-list').innerHTML = list.length
    ? list.map(messageCard).join('')
    : '<div class="empty">Nenhuma mensagem com esses filtros.</div>';
}

// tom: 'accent' (lima, o destaque positivo), 'attention' (amarelo, precisa de
// gente) ou 'danger' (vermelho). Sem tom, o card fica neutro.
function statCard({ label, value, delta = null, tom = '', barra = null }) {
  return `
    <div class="sb-stat ${tom ? `sb-stat--${tom}` : ''}">
      <span class="sb-stat__label">${esc(label)}</span>
      <span class="sb-stat__value">${esc(value)}</span>
      ${delta ? `<span class="sb-stat__delta ${delta.tom}">${esc(delta.texto)}</span>` : ''}
      ${barra === null ? '' : `<span class="sb-stat__bar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, barra))}%"></i></span>`}
    </div>`;
}

async function renderKpis() {
  const d = await apiCall(`/dashboard?${comPeriodo()}`);
  const horas = `${num(d.tempo_medio_resposta_horas)}h`;
  const cards = [
    {
      label: 'Precisam de você',
      value: d.escaladas,
      tom: d.escaladas > 0 ? 'attention' : '',
      delta: d.escaladas > 0 ? { tom: '', texto: `${d.alta_prioridade} com prioridade alta` } : { tom: 'is-up', texto: 'Fila vazia' }
    },
    {
      label: 'Fora do prazo',
      value: d.atrasadas,
      tom: d.atrasadas > 0 ? 'danger' : '',
      delta: d.atrasadas === 0 ? { tom: 'is-up', texto: 'Tudo em dia' } : { tom: 'is-down', texto: 'Responder primeiro' }
    },
    { label: 'Aguardando o agente', value: d.aguardando_agente },
    { label: 'Respondidas pelo agente', value: d.auto_respondidas },
    {
      label: 'Resolvidas sem humano',
      value: `${d.taxa_automacao}%`,
      tom: 'accent',
      barra: d.taxa_automacao
    },
    { label: 'Tempo médio de resposta', value: horas }
  ];
  $('#kpis').innerHTML = cards.map(statCard).join('');

  $('#kpis-panel').innerHTML = cards.map(statCard).join('') +
    statCard({ label: 'Contatos', value: num(d.contatos) }) +
    statCard({ label: 'Clientes ativos', value: num(d.clientes) });

  avisoForaDoPeriodo('#msg-notice', d.pendentes_fora_do_periodo,
    d.pendentes_fora_do_periodo === 1
      ? 'mensagem pendente chegou fora deste período e não aparece na fila.'
      : 'mensagens pendentes chegaram fora deste período e não aparecem na fila.');

  // Contadores das abas de filtro.
  const contagens = { precisa: d.escaladas, aguardando: d.aguardando_agente, auto: d.auto_respondidas };
  for (const [chave, valor] of Object.entries(contagens)) {
    const alvo = $(`[data-count="${chave}"]`);
    if (alvo) alvo.textContent = valor;
  }

  const bars = (rows, keyName) => {
    if (!rows.length) return '<div class="sb-msg__org">Sem dados.</div>';
    const max = Math.max(...rows.map((r) => r.n));
    return rows.map((r) => `
      <div class="bar-row"><span>${esc(r[keyName])}</span>
        <span class="bar" style="width:${Math.round((r.n / max) * 100)}%"></span>
        <span class="n">${r.n}</span></div>`).join('');
  };
  $('#chart-channel').innerHTML = bars(
    d.por_canal.map((r) => ({ channel: CANAIS[r.channel] ?? r.channel, n: r.n })), 'channel');
  $('#chart-stage').innerHTML = bars(d.pipeline, 'stage');

  const rotuloDecisao = {
    respondeu: 'respondeu sozinho', escalou: 'escalou para humano',
    ignorou: 'descartou', 'sem decisão': 'ainda sem decisão'
  };
  $('#chart-agent').innerHTML = bars(
    d.por_decisao_do_agente.map((r) => ({ decisao: rotuloDecisao[r.decisao] ?? r.decisao, n: r.n })), 'decisao');

  const rotuloFeedback = {
    acertou: 'acertou', deveria_escalar: 'deveria ter escalado',
    nao_precisava_escalar: 'escalou sem precisar', resposta_ruim: 'resposta ruim'
  };
  $('#chart-feedback').innerHTML = d.feedback_agente.length
    ? bars(d.feedback_agente.map((r) => ({ feedback: rotuloFeedback[r.feedback] ?? r.feedback, n: r.n })), 'feedback')
    : '<div class="sb-msg__org">Ninguém avaliou o agente ainda. Use os botões nos cards da triagem.</div>';
}

async function handleMessageAction(act, id) {
  if (act === 'responder') await apiCall(`/messages/${id}`, { method: 'PATCH', body: { status: 'respondida', actor: CS_PADRAO } });
  else if (act === 'escalar') await apiCall(`/messages/${id}`, { method: 'PATCH', body: { status: 'escalada', assigned_to: CS_PADRAO, actor: CS_PADRAO } });
  else if (act === 'copiar') {
    const m = await apiCall(`/messages/${id}`);
    const texto = m.agent_reply || m.agent_suggested_reply;
    try {
      await navigator.clipboard.writeText(texto);
      toast('Texto copiado.');
    } catch {
      toast('Seu navegador bloqueou a cópia. Selecione o texto na tela.');
    }
    return;
  }
  else if (act === 'arquivar') await apiCall(`/messages/${id}`, { method: 'PATCH', body: { status: 'arquivada', actor: CS_PADRAO } });
  else if (act === 'reabrir') await apiCall(`/messages/${id}`, { method: 'PATCH', body: { status: 'escalada', assigned_to: CS_PADRAO, actor: CS_PADRAO } });
  else if (act === 'prioridade') {
    const form = await openModal({
      title: 'Ajustar prioridade',
      fields: [{ name: 'priority', label: 'Prioridade', type: 'select', options: [
        { value: 'alta', label: 'Alta (responder em até 2h)' },
        { value: 'media', label: 'Média (até 8h)' },
        { value: 'baixa', label: 'Baixa (até 24h)' }
      ] }]
    });
    if (!form) return;
    await apiCall(`/messages/${id}`, { method: 'PATCH', body: { ...form, actor: CS_PADRAO } });
  } else if (act === 'nota') {
    const current = await apiCall(`/messages/${id}`);
    const form = await openModal({
      title: 'Nota interna',
      fields: [{ name: 'internal_note', label: 'Nota para a equipe', type: 'textarea', value: current.internal_note }]
    });
    if (!form) return;
    await apiCall(`/messages/${id}`, { method: 'PATCH', body: { ...form, actor: CS_PADRAO } });
  }
  toast('Mensagem atualizada.');
  await Promise.all([renderMessages(), renderKpis()]);
}

async function enviarFeedback(id, feedback) {
  await apiCall(`/messages/${id}/feedback`, { method: 'POST', body: { feedback, actor: CS_PADRAO } });
  toast('Avaliação registrada. Isso ajuda a ajustar o agente.');
  await Promise.all([renderMessages(), renderKpis()]);
}

/* -------------------------------- contatos -------------------------------- */

const STAGES = [
  { value: 'lead', label: 'Lead' }, { value: 'qualificado', label: 'Qualificado' },
  { value: 'proposta', label: 'Proposta' }, { value: 'cliente', label: 'Cliente' },
  { value: 'perdido', label: 'Perdido' }
];

async function renderContacts() {
  const params = comPeriodo(new URLSearchParams(Object.entries(state.contactFilters).filter(([, v]) => v)));
  const rows = await apiCall(`/contacts?${params}`);
  const tbody = $('#contact-table tbody');
  tbody.innerHTML = rows.length ? rows.map((c) => `
    <tr>
      <td><b>${esc(c.name)}</b>${c.tags ? `<div class="meta">${esc(c.tags)}</div>` : ''}</td>
      <td>${esc(c.company || '—')}</td>
      <td class="meta">${esc(c.email || '')}${c.email && c.phone ? '<br>' : ''}${esc(c.phone || '')}</td>
      <td><span class="sb-badge sb-badge--plain">${esc(c.stage)}</span></td>
      <td>${esc(c.owner || '—')}</td>
      <td>${c.is_customer
        ? '<span class="sb-badge sb-badge--success">Cliente</span>'
        : '<span class="meta">não</span>'}</td>
      <td><button class="sb-btn sb-btn--sm" data-contact="${c.id}">Editar</button></td>
    </tr>`).join('')
    : '<tr><td colspan="7" class="empty">Nenhum contato encontrado.</td></tr>';
}

function contactFields(c = {}) {
  return [
    { name: 'name', label: 'Nome', value: c.name, required: true },
    { name: 'company', label: 'Empresa', value: c.company },
    { name: 'email', label: 'E-mail', type: 'email', value: c.email },
    { name: 'phone', label: 'Telefone / WhatsApp', value: c.phone },
    { name: 'stage', label: 'Etapa', type: 'select', options: STAGES, value: c.stage ?? 'lead' },
    { name: 'owner', label: 'Responsável', value: c.owner ?? CS_PADRAO },
    { name: 'tags', label: 'Tags (separadas por vírgula)', value: c.tags },
    { name: 'is_customer', label: 'É cliente ativo (prioriza as mensagens dele)', type: 'checkbox', value: Boolean(c.is_customer) },
    { name: 'notes', label: 'Observações', type: 'textarea', value: c.notes }
  ];
}

/* -------------------------------- onboarding ------------------------------- */

const onb = { stages: [], filtros: { q: '', situacao: 'ativo' } };

async function carregarEtapas() {
  if (onb.stages.length) return onb.stages;
  const meta = await apiCall('/onboarding/meta');
  onb.stages = meta.STAGES;
  return onb.stages;
}

function onbCard(o) {
  const progresso = o.total_tarefas ? Math.round((o.tarefas_feitas / o.total_tarefas) * 100) : 0;
  const etapaAtual = onb.stages.findIndex((s) => s.key === o.stage);
  const proxima = onb.stages[etapaAtual + 1];
  const tags = [];
  if (o.origem === 'whatsapp') tags.push('<span class="sb-badge sb-badge--info">Veio do WhatsApp</span>');
  if (o.bloqueada) tags.push('<span class="sb-badge sb-badge--danger">Tarefa travada</span>');
  if (o.parada) tags.push(`<span class="sb-badge sb-badge--honey">Parada há ${o.dias_na_etapa}d</span>`);

  return `
  <article class="onb" draggable="true" data-id="${o.id}">
    <div class="onb__top">
      <span class="sb-avatar" style="width:28px;height:28px;font-size:11px">${esc(iniciaisDe(o.franchise_name))}</span>
      <span class="onb__name">${esc(o.franchise_name)}</span>
      ${o.whatsapp_link
        ? `<a class="sb-btn sb-btn--sm onb__whats" href="${esc(o.whatsapp_link)}" target="_blank" rel="noopener noreferrer"
             title="${o.whatsapp_destino === 'grupo' ? 'Abrir o grupo da franquia' : 'Abrir a conversa com o contato'}"
             aria-label="${o.whatsapp_destino === 'grupo' ? 'Abrir o grupo da franquia no WhatsApp' : 'Abrir a conversa no WhatsApp'}">
             ${o.whatsapp_destino === 'grupo' ? ICON.group : ICON.chat}</a>`
        : ''}
    </div>
    <div class="onb__meta">
      ${esc(o.plan || 'sem plano informado')} · há ${o.dias_desde_o_inicio}d${o.owner ? ` · ${esc(o.owner)}` : ''}
    </div>
    ${tags.length ? `<div class="onb__tags">${tags.join('')}</div>` : ''}
    <div class="progress" title="${o.tarefas_feitas} de ${o.total_tarefas} tarefas">
      <i style="width:${progresso}%"></i>
    </div>
    <div class="onb__actions">
      <button class="sb-btn sb-btn--sm" data-onb="abrir" data-id="${o.id}">${ICON.eye}Abrir</button>
      ${proxima
        ? `<button class="sb-btn sb-btn--sm ${proxima.key === 'concluido' ? 'sb-btn--primary' : ''}"
             data-onb="avancar" data-id="${o.id}" data-stage="${proxima.key}">
             ${proxima.key === 'concluido' ? `${ICON.check}Concluir` : `${ICON.arrow}Avançar`}
           </button>`
        : `<button class="sb-btn sb-btn--sm" data-onb="reabrir" data-id="${o.id}">${ICON.undo}Reabrir</button>`}
    </div>
  </article>`;
}

async function renderOnboarding() {
  await carregarEtapas();
  const params = comPeriodo(new URLSearchParams(Object.entries(onb.filtros).filter(([, v]) => v)));
  const [lista, stats] = await Promise.all([
    apiCall(`/onboarding?${params}`),
    apiCall(`/onboarding/stats?${comPeriodo()}`)
  ]);

  const totalAtivo = stats.em_andamento + stats.concluidos;
  $('#onb-kpis').innerHTML = [
    { label: 'Em implantação', value: stats.em_andamento, tom: 'accent' },
    { label: `Paradas há ${stats.alerta_dias}+ dias`, value: stats.paradas, tom: stats.paradas > 0 ? 'attention' : '' },
    { label: 'Com tarefa travada', value: stats.bloqueadas, tom: stats.bloqueadas > 0 ? 'danger' : '' },
    {
      label: 'Concluídas',
      value: stats.concluidos,
      barra: totalAtivo ? Math.round((stats.concluidos / totalAtivo) * 100) : 0
    },
    { label: 'Dias até concluir', value: num(stats.dias_medios_para_concluir) }
  ].map(statCard).join('');

  avisoForaDoPeriodo('#onb-notice', stats.em_andamento_fora_do_periodo,
    stats.em_andamento_fora_do_periodo === 1
      ? 'franquia em implantação começou fora deste período e não aparece na esteira.'
      : 'franquias em implantação começaram fora deste período e não aparecem na esteira.');

  $('#onb-board').innerHTML = onb.stages.map((stage) => {
    const cards = lista.filter((o) => o.stage === stage.key);
    return `
      <section class="col is-${esc(stage.tone ?? 'neutral')}" data-stage="${stage.key}">
        <header class="col-head"><span class="dot"></span>${esc(stage.label)}
          <span class="count">${cards.length}</span></header>
        <div class="col-body">
          ${cards.length ? cards.map(onbCard).join('') : '<div class="col-empty">Arraste franquias para cá</div>'}
        </div>
      </section>`;
  }).join('');
}

function camposFranquia(o = {}) {
  return [
    { name: 'franchise_name', label: 'Nome da franquia', value: o.franchise_name, required: true },
    { name: 'contact_name', label: 'Pessoa de contato', value: o.contact_name },
    { name: 'phone', label: 'WhatsApp', value: o.phone },
    { name: 'plan', label: 'Produto ou plano', value: o.plan },
    { name: 'owner', label: 'Responsável pela implantação', value: o.owner ?? CS_PADRAO },
    { name: 'whatsapp_group_name', label: 'Nome do grupo no WhatsApp', value: o.whatsapp_group_name },
    { name: 'whatsapp_group_link', label: 'Link de convite do grupo (chat.whatsapp.com/…)', value: o.whatsapp_group_link },
    { name: 'notes', label: 'Observações', type: 'textarea', value: o.notes }
  ];
}

async function abrirOnboarding(id) {
  const o = await apiCall(`/onboarding/${id}`);
  const etapa = onb.stages.find((s) => s.key === o.stage);
  const dialog = $('#modal');
  $('#modal-title').textContent = o.franchise_name;
  $('#modal-confirm').textContent = 'Fechar';
  $('#modal-body').innerHTML = `
    <div class="modal-info">Etapa atual: <b>${esc(etapa?.label ?? o.stage)}</b> · há ${o.dias_na_etapa}d nesta etapa
      · ${o.tarefas_feitas} de ${o.total_tarefas} tarefas
      ${o.whatsapp_group_name ? `<br>Grupo: ${esc(o.whatsapp_group_name)}` : ''}
      ${o.notes ? `<br>${esc(o.notes)}` : ''}
      ${o.whatsapp_link
        ? `<br><a href="${esc(o.whatsapp_link)}" target="_blank" rel="noopener noreferrer">
             ${o.whatsapp_destino === 'grupo' ? 'Abrir o grupo no WhatsApp' : 'Abrir a conversa no WhatsApp'}</a>`
        : '<br>Sem link do grupo. Cole o convite em Editar dados para abrir daqui.'}
    </div>
    <div class="tasks">
      ${o.tasks.map((t) => `
        <label class="task ${t.status === 'feito' ? 'done' : ''} ${t.status === 'bloqueado' ? 'blocked' : ''}">
          <input type="checkbox" data-task="${t.task_key}" ${t.status === 'feito' ? 'checked' : ''} />
          <span class="task__title">${esc(t.title)}
            ${t.done_at ? `<small>concluída em ${esc(t.done_at.slice(0, 10).split('-').reverse().join('/'))}</small>` : ''}
            ${t.status === 'bloqueado' ? '<small>travada, esperando o franqueado</small>' : ''}
          </span>
          <button type="button" class="sb-btn sb-btn--sm sb-btn--ghost" data-travar="${t.task_key}">
            ${t.status === 'bloqueado' ? 'Destravar' : 'Travar'}
          </button>
        </label>`).join('')}
    </div>
    <div class="modal-actions" style="justify-content:flex-start">
      <button type="button" class="sb-btn sb-btn--sm" data-editar="${o.id}">Editar dados</button>
      <button type="button" class="sb-btn sb-btn--sm" data-pausar="${o.id}">
        ${o.situacao === 'ativo' ? 'Pausar' : 'Retomar'}
      </button>
    </div>`;
  dialog.showModal();

  $('#modal-body').onclick = async (e) => {
    const alvoTravar = e.target.closest('[data-travar]');
    const alvoEditar = e.target.closest('[data-editar]');
    const alvoPausar = e.target.closest('[data-pausar]');
    try {
      if (alvoTravar) {
        const task = o.tasks.find((t) => t.task_key === alvoTravar.dataset.travar);
        await apiCall(`/onboarding/${id}/tasks/${task.task_key}`, {
          method: 'PATCH',
          body: { status: task.status === 'bloqueado' ? 'pendente' : 'bloqueado', actor: CS_PADRAO }
        });
        dialog.close();
        await renderOnboarding();
        abrirOnboarding(id);
      } else if (alvoEditar) {
        dialog.close();
        const form = await openModal({ title: `Editar ${o.franchise_name}`, fields: camposFranquia(o) });
        if (form) {
          await apiCall(`/onboarding/${id}`, { method: 'PATCH', body: { ...form, actor: CS_PADRAO } });
          toast('Franquia atualizada.');
        }
        await renderOnboarding();
      } else if (alvoPausar) {
        await apiCall(`/onboarding/${id}`, {
          method: 'PATCH',
          body: { situacao: o.situacao === 'ativo' ? 'pausado' : 'ativo', actor: CS_PADRAO }
        });
        dialog.close();
        toast(o.situacao === 'ativo' ? 'Implantação pausada.' : 'Implantação retomada.');
        await renderOnboarding();
      }
    } catch (err) { toast(err.message); }
  };

  $('#modal-body').onchange = async (e) => {
    const check = e.target.closest('input[data-task]');
    if (!check) return;
    try {
      await apiCall(`/onboarding/${id}/tasks/${check.dataset.task}`, {
        method: 'PATCH',
        body: { status: check.checked ? 'feito' : 'pendente', actor: CS_PADRAO }
      });
      await renderOnboarding();
      const atualizado = await apiCall(`/onboarding/${id}`);
      if (atualizado.stage === 'concluido') {
        dialog.close();
        toast(`${atualizado.franchise_name}: implantação concluída 🎉`);
      }
    } catch (err) { toast(err.message); }
  };
}

$('#new-onboarding').addEventListener('click', async () => {
  const form = await openModal({
    title: 'Nova franquia na esteira',
    confirmLabel: 'Começar onboarding',
    fields: camposFranquia()
  });
  if (!form) return;
  try {
    const criada = await apiCall('/onboarding', { method: 'POST', body: { ...form, actor: CS_PADRAO } });
    toast(`${criada.franchise_name} entrou na esteira.`);
    await renderOnboarding();
  } catch (err) { toast(err.message); }
});

$('#onb-search').addEventListener('input', debounce((e) => {
  onb.filtros.q = e.target.value.trim();
  renderOnboarding();
}));
$('#onb-situacao').addEventListener('change', (e) => {
  onb.filtros.situacao = e.target.value;
  renderOnboarding();
});

$('#onb-board').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-onb]');
  if (!btn) return;
  try {
    if (btn.dataset.onb === 'abrir') return abrirOnboarding(btn.dataset.id);
    const stage = btn.dataset.onb === 'reabrir' ? 'teste_agente' : btn.dataset.stage;
    await apiCall(`/onboarding/${btn.dataset.id}/stage`, { method: 'POST', body: { stage, actor: CS_PADRAO } });
    await renderOnboarding();
  } catch (err) { toast(err.message); }
});

// Arrastar cards entre colunas.
let arrastando = null;
$('#onb-board').addEventListener('dragstart', (e) => {
  const card = e.target.closest('.onb');
  if (!card) return;
  arrastando = card.dataset.id;
  card.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', card.dataset.id);
});
$('#onb-board').addEventListener('dragend', (e) => {
  e.target.closest('.onb')?.classList.remove('is-dragging');
  $$('.col').forEach((c) => c.classList.remove('is-over'));
  arrastando = null;
});
$('#onb-board').addEventListener('dragover', (e) => {
  const col = e.target.closest('.col');
  if (!col || !arrastando) return;
  e.preventDefault();
  $$('.col').forEach((c) => c.classList.toggle('is-over', c === col));
});
$('#onb-board').addEventListener('drop', async (e) => {
  const col = e.target.closest('.col');
  if (!col) return;
  e.preventDefault();
  const id = e.dataTransfer.getData('text/plain') || arrastando;
  $$('.col').forEach((c) => c.classList.remove('is-over'));
  if (!id) return;
  try {
    await apiCall(`/onboarding/${id}/stage`, { method: 'POST', body: { stage: col.dataset.stage, actor: CS_PADRAO } });
    await renderOnboarding();
  } catch (err) { toast(err.message); }
});

/* ---------------------------------- setup --------------------------------- */

const SECOES = {
  triagem: { titulo: 'Triagem', tag: 'Fila do agente' },
  onboarding: { titulo: 'Onboarding', tag: 'Esteira de implantação' },
  contatos: { titulo: 'Contatos', tag: 'Base de clientes' },
  painel: { titulo: 'Painel', tag: 'Visão macro' }
};

function switchView(view) {
  state.view = view;
  $('#header-section').textContent = `— ${SECOES[view].titulo}`;
  $('#header-tag').innerHTML = `${ICON.grid}${esc(SECOES[view].tag)}`;
  document.title = `${SECOES[view].titulo} · CRM 7Bee`;
  $$('.sb-nav__link').forEach((t) => {
    if (t.dataset.view === view) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${view}`; });
  refresh();
}

// Tema escuro é o padrão; o claro entra por data-theme no <html>.
function aplicarTema(tema) {
  document.documentElement.dataset.theme = tema;
  $('#theme-label').textContent = tema === 'dark' ? 'Tema claro' : 'Tema escuro';
  try { localStorage.setItem('crm7bee-tema', tema); } catch { /* navegador sem storage */ }
}

try {
  aplicarTema(localStorage.getItem('crm7bee-tema') ?? 'dark');
} catch {
  aplicarTema('dark');
}

$('#theme-toggle').addEventListener('click', () => {
  aplicarTema(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

async function refresh() {
  try {
    if (state.view === 'contatos') await renderContacts();
    else if (state.view === 'onboarding') await renderOnboarding();
    else await Promise.all([renderMessages(), renderKpis()]);
  } catch (err) {
    toast(err.message);
  }
}

$$('.sb-nav__link').forEach((tab) => tab.addEventListener('click', () => switchView(tab.dataset.view)));
$('#refresh').addEventListener('click', () => { refresh(); toast('Dados atualizados.'); });

$('#status-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.sb-tab');
  if (!chip) return;
  $$('#status-chips .sb-tab').forEach((c) => c.setAttribute('aria-selected', String(c === chip)));
  state.fila = chip.dataset.view;
  renderMessages();
});

$('#msg-search').addEventListener('input', debounce((e) => {
  state.msgFilters.q = e.target.value.trim();
  renderMessages();
}));
for (const [sel, key] of [['#msg-priority', 'priority'], ['#msg-channel', 'channel'], ['#msg-sort', 'sort']]) {
  $(sel).addEventListener('change', (e) => { state.msgFilters[key] = e.target.value; renderMessages(); });
}

$('#msg-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  try {
    if (btn.dataset.act === 'feedback') await enviarFeedback(btn.dataset.id, btn.dataset.feedback);
    else await handleMessageAction(btn.dataset.act, btn.dataset.id);
  } catch (err) { toast(err.message); }
});

$('#new-message').addEventListener('click', async () => {
  const form = await openModal({
    title: 'Registrar mensagem recebida',
    confirmLabel: 'Registrar',
    fields: [
      { name: 'sender_name', label: 'Quem enviou', required: true },
      { name: 'sender_handle', label: 'E-mail ou telefone (para ligar ao contato)' },
      { name: 'channel', label: 'Canal', type: 'select', value: 'whatsapp', options: [
        { value: 'whatsapp', label: 'WhatsApp' }, { value: 'email', label: 'E-mail' },
        { value: 'instagram', label: 'Instagram' }, { value: 'site', label: 'Site' },
        { value: 'telefone', label: 'Telefone' }, { value: 'chat', label: 'Chat' },
        { value: 'outro', label: 'Outro' } ] },
      { name: 'subject', label: 'Assunto (opcional)' },
      { name: 'body', label: 'Mensagem', type: 'textarea', required: true }
    ]
  });
  if (!form) return;
  try {
    const created = await apiCall('/messages', { method: 'POST', body: form });
    toast(`Registrada com prioridade ${created.priority} (score ${created.score}).`);
    await Promise.all([renderMessages(), renderKpis()]);
  } catch (err) { toast(err.message); }
});

$('#contact-search').addEventListener('input', debounce((e) => {
  state.contactFilters.q = e.target.value.trim();
  renderContacts();
}));
$('#contact-stage').addEventListener('change', (e) => {
  state.contactFilters.stage = e.target.value;
  renderContacts();
});

$('#new-contact').addEventListener('click', async () => {
  const form = await openModal({ title: 'Novo contato', fields: contactFields() });
  if (!form) return;
  try {
    await apiCall('/contacts', { method: 'POST', body: form });
    toast('Contato criado.');
    renderContacts();
  } catch (err) { toast(err.message); }
});

$('#contact-table').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-contact]');
  if (!btn) return;
  try {
    const contact = await apiCall(`/contacts/${btn.dataset.contact}`);
    const form = await openModal({ title: `Editar ${contact.name}`, fields: contactFields(contact) });
    if (!form) return;
    await apiCall(`/contacts/${contact.id}`, { method: 'PATCH', body: form });
    toast('Contato atualizado.');
    renderContacts();
  } catch (err) { toast(err.message); }
});

// Ícones dos botões fixos da barra e dos cabeçalhos.
for (const [sel, icone] of [
  ['#refresh', ICON.undo],
  ['#new-message', ICON.plus],
  ['#new-contact', ICON.plus],
  ['#new-onboarding', ICON.plus],
  ['#user-chip', ICON.user],
  ['#period-btn', ICON.calendar]
]) {
  const botao = $(sel);
  if (botao) botao.insertAdjacentHTML('afterbegin', icone);
}
$('#period-btn').insertAdjacentHTML('beforeend', ICON.chevron);
$('#header-tag').insertAdjacentHTML('afterbegin', ICON.grid);

// Relógio ao vivo, como no dashboard: 14:05:43 • quarta-feira, 23 de setembro de 2026.
function tique() {
  const agora = new Date();
  const hora = agora.toLocaleTimeString('pt-BR', { hour12: false });
  const dia = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#clock').textContent = `${hora} • ${dia}`;
}
tique();
setInterval(tique, 1000);

// Logo da abelha. O GIF animado tem movimento próprio, então o voo em CSS
// desliga. A arte parada (webp ou png) continua voando pelo CSS.
apiCall('/marca').then(({ abelha, animada }) => {
  if (!abelha) return;
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  img.onload = () => {
    const bee = $('#bee');
    bee.textContent = '';
    bee.classList.add('has-img');
    bee.classList.toggle('is-gif', Boolean(animada));
    bee.append(img);
  };
  img.src = abelha;
}).catch(() => { /* sem arquivo, fica o emoji animado */ });

// Seletor de período.
function desenharMenuDoPeriodo() {
  const agora = new Date();
  const opcoes = Object.entries(PERIODOS).map(([chave, p]) => {
    const faixa = p.faixa(agora);
    const dica = faixa ? (ddmm(faixa[0]) === ddmm(faixa[1]) ? ddmm(faixa[0]) : `${ddmm(faixa[0])}–${ddmm(faixa[1])}`) : 'sem filtro';
    return `<button type="button" class="sb-period__opt" role="menuitemradio" data-periodo="${chave}"
      aria-checked="${periodo.chave === chave}">${esc(p.rotulo)}<small>${esc(dica)}</small></button>`;
  }).join('');
  const dataLocal = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '');
  const hoje = dataLocal(agora);
  $('#period-menu').innerHTML = `${opcoes}
    <div class="sb-period__custom">
      <div class="sb-period__row">
        <label>De<input type="date" id="period-de" max="${hoje}" value="${dataLocal(periodo.inicio)}" /></label>
        <label>Até<input type="date" id="period-ate" max="${hoje}" value="${dataLocal(periodo.fim)}" /></label>
      </div>
      <button type="button" class="sb-btn sb-btn--sm sb-btn--primary" id="period-aplicar">Aplicar datas</button>
    </div>`;
}

function atualizarBotaoDoPeriodo() {
  const { rotulo, faixa } = rotuloDoPeriodo();
  $('#period-label').textContent = faixa ? `${rotulo} ·` : rotulo;
  $('#period-range').textContent = faixa;
  $('#period-btn').classList.toggle('is-active', periodo.chave !== 'tudo');
}

function guardarPeriodo() {
  try {
    localStorage.setItem('crm7bee-periodo', JSON.stringify({
      chave: periodo.chave,
      inicio: periodo.inicio?.toISOString() ?? null,
      fim: periodo.fim?.toISOString() ?? null
    }));
  } catch { /* navegador sem storage */ }
}

function escolherPeriodo(chave, inicio = null, fim = null) {
  periodo.chave = chave;
  periodo.inicio = inicio;
  periodo.fim = fim;
  guardarPeriodo();
  atualizarBotaoDoPeriodo();
  fecharMenuDoPeriodo();
  refresh();
}

function abrirMenuDoPeriodo() {
  desenharMenuDoPeriodo();
  $('#period-menu').hidden = false;
  $('#period-btn').setAttribute('aria-expanded', 'true');
  ($('#period-menu [aria-checked="true"]') ?? $('#period-menu .sb-period__opt'))?.focus();
}

function fecharMenuDoPeriodo({ devolverFoco = false } = {}) {
  if ($('#period-menu').hidden) return;
  $('#period-menu').hidden = true;
  $('#period-btn').setAttribute('aria-expanded', 'false');
  if (devolverFoco) $('#period-btn').focus();
}

$('#period-btn').addEventListener('click', () => {
  if ($('#period-menu').hidden) abrirMenuDoPeriodo();
  else fecharMenuDoPeriodo();
});

$('#period-menu').addEventListener('click', (e) => {
  const opcao = e.target.closest('[data-periodo]');
  if (opcao) return escolherPeriodo(opcao.dataset.periodo);
  if (e.target.closest('#period-aplicar')) {
    const de = $('#period-de').value;
    const ate = $('#period-ate').value;
    if (!de || !ate) return toast('Escolha as duas datas para aplicar.');
    const [ad, am, add] = de.split('-').map(Number);
    const [bd, bm, bdd] = ate.split('-').map(Number);
    const inicio = new Date(ad, am - 1, add, 0, 0, 0);
    const fim = new Date(bd, bm - 1, bdd, 23, 59, 59);
    if (inicio > fim) return toast('A data inicial precisa vir antes da final.');
    escolherPeriodo('custom', inicio, fim);
  }
});

$('#period-menu').addEventListener('keydown', (e) => {
  const opcoes = $$('#period-menu .sb-period__opt');
  const i = opcoes.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' && i >= 0) { e.preventDefault(); opcoes[(i + 1) % opcoes.length].focus(); }
  if (e.key === 'ArrowUp' && i >= 0) { e.preventDefault(); opcoes[(i - 1 + opcoes.length) % opcoes.length].focus(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') fecharMenuDoPeriodo({ devolverFoco: true });
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#period')) fecharMenuDoPeriodo();
});

// "Ver todo o período" nos avisos de itens escondidos.
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-periodo-tudo]')) escolherPeriodo('tudo');
});

try {
  const salvo = JSON.parse(localStorage.getItem('crm7bee-periodo') ?? 'null');
  if (salvo && (PERIODOS[salvo.chave] || salvo.chave === 'custom')) {
    periodo.chave = salvo.chave;
    periodo.inicio = salvo.inicio ? new Date(salvo.inicio) : null;
    periodo.fim = salvo.fim ? new Date(salvo.fim) : null;
  }
} catch { /* navegador sem storage */ }
atualizarBotaoDoPeriodo();

refresh();
setInterval(() => { if (!$('#modal').open) refresh(); }, 60000);
