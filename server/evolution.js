/**
 * Conexão com o WhatsApp do CS pela Evolution API.
 *
 * O número do Guilherme já está conectado numa instância da Evolution, a mesma
 * que o agente usa. O CRM só lê dessa instância: a lista de grupos (nome, data
 * de criação e tamanho) e, na importação, o link de convite de cada grupo.
 * Nenhuma mensagem é lida, e o CRM nunca desconecta a instância nem troca o
 * webhook dela, porque isso derrubaria o agente.
 *
 * Configuração (variáveis de ambiente):
 *   EVOLUTION_URL       endereço da Evolution, ex.: https://evolution.7bee.top
 *   EVOLUTION_INSTANCE  nome da instância, ex.: Guilherme-7Bee
 *   EVOLUTION_API_KEY   chave da API. Fica só no servidor; o navegador nunca vê.
 *   CRM_EVOLUTION_INTERVALO_MIN  de quantos em quantos minutos procurar grupos
 *                       novos (padrão 5; 0 desliga e deixa só o webhook).
 */
import { lerAjuste, gravarAjuste } from './db.js';
import { nomeDaFranquia } from './onboarding.js';
import { jaNaEsteira, levarGrupoNovo, importarGrupos, configEntrada } from './whatsapp.js';

const URL_BASE = (process.env.EVOLUTION_URL ?? '').replace(/\/+$/, '');
const INSTANCIA = process.env.EVOLUTION_INSTANCE ?? '';
const CHAVE = process.env.EVOLUTION_API_KEY ?? '';
const INTERVALO_MIN = Number(process.env.CRM_EVOLUTION_INTERVALO_MIN ?? 5);
const AJUSTE_LEITURA = 'evolution_ultima_leitura';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** A Evolution só é usada quando as três variáveis estão definidas. */
export const configurado = Boolean(URL_BASE && INSTANCIA && CHAVE);

const estado = {
  fase: 'desligado', // desligado | conectando | conectado | erro
  numero: null,
  perfil: null,
  erro: null,
  desde: null,
  ultimaLeitura: null,
  lendo: null
};
const grupos = new Map();
let timer = null;
let jaLeu = false;

/* ---------------------------------- HTTP ---------------------------------- */

async function evo(caminho, { timeout = 20000 } = {}) {
  let resp;
  try {
    resp = await fetch(`${URL_BASE}${caminho}`, {
      headers: { apikey: CHAVE, accept: 'application/json' },
      signal: AbortSignal.timeout(timeout)
    });
  } catch (err) {
    const motivo = err.name === 'TimeoutError' ? 'a Evolution demorou demais para responder' : 'não consegui falar com a Evolution';
    throw bad(`${motivo} (${URL_BASE}).`, 502);
  }
  if (resp.status === 401 || resp.status === 403) throw bad('A Evolution recusou a chave. Confira EVOLUTION_API_KEY.', 502);
  if (resp.status === 404) throw bad(`A Evolution não encontrou a instância "${INSTANCIA}". Confira EVOLUTION_INSTANCE.`, 502);
  if (!resp.ok) throw bad(`A Evolution respondeu com erro ${resp.status}.`, 502);
  return resp.json();
}

const inst = encodeURIComponent(INSTANCIA);
const soDigitos = (jid) => String(jid ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');

/* --------------------------------- grupos --------------------------------- */

function guardarGrupo(g) {
  if (!g?.id || !String(g.id).endsWith('@g.us')) return null;
  const anterior = grupos.get(g.id) ?? {};
  // A Evolution manda `creation` em segundos; alguns eventos mandam em milissegundos.
  const criacao = Number(g.creation);
  const criadoEm = criacao ? new Date(criacao < 1e12 ? criacao * 1000 : criacao).toISOString() : anterior.criado_em ?? null;
  const participantes = Array.isArray(g.participants) ? g.participants : null;
  const grupo = {
    id: g.id,
    nome: String(g.subject ?? anterior.nome ?? '').trim(),
    criado_em: criadoEm,
    participantes: Number(g.size ?? participantes?.length ?? anterior.participantes ?? 0),
    // Sem a lista de participantes não dá para saber se o Guilherme é admin;
    // na importação o CRM tenta o convite e, sem permissão, segue sem link.
    eu_admin: participantes && estado.numero
      ? participantes.some((p) => soDigitos(p.id) === estado.numero && ['admin', 'superadmin'].includes(p.admin))
      : anterior.eu_admin ?? null,
    comunidade: Boolean(g.isCommunity)
  };
  grupos.set(grupo.id, grupo);
  return grupo;
}

/**
 * Lê todos os grupos da instância. Grupos que aparecem pela primeira vez viram
 * franquia sozinhos (se a entrada automática estiver ligada), menos na primeira
 * leitura de todas: ali é o Guilherme quem escolhe o que importar.
 */
export async function lerGrupos() {
  if (estado.lendo) return estado.lendo;
  estado.lendo = (async () => {
    const lista = await evo(`/group/fetchAllGroups/${inst}?getParticipants=false`, { timeout: 90000 });
    if (!Array.isArray(lista)) throw bad('A Evolution devolveu a lista de grupos num formato inesperado.', 502);

    const conhecidos = new Set(grupos.keys());
    const anterior = lerAjuste(AJUSTE_LEITURA);
    const primeiraDoProcesso = !jaLeu;
    grupos.clear();
    const novos = [];
    for (const g of lista) {
      // Comunidade é só um guarda-chuva de grupos; não vira franquia nem entra na contagem.
      if (g?.isCommunity) continue;
      const grupo = guardarGrupo(g);
      if (!grupo) continue;
      if (primeiraDoProcesso) {
        // Depois de um reinício: só é novo o grupo criado depois da última leitura salva.
        if (anterior && grupo.criado_em && grupo.criado_em > anterior) novos.push(grupo);
      } else if (!conhecidos.has(grupo.id)) {
        novos.push(grupo);
      }
    }
    for (const grupo of novos) levarGrupoNovo(grupo, 'Evolution');

    jaLeu = true;
    estado.ultimaLeitura = new Date().toISOString();
    gravarAjuste(AJUSTE_LEITURA, estado.ultimaLeitura);
    return grupos.size;
  })();
  try { return await estado.lendo; } finally { estado.lendo = null; }
}

export function listarGrupos() {
  if (estado.fase !== 'conectado') throw bad('A leitura da Evolution ainda não terminou.', 409);
  const naEsteira = jaNaEsteira();
  return [...grupos.values()]
    .filter((g) => !g.comunidade)
    .map((g) => ({ ...g, franquia: nomeDaFranquia(g.nome), na_esteira: naEsteira.has(g.id) }))
    .sort((a, b) => (b.criado_em ?? '').localeCompare(a.criado_em ?? '') || a.nome.localeCompare(b.nome));
}

/* -------------------------------- conexão --------------------------------- */

export async function status() {
  return {
    fase: estado.fase,
    provedor: 'evolution',
    instancia: INSTANCIA,
    perfil: estado.perfil,
    qr_svg: null,
    numero: estado.numero,
    grupos: grupos.size,
    erro: estado.erro,
    desde: estado.desde,
    ultima_leitura: estado.ultimaLeitura,
    intervalo_min: INTERVALO_MIN,
    simulado: false,
    entrada_automatica: configEntrada.automatica,
    filtro: configEntrada.filtro
  };
}

/** Confere a instância e lê os grupos. Não mexe na conexão da Evolution. */
export async function conectar() {
  if (estado.fase === 'conectando') return status();
  estado.fase = 'conectando';
  estado.erro = null;
  try {
    const instancias = await evo(`/instance/fetchInstances?instanceName=${inst}`);
    const dados = (Array.isArray(instancias) ? instancias : [instancias])
      .map((i) => i?.instance ?? i)
      .find((i) => (i?.name ?? i?.instanceName) === INSTANCIA);
    if (!dados) throw bad(`A instância "${INSTANCIA}" não existe nessa Evolution.`, 502);
    const situacao = dados.connectionStatus ?? dados.status ?? dados.state;
    if (situacao && situacao !== 'open') {
      throw bad(`O WhatsApp da instância "${INSTANCIA}" está desconectado na Evolution (${situacao}). Reconecte pelo painel da Evolution e tente de novo.`, 409);
    }
    // Só o número e o nome do perfil saem daqui; o resto (inclusive o token da instância) fica de fora.
    estado.numero = soDigitos(dados.ownerJid ?? dados.owner ?? dados.number) || null;
    estado.perfil = dados.profileName ?? null;

    await lerGrupos();
    Object.assign(estado, { fase: 'conectado', desde: estado.desde ?? new Date().toISOString() });
    console.log(`Evolution: instância ${INSTANCIA} lida, ${grupos.size} grupos.`);
    agendar();
  } catch (err) {
    Object.assign(estado, { fase: 'erro', erro: err.message });
  }
  return status();
}

/** Para de ler no CRM. A instância continua conectada na Evolution. */
export async function desconectar() {
  clearInterval(timer);
  timer = null;
  grupos.clear();
  jaLeu = false;
  Object.assign(estado, { fase: 'desligado', numero: null, perfil: null, erro: null, desde: null });
  return status();
}

function agendar() {
  clearInterval(timer);
  if (!(INTERVALO_MIN > 0)) return;
  timer = setInterval(() => {
    lerGrupos().catch((err) => console.error('Evolution: falha ao procurar grupos novos:', err.message));
  }, INTERVALO_MIN * 60_000);
  timer.unref?.();
}

/** Na subida do servidor já lê a instância, porque não há QR code a esperar. */
export async function retomarSessao() {
  const st = await conectar();
  if (st.fase === 'erro') {
    console.error(`Evolution: ${st.erro}`);
    // Tenta de novo mais tarde: a Evolution pode estar reiniciando.
    if (INTERVALO_MIN > 0) setTimeout(() => { if (estado.fase === 'erro') retomarSessao(); }, INTERVALO_MIN * 60_000).unref?.();
  }
}

/* -------------------------------- importação ------------------------------ */

export async function importar(itens = []) {
  if (estado.fase !== 'conectado') throw bad('A leitura da Evolution ainda não terminou.', 409);
  return importarGrupos(grupos, itens, async (grupo) => {
    if (grupo.eu_admin === false) return '';
    try {
      const r = await evo(`/group/inviteCode/${inst}?groupJid=${encodeURIComponent(grupo.id)}`);
      const codigo = r?.inviteCode ?? String(r?.inviteUrl ?? '').split('/').pop();
      return /^[A-Za-z0-9]{6,60}$/.test(codigo ?? '') ? `https://chat.whatsapp.com/${codigo}` : '';
    } catch {
      return ''; // O Guilherme não é admin desse grupo: a franquia entra sem link.
    }
  }, 'importação da Evolution');
}

/* --------------------------------- webhook -------------------------------- */

/**
 * Eventos que a Evolution manda para /api/whatsapp/evolution-webhook.
 * GROUPS_UPSERT traz o grupo novo completo; os demais eventos de grupo só
 * disparam uma nova leitura. Outros eventos são ignorados.
 */
export async function receberEvento(corpo) {
  const evento = String(corpo?.event ?? '').toLowerCase().replace(/_/g, '.');
  if (corpo?.instance && corpo.instance !== INSTANCIA) return { ok: true, ignorado: 'outra instância' };
  if (!evento.startsWith('groups.') && !evento.startsWith('group.')) return { ok: true, ignorado: evento || 'sem evento' };
  if (estado.fase !== 'conectado') return { ok: true, ignorado: 'leitura ainda não feita' };

  const dados = Array.isArray(corpo.data) ? corpo.data : [corpo.data];
  const completos = dados.filter((g) => g?.id && g.subject);
  if (evento === 'groups.upsert' && completos.length) {
    let criadas = 0;
    for (const g of completos) {
      const grupo = guardarGrupo(g);
      if (grupo && !grupo.comunidade && levarGrupoNovo(grupo, 'Evolution')) criadas += 1;
    }
    return { ok: true, criadas };
  }
  lerGrupos().catch((err) => console.error('Evolution: falha ao reler grupos após evento:', err.message));
  return { ok: true, relendo: true };
}

export const simularLeitura = async () => { throw bad('Disponível só no modo simulado.', 404); };
export const simularGrupoNovo = async () => { throw bad('Disponível só no modo simulado.', 404); };
