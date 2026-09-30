-- CRM 7Bee — schema inicial no Supabase (projeto hawurnfplpvfjjcoijen).
-- Tudo fica no schema `crm`, fora do `public`, e por isso fora da API REST do Supabase.
-- Só o servidor do CRM (conexão direta, role postgres) lê e escreve aqui.
-- Datas em timestamptz; o servidor fala sempre em UTC.

create schema if not exists crm;

-- ---------------------------------------------------------------- equipe
-- Quem pode entrar no CRM. Uma linha por usuário do Supabase Auth, criada por
-- trigger quando o usuário nasce. `nome` é o que aparece como ator/responsável.
create table if not exists crm.usuarios (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  nome        text not null,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create or replace function crm.registrar_usuario()
returns trigger
language plpgsql
security definer
set search_path = crm, public
as $$
begin
  insert into crm.usuarios (id, email, nome)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data->>'nome', ''), split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists crm_registrar_usuario on auth.users;
create trigger crm_registrar_usuario
  after insert on auth.users
  for each row execute function crm.registrar_usuario();

-- ---------------------------------------------------------------- contatos
create table if not exists crm.contacts (
  id           bigserial primary key,
  name         text not null,
  company      text,
  email        text,
  phone        text,
  stage        text not null default 'lead',
  owner        text,
  tags         text not null default '',
  notes        text not null default '',
  is_customer  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_contacts_phone on crm.contacts (phone);
create index if not exists idx_contacts_email on crm.contacts (lower(email));

-- ---------------------------------------------------------------- mensagens
create table if not exists crm.messages (
  id                    bigserial primary key,
  contact_id            bigint references crm.contacts(id) on delete set null,
  sender_name           text not null,
  sender_handle         text not null default '',
  channel               text not null default 'whatsapp',
  subject               text not null default '',
  body                  text not null,
  received_at           timestamptz not null default now(),
  status                text not null default 'triagem',
  priority              text not null default 'media',
  score                 integer not null default 0,
  reasons               text not null default '',
  assigned_to           text not null default '',
  due_at                timestamptz,
  answered_at           timestamptz,
  internal_note         text not null default '',
  external_id           text unique,
  thread_id             text,
  needs_human           boolean not null default false,
  agent_name            text not null default '',
  agent_decision        text,
  agent_confidence      double precision,
  agent_intent          text not null default '',
  agent_reason          text not null default '',
  agent_reply           text not null default '',
  agent_suggested_reply text not null default '',
  agent_decided_at      timestamptz,
  human_feedback        text not null default '',
  human_feedback_note   text not null default '',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_messages_status on crm.messages (status);
create index if not exists idx_messages_received on crm.messages (received_at desc);
create index if not exists idx_messages_needs_human on crm.messages (needs_human);
create index if not exists idx_messages_thread on crm.messages (thread_id);
create index if not exists idx_messages_contact on crm.messages (contact_id);

-- ---------------------------------------------------------------- onboarding
create table if not exists crm.onboardings (
  id                   bigserial primary key,
  franchise_name       text not null,
  contact_name         text not null default '',
  phone                text not null default '',
  plan                 text not null default '',
  owner                text not null default '',
  stage                text not null default 'nova',
  situacao             text not null default 'ativo',
  notes                text not null default '',
  origem               text not null default 'manual',
  whatsapp_group_id    text unique,
  whatsapp_group_name  text not null default '',
  whatsapp_group_link  text not null default '',
  contact_id           bigint references crm.contacts(id) on delete set null,
  fora_da_meta         boolean not null default false,
  started_at           timestamptz not null default now(),
  stage_changed_at     timestamptz not null default now(),
  concluded_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_onboardings_stage on crm.onboardings (stage);
create index if not exists idx_onboardings_contact on crm.onboardings (contact_id);

create table if not exists crm.onboarding_tasks (
  id             bigserial primary key,
  onboarding_id  bigint not null references crm.onboardings(id) on delete cascade,
  task_key       text not null,
  title          text not null,
  status         text not null default 'pendente',
  note           text not null default '',
  position       integer not null default 0,
  done_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (onboarding_id, task_key)
);
create index if not exists idx_onboarding_tasks on crm.onboarding_tasks (onboarding_id);

-- ---------------------------------------------------------------- atividades
create table if not exists crm.activities (
  id             bigserial primary key,
  message_id     bigint references crm.messages(id) on delete cascade,
  contact_id     bigint references crm.contacts(id) on delete cascade,
  onboarding_id  bigint references crm.onboardings(id) on delete cascade,
  kind           text not null,
  detail         text not null default '',
  actor          text not null default 'sistema',
  created_at     timestamptz not null default now()
);
create index if not exists idx_activities_message on crm.activities (message_id);
create index if not exists idx_activities_onboarding on crm.activities (onboarding_id);

-- ---------------------------------------------------------------- agente
create table if not exists crm.agent_pausas (
  group_id    text primary key,
  group_name  text not null default '',
  motivo      text not null default '',
  trecho      text not null default '',
  message_id  bigint references crm.messages(id) on delete set null,
  pausado_em  timestamptz not null default now()
);

create table if not exists crm.agent_envios (
  message_key  text primary key,
  group_id     text not null default '',
  enviado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------- ajustes
create table if not exists crm.settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- segurança
-- RLS ligada em tudo, sem policy: as roles do Supabase (anon/authenticated)
-- não leem nada mesmo que o schema venha a ser exposto. O servidor do CRM
-- conecta como postgres (bypassa RLS).
alter table crm.usuarios         enable row level security;
alter table crm.contacts         enable row level security;
alter table crm.messages         enable row level security;
alter table crm.onboardings      enable row level security;
alter table crm.onboarding_tasks enable row level security;
alter table crm.activities       enable row level security;
alter table crm.agent_pausas     enable row level security;
alter table crm.agent_envios     enable row level security;
alter table crm.settings         enable row level security;

revoke all on schema crm from anon, authenticated;
revoke all on all tables in schema crm from anon, authenticated;
