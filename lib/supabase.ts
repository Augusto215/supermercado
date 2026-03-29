/**
 * Server-side Supabase client — uses the service role key.
 * NEVER import this in client components or expose to the browser.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  throw new Error(
    "SUPABASE_URL e SUPABASE_SERVICE_KEY devem estar configurados no .env"
  );
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false }
});

// ─── Row types (mirrors the SQL schema) ──────────────────────────────────────

export interface DbEmployeePurchase {
  id: string;
  funcionario_id: string;
  funcionario_nome: string;
  produto: string;
  dia: string;          // ISO date string "YYYY-MM-DD"
  valor: number;
  created_at: string;
}

export interface DbCashDifference {
  id: string;
  operador: string;
  dia: string;
  valor_esperado: number | null;
  valor_contado: number | null;
  diferenca: number;
  arquivo: string | null;
  importado_em: string;
}
