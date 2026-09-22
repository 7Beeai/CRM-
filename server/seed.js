import { db } from './db.js';
import { createContact, createMessage, applyAgentDecision, setHumanFeedback } from './api.js';
import { createOnboarding, setTask, moveStage, fromWhatsappGroup } from './onboarding.js';

const hoursAgo = (h) => new Date(Date.now() - h * 3.6e6).toISOString().slice(0, 19).replace('T', ' ');

if (db.prepare(`SELECT COUNT(*) n FROM messages`).get().n > 0) {
  console.log('Banco já tem dados. Nada a fazer.');
  process.exit(0);
}

const contacts = [
  { name: 'Mariana Lopes', company: 'Docelar Alimentos', email: 'mariana@docelar.com.br', phone: '+5511988887777', stage: 'cliente', owner: 'Guilherme', is_customer: 1, tags: 'plano-pro' },
  { name: 'Rafael Tavares', company: 'Studio RT', email: 'rafael@studiort.com', phone: '+5521977776666', stage: 'proposta', owner: 'Guilherme', tags: 'inbound' },
  { name: 'Carla Menezes', company: 'Clínica Vida', email: 'carla@clinicavida.com.br', phone: '+5531966665555', stage: 'cliente', is_customer: 1, tags: 'plano-basico' },
  { name: 'Diego Almeida', company: 'Almeida Log', email: 'diego@almeidalog.com', phone: '+5541955554444', stage: 'lead', tags: 'indicação' },
  { name: 'Patrícia Souza', company: 'PS Consultoria', email: 'patricia@psconsult.com', phone: '+5511944443333', stage: 'qualificado' }
];
for (const c of contacts) createContact(c);

const messages = [
  { sender_name: 'Mariana Lopes', sender_handle: '+5511988887777', channel: 'whatsapp', body: 'Gente, o painel está fora do ar desde cedo e preciso fechar o relatório hoje. É urgente!', received_at: hoursAgo(3) },
  { sender_name: 'Rafael Tavares', sender_handle: 'rafael@studiort.com', channel: 'email', subject: 'Proposta comercial', body: 'Recebi a proposta e quero fechar o contrato. Consegue me mandar o link de pagamento ainda hoje?', received_at: hoursAgo(5) },
  { sender_name: 'Carla Menezes', sender_handle: '+5531966665555', channel: 'whatsapp', body: 'Estou pensando em cancelar a assinatura, não consegui usar direito no último mês.', received_at: hoursAgo(26) },
  { sender_name: 'Diego Almeida', sender_handle: 'diego@almeidalog.com', channel: 'site', body: 'Quanto custa o plano para uma equipe de 12 pessoas? Podemos agendar uma demo?', received_at: hoursAgo(9) },
  { sender_name: 'Patrícia Souza', sender_handle: '+5511944443333', channel: 'instagram', body: 'Oi! Vi o post de vocês, muito bom mesmo 👏', received_at: hoursAgo(12) },
  { sender_name: 'Loja Parceira', sender_handle: 'no-reply@newsletter.com', channel: 'email', subject: 'Promoção imperdível desta semana', body: 'Aproveite nossa newsletter com promoções exclusivas. Para descadastrar clique aqui.', received_at: hoursAgo(2) },
  { sender_name: 'Mariana Lopes', sender_handle: '+5511988887777', channel: 'whatsapp', body: 'ok obrigada!', received_at: hoursAgo(1) },
  { sender_name: 'João Ribeiro', sender_handle: 'joao@novaempresa.com', channel: 'email', subject: 'Nota fiscal de agosto', body: 'Bom dia, poderiam reenviar a nota fiscal de agosto? O financeiro não localizou o boleto.', received_at: hoursAgo(30) },
  // Mensagem de uma franquia que está na esteira: chega antes do onboarding
  // ser criado, para mostrar que o vínculo é feito depois.
  { sender_name: 'Jose Martins', sender_handle: '+5511970001111', channel: 'whatsapp', body: 'Travou no cadastro da OpenAI, o cartão foi recusado. Consegue me ajudar hoje?', received_at: hoursAgo(4) }
];
const criadas = messages.map(createMessage);

// Decisões de exemplo, como se o agente já tivesse passado pela fila.
const decisoes = [
  { i: 0, decision: 'escalou', confidence: 0.93, intent: 'incidente', reason: 'Cliente ativo relatando indisponibilidade com prazo hoje. Precisa de posição humana.', suggested_reply: 'Oi Mariana, o time já está olhando a indisponibilidade do painel. Te dou uma posição em até 30 minutos.' },
  { i: 1, decision: 'escalou', confidence: 0.88, intent: 'fechamento', reason: 'Quer fechar contrato e pediu link de pagamento. Envolve valor e condição comercial.', suggested_reply: 'Rafael, que ótima notícia! Já preparo o link de pagamento e te mando ainda hoje.' },
  { i: 2, decision: 'escalou', confidence: 0.96, intent: 'churn', reason: 'Pedido de cancelamento com insatisfação. Retenção precisa de humano.' },
  { i: 3, decision: 'respondeu', confidence: 0.79, intent: 'preco', reply: 'Oi Diego! Para 12 pessoas o plano sai por R$ 49 por usuário ao mês. Consigo te mostrar em uma demo de 20 minutos, tenho horários amanhã de manhã. Qual fica melhor?' },
  { i: 4, decision: 'respondeu', confidence: 0.92, intent: 'elogio', reply: 'Que bom que gostou, Patrícia! Obrigado por acompanhar a gente 💛' },
  { i: 5, decision: 'ignorou', confidence: 0.99, intent: 'spam', reason: 'Newsletter promocional automática, sem pergunta ao time.' },
  { i: 6, decision: 'respondeu', confidence: 0.95, intent: 'agradecimento', reply: 'Imagina, Mariana! Qualquer coisa é só chamar.' },
  { i: 7, decision: 'respondeu', confidence: 0.61, intent: 'financeiro', reply: 'Bom dia, João! Já reenviei a nota fiscal e o boleto de agosto para este e-mail.', needs_human: true, reason: 'Confiança baixa: não confirmei se a nota realmente foi emitida.' },
  { i: 8, decision: 'escalou', confidence: 0.9, intent: 'onboarding', reason: 'Franquia travada no cadastro da OpenAI, primeira etapa da esteira.', suggested_reply: 'Oi Jose! Vamos resolver hoje. Consegue tentar outro cartão enquanto eu confirmo o limite internacional?' }
];
for (const d of decisoes) applyAgentDecision(criadas[d.i].id, { agent: 'agente-cs', ...d });

setHumanFeedback(criadas[4].id, { feedback: 'acertou', actor: 'Guilherme' });
setHumanFeedback(criadas[6].id, { feedback: 'acertou', actor: 'Guilherme' });

// Esteira de onboarding
const diasAtras = (d) => new Date(Date.now() - d * 8.64e7).toISOString().slice(0, 19).replace('T', ' ');

const franquias = [
  { franchise_name: 'Padaria Pão Quente', contact_name: 'Jose Martins', phone: '+5511970001111', plan: 'Aceleração em Agendamentos', started_at: diasAtras(2), whatsapp_group_link: 'https://chat.whatsapp.com/ExemploPaoQuente1' },
  { franchise_name: 'Auto Center Silva', contact_name: 'Denilson Silva', phone: '+5511970002222', plan: 'Aceleração em Agendamentos', started_at: diasAtras(9) },
  { franchise_name: 'Clínica Sorriso', contact_name: 'Bruno Rocha', phone: '+5511970003333', plan: 'Mentoria Fórmula de Agendamento', started_at: diasAtras(16), whatsapp_group_link: 'https://chat.whatsapp.com/ExemploClinicaSorriso' },
  { franchise_name: 'Estética Elaine', contact_name: 'Elaine Faria', phone: '+5511970004444', plan: 'Mentoria Fórmula de Agendamento', started_at: diasAtras(24) },
  { franchise_name: 'Barbearia do Zé', contact_name: 'Luis Garcez', phone: '+5511970005555', plan: 'Programa de Implementação de Agendamentos', started_at: diasAtras(31) }
];
const abertas = franquias.map((f) => createOnboarding({ ...f, owner: 'Guilherme' }));

// Uma franquia detectada automaticamente pelo grupo do WhatsApp.
fromWhatsappGroup({
  group_id: '120363000000000001@g.us',
  group_name: '7Bee x Mercado Bom Preço',
  group_invite_link: 'https://chat.whatsapp.com/ExemploMercadoBomPreco',
  contact_name: 'Patricia Nunes',
  created_at: diasAtras(1)
});

setTask(abertas[1].id, 'openai', { status: 'feito', actor: 'Guilherme' });
setTask(abertas[2].id, 'openai', { status: 'feito', actor: 'Guilherme' });
setTask(abertas[2].id, 'bm_facebook', { status: 'feito', actor: 'Guilherme' });
setTask(abertas[3].id, 'openai', { status: 'feito', actor: 'Guilherme' });
setTask(abertas[3].id, 'bm_facebook', { status: 'feito', actor: 'Guilherme' });
setTask(abertas[3].id, 'ctn', { status: 'bloqueado', note: 'Esperando documento do franqueado.', actor: 'Guilherme' });
moveStage(abertas[4].id, 'concluido', { actor: 'Guilherme' });

console.log(`Onboarding: ${franquias.length + 1} franquias na esteira.`);
console.log(`Seed concluído: ${contacts.length} contatos, ${messages.length} mensagens e ${decisoes.length} decisões do agente.`);
