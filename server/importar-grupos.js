/**
 * Importa de uma vez, pela Evolution, os grupos de franquia do WhatsApp do CS.
 *
 *   npm run importar:whatsapp               mostra o que vai entrar, sem gravar
 *   npm run importar:whatsapp -- --confirmar  grava na esteira
 *   npm run importar:whatsapp -- --confirmar --etapa=openai
 *   npm run importar:whatsapp -- --confirmar --etapa=concluido --nova="aracruz|guriri"
 *
 * --etapa vale para todos os grupos; --nova é uma expressão com os nomes que
 * ficam em Nova franquia mesmo assim. Quem entra em Concluído é marcado como
 * concluído antes do CRM e fica fora da meta de agilidade.
 *
 * Usa as mesmas variáveis do CRM: EVOLUTION_URL, EVOLUTION_INSTANCE,
 * EVOLUTION_API_KEY, CRM_WHATSAPP_FILTRO (obrigatório, ex.: "CDT") e
 * CRM_WHATSAPP_IGNORAR (ex.: "gest[aã]o"). Rodar de novo não duplica.
 */
process.env.CRM_EVOLUTION_INTERVALO_MIN = '0'; // sem leitura periódica: o script roda e termina.

const args = process.argv.slice(2);
const confirmar = args.includes('--confirmar');
const etapa = args.find((a) => a.startsWith('--etapa='))?.slice('--etapa='.length) ?? 'nova';
const naNova = args.find((a) => a.startsWith('--nova='))?.slice('--nova='.length);
const exprNova = naNova ? new RegExp(naNova, 'i') : null;
const etapaDe = (g) => (exprNova && exprNova.test(g.nome) ? 'nova' : etapa);

const evolution = await import('./evolution.js');
const { passaNoFiltro, configEntrada } = await import('./whatsapp.js');
const { STAGES } = await import('./onboarding.js');

function sair(msg) {
  console.error(msg);
  process.exit(1);
}

if (!evolution.configurado) sair('Defina EVOLUTION_URL, EVOLUTION_INSTANCE e EVOLUTION_API_KEY antes de importar.');
if (!configEntrada.filtro) sair('Defina CRM_WHATSAPP_FILTRO (ex.: "CDT") para não importar grupos pessoais.');
if (!STAGES.some((s) => s.key === etapa)) sair(`Etapa desconhecida: ${etapa}. Use uma de: ${STAGES.map((s) => s.key).join(', ')}.`);

const st = await evolution.conectar();
if (st.fase !== 'conectado') sair(`Evolution: ${st.erro}`);

const grupos = evolution.listarGrupos();
const franquias = grupos.filter((g) => passaNoFiltro(g.nome));
const ignorados = grupos.filter((g) => !passaNoFiltro(g.nome) && new RegExp(configEntrada.filtro, 'i').test(g.nome));
const novos = franquias.filter((g) => !g.na_esteira);
const jaEstao = franquias.filter((g) => g.na_esteira);

const data = (iso) => (iso ?? '').slice(0, 10) || '----------';
console.log(`${grupos.length} grupos na instância ${st.instancia} · filtro "${configEntrada.filtro}"` +
  (configEntrada.ignorar ? ` · ignorando "${configEntrada.ignorar}"` : ''));
for (const chave of new Set(novos.map(etapaDe))) {
  const daEtapa = novos.filter((g) => etapaDe(g) === chave);
  console.log(`\nVão entrar em "${STAGES.find((s) => s.key === chave).label}" (${daEtapa.length}):`);
  for (const g of daEtapa) console.log(`  ${data(g.criado_em)}  ${g.franquia}   (${g.nome})`);
}
if (jaEstao.length) console.log(`\nJá estão na esteira (${jaEstao.length}): ${jaEstao.map((g) => g.franquia).join(', ')}`);
if (ignorados.length) console.log(`\nIgnorados (${ignorados.length}): ${ignorados.map((g) => g.nome).join(', ')}`);

if (!confirmar) {
  console.log('\nNada foi gravado. Para gravar, rode de novo com --confirmar.');
  process.exit(0);
}
if (!novos.length) process.exit(0);

const r = await evolution.importar(novos.map((g) => ({ id: g.id, stage: etapaDe(g) })));
console.log(`\n${r.criadas.length} franquias importadas` +
  (r.ja_existiam.length ? `, ${r.ja_existiam.length} já estavam` : '') +
  (r.erros.length ? `, ${r.erros.length} com erro: ${r.erros.map((e) => e.erro).join('; ')}` : '') + '.');
process.exit(r.erros.length ? 1 : 0);
