/**
 * Conexão com o WhatsApp do CS pela leitura de QR code.
 *
 * Usa a biblioteca Baileys, que conecta como um "aparelho conectado", do mesmo
 * jeito que o WhatsApp Web. O CRM só lê os dados dos grupos: nome, data de
 * criação e quantidade de participantes. Nenhuma mensagem é lida nem guardada.
 *
 * A biblioteca é opcional. Sem `npm install`, o resto do CRM funciona e a tela
 * de conexão explica o que falta.
 *
 * A sessão fica em data/whatsapp-sessao. Quem tem essa pasta tem acesso ao
 * WhatsApp conectado, então ela nunca vai para o Git (data/ está no .gitignore).
 */
import { rm, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { fromWhatsappGroup, moveStage, marcarAnteriorAoCrm, STAGES, nomeDaFranquia } from './onboarding.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PASTA_SESSAO = process.env.CRM_WHATSAPP_SESSAO ?? join(root, 'data', 'whatsapp-sessao');
const SIMULADO = process.env.CRM_WHATSAPP_SIMULADO === '1';
// Grupos novos entram sozinhos na esteira. Um filtro opcional evita que grupos
// de família ou de outros assuntos virem franquia, ex.: CRM_WHATSAPP_FILTRO="7bee|onboarding".
const AUTO_ENTRADA = process.env.CRM_WHATSAPP_AUTO !== '0';
const FILTRO = process.env.CRM_WHATSAPP_FILTRO ? new RegExp(process.env.CRM_WHATSAPP_FILTRO, 'i') : null;
// Grupos que casam com o filtro mas não são franquia, ex.: CRM_WHATSAPP_IGNORAR="gest[aã]o".
const IGNORAR = process.env.CRM_WHATSAPP_IGNORAR ? new RegExp(process.env.CRM_WHATSAPP_IGNORAR, 'i') : null;

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

const estado = {
  fase: 'desligado', // desligado | conectando | aguardando_qr | conectado | erro | indisponivel
  qr: null,
  qrSvg: null,
  numero: null,
  erro: null,
  desde: null
};
const grupos = new Map();
let sock = null;
let libs = null;
let desligandoDePropósito = false;
let tentativas = 0;

/* ------------------------------ carregamento ------------------------------ */

async function carregarBibliotecas() {
  if (libs) return libs;
  try {
    const baileys = await import('@whiskeysockets/baileys');
    const qrcode = await import('qrcode');
    const pino = (await import('pino')).default;
    libs = { baileys, qrcode: qrcode.default ?? qrcode, pino };
    return libs;
  } catch {
    return null;
  }
}

async function qrParaSvg(texto) {
  if (SIMULADO && !libs) {
    // Sem a biblioteca no modo simulado, um quadro de exemplo basta.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><rect width="29" height="29" fill="#fff"/><path d="M1 1h7v7H1zM21 1h7v7h-7zM1 21h7v7H1z" fill="#000"/><text x="14.5" y="16" font-size="3" text-anchor="middle" font-family="monospace">simulado</text></svg>`;
  }
  return libs.qrcode.toString(texto, { type: 'svg', margin: 1, color: { dark: '#000000', light: '#ffffff' } });
}

/* --------------------------------- grupos --------------------------------- */

function guardarGrupo(meta) {
  if (!meta?.id || !meta.id.endsWith('@g.us')) return null;
  const anterior = grupos.get(meta.id) ?? {};
  const grupo = {
    id: meta.id,
    nome: meta.subject ?? anterior.nome ?? '',
    criado_em: meta.creation ? new Date(meta.creation * 1000).toISOString() : anterior.criado_em ?? null,
    participantes: Array.isArray(meta.participants) ? meta.participants.length : anterior.participantes ?? 0,
    eu_admin: Array.isArray(meta.participants) && estado.numero
      ? meta.participants.some((p) => mesmoNumero(p.id, estado.numero) && (p.admin === 'admin' || p.admin === 'superadmin'))
      : anterior.eu_admin ?? false
  };
  grupos.set(grupo.id, grupo);
  return grupo;
}

const soDigitos = (jid) => String(jid ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');
const mesmoNumero = (a, b) => soDigitos(a) && soDigitos(a) === soDigitos(b);

export function jaNaEsteira() {
  return new Set(
    db.prepare(`SELECT whatsapp_group_id FROM onboardings WHERE whatsapp_group_id IS NOT NULL`)
      .all().map((r) => r.whatsapp_group_id)
  );
}

export function listarGrupos() {
  if (estado.fase !== 'conectado') throw bad('Conecte o WhatsApp antes de listar os grupos.', 409);
  const naEsteira = jaNaEsteira();
  return [...grupos.values()]
    .map((g) => ({ ...g, franquia: nomeDaFranquia(g.nome), na_esteira: naEsteira.has(g.id) }))
    .sort((a, b) => (b.criado_em ?? '').localeCompare(a.criado_em ?? '') || a.nome.localeCompare(b.nome));
}

async function entradaAutomatica(meta) {
  const grupo = guardarGrupo(meta);
  if (grupo) levarGrupoNovo(grupo, 'WhatsApp');
}

/**
 * Grupo novo no WhatsApp do CS: vira franquia na coluna Nova franquia, se a
 * entrada automática estiver ligada e o nome passar pelo filtro. Serve para as
 * duas conexões (QR code e Evolution).
 */
export function levarGrupoNovo(grupo, origem = 'WhatsApp') {
  if (!AUTO_ENTRADA) return null;
  if (!passaNoFiltro(grupo.nome)) return null;
  if (jaNaEsteira().has(grupo.id)) return null;
  try {
    const franquia = fromWhatsappGroup({
      group_id: grupo.id,
      group_name: grupo.nome,
      created_at: (grupo.criado_em ?? new Date().toISOString()).slice(0, 19).replace('T', ' ')
    });
    console.log(`${origem}: grupo novo "${grupo.nome}" entrou na esteira.`);
    return franquia;
  } catch (err) {
    console.error(`${origem}: não consegui criar a franquia do grupo novo:`, err.message);
    return null;
  }
}

/** O nome do grupo passa no filtro de franquias e não está na lista de ignorados. */
export function passaNoFiltro(nome) {
  return (!FILTRO || FILTRO.test(nome)) && !(IGNORAR && IGNORAR.test(nome));
}

export const configEntrada = { automatica: AUTO_ENTRADA, filtro: FILTRO ? FILTRO.source : null, ignorar: IGNORAR ? IGNORAR.source : null };

/* -------------------------------- conexão --------------------------------- */

export async function status() {
  const disponivel = SIMULADO || Boolean(await carregarBibliotecas());
  if (!disponivel && estado.fase === 'desligado') estado.fase = 'indisponivel';
  return {
    fase: estado.fase,
    qr_svg: estado.fase === 'aguardando_qr' ? estado.qrSvg : null,
    numero: estado.numero,
    grupos: grupos.size,
    erro: estado.erro,
    desde: estado.desde,
    simulado: SIMULADO,
    entrada_automatica: AUTO_ENTRADA,
    filtro: FILTRO ? FILTRO.source : null
  };
}

export async function conectar() {
  if (['conectando', 'aguardando_qr', 'conectado'].includes(estado.fase)) return status();
  estado.erro = null;
  desligandoDePropósito = false;

  if (SIMULADO) return conectarSimulado();

  if (!(await carregarBibliotecas())) {
    estado.fase = 'indisponivel';
    return status();
  }

  estado.fase = 'conectando';
  const { baileys, pino } = libs;
  const makeWASocket = baileys.default?.default ?? baileys.default ?? baileys.makeWASocket;
  const { useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = baileys;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(PASTA_SESSAO);
    let version;
    try { version = (await fetchLatestBaileysVersion()).version; } catch { /* usa a versão embutida */ }

    sock = makeWASocket({
      auth: state,
      version,
      logger: pino({ level: 'silent' }),
      browser: Browsers.appropriate('CRM 7Bee'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      // O CRM não lê conversas: recusa o histórico que o WhatsApp oferece.
      shouldSyncHistoryMessage: () => false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      if (u.qr) {
        estado.fase = 'aguardando_qr';
        estado.qr = u.qr;
        estado.qrSvg = await qrParaSvg(u.qr);
      }
      if (u.connection === 'open') {
        tentativas = 0;
        estado.fase = 'conectado';
        estado.qr = null;
        estado.qrSvg = null;
        estado.desde = new Date().toISOString();
        estado.numero = soDigitos(sock.user?.id);
        try {
          const todos = await sock.groupFetchAllParticipating();
          for (const meta of Object.values(todos)) guardarGrupo(meta);
          console.log(`WhatsApp conectado: ${grupos.size} grupos encontrados.`);
        } catch (err) {
          console.error('WhatsApp: falha ao listar grupos:', err.message);
        }
      }
      if (u.connection === 'close') {
        const codigo = u.lastDisconnect?.error?.output?.statusCode;
        sock = null;
        if (desligandoDePropósito) return;
        if (codigo === DisconnectReason.loggedOut) {
          // O aparelho foi removido pelo celular: a sessão não vale mais.
          await rm(PASTA_SESSAO, { recursive: true, force: true });
          Object.assign(estado, { fase: 'desligado', qr: null, qrSvg: null, numero: null, desde: null });
          grupos.clear();
          return;
        }
        // Queda de rede ou reinício pedido pelo WhatsApp: tenta de novo, com espera crescente.
        tentativas += 1;
        if (tentativas > 6) {
          Object.assign(estado, { fase: 'erro', erro: 'A conexão caiu várias vezes seguidas. Tente conectar de novo.' });
          return;
        }
        estado.fase = 'conectando';
        setTimeout(() => { estado.fase = 'desligado'; conectar(); }, Math.min(30000, 1000 * 2 ** tentativas));
      }
    });

    // Entrou num grupo novo: vira franquia na esteira.
    sock.ev.on('groups.upsert', (metas) => { for (const meta of metas) entradaAutomatica(meta); });
    sock.ev.on('groups.update', (mudancas) => {
      for (const m of mudancas) if (grupos.has(m.id)) guardarGrupo({ ...grupos.get(m.id), ...m, subject: m.subject ?? grupos.get(m.id).nome });
    });
  } catch (err) {
    Object.assign(estado, { fase: 'erro', erro: `Não consegui iniciar a conexão: ${err.message}` });
  }
  return status();
}

export async function desconectar() {
  desligandoDePropósito = true;
  if (sock && !SIMULADO) {
    // logout remove o CRM da lista de aparelhos conectados no celular.
    try { await sock.logout(); } catch { /* já estava fora */ }
  }
  sock = null;
  await rm(PASTA_SESSAO, { recursive: true, force: true });
  grupos.clear();
  Object.assign(estado, { fase: 'desligado', qr: null, qrSvg: null, numero: null, erro: null, desde: null });
  return status();
}

/** Na subida do servidor, reconecta se já existe uma sessão salva. */
export async function retomarSessao() {
  if (SIMULADO) return;
  const temSessao = await access(join(PASTA_SESSAO, 'creds.json')).then(() => true, () => false);
  if (temSessao && (await carregarBibliotecas())) {
    console.log('WhatsApp: sessão encontrada, reconectando…');
    conectar();
  }
}

/* -------------------------------- importação ------------------------------ */

/**
 * Leva os grupos escolhidos para a esteira. Cada item: { id, stage }.
 * Quem já está na esteira é ignorado; o link de convite só vem quando o
 * número conectado é admin do grupo.
 */
export async function importar(itens = []) {
  if (estado.fase !== 'conectado') throw bad('Conecte o WhatsApp antes de importar.', 409);

  return importarGrupos(grupos, itens, async (grupo) => {
    if (grupo.eu_admin && sock && !SIMULADO) {
      try { return `https://chat.whatsapp.com/${await sock.groupInviteCode(grupo.id)}`; } catch { /* sem permissão */ }
    } else if (SIMULADO && grupo.convite) {
      return grupo.convite;
    }
    return '';
  }, 'importação do WhatsApp');
}

/**
 * Parte comum da importação. `grupos` é o Map id → grupo lido da conexão;
 * `convitePara(grupo)` devolve o link de convite, ou '' quando não há permissão.
 */
export async function importarGrupos(grupos, itens, convitePara, actor) {
  if (!Array.isArray(itens) || !itens.length) throw bad('Escolha pelo menos um grupo para importar.');
  if (itens.length > 500) throw bad('Importe no máximo 500 grupos por vez.');

  const etapas = new Set(STAGES.map((s) => s.key));
  const naEsteira = jaNaEsteira();
  const resultado = { criadas: [], ja_existiam: [], erros: [] };

  for (const item of itens) {
    const grupo = grupos.get(item?.id);
    if (!grupo) { resultado.erros.push({ id: item?.id, erro: 'Grupo não encontrado nesta conexão.' }); continue; }
    if (naEsteira.has(grupo.id)) { resultado.ja_existiam.push(grupo.nome); continue; }
    const etapa = etapas.has(item.stage) ? item.stage : 'nova';
    const convite = await convitePara(grupo);

    try {
      const franquia = fromWhatsappGroup({
        group_id: grupo.id,
        group_name: grupo.nome,
        group_invite_link: convite,
        created_at: (grupo.criado_em ?? new Date().toISOString()).slice(0, 19).replace('T', ' ')
      });
      if (etapa !== 'nova') moveStage(franquia.id, etapa, { actor });
      // Quem já chega concluído terminou antes do CRM: não entra na conta do bônus.
      if (etapa === 'concluido') marcarAnteriorAoCrm(franquia.id, { actor });
      resultado.criadas.push(franquia.franchise_name);
      naEsteira.add(grupo.id);
    } catch (err) {
      resultado.erros.push({ id: grupo.id, erro: err.message });
    }
  }
  return resultado;
}

/* ------------------------------- modo simulado ------------------------------
   Para testar a tela e a importação sem celular: CRM_WHATSAPP_SIMULADO=1.
   O QR aparece, e a rota de simular leitura faz o papel do celular. */

async function conectarSimulado() {
  await carregarBibliotecas();
  estado.fase = 'aguardando_qr';
  estado.qr = `simulado-${Date.now()}`;
  estado.qrSvg = await qrParaSvg(estado.qr);
  return status();
}

export async function simularLeitura() {
  if (!SIMULADO) throw bad('Disponível só no modo simulado.', 404);
  if (estado.fase !== 'aguardando_qr') throw bad('Gere o QR code antes de simular a leitura.', 409);
  const dias = (d) => Math.floor((Date.now() - d * 8.64e7) / 1000);
  const exemplos = [
    { id: '120363000000000101@g.us', subject: '7Bee x Ótica Visão Clara', creation: dias(3), participants: [1, 2, 3, 4], convite: 'https://chat.whatsapp.com/SimuladoOticaVisao1' },
    { id: '120363000000000102@g.us', subject: 'Onboarding - Pet Shop Amigo Fiel', creation: dias(12), participants: [1, 2, 3] },
    { id: '120363000000000103@g.us', subject: '7Bee x Academia Movimento', creation: dias(40), participants: [1, 2, 3, 4, 5], convite: 'https://chat.whatsapp.com/SimuladoAcademiaMov' },
    { id: '120363000000000104@g.us', subject: 'Família Silva', creation: dias(900), participants: [1, 2, 3, 4, 5, 6, 7] },
    { id: '120363000000000105@g.us', subject: 'Futebol de quinta', creation: dias(500), participants: [1, 2, 3, 4, 5, 6] },
    { id: '120363000000000001@g.us', subject: '7Bee x Mercado Bom Preço', creation: dias(1), participants: [1, 2, 3] }
  ];
  estado.numero = '5511999990000';
  for (const g of exemplos) {
    guardarGrupo({ ...g, participants: g.participants.map((n) => ({ id: `55119${n}@s.whatsapp.net` })) });
    grupos.get(g.id).convite = g.convite ?? '';
  }
  Object.assign(estado, { fase: 'conectado', qr: null, qrSvg: null, desde: new Date().toISOString() });
  return status();
}

/** Simula a entrada num grupo novo, para testar a entrada automática. */
export async function simularGrupoNovo(nome) {
  if (!SIMULADO) throw bad('Disponível só no modo simulado.', 404);
  if (estado.fase !== 'conectado') throw bad('Conecte antes.', 409);
  const id = `1203630000${Date.now()}@g.us`;
  await entradaAutomatica({ id, subject: nome, creation: Math.floor(Date.now() / 1000), participants: [] });
  return grupos.get(id);
}
