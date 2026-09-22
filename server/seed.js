import { db } from './db.js';
import { createContact, createMessage } from './api.js';

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
  { sender_name: 'João Ribeiro', sender_handle: 'joao@novaempresa.com', channel: 'email', subject: 'Nota fiscal de agosto', body: 'Bom dia, poderiam reenviar a nota fiscal de agosto? O financeiro não localizou o boleto.', received_at: hoursAgo(30) }
];
for (const m of messages) createMessage(m);

console.log(`Seed concluído: ${contacts.length} contatos e ${messages.length} mensagens.`);
