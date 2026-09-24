import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.CRM_DB ?? join(root, 'data', 'crm.db');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  company     TEXT,
  email       TEXT,
  phone       TEXT,
  stage       TEXT NOT NULL DEFAULT 'lead',
  owner       TEXT,
  tags        TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  is_customer INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id    INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  sender_name   TEXT NOT NULL,
  sender_handle TEXT NOT NULL DEFAULT '',
  channel       TEXT NOT NULL DEFAULT 'whatsapp',
  subject       TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL,
  received_at   TEXT NOT NULL DEFAULT (datetime('now')),
  status        TEXT NOT NULL DEFAULT 'triagem',
  priority      TEXT NOT NULL DEFAULT 'media',
  score         INTEGER NOT NULL DEFAULT 0,
  reasons       TEXT NOT NULL DEFAULT '',
  assigned_to   TEXT NOT NULL DEFAULT '',
  due_at        TEXT,
  answered_at   TEXT,
  internal_note TEXT NOT NULL DEFAULT '',
  external_id   TEXT UNIQUE,
  thread_id     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),

  -- Decisão do agente de IA que faz a primeira triagem
  needs_human          INTEGER NOT NULL DEFAULT 0,
  agent_name           TEXT NOT NULL DEFAULT '',
  agent_decision       TEXT,
  agent_confidence     REAL,
  agent_intent         TEXT NOT NULL DEFAULT '',
  agent_reason         TEXT NOT NULL DEFAULT '',
  agent_reply          TEXT NOT NULL DEFAULT '',
  agent_suggested_reply TEXT NOT NULL DEFAULT '',
  agent_decided_at     TEXT,
  human_feedback       TEXT NOT NULL DEFAULT '',
  human_feedback_note  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS activities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  actor      TEXT NOT NULL DEFAULT 'sistema',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS onboardings (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  franchise_name      TEXT NOT NULL,
  contact_name        TEXT NOT NULL DEFAULT '',
  phone               TEXT NOT NULL DEFAULT '',
  plan                TEXT NOT NULL DEFAULT '',
  owner               TEXT NOT NULL DEFAULT '',
  stage               TEXT NOT NULL DEFAULT 'nova',
  situacao            TEXT NOT NULL DEFAULT 'ativo',
  notes               TEXT NOT NULL DEFAULT '',
  origem              TEXT NOT NULL DEFAULT 'manual',
  whatsapp_group_id   TEXT UNIQUE,
  whatsapp_group_name TEXT NOT NULL DEFAULT '',
  whatsapp_group_link TEXT NOT NULL DEFAULT '',
  contact_id          INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  started_at          TEXT NOT NULL DEFAULT (datetime('now')),
  stage_changed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  concluded_at        TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  onboarding_id  INTEGER NOT NULL REFERENCES onboardings(id) ON DELETE CASCADE,
  task_key       TEXT NOT NULL,
  title          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pendente',
  note           TEXT NOT NULL DEFAULT '',
  position       INTEGER NOT NULL DEFAULT 0,
  done_at        TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (onboarding_id, task_key)
);

CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_onboardings_stage ON onboardings(stage);
CREATE INDEX IF NOT EXISTS idx_onboarding_tasks ON onboarding_tasks(onboarding_id);
CREATE INDEX IF NOT EXISTS idx_messages_received ON messages(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_message ON activities(message_id);
`);

// Migrações para bancos criados antes da integração com o agente.
const existing = new Set(db.prepare(`PRAGMA table_info(messages)`).all().map((c) => c.name));
const additions = [
  ['thread_id', `TEXT`],
  ['needs_human', `INTEGER NOT NULL DEFAULT 0`],
  ['agent_name', `TEXT NOT NULL DEFAULT ''`],
  ['agent_decision', `TEXT`],
  ['agent_confidence', `REAL`],
  ['agent_intent', `TEXT NOT NULL DEFAULT ''`],
  ['agent_reason', `TEXT NOT NULL DEFAULT ''`],
  ['agent_reply', `TEXT NOT NULL DEFAULT ''`],
  ['agent_suggested_reply', `TEXT NOT NULL DEFAULT ''`],
  ['agent_decided_at', `TEXT`],
  ['human_feedback', `TEXT NOT NULL DEFAULT ''`],
  ['human_feedback_note', `TEXT NOT NULL DEFAULT ''`]
];
for (const [name, type] of additions) {
  if (!existing.has(name)) db.exec(`ALTER TABLE messages ADD COLUMN ${name} ${type}`);
}
// Coluna criada depois do primeiro onboarding: link de convite do grupo.
if (!new Set(db.prepare(`PRAGMA table_info(onboardings)`).all().map((c) => c.name)).has('whatsapp_group_link')) {
  db.exec(`ALTER TABLE onboardings ADD COLUMN whatsapp_group_link TEXT NOT NULL DEFAULT ''`);
}

db.exec(`
CREATE INDEX IF NOT EXISTS idx_messages_needs_human ON messages(needs_human);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
`);

// O antigo status "relevante" virou "escalada" (precisa de resposta humana).
db.exec(`UPDATE messages SET status = 'escalada', needs_human = 1 WHERE status = 'relevante'`);

// A tabela de atividades nasceu só para mensagens; agora também registra onboarding.
if (!new Set(db.prepare(`PRAGMA table_info(activities)`).all().map((c) => c.name)).has('onboarding_id')) {
  db.exec(`ALTER TABLE activities ADD COLUMN onboarding_id INTEGER REFERENCES onboardings(id) ON DELETE CASCADE`);
}

export function log(kind, detail, { messageId = null, contactId = null, onboardingId = null, actor = 'sistema' } = {}) {
  db.prepare(
    `INSERT INTO activities (message_id, contact_id, onboarding_id, kind, detail, actor)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(messageId, contactId, onboardingId, kind, detail, actor);
}

// Franquias que já estavam concluídas antes do CRM: ficam fora da meta de 5 dias.
if (!new Set(db.prepare(`PRAGMA table_info(onboardings)`).all().map((c) => c.name)).has('fora_da_meta')) {
  db.exec(`ALTER TABLE onboardings ADD COLUMN fora_da_meta INTEGER NOT NULL DEFAULT 0`);
}

// Ajustes pequenos que precisam sobreviver a um reinício, como a última leitura da Evolution.
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);

export function lerAjuste(chave) {
  return db.prepare(`SELECT value FROM settings WHERE key = ?`).get(chave)?.value ?? null;
}

export function gravarAjuste(chave, valor) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(chave, String(valor));
}
