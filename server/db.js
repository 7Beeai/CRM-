/**
 * Acesso ao banco: Postgres do Supabase (schema `crm`), pelo driver `pg`.
 *
 * O CRM nasceu em SQLite e o código fala em datas como texto 'AAAA-MM-DD HH:MM:SS'
 * em UTC. Para não reescrever cada comparação, o driver devolve timestamptz nesse
 * mesmo formato (sempre convertido para UTC) e a sessão roda em UTC, então o texto
 * que o app manda como parâmetro entra certo. Contagens (bigint) e médias (numeric)
 * voltam como Number.
 *
 * Helpers: all/one/run recebem SQL com `?` posicional e convertem para $1..$n.
 * tx(fn) roda fn(client) numa transação; o client tem os mesmos all/one/run.
 */
import pg from 'pg';

const { Pool, types } = pg;

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definida (string de conexão do Postgres do Supabase).');

// ---- tipos: o app espera texto UTC sem fuso, números como Number ----
const doisDigitos = (n) => String(n).padStart(2, '0');
export function formatarUtc(d) {
  return `${d.getUTCFullYear()}-${doisDigitos(d.getUTCMonth() + 1)}-${doisDigitos(d.getUTCDate())} ` +
    `${doisDigitos(d.getUTCHours())}:${doisDigitos(d.getUTCMinutes())}:${doisDigitos(d.getUTCSeconds())}`;
}
const parseTimestamp = (texto) => {
  if (texto === null) return null;
  // Postgres manda '2026-09-29 18:45:12.123456+00' (timestamptz) ou sem fuso (timestamp).
  const t = texto.replace(' ', 'T');
  const iso = /[+-]\d\d(:?\d\d)?$|Z$/.test(t) ? t : `${t}Z`;
  const d = new Date(iso.replace(/([+-]\d\d)$/, '$1:00'));
  return Number.isNaN(d.getTime()) ? texto : formatarUtc(d);
};
types.setTypeParser(1184, parseTimestamp); // timestamptz
types.setTypeParser(1114, parseTimestamp); // timestamp
types.setTypeParser(1082, (t) => t);       // date fica 'AAAA-MM-DD'
types.setTypeParser(20, (t) => Number(t)); // int8 (count)
types.setTypeParser(1700, (t) => Number(t)); // numeric (avg)

const pool = new Pool({
  connectionString: url,
  max: Number(process.env.CRM_DB_POOL ?? 4),
  idleTimeoutMillis: 30000,
  ssl: /localhost|127\.0\.0\.1|172\.17\./.test(url) ? false : { rejectUnauthorized: false }
});
pool.on('connect', (client) => {
  client.query(`SET search_path TO crm, public; SET timezone TO 'UTC'`).catch(() => {});
});
pool.on('error', (err) => console.error('Postgres:', err.message));

// `?` → $1..$n. O SQL nunca contém '?' literal fora de placeholder neste projeto.
function numerar(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function helpers(executor) {
  return {
    all: async (sql, params = []) => (await executor.query(numerar(sql), params)).rows,
    one: async (sql, params = []) => (await executor.query(numerar(sql), params)).rows[0],
    run: async (sql, params = []) => {
      const r = await executor.query(numerar(sql), params);
      return { rowCount: r.rowCount, rows: r.rows, id: r.rows[0]?.id ?? null };
    }
  };
}

export const { all, one, run } = helpers(pool);

/** Transação: tx(async (t) => { await t.run(...); return ...; }) */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(helpers(client));
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function log(kind, detail, { messageId = null, contactId = null, onboardingId = null, actor = 'sistema', t = null } = {}) {
  await (t ?? { run }).run(
    `INSERT INTO activities (message_id, contact_id, onboarding_id, kind, detail, actor) VALUES (?, ?, ?, ?, ?, ?)`,
    [messageId, contactId, onboardingId, kind, detail, actor]
  );
}

export async function lerAjuste(chave) {
  return (await one(`SELECT value FROM settings WHERE key = ?`, [chave]))?.value ?? null;
}

export async function gravarAjuste(chave, valor) {
  await run(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`, [chave, String(valor)]);
}

/** Confere a conexão e o schema no boot; falha cedo se o banco não estiver pronto. */
export async function verificarBanco() {
  const r = await one(`SELECT to_regclass('crm.messages') AS tabela`);
  if (!r?.tabela) throw new Error('Schema crm não encontrado: aplique supabase/migrations/*.sql no projeto.');
}

export async function fecharBanco() {
  await pool.end();
}
