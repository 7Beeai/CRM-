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

CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
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
db.exec(`
CREATE INDEX IF NOT EXISTS idx_messages_needs_human ON messages(needs_human);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
`);

// O antigo status "relevante" virou "escalada" (precisa de resposta humana).
db.exec(`UPDATE messages SET status = 'escalada', needs_human = 1 WHERE status = 'relevante'`);

export function log(kind, detail, { messageId = null, contactId = null, actor = 'sistema' } = {}) {
  db.prepare(
    `INSERT INTO activities (message_id, contact_id, kind, detail, actor) VALUES (?, ?, ?, ?, ?)`
  ).run(messageId, contactId, kind, detail, actor);
}
