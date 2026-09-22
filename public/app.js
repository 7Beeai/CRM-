const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const CS_PADRAO = 'Guilherme';

const state = {
  view: 'triagem',
  msgFilters: { status: '', q: '', priority: '', channel: '', sort: 'score' },
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

function messageCard(m) {
  const done = m.status === 'respondida' || m.status === 'arquivada';
  const statusBadge = {
    triagem: '<span class="badge baixa">Para triar</span>',
    relevante: '<span class="badge alta">Relevante</span>',
    respondida: '<span class="badge ok">Respondida</span>',
    arquivada: '<span class="badge baixa">Arquivada</span>'
  }[m.status] ?? '';

  const actions = done
    ? `<button class="btn btn-sm" data-act="reabrir" data-id="${m.id}">Reabrir</button>`
    : `<button class="btn btn-sm btn-primary" data-act="responder" data-id="${m.id}">Marcar respondida</button>
       ${m.status === 'triagem' ? `<button class="btn btn-sm" data-act="relevante" data-id="${m.id}">É relevante</button>` : ''}
       <button class="btn btn-sm" data-act="arquivar" data-id="${m.id}">Ignorar</button>`;

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
    <div class="msg-why">Por que priorizar: ${esc(m.reasons || 'sem sinais fortes')}</div>
    <div class="msg-actions">
      ${actions}
      <button class="btn btn-sm" data-act="prioridade" data-id="${m.id}">Prioridade</button>
      <button class="btn btn-sm" data-act="nota" data-id="${m.id}">Nota</button>
      <span class="meta" style="margin-left:auto">Responsável: ${esc(m.assigned_to || '—')}</span>
    </div>
    ${m.internal_note ? `<div class="msg-note">${esc(m.internal_note)}</div>` : ''}
  </article>`;
}

async function renderMessages() {
  const params = new URLSearchParams(
    Object.entries(state.msgFilters).filter(([, v]) => v)
  );
  const list = await apiCall(`/messages?${params}`);
  $('#msg-list').innerHTML = list.length
    ? list.map(messageCard).join('')
    : '<div class="empty">Nenhuma mensagem com esses filtros.</div>';
}

async function renderKpis() {
  const d = await apiCall('/dashboard');
  const cards = [
    { label: 'Para triar', value: d.triagem },
    { label: 'Marcadas como relevantes', value: d.relevantes },
    { label: 'Alta prioridade em aberto', value: d.alta_prioridade, alert: d.alta_prioridade > 0 },
    { label: 'Fora do prazo', value: d.atrasadas, alert: d.atrasadas > 0 },
    { label: 'Respondidas hoje', value: d.respondidas_hoje },
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
}

async function handleMessageAction(act, id) {
  if (act === 'responder') await apiCall(`/messages/${id}`, { method: 'PATCH', body: { status: 'respondida', actor: CS_PADRAO } });
  else if (act === 'relevante') await apiCall(`/messages/${id}`, { method: 'PATCH', body: { status: 'relevante', assigned_to: CS_PADRAO, actor: CS_PADRAO } });
  else if (act === 'arquivar') await apiCall(`/messages/${id}`, { method: 'PATCH', body: { status: 'arquivada', actor: CS_PADRAO } });
  else if (act === 'reabrir') await apiCall(`/messages/${id}`, { method: 'PATCH', body: { status: 'triagem', actor: CS_PADRAO } });
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
  state.msgFilters.status = chip.dataset.status;
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
  try { await handleMessageAction(btn.dataset.act, btn.dataset.id); }
  catch (err) { toast(err.message); }
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
