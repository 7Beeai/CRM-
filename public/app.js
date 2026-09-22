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
        return `<label style="grid-auto-flow:column;justify-content:start;align-items:center;gap:8px">
          <input type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''} style="width:16px;height:16px" />
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

/* --------------------------------- triagem -------------------------------- */

function agentBlock(m) {
  if (!m.agent_decision) {
    return m.agente_atrasado
      ? `<div class="agent agent-late">O agente ainda não decidiu esta mensagem
           (${waitLabel(m.waiting_hours)}). Talvez ele esteja fora do ar.</div>`
      : `<div class="agent agent-wait">Aguardando a análise do agente.</div>`;
  }

  const decisao = {
    respondeu: 'Respondeu sozinho',
    escalou: 'Escalou para você',
    ignorou: 'Descartou'
  }[m.agent_decision] ?? m.agent_decision;
  const conf = m.agent_confidence === null || m.agent_confidence === undefined
    ? '' : ` · confiança ${Math.round(m.agent_confidence * 100)}%`;
  const texto = m.agent_reply || m.agent_suggested_reply;
  const rotulo = m.agent_reply ? 'Respondeu ao cliente' : 'Rascunho sugerido para você';

  return `
    <div class="agent">
      <div class="agent-head">
        <span class="badge agent-badge">${esc(m.agent_name || 'agente')}: ${esc(decisao)}</span>
        <span class="meta">${esc(m.agent_intent || 'sem categoria')}${conf}</span>
      </div>
      ${m.agent_reason ? `<div class="meta">Motivo: ${esc(m.agent_reason)}</div>` : ''}
      ${texto ? `<details class="agent-reply"><summary>${rotulo}</summary><p>${esc(texto)}</p>
        <button class="btn btn-sm" data-act="copiar" data-id="${m.id}">Copiar texto</button></details>` : ''}
    </div>`;
}

function feedbackRow(m) {
  if (!m.agent_decision) return '';
  if (m.human_feedback) {
    const rotulo = {
      acertou: 'você marcou: o agente acertou',
      deveria_escalar: 'você marcou: deveria ter escalado',
      nao_precisava_escalar: 'você marcou: não precisava escalar',
      resposta_ruim: 'você marcou: a resposta ficou ruim'
    }[m.human_feedback] ?? m.human_feedback;
    return `<div class="feedback meta">✓ ${esc(rotulo)}</div>`;
  }
  const opcao = (valor, rotulo) =>
    `<button class="btn btn-sm btn-quiet" data-act="feedback" data-id="${m.id}" data-feedback="${valor}">${rotulo}</button>`;
  return `<div class="feedback"><span class="meta">O agente acertou?</span>
    ${opcao('acertou', 'Acertou')}
    ${m.needs_human ? opcao('nao_precisava_escalar', 'Não precisava me chamar') : opcao('deveria_escalar', 'Deveria ter me chamado')}
    ${m.agent_reply ? opcao('resposta_ruim', 'Resposta ruim') : ''}</div>`;
}

function messageCard(m) {
  const done = ['respondida', 'arquivada', 'auto_respondida'].includes(m.status);
  const statusBadge = {
    triagem: '<span class="badge baixa">Em análise do agente</span>',
    escalada: '<span class="badge alta">Precisa de você</span>',
    auto_respondida: '<span class="badge ok">Agente respondeu</span>',
    respondida: '<span class="badge ok">Respondida</span>',
    arquivada: '<span class="badge baixa">Descartada</span>'
  }[m.status] ?? '';

  const actions = done
    ? `<button class="btn btn-sm" data-act="reabrir" data-id="${m.id}">Assumir de volta</button>`
    : `<button class="btn btn-sm btn-primary" data-act="responder" data-id="${m.id}">Marcar respondida</button>
       ${m.status === 'triagem' ? `<button class="btn btn-sm" data-act="escalar" data-id="${m.id}">Trazer para mim</button>` : ''}
       <button class="btn btn-sm" data-act="arquivar" data-id="${m.id}">Descartar</button>`;

  return `
  <article class="msg ${done ? 'is-done' : ''}" data-priority="${m.priority}">
    <div class="msg-head">
      <strong>${esc(m.contact_name ?? m.sender_name)}</strong>
      ${m.contact_company ? `<span class="meta">· ${esc(m.contact_company)}</span>` : ''}
      <span class="badge ${m.priority}">${m.priority === 'media' ? 'média' : m.priority} · ${m.score}</span>
      ${statusBadge}
      ${m.overdue ? '<span class="badge late">Atrasada</span>' : ''}
      <span class="meta" style="margin-left:auto">${esc(m.channel)} · ${waitLabel(m.waiting_hours)}</span>
    </div>
    ${m.subject ? `<div class="meta"><b>${esc(m.subject)}</b></div>` : ''}
    <p class="msg-body">${esc(m.body)}</p>
    ${agentBlock(m)}
    <div class="msg-why">Por que priorizar: ${esc(m.reasons || 'sem sinais fortes')}</div>
    <div class="msg-actions">
      ${actions}
      <button class="btn btn-sm" data-act="prioridade" data-id="${m.id}">Prioridade</button>
      <button class="btn btn-sm" data-act="nota" data-id="${m.id}">Nota</button>
      <span class="meta" style="margin-left:auto">Responsável: ${esc(m.assigned_to || '—')}</span>
    </div>
    ${m.internal_note ? `<div class="msg-note">${esc(m.internal_note)}</div>` : ''}
    ${feedbackRow(m)}
  </article>`;
}

async function renderMessages() {
  const params = new URLSearchParams(
    Object.entries({ ...state.msgFilters, ...FILAS[state.fila] }).filter(([, v]) => v)
  );
  const list = await apiCall(`/messages?${params}`);
  $('#msg-list').innerHTML = list.length
    ? list.map(messageCard).join('')
    : '<div class="empty">Nenhuma mensagem com esses filtros.</div>';
}

async function renderKpis() {
  const d = await apiCall('/dashboard');
  const cards = [
    { label: 'Precisam de você', value: d.escaladas, alert: d.escaladas > 0 },
    { label: 'Fora do prazo', value: d.atrasadas, alert: d.atrasadas > 0 },
    { label: 'Aguardando o agente', value: d.aguardando_agente },
    { label: 'Respondidas pelo agente', value: d.auto_respondidas },
    { label: 'Resolvidas sem humano', value: `${d.taxa_automacao}%` },
    { label: 'Tempo médio de resposta', value: `${d.tempo_medio_resposta_horas}h` }
  ];
  const html = cards.map((c) =>
    `<div class="kpi ${c.alert ? 'alert' : ''}"><b>${esc(c.value)}</b><span>${esc(c.label)}</span></div>`).join('');
  $('#kpis').innerHTML = html;

  $('#kpis-panel').innerHTML = html +
    `<div class="kpi"><b>${d.contatos}</b><span>Contatos</span></div>
     <div class="kpi"><b>${d.clientes}</b><span>Clientes ativos</span></div>`;

  const bars = (rows, keyName) => {
    if (!rows.length) return '<div class="meta">Sem dados.</div>';
    const max = Math.max(...rows.map((r) => r.n));
    return rows.map((r) => `
      <div class="bar-row"><span>${esc(r[keyName])}</span>
        <span class="bar" style="width:${Math.round((r.n / max) * 100)}%"></span>
        <span>${r.n}</span></div>`).join('');
  };
  $('#chart-channel').innerHTML = bars(d.por_canal, 'channel');
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
    : '<div class="meta">Ninguém avaliou o agente ainda. Use os botões nos cards da triagem.</div>';
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
  const params = new URLSearchParams(Object.entries(state.contactFilters).filter(([, v]) => v));
  const rows = await apiCall(`/contacts?${params}`);
  const tbody = $('#contact-table tbody');
  tbody.innerHTML = rows.length ? rows.map((c) => `
    <tr>
      <td><b>${esc(c.name)}</b>${c.tags ? `<div class="meta">${esc(c.tags)}</div>` : ''}</td>
      <td>${esc(c.company || '—')}</td>
      <td class="meta">${esc(c.email || '')}${c.email && c.phone ? '<br>' : ''}${esc(c.phone || '')}</td>
      <td><span class="badge baixa">${esc(c.stage)}</span></td>
      <td>${esc(c.owner || '—')}</td>
      <td>${c.is_customer ? '<span class="badge ok">sim</span>' : '<span class="meta">não</span>'}</td>
      <td><button class="btn btn-sm" data-contact="${c.id}">Editar</button></td>
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

/* ---------------------------------- setup --------------------------------- */

function switchView(view) {
  state.view = view;
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('is-hidden', v.id !== `view-${view}`));
  refresh();
}

async function refresh() {
  try {
    if (state.view === 'contatos') await renderContacts();
    else await Promise.all([renderMessages(), renderKpis()]);
  } catch (err) {
    toast(err.message);
  }
}

$$('.tab').forEach((tab) => tab.addEventListener('click', () => switchView(tab.dataset.view)));
$('#refresh').addEventListener('click', () => { refresh(); toast('Dados atualizados.'); });

$('#status-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  $$('#status-chips .chip').forEach((c) => c.classList.toggle('is-active', c === chip));
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

refresh();
setInterval(() => { if (!$('#modal').open) refresh(); }, 60000);
