/**
 * Padrões de vale transporte (R$ por dia) salvos no banco — tabela employee_vt_padroes.
 * Server-only.
 *
 * - Colaborador ativo no RHiD que ainda não está na tabela entra automaticamente:
 *   com o padrão do backup das planilhas (lib/vt-padroes.json) se o nome for encontrado,
 *   ou em branco (origem "novo") para o RH preencher na página Vale Transporte.
 * - Desligados não aparecem porque a lista sempre vem dos ativos do RHiD.
 * - Depois de salvo, o padrão permanece (o backup nunca sobrescreve valor já preenchido).
 */
import { padraoDiaBackup } from "@/lib/vale-transporte";
import type { DbEmployeeVtPadrao } from "@/lib/supabase";

export interface PadraoVtSalvo {
  funcionarioId: string;
  funcionarioNome: string;
  padraoDia: number | null;
  origem: "planilha" | "manual" | "novo";
  atualizadoEm: string | null;
}

export interface FuncionarioVt {
  id: string;
  nome: string;
}

const TABELA = "employee_vt_padroes";

function fromDb(row: DbEmployeeVtPadrao): PadraoVtSalvo {
  return {
    funcionarioId: row.funcionario_id,
    funcionarioNome: row.funcionario_nome,
    padraoDia: row.padrao_dia === null ? null : Number(row.padrao_dia),
    origem: row.origem,
    atualizadoEm: row.atualizado_em,
  };
}

function fromBackup(f: FuncionarioVt): PadraoVtSalvo {
  const padraoDia = padraoDiaBackup(f.nome);
  return {
    funcionarioId: f.id,
    funcionarioNome: f.nome,
    padraoDia,
    origem: padraoDia === null ? "novo" : "planilha",
    atualizadoEm: null,
  };
}

async function getSupabase() {
  const { supabase } = await import("@/lib/supabase");
  return supabase;
}

/**
 * Garante que todos os funcionários informados tenham linha na tabela e devolve os padrões.
 * Se o banco estiver indisponível, devolve só o backup das planilhas (sem salvar) e `erro`.
 */
export async function carregarPadroesVt(
  funcionarios: FuncionarioVt[]
): Promise<{ padroes: Map<string, PadraoVtSalvo>; erro: string | null }> {
  const padroes = new Map<string, PadraoVtSalvo>();
  const ids = [...new Set(funcionarios.map((f) => f.id))];

  try {
    const supabase = await getSupabase();
    const existentes: DbEmployeeVtPadrao[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase
        .from(TABELA)
        .select("*")
        .in("funcionario_id", ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
      existentes.push(...((data ?? []) as DbEmployeeVtPadrao[]));
    }
    for (const row of existentes) padroes.set(row.funcionario_id, fromDb(row));

    // Novos no RHiD: entram com o backup da planilha ou em branco.
    // Já existentes ainda em branco: preenche se o backup tiver o nome (ex.: backup regerado).
    const gravar: DbEmployeeVtPadrao[] = [];
    const agora = new Date().toISOString();
    for (const f of funcionarios) {
      const atual = padroes.get(f.id);
      if (atual && atual.padraoDia !== null) continue;
      const backup = fromBackup(f);
      if (atual && backup.padraoDia === null) continue;
      gravar.push({
        funcionario_id: f.id,
        funcionario_nome: f.nome,
        padrao_dia: backup.padraoDia,
        origem: backup.origem,
        atualizado_em: agora,
      });
    }
    if (gravar.length) {
      const { data, error } = await supabase
        .from(TABELA)
        .upsert(gravar, { onConflict: "funcionario_id" })
        .select("*");
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as DbEmployeeVtPadrao[]) padroes.set(row.funcionario_id, fromDb(row));
    }
    return { padroes, erro: null };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[VT] Falha ao ler/gravar padrões no banco; usando backup das planilhas.", msg);
    for (const f of funcionarios) padroes.set(f.id, fromBackup(f));
    return { padroes, erro: msg };
  }
}

/** Salva (ou limpa, com null) o padrão R$/dia de um funcionário. */
export async function salvarPadraoVt(
  funcionarioId: string,
  funcionarioNome: string,
  padraoDia: number | null
): Promise<PadraoVtSalvo> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from(TABELA)
    .upsert(
      {
        funcionario_id: funcionarioId,
        funcionario_nome: funcionarioNome,
        padrao_dia: padraoDia === null ? null : Math.round(padraoDia * 100) / 100,
        origem: padraoDia === null ? "novo" : "manual",
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "funcionario_id" }
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return fromDb(data as DbEmployeeVtPadrao);
}
