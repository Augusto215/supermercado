-- ─────────────────────────────────────────────────────────────────────────────
-- R Cruz Supermercado — Supabase schema
-- Execute este arquivo no SQL Editor do Supabase (https://supabase.com/dashboard)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Compras dos Funcionários ──────────────────────────────────────────────────
create table if not exists employee_purchases (
  id            uuid        primary key default gen_random_uuid(),
  funcionario_id   text     not null,
  funcionario_nome text     not null,
  produto       text        not null,
  dia           date        not null,
  valor         numeric(10,2) not null check (valor > 0),
  created_at    timestamptz default now()
);

-- ── Vales dos Funcionários ────────────────────────────────────────────────────
create table if not exists employee_vales (
  id               uuid        primary key default gen_random_uuid(),
  funcionario_id   text        not null,
  funcionario_nome text        not null,
  descricao        text        not null,
  dia              date        not null,
  valor            numeric(10,2) not null check (valor > 0),
  forma_pagamento  text        not null default 'avista' check (forma_pagamento in ('avista', 'parcelado')),
  parcelas         integer     not null default 1 check (parcelas >= 1),
  created_at       timestamptz default now()
);

-- Migração para bancos onde employee_vales já existia sem os campos de pagamento:
alter table employee_vales
  add column if not exists forma_pagamento text not null default 'avista',
  add column if not exists parcelas integer not null default 1;

-- ── Aniversariantes ───────────────────────────────────────────────────────────
-- A API do RHiD não expõe data de nascimento, então mantemos esse cadastro à parte.
create table if not exists employee_birthdays (
  id               uuid        primary key default gen_random_uuid(),
  funcionario_id   text        not null,
  funcionario_nome text        not null,
  data_nascimento  date        not null,
  created_at       timestamptz default now(),
  unique (funcionario_id)
);

-- ── Alertas diários de ponto (batida incompleta / mais de 2h extra no dia) ────
-- Alimentada pelo job automático (a cada 10 min) que lê a apuração do RHiD.
create table if not exists ponto_alertas_diarios (
  id                 uuid        primary key default gen_random_uuid(),
  funcionario_id     text        not null,
  funcionario_nome   text        not null,
  departamento       text        default '',
  cargo              text        default '',
  dia                date        not null,
  extra_min          integer     not null default 0,
  mais_2h_extra      boolean     not null default false,
  batida_incompleta  boolean     not null default false,
  qtd_batidas        integer     not null default 0,
  detalhe            text        default '',
  atualizado_em      timestamptz default now(),
  unique (funcionario_id, dia)
);

create index if not exists ponto_alertas_diarios_dia_idx on ponto_alertas_diarios (dia);
create index if not exists ponto_alertas_diarios_alerta_idx on ponto_alertas_diarios (mais_2h_extra, batida_incompleta);

-- ── Diferença de Caixa ────────────────────────────────────────────────────────
-- Cada importação salva o lote inteiro. O lote mais recente é o "atual".
create table if not exists cash_differences (
  id            uuid        primary key default gen_random_uuid(),
  operador      text        not null,
  dia           text        not null,
  valor_esperado  numeric(12,2),
  valor_contado   numeric(12,2),
  diferenca     numeric(12,2) not null,
  arquivo       text,                         -- nome do arquivo importado
  importado_em  timestamptz default now()
);
