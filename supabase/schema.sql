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
-- Sincronizada automaticamente com o cadastro do RHiD (serviço interno
-- customerdb/person.svc, que expõe os dados pessoais). Também aceita cadastro
-- manual/planilha para quem não está no RHiD (funcionario_id "manual-*").
create table if not exists employee_birthdays (
  id               uuid        primary key default gen_random_uuid(),
  funcionario_id   text        not null,
  funcionario_nome text        not null,
  data_nascimento  date        not null,
  created_at       timestamptz default now(),
  unique (funcionario_id)
);

-- ── Alertas diários de ponto (batida incompleta / atraso no dia) ─────────────
-- Alimentada pelo job automático (a cada 10 min) que lê a apuração do RHiD.
create table if not exists ponto_alertas_diarios (
  id                 uuid        primary key default gen_random_uuid(),
  funcionario_id     text        not null,
  funcionario_nome   text        not null,
  departamento       text        default '',
  cargo              text        default '',
  dia                date        not null,
  atraso_min         integer     not null default 0,
  tem_atraso         boolean     not null default false,
  batida_incompleta  boolean     not null default false,
  qtd_batidas        integer     not null default 0,
  detalhe            text        default '',
  atualizado_em      timestamptz default now(),
  unique (funcionario_id, dia)
);

-- Migração dos bancos onde o alerta era de hora extra em vez de atraso.
-- O conteúdo é 100% derivado do RHiD e reescrito a cada 10 min, então descartar
-- as colunas antigas não perde nada que não seja recalculado no próximo ciclo.
alter table ponto_alertas_diarios
  add column if not exists atraso_min integer not null default 0,
  add column if not exists tem_atraso boolean not null default false;

drop index if exists ponto_alertas_diarios_alerta_idx;

alter table ponto_alertas_diarios
  drop column if exists extra_min,
  drop column if exists mais_2h_extra;

create index if not exists ponto_alertas_diarios_dia_idx on ponto_alertas_diarios (dia);
create index if not exists ponto_alertas_diarios_alerta_idx on ponto_alertas_diarios (tem_atraso, batida_incompleta);

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
