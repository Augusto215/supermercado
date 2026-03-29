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
