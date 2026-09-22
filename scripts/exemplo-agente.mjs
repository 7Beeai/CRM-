/**
 * Agente de exemplo: mostra como a integração funciona de ponta a ponta.
 *
 * Aqui a "decisão" é uma regra boba, só para exercitar a API. No agente de
 * verdade, troque a função `decidir` pela chamada ao seu modelo.
 *
 * Uso:  CRM_TOKEN=segredo node scripts/exemplo-agente.mjs
 */
const BASE = process.env.CRM_URL ?? 'http://localhost:3000';
const TOKEN = process.env.CRM_TOKEN ?? '';

async function crm(path, body, method = 'POST') {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(TOKEN ? { 'x-crm-token': TOKEN } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${data.error ?? res.status}`);
  return data;
}

/** Troque esta função pela chamada ao seu agente. */
function decidir(mensagem) {
  const texto = mensagem.body.toLowerCase();
  if (/cancelar|reembolso|processo|advogad/.test(texto)) {
    return {
      decision: 'escalou',
      confidence: 0.95,
      intent: 'churn',
      reason: 'Risco de cancelamento, precisa de conversa humana.',
      suggested_reply: 'Poxa, sinto muito. Me conta o que aconteceu para eu te ajudar a resolver.'
    };
  }
  if (/newsletter|promoção|descadastrar|no-reply/.test(texto)) {
    return { decision: 'ignorou', confidence: 0.99, intent: 'spam', reason: 'Disparo automático.' };
  }
  if (/horário|horario|funcionamento|endereço|endereco/.test(texto)) {
    return {
      decision: 'respondeu',
      confidence: 0.94,
      intent: 'duvida_simples',
      reply: 'Atendemos de segunda a sexta, das 9h às 18h. Qualquer coisa é só chamar!'
    };
  }
  return {
    decision: 'escalou',
    confidence: 0.4,
    intent: 'indefinido',
    reason: 'Não tenho confiança suficiente para responder sozinho.'
  };
}

const exemplos = [
  { sender_name: 'Alice Prado', sender_handle: 'alice@exemplo.com', channel: 'email',
    body: 'Qual o horário de funcionamento de vocês?', external_id: 'demo-1' },
  { sender_name: 'Bruno Dias', sender_handle: '+5511911112222', channel: 'whatsapp',
    body: 'Quero cancelar meu plano, já tentei resolver e não consegui.', external_id: 'demo-2' },
  { sender_name: 'Disparos ABC', sender_handle: 'no-reply@disparos.com', channel: 'email',
    body: 'Newsletter da semana com promoção especial, clique para descadastrar.', external_id: 'demo-3' }
];

for (const mensagem of exemplos) {
  const decisao = decidir(mensagem);
  const salva = await crm('/messages', { ...mensagem, agent: { agent: 'agente-exemplo', ...decisao } });
  console.log(
    `#${salva.id} ${salva.sender_name}: ${decisao.decision}` +
    `${salva.needs_human ? ' → foi para a fila do CS' : ''} (score do CRM: ${salva.score})`
  );
}

const painel = await crm('/dashboard', null, 'GET');
console.log(
  `\nResumo: ${painel.escaladas} esperando um humano, ` +
  `${painel.auto_respondidas} respondidas pelo agente, ` +
  `${painel.taxa_automacao}% resolvidas sem gente.`
);
