/**
 * Filtro de período, compartilhado pela triagem, pela esteira e pelos contatos.
 *
 * Regra única: o período filtra pela data de entrada. A mensagem conta pelo
 * momento em que chegou, a franquia pelo dia em que entrou na esteira e o
 * contato pelo dia do cadastro.
 *
 * O navegador converte o início e o fim do dia local para UTC antes de mandar,
 * no mesmo formato que o banco guarda. Assim o "hoje" de quem está no Brasil
 * continua sendo o hoje dele, sem o servidor precisar saber o fuso.
 */

const DATA_HORA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

export function lerPeriodo({ desde = '', ate = '' } = {}) {
  if (desde && !DATA_HORA.test(desde)) throw bad('Início do período inválido. Use AAAA-MM-DD HH:MM:SS.');
  if (ate && !DATA_HORA.test(ate)) throw bad('Fim do período inválido. Use AAAA-MM-DD HH:MM:SS.');
  if (desde && ate && desde > ate) throw bad('O início do período vem depois do fim.');
  return { desde, ate, ativo: Boolean(desde || ate) };
}

/**
 * Trecho de SQL para uma coluna de data. A coluna vem sempre do código, nunca
 * do usuário; só os valores entram como parâmetro.
 */
export function filtroPeriodo(coluna, periodo) {
  const partes = [];
  const args = [];
  if (periodo.desde) { partes.push(`${coluna} >= ?`); args.push(periodo.desde); }
  if (periodo.ate) { partes.push(`${coluna} <= ?`); args.push(periodo.ate); }
  return { sql: partes.length ? ` AND ${partes.join(' AND ')}` : '', args };
}

/** O contrário: o que ficou fora do período. */
export function foraDoPeriodo(coluna, periodo) {
  const partes = [];
  const args = [];
  if (periodo.desde) { partes.push(`${coluna} < ?`); args.push(periodo.desde); }
  if (periodo.ate) { partes.push(`${coluna} > ?`); args.push(periodo.ate); }
  return { sql: partes.length ? ` AND (${partes.join(' OR ')})` : ' AND 0', args };
}
